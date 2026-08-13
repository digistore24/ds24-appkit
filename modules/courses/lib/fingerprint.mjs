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
// prevents — and it has been bumped once, from `v1` to `v2`, when the four
// media slots stopped being hashed as a boolean (see below). Since that bump
// the tag also TRAVELS: `FINGERPRINT_VERSION` says what that buys.
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
//   * 🚨 the four media **ids** — the sharpest one, and the reason the four
//     slots are hashed as STORAGE KEYS below rather than as ids. `schema.ts`
//     says it outright: an applier resolves a slot from the manifest PATH,
//     never from an id, because a media id exists once, in one database.
//     Hashing one would make DEV and PROD disagree about a lesson that is
//     byte-identical in both.
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
// ── The four slots: the STORAGE KEY, which is neither the id nor the path ──
// 🚨 What is hashed per slot is `media.storageKey` — `content/<topic-slug>/<file>.<ext>`
// — and this is the one field whose two sides are derived rather than sent.
//
// The problem it solves: until this was built, the slots were hashed as an
// **occupancy boolean**, so swapping one video for another in the same slot read
// as UNTOUCHED in `node run.mjs courses-diff`. Measured before it was fixed: a
// lesson whose content file was moved from `kurs/knoten.mp4` to
// `kurs/palomar.mp4`, against a target still holding the first, answered
// `0 would change · 2 untouched`, both sides on the identical digest
// `ee126f2e…`. An operator swaps a recording, previews the publish, and the
// preview says there is nothing to publish.
//
// Why a key works where an id cannot. The two sides hold different values for
// the same medium and neither knows the other's:
//
//   | | what it holds | what it derives |
//   |---|---|---|
//   | the repo | the manifest PATH, `"kurs/knoten.mp4"` | `CONTENT_MEDIA_BUCKET_PREFIX + path` |
//   | the database | the media ID, `"04d96df1-…"` | that row's `storage_key` |
//
// and both derivations land on the same string, `content/kurs/knoten.mp4`,
// because `mediaIdFor()` — the applier's only way to fill a slot, in
// `scripts/content/apply.mjs` and `lib/content/publish.ts` alike — looks a row
// up BY that key. So the value is portable in the way an id is not (identical in
// DEV and PROD for identical content) and specific in the way a boolean is not
// (it names the file). The database half is the join `courseOutline()` does not
// make: `mediaKeysFor()` in `./manage.ts`, one query, called by the setup tool
// and by nothing on a member's page.
//
// ⚠️ Two consequences, both deliberate:
//
//   * **A slot filled by the ADMIN surface hashes an environment-local key.**
//     An upload's key is `<namespace>/<category>/<YYYY>/<MM>/<id>.<ext>` —
//     it carries a UUID, so two environments would disagree. That is sound
//     because such a row is `origin = 'operator'`, and `rowWritable()` in
//     `../admin/media-actions.ts` refuses to attach media to a `content` row at
//     all: an operator-owned lesson exists in ONE environment and is never
//     fingerprint-compared — `compareCourse()` puts it in `refused` before it
//     looks at content. Nothing compares it, so nothing disagrees.
//   * **This moved every fingerprint in every environment once**, which is what
//     the `v` tag is for and why it now reads `courses-unit-v2`. What that costs
//     an operator is `FINGERPRINT_VERSION` below.
//
// A lesson MOVED between blocks still does not move its fingerprint (`blockId`
// is excluded). It stays fully visible anyway, because the payload nests units
// under their block.
import { createHash } from "node:crypto";

import { CONTENT_MEDIA_BUCKET_PREFIX } from "../../../lib/content-media/rules.mjs";

/**
 * The `v` tag of the canonical string — **and the value that travels.**
 *
 * 🚨 The tag was always in the hash; what is new is that `outlinePayload()` also
 * puts it on the wire and `compareCourse()` reads it. Both halves are needed and
 * the second is not decoration:
 *
 *   * in the HASH it makes the shape self-describing, so a changed field list
 *     moves every fingerprint legibly instead of re-keying in silence;
 *   * on the WIRE it is the difference between *"34 lessons differ"* and *"that
 *     app computes v1, this repo computes v2, so nothing below was comparable"*.
 *     A target running an older deploy is the ORDINARY state during a release —
 *     the repo is updated before the environment is — and without the tag every
 *     lesson reads as changed with nothing anywhere saying why. That is NFR-60's
 *     shape exactly: *I could not compare* rendered as a verdict.
 *
 * ⚠️ **Bumping it is not free and is not a formality.** The first
 * `courses-diff` after this template lands reads EVERY lesson of an
 * un-deployed environment as differing — correctly, because the two sides are
 * not comparable, and the command says so in its own paragraph. A publish at
 * that moment writes the same rows it would have written anyway (the applier
 * upserts by slug), so the cost is a loud report and not a wrong write. Deploy
 * the target and the report goes quiet again.
 */
export const FINGERPRINT_VERSION = "courses-unit-v2";

/**
 * One lesson, as either side of the comparison hands it over.
 *
 * The database side is `courseOutline()`'s row with the four keys resolved onto
 * it (which carries `id`, `position`, `origin` and the four media IDS besides
 * these — extra properties are not hashed, but the ids are READ, see the guard
 * in `unitFingerprint()`); the repo side is what `localUnitRow()` below builds
 * out of a `content/course/*.json` unit. Naming only the hashed fields is what
 * makes those two the same input.
 *
 * @typedef {object} FingerprintUnit
 * @property {string} slug
 * @property {string} title
 * @property {string | null} body
 * @property {string | null} taskPrompt
 * @property {string | null} coverKey       `media.storageKey`, or null for an empty slot
 * @property {string | null} videoKey
 * @property {string | null} subtitleKey
 * @property {string | null} worksheetKey
 * @property {string | null} [coverMediaId] the DATABASE side only — read by the guard, never hashed
 * @property {string | null} [videoMediaId]
 * @property {string | null} [subtitleMediaId]
 * @property {string | null} [worksheetMediaId]
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
 * 🚨 One slot's key, and the refusal that keeps an UNRESOLVED slot from hashing
 * as an empty one.
 *
 * The failure this exists for is a silent one and it is a single forgotten line:
 * whoever hands this function a raw `courseOutline()` row — the shape it took
 * until this change — passes four `*MediaId` fields and no `*Key` at all. Read
 * as `null`, a lesson with a video would hash exactly like a lesson with none,
 * in every environment, and every diff would report `untouched`. That is the
 * defect this whole file was just rewritten to remove, arriving through the back
 * door, and nothing downstream could tell it apart from a genuinely empty slot.
 *
 * So the id is READ although it is never hashed: it is the one value that says
 * whether the slot is occupied, and an occupied slot with no key is *I could not
 * look* rather than *there is nothing there*. A throw, not a marker value — this
 * is a programming error inside one process, not a state of the world. The
 * database cannot produce it (the FK is `set null`, so a non-null id has a row),
 * and `localUnitRow()` carries no `*MediaId` property at all, which is what
 * makes the guard silent on the repo side rather than a special case there.
 *
 * @param {FingerprintUnit} unit
 * @param {"cover"|"video"|"subtitle"|"worksheet"} slot
 * @returns {string | null}
 */
function slotKey(unit, slot) {
  const key = unit[`${slot}Key`] ?? null;
  if (key !== null && typeof key !== "string") {
    throw new Error(
      `unitFingerprint("${unit.slug}"): ${slot}Key is ${typeof key}, not a storage key or null`,
    );
  }
  const idField = `${slot}MediaId`;
  if (Object.hasOwn(unit, idField) && unit[idField] && key === null) {
    throw new Error(
      `unitFingerprint("${unit.slug}"): the ${slot} slot holds media id "${unit[idField]}" and no ` +
        `${slot}Key was resolved for it. The fingerprint hashes the storage key, not the id — ` +
        `resolve the row's key through mediaKeysFor() (modules/courses/lib/manage.ts) before ` +
        `hashing. Hashing it as an empty slot would make a lesson WITH a video read exactly like ` +
        `one without, in every environment.`,
    );
  }
  return key;
}

/**
 * One lesson's content, as 64 lowercase hex characters.
 *
 * Same content in two environments → same string. A changed body, title, task
 * prompt, or a slot that was emptied, filled **or swapped for another file** → a
 * different one, and **only** for that lesson.
 *
 * @param {FingerprintUnit} unit
 * @returns {string}
 */
export function unitFingerprint(unit) {
  const canonical = JSON.stringify({
    v: FINGERPRINT_VERSION,
    slug: unit.slug,
    title: unit.title,
    body: normalise(unit.body),
    taskPrompt: normalise(unit.taskPrompt),
    // 🚨 Written out one by one rather than folded from `SLOTS`: the canonical
    // string's field ORDER is the hash, so it has to be visible in the file that
    // is the definition of it. A loop would put the order in a constant above,
    // where a reorder is a one-line edit nobody reads as re-keying every app.
    coverKey: slotKey(unit, "cover"),
    videoKey: slotKey(unit, "video"),
    subtitleKey: slotKey(unit, "subtitle"),
    worksheetKey: slotKey(unit, "worksheet"),
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
 * a content file names a medium by **path** (`"kurs/palomar.mp4"`) and the
 * database by **id** (`"med-7f3…"`), and neither value is available on the other
 * side. What both sides can DERIVE is the storage key, and that is what is
 * hashed — here by prefixing, over there by reading the row `mediaIdFor()`
 * looked up under exactly this string.
 *
 * 🚨 `CONTENT_MEDIA_BUCKET_PREFIX + path`, never a literal `"content/"`. It is
 * the spelling `lib/content/media-presence.ts` already uses and the one
 * `lib/content/writers.test.ts` pins at its source; a second spelling of the
 * prefix would resolve a lesson to a media row through one and leave the object
 * under the other. ⚠️ Not `keyFor()` from `scripts/content/_manifest.mjs`, which
 * is the same composition — that file reads a manifest off the disk with
 * `node:fs`, and this one is bundled into the app through `./outline.ts`. The
 * constant is pure and its own header says it is meant to be imported by bare
 * `node`, by vitest and by the app alike.
 *
 * ⚠️ A path this function cannot recognise is not this function's to refuse:
 * `readBlocks()` has already read the file, and a path that names no manifest
 * entry fails `content-apply` at `mediaIdFor()` with the entry's own name. A
 * second refusal here would be a second opinion about what a valid reference is.
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
  const key = (path) => (path ? CONTENT_MEDIA_BUCKET_PREFIX + path : null);
  return {
    slug: unit.slug,
    title: unit.title,
    body: unit.body ?? null,
    taskPrompt: unit.taskPrompt ?? null,
    coverKey: key(unit.cover),
    videoKey: key(unit.video),
    subtitleKey: key(unit.subtitle),
    worksheetKey: key(unit.worksheet),
  };
}
