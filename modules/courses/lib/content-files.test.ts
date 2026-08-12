// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The reader that turns a slug back into the file that claims it.
//
// The directory is BUILT rather than mocked — the walk is the subject, and a
// mocked `node:fs` would be a test of the mock. Same instrument the applier's
// own test uses on the same tree shape.
//
// What is worth measuring here is the two states the admin surface shows and
// nothing else does: a slug no file claims any more, and a file that will not
// parse. The second is the one with teeth — the applier THROWS on it, and a
// reader that inherited that behaviour would turn one broken file into a page
// the operator cannot open to find out which file it is.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { contentFileIndex } from "./content-files";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

/** A throwaway `content/course/`. Values that are strings are written verbatim. */
function contentDir(files: Record<string, unknown>) {
  const dir = mkdtempSync(join(tmpdir(), "ds24-course-files-"));
  dirs.push(dir);
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(dir, name), typeof body === "string" ? body : JSON.stringify(body));
  }
  return dir;
}

describe("an app with no course files", () => {
  it("answers empty maps for a directory that is not there", () => {
    // The normal state of a freshly installed module, and of every app that
    // never writes a course. Not a fault, so not an error — the same answer
    // `blockFiles()` in the applier gives.
    const index = contentFileIndex(join(tmpdir(), "ds24-course-files-does-not-exist"));
    expect(index.blocks.size).toBe(0);
    expect(index.units.size).toBe(0);
    expect(index.unreadable).toEqual([]);
  });

  it("answers empty maps for an empty directory", () => {
    const index = contentFileIndex(contentDir({}));
    expect(index.blocks.size).toBe(0);
    expect(index.units.size).toBe(0);
  });

  it("ignores anything that is not a .json file", () => {
    // A README beside the content is not content. The applier filters the same
    // way, and the two have to agree or a slug would look claimed by a file the
    // applier never reads.
    const dir = contentDir({ "README.md": "# how this folder works", "notes.txt": "x" });
    expect(contentFileIndex(dir).blocks.size).toBe(0);
  });
});

describe("a file that claims slugs", () => {
  const dir = () =>
    contentDir({
      "01-start.json": {
        slug: "start",
        title: "Los geht es",
        position: 1,
        units: [
          { slug: "willkommen", title: "Willkommen", position: 1 },
          { slug: "werkzeug", title: "Das Werkzeug", position: 2 },
        ],
      },
    });

  it("maps the block slug to its file", () => {
    expect(contentFileIndex(dir()).blocks.get("start")).toBe("01-start.json");
  });

  it("maps every lesson slug in it to the same file", () => {
    const { units } = contentFileIndex(dir());
    expect(units.get("willkommen")).toBe("01-start.json");
    expect(units.get("werkzeug")).toBe("01-start.json");
    expect(units.size).toBe(2);
  });

  it("says nothing about a slug no file mentions", () => {
    // The state the surface renders as "the file is no longer in the tree": a
    // row still says `origin = 'content'`, and no file asserts it any more.
    expect(contentFileIndex(dir()).units.has("geloescht")).toBe(false);
  });

  it("takes only the slug, and no other field of the format", () => {
    // The format belongs to the applier. This reader growing a second opinion
    // about `position` or `releaseAfterDays` is how two parsers start
    // disagreeing about the operator's own files.
    const index = contentFileIndex(dir());
    expect(Object.keys(index)).toEqual(["blocks", "units", "unreadable"]);
  });
});

describe("a file with no units, and one with junk in the list", () => {
  it("reads a block that declares no lessons", () => {
    const dir = contentDir({ "leer.json": { slug: "leer", title: "Leer", position: 1 } });
    const index = contentFileIndex(dir);
    expect(index.blocks.get("leer")).toBe("leer.json");
    expect(index.units.size).toBe(0);
  });

  it("skips a unit entry with no usable slug rather than failing the file", () => {
    const dir = contentDir({
      "mixed.json": {
        slug: "mixed",
        units: [{ title: "no slug" }, null, { slug: "", title: "empty" }, { slug: "echt" }],
      },
    });
    const index = contentFileIndex(dir);
    expect([...index.units.keys()]).toEqual(["echt"]);
    expect(index.unreadable).toEqual([]);
  });
});

describe("🚨 a broken file names itself and takes nothing with it", () => {
  it("reports the file and still reads the good ones", () => {
    // The whole point. `readBlocks()` throws here — correctly, because it is
    // about to write. This reader feeds a PAGE, and a page that dies on a
    // broken file is a page nobody can open to learn which file is broken.
    const dir = contentDir({
      "01-good.json": { slug: "good", units: [{ slug: "eins" }] },
      "02-broken.json": "{ this is not json",
      "03-also-good.json": { slug: "also", units: [{ slug: "zwei" }] },
    });
    const index = contentFileIndex(dir);

    expect(index.unreadable).toEqual(["02-broken.json"]);
    expect([...index.blocks.keys()].sort()).toEqual(["also", "good"]);
    expect([...index.units.keys()].sort()).toEqual(["eins", "zwei"]);
  });

  it("counts a file that is valid JSON but not a block object as unreadable", () => {
    // An array or a bare number parses and claims nothing. "Unreadable" here
    // means "no row can be matched to it", which is the question the surface
    // asks — not "did JSON.parse succeed".
    const dir = contentDir({ "arr.json": [{ slug: "x" }], "num.json": "42" });
    const index = contentFileIndex(dir);
    expect(index.unreadable).toEqual(["arr.json", "num.json"]);
    expect(index.blocks.size).toBe(0);
  });
});

describe("two files claiming one slug", () => {
  it("names the first in reading order", () => {
    // An arrangement the applier REFUSES outright, so no row in any database
    // came from it — this is only about which file the page names while
    // somebody is fixing it. Name order is the applier's own reading order, so
    // both speak about the same file.
    const dir = contentDir({
      "01-first.json": { slug: "a", units: [{ slug: "u" }] },
      "02-second.json": { slug: "b", units: [{ slug: "u" }] },
    });
    expect(contentFileIndex(dir).units.get("u")).toBe("01-first.json");
  });
});
