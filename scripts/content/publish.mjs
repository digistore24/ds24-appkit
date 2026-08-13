#!/usr/bin/env node
// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// `node run.mjs content-publish` — publish this repo's content into an
// environment, **including the media that is too big to be in the repo**, and
// without a production password anywhere.
//
//   node run.mjs content-publish                  # dry run against this machine
//   node run.mjs content-publish --env prod       # dry run against production
//   node run.mjs content-publish --env prod --apply
//
// ── What it needs, and what it deliberately does not ───────────────────────
// `APP_URL_PROD` + `SETUP_KEY_PROD` in the `.env`. **No `MEDIA_S3_*_PROD` and
// no `DATABASE_URL`** — that is the whole point, and it is the sentence to
// check any change to this file against: any answer that ends with the operator
// holding a bucket credential has failed, however elegant.
//
// ── The order, which is the reason this is a command and not a tool ────────
//
//   0. **pre-flight** — every file the manifest declares is checked against the
//      two local legs FIRST, and a run with a missing one refuses before it
//      writes anything, naming every missing path rather than the first. No
//      tool can do this: the app cannot see `.data/content-media/`.
//   1. **uploads** — for every staged file the target lacks: `content_media_url`
//      mints an address, this process PUTs the bytes STRAIGHT TO THE BUCKET,
//      `content_media_confirm` reads back what landed and asserts the row.
//   2. **`content_publish` plan**, then with `--apply` its apply — the media
//      rows the image can speak for, the bytes it carries, then every applier.
//   3. the sentence naming `content-check`, which is the exit condition.
//
// 🚨 **Steps 1 and 2 are in that order and not the other one.** An applier
// resolves a lesson's video through `mediaIdFor(path)`, which throws BY NAME
// when there is no `media` row — so if the uploads ran after the appliers, every
// lesson pointing at a staged file would fail the publish, and the throw that
// exists to catch a typo would be catching the tool instead.
//
// ── What travels where ─────────────────────────────────────────────────────
// The BYTES go from this machine to the bucket. A manifest path, a length and a
// recorded hash go through the app. **Nothing at all goes through the model** —
// this is a command somebody's agent runs, not a tool it hands a file to.
//
// ── What this must never do ────────────────────────────────────────────────
//   · **retry an upload silently.** A PUT that failed halfway leaves an object
//     of the wrong length, and `content_media_confirm` removes it. Retrying
//     inside the loop turns one honest refusal into a loop nobody reads; the
//     command is repeatable, so the operator retries by running it again.
//   · **read a file twice, or read one into the heap.** `openAsBlob()` hands
//     `fetch` a body with a known size and streams it off the disk — see the
//     note above `uploadBody()`.
//   · **invent a sha256.** An entry with neither a file nor recorded numbers is
//     named and refused, the same ruling `content-apply` makes.
//
// Plain Node, no dependency, `fetch()` and `node:fs` only: it runs on Linux,
// macOS and in a Git Bash on Windows.
import { openAsBlob, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  CONTENT_MEDIA_MANIFEST,
  CONTENT_MEDIA_STAGED_DIR,
} from "../../lib/content-media/rules.mjs";
import { applyThroughSetup, callSetup, reportRefusal, resolveEnvName, toolRefusal } from "../setup/client.mjs";
import { loadManifest, localFileFor } from "./_manifest.mjs";
import "../lib/env.mjs";
import { flagsFrom } from "../lib/args.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

const argv = process.argv.slice(2);
const flag = flagsFrom(argv);
// Dry run by default — the `content-apply` / `content-media-sync` convention.
// This one writes into a PRODUCTION database and a production bucket, so the
// default is the one that cannot.
const apply = argv.includes("--apply");

const ok = (line) => console.log(`  ✓ ${line}`);
const warn = (line) => console.log(`  ! ${line}`);
const bad = (line) => console.log(`  ✗ ${line}`);

/**
 * The bytes, as something `fetch` can send without holding them.
 *
 * `openAsBlob()` gives a Blob backed by the FILE: `fetch` learns its size, sets
 * `Content-Length` and streams it off the disk, so a nine-hundred-megabyte
 * recording costs one file handle rather than one heap.
 *
 * ⚠️ **A stream body was tried first and is not used, for a reason worth
 * recording.** `fetch(url, { body: createReadStream(f), duplex: "half" })` sends
 * `Transfer-Encoding: chunked`, because the fetch specification makes
 * `Content-Length` a forbidden header a caller cannot set — and S3 answers a
 * presigned PUT with chunked encoding with `501 Not Implemented`. A blob is the
 * shape that keeps both properties: a length the bucket accepts, and no copy of
 * the file in this process.
 *
 * A Node that has no `openAsBlob` reads the file instead, and the run SAYS the
 * size it is about to hold rather than leaving the reader to guess which of the
 * two happened.
 */
async function uploadBody(file, bytes) {
  if (typeof openAsBlob === "function") return { body: await openAsBlob(file), buffered: false };
  warn(
    `this Node has no fs.openAsBlob, so ${Math.round(bytes / 1_048_576)} MB is being read into ` +
      `memory for this upload (Node 20+ streams it off the disk instead)`,
  );
  return { body: readFileSync(file), buffered: true };
}

async function main() {
  const resolved = resolveEnvName(flag("env"));
  if (resolved.error) {
    console.error(`✗ ${resolved.error}`);
    process.exit(2);
  }
  const env = resolved.env;

  console.log(`\nPublishing this repo's content into ${env}${apply ? "" : " — DRY RUN"}\n`);

  // ── 0. the manifest, judged by the one reader of it ──────────────────────
  const manifest = loadManifest(ROOT);
  const declared = manifest.missing ? [] : manifest.entries;
  if (!manifest.missing && manifest.problems.length > 0) {
    for (const problem of manifest.problems) bad(problem);
    console.log(`\nFix ${CONTENT_MEDIA_MANIFEST} first — nothing was published.\n`);
    process.exit(1);
  }

  // ── 0b. the pre-flight, over the WHOLE manifest, before anything ─────────
  //
  // 🚨 It names EVERY missing file, not the first. A run that refuses once per
  // attempt is a run somebody makes five times; the point of looking at all of
  // them first is that the operator fixes the set in one go.
  const staged = [];
  const missing = [];
  const unrecorded = [];
  const carried = [];

  for (const entry of declared) {
    const file = localFileFor(ROOT, entry.path);
    if (!file) {
      missing.push(entry.path);
      continue;
    }
    if (file.leg === "shipped") {
      // The deploy carries it, so `content_publish` step B puts it in that
      // environment's store from the image. Nothing to upload from here.
      carried.push(entry.path);
      continue;
    }
    if (!entry.sha256 || !entry.bytes) {
      unrecorded.push(entry.path);
      continue;
    }
    staged.push({ ...entry, file: file.full });
  }

  if (missing.length > 0 || unrecorded.length > 0) {
    for (const path of missing) {
      bad(`${path} — declared in ${CONTENT_MEDIA_MANIFEST} and on neither local leg`);
    }
    for (const path of unrecorded) {
      bad(`${path} — staged in ${CONTENT_MEDIA_STAGED_DIR}/, but no sha256/bytes recorded`);
    }
    console.log("");
    console.log(
      `Nothing was uploaded and no row was asserted. Fill the staged leg and record both\n` +
        `numbers with: node run.mjs content-media-sync --apply  (then commit the manifest).\n`,
    );
    process.exit(1);
  }

  console.log(
    `  ${declared.length} declared · ${carried.length} carried by the image · ` +
      `${staged.length} staged here\n`,
  );

  // ── 1. the staged leg, straight to that environment's bucket ─────────────
  let uploaded = 0;
  let found = 0;

  for (const [index, entry] of staged.entries()) {
    const remainder = () => staged.slice(index + 1).map((rest) => rest.path);

    const minted = apply
      ? await applyThroughSetup(env, "content_media_url", { path: entry.path })
      : await callSetup(env, { tool: "content_media_url", mode: "plan", input: { path: entry.path } });
    if (!minted.ok) {
      console.log("");
      reportRefusal(minted);
      return stopped(remainder(), minted.exitCode);
    }

    const refusedMint = toolRefusal(minted.body);
    if (refusedMint) {
      bad(`${entry.path} — ${minted.body.detail}`);
      return stopped(remainder(), 1);
    }

    const data = minted.body.data ?? {};
    if (data.found) {
      // The `store-sync.mjs` property, in the same words: what is already there
      // is skipped, so running this twice is the same as running it once.
      found += 1;
      ok(`${entry.path} — already in the ${env} store`);
      continue;
    }
    if (!data.upload) {
      // 🚨 The named refusal, never an empty answer. Either the driver cannot
      // mint (finding 3) or this is a dry run.
      if (data.reason) {
        bad(`${entry.path} — ${data.reason}`);
        return stopped(remainder(), 1);
      }
      warn(`${entry.path} — would be uploaded to the ${env} store (${entry.bytes} bytes)`);
      continue;
    }

    const { body } = await uploadBody(entry.file, entry.bytes);
    let put;
    try {
      put = await fetch(data.upload.url, { method: "PUT", body });
    } catch (error) {
      bad(`${entry.path} — the bucket did not answer (${error.message})`);
      return stopped(remainder(), 1);
    }
    if (!put.ok) {
      const detail = (await put.text()).slice(0, 300);
      bad(`${entry.path} — the bucket refused the upload (HTTP ${put.status}) ${detail}`);
      return stopped(remainder(), 1);
    }

    const confirmed = await applyThroughSetup(env, "content_media_confirm", { path: entry.path });
    if (!confirmed.ok) {
      console.log("");
      reportRefusal(confirmed);
      return stopped(remainder(), confirmed.exitCode);
    }
    const refusedConfirm = toolRefusal(confirmed.body);
    if (refusedConfirm) {
      bad(`${entry.path} — ${confirmed.body.detail}`);
      return stopped(remainder(), 1);
    }

    uploaded += 1;
    // The tool's own line, which already begins with the path — one line of
    // numbers about one file, not this command's paraphrase of it.
    ok(confirmed.body.detail);
  }

  if (staged.length > 0) console.log("");

  // ── 2. the appliers, and the rows the image can speak for ────────────────
  const planned = await callSetup(env, { tool: "content_publish", mode: "plan", input: {} });
  if (!planned.ok) {
    reportRefusal(planned);
    process.exit(planned.exitCode);
  }
  const refusedPlan = toolRefusal(planned.body);
  if (refusedPlan) {
    bad(planned.body.detail);
    console.log("");
    process.exit(1);
  }
  console.log(`  · plan: ${planned.body.detail}`);

  if (!apply) {
    console.log("");
    console.log(
      `DRY RUN — ${staged.length - found} staged file(s) would be uploaded, ${found} already there.\n` +
        `Nothing was written. To publish: node run.mjs content-publish --env ${shortEnv(env)} --apply\n`,
    );
    process.exit(0);
  }

  const published = await callSetup(env, {
    tool: "content_publish",
    mode: "apply",
    input: {},
    ...(planned.body.confirmation ? { confirmation: planned.body.confirmation } : {}),
  });
  if (!published.ok) {
    reportRefusal(published);
    process.exit(published.exitCode);
  }
  const refusedApply = toolRefusal(published.body);
  if (refusedApply) {
    bad(published.body.detail);
    console.log("");
    process.exit(1);
  }
  ok(`published: ${published.body.detail}`);

  // ── 3. the exit condition, named ─────────────────────────────────────────
  const partial = published.body.code === "contentPublishPartial";
  console.log("");
  console.log(
    `${partial ? "PARTIAL" : "Done"} — ${uploaded} file(s) uploaded, ${found} already there, ` +
      `${carried.length} carried by the image.`,
  );
  console.log(`Now prove it arrived: node run.mjs content-check --env ${shortEnv(env)}`);
  console.log(
    "  Green there means the rows and the files are PRESENT — not that the page renders.\n" +
      "  That is your eyes, on one real content page with a real slug.\n",
  );
  process.exit(partial ? 1 : 0);
}

/**
 * A stopped run names what it never looked at — the `store-sync.mjs` contract.
 *
 * "Done — 3 uploaded" over a run that gave up after three of forty is a true
 * number in a sentence that is a lie. And it stops BEFORE the appliers, always:
 * an applier that references a file whose row was never asserted fails on
 * `mediaIdFor()`, which is a confusing way to be told about a failed upload.
 */
function stopped(remainder, exitCode) {
  console.log("");
  console.log(
    remainder.length === 0
      ? "STOPPED — the run did not finish. Every other declared file had already been dealt with."
      : `STOPPED — nothing about the remainder is known. ${remainder.length} declared file(s) ` +
          `were never processed${remainder.length <= 10 ? `: ${remainder.join(", ")}` : ""}.`,
  );
  console.log(
    "The appliers did NOT run, so no lesson can point at a row that is not there.\n" +
      "Fix the cause and run this again — it is repeatable and skips what is already there.\n",
  );
  process.exit(exitCode);
}

/** What the operator types back: `--env prod`, not `--env production`. */
function shortEnv(env) {
  return env === "production" ? "prod" : env === "development" ? "dev" : env;
}

main().catch((error) => {
  console.error(`\n✗ content-publish failed: ${error.message}\n`);
  process.exit(1);
});
