// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What a setup key IS — the shape, the hash and the visible prefix, in one
// place that both the app and the command line can read.
//
// ── Why this is `.mjs` ─────────────────────────────────────────────────────
// FOUR places mint or recognise a setup key, and two of them cannot import
// TypeScript:
//
//   lib/setup/manage.ts         — MINTS, for `/dashboard/admin/setup-keys`.
//                                 The one the app itself uses, and the one a
//                                 first draft of this file forgot while
//                                 announcing that the duplication was over.
//   lib/setup/rules.ts          — RECOGNISES, on every request. Never mints.
//   scripts/setup/bootstrap.mjs — MINTS the first key of an environment
//   scripts/setup/mint-key.mjs  — MINTS a further one for an existing owner
//
// It was two copies until 2026-08-12: `bootstrap.mjs` carried its own
// `KEY_PREFIX`, its own `randomBytes(32)` and its own sha256, because it cannot
// import `rules.ts`. Nothing was wrong with either copy — and that is the shape
// this repo already has a name for. `lib/ai/task-rules.mjs` ↔ `lib/ai/tasks.ts`
// is the same split for the same stated reason: *"so the app and the
// check-script use the SAME arithmetic, not two that agree today."* A third
// copy was about to be written for the third caller, which is when it stopped
// being a theory.
//
// The failure it prevents is quiet: change the byte count or the prefix in one
// place and keys still mint, still verify against THAT reader, and are refused
// by the other one with no error anybody can trace back.
//
// ⚠️ Nothing is read in this file. No `process.env`, no `readFileSync`, no `@/`
// alias — a file `scripts/` imports has none of the three available.

import { createHash, randomBytes } from "node:crypto";

/**
 * The visible marker every setup key carries.
 *
 * A credential must not widen by being pasted somewhere else, which is why this
 * surface has a prefix of its own rather than reusing the API module's
 * `ds24api_`. It is checked before any query, so a key wearing a foreign marker
 * never becomes a database round trip.
 */
export const SETUP_KEY_PREFIX = "ds24setup_";

/** Entropy behind the prefix. */
export const SETUP_KEY_BYTES = 32;

/**
 * How many characters that many bytes become in base64url — DERIVED.
 *
 * 🚨 It was written out as `43` in the guard's regex and again in the secret
 * scanner, which is the one constant this whole file's argument is about: raise
 * `SETUP_KEY_BYTES` to 33 with a literal elsewhere and `newSetupKey()` produces
 * a body the guard refuses, so **every** key stops authenticating at once, with
 * nothing red until somebody tries the surface.
 */
export const SETUP_KEY_BODY_CHARS = Math.ceil((SETUP_KEY_BYTES * 4) / 3);

/** How much of a key is kept in the clear, so a row can be told from a row. */
export const SETUP_KEY_PREFIX_SHOWN = SETUP_KEY_PREFIX.length + 4;

/** A fresh secret. Returned once; what is stored is `hashSecret()` of it. */
export function newSetupKey() {
  return SETUP_KEY_PREFIX + randomBytes(SETUP_KEY_BYTES).toString("base64url");
}

/** The stored form. The secret itself is shown once and never written down. */
export function hashSetupKey(secret) {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

/** The part of a key a listing may show — never enough to use it. */
export function setupKeyPrefixOf(secret) {
  return secret.slice(0, SETUP_KEY_PREFIX_SHOWN);
}
