// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Which content file claims which slug — the half of the origin story that is
// NOT in the database.
//
// `origin = 'content'` says a row belongs to the applier. It does not say which
// FILE it came from, and it deliberately never will: a column holding a file
// name is a second copy of something the tree already states, and it goes stale
// the moment somebody renames a file without re-applying. So the name is read
// back out of the deployed tree instead — the content files are repo files,
// they travel with every deploy, and `content/course/` is exactly where
// `content/appliers/course.mjs` looks for them.
//
// Two states follow from reading the tree rather than a column, and both are
// worth showing rather than smoothing over:
//
//   * a `content` row whose slug no file claims any more. Somebody deleted the
//     file and has not re-applied. Relabelling it "made here" would hide the
//     one row that is about to surprise them — and it would be a lie the next
//     `content-apply` does not correct, because that run has no file to assert
//     it from.
//   * a file that will not parse. The APPLIER throws on one, and it is right
//     to: half-applied content is worse than none. This reader is the opposite
//     case — it feeds a page whose whole job is to show the operator what is
//     going on, and a stack trace shows nothing. So the file is skipped, named,
//     and the rest of the page still renders.
//
// 🚨 SERVER ONLY — it reads `node:fs`. Nothing that reaches the browser bundle
// may import it.
//
// It is not a second parser for the block format. Only `slug` and the file name
// are taken; the format itself stays with the applier, which owns it.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Where the operator's course files live, same as the applier's `CONTENT_DIR`. */
const CONTENT_DIR = join(process.cwd(), "content", "course");

/** The name of a course's own file — the applier's `COURSE_FILE`, same string. */
const COURSE_FILE = "course.json";

export interface ContentFileIndex {
  /** Course slug → the file that claims it (`<course>/course.json`). */
  readonly courses: ReadonlyMap<string, string>;
  /** Block slug → the file that claims it, as `<course>/<file>.json`. */
  readonly blocks: ReadonlyMap<string, string>;
  /** Lesson slug → the file that claims it, as `<course>/<file>.json`. */
  readonly units: ReadonlyMap<string, string>;
  /**
   * Files that could not be read, by path.
   *
   * ⚠️ **A loose `.json` directly under `content/course/` is listed here.** The
   * applier REFUSES the whole run for one (it is a block from the layout before
   * courses had rows, and applying three quarters of a course is worse than
   * applying none). This surface cannot refuse anything — it exists to tell the
   * operator which file a row came from — so it reports the file as one it
   * could not place, which is the same sentence in the mood this page can use.
   */
  readonly unreadable: readonly string[];
}

/**
 * Every slug the tree claims, and every file it could not read.
 *
 * The directory is a trailing parameter with a default — the same seam
 * `readBlocks()` in the applier carries, and for the same reason: the walk is
 * the testable part, and it cannot be exercised against a fixture while the
 * only path it knows is the app's own.
 *
 * A missing directory is an app whose course has no content files yet, not a
 * fault: empty maps, exactly as `blockFiles()` in the applier answers.
 */
export function contentFileIndex(dir: string = CONTENT_DIR): ContentFileIndex {
  const courses = new Map<string, string>();
  const blocks = new Map<string, string>();
  const units = new Map<string, string>();
  const unreadable: string[] = [];

  let entries: { name: string; isDirectory: () => boolean; isFile: () => boolean }[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return { courses, blocks, units, unreadable };
  }

  // The old layout, reported rather than swept up — see `unreadable` above.
  for (const entry of entries.filter((e) => e.isFile() && e.name.endsWith(".json")).sort(byName)) {
    unreadable.push(entry.name);
  }

  for (const dirEntry of entries.filter((e) => e.isDirectory()).sort(byName)) {
    const courseSlug = dirEntry.name;
    let names: string[];
    try {
      names = readdirSync(join(dir, courseSlug))
        .filter((name) => name.endsWith(".json"))
        .sort();
    } catch {
      continue;
    }

    for (const name of names) {
      const rel = `${courseSlug}/${name}`;
      let parsed: unknown;
      try {
        parsed = JSON.parse(readFileSync(join(dir, courseSlug, name), "utf8"));
      } catch {
        unreadable.push(rel);
        continue;
      }
      // The applier demands one OBJECT per file and refuses anything else; a
      // file that is an array or a bare number claims no slug, so it is
      // unreadable here in exactly the sense that matters — nothing in it can
      // be matched to a row.
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        unreadable.push(rel);
        continue;
      }

      // 🚨 The course's own file claims the DIRECTORY's name, not a `slug` key.
      // The applier refuses a `slug` in it outright, so reading one here would
      // be this surface believing a value the writer rejects.
      if (name === COURSE_FILE) {
        claim(courses, courseSlug, rel);
        continue;
      }

      const block = parsed as { slug?: unknown; units?: unknown };
      claim(blocks, block.slug, rel);
      for (const unit of Array.isArray(block.units) ? block.units : []) {
        claim(units, (unit as { slug?: unknown } | null)?.slug, rel);
      }
    }
  }

  return { courses, blocks, units, unreadable };
}

/** Name order — the applier's own reading order, so the two agree. */
function byName(a: { name: string }, b: { name: string }): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/**
 * First file in name order wins.
 *
 * ⚠️ Which one wins only matters for a tree the applier would REFUSE outright
 * (`readBlocks()` throws on a duplicate slug), so this is a tie-break for an
 * arrangement that can never have produced the row being looked up. Name order
 * is the applier's own reading order, so the two at least agree about which
 * file they mean.
 */
function claim(into: Map<string, string>, slug: unknown, file: string) {
  if (typeof slug !== "string" || !slug) return;
  if (!into.has(slug)) into.set(slug, file);
}
