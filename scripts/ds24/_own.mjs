// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// WHICH PRODUCTS IN THIS ACCOUNT ARE OURS.
//
// Everything destructive in `sync-products.mjs` hangs off this file, so it is
// worth saying plainly what the question is: a vendor's Digistore24 account
// holds whatever they put in it — products from before this app existed,
// products of a second app built from this same template, products a support
// agent made by hand. `--prune` deletes and deactivates. It may only ever
// touch what this app itself created, and "probably ours" is not good enough
// for a delete.
//
// ── The marker ──────────────────────────────────────────────────────────────
// `createProduct` and `updateProduct` both take `data[note]` — "Internal
// note", a free text field on the product that no buyer ever sees:
//
//   ds24-appkit:1:<syncId>:<env>
//
// 🚨 **`note` keeps 47 characters and silently drops the rest.** Measured
// against a live account on 2026-09-09: a 120-character value came back cut to
// 47, mid-word, with no warning and no error. Nothing in the API documentation
// says so. That is why the stamp is this short and why the Product Key and the
// language are NOT in it — `name_intern` already carries both, and a stamp
// that does not survive the write is worse than none, because `canClassify()`
// would report the field as travelling and the comparison would then find
// nothing.
//
// (`data[tag]` comes back on a product but `updateProduct` refuses to write
// it — HTTP 400, same measurement. `note` is the only free field there is.)
//
// For a long time this repo said the opposite — `sync-products.mjs` carried
// the sentence "the DS24 API has no tag field, so the group is what keeps this
// app's products findable". The product group is still useful (it is a folder
// the vendor can see), but it is not an ownership proof: a folder can be
// renamed, deleted, or shared with products nobody here created.
//
// ── Three grades, and the sharpest action needs the sharpest grade ─────────
//
//   certain   the stamp names OUR syncId and THIS env   update, deactivate, delete
//   probable  the id is in our registry, or name_intern matches   update only
//   foreign   anything else                             nothing at all
//
// A product created before this file existed carries no stamp, so it is only
// "probable" — updatable, and the update writes the stamp, which promotes it
// to "certain" for every run after that. 🚨 That means the first sync after
// upgrading cannot prune anything, and that is correct: the alternative is
// inferring ownership from a name the vendor is free to edit, and inferring it
// wrong deletes somebody else's product.
//
// ── And one thing this file refuses to guess ───────────────────────────────
// If `listProducts` hands back products with no `note` field at all, we cannot
// tell "no stamp" from "the API did not send the field". Reporting zero
// orphans there would be a green light produced by a comparison that never
// happened, so `canClassify()` says so and the sync refuses to prune. Proving
// the walk ran is not proving the comparison did.

/**
 * THE SECOND MARKER: a coarse one, in `data[tag]`.
 *
 * Where the note stamp says "THIS app, in THIS environment", the tag says
 * "made by an app built on this template — in THIS environment". That is
 * deliberately less than the stamp (it names no app) and it is useful for
 * something else: the vendor can filter their backoffice by it, and
 * Digistore24 can see which products came out of the appkit at all.
 *
 * ── One tag per environment ────────────────────────────────────────────────
 * The filter is only worth typing if it can separate the live products from
 * the ones a sync made while somebody was testing. So there is one tag per
 * environment (`PRODUCT_TAGS`), and `productTagFor(env)` is the only place a
 * run picks its own — never a default, because a default is what writes the
 * LIVE tag onto a dev product the day somebody forgets to pass the argument.
 *
 * 🚨 **It is NOT an ownership proof and `--prune` must never read it.** Two
 * apps built from this template carry the same tag; acting on it would let one
 * delete the other's products. Ownership stays the note stamp, which carries
 * the syncId.
 *
 * ── The field, and what is known about it ──────────────────────────────────
 *
 * On 2026-09-09 it did not exist: `createProduct` and `updateProduct` both
 * refused it outright, because `data` is validated against a strict allowlist
 * and an unknown key is an ERROR rather than something ignored —
 *
 *   "createProduct() - ungültiger Array-Schlüssel bei 1. Parameter 'data'
 *    (angegeben: tag - gültig: name,name_intern,description,…)"
 *
 * On 2026-09-10 it is **documented in Digistore24's own OpenAPI spec** for both
 * calls (`/api/docs/paths/{createProduct,updateProduct}.yaml`):
 *
 *   tag: { type: string, maxLength: 127 }
 *   "Comma-separated tags for internal filtering. Each entry is trimmed; the
 *    characters < > & # " ' ; \ plus tabs and line breaks are stripped, empty
 *    entries and duplicates removed. The length limit applies to the sanitized
 *    value."
 *
 * **Measured against a live account on 2026-09-10**, not only read: the key of a
 * real app, 59 products. `listProducts` returns `tag` and `typeof` it is a
 * `string`; `createProduct` lists it among its 181 valid `data` keys and
 * `updateProduct` among its 184 — read out of the parameter validator's own
 * refusal, so nothing was written to get the answer, and the product used for
 * the probe still carried `tag: ""` and its old `modified_at` afterwards.
 *
 * ⚠️ **The sync sends it unconditionally, and that is a decision with a date on
 * it.** While the field did not exist there was a fallback here: send it, catch
 * the refusal, repeat the call once without it. It came out on 2026-09-10, the
 * day the field shipped. If Digistore24 ever rolls this back, product creation
 * fails outright with "ungültiger Array-Schlüssel" until the tag is taken out
 * of `productData()` again — noted so that whoever reads that error knows where
 * it comes from, rather than looking for it in the registry.
 *
 * 🚨 **`maxLength: 127`, and it is OURS to respect.** The spec does not say
 * whether an over-long value is refused or truncated, and both are bad for a
 * vendor: a refusal turns the fallback's sentence into a false one, and a
 * truncation cuts tags we did not write. So `tagWith()` refuses to produce a
 * value over the limit and answers `null` instead — the vendor keeps their
 * tags and this app goes unmarked. That is the right way round: the tag is
 * explicitly NOT an ownership proof (see above), so losing ours costs nothing
 * and losing theirs costs them.
 *
 * `PRODUCT_TAG` is the LIVE set's tag and the stem the other two are built from.
 */
export const PRODUCT_TAG = "ds24-appkit";

/**
 * The tag per sync environment (`_env.mjs` → SYNC_ENVS).
 *
 * Staging's tag says `-test`, not `-staging`: the word is read in a vendor's
 * backoffice filter, where "test" is what the products ARE, and the
 * environment's own name already travels in full inside the note stamp and the
 * internal name. Prod keeps the bare stem — it is the set that was there
 * first, and the one a vendor filters for most.
 *
 * 🚨 **Nothing here is ever REMOVED from a product.** A product synced under
 * one environment and later under another keeps both tags, because `tagWith`
 * only ever appends (see below) and the rule "what we did not write, we keep"
 * is not worth a second, cleverer rule for the tags we did write — the tag is
 * not an ownership proof, so a stale one costs a filter hit, and a removal
 * pass that gets the ownership question wrong costs the vendor a tag.
 */
export const PRODUCT_TAGS = {
  dev: `${PRODUCT_TAG}-dev`,
  staging: `${PRODUCT_TAG}-test`,
  prod: PRODUCT_TAG,
};

/**
 * The tag THIS run writes, for a sync environment.
 *
 * 🚨 **Throws on an unknown environment**, and the caller resolves it ONCE
 * before the first API call. `resolveSyncEnv` has already refused anything
 * outside the three by then, so reaching this is a programming error — and the
 * two quiet alternatives are both worse: falling back to the prod tag labels a
 * dev product as live in the vendor's filter, and answering `null` leaves a
 * whole product set unmarked without anybody noticing. Loud, and before
 * anything has been created.
 */
export function productTagFor(env) {
  const tag = PRODUCT_TAGS[String(env)];
  if (!tag) {
    throw new Error(
      `No product tag for environment "${env}" — known: ${Object.keys(PRODUCT_TAGS).join(", ")}.`,
    );
  }
  return tag;
}

/**
 * The value to WRITE into `data[tag]`, or `null` when the tag is already there
 * and nothing needs changing.
 *
 * 🚨 **Tags are a comma-separated LIST and the field is written whole**, so
 * adding one means reading the others first and sending them back. A sync that
 * simply wrote `"ds24-appkit"` would delete every tag the vendor had put on
 * that product — the same failure mode as the note field one door up, and the
 * same answer: what we did not write, we keep.
 *
 * Comparison is case-insensitive and ignores the spaces a human leaves after a
 * comma, because both come back from a field somebody edits by hand.
 */
export const PRODUCT_TAG_MAX = 127;

/**
 * The characters Digistore24 strips out of a tag before it measures the length.
 * From the spec, verbatim: `< > & # " \' ; \` plus tabs and line breaks.
 */
const TAG_STRIPPED = /[<>&#";'\\\t\r\n]/g;

export function tagWith(existingTag, tag, maxLength = PRODUCT_TAG_MAX) {
  // 🚨 `tag` has NO default, and this is the guard that keeps it that way. A
  // default would be the prod tag, and a call site that forgot to pass the
  // environment's tag would then quietly mark dev products as live — invisible
  // in every test that passes its own value in. A missing argument is a bug
  // here, not a shape to tiptoe around like `existingTag` below.
  if (typeof tag !== "string" || tag.trim() === "") {
    throw new TypeError(
      "tagWith() needs the tag of THIS environment — see productTagFor(env).",
    );
  }
  // ⚠️ Both the spec and a live `listProducts` say `string` (2026-09-10), so the
  // array branch below is belt-and-braces rather than the guess it started as.
  // It stays because it costs nothing and because which way the doubt falls is
  // the load-bearing part: "not a shape I know" must never mean "nothing is
  // there", because that writes our tag over whatever the vendor had.
  if (existingTag === null || existingTag === undefined) {
    return tag.length <= maxLength ? tag : null;
  }
  let parts;
  if (typeof existingTag === "string") {
    parts = existingTag.split(",");
  } else if (Array.isArray(existingTag) && existingTag.every((t) => typeof t === "string")) {
    parts = existingTag;
  } else {
    return null;
  }
  parts = parts.map((t) => t.trim()).filter(Boolean);
  // Exact, so `ds24-appkit` and `ds24-appkit-dev` are two different tags: a
  // product that moved environments gets the new one ADDED and keeps the old.
  if (parts.some((t) => t.toLowerCase() === tag.toLowerCase())) return null;

  const value = [...parts, tag].join(",");
  // 🚨 Measured the way Digistore24 measures it: the limit applies to the
  // SANITIZED value, so the strip happens before the count. Sending 130
  // characters that sanitize to 120 would otherwise be refused here for a
  // reason the API does not have.
  if (value.replace(TAG_STRIPPED, "").length > maxLength) return null;
  return value;
}

/**
 * The tag of a product as `listProducts`/`getProduct` hand it back — RAW.
 *
 * Deliberately not normalised here: `tagWith` is the one place that decides
 * what an unfamiliar shape means, and it decides "leave it alone".
 */
export function tagOf(product) {
  if (product && Object.hasOwn(product, "tag")) return product.tag;
  if (product?.data && Object.hasOwn(product.data, "tag")) return product.data.tag;
  return null;
}

/** The stamp format version. A reader must accept older ones for ever. */
export const STAMP_VERSION = 1;

/**
 * What Digistore24 keeps of `data[note]`. Measured, not documented — see the
 * file header. `_own.test.ts` holds every stamp this code can produce against
 * it, because a stamp one character too long is not a shorter stamp, it is no
 * stamp at all.
 */
export const NOTE_MAX = 47;

const STAMP_RE = /^ds24-appkit:(\d+):([a-z0-9]+):([a-z]+)$/;

/**
 * The prefix alone, for the one question `parseStamp` cannot answer: is this
 * text OURS even though it does not parse?
 *
 * 🚨 It has to be asked separately, because the 47-character cut can land in
 * the middle of a stamp we wrote. Measured on a live account: a stamp from an
 * earlier, longer format came back as
 * `"ds24-appkit:1 app=d0b100315daa key=zztest_membe"` — unmistakably ours,
 * unparseable, and under a prefix-blind rule it would have been read as the
 * vendor's own text and never corrected. A marker we cannot fix is worse than
 * one we cannot read.
 *
 * Nobody types this by hand, which is what makes it safe to claim.
 */
const OURS_RE = /^ds24-appkit:/;

/** The one line we write into `data[note]`. */
export function stampFor({ syncId, env }) {
  return `ds24-appkit:${STAMP_VERSION}:${syncId}:${env}`;
}

/** The note of a product as `listProducts` hands it back, or `null`. */
export function noteOf(product) {
  const note = product?.note ?? product?.data?.note;
  return typeof note === "string" ? note : null;
}

/**
 * Our stamp inside a note, or `null`. Scans line by line: the vendor's own
 * text may sit above or below ours, and a note that has never been stamped is
 * simply a note.
 */
export function parseStamp(note) {
  if (typeof note !== "string") return null;
  for (const line of note.split(/\r?\n/)) {
    const m = STAMP_RE.exec(line.trim());
    if (m) return { version: Number(m[1]), app: m[2], env: m[3] };
  }
  return null;
}

/**
 * The note to WRITE — or `null` for "do not touch this field at all".
 *
 * 🚨 **We never overwrite text somebody else wrote.** At 47 characters there is
 * no room to keep a vendor's note beside our stamp, so the choice is not "how
 * do we merge" but "whose field is this". The answer: ours only while it is
 * empty or already ours. A vendor who writes their own note into a product we
 * created keeps it — and that product stops being prunable, which is the safe
 * direction and the one this file falls in everywhere else.
 *
 * An empty string counts as empty; so does a note that is only our own stamp,
 * which is what makes a re-sync idempotent instead of additive.
 */
export function noteWith(existingNote, stamp) {
  const current = typeof existingNote === "string" ? existingNote.trim() : "";
  if (current === "") return stamp;
  // Ours, whether or not it still parses — see OURS_RE. Any line of it is
  // enough: the cut can leave the prefix on a line and eat the rest.
  if (current.split(/\r?\n/).some((line) => OURS_RE.test(line.trim()))) {
    return stamp;
  }
  return null;
}

/**
 * Can ownership be decided from this `listProducts` answer at all?
 *
 * True as soon as ONE product carries a `note` key — that proves the field
 * travels. An account whose products genuinely all have empty notes still
 * answers true, because Digistore24 sends the key with an empty value; an API
 * that does not send the field at all answers false, and then a "0 orphans"
 * result would mean nothing.
 */
export function canClassify(products) {
  return products.some(
    (p) => p?.note !== undefined || p?.data?.note !== undefined,
  );
}

/**
 * How sure are we that this product is ours: "certain" | "probable" | "foreign".
 *
 * `registryIds` are the ids this registry names for this environment (parked
 * entries included — parking is about selling, never about ownership), and
 * `internalNames` the `key__lang__env` names it would use.
 */
export function ownershipOf(product, { syncId, env, registryIds, internalNames }) {
  const stamp = parseStamp(noteOf(product));
  if (stamp && stamp.app === syncId && stamp.env === env) return "certain";

  const id = String(product?.product_id ?? product?.id ?? "");
  if (id && registryIds.has(id)) return "probable";

  const intern = product?.name_intern ?? product?.product_name_intern;
  if (intern && internalNames.has(String(intern))) return "probable";

  return "foreign";
}

/**
 * Products that are CERTAINLY ours in this environment and that the registry
 * no longer asks for — the candidates for `--prune`, and nothing else is one.
 *
 * `keepIds` is what the registry still wants, and it must include parked
 * entries: `"sell": false` takes an offering off the page, not out of the
 * account, and a parked product's id still has to reach the IPN connection so
 * its buyers' refunds keep arriving.
 */
export function orphanProducts(products, { syncId, env, keepIds }) {
  const orphans = [];
  for (const product of products) {
    const stamp = parseStamp(noteOf(product));
    if (!stamp || stamp.app !== syncId || stamp.env !== env) continue;
    const id = String(product.product_id ?? product.id ?? "");
    if (!id || keepIds.has(id)) continue;
    // The Product Key and the language come off `name_intern`, not off the
    // stamp: `note` has no room for them (see the file header), and by the time
    // a row is here the stamp has already proved the product is ours — so the
    // internal name is ours too, in the shape `_env.mjs` wrote it.
    const intern = product.name_intern ?? product.product_name_intern ?? null;
    const parts = typeof intern === "string" ? intern.split("__") : [];
    orphans.push({
      productId: id,
      key: parts[0] ?? null,
      language: parts[1] ?? null,
      name: product.name ?? intern ?? id,
      nameIntern: intern,
    });
  }
  return orphans;
}
