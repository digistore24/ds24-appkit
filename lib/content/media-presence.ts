// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Is the product media the repo DECLARES actually in this environment's store?
//
// The manifest names each file, so the expected number is knowable here — which
// is what lets a missing one be NAMED rather than showing up as a smaller count
// nobody can act on.
//
// ── Two halves, because a row is not a file ────────────────────────────────
// 🚨 **This function used to answer the whole question by counting rows in
// `media`, and that count cannot see the state it exists to catch.** Measured
// at Story 34.4: with the row present and the bucket EMPTIED,
// `node run.mjs content-check` answered `✓ core product media: 1 of 1`, exit 0.
// The row is not evidence of the bytes — `content_publish` writes it itself out
// of the `sha256`/`bytes` the manifest records, so an apply against an empty
// bucket produces exactly that: a lesson whose media id resolves to an object
// that is not there.
//
// So the question is asked twice, of the two places that can answer it:
//
//   is there a `media` row?      the database — what the app serves FROM
//   are the bytes there?         one `head()` per declared file that has a row
//
// The cost is deliberate and named rather than optimised away: one store
// round-trip per declared file with a row, and an app whose bucket has lost an
// object goes from green to red on the command that gates its go-live. That is
// the point of the command.

import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { media } from "@/db/schema";
import {
  CONTENT_MEDIA_BUCKET_PREFIX,
  CONTENT_MEDIA_MANIFEST,
  PRODUCT_MEDIA_ITEM,
} from "@/lib/content-media/rules.mjs";
import { mediaStore, mediaStoreProblems } from "@/lib/media/store";
import type { PresenceItem } from "./presence";

/** `content/<topic>/<file>` → the deterministic key it lands at everywhere. */
/** One HEAD per declared file, bounded. Ten seconds is a metadata read, not a download. */
const HEAD_TIMEOUT_MS = 10_000;

const keyFor = (path: string) => CONTENT_MEDIA_BUCKET_PREFIX + path.replace(/^\/+/, "");

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * The half of `MediaStore` this asks — a HEAD, and nothing else.
 *
 * Narrow on purpose, the way `PublishStore` in `lib/content/publish.ts` is: a
 * presence check that could `getBytes()` is one somebody eventually makes read a
 * nine-hundred-megabyte video to find out whether it is there.
 */
export interface PresenceStore {
  /**
   * 🚨 `signal` is not optional decoration — the loop below BOUNDS its wait, and
   * it could not until this parameter existed. `MediaStore.head()` has carried
   * it since a bucket that accepts the connection and never answers was found
   * hanging the operations watchdog; the same bucket hangs `content-check --env
   * prod` here, once per declared file, and that command is the go-live's exit
   * condition. The existing `catch` turns the timeout into the third state
   * (`notChecked`) by itself.
   */
  head(key: string, signal?: AbortSignal): Promise<{ bytes: number } | null>;
}

/**
 * How the store is obtained.
 *
 * 🚨 **Throwing is a legitimate answer here, and it is the third state.** No
 * store configured is not "the objects are missing" — it is *nobody asked*, and
 * the message is the reason a reader gets told.
 */
export type PresenceStoreResolver = () => PresenceStore;

/**
 * This installation's store, or a throw naming why there is none to ask.
 *
 * `mediaStoreProblems()` first, because `mediaStore()` on a half-configured S3
 * throws a sentence about four environment variables while the problems list is
 * written for an operator (an endpoint carrying a path, for one, which builds a
 * store that then 403s on every key — that would arrive as "the objects are
 * gone" if the configuration question were not asked first).
 */
function configuredStore(): PresenceStore {
  const problems = mediaStoreProblems();
  if (problems.length > 0) throw new Error(problems[0]);
  return mediaStore();
}

/**
 * The one shape there is, and the refusal for everything else.
 *
 * 🚨 **This function used to read `manifest.files`, and no producer has ever
 * written that key.** The manifest is `{ "entries": [ { "path": … } ] }` —
 * validated in `scripts/content/_manifest.mjs`, loaded there, documented in
 * `docs/content.md`. So `declared` was `[]` for every real manifest, the early
 * return fired, and the core answered `product media: 0 of 0` for an app
 * declaring seven files: a green tick for a question that was never asked.
 * That is precisely the silence `presence.ts:21-25` argues against, produced by
 * the file that was supposed to break it.
 *
 * It therefore does not accept both keys "to be safe". There is one shape, it
 * is validated in one place, and a reader that accepts a shape nothing writes
 * is a reader that can never be wrong out loud — an unrecognised manifest is
 * *"I could not look"*, and `safely()` turns this throw into `unanswered`,
 * which is a failure. It must never become the *"no manifest"* item: that one
 * means *"there is nothing there"*, and the two are the distinction this whole
 * command exists for.
 */
function declaredPaths(manifest: unknown): string[] {
  const refuse = (why: string): never => {
    throw new Error(
      `${CONTENT_MEDIA_MANIFEST}: ${why}. Expected ` +
        `{ "entries": [ { "path": "<topic>/<file>.<ext>", … } ] } — see docs/content.md`,
    );
  };

  if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) {
    return refuse("the manifest is not a JSON object");
  }
  const entries = (manifest as { entries?: unknown }).entries;
  if (!Array.isArray(entries)) {
    return refuse('the manifest has no "entries" array');
  }

  return entries.map((entry, i) => {
    const path = (entry as { path?: unknown } | null)?.path;
    if (typeof path !== "string" || path === "") {
      return refuse(`entries[${i}] has no "path" string`);
    }
    return path;
  });
}

export async function mediaPresence(
  manifest: unknown,
  resolveStore: PresenceStoreResolver = configuredStore,
): Promise<PresenceItem> {
  const declared = declaredPaths(manifest);

  // Declaring nothing is legitimate — `expected: 0` says the manifest is here
  // and names no file, which is a different answer from the absent manifest's
  // `expected: null` (nothing declares an expected count at all). No row to
  // look for and no object to ask about: the store is not touched.
  if (declared.length === 0) {
    return { what: PRODUCT_MEDIA_ITEM, found: 0, expected: 0 };
  }

  // ── A. the rows ───────────────────────────────────────────────────────────
  const keys = declared.map(keyFor);
  const rows = await db
    .select({ storageKey: media.storageKey })
    .from(media)
    .where(inArray(media.storageKey, keys));

  const present = new Set(rows.map((row) => row.storageKey));
  // Names, not a count: "3 of 5 present" sends somebody looking through five
  // files, and the two that are missing are the answer. Each name carries WHICH
  // of the two halves failed — the row and the object are different repairs
  // (`content-publish` writes a row; only the bytes fix a missing object), and
  // a reader who is told only "missing" has to guess which one they are in.
  const missing: string[] = [];
  const withRow: string[] = [];
  for (const path of declared) {
    if (present.has(keyFor(path))) withRow.push(path);
    else missing.push(`${path} (no media row)`);
  }

  // ── B. the bytes ──────────────────────────────────────────────────────────
  // One `head()` per declared file that HAS a row. A declared file with no row
  // is already a finding, and asking the store about it would buy a round-trip
  // for a name that is on the list either way.
  let store: PresenceStore | null = null;
  let notChecked: string | null = null;

  if (withRow.length === 0) {
    // Not a skip that hides anything: every declared file is already named
    // above, so there is no tick for an unasked question to sit under.
    return {
      what: PRODUCT_MEDIA_ITEM,
      found: 0,
      expected: declared.length,
      missing,
      note: "media store: nothing to ask — no declared file has a media row",
    };
  }

  try {
    store = resolveStore();
  } catch (error) {
    notChecked = `the media store was not asked — ${messageOf(error)}`;
  }

  let asked = 0;
  let confirmed = 0;
  if (store) {
    for (const path of withRow) {
      try {
        const object = await store.head(keyFor(path), AbortSignal.timeout(HEAD_TIMEOUT_MS));
        asked += 1;
        if (object) confirmed += 1;
        else missing.push(`${path} (a media row, but no object in the store)`);
      } catch (error) {
        // 🚨 One store failure stops the loop and becomes *not asked*, never
        // *not there* — the `lib/content/publish.ts` byte loop's contract, and
        // here it is the whole design question. A HEAD that reports "missing"
        // on a network error would be worse than no HEAD at all: it turns every
        // unreachable bucket into a false alarm about the customer's content.
        notChecked =
          `the media store stopped answering after ${asked} of ${withRow.length} ` +
          `object(s) — ${messageOf(error)}`;
        break;
      }
    }
  }

  // What was never asked stays counted as present-by-row: this item must not
  // shrink because nobody looked. The `notChecked` reason is what stops that
  // number being read as a pass — `content-check` marks it `⏭` rather than `✓`.
  const unasked = withRow.length - asked;

  return {
    what: PRODUCT_MEDIA_ITEM,
    found: confirmed + unasked,
    expected: declared.length,
    missing: missing.length > 0 ? missing : undefined,
    // The evidence line. A tick without it is the claim this whole change
    // removed: it says how many objects were REALLY asked for, so "green" and
    // "green because nothing was asked" cannot render the same.
    note:
      `media store: ${asked} of ${withRow.length} declared object(s) asked by HEAD, ` +
      `${confirmed} present`,
    notChecked: notChecked ?? undefined,
  };
}
