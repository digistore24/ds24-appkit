// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The one conversion five doors now share.
//
// Before this function each of them spelled the mapping out — two route
// handlers, two inline `.map`s and a component whose comment said "exactly as
// `wirePost()` does". The drift that made it worth collapsing is visible to a
// customer: the first render of a discussion comes through one door and every
// poll after it through another, so a field taught to four of the five changes
// the post's shape the moment the page updates itself.
//
// 🚨 The last two assertions are the ones a type does not make, and the
// difference between them and the compiler is worth stating exactly rather than
// generously. Both were measured:
//
//   · add `removedReason` to `wirePost()` ALONE — `npm run typecheck` goes
//     **red**. The excess-property check fires on the returned object literal,
//     so the compiler already has this case.
//   · widen `PostView` first and then add it — typecheck is **clean**, and
//     **2 of 6** tests here go red. That is the realistic path: nobody adds a
//     field to a mapper against its declared return type; they widen the view
//     because a new surface wants the field, and every OTHER surface silently
//     starts carrying it too.
//
// So this file is not a second opinion about the compiler. It is the guard on
// the one direction the compiler cannot have an opinion about: what a widening
// of the VIEW quietly puts into every payload that was already using it.
import { describe, expect, it } from "vitest";

import { wirePost } from "./wire";
import type { PostRow } from "./manage";

const CREATED = new Date("2026-08-13T10:20:30.000Z");

function row(over: Partial<PostRow> = {}): PostRow {
  return {
    id: "post-1",
    authorId: "member-1",
    content: "Guten Morgen",
    createdAt: CREATED,
    editedAt: null,
    deletedAt: null,
    deletedBy: null,
    removedReason: null,
    authorProfileName: "Sanne",
    authorAccountName: "sanne@example.com",
    images: [],
    ...over,
  } as PostRow;
}

describe("wirePost", () => {
  it("turns every date into an ISO string", () => {
    // `PostView` declares them as `string`, and a `Date` that crossed JSON is a
    // string despite its type — so converting here is what makes the type
    // honest rather than merely accurate until serialisation.
    const wired = wirePost(row({ editedAt: CREATED, deletedAt: CREATED }));

    expect(wired.createdAt).toBe("2026-08-13T10:20:30.000Z");
    expect(wired.editedAt).toBe("2026-08-13T10:20:30.000Z");
    expect(wired.deletedAt).toBe("2026-08-13T10:20:30.000Z");
  });

  it("keeps a null date null rather than inventing an epoch", () => {
    // `new Date(null)` is 1 January 1970 and renders without complaining —
    // the failure `docs/conventions.md` names for every nullable date.
    const wired = wirePost(row());
    expect(wired.editedAt).toBeNull();
    expect(wired.deletedAt).toBeNull();
  });

  it("carries the author's two names and the deletion actor through", () => {
    const wired = wirePost(row({ deletedBy: "moderator" }));
    expect(wired.authorProfileName).toBe("Sanne");
    expect(wired.authorAccountName).toBe("sanne@example.com");
    expect(wired.deletedBy).toBe("moderator");
  });

  it("passes the images through untouched", () => {
    // Already authorised and already JSON-safe: `postImagesFor()` asked
    // `mayAccess()` and minted the addresses in one function. A strip here
    // would be a second opinion about visibility in the layer least able to
    // have one.
    const images: PostRow["images"] = [
      {
        mediaId: "media-1",
        src: "https://store/a.jpg",
        srcSet: null,
        width: 800,
        height: 600,
        alt: "Der Kuchen",
      },
    ];
    // Identity, not a copy: passing it through is the claim.
    expect(wirePost(row({ images })).images).toBe(images);
  });

  it("🚨 does NOT carry `removedReason` — an operator's prose about a member", () => {
    // The claim no type enforces. It belongs on the moderation surface; a wire
    // shape that carried it would put it in the payload of every ordinary
    // discussion page, readable by anyone who opens the network tab.
    const wired = wirePost(row({ removedReason: "Spam, dritte Verwarnung" }));

    expect(Object.keys(wired)).not.toContain("removedReason");
    expect(JSON.stringify(wired)).not.toContain("Verwarnung");
  });

  it("hands back exactly the eleven fields `PostView` declares", () => {
    // The other half of the same guard: a field ADDED to `PostRow` does not
    // travel until somebody decides it should. Without this, the next widening
    // of the row silently widens every payload.
    //
    // ✅ **`hiddenAt` was such a decision and this list is where it was
    // recorded** (the automatic post lock). It travels where `removedReason`
    // above does not, and the difference is what the field IS: a bare timestamp
    // saying the post is off the page — which every reader of the thread can
    // already see from the tombstone — against prose a moderator wrote about a
    // member. Without it the browser cannot tell `autoHidden` from `visible`
    // and renders the words the server just took away.
    expect(Object.keys(wirePost(row())).sort()).toEqual([
      "authorAccountName",
      "authorId",
      "authorProfileName",
      "content",
      "createdAt",
      "deletedAt",
      "deletedBy",
      "editedAt",
      "hiddenAt",
      "id",
      "images",
    ]);
  });
});
