// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// One lesson.
//
// ⚠️ **Yours to change.** This is the app's product surface — `docs/design.md`'s
// composition rules ("video first, then the text") are about exactly this file.
// Editing it here is expected; the price is that it stops receiving fixes, the
// same one your own `app/` pages already pay.
//
// The order of the checks is the contract, and it is the same one the overview
// keeps: off before any session work, broken forks on the role, then the gate.
// 🚨 A LOCKED unit redirects to the overview rather than 404ing — it exists and
// this person owns it, they are simply early, and a 404 would say the lesson is
// not real.
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Figure } from "@/components/ui/figure";
import { MediaDownload } from "@/components/ui/media-download";
import { MediaPlayer } from "@/components/ui/media-player";
import { requireActiveUser } from "@/lib/authz";
// 🚨 The SAME arithmetic the content source uses, from the same string — the
// medium's bucket path and the unit's slug. Both sides compute the fragment
// with these two functions and neither slugifies by hand, which is the only
// way `[link:/dashboard/course/knoten#media-…]` in an answer scrolls to
// anything here (`docs/content-source.md` → *Deep links and anchors*).
// `scroll-mt-20` on every one of them, so the sticky header does not swallow
// the target — the pattern `app/page.tsx` uses for `#inhalt`.
import { mediaAnchor, slugifyAnchor } from "@/lib/content-source/anchors";

import { MemberText } from "../../components/member-text";
import { courseAccessFor } from "../../lib/access";
import { courseOffReason, courseShape } from "../../lib/config";
import { blockById, completedSlugsFor, submissionFor, unitBySlug } from "../../lib/manage";
import { unitMedia } from "../../lib/media";
import { MAX_SUBMISSION_CHARS, isUnlocked } from "../../rules";
import { CompletionToggle, TaskForm } from "./ui";

// The three texts on this page that somebody typed — the prompt, the member's
// own words, the reply — all render through `<MemberText>`
// (`../../components/member-text.tsx`), which is where the reasoning now lives.
// It moved out of this file because the operator's answering surface shows the
// same texts, and a second copy of the split is a second rendering policy: the
// `\r?\n` in it was a measured bug fix, and the copy that would have missed it
// is the one nobody edits.

export default async function CourseUnitPage({
  params,
}: {
  params: Promise<{ unit: string }>;
}) {
  if (courseOffReason() === "disabledInConfig") {
    notFound();
  }

  const session = await requireActiveUser();
  const t = await getTranslations("courses");

  // The broken state has exactly one door and it is the overview's diagnosis —
  // this page is not it, so everybody gets the not-found here.
  if (courseOffReason() === "brokenConfig") {
    notFound();
  }

  const memberId = session.user.id as string;
  const { entitled, startedAt } = await courseAccessFor(memberId, session.user.role as string);
  if (!entitled) {
    redirect("/plans?course=1");
  }

  const { unit: slug } = await params;
  const unit = await unitBySlug(slug);
  // A slug nobody wrote is a 404, and so is one whose block vanished — a unit
  // with no block cannot be placed, and rendering it would put a lesson outside
  // the course.
  if (!unit) notFound();
  const block = await blockById(unit.blockId);
  if (!block) notFound();

  if (!isUnlocked(block.releaseAfterDays, startedAt, courseShape(), new Date())) {
    redirect("/dashboard/course");
  }

  // 🚨 **Both conditions, and this line is where they meet.** A hand-in surface
  // exists exactly when the course is a `workshop` AND this lesson carries a
  // prompt — `docs/courses.md` describes submissions under shape 3 alone, and
  // `taskPrompt` non-null IS "this lesson asks for one" (`../../schema.ts`).
  // Either one missing and there is nothing here: no task, no form, and no read
  // of the submissions table at all.
  const taskPrompt = courseShape() === "workshop" ? unit.taskPrompt : null;

  const [media, completed, submission] = await Promise.all([
    // 🚨 The access check is inside `unitMedia()` — `mayAccess()` before
    // `mediaUrlFor()`, so this page cannot mint an address without it.
    unitMedia(unit, { memberId, role: (session.user.role as string) ?? null }),
    completedSlugsFor(memberId),
    // Not merely unrendered — not FETCHED. A page that read the row and then
    // decided not to show it would be a page that queries somebody's private
    // writing on every lesson in every course shape.
    taskPrompt === null ? null : submissionFor(memberId, unit.slug),
  ]);

  const format = await getFormatter();

  return (
    <>
      <PageHeader title={unit.title} />

      <div className="mb-4">
        <Button asChild variant="ghost" size="sm">
          <Link href="/dashboard/course">
            <ArrowLeft aria-hidden="true" />
            {t("backToCourse")}
          </Link>
        </Button>
      </div>

      <div className="flex flex-col gap-6">
        {media.video ? (
          <figure id={mediaAnchor(media.video.path)} className="scroll-mt-20">
            <MediaPlayer
              src={media.video.href}
              kind="video"
              mime={media.video.mime}
              poster={media.cover?.href}
              label={unit.title}
              // Present but OFF until the viewer switches one on — that is the
              // component's contract, and why no track is marked default.
              tracks={
                media.subtitle
                  ? [{ src: media.subtitle.href, srclang: "de", label: "Deutsch" }]
                  : undefined
              }
            />
          </figure>
        ) : media.cover ? (
          // ── A cover with no video, which used to render as nothing ─────────
          // `poster` is the cover's only job while there IS a video, so a
          // lesson that has one and no recording showed an operator's uploaded
          // picture nowhere at all. `else if` and not a second block: with a
          // video the picture is already on the page as the poster, and adding
          // it again would put the same image on the screen twice.
          //
          // ⚠️ **The measurements are the picture's own where they exist, and
          // NOMINAL where they do not.** They used to be nominal always, and the
          // reason no longer holds: since Story 26.2 `createMedia()` measures an
          // image while it has the bytes, so `width`/`height` are real for
          // anything uploaded after it — and for a picture stored BEFORE it they
          // are still null, which is what the 1280×720 fallback is for. `Figure`
          // needs two numbers to reserve the space either way, and the aspect
          // class is what actually decides what the reader sees.
          //
          // 🚨 **`srcSet` is the point of passing them at all.** The candidate
          // list comes out of `unitMedia()`, minted beside the `mayAccess()`
          // check, and a browser cannot use it without knowing how wide the
          // original really is (`lib/media/url.ts` → `mediaImageFor()`). No
          // `sizes` is given: a lesson cover spans the page's own column, which
          // is what the component's `100vw` default assumes.
          //
          // 🚨 **`unoptimized`, deliberately.** On the local driver
          // `mediaUrlFor()` answers `/api/media/<id>` — a RELATIVE address — so
          // `Figure` reads it as this app's own origin and switches Next's
          // optimiser on. The optimiser fetches server-side without the
          // viewer's session cookie, `deliverMedia()` answers `mayAccess()`
          // honestly with a 404, and DEV shows a broken image. On a cloud
          // driver the address is absolute and `Figure` bypasses the optimiser
          // anyway — this makes the two drivers behave the same instead of
          // leaving a fault only one of them shows.
          media.cover.alt ? (
            <Figure
              src={media.cover.href}
              srcSet={media.cover.srcSet}
              alt={media.cover.alt}
              width={media.cover.width ?? 1280}
              height={media.cover.height ?? 720}
              unoptimized
              className="aspect-video w-full object-cover"
            />
          ) : (
            <Figure
              src={media.cover.href}
              srcSet={media.cover.srcSet}
              decorative
              width={media.cover.width ?? 1280}
              height={media.cover.height ?? 720}
              unoptimized
              className="aspect-video w-full object-cover"
            />
          )
        ) : null}

        {unit.body ? (
          <Card id={slugifyAnchor(unit.slug)} className="scroll-mt-20">
            <CardContent className="flex flex-col gap-3 pt-6">
              {/* Paragraphs, not HTML. Nothing here goes through
                  `dangerouslySetInnerHTML` — a lesson body is text the operator
                  wrote, and the moment it renders markup it is a place to put
                  script. */}
              {unit.body.split(/\n{2,}/).map((paragraph, index) => (
                <p key={index} className="text-sm leading-relaxed">
                  {paragraph}
                </p>
              ))}
            </CardContent>
          </Card>
        ) : null}

        {media.worksheet ? (
          <Card id={mediaAnchor(media.worksheet.path)} className="scroll-mt-20">
            <CardHeader>
              <CardTitle>{t("worksheetTitle")}</CardTitle>
            </CardHeader>
            <CardContent>
              <MediaDownload
                href={media.worksheet.href}
                filename={media.worksheet.filename ?? unit.slug}
                size={media.worksheet.size}
              />
            </CardContent>
          </Card>
        ) : null}

        {/* The hand-in. THREE branches for FOUR states, and that is the point:
            "revised" is not a state of its own, only a newer `submittedAt` on
            the open one. Nothing is stored about which of them applies — no
            status column, and there is not to be one; the state is read off the
            row exactly as progress is read off the completions. */}
        {taskPrompt !== null ? (
          <Card>
            <CardHeader>
              <CardTitle>{t("taskTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
              <div className="flex flex-col gap-3">
                <MemberText text={taskPrompt} />
              </div>

              {submission && submission.repliedAt ? (
                // ANSWERED. A reply refers to a specific text, so the text is
                // frozen — no form, and the sentence saying so is part of the
                // product rather than an apology for a missing control.
                <>
                  <div className="flex flex-col gap-3">
                    <h3 className="text-sm font-medium">{t("submissionRepliedTitle")}</h3>
                    {submission.reply ? <MemberText text={submission.reply} /> : null}
                    <p className="text-xs text-muted-foreground">
                      {t("submissionRepliedOn", {
                        date: format.dateTime(submission.repliedAt, { dateStyle: "long" }),
                      })}
                    </p>
                  </div>

                  <div className="flex flex-col gap-3">
                    <h3 className="text-sm font-medium">{t("submissionYourText")}</h3>
                    <MemberText text={submission.body} />
                  </div>

                  <Callout variant="info">{t("submissionFrozen")}</Callout>
                </>
              ) : (
                <>
                  {/* ARRIVED, and it is load-bearing: somebody who has just
                      handed in their first text ever has to SEE that it reached
                      a person. The toast reports the click and is gone; this
                      stays — both, because they answer different questions
                      (`CLAUDE.md` → UI, rule 1). */}
                  {submission ? (
                    <Callout variant="success" title={t("submissionArrivedTitle")}>
                      {t("submissionArrivedBody", {
                        date: format.dateTime(submission.submittedAt, { dateStyle: "long" }),
                      })}
                    </Callout>
                  ) : null}

                  <TaskForm
                    unitSlug={unit.slug}
                    defaultValue={submission?.body ?? ""}
                    maxChars={MAX_SUBMISSION_CHARS}
                    label={t("taskFieldLabel")}
                    hint={t("taskHint", { max: MAX_SUBMISSION_CHARS })}
                    submitLabel={submission ? t("taskResubmit") : t("taskSubmit")}
                  />
                </>
              )}
            </CardContent>
          </Card>
        ) : null}

        <CompletionToggle
          unitSlug={unit.slug}
          done={completed.has(unit.slug)}
          labelDone={t("markUndone")}
          labelOpen={t("markDone")}
        />
      </div>
    </>
  );
}
