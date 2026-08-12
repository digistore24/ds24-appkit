// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The one entry point to wherever this app's media lives.
//
// Nothing above this file knows which driver answered, the same way no call
// site of `runTask()` knows which AI company answered. `lib/media/s3.ts` and
// `lib/media/local.ts` are the only files that read a storage credential, which
// is the arrangement `lib/ai/providers/registry.ts` already has.
//
// ── The driver is decided by the environment, once ─────────────────────────
// `MEDIA_DRIVER=s3` is what anything online uses; `local` is a DEV convenience
// and `lib/env-guard.ts` refuses to start the app with it anywhere else. An
// unknown value **throws** rather than falling back — the same refusal
// `scripts/db/driver.mjs` makes, and for the same reason: quietly starting the
// wrong store is how an app ends up writing customer files somewhere nobody
// intended and nobody backs up.
//
// ── Where it may be read ───────────────────────────────────────────────────
// Server components, Server Actions, route handlers, scripts. Never a client
// component — it reads the environment.
import { createLocalStore, localDirFromEnv } from "./local";
import { createS3Store, s3SettingsFromEnv } from "./s3";

export type MediaDriver = "local" | "s3";

export interface SignedUrlOptions {
  expiresSeconds: number;
  /** Present for a download: the name the browser should save it as. */
  downloadFilename?: string;
  /** The media type recorded for the item, restated so the bucket returns it. */
  contentType?: string;
}

/**
 * What every driver can do.
 *
 * Deliberately small. There is no `list` and no `move`: this app knows what it
 * stored because it wrote a row, and a store that can be enumerated is one
 * somebody will enumerate instead of querying the database — at which point the
 * row and the object have two sources of truth.
 *
 * `copy` is the one addition, and it is not a convenience: it is what makes the
 * direct-to-bucket path's checks a promise rather than a measurement of one
 * moment. See `copy()` below.
 */
export interface MediaStore {
  readonly driver: MediaDriver;
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  remove(key: string): Promise<void>;
  head(key: string): Promise<{ bytes: number } | null>;
  getBytes(key: string): Promise<Uint8Array | null>;
  /** An address anybody may fetch, or null when this driver has none. */
  publicUrl(key: string): string | null;
  /** A short-lived address, or null when this driver has none (local). */
  signedUrl(key: string, options: SignedUrlOptions): string | null;

  /**
   * A short-lived address the BROWSER may write one object to — or null when
   * this driver has none.
   *
   * The second way into the same store, and the reason it exists is a ceiling:
   * an upload that travels through the app is bounded by what a request body
   * may carry, which is not enough for a lesson recording. Here the bytes never
   * touch the process, so the size stops being the app's problem — and starts
   * being a different one, stated plainly because it cannot be signed away: a
   * presigned `PUT` **cannot enforce a length**. `X-Amz-SignedHeaders` is
   * `host`, and a `content-length-range` condition exists only for POST
   * policies. The bucket takes what the bucket takes; the app measures
   * afterwards with `head()` and removes what is over. A short expiry is the
   * other half of that answer.
   *
   * Null on `local` for the same reason `signedUrl()` is null there: on that
   * driver there IS no address a browser can reach that is not the app.
   *
   * ⚠️ **There is no `contentType` parameter, and leaving it out is the
   * decision.** Signing one would oblige the browser to send that header back
   * byte for byte — a charset appended or the case changed is a 403 carrying
   * S3's own text, which the app cannot translate and the operator cannot
   * read. Nothing is lost: what a file IS gets decided by the confirm step
   * from its first bytes, and delivery restates the recorded type through
   * `response-content-type` (`signedUrl()`), so the type the bucket happens to
   * have stored is never the type anybody is told.
   */
  createUploadUrl(key: string, expiresSeconds: number): string | null;

  /**
   * The first `n` bytes of a stored object, or null when it is not there.
   *
   * The confirm step's instrument, and the reason it is not `getBytes()`: what
   * a file IS comes from its first bytes (`lib/media/sniff.ts` needs sixteen),
   * and reading a two-gigabyte video into the process to learn that would give
   * away everything `createUploadUrl()` just bought.
   */
  firstBytes(key: string, n: number): Promise<Uint8Array | null>;

  /**
   * Move an object's bytes from one key to another **inside the store**, and
   * record the type this app measured for them.
   *
   * 🚨 **The reason the direct path is a promise and not a snapshot.** A
   * presigned `PUT` is bounded by time, not by uses: whoever holds the address
   * may write it again, and again, until it expires. So the browser writes to
   * `stagingKey()`, the confirm step measures and sniffs THAT object, and then
   * copies it here onto the delivery key — which the client has never been
   * told and cannot reach. A later replay overwrites a key nothing serves.
   *
   * No byte travels through this process: on S3 this is a `PUT` carrying
   * `x-amz-copy-source`, so the provider moves them internally, and a two
   * gigabyte recording costs one request rather than one heap. The local driver
   * copies on disk.
   *
   * `contentType` is written rather than inherited (`x-amz-metadata-directive:
   * REPLACE`), and that is the second thing this buys: the type stored against
   * the object becomes the one the app read out of its first bytes instead of
   * the header the browser chose when it wrote to the bucket.
   *
   * ⚠️ A single-request copy tops out where a single presigned `PUT` does —
   * five gigabytes at the major providers, which is exactly where
   * `MAX_BYTES_CEILING` in `lib/media/config.ts` sits and why it sits there.
   */
  copy(fromKey: string, toKey: string, contentType: string): Promise<void>;
}

export function driverFromEnv(env: NodeJS.ProcessEnv = process.env): MediaDriver {
  const value = (env.MEDIA_DRIVER ?? "").trim().toLowerCase();
  // Empty means "nobody chose", and in DEV that is the ordinary state of a
  // fresh clone. `lib/env-guard.ts` is what makes it impossible anywhere else,
  // so this default cannot become a production default by accident.
  if (value === "" || value === "local") return "local";
  if (value === "s3") return "s3";
  throw new Error(
    `MEDIA_DRIVER="${value}" is not a driver. Use "s3" for anything that goes ` +
      `online, or "local" for development. See docs/visuals.md.`,
  );
}

let cached: MediaStore | null = null;

/**
 * The store this installation uses.
 *
 * Cached per process, because building it reads the environment and the answer
 * cannot change while the process runs.
 */
export function mediaStore(): MediaStore {
  if (cached) return cached;

  if (driverFromEnv() === "s3") {
    const settings = s3SettingsFromEnv();
    if (!settings) {
      throw new Error(
        "MEDIA_DRIVER=s3 but the bucket is not configured. Needs " +
          "MEDIA_S3_ENDPOINT, MEDIA_S3_BUCKET, MEDIA_S3_ACCESS_KEY_ID and " +
          "MEDIA_S3_SECRET_ACCESS_KEY. Check it with: node run.mjs media-check",
      );
    }
    cached = createS3Store(settings);
  } else {
    cached = createLocalStore(localDirFromEnv());
  }

  return cached;
}

/** Test seam, and the way a script switches store mid-run. */
export function resetMediaStore(): void {
  cached = null;
}

/** Is the store configured well enough to be used? For the check command and the guards. */
export function mediaStoreProblems(env: NodeJS.ProcessEnv = process.env): string[] {
  try {
    if (driverFromEnv(env) !== "s3") return [];

    const settings = s3SettingsFromEnv(env);
    if (!settings) {
      return [
        "MEDIA_DRIVER=s3, but MEDIA_S3_ENDPOINT / MEDIA_S3_BUCKET / " +
          "MEDIA_S3_ACCESS_KEY_ID / MEDIA_S3_SECRET_ACCESS_KEY are not all set",
      ];
    }

    // ── The endpoint is an ORIGIN, not a URL to the bucket ──────────────────
    // `objectPath()` puts the bucket in front of the key, so an endpoint that
    // already carries a path segment signs `/bucket/bucket/key` — every write a
    // 502 and every read a 403, with S3's own error text going to the log and
    // nothing anywhere saying what is wrong. It is an easy mistake to make:
    // every provider's dashboard shows the bucket URL, and pasting it is the
    // obvious thing to do.
    //
    // This used to be checked only inside `node run.mjs media-check`, which is
    // a command on a developer's laptop — so an operator who set the variable in
    // a hosting dashboard and deployed got a clean start and a dead feature.
    // Checked here, both routes already refuse with 503 and log the reason.
    try {
      const url = new URL(settings.endpoint);
      if (url.pathname !== "/" && url.pathname !== "") {
        return [
          `MEDIA_S3_ENDPOINT is "${settings.endpoint}", which carries a path. It must be ` +
            `the bare origin — "${url.protocol}//${url.host}" — because the bucket name is ` +
            `added to the path when a request is signed. As written, every object would be ` +
            `addressed as "${url.pathname}/${settings.bucket}/…".`,
        ];
      }
    } catch {
      return [
        `MEDIA_S3_ENDPOINT is "${settings.endpoint}", which is not a URL. It should look ` +
          `like "https://fra1.digitaloceanspaces.com".`,
      ];
    }
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
  return [];
}
