// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Which content FILE claims a slug — the one question every write action on
// this surface has to answer before it refuses.
//
// It lives beside the actions rather than inside one of them because there are
// now two `"use server"` files here (`actions.ts` for the rows,
// `media-actions.ts` for their four media slots) and both need it. It cannot
// simply be exported from `actions.ts`: every export of a `"use server"` file
// becomes a Server Action — a public endpoint — and "read the content tree" is
// not something this app publishes.
//
// 🚨 **The tree, never the table, and this is the sharpest decision in the
// story that introduced it.** A file that has never been applied holds no row,
// and that is the normal state between "written" and "`content-apply`" — in a
// fresh PROD it is the state of EVERY file. Reading `origin = 'content'` rows
// instead would call `woche-3` free today, let the operator create it, and make
// tomorrow's `content-apply` REFUSE ITS WHOLE RUN over a slug nobody was warned
// about. The table is still asked, as the SECOND question, by
// `slugAvailability()`.
//
// ⚠️ **The import of the reader is dynamic, in the body, deliberately.**
// `../lib/content-files` reads `node:fs`; a module-level import would put that
// in this file's static graph, and this file is reached from `admin/ui.tsx` and
// `admin/media-slots.tsx` — both client components — through the action files
// they import. `"use server"` means those bodies never ship, but the graph is
// resolved before anything runs.
//
// ⚠️ **An unreadable file claims nothing, and that is a known edge.** The
// reader names such files instead of throwing (the applier throws — it is about
// to write), and the page shows them in a danger callout. So a slug claimed by
// a file that will not parse can be created here; the applier still refuses
// later, which is the safe direction but not a warning at the right time.
import { getTranslations } from "next-intl/server";

/** Every slug the deployed content tree claims, block and lesson alike. */
export async function claims() {
  const { contentFileIndex } = await import("../lib/content-files");
  return contentFileIndex();
}

export type ContentClaims = Awaited<ReturnType<typeof claims>>;

/** The path of the file that claims this slug — or the words for "there is none". */
export async function fileFor(
  index: ContentClaims,
  kind: "blocks" | "units",
  slug: string,
): Promise<string> {
  const name = index[kind].get(slug);
  if (name) return `content/course/${name}`;
  // A `content` row whose file left the tree. The surface already has a word
  // for that state; borrowing it keeps the two saying the same thing, in the
  // request's own language.
  const t = await getTranslations("coursesAdmin");
  return t("originContentOrphan");
}
