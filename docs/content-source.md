<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# Content sources — the app's content, as something the assistant can look up

An app built on this template usually IS its content: a course's lessons, a
handbook's articles, the pages a member paid for. The in-app assistant wants
to read that content on a member's behalf when she answers a question, and
she should find it one way: **search it, fetch it, and point the member at
the page**, with an anchor so the browser scrolls to the passage or the video.

That is what this layer does. One interface, and the only part that varies
per app is where the content lives.

---

## The short version

| | |
|---|---|
| The interface | `ContentSource` in `lib/content-source/types.ts` — search, get, list, findMedia |
| The registry | `lib/content-source/sources.ts` — the app's own sources, **plus** every installed module's, folded in through `lib/modules/content-source-registry.ts` |
| Ships registered | `handbook` — the assistant's handbook, working out of the box |
| A module's own | `"contentSource": "content-source.ts"` in its manifest, then `node run.mjs module sync`. `modules/courses/content-source.ts` is the worked example — see *A module brings its own* |
| Who consumes it | the four `content_*` tools (`lib/ai/tools.ts`) the in-app chat calls, through one enforcement path (`lib/ai/run-tool.ts`) |
| Search | keyword matching, ranked by the pure functions in `lib/content-source/rules.ts` |
| Deep links | `url` + `anchor` per hit; anchors from `lib/content-source/anchors.ts`; a hit that has a page becomes a clickable link in her answer |

**A second source is a second registry entry** — never a second tool set,
never a second search implementation. The same rule `modules/companion/companions.ts`
follows, for the same reason. A module's entry is declared rather than typed
into the array, because the core must not name a module
([`modules.md`](modules.md)) — the list it lands in is the same list.

---

## The four standard tools

`content_search`, `content_get`, `content_list`, `content_media` sit in
`lib/ai/tools.ts`, and they are not meant to be replaced. They answer from
whatever the registry holds:

- **`content_search { query, limit? }`** — ranked hits with title, snippet,
  `url`, `anchor`.
- **`content_get { source, ref }`** — one page or section in full, with its
  section anchors and embedded media.
- **`content_list { source? }`** — the tables of contents, before searching.
- **`content_media { query?, limit? }`** — pictures, videos, audio, files —
  each hit naming the PAGE that shows the medium, never a file link.

All four are `readOnly` and free. The assistant executes them in-process,
mid-answer — no endpoint is involved, and the chat's own switch
(`config/ai-chat.json`) is the only one that gates them.

## What the assistant does with them

The chat executes the same four tools mid-answer (`lib/ai/tool-loop.ts`,
wired in `lib/ai/chat-endpoint.ts`): she searches on demand instead of
carrying every page in her prompt. The handbook itself still travels as the
cached prompt prefix — cheap and always present — so for a handbook-only app
the tools add little; they exist for the day the app registers its REAL
content, which is too big for a prompt. Up to `MAX_TOOL_ROUNDS` provider
round-trips per question, one `ai_usage` row each; the mechanics are in
[`ai-providers.md`](ai-providers.md) → *Tools*.

---

## Writing a source

```ts
export interface ContentSource {
  id: string;      // [a-z0-9-]{1,40}, unique
  label: string;   // model-facing one-liner
  search(query, viewer, limit): Promise<ContentHit[]>;
  get(ref, viewer): Promise<ContentDocument | null>;
  list?(viewer): Promise<ContentTocEntry[]>;
  findMedia?(query, viewer, limit): Promise<ContentHit[]>;
}
```

Build `SearchableRecord`s from your content and let `rankRecords` +
`snippetFor` (`lib/content-source/rules.ts`) do the ranking — the shared
arithmetic is what makes hits from a file-backed and a database-backed source
comparable in one merged list. For database content, narrow the candidates
with `ILIKE` (escape terms with `escapeLikeFragment` from
`lib/digistore/purchase-filter.ts`), cap them, and rank in memory. When that
stops scaling, a `tsvector` column is a **source-internal** upgrade — the
interface does not move.

**Ask the free questions first — the order of the filters is a cost, not a
style.** A method usually has two kinds of filter in it: one that reads rows it
already holds (a text match, a release date) and one that asks another layer
(`mayAccess()`, which reaches `hasPlan()` and is a query per row, awaited in
sequence). Put the free ones above the expensive one, always. Measured in
`modules/courses/content-source.ts` before this was true of it: a twelve-week
course — 12 blocks × 5 lessons × 3 media — asked the entitlement layer **180
times for one question** where three rows answered it, because the per-row
check sat above the text filter. Nothing about the answer changes when you
reorder them, which is exactly why nobody notices: the bug is invisible to
every assertion about what comes out. The way to keep it fixed is to count the
calls in a test (`expect(mayAccess).toHaveBeenCalledTimes(…)`), not to time
anything. And the reverse of the rule holds too: only load what the method
reads — a `select()` that brings every lesson's `body` into a method that only
needs four id columns is the same waste one layer down.

**The worked example is real code, not a comment: `modules/courses/content-source.ts`**
(`node run.mjs module add courses`, or read it in the repo — it is in the tree
whether or not the module is installed). It is written against the course
tables and it carries every part that is easy to get wrong: the shared preamble
that answers empty before it reads anything, the ONE gate call, the drip filter,
the media rule, and the anchors the lesson page renders. Read it before writing
one of your own; the registry header used to carry a sketch of it, and a sketch
beside the real thing is the copy nobody maintains.

### A module brings its own

A module owns its rows, so it owns the question of what may be searched in them
and by whom. It declares one key:

```jsonc
// modules/<id>/module.json
"contentSource": "content-source.ts"
```

```ts
// modules/<id>/content-source.ts
const source: ContentSource = { id: "<id>", label: "…", search, get, list, findMedia };
export default source;
```

`node run.mjs module sync` folds it into `lib/modules/content-source-registry.ts`,
which `sources.ts` spreads into `CONTENT_SOURCES`. Four things follow:

- **The id carries the module's name**, like its error codes, its commands and
  its cron ids — `loadModules()` refuses a collision.
- **The contract stays in the core.** The generated file is typed against
  `ContentSource`, so a default export that does not keep it fails
  `npm run typecheck` naming the module — not a customer's first question.
- **`label` is model-facing English** and belongs in no `messages/*.json`: no
  member ever sees it, it travels inside the prompt.
- **Not declaring it is a decision too.** The community module deliberately has
  no source: what a chat tool returns goes to an AI provider, and posts are what
  members wrote about themselves and each other.
  `modules/community/ai-boundary.test.ts` refuses the coupling structurally, and
  the opt-in recipe in [`community.md`](community.md) ends with an allowlist
  entry naming the `docs/app.md` decision that authorised it.

Two contracts that are easy to miss:

- **`get()` answers `null` for "no such ref" AND for "not visible to this
  viewer"** — indistinguishable by design. Anything else is an existence
  oracle for another member's content.
- **A hit's `url` is app-relative or null.** The delivery layer (the tools)
  absolutizes with `APP_URL`; a source that returns an absolute URL fails the
  registry test.

## Deep links and anchors

A hit that says *"that is in lesson 4"* is half an answer; a hit whose link
scrolls the browser to the exact passage is the whole one. The convention:

1. The page renders each addressable block with a stable id, derived from the
   SAME slug or path the source puts into the hit:
   `id={slugifyAnchor(block.slug)}` for text, `id={mediaAnchor(path)}` on the
   `<figure>` around a player — plus `className="scroll-mt-20"` so the sticky
   header does not swallow the target (the pattern the salespage's `#inhalt`
   uses).
2. The source sets `hit.anchor` to that same string, computed with the same
   function from `lib/content-source/anchors.ts`.
3. The consumer opens `url#anchor`.

**Render the id in the same commit that registers the source.** Nothing can
enforce this structurally — an anchor no page renders scrolls nowhere, and an
honest `anchor: null` beats a dead fragment.

**Media hits link the page, never the file.** `mediaUrlFor()` output expires
and bypasses the authorisation the page performs with `mayAccess()` — a
signed URL in a hit is a private file going public. The hit carries the
medium's path and kind so the model can SAY what it found; the member watches
it on the page.

## From a hit to a link the customer can click

> Needs template 0.18.0 or newer — `node run.mjs update` brings the text, not
> the code. Everything above this heading works on any version;
> `lib/content-source/link-marker.ts` and `lib/ai/content-links.ts` are what
> this section builds on, and an older clone reads a description of code it
> does not carry. On one of those, keep returning `url` + `anchor`: the model
> still uses them to say WHERE something is, it just cannot make it clickable.

A `url` is not only something the model reads — the assistant can put it in
front of the member as a **link inside her sentence**:

> Das Thema wird in **Lektion 3: Knoten binden** erklärt — dort ab der zweiten
> Übung.

Nothing about writing a source changes for that. It happens because the
delivery layer composes a marker from the hit you already return:

```
hit { url: "/dashboard/kurs/knoten", anchor: "uebung-2",
      title: "Lektion 3: Knoten binden" }
   ↓ contentLinkMarker()   (lib/content-source/link-marker.ts)
[link:/dashboard/kurs/knoten#uebung-2|Lektion 3: Knoten binden]
   ↓ handed to the model INSIDE the tool result, as a `link` field
she copies it verbatim into her answer
   ↓ components/answer-text.tsx renders it — but only if it is whitelisted
```

**The label is the hit's TITLE, and it is composed on the server.** She never
writes the link text. That is not politeness, it is the control: the whitelist
is a WHOLE-STRING match, which is only possible while every part of the marker
is ours. A model-authored label ("klicke hier") would reduce the check to *the
destination is real, the pretext is free* — a misleading sentence over a real
link, with every test still green.

**Two mechanisms, two different lies they prevent:**

| | |
|---|---|
| **The grammar** (`isLinkableAppPath`) | makes a FOREIGN destination unspeakable. One leading `/` and never a second (`//evil.com/x` is a protocol-relative URL — a valid `href` that leaves the site), a closed charset with no `.`, no query string, at most one `#` in the project's slug grammar. There is no way to express `https://`, `javascript:` or `..` |
| **The per-request ledger** (`lib/ai/content-links.ts`) | makes an INVENTED destination untrue. Only markers composed from hits a registered source really returned **for this viewer, in this turn** are accepted; `/dashboard/kurs/lektion-42` for a lesson nobody wrote is perfectly well-formed and still renders as plain bracket text |

**There is deliberately no URL map.** A table of *content type ⇒
`/dashboard/kurs/{id}`* answers only "how do I spell a path" — never "does
this content exist and may this person open it" — so it would make a
hallucinated link look right, which is worse than no link. Your source already
owns its url, right next to the gate that decided whether the viewer sees the
hit at all. Keep it there.

**What is stored, and the alternative that was rejected.** The markers an
answer used are stored on the turn (`chat_messages.links`), so a reload renders
the same links. The more correct design — re-deriving the whitelist on load by
looking each url back up per viewer, so a link to a lesson the member has since
lost would stop being a link — was rejected: it needs a new required
`ContentSource` method and N queries on every page load, for a case the column
covers almost entirely. If your product needs that sharper behaviour, that is
where to start.

**Say the other half of that out loud, because it is the half people assume
away.** The stored markers do not only survive a reload — they are seeded back
into the ledger for the NEXT question in the same conversation, so that a
marker she legitimately repeats two turns later still renders instead of
turning into bracket text at random. The seed is bounded by the same history
window the model can actually read, and every seeded marker was once offered by
a source. But none of them is re-checked against entitlements. So a member who
bought a course, asked about Lektion 3, and then refunded can still be handed
that link in a fresh answer, with the lesson's title as its text, until the
conversation moves past the window.

The content stays shut — the page guards itself, which is why item 4 below is
the one that matters. What leaks is the existence of the lesson and its name,
to somebody who already saw both while they were entitled. That is the price of
one nullable column instead of N queries per page load, and it is a price worth
knowing you are paying rather than discovering. If it is too high for your
product — content whose mere titles are sensitive — re-derive on load.

### The five things that make a link work

The anchor rule above is one of five. Ship all of them **in the commit that
registers the source**, or return `url: null` and let her name the lesson in
prose instead — no link beats a dead one.

1. **The route exists and renders**, at exactly the path the source emits.
2. **The source emits that path**, from the same unique slug the route
   resolves. One place composes it — never a second helper beside it. **And the
   path has to be spellable** — see the box below; this is the item that fails
   first and explains itself worst.
3. **The anchors agree**: `hit.anchor = slugifyAnchor(block.slug)` (or
   `mediaAnchor(path)`), and the page renders `id={anchor}` with
   `className="scroll-mt-20"`.
4. 🚨 **The visibility gate is ONE function, called from both** — the source
   AND the page. Not two `hasPlan()` calls that agree today.
5. **`app/route-protection.test.ts` is answered**, not routed around.

**What a linkable path may contain** (`isLinkableAppPath()` in
`lib/content-source/link-marker.ts`, applied by the registry test in
`sources.test.ts` to every hit your source returns **for an anonymous
viewer** — see *Testing yours* for why that is nothing at all when your source
is gated):

| | |
|---|---|
| **Allowed** | `A-Z a-z 0-9 _ -` and `/`, then optionally one `#` followed by a lowercase slug (`slugifyAnchor()`'s own grammar) |
| **Refused** | a leading `//` (that is a protocol-relative URL and it leaves your site), any `.` at all, `?`, `&`, `%`, `:`, a trailing `/`, whitespace, and **anything non-ASCII** |
| **Ceilings** | 200 characters of path, 120 of label |

The one that surprises people building a German app: **`/dashboard/kurs/knoten-für-anfänger` is refused**, and so is its
percent-encoded form, because `%` is not in the set. A route folder may of
course be named that — Next.js does not mind — but a source cannot emit it as a
linkable url. Slugify the route the way `slugifyAnchor()` slugifies an anchor
(`für` → `fuer`) and both ends agree by construction. The same goes for a url
built with `new URL(...).pathname` off a directory-style route: strip the
trailing slash.

The failure looks like a shipped test turning red on your content, and the
message says only *"carries anything but a linkable app path"*. That test is
not weakened to get to green — the url it is refusing is one that would either
leave your app or dead-end in it. Return `url: null` until the path is
spellable.

**Why 4 is the one to take seriously.** The source decides who may SEE a hit;
the page decides who may OPEN the url. If the source is the more permissive of
the two, the assistant tells a non-buyer that *"Lektion 7: Der
Verkaufsabschluss"* exists and hands them a link that bounces them back to the
dashboard — a dead end, and an existence oracle for content they have not
bought. Nothing in the template can catch that: the source and the page are
both yours. So write it as one function:

```ts
// lib/kurs/rules.ts — the only answer to "may this person read this unit"
export async function mayReadUnit(memberId: string | null, slug: string) { … }
```

and call it from `search()`, `get()`, `findMedia()` **and** from
`app/dashboard/kurs/[unit]/page.tsx`.

## Visibility — the part that stays yours

Every source method receives a `viewer: { memberId, role }`. **The template
ships no authorization logic in this layer, deliberately** — which content a
non-buyer may search, whether lesson bodies are gated by `hasPlan()`, whether
a member's own uploads are findable: those are product decisions, and a
generic answer would be wrong somewhere. What the layer guarantees is that
the honest inputs are in your hand:

- Gate by plan with `hasPlan(viewer.memberId, "<productKey>")` — the same
  check the page makes.
- For media rows, `mayAccess(row, viewer)` (`lib/media/manage.ts`) is the
  model: public / owner / entitled / members, refusal by skipping the hit.
- The content tools pass `viewer.role` as `null`, deliberately — content only
  an Operator may see should never flow into a chat transcript by default. A
  source that wants role-aware visibility decides that inside the source, as
  a recorded decision.

**And one thing to decide consciously before a source returns member-scoped
content:** what a chat tool returns is sent to the AI provider as part of the
prompt. Content that is the same for every member (lessons, handbook) is
unproblematic. A source that returns a member's OWN data into the chat is a
data-protection decision — take it deliberately, record it in `docs/app.md`
under the decisions, and check `docs/data-protection.md` still tells the
truth.

## Testing yours

`lib/content-source/sources.test.ts` covers every registered source's registry
invariants (unique id, frozen list, relative-or-null urls). Add a test beside
your source for its own behaviour — ranking against fixture records, the
visibility gate, the `null`-for-both contract — the way
`knowledge-source.test.ts` does it with an in-memory `KnowledgeBase`, or
`modules/courses/content-source.test.ts` with `vi.mock` over the module's own
shell.

🚨 **And do not read the registry test as covering your urls, because for a
gated source it does not.** It walks with `VIEWER = { memberId: null }` — an
anonymous viewer — and a source that turns those away in its first line, which
every gated source has to, returns nothing for the test to judge. It is a real
check on the handbook and a vacuous one on yours. So the "linkable app path"
assertion belongs in YOUR test, against a viewer who is entitled, and it should
import `isLinkableAppPath()` from `lib/content-source/link-marker.ts` rather
than restate the rule: a second opinion about what a linkable path is drifts
from the first exactly when it matters.

A quick real question to the assistant (then `node run.mjs errors`) is the
end-to-end proof: she has to find your content mid-answer, and the log says
whether the tool calls behind it ran clean.
