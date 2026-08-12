// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Files on this machine's disk. **DEV only, and the app refuses to start
// otherwise** — see `lib/env-guard.ts`.
//
// ── Why it exists ──────────────────────────────────────────────────────────
// So that `node run.mjs start` in a fresh clone works with nothing booked and
// no credentials anywhere. A developer building the first version of a feature
// should not have to open an account with a cloud provider to see whether their
// upload form works.
//
// ── Why it must never leave DEV ────────────────────────────────────────────
// The moment an app has two nodes, each one has its own disk. An upload lands
// on one and the next request is answered by the other, so the file is there
// about half the time — which reads to the operator as an intermittent bug, and
// to their customer as an app that loses things. A redeploy loses everything at
// once. Neither failure appears while testing, because testing happens on one
// node, and that is exactly what makes a warning the wrong instrument. The
// refusal is in `lib/env-guard.ts` and the app does not start.
//
// ── There is no public URL here ────────────────────────────────────────────
// `publicUrl()` answers null, deliberately, and the layer above then routes
// every fetch through the app. That is the honest shape: on this driver there
// IS no address a browser can reach that is not the app. It also means the
// local and the cloud driver are exercised through different delivery paths,
// which `docs/visuals.md` says plainly rather than letting a developer conclude
// from a working DEV setup that production will behave the same.
import { mkdir, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

import type { MediaStore } from "./store";

/** Where the files go. Gitignored, and beside the other DEV state in `.dev/`. */
export const DEFAULT_LOCAL_DIR = ".data/media";

export function localDirFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  return env.MEDIA_LOCAL_DIR?.trim() || DEFAULT_LOCAL_DIR;
}

export function createLocalStore(root: string): MediaStore {
  const base = resolve(root);

  /**
   * The key's place on disk, refusing anything that would leave the folder.
   *
   * `rules.ts` derives every key this app writes, so a traversal cannot arrive
   * through the front door. This is the second lock: a key read back from the
   * database that somebody edited by hand, or a future caller that builds one
   * differently, stops here rather than at `/etc`.
   */
  function pathFor(key: string): string {
    const full = resolve(base, key);
    if (full !== base && !full.startsWith(base + sep)) {
      throw new Error(`media: refusing a key that leaves the store: ${key}`);
    }
    return full;
  }

  return {
    driver: "local",

    async put(key, body) {
      const target = pathFor(key);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, body);
    },

    async remove(key) {
      // `force` so removing something already gone is a success — the caller
      // asked for a state, not for an event.
      await rm(pathFor(key), { force: true });
    },

    async head(key) {
      // `pathFor` OUTSIDE the try, deliberately. It throws on a key that would
      // leave the folder, and catching that alongside "the file is not there"
      // would turn a traversal attempt into a quiet `null` — the one answer
      // that looks completely ordinary. Only the filesystem call is caught.
      const target = pathFor(key);
      try {
        const info = await stat(target);
        return { bytes: info.size };
      } catch {
        return null;
      }
    },

    async getBytes(key) {
      const target = pathFor(key);
      try {
        return new Uint8Array(await readFile(target));
      } catch {
        return null;
      }
    },

    async firstBytes(key, n) {
      // `pathFor` outside the try, for the reason `head()` states above.
      const target = pathFor(key);
      let handle;
      try {
        handle = await open(target, "r");
      } catch {
        return null;
      }
      try {
        const buffer = Buffer.alloc(Math.max(0, n));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        return new Uint8Array(buffer.subarray(0, bytesRead));
      } finally {
        await handle.close();
      }
    },

    async copy(fromKey, toKey) {
      // Read and write, because there is no provider to ask. The size question
      // the S3 driver's comment raises does not arise here: this driver is DEV
      // only (`lib/env-guard.ts`) and cannot mint an upload address at all, so
      // the only bytes it ever copies are a test's.
      //
      // `contentType` is unused — a file on disk carries no metadata to set.
      // Delivery reads the type from the `media` row either way, on every
      // driver.
      const source = pathFor(fromKey);
      const target = pathFor(toKey);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, await readFile(source));
    },

    publicUrl() {
      return null;
    },

    createUploadUrl() {
      // Nothing to write to but the app itself. A caller that gets null here is
      // not looking at a broken store — it is looking at DEV, and the honest
      // answer is that the direct path needs an S3 driver. The layer above says
      // exactly that rather than reporting the store unusable.
      return null;
    },

    signedUrl() {
      // Nothing to sign — there is no third party serving these bytes. The
      // layer above sees null and serves through `app/api/media/[id]`.
      return null;
    },
  };
}

/** For the check command's message, and for the local delivery route. */
export function localPathFor(root: string, key: string): string {
  return join(resolve(root), key);
}
