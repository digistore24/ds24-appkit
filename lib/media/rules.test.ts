// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { blankComments } from "@/scripts/lib/source-text.mjs";

import {
  MEDIA_KINDS,
  RESERVED_MEDIA_NAMESPACES,
  ROUTE_HANDLER_BODY_LIMIT_BYTES,
  SERVER_ACTION_BODY_LIMIT_BYTES,
  routeCeilingBytes,
  slotCeilingBytes,
  stagingKey,
  MEDIA_VISIBILITIES,
  OWNED_MEDIA_VISIBILITIES,
  isMediaVisibility,
  extensionFor,
  formatBytes,
  kindForMime,
  needsAlt,
  refuseUpload,
  safeFilename,
  servedThroughApp,
  storageKey,
  MEDIA_VARIANT_WIDTHS,
  variantKey,
  variantWidthsFor,
  type MediaRules,
} from "./rules";

const RULES: MediaRules = {
  kinds: {
    image: {
      maxBytes: 1000,
      mimeTypes: ["image/jpeg", "image/png"],
      signedUrlSeconds: 300,
    },
    video: { maxBytes: 5000, mimeTypes: ["video/mp4"], signedUrlSeconds: 21600 },
    audio: { maxBytes: 5000, mimeTypes: ["audio/mpeg"], signedUrlSeconds: 21600 },
    file: { maxBytes: 2000, mimeTypes: ["application/pdf", "application/zip"], signedUrlSeconds: 300 },
  },
  mayUpload: {
    member: ["image/jpeg", "application/pdf"],
    owner: ["image/jpeg", "image/png", "video/mp4", "application/zip"],
  },
};

describe("kindForMime", () => {
  it("finds the kind a media type belongs to", () => {
    expect(kindForMime(RULES, "image/png")).toBe("image");
    expect(kindForMime(RULES, "video/mp4")).toBe("video");
    expect(kindForMime(RULES, "application/pdf")).toBe("file");
  });

  it("is case- and whitespace-insensitive, because headers are", () => {
    expect(kindForMime(RULES, " IMAGE/PNG ")).toBe("image");
  });

  it("answers null for something this installation does not take", () => {
    expect(kindForMime(RULES, "application/x-msdownload")).toBeNull();
  });
});

describe("refuseUpload", () => {
  it("lets through what the role is allowed and the ceiling permits", () => {
    expect(refuseUpload(RULES, { role: "member", mime: "image/jpeg", bytes: 500 })).toBeNull();
  });

  it("refuses an unknown type before it considers the size", () => {
    // The order is the point: "10 MB is too large" is a confusing answer to
    // somebody who uploaded a format the app never accepts.
    expect(
      refuseUpload(RULES, { role: "member", mime: "application/x-msdownload", bytes: 9_999_999 }),
    ).toBe("typeNotAllowed");
  });

  it("refuses a type this role may not upload, even though the app accepts it", () => {
    // A ZIP is a legitimate kind here — but a member handing every other member
    // an archive is not a media feature.
    expect(refuseUpload(RULES, { role: "member", mime: "application/zip", bytes: 10 })).toBe(
      "notAllowedForRole",
    );
    expect(refuseUpload(RULES, { role: "owner", mime: "application/zip", bytes: 10 })).toBeNull();
  });

  it("refuses a role nobody declared, rather than defaulting to permissive", () => {
    expect(refuseUpload(RULES, { role: "guest", mime: "image/jpeg", bytes: 10 })).toBe(
      "notAllowedForRole",
    );
  });

  it("applies the ceiling of the kind, not one global number", () => {
    expect(refuseUpload(RULES, { role: "owner", mime: "image/jpeg", bytes: 1001 })).toBe(
      "tooLarge",
    );
    // The same size is fine as a video, because videos have their own ceiling.
    expect(refuseUpload(RULES, { role: "owner", mime: "video/mp4", bytes: 1001 })).toBeNull();
  });

  it("refuses an empty file", () => {
    expect(refuseUpload(RULES, { role: "member", mime: "image/jpeg", bytes: 0 })).toBe("noFile");
  });
});

describe("needsAlt", () => {
  it("is true for images and false for everything else", () => {
    expect(needsAlt("image")).toBe(true);
    for (const kind of MEDIA_KINDS.filter((k) => k !== "image")) {
      // A PDF has no alternative text, and demanding one produces the thing
      // accessibility rules exist to prevent: a field filled in with "file".
      expect(needsAlt(kind)).toBe(false);
    }
  });
});

describe("storageKey", () => {
  const createdAt = new Date("2026-03-09T10:00:00Z");

  it("says whose object it is, what it is for, and when it arrived", () => {
    // The kind used to be the whole prefix, and the OWNER was nowhere: in a
    // bucket of fifty thousand objects an avatar and a lesson cover were both
    // `image/…`, so nobody could read their own bucket and a lifecycle rule
    // scoped to one subsystem could not be written at all.
    expect(
      storageKey({
        id: "abc",
        namespace: "community",
        category: "profile",
        mime: "image/png",
        createdAt,
      }),
    ).toBe("community/profile/2026/03/abc.png");
  });

  it("pads the month, so the prefixes sort", () => {
    expect(
      storageKey({
        id: "x",
        namespace: "courses",
        category: "worksheet",
        mime: "application/pdf",
        createdAt: new Date("2026-11-01T00:00:00Z"),
      }),
    ).toBe("courses/worksheet/2026/11/x.pdf");
  });

  it("falls back to .bin rather than inventing an extension", () => {
    expect(
      storageKey({
        id: "x",
        namespace: "core",
        category: "upload",
        mime: "application/whatever",
        createdAt,
      }),
    ).toBe("core/upload/2026/03/x.bin");
  });

  it("takes the month from UTC, so two nodes in two zones agree", () => {
    // 23:30 on the 31st in Berlin is still the 31st in UTC; an hour later it is
    // the 1st. A key that depends on the host's clock zone is a key the other
    // node cannot compute.
    const newYear = new Date("2026-12-31T23:30:00Z");
    expect(
      storageKey({
        id: "x",
        namespace: "core",
        category: "generated",
        mime: "image/png",
        createdAt: newYear,
      }),
    ).toBe("core/generated/2026/12/x.png");
  });
});

describe("storageKey refuses a slot it cannot honour", () => {
  // ── What this catches ──────────────────────────────────────────────────
  // The two segments are the only part of a key that comes from the caller,
  // and the key is a filesystem path on the local driver and a signed URL's
  // path online. So the refusals here are the reason the "derived, never
  // supplied" rule survives having an opening in it at all.
  //
  // Every one of them THROWS rather than falling back, and the throw is a plain
  // `Error` rather than a `MediaError`: a namespace never comes from customer
  // input, so there is nobody to show a sentence to and a silent fallback would
  // put objects where nobody looks.
  const createdAt = new Date("2026-03-09T10:00:00Z");
  const key = (namespace: string, category: string) =>
    storageKey({ id: "abc", namespace, category, mime: "image/png", createdAt });

  it("refuses every reserved namespace", () => {
    // Non-vacuous by construction: the loop IS the constant, so a name dropped
    // from it stops being checked here AND stops being refused there.
    expect(RESERVED_MEDIA_NAMESPACES.length).toBeGreaterThanOrEqual(4);
    for (const reserved of RESERVED_MEDIA_NAMESPACES) {
      expect(() => key(reserved, "upload"), reserved).toThrow();
    }
  });

  it("names who holds it, for the ones the grammar would otherwise admit", () => {
    // ⚠️ **Two refusals, and one of the four never reaches the second.**
    // `.media-check` is not a usable path segment at all, so it is turned away
    // by the grammar and its message says so rather than naming an owner. That
    // is stated here rather than papered over: the assertion above is what
    // guarantees all four are refused, and this is what guarantees the ones a
    // caller could plausibly type get the message that explains why.
    for (const reserved of RESERVED_MEDIA_NAMESPACES.filter((n) => /^[a-z][a-z0-9-]*$/.test(n))) {
      expect(() => key(reserved, "upload"), reserved).toThrow(/reserved media namespace/);
    }
    expect(() => key(".media-check", "upload")).toThrow(/not a usable path segment/);
  });

  it("does not refuse a reserved word as a CATEGORY", () => {
    // Deliberate, and the asymmetry is the point: `core/pending/…` does not
    // begin with the sweep's prefix, so it collides with nothing. Refusing it
    // would be a rule with no failure behind it, and those are the rules that
    // get relaxed later by somebody who cannot find the reason.
    expect(key("core", "pending")).toBe("core/pending/2026/03/abc.png");
  });

  it("refuses anything that is not a usable path segment, in either position", () => {
    for (const bad of [
      "",
      " ",
      "Core", // upper case — two providers disagree about the same key
      "core/upload", // a second prefix level smuggled through one field
      "../core", // the traversal the whole rule exists for
      "core.upload", // a dot, which the local driver reads as a file
      "1core", // must start with a letter
      "core_upload", // underscore is not in the grammar
      "cöre",
    ]) {
      expect(() => key(bad, "upload"), `namespace ${JSON.stringify(bad)}`).toThrow(
        /not a usable path segment/,
      );
      expect(() => key("core", bad), `category ${JSON.stringify(bad)}`).toThrow(
        /not a usable path segment/,
      );
    }
  });

  it("accepts a hyphen inside a segment, because module ids carry them", () => {
    expect(key("my-module", "cover-image")).toBe("my-module/cover-image/2026/03/abc.png");
  });
});

describe("safeFilename", () => {
  it("keeps an ordinary name", () => {
    expect(safeFilename("Rechnung 2026 (final).pdf", "pdf")).toBe("Rechnung 2026 (final).pdf");
  });

  it("strips what would break a Content-Disposition header", () => {
    // A quote or a newline in a header value is a header injection, and this
    // name came from whoever uploaded the file.
    expect(safeFilename('evil".pdf\r\nX-Bad: 1', "pdf")).not.toContain('"');
    expect(safeFilename('evil".pdf\r\nX-Bad: 1', "pdf")).not.toContain("\n");
    expect(safeFilename('evil".pdf\r\nX-Bad: 1', "pdf")).not.toContain("\r");
  });

  it("does not let a name climb out of anywhere", () => {
    expect(safeFilename("../../etc/passwd", "bin")).not.toContain("/");
    expect(safeFilename("..", "bin")).toBe("download.bin");
  });

  it("gives an empty name a real one", () => {
    // Otherwise the browser saves it under the URL's last segment, which is the
    // storage key this function exists to keep out of sight.
    expect(safeFilename("", "png")).toBe("download.png");
    expect(safeFilename("   ", "png")).toBe("download.png");
  });

  it("bounds the length", () => {
    expect(safeFilename("a".repeat(500), "pdf").length).toBeLessThanOrEqual(120);
  });
});

describe("servedThroughApp", () => {
  it("is true for subtitle text and nothing else", () => {
    // The one delivery exception: a <track> fetch is CORS-restricted and
    // cannot follow a redirect to the bucket, so VTT bytes come from the app.
    expect(servedThroughApp("text/vtt")).toBe(true);
    expect(servedThroughApp(" TEXT/VTT ")).toBe(true);
    for (const mime of ["video/mp4", "audio/mpeg", "application/pdf", "image/png", "text/plain"]) {
      expect(servedThroughApp(mime), mime).toBe(false);
    }
  });
});

describe("extensionFor", () => {
  it("labels a subtitle sidecar as .vtt", () => {
    expect(extensionFor("text/vtt")).toBe("vtt");
  });
});

describe("formatBytes", () => {
  it("reads like a size a person would say", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(10 * 1024 * 1024)).toBe("10 MB");
    expect(formatBytes(1536)).toBe("1.5 KB");
  });

  it("follows the locale, because a refusal is shown to a person", () => {
    expect(formatBytes(1536, "de")).toBe("1,5 KB");
  });
});

describe("the ceiling a Server Action upload really has", () => {
  // ── What this catches ──────────────────────────────────────────────────
  // The number in `next.config.ts` moving while a form still says the old one.
  // It is not a cosmetic disagreement: Next refuses an oversized body BEFORE
  // the action runs, so the difference between the two numbers is exactly the
  // band in which an operator gets an unhandled rejection instead of a
  // sentence. A constant nailed to the setting is the only way a form can
  // refuse the same thing the framework refuses.
  it("is the number next.config.ts sets, read from the file", () => {
    // Through `blankComments()`, like every source scan here — that file
    // EXPLAINS the limit at length, and a raw grep would happily pin the
    // constant to a number quoted in prose.
    const config = blankComments(
      readFileSync(join(process.cwd(), "next.config.ts"), "utf8"),
    );
    const match = /bodySizeLimit:\s*["'`](\d+)(mb|kb|b)["'`]/i.exec(config);

    expect(
      match,
      "next.config.ts no longer sets experimental.serverActions.bodySizeLimit. Either the " +
        "setting moved — in which case SERVER_ACTION_BODY_LIMIT_BYTES is now describing " +
        "nothing — or Next's 1 MB default is back, which is below every kind in " +
        "config/media.json.",
    ).not.toBeNull();

    const units: Record<string, number> = { b: 1, kb: 1024, mb: 1024 * 1024 };
    const configured = Number(match![1]) * units[match![2].toLowerCase()];

    expect(
      configured,
      `next.config.ts allows ${configured} bytes through a Server Action, ` +
        `SERVER_ACTION_BODY_LIMIT_BYTES says ${SERVER_ACTION_BODY_LIMIT_BYTES}. Whichever is ` +
        `wrong, a form built on the constant now refuses a file Next would have taken, or ` +
        `offers one it will drop with no message anybody can catch.`,
    ).toBe(SERVER_ACTION_BODY_LIMIT_BYTES);
  });

  it("takes the LOWER of the two ceilings — which for a 50 MB kind is not the kind's", () => {
    // The finding this function exists for: `config/media.json` caps `audio`
    // and `file` at 50 MB, and 50 MB never arrives at a Server Action.
    expect(slotCeilingBytes(52_428_800)).toBe(SERVER_ACTION_BODY_LIMIT_BYTES);
    // …and where the kind is already the narrower one, the kind still wins.
    expect(slotCeilingBytes(1_000)).toBe(1_000);
    expect(slotCeilingBytes(SERVER_ACTION_BODY_LIMIT_BYTES)).toBe(SERVER_ACTION_BODY_LIMIT_BYTES);
  });

  it("🚨 is NOT the ceiling a route handler has — that is a third number", () => {
    // The two are not interchangeable and were treated as such for one commit.
    // `bodySizeLimit` is a Server Action setting; a route handler never sees
    // it, so `slotCeilingBytes()` at `handleUpload()` refused a 30 MB recording
    // the HTTP API had accepted since the day it existed. What that door can do
    // is `routeCeilingBytes()`, and the gap between them is the capability.
    expect(ROUTE_HANDLER_BODY_LIMIT_BYTES).toBeGreaterThan(SERVER_ACTION_BODY_LIMIT_BYTES);
    expect(routeCeilingBytes(52_428_800)).toBe(52_428_800);
    // …and it is still a ceiling: a kind raised for the direct-to-bucket path
    // must not become a promise this door cannot keep, because
    // `request.formData()` buffers the whole body before anything is checked.
    expect(routeCeilingBytes(2 * 1024 * 1024 * 1024)).toBe(ROUTE_HANDLER_BODY_LIMIT_BYTES);
    expect(routeCeilingBytes(1_000)).toBe(1_000);
  });
});

describe("the two key spaces of the direct path never meet", () => {
  // ── What this catches ──────────────────────────────────────────────────
  // The sweep for abandoned uploads selects on `expiresAt` alone and removes
  // the object its ticket row names. That is only safe while a ticket's key can
  // never be a delivered item's key — otherwise an expired ticket that survived
  // its own confirm comes back an hour later and removes the bytes of a LIVE
  // `media` row, counted as a successful clean-up, with nothing logged.
  //
  // It is also what makes the confirm step's checks a promise rather than a
  // measurement of one moment: the address the browser holds stays writable
  // until it expires, and after the copy it addresses this prefix.
  // ── And it is now asserted over SLOTS, not over kinds ────────────────────
  //
  // The kinds used to be the delivery prefixes, so iterating `MEDIA_KINDS` was
  // iterating the whole key space. Since a key begins with a namespace and a
  // category, the thing to iterate is the pairs — and the pairs are declared
  // HERE rather than in `rules.ts`, because the shipped ones include two
  // modules' and the core may not carry a list of its modules' names
  // (`modules/boundary.test.ts` §1).
  //
  // ⚠️ **The list is a sample, not the whole space** — a module added tomorrow
  // with a slot nobody adds here is not covered by the loop. What IS covered
  // for every pair that will ever exist is the refusal itself, asserted in
  // "storageKey refuses a slot it cannot honour" above: `pending` is a
  // namespace `storageKey()` cannot be talked into. This loop is what proves
  // that refusal is the thing standing between the two key spaces, on the
  // pairs actually shipped.
  const SHIPPED_SLOTS = [
    { namespace: "core", category: "upload", owner: "the generic HTTP door" },
    { namespace: "core", category: "setup", owner: "the setup surface's media_upload tool" },
    { namespace: "core", category: "generated", owner: "generateImage()" },
    { namespace: "community", category: "profile", owner: "the community module's avatar" },
    // ⚠️ Added 2026-08-15, and its absence is the argument. Story 26.1's own
    // record names this list as a SAMPLE of the key space and warns that "a
    // module contributing a slot nobody enters here is not in the loop" — and
    // Story 26.2 then contributed exactly that (`POST_IMAGE_SLOT`), while
    // `toBeGreaterThanOrEqual(8)` stayed green. A hand-kept list of what ships
    // is the same shape as the hand-kept module-command list that silently
    // skipped both `courses-*` commands for as long as they existed.
    { namespace: "community", category: "post", owner: "the community module's post image" },
    { namespace: "courses", category: "cover", owner: "the courses module's lesson cover" },
    { namespace: "courses", category: "video", owner: "the courses module's recording" },
    { namespace: "courses", category: "subtitle", owner: "the courses module's VTT" },
    { namespace: "courses", category: "worksheet", owner: "the courses module's handout" },
  ] as const;

  it("a staging key is prefixed, a delivery key never is", () => {
    const createdAt = new Date("2026-08-10T00:00:00Z");
    const staged = stagingKey({ id: "abc", mime: "video/mp4", createdAt });
    const delivered = storageKey({
      id: "abc",
      namespace: "courses",
      category: "video",
      mime: "video/mp4",
      createdAt,
    });

    // 🚨 Byte-identical to what it produced before the namespaces existed. The
    // staging prefix did NOT move, and this line is the assertion of that.
    expect(staged).toBe("pending/2026/08/abc.mp4");
    expect(delivered).toBe("courses/video/2026/08/abc.mp4");
    expect(staged).not.toBe(delivered);

    // Non-vacuity for the loop below: an empty list would report the whole key
    // space as disjoint from the sweep's prefix by finding nothing at all.
    expect(SHIPPED_SLOTS.length).toBeGreaterThanOrEqual(9);

    for (const { namespace, category, owner } of SHIPPED_SLOTS) {
      expect(
        storageKey({ id: "abc", namespace, category, mime: "video/mp4", createdAt }).startsWith(
          "pending/",
        ),
        `storageKey() can produce a key on the sweep's prefix for ${namespace}/${category} ` +
          `(${owner}) — the sweep would then be able to remove a delivered item's object at ` +
          `the ticket's expiry`,
      ).toBe(false);
    }
  });

  it("🚨 and the loop is red the moment a slot could reach that prefix", () => {
    // The non-vacuity AC 2 asks for, as an assertion rather than as a note in a
    // commit message. Adding `{ namespace: "pending" }` to the list above turns
    // the loop red — not because the `startsWith` catches it, but because
    // `storageKey()` refuses to build it at all. Both directions are stated, so
    // neither can be relaxed without the other failing:
    expect(() =>
      storageKey({
        id: "abc",
        namespace: "pending",
        category: "upload",
        mime: "video/mp4",
        createdAt: new Date("2026-08-10T00:00:00Z"),
      }),
    ).toThrow(/reserved media namespace/);
    // …and `pending` really is in the list that refusal reads from, so the
    // refusal above cannot be satisfied by some other rule.
    expect(RESERVED_MEDIA_NAMESPACES).toContain("pending");
    // …and `stagingKey()` really does use that prefix, so the two halves are
    // talking about the same string.
    expect(
      stagingKey({ id: "abc", mime: "video/mp4", createdAt: new Date("2026-08-10T00:00:00Z") }),
    ).toMatch(/^pending\//);
  });
});

describe("safeFilename keeps a usable extension", () => {
  it("does not treat a trailing dot as one", () => {
    // The guard was `dot > 0 && cleaned.length - dot <= 12`, which a name
    // ending in a bare dot satisfies: `ext` became "." and the fallback was
    // never applied, producing 120 characters with nothing to open. Not
    // contrived — the sanitiser strips quotes, so `…report."` arrives here as
    // `…report.`.
    const out = safeFilename(`${"a".repeat(200)}.`, "pdf");
    expect(out.length).toBeLessThanOrEqual(120);
    expect(out.endsWith(".pdf")).toBe(true);
  });

  it("keeps a real extension when it shortens the stem", () => {
    expect(safeFilename(`${"a".repeat(200)}.pdf`, "bin").endsWith(".pdf")).toBe(true);
  });
});

// ── The fourth visibility, and the argument it had to answer ───────────────
//
// `lib/media/rules.ts` carries a standing warning above `MEDIA_VISIBILITIES`:
// "a fourth shape is almost always one of these three with a different
// question attached". Story 19.4 added `members` anyway, so the burden was to
// show that each of the three fails, and fails DIFFERENTLY, against the actual
// requirement (FR-185: a profile picture is visible to signed-in members,
// never anonymously, never indexed).
//
// These are those three proofs as tests rather than as prose. They exist so
// the argument stays CHECKED rather than remembered — and so that a future
// story proposing a fifth visibility finds a worked example of the bar it has
// to clear.
describe("which visibilities make an item the member's own", () => {
  // This constant decides two things that must never disagree: what account
  // deletion sweeps, and what a subject access request discloses. Story 19.4
  // needed both to grow — a `members`-visible avatar is as personal as an
  // `owner`-visible upload — and before the constant existed they were two
  // separate `eq(visibility, "owner")` clauses in two files.
  it("covers what the person uploaded and the face they showed", () => {
    expect([...OWNED_MEDIA_VISIBILITIES].sort()).toEqual(["members", "owner"]);
  });

  it("leaves the PRODUCT's own imagery out", () => {
    // The reasoning that survived the addition: an operator's lesson cover
    // carries their id too, and deleting their account must not take the app's
    // pictures with it. The line is whose DATA it is, not who uploaded it.
    expect(OWNED_MEDIA_VISIBILITIES).not.toContain("public");
    expect(OWNED_MEDIA_VISIBILITIES).not.toContain("entitled");
  });

  it("names only real visibilities", () => {
    // Non-vacuity, and a guard against a typo that would silently sweep
    // nothing: a value not in the enum matches no row and no test would say so.
    for (const visibility of OWNED_MEDIA_VISIBILITIES) {
      expect(MEDIA_VISIBILITIES).toContain(visibility);
      expect(isMediaVisibility(visibility)).toBe(true);
    }
  });
});

// ── The narrower copies of a picture ───────────────────────────────────────
//
// Two pure decisions, and both of them can be wrong in a way nothing else in
// the app would notice:
//
//   1. WHICH widths are worth deriving. An "upscale" is the same bytes made
//      larger and blurrier, costing storage to serve a worse picture than the
//      original — and a `<=` where a `<` belongs produces exactly that for
//      every picture whose width happens to equal a target.
//   2. WHERE a copy is stored. A key that is not a sibling of the delivery key
//      puts the copies somewhere a lifecycle rule scoped to the subsystem does
//      not reach, which is the whole reason `storageKey()` has a grammar at
//      all — and the copies would then be unreachable by any operator looking
//      at their own bucket.
describe("variantWidthsFor downscales and never up", () => {
  it("offers every width narrower than the original", () => {
    expect(variantWidthsFor(4000)).toEqual([480, 960, 1440]);
    expect(variantWidthsFor(1000)).toEqual([480, 960]);
    expect(variantWidthsFor(500)).toEqual([480]);
  });

  it("offers nothing for a picture already at or below the narrowest", () => {
    expect(variantWidthsFor(480)).toEqual([]);
    expect(variantWidthsFor(200)).toEqual([]);
  });

  it("🚨 excludes a width EQUAL to the original — it already is that copy", () => {
    // The `<` versus `<=` line. With `<=`, a picture exactly 960 px wide would
    // get a "960 variant" that is a byte-for-byte re-encode of itself: an extra
    // object, an extra address, an extra removal on deletion, and no smaller
    // download for anybody.
    for (const width of MEDIA_VARIANT_WIDTHS) {
      expect(variantWidthsFor(width)).not.toContain(width);
    }
  });

  it("answers nothing for a width nobody could measure", () => {
    // `sharp` answers `undefined` for a format it opened but cannot describe,
    // and the caller turns that into `null` rather than `0`. A `0` reaching here
    // must not produce three upscales.
    expect(variantWidthsFor(0)).toEqual([]);
    expect(variantWidthsFor(-1)).toEqual([]);
    expect(variantWidthsFor(Number.NaN)).toEqual([]);
  });
});

describe("variantKey is a SIBLING of the delivery key", () => {
  const DELIVERY = "community/post/2026/08/2f1c-aaaa.jpg";

  it("keeps the folder and the extension, and marks the width", () => {
    expect(variantKey(DELIVERY, 960)).toBe("community/post/2026/08/2f1c-aaaa-w960.jpg");
    // Same prefix, so one lifecycle rule on `community/post/` reaches every copy.
    expect(variantKey(DELIVERY, 480).startsWith("community/post/2026/08/")).toBe(true);
    expect(variantKey(DELIVERY, 480).endsWith(".jpg")).toBe(true);
  });

  it("cannot collide with the key it was derived from, or with another width", () => {
    const keys = new Set([DELIVERY, ...MEDIA_VARIANT_WIDTHS.map((w) => variantKey(DELIVERY, w))]);
    expect(keys.size).toBe(MEDIA_VARIANT_WIDTHS.length + 1);
  });

  it("still produces a sibling for a key from before the grammar", () => {
    // A bucket that predates `storageKey()`'s namespace/category form holds
    // legacy keys, and `db/schema-media.ts` says that is safe rather than
    // tolerated: nothing derives a key from a row's other columns. This has to
    // keep working on one, or an old picture's variants would land at top level.
    expect(variantKey("image/abc.png", 480)).toBe("image/abc-w480.png");
    // A key with no extension at all — the marker goes at the end.
    expect(variantKey("image/abc", 480)).toBe("image/abc-w480");
    // A dot in a FOLDER name is not an extension.
    expect(variantKey(".media-check/probe", 480)).toBe(".media-check/probe-w480");
  });

  it("🚨 refuses a key that is already a variant", () => {
    // A copy of a copy, and the caller that produced it has lost track of which
    // key it holds. `…-w480-w960.jpg` would also be removed by nothing:
    // `media.variants` names widths against the DELIVERY key.
    expect(() => variantKey(variantKey(DELIVERY, 480), 960)).toThrow(/already a variant/);
  });

  it("🚨 refuses a width that is not a pixel count", () => {
    // Same discipline as `storageKey()`, and the same reason it is a plain
    // `Error` rather than a `MediaError`: neither argument can come from
    // customer input, so a bad one is a programming error and the only useful
    // answer is a diagnostic naming the value.
    for (const width of [0, -480, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => variantKey(DELIVERY, width)).toThrow(/not a pixel count/);
    }
  });
});
