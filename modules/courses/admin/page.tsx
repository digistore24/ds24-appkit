// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What this environment holds of the course — the operator's side of it.
//
// ⚠️ **This page is the app's product surface, and it is yours to change.** A
// module's pages are the one part of it a vendor legitimately redesigns —
// `docs/design.md`'s composition rules are about exactly this file. Editing it
// here is expected; what it costs is that it stops receiving fixes, the same
// price your own `app/` pages already pay.
//
// Two parts of it are not that, and they are the two worth naming before
// somebody rearranges the file:
//
//   * **the guard lines**, in the order they stand in. `disabledInConfig` →
//     `notFound()` BEFORE any session work, because AUS SCHLÄGT BETREIBER:
//     there is no admin preview of a switched-off module, and switching it on
//     is an edit to `config/course.json` plus a deploy, never something this
//     page could offer. `modules/community/admin/page.tsx` argues it at length
//     and this page keeps its ruling. In a normally wired app the branch never
//     renders — `gate.ts` covers `dashboard/admin/course` and `proxy.ts`
//     rewrites the request to an unmatched path first, so the answer is the
//     document a never-existed route sends. It stays as defence in depth:
//     hiding is never guarding, and a matcher edit must not open this.
//   * **the origin badges.** Which side of the partition a row is on is the
//     one thing this surface knows that nothing else shows, and it decides
//     what the write actions may touch. A row shown as the operator's that
//     is really the applier's is a row somebody will try to edit and be
//     refused by the database instead of by the page.
//
// The course DIFFERS from the community in exactly one place, deliberately:
// switched on but with a config that does not hold, the operator reads the
// diagnosis here rather than a 404 — the same fork `pages/page.tsx` makes for
// the learner surface. The community keeps exactly one diagnosis page and this
// module keeps two, because a course's config carries a `shape` that a member
// page cannot explain and an operator has to fix.
//
// It reads AND writes, and the writing half is `./actions.ts` plus `./ui.tsx` —
// never a form in this file. Every control it renders is cosmetics: the actions
// re-ask `isCourseEnabled()` and `requireOwner()` per request and refuse a
// `content` row themselves, because a Server Action is an HTTP endpoint of its
// own and a hidden menu is not a permission.
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Inbox } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireOwner } from "@/lib/authz";
import { appEnv } from "@/lib/env-guard";
import { isOwner } from "@/lib/roles";

import { courseConfigProblems, courseOffReason, courseShape } from "../lib/config";
import { contentFileIndex } from "../lib/content-files";
import { courseOutline } from "../lib/manage";
import { mediaSummaries } from "../lib/media";
import { mayOperatorWrite, type CourseSlotId } from "../rules";

import { slotCeilings } from "./ceilings";
import { UnitMediaDialog, type SlotFile } from "./media-slots";
import { BlockMenu, CreateBlockDialog, CreateUnitDialog, UnitMenu } from "./ui";

export async function generateMetadata() {
  const t = await getTranslations("coursesAdmin");
  return { title: t("title") };
}

export default async function CourseAdminPage() {
  // 🚨 First line, before any session work. See the header.
  if (courseOffReason() === "disabledInConfig") {
    notFound();
  }

  const session = await requireOwner();
  const t = await getTranslations("coursesAdmin");

  if (courseOffReason() === "brokenConfig") {
    // ⚠️ Unreachable behind `requireOwner()`, which redirects a member and a
    // moderator to `/dashboard` before this line — and written out anyway, the
    // same deliberate double refusal the password sign-in makes. It is the one
    // line that keeps this branch correct if the guard above it is ever
    // loosened to `requireActiveUser()` to show somebody something. Whoever
    // wants to tidy it away measures the page as a member first.
    if (!isOwner(session.user.role)) {
      notFound();
    }
    return (
      <>
        <PageHeader title={t("title")} />
        <Callout variant="warning" title={t("brokenTitle")}>
          <p>{t("brokenIntro")}</p>
          <ul className="mt-2 list-disc pl-5">
            {courseConfigProblems().map((problem) => (
              <li key={problem}>
                <code>{problem}</code>
              </li>
            ))}
          </ul>
        </Callout>
      </>
    );
  }

  const blocks = await courseOutline();
  // Safe here and nowhere earlier: the broken branch has returned, so the file
  // holds and `courseShape()` cannot throw.
  const shape = courseShape();
  const files = contentFileIndex();
  const lessons = blocks.reduce((sum, block) => sum + block.units.length, 0);

  // ── What is in the four media slots ──────────────────────────────────────
  // ONE query for the whole page, and deliberately not `unitMedia()` per row:
  // that door resolves a lesson FOR A VIEWER — `mayAccess()`, then a minted
  // address — and four of those per row is the N+1 `../lib/media.ts` warns
  // about. Here nothing is resolved: a name and a size off the `media` table,
  // for a surface that is already `requireOwner()`.
  const slotIds = blocks.flatMap((block) =>
    block.units.flatMap((unit) => [
      unit.coverMediaId,
      unit.videoMediaId,
      unit.subtitleMediaId,
      unit.worksheetMediaId,
    ]),
  );
  const summaries = await mediaSummaries(slotIds.filter((id): id is string => Boolean(id)));

  // What may go into each slot on THIS installation — two answers, because
  // there are two routes; `./ceilings.ts` carries the fork and the reasoning.
  // Read HERE rather than in the client component, because `mediaConfig()`
  // reads this installation's own file.
  const ceilings = slotCeilings();

  const slotsOf = (unit: {
    coverMediaId: string | null;
    videoMediaId: string | null;
    subtitleMediaId: string | null;
    worksheetMediaId: string | null;
  }): Record<CourseSlotId, SlotFile | null> => {
    const of = (id: string | null): SlotFile | null => {
      if (!id) return null;
      const row = summaries.get(id);
      // A slot pointing at a row that is gone shows as filled-but-unnamed
      // rather than empty: "there is nothing here" would invite an upload that
      // silently replaces a pointer somebody may still want to look into.
      return { filename: row?.filename ?? null, bytes: row?.bytes ?? 0 };
    };
    return {
      cover: of(unit.coverMediaId),
      video: of(unit.videoMediaId),
      subtitle: of(unit.subtitleMediaId),
      worksheet: of(unit.worksheetMediaId),
    };
  };
  // The next free number, so the commonest case — appending — needs no
  // thought. It is a SUGGESTION and nothing more: `positionAvailability()` is
  // what actually decides, against both origins.
  const nextPosition = (taken: readonly number[]) =>
    taken.reduce((highest, value) => Math.max(highest, value), 0) + 1;

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description", { blocks: blocks.length, lessons })}
      >
        {/* The answering surface is reached from HERE and from nowhere else —
            it gets no navigation entry, because it is the operator's work queue
            rather than a section of the app. Shown only for a workshop: the
            other two shapes ask nobody for anything, so a link to an inbox that
            can never fill is a dead end. */}
        {shape === "workshop" ? (
          <Button variant="outline" asChild>
            <Link href="/dashboard/admin/course/submissions">
              <Inbox aria-hidden="true" />
              {t("submissionsLink")}
            </Link>
          </Button>
        ) : null}
        <CreateBlockDialog
          shape={shape}
          nextPosition={nextPosition(blocks.map((block) => block.position))}
        />
      </PageHeader>

      <div className="flex flex-col gap-6">
        {/* A STATE, so a Callout and never a toast: it is true on every visit,
            and it is the sentence that stops somebody building their course in
            the wrong database. The environment is named because "this one" says
            nothing on a screenshot — and it is the NORMALISED name, because
            `appEnv()` maps anything unknown to production and the app then
            behaves that way; a box saying "banana" would name a state no other
            part of the app knows. */}
        <Callout variant="warning" title={t("environmentTitle")}>
          {t("environmentBody", { environment: appEnv(process.env.APP_ENV) })}
        </Callout>

        {files.unreadable.length > 0 && (
          // Not fatal, and deliberately not silent. The applier refuses the
          // whole run over one of these; this page still renders, and says
          // which file — otherwise the rows below would quietly show up as
          // "the file is gone" for a file that is merely broken.
          <Callout variant="danger" title={t("unreadableTitle")}>
            {t("unreadableBody", { files: files.unreadable.join(", ") })}
          </Callout>
        )}

        {blocks.length === 0 ? (
          // The empty state ships with the button that fills it (`CLAUDE.md` →
          // UI, rule 3). The sentence still points at `content/course/*.json`
          // first: what is typed here exists in one environment only.
          <EmptyState title={t("emptyTitle")} description={t("emptyBody")}>
            <CreateBlockDialog shape={shape} nextPosition={1} />
          </EmptyState>
        ) : (
          blocks.map((block) => (
            <Card key={block.id}>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground tabular-nums">{block.position}</span>
                  <span>{block.title}</span>
                  <OriginBadge
                    origin={block.origin}
                    file={files.blocks.get(block.slug)}
                    t={t}
                  />
                  <span className="ms-auto">
                    <BlockMenu block={block} shape={shape} />
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <p className="text-muted-foreground text-sm">
                  <code>{block.slug}</code>
                  {/* Only where the shape gives it a meaning. A drip course's
                      week number on a self-study course is a setting somebody
                      believes they made. */}
                  {shape === "drip" && (
                    <>
                      {" · "}
                      {t("releaseAfterDays", { days: block.releaseAfterDays })}
                    </>
                  )}
                </p>
                {block.summary && <p className="text-sm">{block.summary}</p>}

                {/* Offered under EVERY block, whatever its origin: a lesson
                    insert writes no row of the block's, so a bonus lesson under
                    a file's week one is an operator row inside a content block.
                    Lawful, and the case somebody actually wants. */}
                <div>
                  <CreateUnitDialog
                    block={{ id: block.id, title: block.title }}
                    nextPosition={nextPosition(block.units.map((unit) => unit.position))}
                  />
                </div>

                {block.units.length === 0 ? (
                  <p className="text-muted-foreground text-sm">{t("blockEmpty")}</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead className="w-12">{t("columnPosition")}</TableHead>
                        <TableHead>{t("columnLesson")}</TableHead>
                        <TableHead className="hidden sm:table-cell">
                          {t("columnContent")}
                        </TableHead>
                        <TableHead>{t("columnOrigin")}</TableHead>
                        {/* The column Story 5.3 hangs its row menu in. Empty
                            head with an sr-only label, the shape
                            `app/dashboard/admin/users/ui.tsx` established. */}
                        <TableHead className="w-12 text-right">
                          <span className="sr-only">{t("columnActions")}</span>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {block.units.map((unit) => (
                        <TableRow key={unit.id}>
                          <TableCell className="text-muted-foreground tabular-nums">
                            {unit.position}
                          </TableCell>
                          <TableCell>
                            <div className="font-medium">{unit.title}</div>
                            {/* The slug in full, unlike the community's
                                subject keys: a course slug is a route segment
                                and this surface is the operator's own, so it
                                is the string somebody searches for rather than
                                anything a purchase could be read out of. */}
                            <code className="text-muted-foreground text-xs">{unit.slug}</code>
                          </TableCell>
                          <TableCell className="hidden sm:table-cell">
                            <div className="flex flex-wrap gap-1">
                              <SlotBadge label={t("slotBody")} filled={Boolean(unit.body)} t={t} />
                              <SlotBadge
                                label={t("slotCover")}
                                filled={Boolean(unit.coverMediaId)}
                                t={t}
                              />
                              <SlotBadge
                                label={t("slotVideo")}
                                filled={Boolean(unit.videoMediaId)}
                                t={t}
                              />
                              <SlotBadge
                                label={t("slotSubtitle")}
                                filled={Boolean(unit.subtitleMediaId)}
                                t={t}
                              />
                              <SlotBadge
                                label={t("slotWorksheet")}
                                filled={Boolean(unit.worksheetMediaId)}
                                t={t}
                              />
                              {unit.taskPrompt && (
                                <Badge variant="secondary">{t("slotTask")}</Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <OriginBadge
                              origin={unit.origin}
                              file={files.units.get(unit.slug)}
                              t={t}
                            />
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              {/* Offered for EVERY lesson, unlike the row menu:
                                  a content lesson has media too, and "why can I
                                  not change this" deserves an answer where
                                  somebody looks for it rather than a missing
                                  button. The window's fields are disabled and
                                  its callout names the file — and every one of
                                  the five actions refuses the row again. */}
                              <UnitMediaDialog
                                unit={{
                                  id: unit.id,
                                  slug: unit.slug,
                                  title: unit.title,
                                  origin: unit.origin,
                                  slots: slotsOf(unit),
                                  ceilings,
                                  contentFile: files.units.get(unit.slug) ?? null,
                                }}
                              />
                              {/* Nothing at all for a row a file owns — and the
                                  action refuses one too. Both, never one. */}
                              <UnitMenu unit={unit} />
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </>
  );
}

type Translator = Awaited<ReturnType<typeof getTranslations<"coursesAdmin">>>;

/**
 * Where this row came from, in one badge.
 *
 * 🚨 The fork is `mayOperatorWrite()` and not `origin === "content"`, and the
 * direction matters: only a row that says literally `operator` is this
 * surface's. Anything else — `content`, or a value nobody planned for — is
 * somebody else's and is shown as coming from a file, which is the SAFE
 * direction for a page that grows write actions in 5.3. It is the same test the
 * applier makes from its own side (`origin <> 'content'` = not mine to touch),
 * inverted for the surface that owns the other half.
 *
 * A `content` row whose file is gone says so. Falling back to "made here" would
 * relabel the one row that is about to surprise somebody: the next
 * `content-apply` has no file to assert it from and will leave it standing.
 */
function OriginBadge({
  origin,
  file,
  t,
}: {
  origin: string;
  file: string | undefined;
  t: Translator;
}) {
  if (mayOperatorWrite(origin)) {
    return <Badge variant="default">{t("originOperator")}</Badge>;
  }
  if (!file) {
    return <Badge variant="destructive">{t("originContentOrphan")}</Badge>;
  }
  return <Badge variant="outline">{t("originContent", { file })}</Badge>;
}

/**
 * One of a lesson's four slots, filled or empty.
 *
 * The state is carried by the variant AND by a word, never by the colour alone:
 * a filled and an empty badge differ by contrast, which is exactly what a
 * screen reader and a colour-blind reader do not get.
 */
function SlotBadge({ label, filled, t }: { label: string; filled: boolean; t: Translator }) {
  return (
    <Badge variant={filled ? "secondary" : "outline"} className={filled ? "" : "opacity-60"}>
      {label}
      <span className="sr-only"> — {filled ? t("slotFilled") : t("slotEmpty")}</span>
    </Badge>
  );
}
