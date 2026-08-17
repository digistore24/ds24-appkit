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
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Callout } from "@/components/ui/callout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireActiveUser } from "@/lib/authz";
import { isOwner } from "@/lib/roles";

import { courseAccessFor } from "../lib/access";
import { courseConfigProblems, courseOffReason } from "../lib/config";
import { courseBySlug } from "../lib/courses";
import { courseOutline, completedSlugsFor } from "../lib/manage";
import { isUnlocked, nextUnit, progress, unitRefs, unlockedAt } from "../rules";

// The browser tab, which is not the page's heading.
//
// **Static and parameterless, and specific to the PAGE rather than the section.**
// That is the majority form here — `messagesTitle`, `reportDetailTitle`,
// `submissionDetailTitle` — and the reason is that a tab is how somebody tells
// two open windows apart. A title read off the RECORD would be nicer still and
// is deliberately not done: it means loading the row a second time to fill a
// tab, and on the community's pages that second load is viewer-dependent too.
//
// ⚠️ The `app/` wrapper has to re-export this or the route never sees it. That
// omission is what 2026-08-12 reported: five module pages whose tab said only
// "Your App" while every core page carried its name. Since the same day
// `modules/boundary.test.ts` §1b refuses a wrapper that drops it.
export async function generateMetadata() {
  const t = await getTranslations("courses");
  return { title: t("title") };
}

export default async function CoursePage({
  params,
  searchParams,
}: {
  params: Promise<{ course: string }>;
  /**
   * `?locked=<unit slug>` — set by the lesson page when it sends somebody back
   * from a week that has not opened.
   *
   * 🚨 **A REFERENCE, never a message** (`CLAUDE.md` → UI, rule 1). The slug is
   * looked up against this course's own lessons below and the sentence is built
   * from the row; a URL carrying the sentence itself is a URL anybody can hand
   * somebody else to make their app say whatever they typed.
   */
  searchParams: Promise<{ locked?: string | string[] }>;
}) {
  if (courseOffReason() === "disabledInConfig") {
    notFound();
  }

  const session = await requireActiveUser();
  const t = await getTranslations("courses");

  // 🚨 **`courseBySlug()` answers `null` for "there is none" AND for "it is
  // broken", and this page keeps both as 404.** A learner who reached a course
  // whose `shape` is unreadable must get what a slug that never existed gets;
  // telling them apart would say "this exists and is broken" to somebody who
  // cannot act on it. The OPERATOR's surface reads `allCourses()` and sees the
  // difference — `lib/courses.ts` argues the split at length.
  const { course: courseSlug } = await params;
  const course = await courseBySlug(courseSlug);
  if (!course) notFound();

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

  const memberId = session.user.id;
  // Per course, not per app — `courses_courses.shape`. Non-null by
  // construction here: `courseBySlug()` has already refused a row whose shape
  // is not one of the three.
  const shape = course.shape!;

  // 🚨 The purchase gate — ONE function, shared with the lesson page and with
  // anything this module later registers as a content source. Two `hasPlan()`
  // calls that agree today is how an assistant becomes an existence oracle.
  const { entitled, startedAt } = await courseAccessFor(memberId, session.user.role, course);
  if (!entitled) {
    // Not a 404: the course exists and this person may buy it. `/plans` is
    // where that happens, and it needs to know why they arrived.
    redirect(`/plans?course=${encodeURIComponent(course.slug)}`);
  }

  const [blocks, completed] = await Promise.all([courseOutline(course.id), completedSlugsFor(memberId)]);
  const now = new Date();
  const format = await getFormatter();

  // The flatten moved into `rules.ts` when the course LIST needed the same
  // answer — same function, same arguments, so the two pages cannot disagree
  // about how far somebody is.
  const units = unitRefs(blocks, startedAt, shape, now);
  const done = units.filter((unit) => completed.has(unit.slug)).length;
  const next = nextUnit(units, completed);

  /**
   * When does this block open, in words the learner can act on?
   *
   * 🚨 **Until 2026-08-17 no page in this app rendered an opening date at all**
   * — a locked week said "noch nicht freigeschaltet" and nothing else, so a
   * learner could not tell tomorrow from six weeks away. The date was always
   * there (`unlockedAt()`); only the sentence was missing. The assistant's
   * `lockedNote()` in `../content-source.ts` has said it all along, which is
   * why this function takes the same three states it does — and why that one's
   * comment about being the only place is now this one's too.
   *
   * ⚠️ **`timeZone: "UTC"` is load-bearing.** `startedAt` is a `min(created_at)`
   * out of a zoneless column read as UTC, so a formatter left on the server's
   * zone names the day before for a member in CEST whose grant was written at
   * 23:30. The same rule `accessUntil` keeps on the account page.
   */
  const opensSentence = (releaseAfterDays: number): string => {
    // No active grant: nothing has a clock at all, and naming a date would
    // invent one. The honest sentence is the one a paused member gets.
    if (startedAt === null) return t("blockPaused");
    const opensAt = unlockedAt(releaseAfterDays, startedAt, shape);
    // An absurd `releaseAfterDays` — an unbounded `int4`, and the admin form
    // carries no maximum — pushes the sum out of the representable range. The
    // block is locked either way; only the day is unnameable.
    if (opensAt === null || !Number.isFinite(opensAt.getTime())) return t("blockOpensUnknown");
    return t("blockOpensOn", {
      date: format.dateTime(opensAt, { dateStyle: "long", timeZone: "UTC" }),
    });
  };

  // ⚠️ **A `<Callout>`, not a toast**, and the difference is the date in it: a
  // toast is gone in four seconds, and "opens on the 24th" is the one thing
  // this person came here to find out. `CLAUDE.md` → UI, rule 1 picks by where
  // the result has to appear, and this one has to stay on screen.
  //
  // Nothing renders unless the slug names a lesson of THIS course that really
  // is shut for THIS member — a hand-typed parameter gets silence rather than a
  // sentence about a lesson somebody else's course holds.
  const { locked } = await searchParams;
  const lockedSlug = typeof locked === "string" ? locked : null;
  const lockedUnit = lockedSlug
    ? (units.find((unit) => unit.slug === lockedSlug && !unit.unlocked) ?? null)
    : null;
  const lockedBlock = lockedUnit
    ? (blocks.find((block) => block.units.some((unit) => unit.slug === lockedUnit.slug)) ?? null)
    : null;

  return (
    <>
      <PageHeader title={course.title} description={course.summary ?? undefined} />

      {lockedUnit && lockedBlock ? (
        <Callout
          variant="info"
          title={t("lockedNoticeTitle", { title: lockedUnit.title })}
          className="mb-6"
        >
          {opensSentence(lockedBlock.releaseAfterDays)}
        </Callout>
      ) : null}

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
                // The most prominent answer to "where do I go now?" is also the
                // shortest way there. `nextUnit()` filters on `unlocked`, so its
                // answer can never be a locked lesson — the href needs no second
                // gate. Only the TITLE is the link, not the label in front of
                // it, which is why the sentence carries a `<lesson>` tag rather
                // than being wrapped whole.
                <p className="text-sm">
                  {t.rich("nextStep", {
                    title: next.title,
                    lesson: (chunks) => (
                      <Link
                        href={`/dashboard/course/${encodeURIComponent(course.slug)}/${encodeURIComponent(next.slug)}`}
                        className="text-primary underline underline-offset-4"
                      >
                        {chunks}
                      </Link>
                    ),
                  })}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">{t("nothingOpen")}</p>
              )}
            </CardContent>
          </Card>

          {blocks.map((block) => {
            const open = isUnlocked(block.releaseAfterDays, startedAt, shape, now);
            return (
              <Card key={block.slug}>
                <CardHeader className="flex flex-row items-start justify-between gap-3">
                  <CardTitle>{block.title}</CardTitle>
                  {/* The date sits on the BLOCK, because the clock does: a
                      badge per lesson would repeat one fact per line and still
                      leave the block's own heading silent. */}
                  {open ? null : (
                    <Badge variant="outline" className="shrink-0">
                      {opensSentence(block.releaseAfterDays)}
                    </Badge>
                  )}
                </CardHeader>
                <CardContent>
                  {block.summary ? (
                    <p className="mb-3 text-sm text-muted-foreground">{block.summary}</p>
                  ) : null}
                  {/* 🚨 A locked block shows its lessons' TITLES and never their
                      content — that is the whole of shape 2's promise.

                      So the title is a LINK exactly while the block is open. A
                      locked one stays plain text on purpose: `unit/page.tsx`
                      redirects it back here (a lesson somebody owns and is
                      merely early for is not a 404), and a link that returns you
                      wordlessly to the page you clicked on is worse than none.

                      ⚠️ Reported 2026-08-12: there was no link at all, in either
                      direction. The lesson pages were finished and reachable
                      only by typing the URL, and nothing saw it — `ux-check`'s
                      navigation rule SKIPPED `[param]` routes and `smoke` skips
                      them still. The first half of that is closed: the rule
                      compares dynamic routes now, and taking these two links out
                      again makes it red. The `done` marker stays OUTSIDE the
                      anchor: it is a state, not part of the lesson's name.

                      ⚠️ It is UNDERLINED, not merely underlined-on-hover. A
                      course is read on a phone, a phone has no hover, and a list
                      whose links look exactly like the plain text this fix
                      replaced is the same defect wearing a new implementation.
                      The form is `components/legal-body.tsx`'s. */}
                  <ul className="flex flex-col gap-1">
                    {block.units.map((unit) => (
                      <li key={unit.slug} className="text-sm">
                        {open ? (
                          <Link
                            href={`/dashboard/course/${encodeURIComponent(course.slug)}/${encodeURIComponent(unit.slug)}`}
                            className="text-primary underline underline-offset-4"
                          >
                            {unit.title}
                          </Link>
                        ) : (
                          `${unit.title} — ${t("locked")}`
                        )}
                        {/* ⚠️ Only while the block is OPEN. A block can re-lock
                            — a refund and a repurchase move `startedAt` — and a
                            line then read "Titel — noch nicht freigeschaltet ·
                            erledigt", two states that contradict each other. A
                            locked line states one thing. */}
                        {open && completed.has(unit.slug) ? ` · ${t("done")}` : ""}
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
