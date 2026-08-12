// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The one value that makes a difference between two courses VISIBLE without
// downloading either of them — and the one place it is computed.
//
// ── Why this file is `.mjs`, and why that is the whole point ───────────────
// 🚨 There are two sides to a comparison. The TARGET's side is computed inside
// the app (`./outline.ts` → `outlinePayload()`, bundled by Next); the LOCAL side
// is computed by `node run.mjs courses-diff`, and **every `run.mjs` command in
// this template is bare Node with no bundler and no TypeScript** (`../check.mjs`
// is this module's own precedent). A bare-Node command cannot import a `.ts`
// file at all.
//
// The answer is this file, not a second implementation. Re-spelling the hash in
// `.mjs` "just for the command" would ship exactly the defect the surface was
// built to prevent: *one definition of what "changed" means rather than two that
// agree today*. Two implementations agree until the day one of them is edited,
// and then a publish preview says "untouched" about a lesson that differs.
//
// It is the house pattern and not an invention — `lib/cron/rules.mjs` ←
// `lib/cron/scheduler.ts`, `lib/email-from.mjs` ← `lib/env-guard.ts`,
// `lib/digistore/config.mjs` ← `lib/digistore/client.ts`. One implementation,
// two readers.
//
// ── What the fingerprint is, and what it is not ────────────────────────────
// It is a **comparison key**: a lesson's own content, reduced to one hex string,
// so "has this lesson changed" is a string equality instead of a megabyte of
// prose travelling over the setup surface. It is **not a secret** and never a
// credential — anybody holding the lesson can recompute it — and it is **not a
// way to reconstruct the lesson**: a hash is one-way, and `setup/tools.ts`'s
// refusal to put a body on this surface stands exactly as it did.
//
// ── Why it lives HERE and not in `../rules.ts` ─────────────────────────────
// 🚨 `rules.ts` is this module's `coreExport` — it is copied into a mobile
// companion's repo, where there is no Node. `scripts/core/purity.test.ts` fails
// any file in that list, or in its import closure, that imports a Node builtin,
// and `node:crypto` is one. This file is the module's own shell-free half in the
// other sense: pure (no database, no clock), but Node-bound, so it stays out of
// the export.
//
// ── The algorithm, and why exactly this spelling ───────────────────────────
// SHA-256, lowercase hex, all 64 characters, never truncated. `node:crypto` is
// what `template/CLAUDE.md` → *Three systems* prescribes in place of `openssl`,
// and it behaves identically on Linux, macOS and Git Bash. Nothing in this
// template truncates an identity hash — `.template-version`, `media.sha256`, the
// API and setup key hashes are all full 64-char hex, and
// `scripts/content/_manifest.mjs` validates a stored content hash as
// `/^[0-9a-f]{64}$/`. Sixty lessons × 64 chars is under four kilobytes, so there
// is no payload reason to depart from the house shape.
//
// The canonical string is a **hand-ordered object**, hashed as its
// `JSON.stringify` — the shape `offerHash()` in `lib/digistore/buyUrl.ts`
// already uses for exactly this job. `JSON.stringify` solves escaping and
// separators and, the point that matters, keeps `null` and `""` distinguishable:
// a lesson the applier wrote as `body: null` and one written as `body: ""` are
// different rows and must fingerprint differently.
//
// ⚠️ Deliberately NOT `canonicalJson()` from `lib/setup/rules.ts`. That one sorts
// the keys of an object whose order is not under the author's control (a tool's
// `arguments`). Here the order IS authored, once, below — there is nothing to
// canonicalise, and importing the core setup surface's helper into a module
// would be the wrong dependency direction anyway.
//
// The leading `v` tag makes the shape self-describing. Changing the field list
// later moves every fingerprint in every environment; that is acceptable and
// legible **because the tag is there to bump**. Silent re-keying is what it
// prevents.
//
// ── What is hashed: exactly what the applier writes ────────────────────────
// `content/appliers/course.mjs` upserts `courses_units` by slug and sets, on
// conflict: `block_id`, `title`, `position`, `body`, the four media ids and
// `task_prompt`. Fingerprinting anything the applier does NOT write would
// compare something a publish cannot change; fingerprinting less would hide a
// change a publish would make.
//
// What is excluded, and why each one would be a defect:
//
//   * `position` (unit AND block) — the value has to move on a CONTENT change.
//     Fold position in and re-ordering a course lights every lesson up as
//     "would change". Position is its own field on the payload, so a reorder
//     stays fully visible without the fingerprint moving.
//   * `id` — a UUID minted per database. Two environments holding identical
//     content would disagree, which is the exact failure this exists to prevent.
//   * `blockId`, `createdAt` — same reason, and already excluded for us:
//     `courseOutline()` strips both off each unit on the way out.
//   * 🚨 the four media **ids** — the sharpest one. `schema.ts` says it outright:
//     an applier resolves a slot from the manifest PATH, never from an id,
//     because a media id exists once, in one database. Hashing one would make
//     DEV and PROD disagree about a lesson that is byte-identical in both. The
//     **occupancy boolean** is the portable half, and it is what gets hashed —
//     and it is also what makes `localUnitRow()` below possible at all: the
//     repo names a medium by PATH and the database by ID, and `Boolean(...)` of
//     either is the same value on both sides.
//   * `origin` — it says which WRITER owns the row, not what the lesson says.
//     🚨 It is on the payload since Story 35.2 and must stay OUT of the
//     canonical string: adding it would move every fingerprint in every
//     environment for nothing, and it answers a different question — *who may
//     write this row*, which `compareCourse()` asks separately and reports as
//     its own list.
//   * the block's `title`, `summary`, `releaseAfterDays` — a body change must
//     move exactly that lesson's fingerprint. Fold block fields in and
//     re-titling one block moves twelve lessons. Those four fields are compared
//     explicitly instead, by `./diff.mjs`, because a block the operator renamed
//     is still a change a publish would make.
//
// ── The known limit — named, not papered over ──────────────────────────────
// **Swapping one video for another in the same slot does not move the
// fingerprint.** The occupancy boolean is what is hashed, so `video → another
// video` reads as unchanged. The media id cannot be used (above). The portable
// value that WOULD catch it is the deterministic storage key
// `content/<topic-slug>/<file>.<ext>` (`CLAUDE.md` → *Content that must exist in
// PROD*), derivable from the repo path on both sides — reaching it needs a join
// from `courses_units` to `media` that `courseOutline()` does not make today.
// That is the escape hatch, recorded so a later story starts from the answer
// rather than rediscovering the problem; it is deliberately not built here.
//
// Similarly, a lesson MOVED between blocks does not move its fingerprint
// (`blockId` is excluded). It stays fully visible anyway, because the payload
// nests units under their block.
import { createHash } from "node:crypto";

/**
 * One lesson, as either side of the comparison hands it over.
 *
 * The database side is `courseOutline()`'s row (which carries `id`, `position`
 * and `origin` besides these — extra properties are simply not read); the repo
 * side is what `localUnitRow()` below builds out of a `content/course/*.json`
 * unit. Naming only the hashed fields is what makes those two the same input.
 *
 * @typedef {object} FingerprintUnit
 * @property {string} slug
 * @property {string} title
 * @property {string | null} body
 * @property {string | null} taskPrompt
 * @property {string | null} coverMediaId
 * @property {string | null} videoMediaId
 * @property {string | null} subtitleMediaId
 * @property {string | null} worksheetMediaId
 */

/**
 * Line endings out, and **`null` survives as `null`**.
 *
 * Not tidiness. `docs/machine.md` → *Line endings* carries the measured failure: Git
 * for Windows checks text out as CRLF, and because the `.template-version`
 * hashes are taken over LF content, every guidance file looked "edited in this
 * app" and `node run.mjs update` did nothing, for ever. The rule that came out
 * of it is an instruction — *normalise before hashing* — and this is a hash over
 * text that travels between a Windows checkout and a Linux server.
 * `.gitattributes` makes the REPO side LF; the fingerprint is computed over what
 * the DATABASE holds, which is whatever the applier was handed on whatever
 * machine ran it. Normalising here is what makes those two agree.
 *
 * 🚨 `normalizeText()` from `scripts/dev/update-plan.mjs` is the precedent and
 * is deliberately NOT imported. Two reasons, both silent: its `String(text ?? "")`
 * turns `null` into `""`, collapsing the one distinction the fingerprint must
 * keep (no body vs. an empty body) — and no test that only feeds it strings
 * would ever notice; and it lives in `scripts/`, a command-line tree, while this
 * function is also bundled into the app through `./outline.ts`.
 *
 * The regex is `/\r\n?/g` rather than that file's `/\r\n/g` because it also
 * catches a lone `\r` — the spelling `scripts/lib/env-write.mjs` and
 * `scripts/brand/write-tokens.mjs` already use.
 *
 * Deliberately NOT done: no trim and no whitespace collapse (a trailing space in
 * a lesson body is a change an operator made and can see), no Unicode NFC/NFD
 * normalisation (the applier writes the JSON file's own bytes and Postgres
 * stores them, so both sides already see the same form — the single
 * `normalize("NFC")` in this template is for passwords, and adding one here
 * would be a new decision rather than an existing convention), and no case
 * folding.
 *
 * @param {string | null} text
 * @returns {string | null}
 */
const normalise = (text) => (text === null ? null : text.replace(/\r\n?/g, "\n"));

/**
 * One lesson's content, as 64 lowercase hex characters.
 *
 * Same content in two environments → same string. A changed body, title, task
 * prompt or media occupancy → a different one, and **only** for that lesson.
 *
 * @param {FingerprintUnit} unit
 * @returns {string}
 */
export function unitFingerprint(unit) {
  const canonical = JSON.stringify({
    v: "courses-unit-v1",
    slug: unit.slug,
    title: unit.title,
    body: normalise(unit.body),
    taskPrompt: normalise(unit.taskPrompt),
    hasCover: Boolean(unit.coverMediaId),
    hasVideo: Boolean(unit.videoMediaId),
    hasSubtitle: Boolean(unit.subtitleMediaId),
    hasWorksheet: Boolean(unit.worksheetMediaId),
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/**
 * A `content/course/*.json` unit, in the shape `unitFingerprint()` expects.
 *
 * 🚨 **The mapping is exactly what the applier writes**, field for field
 * (`content/appliers/course.mjs` → `apply()`), because the fingerprint's field
 * list was chosen to be exactly that. A local row built from anything else would
 * compare a lesson against a version of itself the target could never hold.
 *
 * The four media slots are the reason this function exists rather than a spread:
 * a content file names a medium by **path** (`"knoten/palomar.mp4"`) and the
 * database by **id** (`"med-7f3…"`), and neither value is available on the other
 * side. What both sides agree on is whether the slot is **occupied**, and that
 * is the whole of what is hashed — so `"local"` here is a marker for *there is
 * something in this slot*, never an identifier, and it never leaves this
 * function.
 *
 * ⚠️ **`?? null`, never `?? ""`.** `body: null` (the applier wrote no body) and
 * `body: ""` (it wrote an empty one) are different rows and must fingerprint
 * differently — the `normalizeText()` trap above, arriving from the other side.
 * A content file that simply omits `body` is the `null` case, which is what
 * `unit.body ?? null` says.
 *
 * @param {{
 *   slug: string,
 *   title: string,
 *   body?: string | null,
 *   taskPrompt?: string | null,
 *   cover?: string | null,
 *   video?: string | null,
 *   subtitle?: string | null,
 *   worksheet?: string | null,
 * }} unit  one entry of a block file's `units` array
 * @returns {FingerprintUnit}
 */
export function localUnitRow(unit) {
  return {
    slug: unit.slug,
    title: unit.title,
    body: unit.body ?? null,
    taskPrompt: unit.taskPrompt ?? null,
    coverMediaId: unit.cover ? "local" : null,
    videoMediaId: unit.video ? "local" : null,
    subtitleMediaId: unit.subtitle ? "local" : null,
    worksheetMediaId: unit.worksheet ? "local" : null,
  };
}
