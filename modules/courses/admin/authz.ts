// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The two guards every action on the course's operator surface opens with, in
// the one order that is correct.
//
// 🚨 **THE SWITCH FIRST, THEN THE OWNER. Off beats operator.** There is no admin
// preview of a switched-off module: switching it on is an edit to
// `config/course.json` plus a deploy, never something an action could offer. A
// course switched ON whose config does not hold gets the same answer —
// `isCourseEnabled()` is false in both states, and an action has nothing to
// diagnose; writing against a config whose `shape` nothing can read is the one
// thing it must not do. The PAGES fork there and show the operator the
// diagnosis.
//
// 🚨 **`requireOwner()`, per request, in every action.** A Server Action is an
// HTTP endpoint in its own right, so the page's guard protects nothing here — a
// hidden control is not a permission and a request somebody replayed never saw
// the page. A moderator is refused exactly like a member: they look after
// people, not after the course.
//
// Both signal by THROWING, so this returns only for a caller who passed both.
//
// ⚠️ **It lives in its own file rather than in `./actions.ts`, and that is a
// framework rule rather than taste.** A `"use server"` module may export nothing
// but Server Actions — every export of one is an HTTP endpoint, and
// `app/use-server-exports.test.ts` fails the build on a non-action export. Three
// such files on this surface need this function, so it has to sit somewhere that
// is not one of them.
//
// The session it hands back is the OPERATOR's OWN, and it is the only place any
// action here gets an identity: `acceptUpload()` records it as the owner of an
// upload, `guardUploadEntry()` meters against it, and `replyToSubmission()`
// writes it into `replied_by`. No action reads a member id out of a form, and
// none ever may — `./guard.test.ts` holds that mechanically. During an
// impersonation the session says `member`, so `requireOwner()` has already
// refused; the identity that reaches a write is never an assumed one.
import { notFound } from "next/navigation";

import { requireOwner } from "@/lib/authz";

import { isCourseEnabled } from "../lib/config";

export async function guard() {
  if (!isCourseEnabled()) notFound();
  return requireOwner();
}
