// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// One post, on its way to a browser.
//
// 🚨 **Five doors handed the same post to the same list, and each spelled the
// conversion out itself.** Two route handlers (`routes/live.ts`,
// `routes/api-live.ts`) each had a `wirePost()`, `routes/api-discussion.ts` and
// `pages/discussions/[discussionId]/page.tsx` inlined it in a `.map`, and
// `components/embedded-discussion.tsx` called its copy `toPostView()` — with a
// comment saying "exactly as `wirePost()` does", which is the duplication
// describing itself.
//
// ⚠️ **The drift here is visible to a customer, which is what makes it worth a
// file.** The first render of a discussion comes through one door and every
// poll after it through another. Add a field to `PostRow` and teach four of the
// five about it, and the same post changes shape the moment the page updates
// itself — a name that appears, an image that vanishes — with nothing red
// anywhere, because each door's own test still passes.
//
// ── Two things it does, and both are about the browser ─────────────────────
//
//  1. **Dates become ISO strings.** `PostRow` carries real `Date`s; a `Date`
//     that crossed JSON is a string despite its type (`docs/conventions.md` →
//     *Dates that stop being dates*), so this converts them ON PURPOSE and
//     `PostView` says `string`. That is the honest declaration rather than a
//     type that lies after serialisation.
//  2. **`images` is passed through untouched.** `postImagesFor()` asked
//     `mayAccess()` and minted the addresses in one function, so the list is
//     already authorised and already JSON-safe — and a post that is not visible
//     arrives with an EMPTY list rather than with blanked fields. There is
//     nothing here to strip, and adding a strip would be a second opinion about
//     visibility in the layer least able to have one.
//
// 🚨 **What it deliberately does NOT carry: `removedReason`.** `PostRow` has it
// and `PostView` does not. It is prose an operator wrote about a member
// (`CLAUDE.md` → *What the app stores about people*), it belongs on the
// moderation surface, and a wire shape that carried it would put it in the
// payload of every ordinary discussion page. Dropping it is the decision; this
// file is where it stays dropped.
//
// Pure and type-only in both directions, so a client component may import it:
// `PostRow` comes from the server's `manage.ts` and `PostView` from the client
// `pages/ui.tsx`, and neither module is pulled in at runtime.
import type { PostRow } from "./manage";
import type { PostView } from "../pages/ui";

/** A post as the browser receives it — dates as ISO strings, images as minted. */
export function wirePost(post: PostRow): PostView {
  return {
    id: post.id,
    authorId: post.authorId,
    content: post.content,
    createdAt: post.createdAt.toISOString(),
    editedAt: post.editedAt?.toISOString() ?? null,
    deletedAt: post.deletedAt?.toISOString() ?? null,
    deletedBy: post.deletedBy,
    hiddenAt: post.hiddenAt?.toISOString() ?? null,
    authorProfileName: post.authorProfileName,
    authorAccountName: post.authorAccountName,
    images: post.images,
  };
}
