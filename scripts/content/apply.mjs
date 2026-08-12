#!/usr/bin/env node
// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Apply the repo's content into a database and its media store — repeatably.
//
//   node run.mjs content-apply                 # this machine's environment
//   node run.mjs content-apply --dry-run       # what would happen, writes nothing
//   node run.mjs content-apply --env prod      # rows into the DATABASE_URL in
//                                              # your shell, bytes into the
//                                              # MEDIA_S3_*_PROD bucket
//
// **Content never travels by itself.** The repo goes with every deploy, but
// rows written into a local database and files put into a local store stay on
// that machine — a production app whose course pages are empty while every
// local gate is green is exactly this, and docs/content.md is the story. This
// command is the step that closes the gap, and it is a DELIBERATE step: it
// runs when you run it, in DEV after editing content, and against production
// as a named go-live step (go-live §5 — ⚠️ the automatic proof that it ARRIVED
// the exit condition, so forgetting this command cannot stay quiet).
//
// Three things happen, in an order that matters:
//
//   A. **Media rows.** Every entry in `content/media-manifest.json` becomes a
//      `media` row, upserted on its storage key (`content/<path>` — the same
//      file lands at the same key in every environment). Rows the manifest
//      defines belong to the manifest: every run re-asserts them. Rows it
//      does not mention are never touched.
//   B. **Bytes.** Every entry whose file is on this machine (committed under
//      `content/media/`, or staged in `.data/content-media/`) is copied into
//      the store — HEAD first, so what is already there is skipped.
//   C. **Appliers.** Every file under `scripts/content/appliers/` — and every
//      one an installed MODULE declares (`appliers` in its manifest) — gets its
//      `apply(sql, { mediaIdFor })` run inside a transaction. That is where
//      THIS app's own tables (course blocks, units, catalog rows) are
//      upserted from the content files, keyed by slug, so a re-run asserts
//      instead of duplicating. The core's run first, then the modules' in
//      install order; `scripts/content/_appliers.mjs` says why. The convention,
//      with a worked example: docs/content.md.
//
// Which DATABASE the rows go into is the DATABASE_URL this process sees —
// against production, set it in the shell for one command, exactly the
// `user-create` procedure in docs/DEPLOY.md. Which STORE the bytes go into is
// `--env` (scripts/lib/media-env.mjs). A cross-environment run REFUSES a
// local DATABASE_URL: half a run into prod (bytes) and half into your laptop
// (rows) is the one outcome worse than forgetting the command entirely.
//
// No manifest and no appliers is a fast, honest no-op — an app that ships no
// content has nothing to apply.
import { randomUUID, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

import { CONTENT_MEDIA_MANIFEST } from "../../lib/content-media/rules.mjs";
import { loadManifest, keyFor, localFileFor } from "./_manifest.mjs";
import {
  describeStore,
  isLocalDatabaseUrl,
  machineEnv,
  resolveTargetEnv,
  storeForEnv,
} from "../lib/media-env.mjs";
import { reportSync, syncItems } from "../lib/store-sync.mjs";
import { applierSources } from "./_appliers.mjs";
import "../lib/env.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

const argv = process.argv.slice(2);
// run.mjs passes --apply by itself (the ds24-sync convention: the command is
// expected to really apply; whoever only wants to look passes --dry-run).
const apply = argv.includes("--apply") && !argv.includes("--dry-run");

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

async function main() {
  const resolvedEnv = resolveTargetEnv(argv);
  if (resolvedEnv.error) {
    console.error(`✗ ${resolvedEnv.error}`);
    process.exit(1);
  }
  const env = resolvedEnv.env;
  const crossEnv = env !== machineEnv();

  const manifest = loadManifest(ROOT);
  const appliers = applierSources(ROOT);

  // The no-op branch — fast and one line, because an app that ships no
  // content runs this in every go-live checklist anyway.
  if (manifest.missing && appliers.length === 0) {
    console.log(
      `Nothing to apply — no ${CONTENT_MEDIA_MANIFEST} and no applier, in the core's ` +
        "scripts/content/appliers/ or in any installed module. An app that ships " +
        "content declares it there (docs/content.md).",
    );
    return;
  }

  const entries = manifest.missing ? [] : manifest.entries;
  console.log("");
  for (const problem of manifest.missing ? [] : manifest.problems) bad(problem);
  if (failed) {
    console.log("\nFix the manifest first — nothing was applied.\n");
    process.exit(1);
  }

  // The store this run fills — named before anything else, because which
  // environment a run touched is the whole question here.
  const store = storeForEnv(env);
  if (store.error) {
    bad(store.error);
    console.log("");
    process.exit(1);
  }
  console.log(`${describeStore(env, store)}\n`);

  // The split-brain guard: rows and bytes MUST land in the same environment.
  const dbUrl = process.env.DATABASE_URL;
  if (crossEnv && isLocalDatabaseUrl(dbUrl)) {
    bad(
      `--env ${env} with a local DATABASE_URL — the bytes would go to the ${env.toUpperCase()} ` +
        `bucket while the rows stay on this machine. Set the ${env.toUpperCase()} database's ` +
        "DATABASE_URL in the shell for this one command (the user-create procedure, " +
        "docs/DEPLOY.md) and run it again.",
    );
    console.log("");
    process.exit(1);
  }

  // ── A. Media rows ──────────────────────────────────────────────────────────
  // An entry with no local file and no recorded hash cannot become an honest
  // row — that is a named warning here and a red line, never a row with
  // invented numbers.
  //
  // ⚠️ Not because the columns forbid it: `media.sha256` became nullable with
  // the direct-to-bucket path, where the app genuinely never holds the bytes
  // and null means "no answer". This writer is the opposite case — it HAS the
  // file or it has nothing — so an absent hash here would be a gap it could
  // have filled, and a made-up one would be a lie in a column whose whole use
  // is "is this the same file again".
  const rows = [];
  for (const entry of entries) {
    const file = localFileFor(ROOT, entry.path);
    if (file) {
      const body = readFileSync(file.full);
      rows.push({
        ...entry,
        bytes: body.length,
        sha256: createHash("sha256").update(body).digest("hex"),
        file,
      });
    } else if (entry.sha256 && entry.bytes) {
      rows.push({ ...entry, file: null });
    } else {
      warn(
        `${entry.path} — no file on either leg and no sha256/bytes in the manifest; ` +
          "no row written. Stage the file and run content-media-sync first (it records both)",
      );
    }
  }

  if (rows.length > 0 && !apply) {
    for (const row of rows) warn(`${row.path} — would assert a media row (${row.visibility}${row.requiresPlan ? `, plan ${row.requiresPlan}` : ""})`);
  }

  let sql = null;
  if (apply && (rows.length > 0 || appliers.length > 0)) {
    if (!dbUrl) {
      bad("DATABASE_URL is not set (see .env).");
      console.log("");
      process.exit(1);
    }
    const { default: postgres } = await import("postgres");
    sql = postgres(dbUrl, { max: 1 });
  }

  try {
    if (apply && rows.length > 0) {
      for (const row of rows) {
        try {
          await sql`
            insert into media (id, owner_id, kind, visibility, requires_plan,
                               storage_key, mime, filename, bytes, sha256, source, alt)
            values (${randomUUID()}, null, ${row.kind}, ${row.visibility}, ${row.requiresPlan},
                    ${row.key}, ${row.contentType}, ${row.filename}, ${row.bytes}, ${row.sha256},
                    'upload', ${row.alt})
            on conflict (storage_key) do update set
              kind = excluded.kind,
              visibility = excluded.visibility,
              requires_plan = excluded.requires_plan,
              mime = excluded.mime,
              filename = excluded.filename,
              bytes = excluded.bytes,
              sha256 = excluded.sha256,
              alt = excluded.alt
          `;
          ok(`${row.path} — media row asserted (${row.visibility}${row.requiresPlan ? `, plan ${row.requiresPlan}` : ""})`);
        } catch (error) {
          bad(`${row.path} — media row failed: ${error.message}`);
        }
      }
    }

    // ── B. Bytes ─────────────────────────────────────────────────────────────
    const items = rows
      .filter((row) => row.file)
      .map((row) => ({
        path: row.path,
        source: row.file.full,
        key: row.key,
        contentType: row.contentType,
      }));
    let result = { copied: 0, present: 0, failed: false, mp4Moved: false, unprocessed: null };
    if (items.length > 0) {
      console.log("");
      result = await syncItems({ store, items, apply, log: { ok, warn, bad } });
      if (result.failed) failed = true;
    }

    // ── C. Appliers ──────────────────────────────────────────────────────────
    if (appliers.length > 0) console.log("");
    for (const { label, file } of appliers) {
      if (!apply) {
        warn(`applier ${label} — would run`);
        continue;
      }
      let module;
      try {
        module = await import(pathToFileURL(file).href);
      } catch (error) {
        bad(`applier ${label} — cannot be loaded: ${error.message}`);
        continue;
      }
      if (typeof module.apply !== "function") {
        bad(`applier ${label} — exports no apply(sql, helpers) function (docs/content.md has the convention)`);
        continue;
      }
      try {
        // One transaction per applier: a throw rolls its rows back whole and
        // is reported loudly — half-applied content is worse than none.
        const count = await sql.begin(async (tx) => {
          const mediaIdFor = async (path) => {
            const found = await tx`select id from media where storage_key = ${keyFor(path)}`;
            if (found.length === 0) {
              throw new Error(
                `mediaIdFor("${path}"): no media row at ${keyFor(path)} — is the entry in ` +
                  `${CONTENT_MEDIA_MANIFEST}? Rows are asserted in step A of this same command`,
              );
            }
            return found[0].id;
          };
          return module.apply(tx, { mediaIdFor });
        });
        ok(`applier ${label} — ${Number.isFinite(count) ? `${count} row(s) asserted` : "ran"}`);
      } catch (error) {
        bad(`applier ${label} — failed and was rolled back: ${error.message}`);
      }
    }

    if (items.length > 0) {
      reportSync({ result, apply, commandName: "node run.mjs content-apply" });
    } else {
      console.log("");
    }
    if (!apply) {
      console.log(
        `DRY RUN — ${rows.length} row(s) and ${appliers.length} applier(s) would be applied. ` +
          "Nothing was written. To apply: node run.mjs content-apply\n",
      );
    }
  } finally {
    if (sql) await sql.end();
  }

  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(`\n✗ content-apply failed: ${error.message}\n`);
  process.exit(1);
});
