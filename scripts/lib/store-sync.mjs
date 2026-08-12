// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Filling a media store with local files — the mechanics, exactly once.
//
// Two commands fill a store from a local folder: `kb-media-sync` (the
// assistant's knowledge media, `knowledge/<path>`) and `content-media-sync`
// (the product's content media, `content/<path>`), and `content-apply` uploads
// the repo-leg bytes the same way. What they share lives here — the walk, the
// HEAD-then-PUT loop against s3 through `lib/media/s3-request.mjs` (the same
// signer the app uses), the plain-fs twin for the local driver, and the
// abort-with-named-remainder behaviour — so "does a file reach the store" has
// one implementation, not three that drift.
//
// The three properties every caller inherits:
//
//  1. **Dry run unless told otherwise.** Without `apply` the loop lists what
//     would be copied and writes nothing.
//  2. **Only what is missing.** An object already in the store is skipped, so
//     every caller is repeatable — running it twice is the same as once.
//  3. **A stopped run says what it never looked at.** One network failure
//     aborts the loop (retrying every key only slows it down), but the tail
//     goes into `unprocessed` and the caller's summary names it — "Done — 3
//     copied" over a run that gave up after three of forty is a true number
//     in a sentence that is a lie.
//
// Plain Node, no bundler, no TypeScript, no dependency — it has to run on
// Linux, macOS and in a Git Bash on Windows (CLAUDE.md, "Three systems").
import { readdirSync, statSync } from "node:fs";
import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

import { sendS3 } from "../../lib/media/s3-request.mjs";

/**
 * Every file below `dir`, as forward-slash paths relative to it. Dotfiles are
 * skipped silently — a `.DS_Store` is the operating system's litter, not an
 * operator's mistake worth a red gate.
 *
 * **Symlinks are followed, and a broken one is named.** A `Dirent` describes
 * the ENTRY, not what it points at, so for a symlink `isFile()` and
 * `isDirectory()` are BOTH false — the entry would fall through both branches
 * and vanish without a word. That matters here more than almost anywhere: a
 * staging folder for large files is exactly the place somebody symlinks a
 * 900 MB recording instead of copying it, and the whole point of these
 * commands is that nothing goes missing between the folder and the store. So
 * a symlink is resolved with `statSync` (which follows): to a file it syncs
 * like a file, to a directory it is walked like a directory. When it resolves
 * to nothing, the path goes into `skipped` and is reported — never silently
 * dropped, which is the only failure mode here that leaves no trace anywhere.
 *
 * Returns null when the folder does not exist — a normal state the caller
 * words its own way.
 */
export function filesUnder(dir, prefix = "", skipped = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  const found = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    const full = join(dir, entry.name);

    let isDirectory = entry.isDirectory();
    let isFile = entry.isFile();
    if (entry.isSymbolicLink()) {
      try {
        const target = statSync(full);
        isDirectory = target.isDirectory();
        isFile = target.isFile();
      } catch (error) {
        skipped.push(
          `${rel} — a symlink that resolves to nothing (${error.code ?? error.message}); ` +
            "skipped, so nothing under this name reaches the store",
        );
        continue;
      }
    }

    if (isDirectory) {
      found.push(...(filesUnder(full, rel, skipped) ?? []));
    } else if (isFile) {
      found.push(rel);
    }
  }
  return found;
}

/**
 * Is one object in the store? The read half of the loop below, exported on
 * its own because the store question is asked in one place without ever
 * writing anything.
 *
 * @returns {Promise<{present: boolean} | {error: string}>}
 */
export async function objectPresent(store, key) {
  if (store.driver === "local") {
    try {
      return { present: (await stat(join(store.localRoot, ...key.split("/")))).isFile() };
    } catch {
      return { present: false };
    }
  }
  let head;
  try {
    head = await sendS3(store.settings, "HEAD", key);
  } catch (error) {
    return { error: `the bucket is not reachable: ${error.message}` };
  }
  if (head.ok) return { present: true };
  if (head.status === 404) return { present: false };
  // Anything else is NOT "missing" — a 403 from an endpoint carrying a path
  // reads like absence and would turn into a pointless upload attempt.
  return { error: `HEAD ${key} answered HTTP ${head.status} — not treating that as "missing"` };
}

/**
 * Copy a list of items into a store — the shared loop.
 *
 * @param {object} input
 * @param {{driver: "local", localRoot: string} | {driver: "s3", settings: object}} input.store
 * @param {Array<{path: string, source: string, key: string, contentType: string}>} input.items
 *   `path` is the label the report speaks in, `source` the absolute local
 *   file, `key` the object key, `contentType` what the upload declares.
 * @param {boolean} input.apply  false = dry run, nothing is written.
 * @param {{ok: Function, warn: Function, bad: Function}} input.log
 * @returns {Promise<{copied: number, present: number, failed: boolean,
 *   mp4Moved: boolean, unprocessed: string[] | null}>}
 */
export async function syncItems({ store, items, apply, log }) {
  let copied = 0;
  let present = 0;
  let failed = false;
  let mp4Moved = false;
  // Set when the run stops early: the paths that were never even looked at.
  let unprocessed = null;

  const local = store.driver === "local";

  for (const item of items) {
    if (local) {
      const target = join(store.localRoot, ...item.key.split("/"));
      let already = false;
      try {
        already = (await stat(target)).isFile();
      } catch {
        already = false;
      }
      if (already) {
        present += 1;
        log.ok(`${item.path} — already in the store`);
        continue;
      }
      if (!apply) {
        log.warn(`${item.path} — would copy to ${item.key}`);
      } else {
        try {
          await mkdir(dirname(target), { recursive: true });
          await copyFile(item.source, target);
          log.ok(`${item.path} — copied to ${item.key}`);
        } catch (error) {
          log.bad(`${item.path} — copying failed: ${error.message}`);
          failed = true;
          continue;
        }
      }
    } else {
      let head;
      try {
        head = await sendS3(store.settings, "HEAD", item.key);
      } catch (error) {
        log.bad(`the bucket is not reachable: ${error.message}`);
        failed = true;
        // One network failure fails the run; from here on nothing is looked
        // at, and the caller's summary says so by name.
        unprocessed = items.slice(items.indexOf(item)).map((i) => i.path);
        break;
      }
      if (head.ok) {
        present += 1;
        log.ok(`${item.path} — already in the bucket`);
        continue;
      }
      if (head.status !== 404) {
        log.bad(`HEAD ${item.key} answered HTTP ${head.status} — not treating that as "missing"`);
        failed = true;
        continue;
      }
      if (!apply) {
        log.warn(`${item.path} — would upload to ${item.key} (${item.contentType})`);
      } else {
        try {
          const body = await readFile(item.source);
          const put = await sendS3(store.settings, "PUT", item.key, body, item.contentType);
          if (!put.ok) {
            const detail = (await put.text()).slice(0, 300);
            log.bad(`${item.path} — upload failed (HTTP ${put.status}) ${detail}`);
            failed = true;
            continue;
          }
          log.ok(`${item.path} — uploaded to ${item.key} (${item.contentType})`);
        } catch (error) {
          log.bad(`${item.path} — upload failed: ${error.message}`);
          failed = true;
          continue;
        }
      }
    }
    copied += 1;
    if (item.path.endsWith(".mp4")) mp4Moved = true;
  }

  return { copied, present, failed, mp4Moved, unprocessed };
}

/**
 * The shared closing lines: the faststart reminder the moment an .mp4 moves
 * (afterwards nothing will — a video without faststart downloads whole before
 * the first frame plays), and the three-shapes summary. `commandName` is what
 * the dry-run line tells the user to type next.
 */
export function reportSync({ result, apply, commandName }) {
  console.log("");
  if (result.mp4Moved) {
    console.log(
      "  ! an .mp4 went (or would go) into the store — make sure it was encoded " +
        "with faststart (ffmpeg -movflags +faststart), or the player waits " +
        "for the whole download before it starts.",
    );
    console.log("");
  }

  if (result.unprocessed !== null) {
    // Not "Done" — the run stopped. Three numbers, because the one that
    // matters is the third: what nobody has looked at yet.
    const names =
      result.unprocessed.length <= 10
        ? `: ${result.unprocessed.join(", ")}`
        : " (run this again to see them)";
    console.log(
      `ABORTED — the store stopped answering. ${result.copied} object(s) ` +
        `${apply ? "copied" : "would have been copied"}, ${result.present} already there, ` +
        `${result.unprocessed.length} never processed${names}.`,
    );
    console.log(
      "Nothing about the remainder is known — fix the store and run this again; " +
        "the command is repeatable and skips what is already there.",
    );
  } else if (!apply) {
    console.log(
      result.copied === 0
        ? `Nothing missing — ${result.present} object(s) already in the store.`
        : `DRY RUN — ${result.copied} object(s) would be copied, ${result.present} already there. ` +
            `Nothing was written. To copy: ${commandName} --apply`,
    );
  } else {
    console.log(`Done — ${result.copied} object(s) copied, ${result.present} already there.`);
  }
  console.log("");
}
