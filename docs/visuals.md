<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# Media — pictures, video, recordings, and the files you sell

> **Needs template 0.7.0 or newer.** `lib/media/` and the `image` task arrived
> with it. If `node run.mjs media-check` is not a command your app has, this
> document is describing code you do not carry yet — `node run.mjs update`
> brings the text, not the code, so the way to get both is a newer template.

Everything your app puts in front of a customer that is not text goes through
one place: `lib/media/`. Four kinds — **image, video, audio, file** — one store,
and four answers to "who may fetch this".

Delivery, the size ceiling and the byte-signature check are all decided **per
kind**, which is what keeps this one subsystem: a new file type is a row in a
table, never a second store beside the first.

Check it any time with:

```bash
node run.mjs media-check
```

That command writes a throwaway object, reads it back, compares the bytes and
deletes it again, and then **prints what may go in** — the kinds, their ceilings
and which role may upload which. Credentials that look right and a bucket that
does not exist are indistinguishable until something tries.

---

## Where the files live, and why that is not a detail

**In development:** nothing to set up. Files go to `.data/media/` on your
machine and everything works.

**Online: a bucket, or the app does not start.**

That refusal is deliberate and it is the one thing in this document worth
reading twice. A local disk works perfectly while your app runs on one machine,
which is exactly the problem — the failure it produces only appears *after* you
are successful:

- The next redeploy loses every file that was ever uploaded.
- A second instance has its own disk. An upload lands on one, the next request
  is answered by the other, so a customer's picture is there **about half the
  time**. To them the app is losing things; to you it is a bug you cannot
  reproduce, because you are testing on one machine.

A warning is the wrong instrument for a fault that stays invisible until it is
expensive. So `lib/env-guard.ts` refuses to start in STAGING and PROD without
object storage, the same way it refuses to start without mail delivery.

### Seven providers, and one big one that does not work

The app signs its own requests — no SDK — so **"S3-compatible" is only true of
the features this driver actually uses**: a presigned GET and PUT signed with
`AWS4-HMAC-SHA256`, a server-side copy, and `response-content-*` overrides on a
signed GET. These seven fit, and are the same code path with a different
endpoint:

| | Endpoint looks like | Region |
|---|---|---|
| Amazon S3 | `https://s3.eu-central-1.amazonaws.com` | **required** |
| DigitalOcean Spaces | `https://fra1.digitaloceanspaces.com` | recommended |
| Cloudflare R2 | `https://<account>.r2.cloudflarestorage.com` | not needed (`auto`) |
| Backblaze B2 | `https://s3.eu-central-003.backblazeb2.com` | **required** |
| Hetzner Object Storage | `https://fsn1.your-objectstorage.com` | recommended |
| MinIO (your own server) | `https://minio.example.com` | not needed |
| Wasabi | `https://s3.eu-central-2.wasabisys.com` | **required** |

```bash
MEDIA_DRIVER=s3
MEDIA_S3_ENDPOINT=https://fra1.digitaloceanspaces.com
MEDIA_S3_REGION=fra1
MEDIA_S3_BUCKET=my-app-media
MEDIA_S3_ACCESS_KEY_ID=...
MEDIA_S3_SECRET_ACCESS_KEY=...
```

The skill **`setup-hosting`** books one alongside your database, so on the
ordinary path you never type these by hand.

🚨 **`MEDIA_S3_REGION` is only optional on some of them.** It defaults to
`auto`, which is exactly what Cloudflare R2 documents and what MinIO ignores —
and AWS S3, Backblaze B2 and Wasabi **validate** the string and answer 403
without it. Unset against one of those, the failure lands on the first upload:
after your customer picked the file and waited for it to travel, with
`SignatureDoesNotMatch` as the only clue and the credentials as the obvious
suspect. `node run.mjs media-check` now says this in words instead of printing
`(region auto)` as if it were information, and
[`DEPLOY.md`](DEPLOY.md) lists the region as required for everything but R2.

It is deliberately **not** a start-up refusal. The app cannot tell which
provider it is talking to — it infers the *addressing style* from the endpoint's
host and nothing infers the vendor — so a guard would have to guess, and a wrong
guess refuses a working R2 setup. Refusing too much is the worse direction here.

`MEDIA_S3_ENDPOINT` must be an **origin** — no path. The bucket name belongs in
`MEDIA_S3_BUCKET`; a path in the endpoint is signed differently from the one the
request uses, so everything answers 403 and nothing says why.
`node run.mjs media-check` refuses it.

You do not have to say which addressing style your provider wants: if the
endpoint's host already begins with the bucket name the key is the whole path,
otherwise the bucket is the first path segment. Both work, and a wrong guess
would be a 404 with no explanation attached.

#### Google Cloud Storage is NOT carried

It is the provider you are most likely to already have, which is why this is
written down rather than left to a 403 on somebody's launch day. GCS has an
S3-compatible ("XML") API, and **this driver does not fit it.** Three
mismatches, all in the signing, none of them a setting:

| | This app sends | Google documents |
|---|---|---|
| presign algorithm | `AWS4-HMAC-SHA256` | `GOOG4-HMAC-SHA256` |
| server-side copy | `x-amz-copy-source` + `x-amz-metadata-directive: REPLACE` | "change any existing `x-amz-*` headers to corresponding `x-goog-*` headers" |
| signed GET overrides | `response-content-type`, `response-content-disposition` | undocumented |

The first two are the course-video upload and the copy that makes its checks a
promise rather than a snapshot (below), so this is not a corner of the feature —
it is the middle of it.

**Why this is text and not a `goog` driver.** A second signer is code, and code
claiming support that nobody measured is worse than an honest "not carried": it
fails in a customer's app rather than in a check, on the one path where the
failure costs an upload somebody already waited for. So the exclusion ships as a
sentence.

**What would overturn it, exactly:** a GCS bucket with HMAC keys and a green
`node run.mjs media-check`. That command writes, reads, HEADs, **copies** and
deletes a real object, so it exercises all three rows above. If it comes back
green, the answer here was wrong and this section is what to correct.

### What the keys in your bucket look like

You will open that bucket one day — to work out what is filling it, to put a
lifecycle rule on one part of it, or because somebody asked what you store. So
the key says **whose object it is** and **what it is for**, and then when it
arrived:

```
<namespace>/<category>/<YYYY>/<MM>/<id>.<ext>
```

| Key | What it is |
|---|---|
| `core/upload/2026/08/…` | anything through the app's own upload door — `POST /api/media`, and the HTTP API's `/api/v1/media`, which reuses it |
| `core/setup/2026/08/…` | put there by your agent over the setup surface |
| `core/generated/2026/08/…` | made by a model — `generateImage()` |
| `community/profile/2026/08/…` | a member's profile picture |
| `community/post/2026/08/…` | a picture a member attached to a post ([`community.md`](community.md) → *Pictures in a post*) |
| `courses/cover/…`, `courses/video/…`, `courses/subtitle/…`, `courses/worksheet/…` | a lesson's four media slots |
| `content/<topic>/<file>` | **product media from the repo** — a different key space with a different owner. It is deterministic on purpose, because that is what lets a page name a file by path and be right in DEV and in PROD ([`content.md`](content.md)) |
| `knowledge/<path>` | the assistant's large media ([`knowledge.md`](knowledge.md)) |
| `pending/2026/08/…` | the direct path's staging objects, swept at their ticket's expiry (below) |

The whole shape is built by `storageKey()` — nothing anywhere else assembles a
key. The namespace is `core` for the app's own doors and otherwise a **module's
own id**, and `modules/boundary.test.ts` fails the build on a module that claims
another's namespace, that **imports a storage driver** of its own, or that
**writes to a disk** of its own. A transport does not get a namespace of its
own: the HTTP API stores through the same door, so those objects are the core's.
The date folders are for you and are read by no code.

⚠️ **The `<category>` slot travels from the CALLER, and it is a compile error to
omit.** It is the only part of a key that is not derived from the row or the
clock, which is why `storageKey()` validates it rather than trusting it — a
caller that could pass an empty or a foreign category would be able to write a
delivery object under a prefix the sweeps and the lifecycle rules reason about.

`pending/` and the three other prefixes above are **reserved namespaces** —
`RESERVED_MEDIA_NAMESPACES`, and `storageKey()` throws rather than building a key
on one. They are four: `pending/`, `content/`, `knowledge/` and the key space
`media-check` writes its throwaway object into. `pending/` is the one
that matters: the sweep for abandoned uploads removes whatever a ticket names, and
it can never reach a delivered item because a delivered key can never start with
that prefix. Making it `core/pending/…` would have read more tidily and turned a
one-line guarantee into a property to re-prove for every namespace anybody adds.

⚠️ **An app that stored media before this existed has a bucket with both shapes
in it, and that is safe rather than merely tolerated.** No object was copied and
no migration ran: every existing row keeps the key it already has, and every read
starts **from the row**, which carries its own key. Nothing anywhere derives a
key from a row, and `MediaStore` has no `list()` at all — no code in this app
ever issues a `ListObjectsV2`, so there is no place where a scan could meet a key
it did not expect. What a mixed bucket costs is cosmetic: a lifecycle rule on
`community/` covers everything stored since the change and nothing before it.

One consequence worth knowing if you use the in-app assistant: a deep link to an
operator-uploaded medium is derived from its key, so links the assistant already
wrote into stored answers before the change stop scrolling to the right place.
Both ends recompute the anchor from the same row, so they never disagree going
forward, and product media (`content/…`) are unaffected because that prefix did
not move.

---

## How a file reaches a visitor

**Never through your app.** That is the rule the whole design hangs on. On a
busy app it is the difference between a server rendering pages and a server
shipping megabytes — and with video it stops being a preference at all, because
a player scrubbing through a recording issues **range requests**, which a bucket
answers by itself and your app would have to reimplement as `206 Partial
Content`, on every node, for every viewer.

| Visibility | What it is | How it is served |
|---|---|---|
| `public` | product imagery — a lesson cover, the hero of a generated page | straight from the bucket or its CDN. No request reaches your app |
| `owner` | what a customer uploaded | the page checks who is asking, then the bucket serves it |
| `entitled` | **the file somebody bought** | `hasPlan()` decides, then the bucket serves it |
| `members` | a face members show each other — a community profile picture | any signed-in session, and nothing more; then the bucket serves it |

`members` is the newest and the narrowest: the whole condition is "is somebody
signed in". It exists because none of the other three can express that — `public`
would serve a member's face to the open web, `owner` would show it to nobody but
themselves, and `entitled` would put a face behind a purchase. The argument is
made in full above `MEDIA_VISIBILITIES` in `lib/media/rules.ts`, where the three
failures are also executable tests. Avatars are the only thing on this level
today; it is available to a later feature that genuinely needs it, on the same
bar.

For the last three, the **server component decides access while it renders** and
mints an address that expires. That is not an optimisation, it is the only shape
that works: `next/image` will not follow a redirect to another host, so a route
answering `307` with a signed address serves downloads and breaks every
`<Image>`. Moving the check to render time is what lets the bucket serve the
bytes.

**One deliberate exception: subtitle text (`text/vtt`) is served by the app
itself, on every driver.** A `<track>` fetch is CORS-restricted where the
video's own `src` is not, and it cannot follow a redirect to a foreign host —
a subtitle pointed at a bucket address fails *silently*: the video plays, the
CC menu stays empty, nothing logs. `servedThroughApp()` in `lib/media/rules.ts`
is where that decision lives and carries the reasoning; `mediaUrlFor()` answers
the app's own route for those rows and `lib/media/deliver.ts` streams them. None
of the reasons above apply to a few kilobytes fetched once per view. Production
and wiring:
[`docs/content-production.md`](content-production.md) → *Subtitles*.

```tsx
import { findMedia, mayAccess } from "@/lib/media/manage";
import { mediaUrlFor } from "@/lib/media/url";
import { Figure } from "@/components/ui/figure";

const item = await findMedia(id);
if (!item || !(await mayAccess(item, { memberId, role }))) notFound();

// `media.alt` is nullable — an item seeded through `createMedia()` may carry
// none — so decide what a missing one MEANS rather than passing `""`, which is
// the one value `Figure` refuses. Here it is a decoration.
{item.alt
  ? <Figure src={mediaUrlFor(item)} alt={item.alt} width={800} height={450} />
  : <Figure src={mediaUrlFor(item)} decorative width={800} height={450} />}
```

`mediaUrlFor()` **grants nothing and checks nothing** — it is the step after
`mayAccess()` said yes. Calling it without that check is how a private file
becomes a public one.

**What measures that in a RUNNING app is `node run.mjs smoke`.** It plants one
private item through `POST /api/media` and then asks `/api/media/[id]` twice —
once with the session that owns it, once with no session at all. The finding is
the difference: a route that answers both the same is the defect this whole page
is about, and a 200 for the owner on its own proves nothing. Measured against
the deployed app it is the only check here that runs through the real route, the
real session and the real store: deleting the `mayAccess()` gate from
`lib/media/deliver.ts` leaves `npm run typecheck` clean and every one of this
app's tests green, and turns `smoke` red. ⚠️ The plant happens on a **local** app
only — `smoke` does not write to a deployed one, and says so on the line.

### A phone does not get the desktop-sized picture

An uploaded photo is routinely 3000 px wide and a phone shows it at 390. Nothing
here used to catch that, and it was stated plainly rather than hidden: bucket
media reaches the browser **unoptimised**, because `next.config.ts` declares no
`images.remotePatterns` — that file is evaluated at *build* time while
`MEDIA_S3_*` are set at *run* time (the pattern would bake as an empty list and
every bucket image would answer 400 in production), and a pattern for a shared
bucket host with no `pathname` turns `/_next/image` into an open resizing proxy
for every bucket in that region, on your CPU and your egress.

**So the narrower copies are derived when the bytes are already in the process,
and the browser chooses.** Three things to know:

- **At upload, once.** `acceptUpload()` strips the location data, `createMedia()`
  measures the picture and writes copies at the widths in `MEDIA_VARIANT_WIDTHS`
  (480, 960, 1440) that are *narrower* than the original — `lib/media/variants.ts`,
  using `sharp`, which `package.json` now declares explicitly. Sibling keys:
  `…/<id>-w960.jpg` beside `…/<id>.jpg`, so one lifecycle rule reaches all of
  them. **An upload is never lost to a resize failure** — the original is the
  product, a variant is an optimisation, and the row records the widths that
  really landed.
- **The widths live on the ROW** (`media.variants`), because `MediaStore` has no
  `list()` and "which copies exist" has no other answer. `NULL` means nobody
  asked — every picture stored before this, and every video and PDF; `{}` means
  asked and none. Nothing is backfilled and nothing needs to be: an old picture
  serves its original exactly as it did before. And because the row is the only
  record that the copies exist, **`deleteMedia()` removes them WITH the
  original** — a sweep of the bucket could not find them.
- **`mediaImageFor()` mints the candidate list**, beside the `src`, in the same
  function that asked `mayAccess()`. A variant is the same row's bytes at another
  width, so it **inherits** that decision and is never authorised separately;
  a `public` row's copies are public, everything else's are signed for the
  kind's own window.

```tsx
import { findMedia, mayAccess } from "@/lib/media/manage";
import { mediaImageFor } from "@/lib/media/url";

const item = await findMedia(id);
if (!item || !(await mayAccess(item, { memberId, role }))) notFound();

const picture = mediaImageFor(item);
<Figure
  src={picture.src}
  srcSet={picture.srcSet}          // null → exactly what it rendered before
  width={picture.width ?? 1280}    // null on a row from before the measurement
  height={picture.height ?? 720}
  alt={item.alt ?? ""}
  sizes="(min-width: 768px) 40rem, 100vw"
/>
```

⚠️ **Pass `sizes` when the picture is not the width of the page.** Without one a
browser assumes `100vw` and picks a candidate a step or two too wide — the
default is right for a figure in the page's own column and wrong in a sidebar.

**Why the `srcset` is a bare `<img>` and not `next/image`.** `next/image` builds
its own candidate list from a `loader`, and a loader is a *function* — it cannot
cross from a server component into a client one, and these addresses are signed
on the server because every address in this system is. Nothing is given up:
bucket media is already `unoptimized`, so for exactly this case `next/image` is a
wrapper around nothing and would emit one `<img>` with no `srcset` at all.
`Figure` takes that branch itself when the address is remote and a `srcSet` is
given, with the reason written above its eslint disable; the app's own origin
keeps `next/image` untouched, because there the optimiser really does something.

⚠️ **A `srcset` does not fix the expiry.** The candidates are signed addresses
with the same lifetime as the `src` (below), so a page left open past it holds
stale candidates exactly as it holds a stale `src` today. This changes nothing
about that.

### Selling a file

Set the visibility and name the plan. That is the whole feature:

```ts
await createMedia({
  ownerId: operatorId,
  namespace: "core",                 // whose object it is — see below
  category: "upload",                // what it is for
  kind: "file",
  mime: "application/pdf",
  bytes,
  filename: "Workbook.pdf",
  visibility: "entitled",
  requiresPlan: "basis_monatlich",   // a key from config/digistore-products.json
  alt: null,
  source: "upload",
});
```

The Product Key is checked by `createMedia()` itself, so this call refuses a
typo rather than storing it. That matters because `hasPlan()` **throws** on a
key it does not know: an unchecked one would not mean "no access", it would take
down the page that renders the item. A token package is refused for a different
reason — a balance is not an entitlement, so `hasPlan()` answers false for one
for ever and nobody would ever get the file.

A key that is retired from `config/digistore-products.json` *later* cannot be
caught at write time, so `mayAccess()` treats it as "nobody holds this plan" and
logs it. Access is refused; the page still renders.

### How long an address stays valid

Per kind, in `config/media.json`. Five minutes for a picture, six hours for
video and audio — because a player asks for more of a recording as somebody
watches it, and an address that expired mid-view looks like a broken video.

**The cost is real and worth knowing:** an address that lives six hours can be
passed to somebody else for six hours. For paid content that is a trade you are
making. If your files must not be shared at all, shorten it and accept that long
recordings will need reloading; there is no setting that gives you both.

---

## Putting files in

An upload travels **through your app** by default, because that is where it is
checked:

> signed in → feature on → under the rate limit → size plausible →
> **the type is read from the bytes, not from what the request claimed** →
> location data stripped (images) → stored

🚨 **Every upload door calls ITS guard before it writes anything, and there are
two halves.** The usual pair is `guardUploadEntry()` and then `acceptUpload()`:
the **outer** half asks whether media is switched on, whether the store is
usable, and whether this member has had their hourly share; the **inner** half
asks what the bytes are, whether this role may put that in, and strips the
metadata. A door that calls only the second is an upload path with **no rate
limit and a kill switch that does nothing** — which is a bug this template has
already shipped once, so it is written down rather than assumed.

🚨 **There is exactly ONE exception and it is not a loophole:
`guardUploadConfirm()`**, for the second half of a direct-to-bucket upload
(`confirmUpload()`, below). It asks the same two questions and deliberately does
**not count**, because the hourly slot was already spent when the address was
minted — charging it again would halve an operator's configured allowance with
nothing saying so. Which doors may use it is a list in `lib/media/manage.test.ts`,
and a caller outside that list fails the build. "Repairing" a confirm door onto
`guardUploadEntry()` is therefore a regression, not a fix.

Two of those are worth saying out loud.

**The type comes from the first bytes.** A `Content-Type` in an upload is
written by whoever sent it. Believing it means an app that accepts `image/png`
accepts anything at all, as long as the sender says `image/png`. The same
stance holds on the way out: `next.config.ts` sets
`X-Content-Type-Options: nosniff`, so a wrong answer about what a file is does
not get rescued by the browser guessing — the app's own sniffing is the one
answer that counts.

**Who may upload what depends on the role.** `config/media.json` → `mayUpload`.
A member uploads pictures and PDFs; archives are the operator's. A customer who
can hand every other customer a `.zip` is not a media feature.

There is no SVG anywhere on the list, and there should not be: an SVG is a
document that can carry script, so serving one a customer uploaded is handing
every later visitor code somebody else wrote. **`lib/media/sniff.ts` refuses it
actively rather than by omission — at every door, for every kind, for every
role**, so an allowlist somebody widens by hand still cannot let one through.

#### 🚨 There is exactly ONE SVG in this app, and it is not on this path

The operator's own **logo**, under `public/brand/` (see
[`design-system.md`](design-system.md) → *The mark*). It is a build-time file in
their own repository: it never travels through `lib/media/`, it is never a `media`
row, and **no member can put one there.**

Two independent things keep it inert, because each covers what the other cannot:

- it is rendered **only** through `<img src>` — a browser runs an SVG there in
  secure static mode: no script, no external fetches;
- `next.config.ts` serves `/brand/:path*` with `default-src 'none'; sandbox`,
  which is the half `<img>` cannot reach — somebody **navigating** to
  `/brand/logo.svg` gets a document, not an image tag.

`components/brand-mark.test.ts` fails the build on either half slipping, on a
second renderer appearing, on `dangerouslyAllowSVG`, and on `image/svg+xml`
reappearing in an upload allowlist.

**The boundary IS the exception: a customer's SVG is still refused, always.**

### The ceiling, and the second way in

Because uploads pass through the app, there is a size limit — and **it is not
the number in `config/media.json`**, which is what may be *stored*. There are
two limits on what may *arrive*, and which one applies is decided by the kind of
door, not by the kind of file:

| The door | Ceiling | Why |
|---|---|---|
| a **Server Action** (a form on one of your pages) | **10 MB** — `slotCeilingBytes()` | `next.config.ts` → `bodySizeLimit`. Next refuses while it decodes the payload, before your action runs, so there is nothing to catch and no number to show |
| a **route handler** (`POST /api/media`, `/api/v1/media`) | **50 MB** — `routeCeilingBytes()` | no framework limit applies; this is what the app is willing to buffer in the process on one request |

Both take the LOWER of their own number and the kind's, so raising a per-kind
ceiling never raises either. Enough for a picture, a PDF, a short clip.
**Not** enough for a lesson recording. ⚠️ And do not mix the two up in the other
direction: using the **Server Action** ceiling at `/api/media` is a capability
quietly taken away — the door can buffer 50 MB and would start refusing at 10.

The way past it is the browser writing **straight to the bucket**: your app
mints a short-lived upload address, the file never touches your server, and a
confirm step afterwards checks what actually landed rather than believing the
client. **That path is built.** Three requests:

```
POST /api/media/upload-url   { mime, filename, bytes }  →  { ticketId, url, expiresAt }
PUT  <url>                   the file, straight to the bucket
POST /api/media/confirm      { ticketId }               →  { id, kind, mime, bytes }
```

Nothing in between is yours to hold: the storage key is derived from an id the
app minted and never appears in either answer, and the confirm step takes the
**ticket** id.

ℹ️ **There is another mint/confirm pair with the same shape and a different
caller, and mixing the two up is the mistake to avoid.** The one above is for a
MEMBER's browser uploading a file into the
app they are using. `content_media_url` / `content_media_confirm`
([`setup-mcp.md`](setup-mcp.md)) are for the OPERATOR's machine placing declared
**product** media — a lesson recording out of `content/media-manifest.json` — at
its deterministic `content/<path>` key in an environment they are not sitting in;
that is `node run.mjs content-publish` ([`content.md`](content.md)). Different
caller, different key space (`content` is a namespace `storageKey()` refuses),
and deliberately **no `pending/` copy** there, because the caller already holds
that environment's `SETUP_KEY` and is writing a key they declared themselves — a
staging copy would double the transfer of a nine-hundred-megabyte video in order
to defend against its own operator.

🚨 **The address you get writes to a staging key, and the confirm step copies.**
That matters because a presigned address is bounded by time and not by uses: it
stays writable for the whole hour, and whoever holds it may write it again. If
it pointed at the key the item is served from, every check below would be true
of one moment and of nothing after it — confirm a small MP4, then push a
gigabyte, or a JPEG full of location data, onto the same address, and the row
would still describe the first upload. So the browser writes to `pending/…`,
`confirm` measures and sniffs THAT object, and then copies it server-side onto
the delivery key (a `PUT` with `x-amz-copy-source`; no byte travels through your
app). Afterwards the address you hold reaches a key nothing reads, and the sweep
removes what is written there. A ticket is also spent exactly once: a second
`confirm` on the same id is `uploadTicketInvalid`.

**The ticket also RECORDS its slot**, so a confirm door naming a different one is
`uploadTicketInvalid` as well — a member cannot mint at the generic HTTP door and
then confirm at a module's, where the visibility rules are somebody else's.

**What it takes on the bucket** — without this the browser refuses the `PUT`
before it is sent, and the error it shows says nothing useful:

```json
[
  {
    "AllowedOrigins": ["https://your-app.example.com"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["content-type"],
    "ExposeHeaders": [],
    "MaxAgeSeconds": 3600
  }
]
```

No wildcard origin. `node run.mjs media-check` asks the bucket whether it
answers your app's address and says so — as a warning, because the rule belongs
to the bucket and not to this repo.

**Three things about it that are true and easy to assume otherwise:**

- 🚨 **A presigned `PUT` cannot enforce a size.** Only `host` is signed, and a
  `content-length-range` condition exists for POST policies rather than for
  this. So the bucket takes what it is given, and the app refuses *afterwards*
  at the length `HEAD` reports — and removes the object. The short ticket life
  (an hour) and the staging key above are the other halves of that answer:
  oversized bytes can reach the staging key until the ticket expires, and they
  are never copied and never served.
- **Pictures still go through the app, and that is a promise rather than a
  gap.** Location and camera data come off uploaded images, which needs the
  bytes in the process; an object the browser wrote was never there. So an image
  is refused — `kindNotDirect` when the ticket claimed one honestly,
  `typeMismatch` as soon as the bytes and the claim disagree, which is what
  claiming `video/mp4` and sending a JPEG produces. Either way the object is
  removed and no row is written; the check sits on the object's own first bytes,
  never on the form.
- **A row from this path has `sha256: null`**, because the app never held the
  bytes to hash. That column is not a security control (`db/schema-media.ts`
  says so); null means "no answer", never "no match".

An upload that is minted and never finished leaves an object and a ticket row —
the `prune-abandoned-uploads` job removes both, daily. It never lists the
bucket: it removes what the app wrote down as expected, and nothing else. It can
never take a delivered item's bytes with it either, and that is structural
rather than careful: every object it removes is on the `pending/` prefix, and no
delivered item's key can be.

The four kinds already exist, so this is a second way into the same store — it
changes neither the row, nor the delivery, nor the access check.

---

## Letting the app draw

```ts
import { generateImage } from "@/lib/media/generate";

const [hero] = await generateImage({
  prompt: "a quiet kitchen table at sunrise, warm light, no people",
  alt: "A kitchen table in early morning light",
  visibility: "public",
});
```

What comes back is a stored `media` row — the picture is already in the bucket,
and `mediaUrlFor(hero)` is the address to put on a page. The cost is recorded
with every other model call and appears on `/dashboard/admin/ai-costs`.

Three things worth knowing before you use it:

- **Not every provider can.** Anthropic makes no pictures at all; Mistral only
  through a detour this template does not take. `node run.mjs ai-check` says
  which of your keys would work, at the moment you check rather than at your
  customer's first click.
- **`alt` is required and is not the prompt.** A prompt reads *"photorealistic,
  8k, cinematic lighting"* and is instructions for a machine; alternative text
  is a sentence for a person who cannot see the picture. Using one as the other
  produces accessibility that is technically present and useless.
- **Charge for it in your Server Action, not in the library** — `spendTokens`,
  in the order check → work → charge. `generateImage()` deliberately does not,
  because a debit inside a library is a debit a cron job can trigger.

The full reference, including what a picture costs and how to bind the task to a
different company, is [`docs/ai-providers.md`](ai-providers.md) → *Pictures*.

---

## What to build instead of a wall of text

This is the part worth reading before you design a page. Every row is the same
feature delivered one step further along — not a bigger feature, a finished one.

| Instead of | Build |
|---|---|
| sales copy in a text box | a **rendered sales page** under its own address, with a hero image, that the customer can share or hand to a client |
| a challenge message as a paragraph | the message **with a picture**, and the run of days as a bar so somebody can see where they are |
| "your result: 73 / 100" | a **result card** they can download and show somebody — the number, what it means, your name on it |
| a report as a table | the same report **with a chart above it**. The table stays; it is the answer to "what exactly" |
| a lesson as text | the lesson **with a cover picture**, and a video where there is one |
| a list of suggestions | the same suggestions as **cards with previews**, so choosing is looking rather than reading |
| a bare "done ✓" | what was produced, **shown** — the thing itself, small, with a way to open it |

**The pattern under all of them:** find the last step your customer currently
has to do themselves, and do it for them. That step is usually where they would
have been willing to pay.

**What NOT to do:** decoration. A stock photograph at the top of a settings page
is not this. Every row above shows the customer *their own thing* — their page,
their result, their progress. A picture that would be identical for every
customer is a picture nobody needed.

**A diagram of the app itself is decoration too, and it is the commonest way
this rule gets broken.** A flow diagram of "how the tool works", a process
chart beside a form, boxes and arrows explaining a sequence the page itself
already walks the customer through — each is identical for every customer, so
each is the stock photograph in different clothes. The charts in the catalogue
earn their place because the customer's own numbers are in them; that is the
test, not "is it graphical". At most one diagram survives it: one a customer
genuinely has to understand before they act, and a second one in the same app
means the first was not it.

**And there is a second question next door.** This section is about what the
customer is *handed*; [`ai-in-product.md`](ai-in-product.md) is about what the
app *does with them* while they work — reading what they submitted, walking them
through it, producing the thing together. An app usually wants both.

---

## Asking a customer to produce or choose something

Half of a good visual feature is what the app does when it hands the work back
to the person. Five rules, and the first is the one that gets skipped.

**Offer, do not demand.** Three variants to pick from beats one take-it-or-
leave-it, and beats an empty field by a mile. Somebody looking at three
pictures decides in two seconds; somebody looking at an empty prompt box
closes the tab.

```tsx
// Three at once, then let them choose. Costs three times as much per attempt
// and saves the four attempts a bad first result would have caused.
const options = await generateImage({ prompt, alt, n: 3, ownerId: memberId });
```

**Say what it costs before it is spent.** Not in the ledger afterwards. "Das
kostet 5 Token" next to the button, every time — a customer who discovers a
price after the fact stops trusting every other button on the page.

**Let them correct it with a sentence.** "Make it warmer", "no people in it" —
appended to the original prompt, not typed again from scratch. Starting over is
how a customer decides the feature is not worth it.

**Always leave a way past.** Upload your own, or continue without one. A
required visual step is a wall in the middle of a flow somebody paid to get
through.

**Do not produce what nobody will see.** A generated picture with no place on
the page is paid-for compute. Build the place first.

---

## Recipes

The things below are **not** components in this template, deliberately: each is
thirty to sixty lines against what already ships, and a feature most apps carry
and few use is worse than no feature at all. Copy what you need into your app.

They are written against the colour tokens in `app/globals.css`, which is what
makes them correct in light and dark **without a single `dark:` class** — the
token changes value, the markup does not. None of them adds a dependency.

### A bar chart, server-rendered

```tsx
export function Bars({ data, max, label }: {
  data: { name: string; value: number }[];
  max: number;
  label: string;
}) {
  // A day with nothing on it is a real input, and `value / 0` is `NaN%` —
  // which CSS drops, so every bar renders full width.
  const top = Math.max(max, 1);

  return (
    // `role="img"` plus a name: a screen reader announces the sentence instead
    // of reading seven numbers nobody can hold in their head.
    <div role="img" aria-label={label} className="space-y-2">
      {data.map((row) => (
        <div key={row.name} className="flex items-center gap-3">
          <span className="w-24 shrink-0 text-sm text-muted-foreground">{row.name}</span>
          <div className="h-3 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${Math.round((row.value / top) * 100)}%` }}
            />
          </div>
          <span className="w-12 shrink-0 text-right text-sm tabular-nums">{row.value}</span>
        </div>
      ))}
    </div>
  );
}
```

No SVG needed for the commonest chart there is, and no client JavaScript: it is
`div`s with a width. `tabular-nums` keeps the figures from jittering.

### A line, as SVG

```tsx
import { useId } from "react";

export function Line({ points, label }: { points: number[]; label: string }) {
  // Ids have to be unique on the page, and two charts on one page is the
  // ordinary case. A fixed `id="t"` makes the second chart's label point at the
  // first one's — silently, because nothing validates an aria reference.
  const id = useId();
  const max = Math.max(...points, 1);
  // One point is a line of zero length, not a division by zero.
  const span = Math.max(points.length - 1, 1);
  const d = points
    .map((v, i) => `${(i / span) * 100},${30 - (v / max) * 28}`)
    .join(" ");

  return (
    <svg
      viewBox="0 0 100 30"
      className="h-24 w-full"
      role="img"
      aria-labelledby={`${id}-t ${id}-d`}
    >
      {/* `title` and `desc` are what a screen reader reads. An SVG without them
          is announced as "graphic" and nothing else. */}
      <title id={`${id}-t`}>{label}</title>
      <desc id={`${id}-d`}>{`${points.length} values, highest ${max}`}</desc>
      <polyline
        points={d}
        fill="none"
        // `currentColor` inherits from the class — so the token decides, and
        // light/dark follows without a second code path.
        stroke="currentColor"
        strokeWidth="1.5"
        className="text-primary"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
```

`vectorEffect="non-scaling-stroke"` is the line that gets left out: without it
the stroke is scaled by the viewBox and a wide chart draws a hairline.

### A gallery

```tsx
{items.map((item) =>
  // `alt` or `decorative` — never `alt=""` on a picture that shows something.
  // An empty alt tells a screen reader to skip it, which is right for a
  // divider and wrong for a photograph somebody uploaded. There is no third
  // answer, which is why `Figure` refuses to compile without one of the two.
  item.alt ? (
    <Figure
      key={item.id}
      src={mediaUrlFor(item)}
      alt={item.alt}
      width={400}
      height={300}
      className="aspect-[4/3] object-cover"
    />
  ) : (
    <Figure
      key={item.id}
      decorative
      src={mediaUrlFor(item)}
      width={400}
      height={300}
      className="aspect-[4/3] object-cover"
    />
  ),
)}
```

In a `grid gap-4 sm:grid-cols-2 lg:grid-cols-3`. The fixed aspect ratio is what
stops one portrait picture from making a row twice as tall as its neighbours.

### A video from YouTube or Vimeo — **with the consent gate**

⚠️ **This is the one recipe with a legal consequence attached.** A bare
`<iframe src="https://www.youtube.com/…">` contacts Google the moment the page
loads, before the visitor has agreed to anything, and sets identifiers on their
device. That is § 25 TDDDG — consent required, no exception for "it is just an
embed" — and it is exactly the kind of thing a supervisory authority checks
because it takes ten seconds to verify from the outside.

**Nothing may reach the video host before the visitor says yes.** So the page
shows a still and a button, and the iframe comes into existence only afterwards:

```tsx
"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Figure } from "@/components/ui/figure";

export function VideoEmbed({ id, title, poster }: {
  id: string; title: string; poster: string;
}) {
  const t = useTranslations("video");
  const [agreed, setAgreed] = useState(false);

  if (!agreed) {
    return (
      <div className="relative overflow-hidden rounded-md bg-muted">
        {/* Your OWN still, from your own bucket. A thumbnail fetched from
            youtube.com is the same contact this whole component prevents —
            and `Figure` rather than `<img>` because that is the rule
            everywhere else in this app. */}
        <Figure src={poster} alt={title} width={1280} height={720}
                className="w-full opacity-60" />
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center">
          <p className="text-sm">{t("consentBody")}</p>
          <Button onClick={() => setAgreed(true)}>{t("consentAction")}</Button>
        </div>
      </div>
    );
  }

  // `youtube-nocookie.com` is not a substitute for the gate — it reduces what
  // is set, it does not remove the contact. It belongs here, after the yes.
  return (
    <iframe
      src={`https://www.youtube-nocookie.com/embed/${id}`}
      title={title}
      allowFullScreen
      className="aspect-video w-full rounded-md"
    />
  );
}
```

**Recording the yes: read this before reaching for `recordConsent()`.**

On a **public page the click IS the consent, and there is nothing in this app to
record it in.** `recordConsent()` opens with `requireActiveUser()`, which sends
an anonymous visitor to `/login` — so calling it here does not fail quietly, it
ejects the person who was about to watch your video. `components/consent-dialog.tsx`
says why: anonymous device-access consent under § 25 TDDDG is a different
mechanism with a different store, and it cannot be a row against a member who
does not exist yet. What you have instead is the gate above: nothing is
contacted until somebody acts, which is what the rule asks for.

Behind the **sign-in**, where there is a member, you can record it — and then it
is worth doing, because a record is what demonstrates consent was given
(Art. 7(1) GDPR):

```json
{ "purposes": [{ "key": "videoEmbed", "textVersion": "2026-07-30" }] }
```

Then the four steps `compliance-check` prescribes: the purpose above, the
wording as `consent.videoEmbed.title` / `.body` in **both** message files, ask
with `<ConsentDialog>`, and gate the iframe on
`hasConsent(memberId, "videoEmbed")` rather than on `useState`. Bump
`textVersion` whenever you change the sentence — everybody who agreed to the old
one counts as unasked again.

**The way out of all of this:** host the video yourself. A `video` item in your
own bucket contacts nobody, needs no consent, no gate and no purpose — and
`<MediaPlayer>` plays it. The embed exists for videos you do not have the file
for.

---

## What is taken off an image, and what is not

Location and camera data are removed from uploaded **JPEG, PNG and WebP** before
anything is stored. A phone photograph carries where it was taken, to a few
metres, and nobody looking at the picture can tell it is there.

**Video is not touched.** An MP4 can carry its recording location in an atom,
and removing it means walking the atom tree and rewriting the offsets that
depend on it — half of which is worse than none, because a half-stripped file
reads as protected. This is in `docs/data-protection.md` as well, so a privacy
policy written from that inventory is true.

Colour profiles are deliberately kept. Removing one changes how a picture looks;
it says nothing about where somebody was standing.

**The narrower copies carry none of it either**, and that is held twice rather
than hoped: they are derived from the bytes *after* the strip, and the resizer is
never asked to write metadata of its own. `lib/media/variants.test.ts` hands it a
picture that still has EXIF and asserts the copy has none — because a variant
carrying the location the original just lost would make this whole section false
for every picture uploaded from now on.

---

## The construction kit

| For | Use |
|---|---|
| an image | `<Figure>` — `alt` is required **by the type**, so a missing one is a compile error rather than a finding somebody has to go looking for. Hand it `srcSet` from `mediaImageFor()` and a phone fetches the narrow copy instead of the original |
| a decorative image | `<Figure decorative>` — no `alt`, hidden from screen readers |
| video or audio | `<MediaPlayer kind="video" label="…">` — a course video's subtitles ride along as `tracks={[{ src, srclang, label }]}`, present but off until the viewer switches them on |
| a file to download | `<MediaDownload>` — name, type and size, because a 40 MB file on a phone is a decision and not a click |
| a file going IN | `<MediaUpload>` (`components/ui/media-upload.tsx`) — the app's one file field. It carries the picker's `accept` (media types plus optional extensions), the reset that stops a second save re-uploading the same bytes, and the size refusal *before* anything is sent. Give it `direct={{ mint, confirm, handleName, … }}` and it runs the three requests above instead, with a progress bar — and the form then carries an **id** rather than the file |

`<MediaUpload>` names no route and no Server Action, deliberately: `mint` and
`confirm` are callbacks, so the surface that owns them decides who may see the
row. That is what keeps *"a form may never choose `public` or `entitled`"* true
on the direct path as well — a lesson recording reaches `entitled` through a
Server Action with `requireOwner()` in front of it
(`modules/courses/admin/media-actions.ts` is the worked example), never through
the HTTP door, which pins `owner`. Put positively: **what a member may make their
own is `owner` or `members`**, and those two are the whole set.

It is also **text-free**, like everything else in `components/ui/`: every visible
sentence and every formatted number arrives as a prop, and `formatBytes()` is
the caller's call. There is exactly one raw `type="file"` in the whole tree, and
`components/ui/media-upload.test.ts` fails the build on a second one — with the
file and the line.

`decorative` is the right answer for a divider or a texture and the wrong answer
for anything a reader would miss. Nobody but the person writing the page can
tell those apart, which is why the component asks.

**And however large the source file is, an image never gets a scrollbar.** It
scales to the width of its container — `className="w-full h-auto"` (or
`max-w-full`) — and a frame that crops uses `overflow-hidden`, the way the
video recipe above does. An image inside an `overflow-auto` container hands the
customer a scrollbar instead of a picture, on exactly the screens with no room
to scroll sideways. Sideways scrolling is for tables
([`docs/ux.md`](ux.md) → *Small screens*); a picture that is too big is scaled,
never panned.

---

## Where things are

| | |
|---|---|
| `lib/media/store.ts` | the one entry point; picks the driver |
| `lib/media/s3.ts`, `local.ts` | the drivers — the only files that read a storage credential |
| `lib/media/sigv4.mjs` | request signing, measured against AWS's own published test vectors (`sigv4-vectors.json`) |
| `lib/media/manage.ts` | rows and bytes, kept in step |
| `lib/media/rules.ts` | the pure rules — what is allowed, how big, what key |
| `lib/media/sniff.ts` | what a file really is |
| `lib/media/exif.ts` | taking the metadata off |
| `config/media.json` | kinds, ceilings, who may upload what, address lifetimes |
| `db/schema-media.ts` | one row per item |

Deleting an account removes the objects from the bucket, not only the rows — a
Postgres cascade does not reach into storage, and files left behind would be a
deletion request that was not honoured. It removes the `media` objects **and the
member's open upload tickets**: `media_uploads` cascades in the database, and a
cascade reaches rows and never bytes.

**What goes with a person is `OWNED_MEDIA_VISIBILITIES`** — `owner` plus
`members`, the two a member may make their own. That constant is what
`listOwnedMedia()` reads, and it is the same set both Art. 15 exports and
`/api/v1/media` answer from, so nothing can drift between "what you can download"
and "what disappears". Product imagery (`public`, `entitled`) **stays**: the line
is whose DATA it is, not who uploaded it.
