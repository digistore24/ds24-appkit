// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Two claims about picking a file, and neither can be made by a behavioural
// test.
//
//   1. **There is exactly ONE raw `type="file"` in this app**, and it is the
//      one below this file's name. A door built by hand is a door with its own
//      reset, its own `accept`, its own idea of what "too large" means and — on
//      the direct path — its own idea of whether the bytes travel in the form.
//      There were two, and they had already drifted: one refused an oversized
//      file and named the number, the other did neither.
//   2. **The markup the component really produces**, for the handful of
//      properties a caller depends on: the composed `accept`, the kit's file
//      classes, `disabled` passed through, the hint rendered, `children` in the
//      same block, and — with `direct` set — a hidden field for the handle.
//
// 🚨 **The scan goes through `blankComments()`, never a regex of its own.** A
// checker that greps source punishes a file for explaining itself, and this
// story writes several files that explain exactly this rule — the component's
// own header, `media-slots.tsx`'s, `profile-ui.tsx`'s. `CLAUDE.md` names the
// failure ("A checker that reads source as TEXT goes through blankComments()")
// and `scripts/lib/source-text.mjs` carries the measured post-mortem.
//
// ⚠️ **`useEffect` does not run here.** vitest runs with `environment: "node"`
// and this repo has no DOM (`media-player.test.ts` says so for its own case), so
// `renderToStaticMarkup` sees the first render and nothing after it. The reset
// and the three-step upload are therefore proved in a browser, and the story's
// red-probe table says which observation counts.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { blankComments } from "@/scripts/lib/source-text.mjs";
import { MediaUpload, MEDIA_UPLOAD_FILE_CLASSES, type MediaUploadProps } from "./media-upload";

const ROOT = process.cwd();

/** The one file allowed to hold a raw file input. */
const THE_DOOR = "components/ui/media-upload.tsx";

/** Where a hand-built field could plausibly appear. */
const SEARCHED = ["components", "app", "lib", "modules"];

/** The needle, spelled once so the probes below cannot drift from the scan. */
const RAW_FILE_INPUT = /type=["']file["']/;

interface Hit {
  file: string;
  line: number;
}

/**
 * The whole guard, with an optional file that is not on disk.
 *
 * 🚨 **`extra` is what makes the needle probe a probe.** Planting a string and
 * running the regex over it by hand re-implements the line loop and measures
 * the copy: the walk, the extension filter, the `.test.` exclusion, the path
 * normalisation, `blankComments()` and the `hits` accumulation would all be
 * untouched, and any of them breaking would leave the tree "clean" for ever.
 * The planted source goes through the SAME loop as a real file instead —
 * `modules/courses/admin/guard.test.ts:116` is the shipped precedent.
 */
function scan(extra: { file: string; source: string }[] = []): { files: string[]; hits: Hit[] } {
  const files: string[] = [];
  const hits: Hit[] = [];

  const read = (normalised: string, contents: string) => {
    files.push(normalised);
    const source = blankComments(contents);
    source.split(/\r?\n/).forEach((text, index) => {
      if (RAW_FILE_INPUT.test(text)) hits.push({ file: normalised, line: index + 1 });
    });
  };

  const walk = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(join(ROOT, dir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const rel = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        walk(rel);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name) || entry.name.includes(".test.")) continue;
      const normalised = rel.split(/[\\/]/).join("/");
      read(normalised, readFileSync(join(ROOT, rel), "utf8"));
    }
  };

  for (const dir of SEARCHED) walk(dir);
  for (const planted of extra) read(planted.file, planted.source);
  return { files, hits };
}

describe("one door, and it is components/ui/media-upload.tsx", () => {
  const { files, hits } = scan();

  it("the walk is not empty, and it found the legitimate door", () => {
    // Non-vacuity. An empty hit list over an empty file list is green and
    // proves nothing — "green because it checked" and "green because it
    // scanned nothing" are the same colour.
    expect(files.length, "the scanner read no files at all").toBeGreaterThan(200);
    // 🚨 And PER DIRECTORY, because the total cannot tell them apart. `app` and
    // `lib` alone clear 200, so a `modules/` that moved or was renamed would
    // leave this green while the sweep silently covered three quarters of the
    // tree — which is a failure this repo has already had ("a module move
    // breaks name-based readers").
    for (const dir of SEARCHED) {
      expect(
        files.filter((file) => file.startsWith(`${dir}/`)).length,
        `the scanner read nothing under ${dir}/ — either it moved or the walk stopped ` +
          `reaching it, and every claim below is vacuous for that quarter of the tree`,
      ).toBeGreaterThan(10);
    }
    expect(files).toContain(THE_DOOR);
    expect(
      hits.map((hit) => hit.file),
      `${THE_DOOR} no longer holds a file input — either the component stopped ` +
        `being one, or the scan stopped reading it. Both make every claim below vacuous.`,
    ).toContain(THE_DOOR);
  });

  it("🚨 no other file in the app holds a raw file input", () => {
    const strays = hits.filter((hit) => hit.file !== THE_DOOR);
    expect(
      strays.map((hit) => `${hit.file}:${hit.line}`),
      `a hand-built file field. Render <MediaUpload> from @/components/ui/media-upload ` +
        `instead — it carries the reset, the composed accept, the size refusal and, with ` +
        `\`direct\`, the three-step upload, so a second copy is a second set of all four:\n` +
        strays.map((hit) => `${hit.file}:${hit.line}`).join("\n"),
    ).toEqual([]);
  });

  it("🚨 a planted second door is reported, with its line", () => {
    // The needle probe, and it goes through the REAL scan — see `scan()`'s own
    // header. A scanner that had stopped matching would report the tree as
    // clean for ever, and nobody would learn that from a green run.
    const planted = scan([
      {
        file: "modules/nowhere/planted.tsx",
        source: ["const x = 1;", "", '<input type="file" name="sneaky" />', ""].join("\n"),
      },
    ]);
    expect(planted.files).toContain("modules/nowhere/planted.tsx");
    expect(
      planted.hits.filter((hit) => hit.file !== THE_DOOR).map((hit) => `${hit.file}:${hit.line}`),
    ).toEqual(["modules/nowhere/planted.tsx:3"]);
  });

  it("🚨 a comment can neither create nor hide a finding", () => {
    // What `blankComments()` is for, measured through the scan rather than
    // beside it. Every file this rule touches explains it in prose, and a
    // scanner that read prose would report each of them.
    const commented = scan([
      {
        file: "modules/nowhere/explains.tsx",
        source: [
          '// never write type="file" by hand',
          '/* type="file" belongs in one place */',
          "const x = 1;",
        ].join("\n"),
      },
      {
        // And it must still see the real thing on the same line as a comment.
        file: "modules/nowhere/both.tsx",
        source: '<input type="file" /> // the one door\n',
      },
    ]);
    expect(commented.hits.map((hit) => hit.file)).not.toContain("modules/nowhere/explains.tsx");
    expect(commented.hits.map((hit) => `${hit.file}:${hit.line}`)).toContain(
      "modules/nowhere/both.tsx:1",
    );
  });
});

function render(props: Partial<MediaUploadProps> = {}): string {
  return renderToStaticMarkup(
    createElement(MediaUpload, {
      id: "slot-video",
      name: "file",
      label: "Video",
      mimeTypes: ["video/mp4", "video/webm"],
      ceilingBytes: 10_485_760,
      tooLarge: (bytes: number) => `too large: ${bytes}`,
      ...props,
    } as MediaUploadProps),
  );
}

describe("the markup MediaUpload really produces", () => {
  it("composes accept from the media types alone", () => {
    expect(render()).toContain('accept="video/mp4,video/webm"');
  });

  it("composes accept from the media types AND the extensions", () => {
    // The subtitle case. Without the extension a Windows file picker filtering
    // on `text/vtt` shows an empty folder, because many machines have no
    // registry entry for it.
    const html = render({ mimeTypes: ["text/vtt"], extensions: [".vtt"] });
    expect(html).toContain('accept="text/vtt,.vtt"');
  });

  it("carries the kit's file-button classes, as one literal", () => {
    // It was two byte-identical copies in two modules. If this fails, one of
    // them has come back or the literal has been rewritten by hand.
    expect(render()).toContain(MEDIA_UPLOAD_FILE_CLASSES);
  });

  it("passes disabled through to the input", () => {
    // `disabled=""` and not `disabled=`: the kit's own class list carries
    // `group-data-[disabled=true]` and `disabled:opacity-50`, so the looser
    // needle is true whatever the prop says.
    expect(render({ disabled: true })).toContain('disabled=""');
    expect(render({ disabled: false })).not.toContain('disabled=""');
  });

  it("renders the hint permanently, under the field", () => {
    const html = render({ hint: "Takes MP4 or WebM. At most 10 MB." });
    expect(html).toContain("Takes MP4 or WebM. At most 10 MB.");
    expect(html.indexOf('type="file"')).toBeLessThan(html.indexOf("Takes MP4"));
  });

  it("🚨 ties the hint to the field, so the number is not merely nearby", () => {
    // A loose sibling is invisible to somebody arriving by keyboard: they hear
    // "Video, choose file" and nothing of the limit the sentence is explaining.
    const html = render({ hint: "At most 10 MB." });
    expect(html).toContain('id="slot-video-hint"');
    expect(html).toContain('aria-describedby="slot-video-hint"');
  });

  it("names no hint it has not rendered", () => {
    expect(render()).not.toContain("aria-describedby");
  });

  it("renders children in the same block, under the field", () => {
    // A cover's alternative-text field lives here.
    const html = render({ children: createElement("span", null, "alt-text-field") });
    expect(html).toContain("alt-text-field");
    expect(html.indexOf('type="file"')).toBeLessThan(html.indexOf("alt-text-field"));
  });

  it("shows no refusal and no progress before anything has been picked", () => {
    const html = render();
    expect(html).not.toContain("too large");
    expect(html).not.toContain("progressbar");
  });

  it("🚨 without `direct`, the input carries the form field name", () => {
    expect(render()).toContain('name="file"');
  });

  it("🚨 with `direct`, the form carries a hidden handle and NOT the bytes", () => {
    // The whole point of the direct path: the file input loses its name, so a
    // two-gigabyte video never enters a Server Action body, and a hidden field
    // carries the id of the row the confirm step wrote.
    const html = render({
      direct: {
        mint: async () => ({ ok: true, ticketId: "t", url: "u" }),
        confirm: async () => ({ ok: true, handle: "m" }),
        handleName: "videoMediaId",
        progress: (percent: number) => `${percent}%`,
        ready: "ready",
        transportFailed: "no",
      },
    });
    expect(html).toContain('type="hidden"');
    expect(html).toContain('name="videoMediaId"');
    // The file input is nameless, so the browser posts nothing for it.
    expect(html).not.toContain('name="file"');
  });
});
