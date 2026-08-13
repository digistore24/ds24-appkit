// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 Publishing this repo's content INTO this environment — the applier route's
// writer, running inside the app that owns the rows.
//
// This is `scripts/content/apply.mjs` moved inside the running app: the same
// three steps in the same order, on the app's own postgres handle and the app's
// own media store, minus the shell and minus the staged leg (Story 34.4). The
// shell path stays and is not deprecated — an operator whose setup surface is
// switched off still has it, and a surface that ships OFF cannot be the only way
// to fill an environment.
//
// ── Why this file exists and is not a branch of lib/setup/tools.ts ─────────
// 🚨 **A media row insert may not live in `lib/setup/tools.ts`.** That file is
// the first entry on `lib/content/writers.test.ts`'s list of upload DOORS, and
// every door on it is held to `not.toMatch(/storageKey\s*:/)` — because a door
// that could choose a storage key could choose `content/…`, at which point an
// operator's upload is indistinguishable from declared product media. A media
// row written in Drizzle spells exactly that. So the tool is a thin caller, the
// way `content_presence` is a thin caller of `collectPresence()`, and the writer
// lives here.
//
// That is also the right shape for a second reason: this is the APPLIER route's
// writer, not an upload door. `media` is the one table in this app with two
// lawful writers, split by key prefix — everything uploaded gets a key DERIVED
// by `storageKey()` (which throws on the reserved `content` namespace), and
// everything declared in `content/media-manifest.json` gets the deterministic
// `content/<path>`. This file is the second holder of that prefix, and
// `writers.test.ts` carries the rule with an assertion beside it.
//
// ── The three steps, and why the order is not negotiable ───────────────────
//   A. **Media rows** from the manifest, upserted on `storage_key`. Without them
//      `mediaIdFor()` throws BY NAME and every applier that references a file
//      fails — so they come first, always.
//   B. **Bytes** from the shipped leg (`content/media/<path>`, carried by the
//      image) into this app's own store. HEAD first, so a re-run copies nothing.
//   C. **Appliers**, one transaction each, in enumeration order — the core's
//      first, then each installed module's, because an app's own tables are what
//      a module's content may point at and never the other way round.
//
// ── Everything is verified BEFORE the first transaction ────────────────────
// 🚨 The whole run refuses rather than passing over anything, and it refuses
// before it writes. Every applier is enumerated, imported and checked for an
// `apply()` in a pre-flight; only then does the first transaction open. Doing it
// the CLI's way — importing each applier as the run reaches it — is right THERE,
// where a line is printed to an operator watching a shell they control. Here the
// whole publish is ONE act with ONE audit row, so a refusal discovered after
// applier #1 committed is not a refusal at all: it is a partial run with an
// explanation.

import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { applierSql } from "@/db";
import {
  CONTENT_MEDIA_MANIFEST,
  CONTENT_MEDIA_SHIPPED_DIR,
} from "@/lib/content-media/rules.mjs";
import { mediaStore } from "@/lib/media/store";
// 🚨 **The one spelling of the key**, and a STATIC import so that nothing can
// quietly replace it with a literal: `keyFor()` is what the CLI's own
// `mediaIdFor` uses (`scripts/content/apply.mjs`), so the app-side and the
// shell-side resolve identically by CONSTRUCTION rather than by agreement. It is
// itself `CONTENT_MEDIA_BUCKET_PREFIX + path` — and never `storageKey()`, which
// throws on the reserved `content` namespace because the upload route's key
// space is the other half of this partition. `writers.test.ts` holds both ends.
import { keyFor } from "@/scripts/content/_manifest.mjs";
import { normalisePlan, readOnlyTransaction, type PlanSql } from "./applier-plan";

/**
 * The wall clock a publish is allowed, checked BETWEEN appliers.
 *
 * ⚠️ **A bound, not a measurement, and it is worth saying which.** There is no
 * `maxDuration` anywhere in this app, and the four supported hosts' reverse-proxy
 * timeouts are UNMEASURED — nobody has yet timed how long Railway, Render, Fly
 * or DigitalOcean let one request run. Until somebody does, the honest instrument
 * is the app stopping before the proxy does, and 25 seconds is chosen to sit
 * under the shortest plausible cut rather than derived from one.
 *
 * 🚨 **What the four hosts DOCUMENT is a THIRD state, and it is not a
 * measurement either.** *"Nobody looked"*, *"there is no value"* and *"the
 * provider claims X"* are three different sentences and this comment says all
 * three. Read on **2026-08-12**, in the providers' own documentation only:
 *
 * - **Railway — 5 min.** An HTTP request *"can run for up to 15 minutes if data
 *   keeps transferring … and [is] otherwise closed after 5 minutes with no data
 *   transferred"*.
 *   `https://docs.railway.com/networking/public-networking/specs-and-limits`
 * - **Render — 100 min.** *"Render web services allow HTTP responses to take up
 *   to 100 minutes."* `https://render.com/docs/render-vs-vercel-comparison`
 * - **Fly — NO VALUE DOCUMENTED.** The `fly.toml` reference has
 *   `http_service.http_options.idle_timeout` and gives `600` as an EXAMPLE, with
 *   neither a default nor a maximum stated anywhere in the docs; the 60 s
 *   everyone quotes comes from forum answers, not from documentation.
 *   `https://fly.io/docs/reference/configuration/#http_service-http_options-idle_timeout`
 * - **DigitalOcean — NO VALUE DOCUMENTED for a request.** The App Platform
 *   limits page states no request timeout at all (only *"File uploads to apps
 *   timeout after 600 seconds"*).
 *   `https://docs.digitalocean.com/products/app-platform/details/limits/`
 *   The single number on that docs domain is **30 s**, and it is in a **PHP**
 *   support article — *"By default, App Platform allows your app 30 seconds to
 *   execute a request before timing out"*, raised via PHP's own
 *   `max_execution_time` to at most 100 s. That is a PHP-FPM knob, so it says
 *   nothing certain about the Node process this app is.
 *   `https://docs.digitalocean.com/support/my-php-app-is-timing-out-and-throwing-5xx-errors/`
 *
 * Nothing documented sits under 25 s, so the budget is not known to be broken
 * anywhere. ⚠️ But the smallest number found is 30 s, and the margin is thinner
 * than the five seconds suggest: the budget is checked BETWEEN appliers, so a
 * publish may legitimately run 25 s PLUS however long the last applier it
 * started takes. Whoever raises this number needs the measurement A51 asks for
 * — and so does whoever lowers it.
 *
 * Checked between appliers and NEVER inside one: half an applier is exactly what
 * the per-applier transaction exists to prevent. A retry is safe — every applier
 * upserts by slug, so running it again asserts rather than duplicates.
 */
export const PUBLISH_BUDGET_MS = 25_000;

/**
 * A refusal, in the shape `dispatch.ts` recognises.
 *
 * `class X extends Error` with a camelCase `readonly code` is what
 * `domainCodeOf()` matches on — by SHAPE, deliberately, so that a domain it has
 * never imported still gets an answer rather than a 500. The consequence here is
 * the one AC 2 asks for: the audit row says `outcome: "refused"` with this code
 * and `rows: 0`, which no returned `SetupResult` could produce (the success path
 * records `applied`).
 */
export class PublishError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PublishError";
    this.code = code;
  }
}

/** The little of a postgres.js handle this writer uses: transactions, and a tag. */
export type PublishTag = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<Record<string, unknown>[]>;

export interface PublishSql {
  begin<T>(fn: (tx: PublishTag) => Promise<T>): Promise<T>;
}

/** The half of `MediaStore` a publish touches — HEAD, then PUT what is missing. */
export interface PublishStore {
  head(key: string): Promise<{ bytes: number } | null>;
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
}

/** What ONE applier did, or why it did not. */
export interface PublishedApplier {
  readonly label: string;
  readonly module: string | null;
  /** Did its transaction commit? A false here is a rolled-back applier. */
  readonly ran: boolean;
  /**
   * Rows it asserted.
   *
   * `null` when the applier returned something that is not a finite number —
   * reported as *"ran"* rather than as `0`, because an applier may legitimately
   * return nothing and a zero would be a claim about its work.
   */
  readonly rows: number | null;
  /**
   * How the rows split, from the applier's own `plan(sql)` taken immediately
   * before the write. `null` when it has no planner, or the planner could not
   * answer — the split is a nicety, the write is the job.
   */
  readonly created: number | null;
  readonly changed: number | null;
  readonly problems?: readonly string[];
}

/** What the media half did. `null` when this app declares no manifest at all. */
export interface PublishedMedia {
  readonly declared: number;
  readonly rowsCreated: number;
  readonly rowsChanged: number;
  readonly copied: number;
  readonly present: number;
  /** Declared entries with no file here and no recorded sha256/bytes. */
  readonly skipped: readonly string[];
  /** The `store-sync.mjs` contract: what a stopped byte run never looked at. */
  readonly unprocessed: readonly string[] | null;
}

export interface PublishReport {
  readonly appEnv: string;
  readonly appliers: readonly PublishedApplier[];
  readonly media: PublishedMedia | null;
  /** Rows this run can PROVE are new — every planner's `created`, plus new media rows. */
  readonly created: number;
  /** Everything else that was written. `created + changed` is what committed. */
  readonly changed: number;
  readonly rows: number;
  /** Did anything not happen that was meant to? Then the trail must say so. */
  readonly partial: boolean;
  /** Appliers the run never reached — the budget, or a stop. Never a bare "Done". */
  readonly unreached: readonly string[];
  readonly problems: readonly string[];
}

export interface PublishOptions {
  readonly appEnv: string;
  /** The app root. `process.cwd()` in the running app — see `presence.ts`. */
  readonly root?: string;
  readonly budgetMs?: number;
  /** The clock, for the budget. A test seam; the app passes nothing. */
  readonly now?: () => number;
  readonly sql?: PublishSql;
  readonly store?: PublishStore;
  /** The installed module ids, for a test that has no `config/modules.json`. */
  readonly ids?: string[];
}

/**
 * Publish: media rows, then the shipped bytes, then every applier.
 *
 * Throws a `PublishError` — and writes NOTHING — when the run cannot be made
 * whole before it starts: an applier directory that cannot be read, an applier
 * that exports no `apply()`, a manifest that does not judge. Everything after
 * the first transaction is reported rather than thrown, because by then the
 * question is no longer "may this run" but "what did it do".
 */
export async function publishContent(options: PublishOptions): Promise<PublishReport> {
  const root = options.root ?? process.cwd();
  const sql = options.sql ?? (applierSql as unknown as PublishSql);
  const now = options.now ?? Date.now;
  const budgetMs = options.budgetMs ?? PUBLISH_BUDGET_MS;

  const problems: string[] = [];

  // ── the pre-flight ───────────────────────────────────────────────────────
  // Enumerate → import every one → assert `apply` on every one. Any failure in
  // this pass is a refusal with nothing written.
  const loaded = await preflight(root, options.ids);

  const manifest = await loadEntries(root);

  // The honest no-op, one line: an app that ships no content runs this in every
  // go-live checklist anyway. Note what it is NOT: an unreadable applier
  // directory never reaches here — `preflight()` threw with the path.
  if (loaded.length === 0 && manifest.entries.length === 0) {
    return {
      appEnv: options.appEnv,
      appliers: [],
      media: manifest.declared ? emptyMedia() : null,
      created: 0,
      changed: 0,
      rows: 0,
      partial: false,
      unreached: [],
      problems: [],
    };
  }

  // ── A + B. the media half ────────────────────────────────────────────────
  let media: PublishedMedia | null = null;
  let mediaFailed = false;
  if (manifest.declared) {
    const done = await publishMedia({
      sql,
      store: options.store ?? mediaStore(),
      rows: manifest.rows,
      skipped: manifest.skipped,
      problems,
    });
    media = done.media;
    mediaFailed = done.failed;
  }

  // ── C. the appliers ──────────────────────────────────────────────────────
  const deadline = now() + budgetMs;
  const appliers: PublishedApplier[] = [];
  const unreached: string[] = [];
  // ⚠️ A declared entry with no file and no recorded hash is a WARNING and not a
  // partial run — the same ruling `content-apply` makes, where it is a `warn()`
  // and not a `bad()`. What makes a run partial is something that was attempted
  // and did not land.
  let partial = mediaFailed;

  for (const [index, entry] of loaded.entries()) {
    // ⚠️ Between appliers, never inside one. And the stopped run NAMES what it
    // never reached — "Done — 3 applied" over a run that gave up after three of
    // forty is a true number in a sentence that is a lie.
    if (now() >= deadline) {
      for (const rest of loaded.slice(index)) unreached.push(rest.label);
      partial = true;
      problems.push(
        `the ${Math.round(budgetMs / 1000)}s publish budget ran out — ${unreached.length} ` +
          `applier(s) were never reached: ${unreached.join(", ")}. What ran is committed; ` +
          `run it again, every applier upserts`,
      );
      break;
    }

    const done = await runApplier(sql, entry);
    appliers.push(done);
    for (const problem of done.problems ?? []) problems.push(problem);
    if (!done.ran) partial = true;
  }

  const created =
    (media?.rowsCreated ?? 0) +
    appliers.reduce((sum, applier) => sum + (applier.created ?? 0), 0);
  const rows =
    (media?.rowsCreated ?? 0) +
    (media?.rowsChanged ?? 0) +
    // An applier that returned no finite count contributes nothing to the audit's
    // number. It RAN, and the report says so in words; inventing a row count for
    // it would put a figure in an append-only table that nobody measured.
    appliers.reduce((sum, applier) => sum + (applier.rows ?? 0), 0);

  return {
    appEnv: options.appEnv,
    appliers,
    media,
    created,
    // Everything written that this run cannot prove was new. An applier with no
    // planner lands here whole rather than being counted as a creation nobody
    // measured — the audit's `rows` stays exact either way, and overstating
    // `created` is what would make a re-run indistinguishable from a first run.
    changed: Math.max(0, rows - created),
    rows,
    partial,
    unreached,
    problems,
  };
}

// ── the pre-flight ─────────────────────────────────────────────────────────

interface LoadedApplier {
  readonly label: string;
  readonly module: string | null;
  readonly apply: (tx: PublishTag, helpers: ApplierHelpers) => Promise<unknown>;
  readonly plan?: (tx: PublishTag) => Promise<unknown>;
}

interface ApplierHelpers {
  mediaIdFor(path: string): Promise<string>;
}

async function preflight(root: string, ids?: string[]): Promise<LoadedApplier[]> {
  const { applierSources } = await import("@/scripts/content/_appliers.mjs");

  // 🚨 NOT wrapped in a try/catch that produces an empty list. `applierSources()`
  // throws on a directory it cannot read — `ENOENT` included, because "not
  // carried into a built output" IS `ENOENT` — and on a module declaring
  // `appliers` with no `.mjs` in it. Answering "nothing to publish" for either
  // would rebuild, inside the writer, the silence the enumerator was rewritten
  // to end: "I could not look" and "there is nothing there" stay different
  // answers. It becomes a refusal carrying the enumerator's own sentence.
  let sources: { label: string; file: string; module: string | null }[];
  try {
    sources = applierSources(root, ids);
  } catch (error) {
    throw new PublishError(
      "appliersUnreadable",
      `could not enumerate this app's appliers, so NOTHING was published — ${messageOf(error)}`,
    );
  }

  const loaded: LoadedApplier[] = [];
  for (const source of sources) {
    let module: Record<string, unknown>;
    try {
      // 🚨 **The bundler has to be told to keep its hands off**, exactly as in
      // `applier-presence.ts` and `applier-plan.ts` — this runs inside the Next
      // bundle, where a fully dynamic specifier answers "Cannot find module as
      // expression is too dynamic". A file URL rather than a bare path: a native
      // dynamic import of an absolute path is deprecated on POSIX and fails
      // outright on Windows, and this template ships to three systems.
      module = (await import(
        /* webpackIgnore: true */ /* turbopackIgnore: true */ /* @vite-ignore */
        pathToFileURL(source.file).href
      )) as Record<string, unknown>;
    } catch (error) {
      throw new PublishError(
        "applierUnloadable",
        `${source.label} could not be loaded, so NOTHING was published — ${messageOf(error)}. ` +
          `Every applier is loaded and checked before the first row is written, because a ` +
          `publish is one act: a refusal found after the first applier committed would not be ` +
          `a refusal, it would be a partial run with an explanation.`,
      );
    }

    if (typeof module.apply !== "function") {
      throw new PublishError(
        "applierWithoutApply",
        `${source.label} exports no apply(sql, helpers) function, so NOTHING was published. ` +
          `The whole run refuses rather than passing over an applier — content that is passed ` +
          `over is content that will not exist in this environment (docs/content.md).`,
      );
    }

    loaded.push({
      label: source.label,
      module: source.module,
      apply: module.apply as LoadedApplier["apply"],
      plan: typeof module.plan === "function" ? (module.plan as LoadedApplier["plan"]) : undefined,
    });
  }

  return loaded;
}

// ── A + B. the media half ──────────────────────────────────────────────────

interface ManifestRow {
  readonly path: string;
  readonly key: string;
  readonly kind: string;
  readonly contentType: string;
  readonly visibility: string;
  readonly planKeys: readonly string[];
  readonly alt: string | null;
  readonly filename: string;
  readonly bytes: number;
  readonly sha256: string;
  /** The file on THIS machine, when the image carries it. */
  readonly source: string | null;
}

interface LoadedManifest {
  /** Is there a manifest at all? Absent is a legitimate state, not a problem. */
  readonly declared: boolean;
  readonly entries: readonly unknown[];
  readonly rows: readonly ManifestRow[];
  readonly skipped: readonly string[];
}

/**
 * The manifest, judged by the ONE reader of it
 * (`scripts/content/_manifest.mjs`), and enriched with what this machine holds.
 *
 * A manifest with problems is a REFUSAL before anything is written — the same
 * ruling `content-apply` makes ("Fix the manifest first — nothing was applied"),
 * for the same reason: a bad entry would otherwise become a bad object key, or a
 * a `planKeys` entry that turns a page into a 500 rather than a refusal.
 */
async function loadEntries(root: string): Promise<LoadedManifest> {
  const { loadManifest } = await import("@/scripts/content/_manifest.mjs");
  const manifest = loadManifest(root) as
    | { missing: true }
    | { entries: Record<string, unknown>[]; problems: string[] };

  if ("missing" in manifest) {
    return { declared: false, entries: [], rows: [], skipped: [] };
  }
  if (manifest.problems.length > 0) {
    throw new PublishError(
      "contentManifestInvalid",
      `${CONTENT_MEDIA_MANIFEST} does not judge, so NOTHING was published — ` +
        `${manifest.problems.join("; ")}`,
    );
  }

  const rows: ManifestRow[] = [];
  const skipped: string[] = [];
  for (const entry of manifest.entries) {
    const path = String(entry.path);
    const source = shippedFile(root, path);

    if (source) {
      const body = readFileSync(source);
      rows.push({
        ...(entry as unknown as ManifestRow),
        path,
        bytes: body.length,
        sha256: createHash("sha256").update(body).digest("hex"),
        source,
      });
    } else if (typeof entry.sha256 === "string" && typeof entry.bytes === "number") {
      // Staged on the operator's machine and already synced: the manifest
      // RECORDS both numbers, so the row is honest without the file.
      rows.push({ ...(entry as unknown as ManifestRow), path, source: null });
    } else {
      // ⚠️ Never a row with invented numbers. `media.sha256` became nullable for
      // the direct-to-bucket path, where the app genuinely never holds the
      // bytes; this writer is the opposite case — it HAS the file or it has
      // nothing, so an absent hash here would be a gap it could have filled.
      skipped.push(
        `${path} — no file under ${CONTENT_MEDIA_SHIPPED_DIR}/ and no sha256/bytes in ` +
          `${CONTENT_MEDIA_MANIFEST}; no row written. Stage it and run content-media-sync ` +
          `first (it records both)`,
      );
    }
  }

  return { declared: true, entries: manifest.entries, rows, skipped };
}

/** Where an entry's file is in the IMAGE. The staged leg is Story 34.4's. */
function shippedFile(root: string, path: string): string | null {
  const full = join(root, ...CONTENT_MEDIA_SHIPPED_DIR.split("/"), ...path.split("/"));
  try {
    return statSync(full).isFile() ? full : null;
  } catch {
    return null;
  }
}

function emptyMedia(): PublishedMedia {
  return {
    declared: 0,
    rowsCreated: 0,
    rowsChanged: 0,
    copied: 0,
    present: 0,
    skipped: [],
    unprocessed: null,
  };
}

async function publishMedia(input: {
  sql: PublishSql;
  store: PublishStore;
  rows: readonly ManifestRow[];
  skipped: readonly string[];
  problems: string[];
}): Promise<{ media: PublishedMedia; failed: boolean }> {
  const { sql, store, rows, skipped, problems } = input;
  for (const line of skipped) problems.push(line);

  if (rows.length === 0) {
    return { media: { ...emptyMedia(), declared: 0, skipped: [...skipped] }, failed: false };
  }

  // ── A. the rows ──────────────────────────────────────────────────────────
  // One transaction: the manifest's rows are one class and travel together.
  // Rows the manifest DEFINES belong to the manifest — every run re-asserts
  // them; rows it does not mention are never touched.
  let rowsCreated = 0;
  let rowsChanged = 0;
  let failed = false;
  try {
    const written = await sql.begin(async (tx) => {
      const before = new Set(
        (
          await tx`select storage_key from media where storage_key like ${keyPrefixLike()}`
        ).map((row) => String(row.storage_key)),
      );

      let created = 0;
      let changed = 0;
      for (const row of rows) {
        await tx`
          insert into media (id, owner_id, kind, visibility, plan_keys,
                             storage_key, mime, filename, bytes, sha256, source, alt)
          values (${crypto.randomUUID()}, null, ${row.kind}, ${row.visibility},
                  ${[...row.planKeys]}, ${row.key}, ${row.contentType}, ${row.filename},
                  ${row.bytes}, ${row.sha256}, 'upload', ${row.alt})
          on conflict (storage_key) do update set
            kind = excluded.kind,
            visibility = excluded.visibility,
            plan_keys = excluded.plan_keys,
            mime = excluded.mime,
            filename = excluded.filename,
            bytes = excluded.bytes,
            sha256 = excluded.sha256,
            alt = excluded.alt`;
        if (before.has(row.key)) changed += 1;
        else created += 1;
      }
      return { created, changed };
    });
    rowsCreated = written.created;
    rowsChanged = written.changed;
  } catch (error) {
    problems.push(`product media rows — none were written: ${messageOf(error)}`);
    failed = true;
  }

  // ── B. the bytes ─────────────────────────────────────────────────────────
  // HEAD first, so what is already there is skipped — that is what makes a
  // re-run cheap and safe. One store failure stops the loop (retrying every key
  // only slows it down) and the tail is NAMED, the `store-sync.mjs` contract.
  let copied = 0;
  let present = 0;
  let unprocessed: string[] | null = null;
  const carried = rows.filter((row) => row.source !== null);

  for (const [index, row] of carried.entries()) {
    try {
      if (await store.head(row.key)) {
        present += 1;
        continue;
      }
      await store.put(row.key, readFileSync(row.source!), row.contentType);
      copied += 1;
    } catch (error) {
      problems.push(`${row.path} — the store stopped answering: ${messageOf(error)}`);
      unprocessed = carried.slice(index).map((rest) => rest.path);
      failed = true;
      break;
    }
  }

  return {
    media: {
      declared: rows.length,
      rowsCreated,
      rowsChanged,
      copied,
      present,
      skipped: [...skipped],
      unprocessed,
    },
    failed,
  };
}

// ── The staged leg's row, written one at a time ────────────────────────────
//
// 🚨 **The other caller of this file's half of the partition, and it lives here
// for the same mechanical reason the bulk writer does** (see the header): a
// media row insert in `lib/setup/tools.ts` would spell `storageKey:`, and
// `lib/content/writers.test.ts` fails the build on that in every upload door.
//
// It exists because `publishContent()` above cannot see the staged leg at all —
// `.data/content-media/` is on the operator's machine and not in the image. So
// `content_media_confirm` is what asserts a row for a file the app has only ever
// seen arrive in its own bucket, and this is where that row is written.
//
// ⚠️ **`sha256` is the manifest's recorded value and is NOT verified against
// what landed.** Reading the object back to hash it is the whole cost this path
// exists to avoid — a nine-hundred-megabyte video through the process for a
// number the operator already computed on their own machine with
// `content-media-sync`. What IS checked, by the tool before it calls this, is
// the LENGTH (`head()`) and the KIND (`firstBytes()` + `sniff.ts`). The recorded
// hash is the same claim `content-apply` writes today for exactly the same
// entries (`apply.mjs`, the `else if (entry.sha256 && entry.bytes)` branch).
// Nothing here, and nothing in the guidance, may say "verified".

/** One manifest entry, judged by `validateManifest()` and enriched by the caller. */
export interface ContentMediaRow {
  readonly path: string;
  readonly kind: string;
  readonly contentType: string;
  readonly visibility: string;
  readonly planKeys: readonly string[];
  readonly alt: string | null;
  readonly filename: string;
  readonly bytes: number;
  readonly sha256: string;
}

/**
 * Assert the `media` row one manifest entry defines, and say whether it is new.
 *
 * Rows the manifest DEFINES belong to the manifest — the same rule step A above
 * keeps, so a second call re-asserts rather than duplicating. The `created`
 * answer is what lets the tool's audit row distinguish a first publish from a
 * re-run: both write one row, and only one of them created anything.
 */
export async function assertContentMediaRow(
  row: ContentMediaRow,
  handle?: PublishSql,
): Promise<{ created: boolean; key: string }> {
  const sql = handle ?? (applierSql as unknown as PublishSql);
  const key = keyFor(row.path);

  return sql.begin(async (tx) => {
    const before = await tx`select 1 from media where storage_key = ${key}`;
    await tx`
      insert into media (id, owner_id, kind, visibility, plan_keys,
                         storage_key, mime, filename, bytes, sha256, source, alt)
      values (${crypto.randomUUID()}, null, ${row.kind}, ${row.visibility},
              ${[...row.planKeys]}, ${key}, ${row.contentType}, ${row.filename},
              ${row.bytes}, ${row.sha256}, 'upload', ${row.alt})
      on conflict (storage_key) do update set
        kind = excluded.kind,
        visibility = excluded.visibility,
        plan_keys = excluded.plan_keys,
        mime = excluded.mime,
        filename = excluded.filename,
        bytes = excluded.bytes,
        sha256 = excluded.sha256,
        alt = excluded.alt`;
    return { created: before.length === 0, key };
  });
}

/** Every key on the applier route's own half of `media`, for the `like` above. */
function keyPrefixLike(): string {
  // Composed from `keyFor("")` rather than from a literal, so this file carries
  // no second spelling of the prefix — see `writers.test.ts`.
  return `${keyFor("")}%`;
}

// ── C. one applier ─────────────────────────────────────────────────────────

async function runApplier(sql: PublishSql, entry: LoadedApplier): Promise<PublishedApplier> {
  const { label, module } = entry;

  // The split, taken immediately before the write and in a transaction of its
  // own. It is what lets a re-run be VISIBLE — a first publish reports its rows
  // as created, a second reports the same rows as re-asserted — and an applier
  // returns one undivided count, so there is nowhere else to get it. It is a
  // nicety and never a gate: a planner that is absent or that fails costs the
  // split and nothing else, which is why it does not share the write's
  // transaction (a failed statement aborts a Postgres transaction whole).
  let created: number | null = null;
  if (entry.plan) {
    try {
      const raw = await readOnlyTransaction(sql as unknown as PlanSql, (tx) =>
        entry.plan!(tx as unknown as PublishTag),
      );
      const report = normalisePlan(label, module, raw);
      if (report.answered) created = report.created ?? 0;
    } catch {
      /* the split is a nicety; the write is the job */
    }
  }

  try {
    const count = await sql.begin(async (tx) => {
      // Built the way `scripts/content/apply.mjs` builds it, and throwing BY
      // NAME on a missing row is the point: a typo fails the run instead of
      // quietly wiring a null. One spelling of the key — `keyFor()` from
      // `_manifest.mjs`, the one the CLI's own `mediaIdFor` uses — so app-side
      // and CLI-side resolve identically by construction rather than by
      // agreement.
      const mediaIdFor = async (path: string): Promise<string> => {
        const found = await tx`select id from media where storage_key = ${keyFor(path)}`;
        if (found.length === 0) {
          throw new Error(
            `mediaIdFor("${path}"): no media row at ${keyFor(path)} — is the entry in ` +
              `${CONTENT_MEDIA_MANIFEST}? Rows are asserted in step A of this same act`,
          );
        }
        return String(found[0].id);
      };
      return entry.apply(tx, { mediaIdFor });
    });

    // ⚠️ `Number.isFinite` and not a truthiness test: an applier may legitimately
    // return nothing, and that is reported as *"ran"* rather than as `0` — the
    // same branch `scripts/content/apply.mjs` already draws. A zero would be a
    // claim about its work that nobody made.
    const rows = typeof count === "number" && Number.isFinite(count) ? count : null;
    // A split can only be reported against a number it splits, and only when a
    // planner answered. Both null means "it wrote, and how much of that was new
    // is not knowable from here" — never a zero standing in for an unknown.
    const split = rows === null || created === null ? null : Math.min(created, rows);
    return {
      label,
      module,
      ran: true,
      rows,
      created: split,
      changed: split === null || rows === null ? null : Math.max(0, rows - split),
    };
  } catch (error) {
    // 🚨 One transaction per applier, so a throw rolls THAT applier back whole
    // and is reported loudly. The run carries on to the next one — the failure
    // was this applier's own, and an enumeration failure or a missing `apply()`
    // never gets this far.
    return {
      label,
      module,
      ran: false,
      rows: 0,
      created: 0,
      changed: 0,
      problems: [`${label} — failed and was rolled back: ${messageOf(error)}`],
    };
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
