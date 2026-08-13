// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// One row per stored item — a picture, a video, a recording, or the file a
// buyer paid for.
//
// ── The bytes are not in here ──────────────────────────────────────────────
// This table describes objects; the objects live in the bucket
// (`lib/media/store.ts`). The two are kept together by `lib/media/manage.ts`,
// and the one place that matters most is deletion: a `cascade` removes the row
// and does not touch the bucket, so `deleteMedia()` removes the object first.
// A bucket full of objects nobody has a row for is a deletion request that was
// not honoured — see `docs/data-protection.md`.
//
// ── Four kinds, from the first migration ───────────────────────────────────
// Not "images, and we will see". Delivery, the size ceiling and the byte
// signature all differ per kind, and an app that needs a PDF two weeks after
// launch would otherwise get a second table beside this one, with its own
// access rules and its own mistakes.
//
// ── Four visibilities, and the third is the commercial one ─────────────────
// `public` is product imagery, `owner` is what a customer uploaded, and
// `entitled` is the file somebody bought. That last one is why a Content-Access
// app can sell a PDF at all, and its check is `hasPlan()` — the same call the
// rest of the app makes. `planKeys` is a LIST and holding one of them is
// enough, because one offering is one Digistore24 product per billing
// interval; every key in it is validated against the product registry when it
// is written (`lib/media/config.ts` → `planProblem()`), because `hasPlan()`
// THROWS on an unknown key: an unchecked value would not mean "no access", it
// would mean the page is a 500.
//
// `members` is the fourth and the newest: a face members show each other,
// delivered to any active session and nothing more. It exists because none of
// the other three can express "signed in, that is the whole condition" — the
// argument is made in full, with each of the three tried and failed, in
// `lib/media/rules.ts` above `MEDIA_VISIBILITIES`, and the three failures are
// executable tests rather than prose.
import { pgTable, text, timestamp, integer, index, pgEnum } from "drizzle-orm/pg-core";
import { users } from "./schema-core";

export const mediaKindEnum = pgEnum("media_kind", ["image", "video", "audio", "file"]);

export const mediaVisibilityEnum = pgEnum("media_visibility", [
  "public",
  "owner",
  "entitled",
  // ⚠️ A REAL Postgres enum, so adding a value is `ALTER TYPE … ADD VALUE`,
  // not a column change — see the migration that introduced this one. Keep
  // this list in the same order as `MEDIA_VISIBILITIES` in lib/media/rules.ts;
  // a value can be appended to a Postgres enum but not removed or reordered.
  "members",
]);

export const mediaSourceEnum = pgEnum("media_source", ["upload", "generated"]);

export const media = pgTable(
  "media",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    // Who put it there. NULL for something that belongs to the product rather
    // than to a person — a lesson cover outlives the operator account that
    // uploaded it. `set null` rather than `cascade` for exactly that reason:
    // deleting an account must not take the product's own images with it. What
    // a customer uploaded is `owner`-visible and goes with them, and
    // `lib/privacy/export.ts` is where that split is enforced.
    ownerId: text("owner_id").references(() => users.id, { onDelete: "set null" }),

    kind: mediaKindEnum("kind").notNull(),
    visibility: mediaVisibilityEnum("visibility").notNull().default("owner"),

    // The plans that unlock this item, for `visibility: "entitled"` — Product
    // Keys from config/digistore-products.json, never a token package.
    //
    // 🚨 **A LIST, and holding ONE of them is enough.** One offering is one
    // Digistore24 product per billing interval, so a course sold monthly AND
    // yearly is two keys before it has a second customer — and a single column
    // could only ever name one of them. What that cost was invisible by
    // construction: the yearly buyer reached the lesson page (its own gate
    // passed) and every medium on it resolved to `null`, which a page renders
    // as "there is none". A clean 200 over a product half-delivered.
    //
    // The shape is not invented here: `community_groups.plan_keys` has been
    // `text[]` with `mayEnterGroup()` asking `.some()` since its first
    // migration. Two vocabularies for one gate is the drift, so this column
    // takes that one's name rather than keeping `requires_plan` and its
    // singular verb.
    //
    // Empty is not "free" — `mayAccess()` refuses an `entitled` row with no
    // keys, exactly as it refused a NULL `requires_plan`. The doubt falls
    // closed, like every other one on this path.
    planKeys: text("plan_keys").array().notNull().default([]),

    // Where it sits in the bucket. Derived (`lib/media/rules.ts` →
    // `storageKey()`), never supplied by a request:
    // `<namespace>/<category>/<YYYY>/<MM>/<id>.<ext>`, so the key says which
    // subsystem owns the object and why it is there.
    //
    // ⚠️ **A bucket that predates that grammar holds both shapes, and that is
    // safe rather than tolerated.** Nothing derives a key from a row — the row
    // carries its own — and `MediaStore` has no `list()`, so every read starts
    // here. No object was ever copied and no migration touched this column.
    storageKey: text("storage_key").notNull().unique(),

    // What it IS, read from its bytes at upload (`lib/media/sniff.ts`) — not
    // what the request claimed. This is the value the browser is later told,
    // and `X-Content-Type-Options: nosniff` means the browser will not rescue
    // a wrong one by guessing.
    mime: text("mime").notNull(),

    // The name it was uploaded under, for the download to carry. Personal data
    // in the mild sense that a customer chose it, so it is in the export.
    // Never part of the storage key: a name a customer typed must not shape
    // where anything is written.
    filename: text("filename"),

    bytes: integer("bytes").notNull(),
    width: integer("width"),
    height: integer("height"),
    durationSeconds: integer("duration_seconds"),

    // The narrower widths this picture ALSO exists at in the bucket, as sibling
    // keys (`lib/media/rules.ts` → `variantKey()`).
    //
    // ── Why it is on the row and not asked of the store ────────────────────
    // `MediaStore` deliberately has no `list()` (its own contract says why), so
    // "which copies of this exist" has no answer anywhere but here. That is not
    // a limitation worked around: a store that can be enumerated is one somebody
    // enumerates instead of querying the database, and then the row and the
    // object have two sources of truth.
    //
    // ⚠️ **Three states, and NULL is not the empty array.** The distinction is
    // the reason this column is nullable rather than `.default([])`:
    //
    //   NULL       nobody asked. A row written before this column existed, and
    //              every row whose kind makes the question meaningless — a
    //              video, a PDF, a recording. A backfill would look for exactly
    //              these, and could not find them if they read `{}`.
    //   `{}`       asked, and the answer is none: the original is already
    //              narrower than every target width, the type is not one this
    //              app resizes, or the resizer could not run. **An upload is
    //              never lost to that** — the original is the product and a
    //              variant is an optimisation (`lib/media/variants.ts`).
    //   `{480,960}` these widths are in the bucket, at `variantKey()` of this
    //              row's own `storageKey`.
    //
    // Every reader treats NULL and `{}` the same way at DELIVERY time (no
    // `srcset` either way); they differ only for whoever asks later what has and
    // has not been looked at, and that question is worth a column that can
    // answer it.
    //
    // 🚨 **`deleteMedia()` removes these objects with the original**, because
    // this list is the only record that they exist. A row dropped while a
    // variant survives is bytes nothing can ever locate again — the same
    // failure `media_uploads`' header describes for a cascaded ticket.
    variants: integer("variants").array(),

    // SHA-256 of the stored bytes. Not a security control — it is how "is this
    // the same file again?" gets an answer without fetching the object.
    //
    // ⚠️ **NULL means this app never held the bytes.** That is the
    // direct-to-bucket path (`media_uploads` below): the browser wrote the
    // object, and computing a hash would mean reading a two-gigabyte video back
    // through the process — the entire cost that path exists to avoid. The
    // column can be absent precisely because the sentence above is true: it is
    // not a security control, and an answer that is missing is honest where an
    // invented one would not be. Every reader must therefore treat null as "no
    // answer", never as "no match".
    sha256: text("sha256"),

    source: mediaSourceEnum("source").notNull().default("upload"),

    // Alternative text. Mandatory for images and meaningless for the rest —
    // `components/ui/figure.tsx` makes its absence a compile error on the path
    // that matters, and `lib/media/rules.ts` → `needsAlt()` is the same rule
    // for the upload endpoint and the generator.
    alt: text("alt"),

    // Only for `source: "generated"`: what was asked for, and who answered.
    // The cost is NOT here — it is in `ai_usage`, with every other model call,
    // so `/dashboard/admin/ai-costs` needs nothing new written for it.
    prompt: text("prompt"),
    provider: text("provider"),
    model: text("model"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    // "this member's items, newest first" — the gallery and the export.
    index("media_owner").on(t.ownerId, t.createdAt),
    // "everything behind this plan" — the operator's view of what a plan buys.
    // GIN rather than btree, because the question is now containment
    // (`plan_keys @> ARRAY['basic_yearly']`) and a btree over an array answers
    // only equality of the WHOLE list, which nobody asks.
    index("media_plan_keys").using("gin", t.planKeys),
  ],
);

export type MediaRow = typeof media.$inferSelect;

/**
 * One expected object — a direct-to-bucket upload that has been promised but
 * not yet arrived.
 *
 * ── Why this is a table and not a status column on `media` ──────────────────
 * A half-uploaded file is not a medium of this app; it is an EXPECTATION, and
 * expectations do not belong in the table of facts. Put here as a `media` row
 * with a flag, every existing reader of that table would have to carry a
 * condition it does not carry today — `listOwnedMedia()`, both Article 15
 * exports, `/api/v1/media`, `findMedia()` — and the one that forgot would show
 * a customer a file that does not exist. `bytes` and `sha256` settle it on
 * their own besides: neither is known while the browser is still writing.
 *
 * ── Why not a signed ticket with no row at all ─────────────────────────────
 * An HMAC over id, kind, owner and expiry would be lighter and would make the
 * fourth requirement of `docs/visuals.md` impossible: an abandoned upload would
 * leave an object nobody knows was ever expected. `MediaStore` deliberately has
 * no `list()`, so the sweep cannot find such an object by looking — it finds it
 * because this row says it should be there. Writing it down is what makes it
 * collectable.
 *
 * ── Why `cascade` where `media.ownerId` is `set null` ──────────────────────
 * A `media` row can outlive its uploader because product imagery belongs to the
 * product. A ticket cannot: it is minutes old, nothing references it, and an
 * expected object belonging to a deleted account is nobody's product.
 *
 * 🚨 **The cascade takes the row and does not touch the bucket, and that is not
 * something the sweep repairs afterwards** — the sweep finds an object BECAUSE
 * this row says it should be there, so a cascade that runs first leaves bytes
 * nothing can ever locate again. `MediaStore` has no `list()` on purpose. So
 * `deleteOwnedMedia()` empties a member's open tickets — object first, row
 * second — BEFORE the account row goes, exactly as it does for `media`. This
 * comment used to claim the sweep covered it; it did not, and a file belonging
 * to somebody who had asked to be deleted stayed in the bucket.
 */
export const mediaUploads = pgTable(
  "media_uploads",
  {
    // The id the eventual `media` row will carry. Minted at mint time rather
    // than at write time, because the storage key is derived from it and the
    // browser needs the address BEFORE anything exists.
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    // 🚨 **Where the BROWSER writes — not where the item is later served
    // from.** `lib/media/rules.ts` → `stagingKey()`, the `pending/` prefix, and
    // it is a different key space from `storageKey()` on purpose. A presigned
    // PUT is bounded by time and not by uses, so the address handed out stays
    // writable until `expiresAt`; pointing it at the delivery key would make
    // every check the confirm step performs true of one moment only. The
    // confirm step copies the object onto its `storageKey()` server-side, and
    // whatever is written here afterwards is swept.
    //
    // Still derived and never supplied: both keys come from the id above. The
    // confirm step takes the ticket id and never a key.
    storageKey: text("storage_key").notNull().unique(),

    // 🚨 **The slot the eventual DELIVERY key gets — recorded here because it
    // is decided an hour before it is used.** `lib/media/rules.ts` →
    // `MediaSlot`: which subsystem owns the object, and what it is for inside
    // it. The staging key above says nothing about either, deliberately, so
    // without these two columns `confirmUpload()` would have to take the slot
    // from whichever door happened to call it — and a member could mint at the
    // generic HTTP door and confirm at a module's action, landing an object in
    // that module's namespace through a door that never agreed to it. Stored,
    // the two are comparable: a mismatch is `uploadTicketInvalid`.
    //
    // Not re-derivable from anything else on this row. The kind is not the
    // category (four kinds, eight and counting slots), and the owner's role
    // says nothing about which subsystem asked.
    namespace: text("namespace").notNull(),
    category: text("category").notNull(),

    kind: mediaKindEnum("kind").notNull(),

    // What the browser SAID it would send. Recorded to notice a disagreement,
    // never believed — the confirm step reads the object's first bytes.
    claimedMime: text("claimed_mime").notNull(),

    filename: text("filename"),

    // Decided by the CALLER at mint time, never read from a form — the same
    // rule the through-the-app door states at `lib/media/upload-endpoint.ts`.
    visibility: mediaVisibilityEnum("visibility").notNull().default("owner"),
    // The same list the finished row carries, minted with the ticket — see
    // `media.planKeys`. It travels through the presigned upload unchanged, so
    // the confirm step has nothing to decide.
    planKeys: text("plan_keys").array().notNull().default([]),

    // Short, and load-bearing: a presigned PUT cannot enforce a length, so the
    // window in which an oversized object can be written is the window this
    // closes. `lib/media/rules.ts` → `UPLOAD_TICKET_SECONDS`.
    expiresAt: timestamp("expires_at").notNull(),

    // When this ticket was redeemed. NULL means it has not been.
    //
    // 🚨 **A ticket is spent once, and this column is what makes that
    // atomic.** Two confirms arriving together used to both pass every check
    // and both write: the second lost on the primary key, and its clean-up
    // removed the object the FIRST one had just written a row for. And a second
    // confirm arriving LATER is worse than a duplicate — the address is still
    // live, so it can carry a different object onto the same delivery key while
    // the row keeps describing the first. Redeeming is therefore a conditional
    // `UPDATE … WHERE consumed_at IS NULL RETURNING`: exactly one caller wins,
    // and the loser is told the ticket is invalid.
    //
    // The row itself stays until the sweep collects it. It is the only record
    // that a `pending/` object may exist, and the address that writes one
    // outlives the confirm.
    consumedAt: timestamp("consumed_at"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    // The sweep's only query: everything past its expiry, oldest first.
    index("media_uploads_expires").on(t.expiresAt),
  ],
);

export type MediaUploadRow = typeof mediaUploads.$inferSelect;
