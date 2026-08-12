#!/usr/bin/env node
// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Fills a media store with the product's large files — repeatably.
//
//   node run.mjs content-media-sync                    # dry run: what would be copied
//   node run.mjs content-media-sync --apply            # copy what is missing
//   node run.mjs content-media-sync --env prod --apply # into the PROD bucket
//                                                      # (MEDIA_S3_*_PROD keys)
//
// Content media past the shipped ceiling live in `.data/content-media/`
// (gitignored, by convention) — a lesson recording does not belong in git, so
// it cannot travel with the deploy the way `content/media/` does. Nothing
// fills a store by itself; this command is that command, and `--env prod`
// makes it the same command for every environment — the go-live step that
// keeps a course from playing locally and 404ing live.
//
// It moves BYTES only. The `media` rows those bytes answer under are
// `content-apply`'s job — which is why a successful `--apply` writes each
// file's `sha256` and `bytes` back into the manifest entry: the deployed
// server never sees these files, and without the recorded numbers it could
// not assert an honest row for them.
//
// The mechanics (dry run by default, only what is missing, a stopped run
// names its remainder) are `scripts/lib/store-sync.mjs`, shared with
// `kb-media-sync`. The grammar is `lib/content-media/rules.mjs` — a bad name
// is refused, never copied, so the store only ever holds keys the delivery
// route would accept.
//
// Plain Node, no bundler, no TypeScript, no dependency — it has to run on
// Linux, macOS and in a Git Bash on Windows (CLAUDE.md, "Three systems").
import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import {
  CONTENT_MEDIA_MANIFEST,
  CONTENT_MEDIA_SHIPPED_DIR,
  CONTENT_MEDIA_STAGED_DIR,
} from "../../lib/content-media/rules.mjs";
import { loadManifest } from "./_manifest.mjs";
import { describeStore, machineEnv, resolveTargetEnv, storeForEnv } from "../lib/media-env.mjs";
import { filesUnder, reportSync, syncItems } from "../lib/store-sync.mjs";
import "../lib/env.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const STAGED = join(ROOT, ...CONTENT_MEDIA_STAGED_DIR.split("/"));

const argv = process.argv.slice(2);
const apply = argv.includes("--apply");

let failed = false;
function ok(line) {
  console.log(`  ✓ ${line}`);
}
function warn(line) {
  console.log(`  ! ${line}`);
}
function bad(line) {
  console.log(`  ✗ ${line}`);
  failed = true;
}

function fileAt(dir, path) {
  const full = join(ROOT, ...dir.split("/"), ...path.split("/"));
  try {
    return statSync(full).isFile() ? full : null;
  } catch {
    return null;
  }
}

async function main() {
  const resolvedEnv = resolveTargetEnv(argv);
  if (resolvedEnv.error) {
    console.error(`✗ ${resolvedEnv.error}`);
    process.exit(1);
  }
  const env = resolvedEnv.env;

  const manifest = loadManifest(ROOT);
  if (manifest.missing) {
    console.log(
      `\nNothing to sync — there is no ${CONTENT_MEDIA_MANIFEST}.` +
        "\nProduct media are declared there (one entry per file), the files go to" +
        `\n${CONTENT_MEDIA_SHIPPED_DIR}/ (small) or ${CONTENT_MEDIA_STAGED_DIR}/ (large),` +
        "\nthen run this again. The story: docs/content.md\n",
    );
    return;
  }

  console.log("");
  for (const problem of manifest.problems) bad(problem);
  if (failed) {
    console.log("\nFix the manifest first — nothing was synced.\n");
    process.exit(1);
  }

  const store = storeForEnv(env);
  if (store.error) {
    bad(store.error);
    console.log("");
    process.exit(1);
  }
  // Which store this run fills is part of every line below — and for a
  // cross-environment run it is the loudest line of the report, printed
  // before anything is written.
  console.log(`${describeStore(env, store)}\n`);

  // Staged files nobody declared: named, because a file with no manifest
  // entry gets no row, and a file with no row is one no page can deliver.
  const skipped = [];
  const staged = filesUnder(STAGED, "", skipped) ?? [];
  for (const line of skipped) warn(line);
  const declared = new Set(manifest.entries.map((entry) => entry.path));
  for (const path of staged) {
    if (!declared.has(path)) {
      warn(
        `${CONTENT_MEDIA_STAGED_DIR}/${path} is not in the manifest — it would reach the ` +
          "store but never a page. Add an entry (docs/content.md)",
      );
    }
  }

  // The plan: every manifest entry whose file is staged here. Shipped-leg
  // files travel with the repo and are content-apply's step B; an entry with
  // no file anywhere is content-apply's finding, here it is a warning.
  const items = [];
  const recorded = [];
  for (const entry of manifest.entries) {
    const stagedFile = fileAt(CONTENT_MEDIA_STAGED_DIR, entry.path);
    if (stagedFile) {
      items.push({
        path: entry.path,
        source: stagedFile,
        key: entry.key,
        contentType: entry.contentType,
      });
      recorded.push({ entry, file: stagedFile });
      continue;
    }
    if (fileAt(CONTENT_MEDIA_SHIPPED_DIR, entry.path)) {
      ok(`${entry.path} — shipped in the repo; content-apply uploads it`);
    } else {
      warn(`${entry.path} — no file on either leg; nothing to sync under this name`);
    }
  }

  if (items.length === 0) {
    console.log("\nNothing staged to sync.\n");
    process.exit(failed ? 1 : 0);
  }
  items.sort((a, b) => (a.path < b.path ? -1 : 1));

  const result = await syncItems({ store, items, apply, log: { ok, warn, bad } });
  if (result.failed) failed = true;

  // Write sha256/bytes back into the manifest — the numbers the deployed
  // server needs to assert a row for bytes it never sees. Only after a real
  // run (a dry run writes nothing, including this), and only for entries
  // whose numbers are missing or stale.
  if (apply && result.unprocessed === null) {
    let changed = false;
    for (const { entry, file } of recorded) {
      const body = readFileSync(file);
      const sha256 = createHash("sha256").update(body).digest("hex");
      const raw = manifest.data.entries.find((candidate) => candidate.path === entry.path);
      if (raw && (raw.sha256 !== sha256 || raw.bytes !== body.length)) {
        raw.sha256 = sha256;
        raw.bytes = body.length;
        changed = true;
      }
    }
    if (changed) {
      writeFileSync(
        join(ROOT, ...CONTENT_MEDIA_MANIFEST.split("/")),
        `${JSON.stringify(manifest.data, null, 2)}\n`,
      );
      ok(`${CONTENT_MEDIA_MANIFEST} — sha256/bytes recorded (commit this change)`);
    }
  }

  reportSync({ result, apply, commandName: "node run.mjs content-media-sync" });
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(`\n✗ content-media-sync failed: ${error.message}\n`);
  process.exit(1);
});
