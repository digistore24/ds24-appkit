// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What this app offers, and which of it this member holds.
//
// ⚠️ **This page is the app's product surface, and it is yours to change.** A
// module's pages are the one part of it a vendor legitimately redesigns —
// `docs/design.md`'s composition rules are about exactly this file.
//
// ── Why a list page exists at all ──────────────────────────────────────────
// `/dashboard/course` WAS one course's outline, because an app held one course.
// With several, that path has to answer "which one" before it can answer
// anything, and the menu entry has to lead somewhere that works whatever the
// operator has built (`nav.ts` is client-safe static data and cannot query).
//
// 🚨 **It shows courses the member does NOT hold, and that is the decision.**
// The alternative — list only what they bought — makes the page a dead end for
// the one visitor it could earn something from, and it tells a non-buyer
// nothing they could not learn from `/plans`. What it must never do is leak
// what is INSIDE a course they have not bought: no block titles, no lesson
// count, no "next lesson". Title, summary, and a way to buy. The line is the
// same one `docs/content-source.md` draws for the assistant — a surface more
// permissive than its page turns into an existence oracle, and here the page
// IS the surface.
//
// One `courseAccessFor()` per course, and no batching: an app holds a handful
// of courses, the call is two indexed reads, and a batched "which of these does
// this member hold" would be a second entitlement path beside the one gate.
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { GraduationCap } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireActiveUser } from "@/lib/authz";
import { isOwner } from "@/lib/roles";

import { courseAccessFor } from "../lib/access";
import { courseConfigProblems, courseOffReason } from "../lib/config";
import { usableCourses } from "../lib/courses";

export async function generateMetadata() {
  const t = await getTranslations("courses");
  return { title: t("listTitle") };
}

export default async function CourseListPage() {
  // 🚨 First line, before any session work — the same order the outline page
  // keeps, and for the same reason. AUS SCHLÄGT BETREIBER: there is no admin
  // preview of a switched-off module.
  if (courseOffReason() === "disabledInConfig") {
    notFound();
  }

  const session = await requireActiveUser();
  const t = await getTranslations("courses");

  if (courseOffReason() === "brokenConfig") {
    if (!isOwner(session.user.role)) {
      notFound();
    }
    return (
      <>
        <PageHeader title={t("listTitle")} />
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

  const memberId = session.user.id;
  // ⚠️ `usableCourses()`, not `allCourses()`: a course whose row does not hold
  // is invisible to a member and named to the operator on the admin surface.
  // Rendering it here would offer somebody a course that cannot open.
  const courses = await usableCourses();
  const held = await Promise.all(
    courses.map(async (course) => ({
      course,
      ...(await courseAccessFor(memberId, session.user.role, course)),
    })),
  );

  return (
    <>
      <PageHeader title={t("listTitle")} description={t("listIntro")} />

      {courses.length === 0 ? (
        // The state most operators meet first, and the one nobody remembers to
        // add. It says where the rows come from, because "rows do not travel
        // with a deploy" is the thing that surprises people.
        <EmptyState
          icon={GraduationCap}
          title={t("listEmptyTitle")}
          description={t("listEmptyBody")}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {held.map(({ course, entitled, asOperator }) => (
            <Card key={course.slug}>
              <CardHeader className="flex flex-row items-start justify-between gap-3">
                <CardTitle>{course.title}</CardTitle>
                {asOperator ? (
                  <Badge variant="outline">{t("listBadgeOperator")}</Badge>
                ) : entitled ? (
                  <Badge>{t("listBadgeOwned")}</Badge>
                ) : null}
              </CardHeader>
              <CardContent className="space-y-4">
                {course.summary ? (
                  <p className="text-muted-foreground text-sm">{course.summary}</p>
                ) : null}
                {/* 🚨 Nothing about what is INSIDE it for somebody who has not
                    bought it — see the header. The two buttons differ in where
                    they go, never in what they reveal. */}
                {entitled ? (
                  <Button asChild>
                    <Link href={`/dashboard/course/${encodeURIComponent(course.slug)}`}>
                      {t("listOpen")}
                    </Link>
                  </Button>
                ) : (
                  <Button asChild variant="outline">
                    <Link href={`/plans?course=${encodeURIComponent(course.slug)}`}>
                      {t("listBuy")}
                    </Link>
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
