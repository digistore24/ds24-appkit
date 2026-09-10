// Copyright (c) 2026 Digistore24 Inc, SPDX-License-Identifier: MIT

// Who owns a product in the vendor's Digistore24 account.
//
// Everything destructive in `ds24-sync` reads these functions first, so the
// tests that matter here are the REFUSALS: a product nobody stamped, a product
// stamped by a different app, a product of a different environment, and an API
// answer that carries no notes at all. Each of them has to come back as "not
// ours" or "cannot tell" — never as an orphan, because an orphan is a delete.
import { describe, expect, it } from "vitest";

import {
  stampFor,
  parseStamp,
  noteWith,
  noteOf,
  canClassify,
  ownershipOf,
  orphanProducts,
  NOTE_MAX,
  tagWith,
  tagOf,
  PRODUCT_TAG_MAX,
  PRODUCT_TAG,
} from "./_own.mjs";

const APP = "a1b2c3d4e5f6";
const stamp = (over: Record<string, string> = {}) =>
  stampFor({ syncId: APP, env: "prod", ...over });

/** What listProducts hands back, reduced to the fields ownership reads. */
function ds24(
  product_id: string,
  note: string | undefined,
  name_intern = "silber__de__prod",
) {
  return { product_id, note, name_intern, name: "Silber" };
}

describe("the stamp", () => {
  it("round-trips through a note", () => {
    expect(parseStamp(stamp())).toEqual({ version: 1, app: APP, env: "prod" });
  });

  it("🚨 FITS in what Digistore24 keeps of the note field", () => {
    // Measured against a live account on 2026-09-09: `data[note]` keeps 47
    // characters and drops the rest, mid-word, with no error and nothing in
    // the documentation. A stamp one character too long is not a shorter
    // stamp — it does not parse, so every product this app created reads as
    // somebody else's and `--prune` finds nothing while reporting that it
    // looked. This assertion is the only thing standing between that and a
    // future edit that makes the stamp "more readable".
    for (const env of ["dev", "staging", "prod"]) {
      const s = stampFor({ syncId: "ffffffffffff", env });
      expect(s.length, `${s} is ${s.length} chars`).toBeLessThanOrEqual(NOTE_MAX);
      expect(parseStamp(s.slice(0, NOTE_MAX))).not.toBeNull();
    }
  });

  it("is found between lines, for a note that grew one later", () => {
    const note = `Rechnung an Buchhaltung\n${stamp()}`;
    expect(parseStamp(note)?.app).toBe(APP);
  });

  it("🚨 refuses to write over text somebody else put there", () => {
    // At 47 characters there is no merging, so the choice is whose field this
    // is. `null` means "leave it alone" — that product then stays unstamped
    // and un-prunable, which is the safe direction.
    expect(noteWith("Ansprechpartner: Support", stamp())).toBeNull();
  });

  it("🚨 replaces a stamp of ours that the 47-character cut broke", () => {
    // Measured on a live account: an earlier, longer format came back as
    // "ds24-appkit:1 app=… key=zztest_membe" — ours, unparseable. Under a
    // rule that only recognises what parses, that product could never be
    // re-stamped and would read as somebody else's for ever. A marker we
    // cannot fix is worse than one we cannot read.
    const broken = "ds24-appkit:1 app=d0b100315daa key=zztest_membe";
    expect(parseStamp(broken)).toBeNull();
    expect(noteWith(broken, stamp())).toBe(stamp());
  });

  it("takes an empty note, and replaces its own", () => {
    expect(noteWith(null, stamp())).toBe(stamp());
    expect(noteWith("", stamp())).toBe(stamp());
    expect(noteWith("   ", stamp())).toBe(stamp());
    expect(noteWith(stamp({ env: "dev" }), stamp())).toBe(stamp());
  });

  it("does not grow a blank line per sync", () => {
    let note: string | null = stamp();
    for (let i = 0; i < 5; i++) note = noteWith(note, stamp());
    expect(note).toBe(stamp());
  });

  it("reads a note that was never stamped as unstamped, not as broken", () => {
    expect(parseStamp("nur eine Notiz vom Vendor")).toBeNull();
    expect(parseStamp(undefined)).toBeNull();
    expect(noteOf({ product_id: "1" })).toBeNull();
  });
});

describe("canClassify — the comparison has to have RUN", () => {
  it("is false when Digistore24 sent no note field at all", () => {
    // Zero orphans out of this list would be silence, not an answer.
    expect(canClassify([{ product_id: "1" }, { product_id: "2" }])).toBe(false);
  });

  it("is true as soon as the field travels, even empty", () => {
    expect(canClassify([{ product_id: "1", note: "" }])).toBe(true);
  });
});

describe("ownershipOf — three grades", () => {
  const ctx = {
    syncId: APP,
    env: "prod",
    registryIds: new Set(["999"]),
    internalNames: new Set(["silber__de__prod"]),
  };

  it("calls our own stamp certain", () => {
    expect(ownershipOf(ds24("111", stamp()), ctx)).toBe("certain");
  });

  it("calls another app's stamp foreign — same template, same names", () => {
    const other = stampFor({ syncId: "ffffffffffff", env: "prod" });
    // name_intern matches ours, which is exactly the collision the random
    // syncId exists for: two apps built from this template call their first
    // plan the same thing.
    expect(ownershipOf(ds24("111", other), ctx)).toBe("probable");
  });

  it("calls another ENVIRONMENT's stamp not-certain", () => {
    const dev = stamp({ env: "dev" });
    expect(ownershipOf(ds24("111", dev, "silber__de__dev"), ctx)).toBe("foreign");
  });

  it("reads the key and the language off name_intern, not off the stamp", () => {
    // The stamp has no room for them. `name_intern` is ours by construction
    // once the stamp matched — it is what `_env.mjs` wrote.
    const orphans = orphanProducts([ds24("222", stamp())], {
      syncId: APP,
      env: "prod",
      keepIds: new Set(),
    });
    expect(orphans[0]).toMatchObject({ key: "silber", language: "de" });
  });

  it("calls an unstamped product with a recorded id probable, never certain", () => {
    expect(ownershipOf(ds24("999", undefined, "etwas Fremdes"), ctx)).toBe(
      "probable",
    );
  });

  it("calls everything else foreign", () => {
    expect(ownershipOf(ds24("777", "Handnotiz", "hand-made"), ctx)).toBe(
      "foreign",
    );
  });
});

describe("orphanProducts — what --prune is allowed to see", () => {
  const keepIds = new Set(["111"]);

  it("finds a stamped product the registry no longer names", () => {
    const list = [ds24("111", stamp()), ds24("222", stamp())];
    const orphans = orphanProducts(list, { syncId: APP, env: "prod", keepIds });
    expect(orphans.map((o) => o.productId)).toEqual(["222"]);
  });

  it("never returns an unstamped product, however much it looks like ours", () => {
    const list = [ds24("333", undefined, "silber__de__prod")];
    expect(
      orphanProducts(list, { syncId: APP, env: "prod", keepIds }),
    ).toHaveLength(0);
  });

  it("never returns another environment's product", () => {
    const list = [ds24("444", stamp({ env: "dev" }))];
    expect(
      orphanProducts(list, { syncId: APP, env: "prod", keepIds }),
    ).toHaveLength(0);
  });

  it("never returns another app's product", () => {
    const list = [ds24("555", stampFor({ syncId: "0badc0ffee11", env: "prod" }))];
    expect(
      orphanProducts(list, { syncId: APP, env: "prod", keepIds }),
    ).toHaveLength(0);
  });

  it("keeps a PARKED product, because keepIds carries it", () => {
    // "sell": false takes an offering off the page, not out of the account —
    // and its id still has to reach the IPN connection so refunds arrive.
    const list = [ds24("666", stamp())];
    const parked = new Set(["666"]);
    expect(
      orphanProducts(list, { syncId: APP, env: "prod", keepIds: parked }),
    ).toHaveLength(0);
  });
});

describe("the tag — the coarse marker", () => {
  it("adds ours to an empty field", () => {
    expect(tagWith(null)).toBe(PRODUCT_TAG);
    expect(tagWith("")).toBe(PRODUCT_TAG);
    expect(tagWith("   ")).toBe(PRODUCT_TAG);
  });

  it("🚨 APPENDS, and never drops a tag the vendor put there", () => {
    // The field is a comma-separated list written whole, so writing just ours
    // would delete theirs — the same failure as the note field, one door up.
    expect(tagWith("sommer,bestseller")).toBe(`sommer,bestseller,${PRODUCT_TAG}`);
  });

  it("answers null when ours is already there — nothing to write", () => {
    expect(tagWith(PRODUCT_TAG)).toBeNull();
    expect(tagWith(`sommer,${PRODUCT_TAG},bestseller`)).toBeNull();
  });

  it("recognises it through the spacing and casing a human leaves", () => {
    expect(tagWith(` sommer , ${PRODUCT_TAG.toUpperCase()} `)).toBeNull();
  });

  it("reads the field off a product, or answers null", () => {
    expect(tagOf({ tag: "a,b" })).toBe("a,b");
    expect(tagOf({})).toBeNull();
  });

  it("understands a list that arrives as an ARRAY", () => {
    // The field is not live yet, so its shape on the way back is a guess. An
    // array is the likely other one.
    expect(tagWith(["sommer", "bestseller"])).toBe(`sommer,bestseller,${PRODUCT_TAG}`);
    expect(tagWith([PRODUCT_TAG])).toBeNull();
  });

  it("🚨 leaves a shape it does not understand ALONE", () => {
    // The costly guess would be "not a string means nothing is there" — that
    // writes our tag over whatever the vendor had. Unknown shape, hands off.
    expect(tagWith({ some: "object" })).toBeNull();
    expect(tagWith([1, 2])).toBeNull();
    expect(tagWith(42)).toBeNull();
  });

  it("🚨 refuses to exceed the documented 127 characters", () => {
    // The spec says `maxLength: 127` and does not say what happens above it —
    // refused, or truncated. Both are bad for the vendor: a refusal turns the
    // sync's fallback sentence ("this account does not know data[tag] yet")
    // into a false one, and a truncation cuts tags this app never wrote. So the
    // answer is `null`: their tags stay whole and ours is simply absent. The
    // tag is not an ownership proof, so that costs nothing.
    const room = PRODUCT_TAG_MAX - PRODUCT_TAG.length - 1; // -1 for the comma
    const fits = "x".repeat(room);
    expect(tagWith(fits)).toBe(`${fits},${PRODUCT_TAG}`);
    expect(tagWith(`${fits}x`)).toBeNull();
  });

  it("counts the SANITIZED length, the way Digistore24 does", () => {
    // "The length limit applies to the sanitized value" — the stripped
    // characters are gone before the count. A value that is too long only
    // because of characters the API removes must still go through, or this
    // refuses for a reason the API does not have.
    const room = PRODUCT_TAG_MAX - PRODUCT_TAG.length - 1;
    const withStripped = "x".repeat(room) + '<<<>>>&&&###';
    expect(withStripped.length).toBeGreaterThan(room);
    expect(tagWith(withStripped)).toBe(`${withStripped},${PRODUCT_TAG}`);
  });

  it("and an empty product still gets the tag, unless the tag itself is too long", () => {
    expect(tagWith(null)).toBe(PRODUCT_TAG);
    expect(tagWith(null, "y".repeat(PRODUCT_TAG_MAX))).toBe("y".repeat(PRODUCT_TAG_MAX));
    expect(tagWith(null, "y".repeat(PRODUCT_TAG_MAX + 1))).toBeNull();
  });

  it("is NOT what ownership is decided by", () => {
    // Two apps built from this template carry the same tag. If `--prune` read
    // it, one could delete the other's products. Ownership is the note stamp,
    // which carries the syncId — this asserts the tag is nowhere near it.
    const tagged = { product_id: "1", tag: PRODUCT_TAG, name_intern: "x__de__prod" };
    expect(
      orphanProducts([tagged], { syncId: APP, env: "prod", keepIds: new Set() }),
    ).toHaveLength(0);
  });
});
