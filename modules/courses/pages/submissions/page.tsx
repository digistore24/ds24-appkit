// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The queue: what somebody handed in and nobody has answered yet, oldest first.
//
// ⚠️ **Yours to change.** A module's pages are the app's own surface, the same
// way the lesson page next door is. Editing this one is expected; the price is
// that it stops receiving fixes, the same one your own `app/` pages already
// pay. Two things in it are not layout and are worth knowing before it gets
// rearranged:
//
//   * **the guard lines, in the order they stand in.** `disabledInConfig` →
//     `notFound()` BEFORE any session work — off beats operator — then
//     `requireOwner()`, then the broken fork. The same order
//     `../../admin/page.tsx` keeps and for the same reasons.
//   * **the narrowing is in the QUERY** (`modules/community/pages/moderation/page.tsx`).
//     `waitingSubmissions()` asks for the unanswered ones; a page that fetched
//     everything and rendered a subset would have shipped the rest in its own
//     payload. The bodies are not selected at all — reading what a person wrote
//     is the detail page, one row at a time.
//
// 🚨 **This lists HAND-INS, never people.** Somebody who has handed nothing in
// appears nowhere, there is no search, no filter and no route from a member to
// their course progress — who is working through which lesson is purchase
// information (`CLAUDE.md` → *Which EU rules reach this app*,
// `docs/data-protection.md` §14b). The answered list is capped rather than
// paged, because a browsable body of somebody else's prose IS the export this
// module refuses.
//
// It is reached from the course's setup page and has no navigation entry of its
// own — it is the operator's work queue, not a section of the app.
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { Inbox } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
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
import { isOwner } from "@/lib/roles";

import { courseConfigProblems, courseOffReason } from "../../lib/config";
import {
  answeredSubmissions,
  waitingCount,
  waitingSubmissions,
  type WaitingSubmission,
} from "../../lib/manage";
import { learnerLabel } from "../../rules";
import { BrokenCourseNotice } from "./broken";

/** The ceiling on the queue. A ceiling, not a page — there is no page two. */
const WAITING_LIMIT = 50;
/** …and on the answered list, which is a reminder rather than an archive. */
const ANSWERED_LIMIT = 20;

export async function generateMetadata() {
  const t = await getTranslations("coursesAdmin");
  return { title: t("submissionsTitle") };
}

export default async function CourseSubmissionsPage() {
  // 🚨 First line, before any session work. Off beats operator.
  if (courseOffReason() === "disabledInConfig") {
    notFound();
  }

  const session = await requireOwner();
  const t = await getTranslations("coursesAdmin");

  if (courseOffReason() === "brokenConfig") {
    // ⚠️ Unreachable behind `requireOwner()`, which redirects a member and a
    // moderator to `/dashboard` before this line — written out anyway, the same
    // deliberate double refusal `../../admin/page.tsx` makes. It is what keeps
    // this branch correct if the guard above is ever loosened.
    if (!isOwner(session.user.role)) {
      notFound();
    }
    return (
      <BrokenCourseNotice
        title={t("submissionsTitle")}
        calloutTitle={t("brokenTitle")}
        intro={t("brokenIntro")}
        problems={courseConfigProblems()}
      />
    );
  }

  // TWO queries and two sections, and that is not convenience. The one query
  // this suggests — `ORDER BY replied_at ASC NULLS FIRST, submitted_at ASC` —
  // asks an ASC btree for the opposite null order, which
  // `courses_submissions_waiting` cannot serve; the plan becomes a Sort over the
  // whole table and the index built for this list goes unused. Split in two,
  // each half is an ordered index scan. `../../lib/manage.ts` carries the
  // measurement.
  const [waiting, total, answered, format] = await Promise.all([
    waitingSubmissions(WAITING_LIMIT),
    waitingCount(),
    answeredSubmissions(ANSWERED_LIMIT),
    getFormatter(),
  ]);

  const placeholderLabel = t("memberPlaceholder");
  /** The learner's name, resolved from values the query already carried. */
  const nameOf = (row: WaitingSubmission) =>
    learnerLabel({
      name: row.memberName,
      email: row.memberEmail,
      memberId: row.memberId,
      placeholderLabel,
    });

  return (
    <>
      <PageHeader title={t("submissionsTitle")} description={t("submissionsDescription")} />

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>{t("submissionsWaitingTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {waiting.length === 0 ? (
              // The state this page is in most of the time, shipped in the same
              // commit as the page (`CLAUDE.md` → UI, rule 3).
              <EmptyState
                icon={Inbox}
                title={t("submissionsEmptyTitle")}
                description={t("submissionsEmptyBody")}
              />
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("submissionsColumnWhen")}</TableHead>
                      <TableHead>{t("submissionsColumnLearner")}</TableHead>
                      <TableHead>{t("submissionsColumnLesson")}</TableHead>
                      <TableHead className="text-right">
                        {t("submissionsColumnActions")}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {waiting.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell>
                          {/* `useFormatter()`, never `toLocaleDateString` —
                              the language is the request's. `submittedAt` is
                              NOT NULL, so no guard is needed here; `repliedAt`
                              below is, and has one. */}
                          {format.dateTime(row.submittedAt, {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}
                        </TableCell>
                        <TableCell className="font-medium">{nameOf(row)}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {row.unitTitle ?? t("submissionsUnknownLesson")}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="outline" size="sm" asChild>
                            <Link
                              href={`/dashboard/admin/course/submissions/${encodeURIComponent(row.id)}`}
                            >
                              {t("submissionsOpen")}
                            </Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                {total > waiting.length ? (
                  // Said rather than truncated silently: a queue that quietly
                  // stopped at fifty would look finished.
                  <p className="text-muted-foreground text-sm">
                    {t("submissionsWaitingMore", { shown: waiting.length, total })}
                  </p>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("submissionsAnsweredTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {answered.length === 0 ? (
              <EmptyState
                title={t("submissionsAnsweredEmptyTitle")}
                description={t("submissionsAnsweredEmptyBody")}
              />
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("submissionsColumnAnswered")}</TableHead>
                      <TableHead>{t("submissionsColumnLearner")}</TableHead>
                      <TableHead>{t("submissionsColumnLesson")}</TableHead>
                      <TableHead className="text-right">
                        {t("submissionsColumnActions")}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {answered.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell>
                          {/* 🚨 `repliedAt` is nullable, so it is guarded at the
                              call site: `format.dateTime(null)` renders
                              1 January 1970 and neither throws nor logs. Every
                              row in THIS list has one, and the guard stays
                              because the query is not what the renderer can
                              see. */}
                          {row.repliedAt
                            ? format.dateTime(row.repliedAt, {
                                dateStyle: "medium",
                                timeStyle: "short",
                              })
                            : "—"}
                        </TableCell>
                        <TableCell className="font-medium">{nameOf(row)}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {row.unitTitle ?? t("submissionsUnknownLesson")}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="sm" asChild>
                            <Link
                              href={`/dashboard/admin/course/submissions/${encodeURIComponent(row.id)}`}
                            >
                              {t("submissionsRead")}
                            </Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <p className="text-muted-foreground text-sm">
                  {t("submissionsAnsweredHint", { limit: ANSWERED_LIMIT })}
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
