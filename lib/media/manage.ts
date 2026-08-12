// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Rows and bytes, kept in step.
//
// `store.ts` moves bytes and knows nothing about the database; `db/schema-media.ts`
// describes rows and knows nothing about a bucket. This file is the only place
// that holds both, which is why the two can never drift apart in one direction:
// an object with no row is invisible, and a row with no object is a broken
// image on somebody's page.
//
// ── The order of operations is the whole file ──────────────────────────────
// On the way in: bytes first, row second. A crash between them leaves an
// orphaned object, which costs storage and shows nobody anything.
// On the way out: object first, row second. A crash between them leaves a row
// pointing at nothing, which is visible and fixable. The reverse — row gone,
// object still in the bucket — is a deletion request that was not honoured, and
// nothing afterwards can find it to finish the job.
//
// ── Where it may be read ───────────────────────────────────────────────────
// Server components, Server Actions, route handlers, scripts. Never a client
// component.
import { createHash } from "node:crypto";

import { and, eq, inArray, isNull, lt, notInArray } from "drizzle-orm";

import { db } from "@/db";
import { media, mediaUploads, type MediaRow } from "@/db/schema-media";
import { hasPlan } from "@/lib/entitlements/manage";

import { mediaConfig, planProblem } from "./config";
import { OWNED_MEDIA_VISIBILITIES } from "./rules";
import { stripMetadata } from "./exif";
import {
  MediaError,
  UPLOAD_TICKET_SECONDS,
  formatBytes,
  kindForMime,
  needsAlt,
  refuseUpload,
  safeFilename,
  stagingKey,
  storageKey,
  extensionFor,
  type MediaErrorCode,
  type MediaKind,
  type MediaSlot,
  type MediaSource,
  type MediaVisibility,
} from "./rules";
import { SNIFF_BYTES, agreedMime } from "./sniff";
import { mediaStore } from "./store";
import { deriveImageVariants, removeImageVariants } from "./variants";

export interface AcceptUploadInput extends MediaSlot {
  /** The uploader. Their own id, from the session — never from a form. */
  ownerId: string;
  /** Their `users.role`, which decides what they may put in. */
  role: string;
  bytes: Uint8Array;
  /** What the request said it was. Used to notice a disagreement, never trusted. */
  claimedMime: string | null;
  filename: string | null;
  visibility?: MediaVisibility;
  /** Required when `visibility` is `entitled`. */
  requiresPlan?: string | null;
  alt?: string | null;
  /**
   * Restrict what KIND this door accepts, whatever the role may otherwise
   * upload.
   *
   * `mayUpload` answers "may this person put this type in at all"; this answers
   * "does this particular door take it". A profile picture door must refuse a
   * PDF even though `mayUpload.member` allows one — otherwise a member sets a
   * 50 MB document as their face and every avatar renders broken. Absent means
   * "any kind this installation accepts", which is what the general upload
   * endpoint wants.
   */
  onlyKinds?: readonly MediaKind[];
  /**
   * Restrict what MEDIA TYPE this door accepts — one step finer than
   * `onlyKinds`, and the step a kind cannot express.
   *
   * `onlyKinds` answers "does this door take this KIND"; this answers "does it
   * take this TYPE". They are not the same question because a kind holds
   * several types: `text/vtt`, `application/pdf` and `application/zip` are all
   * `file`, so a subtitle door written with `onlyKinds: ["file"]` accepts a
   * PDF and a worksheet door accepts a `.vtt`. That is the same mistake
   * `onlyKinds` prevents for a profile picture, one level down.
   *
   * Checked here rather than by the caller sniffing first, for the reason
   * `rules.ts` gives for existing at all: a second, slightly different copy of
   * a decision is how the two stop agreeing. And checked BEFORE anything is
   * stored — refusing afterwards would mean bytes written, a rate-limit slot
   * spent, and an orphaned object whenever the tidy-up delete fails.
   *
   * The values are canonical types as `agreedMime()` returns them (lower case,
   * aliases already resolved), never what a request claimed.
   */
  onlyMimes?: readonly string[];
}

/**
 * Take an upload in, or refuse it.
 *
 * The order of the checks is the same one `app/api/chat/route.ts` uses and it
 * is not arbitrary — each refusal happens before anything more expensive than
 * itself, and the message a caller gets names the actual problem rather than
 * the first symptom of it.
 */
export async function acceptUpload(input: AcceptUploadInput): Promise<MediaRow> {
  const config = mediaConfig();

  if (input.bytes.length === 0) throw new MediaError("noFile");

  // What it IS, from its bytes. A `Content-Type` in a multipart part is written
  // by whoever sent the request, so believing it means an installation that
  // accepts `image/png` accepts anything at all.
  const mime = agreedMime(input.bytes, input.claimedMime);
  if (!mime) {
    // Two different situations, and telling them apart is worth a branch: bytes
    // we do not recognise at all, versus bytes that recognisably contradict
    // what the request claimed.
    throw new MediaError(input.claimedMime ? "typeMismatch" : "typeNotAllowed");
  }

  const refusal = refuseUpload(config, {
    role: input.role,
    mime,
    bytes: input.bytes.length,
  });
  if (refusal) throw new MediaError(refusal);

  const kind = kindForMime(config, mime);
  if (!kind) throw new MediaError("typeNotAllowed");
  // The door's own restriction, after the bytes have been read and before
  // anything is stored or stripped.
  if (input.onlyKinds && !input.onlyKinds.includes(kind)) {
    throw new MediaError("typeNotAllowed");
  }
  // …and the same restriction one step finer, for the doors whose kind holds
  // more than one type. Same code, because from the uploader's side it is the
  // same answer: this door does not take that.
  if (input.onlyMimes && !input.onlyMimes.includes(mime)) {
    throw new MediaError("typeNotAllowed");
  }

  const alt = input.alt?.trim() || null;
  if (needsAlt(kind) && !alt) throw new MediaError("altRequired");

  const visibility: MediaVisibility = input.visibility ?? "owner";
  const requiresPlan = visibility === "entitled" ? (input.requiresPlan?.trim() ?? null) : null;
  if (visibility === "entitled") {
    if (!requiresPlan) {
      throw new MediaError(
        "noAccess",
        'visibility "entitled" needs a Product Key — otherwise nobody could ever fetch it',
      );
    }
    // `hasPlan()` throws on an unknown key, so an unchecked one would not mean
    // "no access", it would take down the page that renders the item.
    const problem = planProblem(requiresPlan);
    if (problem) throw new MediaError("noAccess", `requiresPlan: ${problem}`);
  }

  // GPS and camera data off, before anything is written anywhere. Images only —
  // video keeps its metadata and `docs/data-protection.md` says so rather than
  // implying a protection that is not there.
  const stored = stripMetadata(mime, input.bytes);

  return createMedia({
    ownerId: input.ownerId,
    // The slot travels through untouched. This door decides nothing about it:
    // which subsystem owns the object is the CALLER's fact, and a default here
    // would be the core guessing on behalf of a module.
    namespace: input.namespace,
    category: input.category,
    kind,
    mime,
    bytes: stored,
    filename: input.filename ? safeFilename(input.filename, extensionFor(mime)) : null,
    visibility,
    requiresPlan,
    alt,
    source: "upload",
  });
}

export interface CreateMediaInput extends MediaSlot {
  ownerId: string | null;
  kind: NonNullable<ReturnType<typeof kindForMime>>;
  mime: string;
  bytes: Uint8Array;
  filename: string | null;
  visibility: MediaVisibility;
  requiresPlan: string | null;
  alt: string | null;
  source: MediaSource;
  width?: number | null;
  height?: number | null;
  durationSeconds?: number | null;
  prompt?: string | null;
  provider?: string | null;
  model?: string | null;
}

/**
 * Put bytes away and write the row that describes them.
 *
 * The id is minted here rather than by the database, because the storage key is
 * derived from it and the object has to be written before the row exists — see
 * the ordering note at the top of the file.
 *
 * ⚠️ **`namespace` and `category` are required, and this is documented API.**
 * `docs/visuals.md` → *Selling a file* tells a vendor to call this function
 * directly, so a new required field is formally a break. For apps already
 * generated it is not: `node run.mjs update` ships text and never code, so
 * their `lib/media/` stays as it was. What can diverge is fetched text against
 * older code, and `requires:` in a skill's frontmatter is the mechanism for
 * that. Required rather than defaulted on purpose — a default would put an
 * object somewhere nobody looks and nothing would say so.
 */
export async function createMedia(input: CreateMediaInput): Promise<MediaRow> {
  // ── Validated HERE, not only in the callers above ────────────────────────
  // A code review found that `acceptUpload()` and `generateImage()` checked the
  // key and this function did not — while `docs/visuals.md` → *Selling a file*
  // tells a vendor to call THIS function directly with `visibility: "entitled"`.
  // So the one documented way to sell a file had no check at all, and
  // `hasPlan()` throws on an unknown key: a typo took the page down instead of
  // denying access, which is exactly what AD-41 exists to prevent.
  if (input.visibility === "entitled") {
    if (!input.requiresPlan) {
      throw new MediaError(
        "noAccess",
        'visibility "entitled" needs a Product Key — otherwise nobody could ever fetch it',
      );
    }
    const problem = planProblem(input.requiresPlan);
    if (problem) throw new MediaError("noAccess", `requiresPlan: ${problem}`);
  }

  const id = crypto.randomUUID();
  const createdAt = new Date();
  const key = storageKey({
    id,
    namespace: input.namespace,
    category: input.category,
    mime: input.mime,
    createdAt,
  });

  await mediaStore().put(key, input.bytes, input.mime);

  // ── The narrower copies, from the bytes that are already here ────────────
  //
  // 🚨 **Here rather than in `acceptUpload()`, and the reason is the key.** The
  // story's task said "inside `acceptUpload()` after `stripMetadata()`", which
  // is right about the ORDER and cannot be right about the place: a variant key
  // is a sibling of the DELIVERY key, and that key is minted three lines above —
  // `acceptUpload()` has never seen it. What the ordering demands is that the
  // bytes arriving here are already stripped, and they are: `acceptUpload()`
  // passes `stripMetadata()`'s output as `input.bytes`. Placed here it also
  // covers `generateImage()`, which reaches this function directly.
  //
  // Never throws (`variants.ts`, property 1): the original is the product.
  const derived = await deriveImageVariants({
    kind: input.kind,
    mime: input.mime,
    bytes: input.bytes,
    deliveryKey: key,
  });

  return insertMediaRow({
    id,
    storageKey: key,
    ownerId: input.ownerId,
    kind: input.kind,
    mime: input.mime,
    byteCount: input.bytes.length,
    sha256: createHash("sha256").update(input.bytes).digest("hex"),
    filename: input.filename,
    visibility: input.visibility,
    requiresPlan: input.requiresPlan,
    alt: input.alt,
    source: input.source,
    // ⚠️ **The MEASURED size wins over the caller's**, and only falls back to
    // it. `generateImage()` passes the size it ASKED a provider for, and a
    // provider that answered with a different one would leave the row
    // describing a picture nobody has — while the `srcset` needs the real
    // pixel width to describe the original honestly. What the bytes say about
    // themselves beats what anybody expected them to say, which is the same
    // ruling `agreedMime()` makes one level up.
    width: derived.width ?? input.width ?? null,
    height: derived.height ?? input.height ?? null,
    variants: derived.variants,
    durationSeconds: input.durationSeconds ?? null,
    prompt: input.prompt ?? null,
    provider: input.provider ?? null,
    model: input.model ?? null,
    createdAt,
  });
}

/**
 * The insert both paths share — the row, and the promise to take the object
 * back out if the row does not happen.
 *
 * 🚨 **Module-private on purpose, and it is the reason `storageKey` may appear
 * in its input at all.** `lib/content/writers.test.ts` holds that no upload
 * door hands a storage key; the key here is one this file derived moments ago
 * (`createMedia`) or one it wrote into a ticket itself (`confirmUpload`),
 * never one that arrived in a request. Exporting this would make that
 * distinction a convention instead of a boundary, so it is not exported.
 */
async function insertMediaRow(input: {
  id: string;
  storageKey: string;
  ownerId: string | null;
  kind: MediaKind;
  mime: string;
  byteCount: number;
  /** Null where this app never held the bytes — see `db/schema-media.ts`. */
  sha256: string | null;
  filename: string | null;
  visibility: MediaVisibility;
  requiresPlan: string | null;
  alt: string | null;
  source: MediaSource;
  width?: number | null;
  height?: number | null;
  /**
   * The narrower widths written beside this object — `null` for "not asked".
   *
   * Three states, and the difference matters: `db/schema-media.ts` carries the
   * table. `confirmUpload()` passes nothing at all, which resolves to `null`,
   * and that is the right answer rather than a gap — the direct path refuses
   * images outright (`kindNotDirect`), so a row from it can never have any.
   */
  variants?: number[] | null;
  durationSeconds?: number | null;
  prompt?: string | null;
  provider?: string | null;
  model?: string | null;
  createdAt: Date;
}): Promise<MediaRow> {
  try {
    const [row] = await db
      .insert(media)
      .values({
        id: input.id,
        ownerId: input.ownerId,
        kind: input.kind,
        visibility: input.visibility,
        requiresPlan: input.requiresPlan,
        storageKey: input.storageKey,
        mime: input.mime,
        filename: input.filename,
        bytes: input.byteCount,
        width: input.width ?? null,
        height: input.height ?? null,
        variants: input.variants ?? null,
        durationSeconds: input.durationSeconds ?? null,
        sha256: input.sha256,
        source: input.source,
        alt: input.alt,
        prompt: input.prompt ?? null,
        provider: input.provider ?? null,
        model: input.model ?? null,
        createdAt: input.createdAt,
      })
      .returning();
    return row;
  } catch (error) {
    // The row did not happen, so nothing will ever reference this object. Take
    // it back out rather than leaving somebody's file in a bucket with no
    // record that it is there — which is the shape of thing a data-protection
    // audit finds and nobody can explain.
    //
    // **The variants go with it**, and this is the one place the argument on
    // `removeImageVariants()` is inverted: there a failure must throw, because
    // it is answering a deletion request; here we are already unwinding a failed
    // write and the error the CALLER needs is the insert's, not a bucket's. So
    // the clean-up is swallowed exactly as the original's always was.
    await removeImageVariants({ storageKey: input.storageKey, variants: input.variants ?? null })
      .catch(() => {});
    await mediaStore()
      .remove(input.storageKey)
      .catch(() => {});
    throw error;
  }
}

// ── The second way in: the browser writes, the app checks afterwards ────────
//
// Everything above this line reads the bytes before deciding anything. That is
// the stronger arrangement and it stays the default; what follows exists for
// the one case it cannot serve — a file too large to travel through a request
// body (`docs/visuals.md` → *The ceiling, and the second way in*).
//
// The order is inverted and the checks are not skipped, only moved: minting
// decides who and what kind, confirming decides what actually landed. The one
// check that CANNOT move is the metadata strip, because it needs the bytes in
// hand — so this path does not take images, and `kindNotDirect` says so.

export interface CreateUploadTicketInput extends MediaSlot {
  /** The uploader. Their own id, from the session — never from a form. */
  ownerId: string;
  /** Their `users.role`, which decides what they may put in. */
  role: string;
  /** What the browser says it will send. Recorded, never believed. */
  claimedMime: string;
  filename: string | null;
  /** What the browser says it will weigh. A courtesy refusal, not the check. */
  declaredBytes: number;
  /**
   * Decided by the CALLER, never read from a form — the same rule
   * `handleUpload()` states. The HTTP door passes `"owner"`; a Server Action
   * with `requireOwner()` in front of it is what may pass anything else.
   */
  visibility?: MediaVisibility;
  requiresPlan?: string | null;
}

export interface UploadTicket {
  ticketId: string;
  /** Where the browser PUTs the bytes. */
  url: string;
  expiresAt: Date;
}

/**
 * Promise the bucket an object, and hand the browser an address for it.
 *
 * Refuses here what can be known here: the role's own ceiling of types, the
 * kinds this path does not take, and a declared size already over the limit.
 * What it cannot know — what the bytes really are, and how many there really
 * are — is `confirmUpload()`'s job, and neither of those is skipped.
 */
export async function createUploadTicket(
  input: CreateUploadTicketInput,
): Promise<UploadTicket> {
  const config = mediaConfig();

  // The claimed type only picks the DOOR; the object's own first bytes decide
  // what it is at confirm time. A claim that is not a type this installation
  // takes at all is refused now rather than after a gigabyte has moved.
  const claimed = input.claimedMime.trim().toLowerCase();
  const kind = kindForMime(config, claimed);
  if (!kind) throw new MediaError("typeNotAllowed");

  // 🚨 Images go through the app, and this is the promise-keeping half of that
  // sentence rather than the enforcing one — a client that lies here is caught
  // at confirm time by `agreedMime()`. Refusing already at mint spares an
  // honest caller the upload; it does not spare a dishonest one the refusal.
  // The reason is `docs/data-protection.md` §14: location and camera data come
  // off uploaded images, `stripMetadata()` needs the whole file, and an object
  // the browser wrote straight to the bucket was never in this process.
  if (kind === "image") throw new MediaError("kindNotDirect");

  const refusal = refuseUpload(config, {
    role: input.role,
    mime: claimed,
    bytes: input.declaredBytes,
  });
  if (refusal) throw new MediaError(refusal);

  const visibility: MediaVisibility = input.visibility ?? "owner";
  const requiresPlan = visibility === "entitled" ? (input.requiresPlan?.trim() ?? null) : null;
  if (visibility === "entitled") {
    if (!requiresPlan) {
      throw new MediaError(
        "noAccess",
        'visibility "entitled" needs a Product Key — otherwise nobody could ever fetch it',
      );
    }
    const problem = planProblem(requiresPlan);
    if (problem) throw new MediaError("noAccess", `requiresPlan: ${problem}`);
  }

  const id = crypto.randomUUID();
  const createdAt = new Date();
  // Derived from an id this app generated, exactly as on the other path. Two
  // things moved rather than one: WHEN (the browser needs an address before the
  // row it describes can exist) and WHERE (`stagingKey()`, not `storageKey()`).
  //
  // 🚨 The second is the one that matters. A presigned address stays writable
  // until it expires, so an address pointing at the delivery key would make
  // every check in `confirmUpload()` true of one moment and of nothing after
  // it. The browser writes to a key nothing serves; the confirm step copies.
  const key = stagingKey({ id, mime: claimed, createdAt });

  // 🚨 **The slot is validated NOW, at mint time, and not only at confirm.**
  // `storageKey()` throws on a namespace that is reserved or misshapen, and on
  // this path it is not called until the bytes are already in the bucket — so a
  // door with a typo would otherwise mint an address, let a member upload a
  // gigabyte, and fail on the confirm with the object stranded. Cheap here,
  // expensive there. The result is thrown away; the refusal is the point.
  storageKey({ id, namespace: input.namespace, category: input.category, mime: claimed, createdAt });

  const url = mediaStore().createUploadUrl(key, UPLOAD_TICKET_SECONDS);
  if (!url) {
    // Not a broken store: the local driver has no address a browser can reach.
    // The message is the honest one rather than "unavailable", because the
    // answer is a configuration and not a retry.
    throw new MediaError(
      "storeUnavailable",
      "the direct upload path needs MEDIA_DRIVER=s3; the local driver has no address a browser can write to",
    );
  }

  const expiresAt = new Date(createdAt.getTime() + UPLOAD_TICKET_SECONDS * 1000);
  await db.insert(mediaUploads).values({
    id,
    ownerId: input.ownerId,
    storageKey: key,
    // 🚨 **The slot is RECORDED rather than re-derived at confirm time.** The
    // delivery key is built an hour later, in another request, and the only
    // honest source for "whose object is this" is the door that minted the
    // ticket — re-deriving it from whatever the confirm door happens to be is
    // how a lesson recording ends up in the generic upload namespace. It also
    // makes the two doors comparable: `confirmUpload()` refuses a ticket minted
    // for a different slot, which is what stops a member minting at the HTTP
    // door and confirming at a module's.
    namespace: input.namespace,
    category: input.category,
    kind,
    claimedMime: claimed,
    filename: input.filename,
    visibility,
    requiresPlan,
    expiresAt,
    createdAt,
  });

  return { ticketId: id, url, expiresAt };
}

/**
 * Read back what actually landed, and write the row — or refuse and clean up.
 *
 * 🚨 **Nothing the client said is believed here.** The length comes from
 * `head()`, the type from the object's own first bytes. That is the same stance
 * `acceptUpload()` takes; the difference is only that the bytes are in the
 * bucket rather than in the process, which is why the checks are `head()` and
 * `firstBytes()` rather than a look at a `Uint8Array`.
 *
 * 🚨 **And the checks are a promise rather than a moment, which took three
 * things.** The object the browser wrote sits on the ticket's `stagingKey()`;
 * what gets served is a COPY of it on a key the client was never told, made
 * server-side after every check passed. The ticket is spent by a conditional
 * `UPDATE`, so two confirms cannot both write. And nothing here deletes the
 * ticket row — it is the only record that a `pending/` object may exist, and
 * the address that writes one outlives this call by up to an hour.
 *
 * Without the first of those, a member could confirm a one-kilobyte MP4 and
 * then push a gigabyte, or a location-bearing JPEG, onto the same address: the
 * row would keep describing the first upload and the bucket would hold the
 * second. `docs/data-protection.md` §14 is the promise that would have broken.
 */
export async function confirmUpload(
  input: MediaSlot & {
    ticketId: string;
    memberId: string;
    role: string;
  },
): Promise<MediaRow> {
  const config = mediaConfig();
  const store = mediaStore();

  const [ticket] = await db
    .select()
    .from(mediaUploads)
    .where(eq(mediaUploads.id, input.ticketId))
    .limit(1);

  // Never minted, expired, already redeemed, or somebody else's — ONE answer.
  // See `uploadTicketInvalid` in `rules.ts` for why they are not told apart.
  if (
    !ticket ||
    ticket.ownerId !== input.memberId ||
    ticket.consumedAt !== null ||
    ticket.expiresAt.getTime() <= Date.now() ||
    // 🚨 **And the slot the confirming door claims has to be the slot the ticket
    // was minted for.** A fourth situation folded into the same one answer, on
    // the same argument as the three above: there is more than one door minting
    // tickets for the same owner, and without this a member could mint at
    // `POST /api/media/upload-url` and confirm at a module's action — putting an
    // object into that module's namespace through a door that never agreed to
    // it. The doors already re-ask about the VISIBILITY for exactly this reason
    // (`modules/courses/admin/media-actions.ts` says so above its own check);
    // this is the same question about WHERE the bytes land, asked once here so
    // every door gets it rather than the ones that remembered.
    ticket.namespace !== input.namespace ||
    ticket.category !== input.category
  ) {
    throw new MediaError("uploadTicketInvalid");
  }

  /**
   * Clean up after a refusal and hand back the error for the caller to throw.
   *
   * Written as `throw await discarded(...)` rather than as a function that
   * throws by itself, because TypeScript does not narrow after an awaited call
   * — `if (!mime) await discard(); use(mime)` still needs a `!`, and a
   * non-null assertion is exactly the thing that survives a later edit which
   * makes it untrue.
   */
  const discarded = async (code: MediaErrorCode, detail?: string): Promise<MediaError> => {
    // The staging object goes; a failure to remove it is logged and does not
    // change the answer.
    //
    // 🚨 **The ROW STAYS, and after a refusal that matters more than it looks.**
    // It is the only record that an object may exist under this ticket's
    // staging key — `MediaStore` has no `list()` — and the address is still
    // live, so whatever is written to it next is findable only through this
    // row. Deleting it here used to mean: get refused, write the object again,
    // and it sits in the bucket with nothing in the app able to name it. The
    // ticket is not spent either: it can be re-uploaded and re-confirmed, and
    // every check runs again from scratch.
    try {
      await store.remove(ticket.storageKey);
    } catch (error) {
      console.error("[media] could not remove a refused upload:", error);
    }
    return new MediaError(code, detail);
  };

  const head = await store.head(ticket.storageKey);
  if (!head) {
    // Nothing there — which is not the same as nothing coming. A PUT still in
    // flight, a confirm from a second tab, a provider without read-after-write
    // consistency: the ticket keeps its row and its validity, and the sweep
    // collects whatever lands after this.
    throw new MediaError("uploadMissing");
  }

  // The MEASURED length. A presigned PUT cannot enforce one (see
  // `UPLOAD_TICKET_SECONDS`), so this is where an oversized object is caught —
  // and removed, rather than left in the bucket unreferenced.
  const ceiling = config.kinds[ticket.kind].maxBytes;
  if (head.bytes > ceiling) throw await discarded("tooLarge", `max ${formatBytes(ceiling)}`);
  if (head.bytes === 0) throw await discarded("noFile");

  const first = await store.firstBytes(ticket.storageKey, SNIFF_BYTES);
  if (!first || first.length === 0) throw await discarded("uploadMissing");

  const mime = agreedMime(first, ticket.claimedMime);
  if (!mime) throw await discarded("typeMismatch");

  const kind = kindForMime(config, mime);
  if (!kind) throw await discarded("typeNotAllowed");

  // 🚨 The image refusal, and it sits HERE rather than only at mint time. A
  // JPEG sent through a ticket that claimed `video/mp4` would otherwise walk
  // straight past the promise in `docs/data-protection.md` §14 — the whole
  // point of reading the bytes is that a form field cannot decide this.
  if (kind === "image") throw await discarded("kindNotDirect");

  // The role's own ceiling, re-asked against what the bytes really are. The
  // mint step asked it about a claim; a claim is not evidence.
  const refusal = refuseUpload(config, {
    role: input.role,
    mime,
    bytes: head.bytes,
  });
  if (refusal) throw await discarded(refusal);

  // ── Spend the ticket, and let exactly one caller win ──────────────────────
  // Everything above this line only reads. From here on something gets written,
  // and this conditional `UPDATE` is what makes "written once" true rather than
  // likely: two confirms arriving together both pass every check above, and
  // before this the second one lost on the primary key and its clean-up removed
  // the object the FIRST had just written a row for.
  const [claimed] = await db
    .update(mediaUploads)
    .set({ consumedAt: new Date() })
    .where(and(eq(mediaUploads.id, ticket.id), isNull(mediaUploads.consumedAt)))
    .returning({ id: mediaUploads.id });
  if (!claimed) throw new MediaError("uploadTicketInvalid");

  const createdAt = new Date();
  // The delivery key, derived now — from the same id, and from the type and
  // kind the BYTES turned out to be rather than the ones the mint step was
  // told. The client has never seen this key and has no address for it.
  // The slot comes off the TICKET, not off this call — they were compared
  // above, so the two agree, and the ticket is the half that was decided behind
  // the guard that metered the upload.
  const key = storageKey({
    id: ticket.id,
    namespace: ticket.namespace,
    category: ticket.category,
    mime,
    createdAt,
  });

  try {
    // Bytes first, row second — the ordering rule at the top of this file. The
    // copy runs inside the provider; nothing passes through this process.
    await store.copy(ticket.storageKey, key, mime);
  } catch (error) {
    // Nothing reached the delivery key, so this ticket has cost the member
    // nothing yet — hand it back rather than making a bucket hiccup an upload
    // they have to start again. Once the copy HAS landed the ticket stays
    // spent, because from that moment a second redemption could put different
    // bytes behind a row that already describes the first.
    await db
      .update(mediaUploads)
      .set({ consumedAt: null })
      .where(eq(mediaUploads.id, ticket.id));
    throw error;
  }

  const row = await insertMediaRow({
    id: ticket.id,
    storageKey: key,
    ownerId: ticket.ownerId,
    kind,
    mime,
    byteCount: head.bytes,
    // No hash: this app never held the bytes. `db/schema-media.ts` says what
    // null means on that column and why it may be absent at all.
    sha256: null,
    filename: ticket.filename ? safeFilename(ticket.filename, extensionFor(mime)) : null,
    visibility: ticket.visibility,
    requiresPlan: ticket.requiresPlan,
    alt: null,
    source: "upload",
    createdAt,
  });

  // The staging copy has served its purpose. Best effort and uncounted: if it
  // fails, the row that still names it is what gets it swept at expiry — which
  // is also why the ticket row is NOT deleted here.
  try {
    await store.remove(ticket.storageKey);
  } catch (error) {
    console.error("[media] could not remove a redeemed upload's staging object:", error);
  }

  return row;
}

/** Tickets per pass. Each one is a round trip to the bucket, so not ten thousand. */
const UPLOAD_SWEEP_BATCH = 200;

/**
 * Remove the objects of upload tickets that ran out, and the tickets with them.
 *
 * 🚨 **It never lists the bucket, and it never touches an object it has no row
 * for.** `MediaStore` deliberately has no `list()` (see its contract), and a
 * sweep that enumerated storage would be a job deleting things it cannot
 * account for. Everything removed here is something this app wrote down as
 * expected and nobody redeemed.
 *
 * 🚨 **And it can never take a live item's bytes, by construction rather than
 * by care.** Every key it removes is a ticket's `stagingKey()` — the `pending/`
 * prefix — and no `media` row can carry one, because a delivered item's key
 * comes from `storageKey()`. It selects purely on `expiresAt`, and that is safe
 * exactly because the two key spaces do not meet: a redeemed ticket still sits
 * here until its hour is up (its address stays writable that long), and
 * sweeping it removes the staging object and the row, never the copy behind the
 * `media` row.
 *
 * ⚠️ **It removes ONE object per ticket, and no variant sweep belongs here.**
 * That looks like the gap `deleteMedia()` had and is not one: a ticket's object
 * sits on `stagingKey()`, nothing derives a variant from a staging key, and the
 * direct path refuses images outright (`kindNotDirect` — location data comes off
 * pictures and that needs the bytes in the process). So an abandoned upload never
 * had a variant to leave behind, and a REDEEMED one gained its variants against
 * the `media` row's delivery key, where `deleteMedia()` is what reaches them.
 * Adding a variant sweep to this loop would be a `remove()` per width against
 * keys that cannot exist.
 *
 * Not `pruneInBatches()`: that deletes rows in bulk, and every row here owes a
 * network round trip first. Same budget clock, different loop.
 *
 * **A failed removal keeps its row**, which is what makes the job safe to run
 * twice and safe to fail in the middle: the row is the only record that the
 * object exists, so dropping it would strand the bytes where nothing can ever
 * find them. Such rows are counted, excluded from the rest of THIS pass so the
 * loop cannot spin on them, and picked up again tomorrow.
 */
export async function pruneAbandonedUploads(
  now: Date,
  deadline: number,
): Promise<{ removed: number; failed: number; stoppedEarly: boolean }> {
  const store = mediaStore();
  const stuck: string[] = [];
  let removed = 0;

  for (;;) {
    const where = stuck.length
      ? and(lt(mediaUploads.expiresAt, now), notInArray(mediaUploads.id, stuck))
      : lt(mediaUploads.expiresAt, now);

    const batch = await db
      .select({ id: mediaUploads.id, storageKey: mediaUploads.storageKey })
      .from(mediaUploads)
      .where(where)
      .orderBy(mediaUploads.expiresAt)
      .limit(UPLOAD_SWEEP_BATCH);

    for (const ticket of batch) {
      try {
        // Object first, row second — the ordering rule at the top of this file.
        await store.remove(ticket.storageKey);
        await db.delete(mediaUploads).where(eq(mediaUploads.id, ticket.id));
        removed += 1;
      } catch (error) {
        stuck.push(ticket.id);
        console.error("[media] could not sweep an abandoned upload:", error);
      }
      // Checked here and not only after the batch. Every ticket owes a network
      // round trip, so a slow bucket used to overrun the budget by a whole
      // batch — 200 of them — and the lock this job holds is what the next tick
      // reads (`docs/cron.md`, rule 4).
      if (Date.now() >= deadline) {
        return { removed, failed: stuck.length, stoppedEarly: true };
      }
    }

    if (batch.length < UPLOAD_SWEEP_BATCH) {
      return { removed, failed: stuck.length, stoppedEarly: false };
    }
    // `stuck` is excluded from the next `select`, so it grows one bind
    // parameter per failure — and Postgres refuses a statement past 65 535 of
    // them. An unreachable bucket and a large backlog would therefore end the
    // job in a driver error instead of a report of what it managed. One batch
    // of failures is enough to know the bucket is the problem; the rest keep
    // until the next run.
    if (stuck.length >= UPLOAD_SWEEP_BATCH) {
      return { removed, failed: stuck.length, stoppedEarly: true };
    }
    if (Date.now() >= deadline) {
      return { removed, failed: stuck.length, stoppedEarly: true };
    }
  }
}

export async function findMedia(id: string): Promise<MediaRow | null> {
  const [row] = await db.select().from(media).where(eq(media.id, id)).limit(1);
  return row ?? null;
}

export interface Viewer {
  memberId: string | null;
  role: string | null;
}

/**
 * May this viewer have this item?
 *
 * The four visibilities, and one asymmetry worth stating rather than leaving
 * to be discovered: an **operator may fetch `entitled` content but not
 * `owner` content.** Entitled items are the product — the operator uploaded
 * them and sells them. An `owner` item is a customer's own file, and an
 * operator who wants to see what a customer sees has `impersonation` for that,
 * which is recorded. Reading a customer's uploads straight out of an admin
 * session would be the same capability without the record.
 *
 * During an impersonation `session.user.role` is `member`, so this function
 * treats an impersonating operator exactly as the member — which is the
 * behaviour AD-23 gives every other guard in the app for free.
 */
export async function mayAccess(row: MediaRow, viewer: Viewer): Promise<boolean> {
  if (row.visibility === "public") return true;
  if (!viewer.memberId) return false;

  // Any active session, and that is the whole condition — not the uploader,
  // not a plan, not a role. Placed directly after the anonymous return, which
  // makes it correct by construction: everything reaching this line has a
  // `memberId`. A BLOCKED account never gets here at all — `currentActiveUser()`
  // in the delivery route answers `blocked` before `mayAccess()` is called, the
  // same way it does for every other visibility.
  //
  // Deliberately NO role check. An operator seeing a member's avatar is right:
  // they are a signed-in member of the community too, and the owner/entitled
  // asymmetry above is about a customer's PRIVATE uploads, which these are not.

  if (row.visibility === "members") return true;

  if (row.visibility === "owner") {
    return row.ownerId === viewer.memberId;
  }

  // entitled
  if (viewer.role === "owner") return true;
  if (!row.requiresPlan) return false;

  // Write-time validation cannot cover a LATER edit. Retiring a product from
  // `config/digistore-products.json` is an ordinary thing to do and nothing
  // warns about the media rows pointing at it — and `hasPlan()` throws on a key
  // it does not know, so without this the delivery route and every server
  // component rendering the item answer 500 rather than refusing access.
  // Refusing is the right answer: a plan that no longer exists is a plan nobody
  // holds.
  if (planProblem(row.requiresPlan)) {
    console.error(
      `[media] ${row.id}: requiresPlan "${row.requiresPlan}" is no longer a product — ` +
        `access refused. Fix the row or restore the product.`,
    );
    return false;
  }

  return hasPlan(viewer.memberId, row.requiresPlan);
}

/**
 * Remove an item: **every** object first, then the row.
 *
 * A failure to remove an object stops the whole thing, deliberately. The
 * alternative — dropping the row anyway — loses the only pointer to a file
 * somebody asked to have deleted, and no later run can find it.
 *
 * 🚨 **"Every object" means the variants too, and the row is the only thing that
 * knows about them.** `media.variants` names the narrower copies and
 * `MediaStore` has no `list()`, so a deletion that took the row and left a
 * `…-w960.jpg` in the bucket would strand a customer's picture where nothing in
 * this app can ever name it again. Variants first, then the original, then the
 * row — the same one-direction ordering the top of this file sets out, extended
 * by one step rather than reasoned about afresh.
 */
export async function deleteMedia(id: string): Promise<void> {
  const row = await findMedia(id);
  if (!row) return;
  await removeMediaObjects(row);
  await db.delete(media).where(eq(media.id, id));
}

/**
 * The bytes of one item, all of them — shared by `deleteMedia()` and the account
 * sweep so the two cannot come to disagree about what an item is made of.
 *
 * It was one `remove()` in two places, and adding variants to only one of them
 * is precisely the drift `OWNED_MEDIA_VISIBILITIES` was made a constant to
 * prevent one level up: a deletion sweep narrower than the deletion is an app
 * that keeps a file it has promised to erase.
 */
async function removeMediaObjects(row: MediaRow): Promise<void> {
  await removeImageVariants(row);
  await mediaStore().remove(row.storageKey);
}

/**
 * Everything a member owns. Used by the export and by account deletion.
 *
 * **`owner` AND `members` visibility — both are the person's own.** What the
 * member uploaded for themselves, and the face they showed other members. The
 * second half is not an extension of convenience: it closes a gap that would
 * otherwise make "delete my account" false. Story 19.4 put avatars on the
 * `members` level, and this function is what account deletion consumes — with
 * `owner` alone, a member's picture would have survived their own deletion,
 * sitting in the bucket with the row's `ownerId` set to null so that nothing
 * left in the database could ever find it again.
 *
 * `public` and `entitled` stay OUT, and the original reasoning is unchanged by
 * the addition: an operator's product imagery has `ownerId` set to whoever
 * uploaded it too, and deleting the operator's account must not take the app's
 * lesson covers with it — which is why that foreign key is `set null` rather
 * than `cascade`. The line between the two halves is *whose data is this*, not
 * *who uploaded it*: a face is personal, a lesson cover is the product's.
 */
export async function listOwnedMedia(memberId: string): Promise<MediaRow[]> {
  return db
    .select()
    .from(media)
    .where(
      and(eq(media.ownerId, memberId), inArray(media.visibility, [...OWNED_MEDIA_VISIBILITIES])),
    );
}

/**
 * Delete every item a member owns, objects included — and every object an
 * unfinished upload of theirs may have left in the bucket.
 *
 * Called from account deletion. A Postgres cascade would remove rows and leave
 * every object in the bucket — the files would still be there, and the customer
 * would have been told they were gone.
 *
 * 🚨 **The second half is that same sentence about `media_uploads`, and it was
 * missing.** That table's `ownerId` IS `cascade`, so deleting the account took
 * the row — the only record that a `pending/` object exists, since the sweep
 * finds an object by reading this table and `MediaStore` has no `list()`. A
 * member who deleted their account with an upload in flight left their file in
 * the bucket permanently, unreachable by every later run. The schema comment
 * claimed the sweep covered it; the sweep is exactly what the cascade
 * disarmed.
 *
 * The count returned is of `media` rows, which is what both callers report on.
 * A ticket is an expectation rather than an item somebody had.
 */
export async function deleteOwnedMedia(memberId: string): Promise<number> {
  const rows = await listOwnedMedia(memberId);
  for (const row of rows) {
    // Every object of the item, variants included — through the same helper
    // `deleteMedia()` uses, so the sweep can never be the narrower of the two.
    await removeMediaObjects(row);
    await db.delete(media).where(eq(media.id, row.id));
  }

  // Object first, row second, and a failure stops the whole thing — the same
  // rule and for the same reason as above.
  const tickets = await db
    .select({ id: mediaUploads.id, storageKey: mediaUploads.storageKey })
    .from(mediaUploads)
    .where(eq(mediaUploads.ownerId, memberId));
  for (const ticket of tickets) {
    await mediaStore().remove(ticket.storageKey);
    await db.delete(mediaUploads).where(eq(mediaUploads.id, ticket.id));
  }

  return rows.length;
}
