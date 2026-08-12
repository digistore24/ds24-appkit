// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The course, as its learner sees it.
//
// ⚠️ **This page is the app's product surface, and it is yours to change.**
// A module's pages are the one part of it a vendor legitimately redesigns —
// `docs/design.md`'s composition rules are about exactly this file. Editing it
// here is expected; what it costs is that it stops receiving fixes, the same
// price your own `app/` pages already pay.
//
// The check order is the contract:
//
//   off     → notFound() BEFORE any session work. In a normally wired app this
//             branch never renders: `proxy.ts` rewrites a switched-off course to
//             an unmatched path first, so the answer is the SAME document a
//             never-existed route sends. It stays as defense in depth — hiding
//             is never guarding, and a proxy matcher edit must not open this.
//   broken  → session, then the role fork: the OPERATOR reads the diagnosis
//             (this is the only surface where an off-reason becomes a sentence),
//             everyone else gets notFound().
//   on      → the gate, then the course.
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/page-header";
import { Callout } from "@/components/ui/callout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireActiveUser } from "@/lib/authz";
import { isOwner } from "@/lib/roles";

import { courseAccessFor } from "../lib/access";
import { courseConfigProblems, courseOffReason, courseShape } from "../lib/config";
import { courseOutline, completedSlugsFor } from "../lib/manage";
import { isUnlocked, nextUnit, progress } from "../rules";

export default async function CoursePage() {
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

  const memberId = session.user.id as string;
  const shape = courseShape();

  // 🚨 The purchase gate — ONE function, shared with the lesson page and with
  // anything this module later registers as a content source. Two `hasPlan()`
  // calls that agree today is how an assistant becomes an existence oracle.
  const { entitled, startedAt } = await courseAccessFor(memberId, session.user.role as string);
  if (!entitled) {
    // Not a 404: the course exists and this person may buy it. `/plans` is
    // where that happens, and it needs to know why they arrived.
    redirect("/plans?course=1");
  }

  const [blocks, completed] = await Promise.all([courseOutline(), completedSlugsFor(memberId)]);
  const now = new Date();

  const units = blocks.flatMap((block) =>
    block.units.map((unit) => ({
      slug: unit.slug,
      blockPosition: block.position,
      position: unit.position,
      unlocked: isUnlocked(block.releaseAfterDays, startedAt, shape, now),
    })),
  );
  const done = units.filter((unit) => completed.has(unit.slug)).length;
  const next = nextUnit(units, completed);

  return (
    <>
      <PageHeader title={t("title")} />

      {blocks.length === 0 ? (
        // Empty is the state most operators meet first, and the one nobody
        // remembers to add. It says where the rows come from, because "rows do
        // not deploy" is the failure this whole module is wired against.
        <EmptyState title={t("emptyTitle")} description={t("emptyBody")} />
      ) : (
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>{t("progressTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <div
                role="progressbar"
                aria-valuenow={progress(done, units.length)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={t("progressTitle")}
                className="h-2 w-full overflow-hidden rounded-full bg-muted"
              >
                <div
                  className="h-full bg-primary"
                  style={{ width: `${progress(done, units.length)}%` }}
                />
              </div>
              <p className="text-sm text-muted-foreground">
                {t("progressCount", { done, total: units.length })}
              </p>
              {next ? (
                <p className="text-sm">{t("nextStep", { title: next.slug })}</p>
              ) : (
                <p className="text-sm text-muted-foreground">{t("nothingOpen")}</p>
              )}
            </CardContent>
          </Card>

          {blocks.map((block) => {
            const open = isUnlocked(block.releaseAfterDays, startedAt, shape, now);
            return (
              <Card key={block.slug}>
                <CardHeader>
                  <CardTitle>{block.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  {block.summary ? (
                    <p className="mb-3 text-sm text-muted-foreground">{block.summary}</p>
                  ) : null}
                  {/* 🚨 A locked block shows its lessons' TITLES and never their
                      content — that is the whole of shape 2's promise. */}
                  <ul className="flex flex-col gap-1">
                    {block.units.map((unit) => (
                      <li key={unit.slug} className="text-sm">
                        {open ? unit.title : `${unit.title} — ${t("locked")}`}
                        {completed.has(unit.slug) ? ` · ${t("done")}` : ""}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
