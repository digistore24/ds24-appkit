// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The media rules — pure functions, no I/O, no database, no environment.
//
// Everything in this file answers a question that has one right answer given
// its inputs: which kind is this media type, is this size within the ceiling,
// may THIS role upload THAT type, what key does this item get in the bucket.
// The shells that do the work — `store.ts`, `manage.ts`, the routes — call in
// here rather than deciding for themselves, for the same reason
// `lib/tokens/rules.ts` and `lib/users/rules.ts` exist: a rule inside a route
// handler is a rule that gets a second, slightly different copy in the next
// route handler.
//
// ── Where it may be read ───────────────────────────────────────────────────
// Anywhere. This file imports nothing of the app and reads no configuration —
// the configuration is handed IN. That is what lets a client component use
// `formatBytes()` and a route handler use `refuseUpload()` from the same file.

/**
 * The four kinds of media an app puts in front of a customer.
 *
 * Written out rather than derived, for the same reason `PROVIDER_IDS` is: a
 * plain array cannot produce a union type, and the union is what stops a
 * typo'd kind reaching the database.
 *
 * A fifth kind is an entry in three tables — this list, the size ceilings in
 * `config/media.json`, and the signature table in `sniff.ts` — and nothing
 * else. That is the whole point of having kinds at all rather than a boolean
 * called `isImage`.
 */
export const MEDIA_KINDS = ["image", "video", "audio", "file"] as const;

export type MediaKind = (typeof MEDIA_KINDS)[number];

export function isMediaKind(value: unknown): value is MediaKind {
  return (MEDIA_KINDS as readonly unknown[]).includes(value);
}

/**
 * Who may fetch an item.
 *
 * These shapes are not a permission system and must not grow into one:
 *
 *   public    belongs to the PRODUCT — a lesson cover, the hero image of a
 *             generated sales page. The object is readable in the bucket and
 *             no request for its bytes ever reaches this app.
 *   owner     belongs to a PERSON — the photo a customer uploaded. Whoever
 *             uploaded it, and nobody else.
 *   entitled  belongs to the product but was PAID FOR — the PDF or the
 *             software a buyer gets. `hasPlan()` decides, which is the same
 *             call the rest of the app already makes.
 *   members   belongs to the COMMUNITY — a face members show each other. Any
 *             active session, and nothing more: not the uploader alone, not a
 *             plan, not a role.
 *
 * ── The fourth shape, and why this one really is a fourth shape ────────────
 * This header said for three releases that "a fourth shape is almost always
 * one of these three with a different question attached; ask whether
 * `entitled` with another Product Key would do it." That argument is right,
 * and it is the reason `members` was added only after each of the three was
 * tried against the actual requirement (FR-185: a profile picture is visible
 * to signed-in members, never anonymously, never indexed). Each fails, and
 * each fails DIFFERENTLY — which is what makes this a shape rather than a
 * question:
 *
 *   public    would serve the picture to the open web with no session at all,
 *             and the object stays readable in the bucket for ever after. The
 *             requirement is the exact opposite of this one.
 *   owner     would show the member their own face and nobody else's — a
 *             community in which no member can see another member is not the
 *             feature.
 *   entitled  would gate a member's face behind a PURCHASE. Whichever Product
 *             Key were chosen, a member who has not bought that plan could not
 *             see their neighbours, and `hasPlan()` answers false for a token
 *             package for ever. Faces are not something anybody buys.
 *
 * `lib/media/rules.test.ts` carries those three as executable tests rather
 * than as prose, so the argument stays checked rather than remembered.
 *
 * The bar for a FIFTH shape is unchanged and should be read as raised: name
 * the requirement, try all four, and show that each fails in its own way.
 */
export const MEDIA_VISIBILITIES = ["public", "owner", "entitled", "members"] as const;

export type MediaVisibility = (typeof MEDIA_VISIBILITIES)[number];

/**
 * The visibilities that make an item the MEMBER'S OWN.
 *
 * What a person uploaded for themselves (`owner`) and the face they showed
 * other members (`members`). Both go with them when the account goes, and both
 * belong in their subject access request.
 *
 * `public` and `entitled` are the PRODUCT'S, whoever happened to upload them —
 * deleting the operator's account must not take the app's lesson covers with
 * it. The line is *whose data is this*, not *who uploaded it*.
 *
 * It is a constant rather than a repeated literal because it has THREE
 * consumers that must never disagree: `listOwnedMedia()` (which account
 * deletion consumes AND `app/api/v1/media` lists from) and the `media` section
 * of the member export. They lived
 * as two separate `eq(visibility, "owner")` clauses in two files until Story
 * 19.4 needed both to grow — and a deletion sweep that is narrower than the
 * export is an app that shows somebody a file it has promised to delete.
 */
export const OWNED_MEDIA_VISIBILITIES = ["owner", "members"] as const;

export function isMediaVisibility(value: unknown): value is MediaVisibility {
  return (MEDIA_VISIBILITIES as readonly unknown[]).includes(value);
}

/** Where the bytes came from. */
export const MEDIA_SOURCES = ["upload", "generated"] as const;

export type MediaSource = (typeof MEDIA_SOURCES)[number];

/**
 * Every way a media operation can be refused, as a code.
 *
 * A code and not a sentence — the same deal `lib/users/rules.ts` and
 * `lib/tokens/rules.ts` make (AD-10). This module has no language; the route
 * or the Server Action translates. `i18n/messages.test.ts` fails the build if
 * one of these has no text in both `messages/de.json` and `messages/en.json`.
 */
export const MEDIA_ERROR_CODES = [
  /** No session, or a blocked account. */
  "notSignedIn",
  /** Too many uploads in the window. */
  "rateLimited",
  /** Nothing in the request. */
  "noFile",
  /** Over the ceiling for its kind. The message names the ceiling. */
  "tooLarge",
  /** The bytes are not a media type this installation accepts at all. */
  "typeNotAllowed",
  /**
   * The right kind of file, but a broken copy of one.
   *
   * Distinct from `typeNotAllowed` because the two send a person in opposite
   * directions. A JPEG truncated by a flaky mobile connection used to be
   * refused with "this kind of file is not accepted here", which is untrue —
   * JPEGs are accepted — and sends them off to convert a format that was never
   * the problem, when the fix is to send it again.
   */
  "fileDamaged",
  /** The bytes disagree with what the request claimed they were. */
  "typeMismatch",
  /** A real media type, but not one this role may upload. */
  "notAllowedForRole",
  /** The item does not exist, or the caller may not know that it does. */
  "notFound",
  /** It exists and the caller may not have it. */
  "noAccess",
  /** The store is misconfigured or unreachable. */
  "storeUnavailable",
  /** An image was offered with no alternative text. */
  "altRequired",
  /**
   * The upload ticket is not one this member may redeem.
   *
   * ONE code for three situations — never minted, already expired, and issued
   * to somebody else — and that is deliberate, on the same argument `notFound`
   * above makes for itself. A ticket id is guessable in a way a media id is
   * not (it is handed out constantly and lives in a browser), so "that one
   * exists, it is simply not yours" is a confirmation, and three codes are an
   * existence oracle with extra steps.
   */
  "uploadTicketInvalid",
  /**
   * The ticket is good and the object is not in the bucket.
   *
   * Distinct from `noFile`, and the distinction is the whole reason it exists:
   * `noFile` means the REQUEST carried nothing, and the answer is "attach the
   * file". This means the request was fine and the browser's write to the
   * bucket never landed — CORS refused it, the network dropped it, the tab was
   * closed mid-transfer. The answer is "upload it again", and telling somebody
   * to attach a file they did attach is how a support conversation goes in a
   * circle.
   */
  "uploadMissing",
  /**
   * A real, allowed media type — but not on the direct path.
   *
   * Today that means an image, and the reason is a promise rather than a
   * limitation: `docs/data-protection.md` says location and camera data are
   * removed from uploaded images, and stripping needs the bytes to pass
   * through the app. An image goes through the ordinary door, where it still
   * fits; nothing is refused that was accepted before.
   */
  "kindNotDirect",
] as const;

export type MediaErrorCode = (typeof MEDIA_ERROR_CODES)[number];

export class MediaError extends Error {
  readonly code: MediaErrorCode;

  constructor(code: MediaErrorCode, message?: string) {
    super(message ?? code);
    this.name = "MediaError";
    this.code = code;
  }
}

/** What one kind may be and how big it may get. */
export interface KindRule {
  maxBytes: number;
  mimeTypes: readonly string[];
  /**
   * How long a minted address for a private item stays valid, in seconds.
   *
   * Per kind, deliberately, and this is a real trade rather than a knob. Sixty
   * seconds is plenty for an image and takes a forty-minute video down the
   * moment the player re-requests a later byte range. Longer means the address
   * can be passed to somebody else for that long — for paid content that is an
   * accepted cost, and `docs/visuals.md` says so rather than leaving a vendor
   * to discover it.
   */
  signedUrlSeconds: number;
}

/** The whole media configuration, after `config.ts` has read and defaulted it. */
export interface MediaRules {
  kinds: Record<MediaKind, KindRule>;
  /** Which media types each role may put in. Keyed by `users.role`. */
  mayUpload: Record<string, readonly string[]>;
}

/** Which kind a media type belongs to, or null if this installation takes none. */
export function kindForMime(rules: MediaRules, mime: string): MediaKind | null {
  const wanted = mime.trim().toLowerCase();
  for (const kind of MEDIA_KINDS) {
    if (rules.kinds[kind].mimeTypes.includes(wanted)) return kind;
  }
  return null;
}

/**
 * May this role upload this media type, and is the size within its ceiling?
 *
 * Returns a code or null. Null means yes.
 *
 * The order matters and is not cosmetic: an unknown type is refused before its
 * size is considered, because "10 MB is too large" is a confusing answer to
 * somebody who uploaded a file format the app never accepts. And the role check
 * comes before the size check for the same reason.
 */
export function refuseUpload(
  rules: MediaRules,
  input: { role: string; mime: string; bytes: number },
): MediaErrorCode | null {
  const kind = kindForMime(rules, input.mime);
  if (!kind) return "typeNotAllowed";

  const allowed = rules.mayUpload[input.role] ?? [];
  if (!allowed.includes(input.mime.trim().toLowerCase())) return "notAllowedForRole";

  if (input.bytes <= 0) return "noFile";
  if (input.bytes > rules.kinds[kind].maxBytes) return "tooLarge";

  return null;
}

/**
 * Does an item of this kind need alternative text?
 *
 * Images do and nothing else does. A PDF has no alternative text, a recording
 * has none, and demanding one would produce the thing accessibility rules exist
 * to prevent: a field filled in with "file" to get past a validator.
 *
 * The guarantee that an image cannot reach a page without one lives in the TYPE
 * of `components/ui/figure.tsx`, not here — a compile error beats a runtime
 * refusal. This function is the same rule for the paths a type cannot reach:
 * the upload endpoint and the generator.
 */
export function needsAlt(kind: MediaKind): boolean {
  return kind === "image";
}

/**
 * The file extension for a media type — used only to make a stored object
 * recognisable to a human browsing the bucket.
 *
 * Never used to decide anything. What a thing IS comes from its bytes
 * (`sniff.ts`); an extension is a label somebody typed.
 */
const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "application/pdf": "pdf",
  "application/zip": "zip",
  "text/vtt": "vtt",
};

export function extensionFor(mime: string): string {
  return EXTENSIONS[mime.trim().toLowerCase()] ?? "bin";
}

/**
 * Media types whose bytes are served BY THIS APP, never via a bucket address.
 *
 * The exception exists for subtitle text, and the reason is a browser rule,
 * not a preference: a `<track>` fetch is CORS-restricted where `<video src>`
 * is not, and it will not follow a redirect to a foreign host. A subtitle
 * pointed at a signed bucket URL fails SILENTLY — the video plays, the CC
 * menu is empty, and nothing anywhere logs why. Streaming through the app
 * costs nothing that matters here: a VTT is kilobytes, issues no range
 * requests, and is fetched once per view — none of the reasons the
 * bytes-stay-in-the-bucket rule exists (docs/visuals.md) apply to it.
 */
export function servedThroughApp(mime: string): boolean {
  return mime.trim().toLowerCase() === "text/vtt";
}

/**
 * Which subsystem an object belongs to, and what it is FOR inside it.
 *
 * The two segments a key starts with, and the reason the key has them at all:
 * a bucket holding fifty thousand objects under `image/` cannot tell an avatar
 * from a lesson cover, and a lifecycle rule scoped to one subsystem cannot be
 * written at all. The KIND was in the key and the OWNER was not.
 *
 * ── Who says what ──────────────────────────────────────────────────────────
 * The `namespace` names the subsystem that OWNS the objects — `core` for the
 * app's own doors, and otherwise a module's own id. A transport does not get
 * one: the HTTP API reuses the generic upload door rather than building a
 * second, so the objects are still the core's. The `category` names the
 * purpose within it, and it is what an operator reads to know why the object
 * is there — `profile`, `cover`, `video`, `upload`, `generated`.
 *
 * Both are decided at the CALL SITE and neither is ever read from a request.
 * They shape a path on the local driver (`local.ts`) and a signed URL's path
 * online, so they are held to a narrow grammar below rather than trusted.
 */
export interface MediaSlot {
  namespace: string;
  category: string;
}

/**
 * Namespaces nobody may take, each because somebody already has it.
 *
 * 🚨 **`pending` is the one that matters, and it is the reason this list is a
 * refusal rather than a note.** The abandoned-upload sweep removes whatever a
 * ticket row names, and that is safe for one structural reason: a DELIVERED
 * item's key can never begin with the staging prefix (`stagingKey()` below
 * carries the whole argument). While the prefix is a namespace nothing may
 * claim, that disjointness is free — one comparison, once, here. Namespacing
 * the staging keys themselves would have turned it into a property to re-prove
 * for every namespace/category pair anybody ever adds, and a guarantee that has
 * to be re-proved per caller is not a guarantee. So `stagingKey()` is untouched
 * and this is what keeps the two key spaces apart.
 *
 * The other three are key spaces with a DIFFERENT owner, and each is
 * deterministic where an upload key is not:
 *
 *   - the product-media prefix, whose keys are `<topic>/<file>` under it
 *     (`lib/content-media/rules.mjs`). It is the identity of `content-apply`'s
 *     upsert — `on conflict (storage_key)` — so an upload landing there would
 *     be indistinguishable from declared product media, and the next apply
 *     would assert it. `lib/content/writers.test.ts` forbids the literal in
 *     this file outright, which is why this list holds the bare segment.
 *   - the assistant's knowledge media (`lib/knowledge-media/rules.mjs`).
 *   - the throwaway objects `node run.mjs media-check` writes and deletes.
 */
export const RESERVED_MEDIA_NAMESPACES = [
  "pending",
  "content",
  "knowledge",
  ".media-check",
] as const;

/**
 * What either segment may look like: lower case, starting with a letter.
 *
 * Narrow on purpose. The key is a filesystem path on the local driver and a
 * signed URL's path online, so a dot, a slash or an upper-case letter is a
 * traversal, a second prefix level or a key that differs between two
 * providers' idea of case. The reserved names above are checked separately
 * because one of them (`.media-check`) could not pass this anyway.
 */
const MEDIA_SLOT_SEGMENT = /^[a-z][a-z0-9-]*$/;

/**
 * The key an item gets in the bucket.
 *
 * **Derived, never supplied.** This is the single most important line in the
 * file. A key taken from a request is a path traversal (`../../`), a collision
 * with somebody else's object, or an overwrite of one — and the request that
 * does it looks exactly like an ordinary upload. So the key is built from the
 * row's own id, which this app generated, and nothing a caller sent.
 *
 * The slot is the exception that proves the rule: the namespace and the
 * category come from the caller, and they are the only two things that do —
 * which is why they are validated here rather than trusted. A door decides
 * them in code, the way it already decides the visibility.
 *
 * The date folders are for humans: a bucket with fifty thousand objects in one
 * prefix is one nobody can look at, and "which of these arrived in March" is the
 * question somebody actually asks. They are not read by any code. Adding a
 * level above them does not touch that argument.
 *
 * The original filename is NOT in the key. It travels in the row and is applied
 * at download time through `response-content-disposition`, so a customer named
 * file cannot shape the storage layout.
 *
 * 🚨 **It THROWS on a bad slot, and the throw is not a `MediaError`.** Every
 * `MediaError` code is a sentence somebody gets shown, and none of these can
 * be: a namespace never comes from customer input, so a bad one is a
 * programming error at a call site and the only useful answer is a diagnostic
 * naming the value. A silent fallback would put objects somewhere nobody
 * looks — which is the failure this whole grammar exists to end.
 */
export function storageKey(input: MediaSlot & { id: string; mime: string; createdAt: Date }): string {
  const namespace = slotSegment("namespace", input.namespace);
  const category = slotSegment("category", input.category);

  if ((RESERVED_MEDIA_NAMESPACES as readonly string[]).includes(namespace)) {
    throw new Error(
      `storageKey(): "${namespace}" is a reserved media namespace and belongs to another key ` +
        `space — see RESERVED_MEDIA_NAMESPACES in lib/media/rules.ts for who holds it. ` +
        `An upload landing there is indistinguishable from that owner's objects.`,
    );
  }

  const year = input.createdAt.getUTCFullYear();
  const month = String(input.createdAt.getUTCMonth() + 1).padStart(2, "0");
  return `${namespace}/${category}/${year}/${month}/${input.id}.${extensionFor(input.mime)}`;
}

/** One segment, trimmed and held to the grammar — or a diagnostic naming it. */
function slotSegment(field: "namespace" | "category", value: string): string {
  const trimmed = String(value ?? "").trim();
  if (!MEDIA_SLOT_SEGMENT.test(trimmed)) {
    throw new Error(
      `storageKey(): ${field} "${value}" is not a usable path segment. It must match ` +
        `${MEDIA_SLOT_SEGMENT.source} — the key is a filesystem path on the local driver and a ` +
        `signed URL's path online, so anything else is a traversal or a key two providers ` +
        `disagree about.`,
    );
  }
  return trimmed;
}

/**
 * The narrower widths an uploaded picture is also stored at, in pixels.
 *
 * ── Why there are any at all ────────────────────────────────────────────────
 * `next.config.ts` declares no `images.remotePatterns`, for two reasons written
 * out there, so bucket media reaches the browser `unoptimized` — a 4 MB photo
 * somebody took on a phone goes back to a phone at full size, and until this
 * list existed nothing in the template caught that. `/_next/image` cannot be the
 * answer (a build-time config cannot know a run-time bucket, and a pattern for a
 * shared bucket host is an open resizing proxy). Deriving the widths **while the
 * bytes are already in the process** needs no proxy and works at every provider.
 *
 * ── Why these three ────────────────────────────────────────────────────────
 * A phone is ~390 CSS px at DPR 2–3, so it wants 780–1170 real pixels; a tablet
 * at 768 px wants ~1536. 480 covers a thumbnail and a small phone at DPR 1,
 * 960 the ordinary phone, 1440 the tablet and a narrow desktop column. Three
 * rather than six because every one of them is a resize on upload, an object in
 * the bucket and a `remove()` on deletion — and the browser interpolates
 * between candidates far better than a fourth entry here would help.
 *
 * ⚠️ **Appending to this list does not backfill.** A row records the widths that
 * were derived FOR IT (`media.variants`), so an existing picture keeps the set
 * it got and a new one gets the new set. That is what makes the list safe to
 * change; deriving the addresses from this constant instead of from the row
 * would make every old picture answer 404 for a width nobody ever wrote.
 */
export const MEDIA_VARIANT_WIDTHS = [480, 960, 1440] as const;

/**
 * Which of those widths are worth deriving for a picture this wide.
 *
 * **Downscales only.** A 600 px picture gets a 480 and nothing else: an
 * "upscale" is the same bytes made larger and blurrier, costing storage to
 * serve a worse image than the original. The comparison is strict, so a
 * picture exactly 960 px wide produces no 960 variant — it already IS one.
 */
export function variantWidthsFor(originalWidth: number): number[] {
  if (!Number.isFinite(originalWidth) || originalWidth <= 0) return [];
  return MEDIA_VARIANT_WIDTHS.filter((width) => width < originalWidth);
}

/** A stem that already carries a width marker — `…-w960`. */
const VARIANT_SUFFIX = /-w\d+$/;

/**
 * The key one narrower copy gets — a SIBLING of the delivery key.
 *
 * **Derived, never supplied**, on exactly the argument `storageKey()` makes for
 * itself: it is built from a key this app wrote and a width out of
 * `MEDIA_VARIANT_WIDTHS`, and nothing a caller sent. `…/<id>.jpg` becomes
 * `…/<id>-w960.jpg`, so an operator browsing the bucket sees the copies next to
 * the original and one lifecycle rule reaches all of them.
 *
 * 🚨 **It cannot collide with another item's delivery key**, and that is
 * structural rather than lucky: a delivery key's stem is a UUID, and
 * `<uuid>-w960` is not one. `media.storageKey` is UNIQUE besides, so a
 * collision could not even be written.
 *
 * 🚨 **It THROWS rather than returning something wrong**, for the reason
 * `storageKey()` gives: neither argument can come from customer input, so a bad
 * one is a programming error at a call site and a silent fallback would put
 * objects somewhere nothing ever looks. Refusing a key that is ALREADY a
 * variant is part of that — `…-w480-w960.jpg` is a copy of a copy, and the
 * caller that produced it has lost track of which key it holds.
 */
export function variantKey(deliveryKey: string, width: number): string {
  if (!Number.isInteger(width) || width <= 0) {
    throw new Error(
      `variantKey(): width ${width} is not a pixel count. The widths come from ` +
        `MEDIA_VARIANT_WIDTHS; anything else means a caller computed one.`,
    );
  }

  const slash = deliveryKey.lastIndexOf("/");
  const dot = deliveryKey.lastIndexOf(".");
  // A dot inside a folder name is not an extension. `extensionFor()` always
  // gives one (`bin` for the unknown), so a key with none is a legacy row — it
  // still gets a sibling, with the marker at the end.
  const hasExt = dot > slash && dot < deliveryKey.length - 1;
  const stem = hasExt ? deliveryKey.slice(0, dot) : deliveryKey;
  const ext = hasExt ? deliveryKey.slice(dot) : "";

  if (VARIANT_SUFFIX.test(stem)) {
    throw new Error(
      `variantKey(): "${deliveryKey}" is already a variant key. A variant is derived ` +
        `from the DELIVERY key (media.storageKey), never from another variant.`,
    );
  }

  return `${stem}-w${width}${ext}`;
}

/**
 * Where the BROWSER writes on the direct path — never where the item is served
 * from.
 *
 * 🚨 **This is the whole answer to "a presigned PUT stays writable after the
 * confirm".** A presigned address is time-bounded, not use-bounded: it can be
 * replayed until it expires, and every replay overwrites the key it points at.
 * While that key was the delivery key, every check the confirm step makes was a
 * measurement of one moment rather than a promise — write a one-kilobyte MP4,
 * confirm it, then push a gigabyte or a location-bearing JPEG onto the same
 * address, and the row still says what the first upload was.
 *
 * So the address the browser gets points HERE, and the confirm step copies the
 * object server-side onto `storageKey()` (`MediaStore.copy()` — a `PUT` with
 * `x-amz-copy-source`, so no byte travels through this process). Afterwards the
 * address the client holds addresses a key nothing reads, nothing serves and
 * nothing renders; the sweep removes it at the ticket's expiry.
 *
 * The prefix is its own so the two key spaces cannot overlap: the sweep only
 * ever removes a `pending/` object, and a delivered item's key can never be one
 * — which is why an expired ticket can no longer take a live `media` row's
 * bytes with it.
 *
 * 🚨 **It is deliberately NOT namespaced, and that is a decision rather than an
 * omission.** `core/pending/…` reads more systematically and would cost the
 * sentence above: the disjointness would stop being one string comparison and
 * become a property to prove for every namespace/category pair anybody adds.
 * `RESERVED_MEDIA_NAMESPACES` is what holds it instead — `pending` is a
 * namespace `storageKey()` refuses, so this prefix stays a space of its own for
 * nothing.
 */
export function stagingKey(input: { id: string; mime: string; createdAt: Date }): string {
  const year = input.createdAt.getUTCFullYear();
  const month = String(input.createdAt.getUTCMonth() + 1).padStart(2, "0");
  return `pending/${year}/${month}/${input.id}.${extensionFor(input.mime)}`;
}

/**
 * A filename safe to put in a `Content-Disposition` header.
 *
 * A header value carrying a quote or a newline is a header injection, and the
 * name here came from whoever uploaded the file. Everything outside a narrow
 * set becomes an underscore, and an empty result gets a name rather than none —
 * a download called `""` saves as the URL's last segment, which is the storage
 * key this function exists to keep out of sight.
 */
export function safeFilename(name: string, fallbackExt: string): string {
  const cleaned = name
    .replace(/[\r\n"\\]/g, "")
    .replace(/[^A-Za-z0-9._ ()-]/g, "_")
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned === "" || cleaned === "." || cleaned === "..") {
    return `download.${fallbackExt}`;
  }
  if (cleaned.length <= MAX_FILENAME) return cleaned;

  // **Shorten the stem, keep the extension.** A blunt slice cut the extension
  // off the end, and a download called `aaaa…` with no `.pdf` does not open —
  // which is a worse outcome than a long name.
  // `dot < cleaned.length - 1` is what makes a TRAILING dot not count as an
  // extension. Without it a name ending in one satisfied `hasExt`, `ext` became
  // `"."`, and the result was 120 characters ending in a bare dot with the
  // fallback never applied — the exact outcome this branch exists to prevent,
  // reached by the branch itself. It is not a contrived input: the sanitiser
  // above strips quotes, so an ordinary `…report."` arrives here as `…report.`.
  const dot = cleaned.lastIndexOf(".");
  const hasExt = dot > 0 && dot < cleaned.length - 1 && cleaned.length - dot <= 12;
  const ext = hasExt ? cleaned.slice(dot) : `.${fallbackExt}`;
  return cleaned.slice(0, Math.max(1, MAX_FILENAME - ext.length)) + ext;
}

/** Long enough for any real filename, short enough for any filesystem. */
const MAX_FILENAME = 120;

/**
 * What a **Server Action** may carry, in bytes — `next.config.ts` →
 * `experimental.serverActions.bodySizeLimit`, as a number.
 *
 * 🚨 **A form that posts to a Server Action has TWO ceilings, and the lower one
 * is not in `config/media.json`.** The per-kind ceiling there is what may be
 * STORED; this is what may ARRIVE. And this one is the unkind of the two: Next
 * refuses while it is decoding the payload, BEFORE the action runs, so there is
 * nothing to catch, nothing to translate and no number to show — the operator
 * gets an unhandled rejection. `next.config.ts` says so in its own words above
 * the setting.
 *
 * So the number is made readable here rather than left implicit, and
 * `rules.test.ts` reads `next.config.ts` as text and pins the two together — a
 * hard-coded 10 in a form is the copy that is wrong after somebody raises the
 * setting.
 */
export const SERVER_ACTION_BODY_LIMIT_BYTES = 10 * 1024 * 1024;

/**
 * The ceiling a Server Action upload slot really has: the lower of what its
 * kind may store and what a request body may carry.
 *
 * Handed the kind's `maxBytes` rather than reading the config itself, because
 * this file reads no configuration — which is what lets a client component ask
 * the same question the action answers.
 */
export function slotCeilingBytes(kindMaxBytes: number): number {
  return Math.min(kindMaxBytes, SERVER_ACTION_BODY_LIMIT_BYTES);
}

/**
 * What a **route handler** of this app lets through the process, in bytes.
 *
 * 🚨 **The third number, and it exists because the other two are both wrong
 * here.** `SERVER_ACTION_BODY_LIMIT_BYTES` is `next.config.ts` →
 * `experimental.serverActions.bodySizeLimit`, which applies to Server Actions
 * and to nothing else — a route handler never sees it. Using it at
 * `handleUpload()` refused a 30 MB recording that the HTTP API had accepted and
 * stored for as long as it existed, which is a capability taken away to solve a
 * problem that door does not have.
 *
 * The kind's raw `maxBytes` is not the answer either, and became less of one
 * when `video` moved to 2 GB for the direct path: `request.formData()` buffers
 * the whole body before anything is checked, so quoting a gigabyte at this door
 * promises an outage. What may be STORED, what may arrive at an ACTION and what
 * this app buffers on a REQUEST are three questions, and only the third one is
 * this.
 *
 * 50 MB, which is what the doors here carried before the ceiling moved
 * (`audio` and `file` in `config/media.json`, and `video` until Story 8.1) —
 * chosen so the change takes nothing away, and named so raising it is a
 * decision somebody makes rather than a side effect of editing a kind. Anything
 * larger is what the direct-to-bucket path is for (`docs/visuals.md`,
 * `docs/api.md`).
 */
export const ROUTE_HANDLER_BODY_LIMIT_BYTES = 50 * 1024 * 1024;

/**
 * The ceiling an upload through a ROUTE HANDLER really has: the lower of what
 * its kind may store and what this app buffers on one request.
 *
 * The twin of `slotCeilingBytes()`, and separate from it on purpose — a single
 * function would have to guess which door is asking, and the two answers differ
 * by a factor of five.
 */
export function routeCeilingBytes(kindMaxBytes: number): number {
  return Math.min(kindMaxBytes, ROUTE_HANDLER_BODY_LIMIT_BYTES);
}

/**
 * How long a direct-to-bucket upload address stays valid, in seconds.
 *
 * 🚨 **This is half of the answer to "a presigned PUT cannot enforce a
 * length".** `X-Amz-SignedHeaders` is `host` and a `content-length-range`
 * condition exists only for POST policies, so nothing in the address stops a
 * client writing far more than it promised. The app measures afterwards with
 * `head()` and removes what is over — but "afterwards" only bounds the damage
 * if the window is short, because an address that lives for a day is one that
 * can be handed to somebody else and used to fill a bucket.
 *
 * What the window does NOT have to bound any more is the delivered object: the
 * address writes to `stagingKey()`, and the confirm step copies from there onto
 * the key that gets served. A replay after the confirm reaches a key nothing
 * reads, and this expiry is when the sweep collects it.
 *
 * An hour, because that is what a slow connection genuinely needs for a
 * multi-hundred-megabyte recording and what nobody needs twice. A ticket that
 * runs out has cost nothing: the sweep removes it, and minting another is one
 * request.
 */
export const UPLOAD_TICKET_SECONDS = 60 * 60;

/** "2,4 MB" — for the ceiling in a refusal and for the download presentation. */
export function formatBytes(bytes: number, locale = "en"): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const formatted = new Intl.NumberFormat(locale, {
    maximumFractionDigits: unit === 0 ? 0 : 1,
  }).format(value);
  return `${formatted} ${units[unit]}`;
}
