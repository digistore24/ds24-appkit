// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// One hand-in: what the member wrote, and the box to write back in.
//
// 🚨 **The bounded window.** This is the only place in the app where somebody
// who is not the author reads what a member wrote, and it shows exactly one row
// — addressed by its own id, fetched one at a time. There is no neighbourhood,
// no "next hand-in", no list of everything this person ever handed in and no
// route from here to their progress: who is working through which lesson is
// purchase information (`docs/data-protection.md` §14b). "Who is this" is
// answered where it is already answered — the link goes to
// `/dashboard/admin/users/<id>`, and this module builds no second view of a
// member.
//
// The member's text renders through `<MemberText>` and never as markup
// (`../../../components/member-text.tsx`); `../../../lib/render-safety.test.ts`
// fails the build if anything in this tree reaches for the raw-HTML escape
// hatch.
//
// ⚠️ DYNAMIC route — `node run.mjs smoke` skips it. `scripts/dev/smoke.mjs`
// passes over every directory whose name starts with `[`, so this page is
// never called by the sweep. What covers it instead: the OFF state is asserted
// by `../../../smoke.mjs`, which fetches literal paths and is not subject to
// that skip; the guards are read out of the source by
// `../../../admin/guard.test.ts` and are the same first lines `../page.tsx`
// carries; the expensive query lives on the queue, which `smoke` does render.
// What is left — that this page is called at all — is a hand call with a real
// id, and it belongs in the change's own record.
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { ChevronLeft } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireOwner } from "@/lib/authz";
import { isOwner } from "@/lib/roles";

import { MemberText } from "../../../components/member-text";
import { courseConfigProblems, courseOffReason } from "../../../lib/config";
import { submissionById, unitBySlug } from "../../../lib/manage";
import { MAX_REPLY_CHARS, learnerLabel } from "../../../rules";
import { BrokenCourseNotice } from "../broken";
import { ReplyForm } from "../ui";

export async function generateMetadata() {
  const t = await getTranslations("coursesAdmin");
  return { title: t("submissionDetailTitle") };
}

export default async function CourseSubmissionPage({
  params,
}: {
  params: Promise<{ submissionId: string }>;
}) {
  // 🚨 First line, before any session work. Off beats operator.
  if (courseOffReason() === "disabledInConfig") {
    notFound();
  }

  const session = await requireOwner();
  const t = await getTranslations("coursesAdmin");

  if (courseOffReason() === "brokenConfig") {
    // The same deliberate double refusal `../page.tsx` and
    // `../../../admin/page.tsx` make: unreachable behind `requireOwner()`, and
    // written out so the branch stays correct if that guard is ever loosened.
    if (!isOwner(session.user.role)) {
      notFound();
    }
    return (
      <BrokenCourseNotice
        title={t("submissionDetailTitle")}
        calloutTitle={t("brokenTitle")}
        intro={t("brokenIntro")}
        problems={courseConfigProblems()}
      />
    );
  }

  const { submissionId } = await params;
  const submission = await submissionById(submissionId);
  // An id nobody wrote is a 404, and so is one whose row has since gone — a
  // member deleting their account takes their hand-ins with them.
  if (!submission) notFound();

  // The prompt the member was answering. Its own read rather than a join,
  // because `unitTitle` is all the LISTS need and a lesson's prompt is a text
  // nobody wants fifty of. `null` when the lesson has since been deleted, which
  // is legal: `unitSlug` is an opaque key, never a foreign key.
  const unit = await unitBySlug(submission.unitSlug);
  const format = await getFormatter();

  const learner = learnerLabel({
    name: submission.memberName,
    email: submission.memberEmail,
    memberId: submission.memberId,
    placeholderLabel: t("memberPlaceholder"),
  });
  const lesson = submission.unitTitle ?? t("submissionsUnknownLesson");

  return (
    <>
      <Button variant="ghost" size="sm" asChild className="mb-2 -ml-2">
        <Link href="/dashboard/admin/course/submissions">
          <ChevronLeft aria-hidden="true" />
          {t("submissionBack")}
        </Link>
      </Button>

      <PageHeader title={lesson} description={t("submissionLearner", { learner })} />

      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-muted-foreground text-sm">
            {/* `submittedAt` is NOT NULL. `repliedAt` below is nullable and is
                guarded at its call site — `format.dateTime(null)` renders
                1 January 1970 and neither throws nor logs. */}
            {t("submissionSubmittedOn", {
              date: format.dateTime(submission.submittedAt, {
                dateStyle: "long",
                timeStyle: "short",
              }),
            })}
          </p>
          <Button variant="outline" size="sm" asChild>
            <Link href={`/dashboard/admin/users/${encodeURIComponent(submission.memberId)}`}>
              {t("submissionOpenMember")}
            </Link>
          </Button>
        </div>

        {unit?.taskPrompt ? (
          <Card>
            <CardHeader>
              <CardTitle>{t("submissionTaskTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <MemberText text={unit.taskPrompt} />
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>{t("submissionTextTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <MemberText text={submission.body} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("submissionReplyTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {submission.repliedAt ? (
              // Stays on screen rather than drifting past as a toast: that this
              // hand-in is frozen for the member is a STATE, and it is what a
              // second visit needs to know (`CLAUDE.md` → UI, rule 1).
              <Callout variant="info">
                {t("submissionRepliedOn", {
                  date: format.dateTime(submission.repliedAt, {
                    dateStyle: "long",
                    timeStyle: "short",
                  }),
                })}
              </Callout>
            ) : null}

            <ReplyForm
              submissionId={submission.id}
              defaultValue={submission.reply ?? ""}
              maxChars={MAX_REPLY_CHARS}
              learner={learner}
              lesson={lesson}
              rewriting={submission.repliedAt !== null}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
