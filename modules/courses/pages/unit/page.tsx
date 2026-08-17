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
import { ArrowLeft, ArrowRight } from "lucide-react";

import { LegalBody } from "@/components/legal-body";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Figure } from "@/components/ui/figure";
import { MediaDownload } from "@/components/ui/media-download";
import { MediaPlayer } from "@/components/ui/media-player";
import { requireActiveUser } from "@/lib/authz";
// The core's markdown subset, shared with the legal pages rather than copied.
// It returns DATA — see the body's own comment below for why that is the whole
// security story here.
import { parse } from "@/lib/legal/markdown";
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
import { courseOffReason } from "../../lib/config";
import { courseBySlug } from "../../lib/courses";
import {
  blockById,
  completedSlugsFor,
  courseOutline,
  submissionFor,
  unitBySlug,
} from "../../lib/manage";
import { unitMedia } from "../../lib/media";
import { MAX_SUBMISSION_CHARS, isUnlocked, neighbours, unitRefs } from "../../rules";
import { CompletionToggle, TaskForm } from "./ui";

// The three texts on this page that somebody typed — the prompt, the member's
// own words, the reply — all render through `<MemberText>`
// (`../../components/member-text.tsx`), which is where the reasoning now lives.
// It moved out of this file because the operator's answering surface shows the
// same texts, and a second copy of the split is a second rendering policy: the
// `\r?\n` in it was a measured bug fix, and the copy that would have missed it
// is the one nobody edits.

// "Lesson", not the lesson's own name — see the note on the course overview's
// `generateMetadata`. Taking the title off `unitBySlug()` would load the row a
// second time to fill a tab; saying "Course" here would make this tab and the
// overview's indistinguishable.
export async function generateMetadata() {
  const t = await getTranslations("courses");
  return { title: t("lessonTitle") };
}

export default async function CourseUnitPage({
  params,
}: {
  params: Promise<{ course: string; unit: string }>;
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

  // 🚨 **The course comes BEFORE the gate**, because the gate is about a
  // course: `courseAccessFor()` reads that course's own `planKeys`, so
  // resolving it afterwards would mean gating on whichever course happened to
  // be in scope. `courseBySlug()` answers `null` for "there is none" and for
  // "its row does not hold" alike — a learner gets the same not-found either
  // way, and the operator's surface is where the two differ.
  const { course: courseSlug, unit: slug } = await params;
  const course = await courseBySlug(courseSlug);
  if (!course) notFound();

  const memberId = session.user.id;
  const { entitled, startedAt } = await courseAccessFor(memberId, session.user.role, course);
  if (!entitled) {
    redirect(`/plans?course=${encodeURIComponent(course.slug)}`);
  }

  const unit = await unitBySlug(slug);
  // A slug nobody wrote is a 404, and so is one whose block vanished — a unit
  // with no block cannot be placed, and rendering it would put a lesson outside
  // the course.
  if (!unit) notFound();
  const block = await blockById(unit.blockId);
  if (!block) notFound();

  // 🚨 **And the block has to belong to the course in the URL.** Unit slugs are
  // unique across the app (`../../schema.ts` says why: the learners' rows key
  // on the bare string), so `unitBySlug()` finds a lesson whatever course
  // stands in the path — which means without this line the gate above is
  // decided by one course and the CONTENT by another. Somebody who bought the
  // cheap course could read the expensive one's lessons by editing one segment
  // of the URL. Not a redirect: from outside, a lesson that is not in this
  // course and a lesson that does not exist are the same thing.
  if (block.courseId !== course.id) notFound();

  const now = new Date();
  if (!isUnlocked(block.releaseAfterDays, startedAt, course.shape!, now)) {
    // ⚠️ **It says WHY, now.** The redirect was wordless until 2026-08-17: a
    // learner who followed a link to a week that has not opened landed back on
    // the overview with nothing changed on the page and no idea what had just
    // happened. The parameter is a REFERENCE — the overview looks the slug up
    // in its own lessons and builds the sentence from the row, so nothing a
    // stranger types into the URL becomes text on the page.
    redirect(
      `/dashboard/course/${encodeURIComponent(course.slug)}?locked=${encodeURIComponent(unit.slug)}`,
    );
  }

  // 🚨 **Both conditions, and this line is where they meet.** A hand-in surface
  // exists exactly when the course is a `workshop` AND this lesson carries a
  // prompt — `docs/courses.md` describes submissions under shape 3 alone, and
  // `taskPrompt` non-null IS "this lesson asks for one" (`../../schema.ts`).
  // Either one missing and there is nothing here: no task, no form, and no read
  // of the submissions table at all.
  const taskPrompt = course.shape! === "workshop" ? unit.taskPrompt : null;

  // 🚨 **Where am I, and what comes next** — the two questions a lesson page
  // could not answer until 2026-08-17. It rendered one lesson with a way back
  // to the overview and nothing else: after ticking a lesson off, the learner
  // went back, found their place in the list again by eye, and clicked on. In a
  // course of thirteen lessons that is twelve trips through a list.
  //
  // The outline is read for the course this page has ALREADY gated (the two
  // checks above: the course's own gate, and the block belonging to it), so no
  // lesson of a course somebody has not bought can reach this array.
  const outline = await courseOutline(course.id);
  const { previous, next } = neighbours(
    unitRefs(outline, startedAt, course.shape!, now),
    unit.slug,
  );
  // Which lesson of which block this is — the same two numbers the overview
  // orders by, said in words. Read off the OUTLINE rather than off `block`:
  // `blockById()` answers with the bare row, which carries no units, and
  // loading them a second time to count to three would be a query for a
  // subtitle.
  const siblings = outline.find((entry) => entry.id === block.id)?.units ?? [];
  const inBlock = siblings.findIndex((sibling) => sibling.slug === unit.slug) + 1;

  const [media, completed, submission] = await Promise.all([
    // 🚨 The access check is inside `unitMedia()` — `mayAccess()` before
    // `mediaUrlFor()`, so this page cannot mint an address without it.
    unitMedia(unit, { memberId, role: (session.user.role) ?? null }),
    completedSlugsFor(memberId),
    // Not merely unrendered — not FETCHED. A page that read the row and then
    // decided not to show it would be a page that queries somebody's private
    // writing on every lesson in every course shape.
    taskPrompt === null ? null : submissionFor(memberId, unit.slug),
  ]);

  const format = await getFormatter();

  // ⚠️ Parsed BEFORE the card decides to exist. A body that is only whitespace —
  // which a content file can carry and the admin textarea can produce — is
  // truthy but yields no blocks, and the card would then be an empty bordered
  // box between the video and the worksheet.
  const bodyBlocks = unit.body ? parse(unit.body) : [];

  return (
    <>
      <PageHeader title={unit.title} />

      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/dashboard/course/${encodeURIComponent(course.slug)}`}>
            <ArrowLeft aria-hidden="true" />
            {t("backToCourse")}
          </Link>
        </Button>
        {/* Where this lesson sits. The block's TITLE, because that is what the
            learner reads on the overview ("Woche 2 — Das Angebot"), and the
            two numbers behind it because a course is worked through rather
            than browsed. `siblings` is empty only for a block whose units
            vanished between two queries, and then the count is left off rather
            than printed as "0 von 0". */}
        {siblings.length > 0 ? (
          <p className="text-muted-foreground text-sm">
            {t("lessonWhere", {
              block: block.title,
              index: inBlock,
              total: siblings.length,
            })}
          </p>
        ) : null}
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

        {bodyBlocks.length > 0 ? (
          <Card id={slugifyAnchor(unit.slug)} className="scroll-mt-20">
            {/* No flex column here — `<LegalBody>` brings its own, and two
                nested ones only mean the outer `gap` never applies. */}
            <CardContent className="pt-6">
              {/* DATA, not HTML. `parse()` hands back blocks and `<LegalBody>`
                  turns them into React elements — nothing here goes through
                  `dangerouslySetInnerHTML`, so there is no sanitiser to keep
                  current. That is the same security story the legal pages have,
                  and it is why the promise in `schema.ts` ("Markdown-ish,
                  rendered through the template's own subset parser") can be kept
                  without opening a place to put script.

                  ⚠️ It is the CORE's parser, not a second one in this module.
                  `components/member-text.tsx` next door deliberately renders no
                  markdown at all and must stay that way — it shows text a MEMBER
                  typed, where a clickable foreign link is a phishing surface.

                  ⚠️ A lesson body has TWO writers, and links are allowed here
                  because both are the operator's: the admin form behind
                  `requireOwner()`, and a repo content file applied by
                  `content-apply` / `content-publish` with a `SETUP_KEY`
                  (`content/appliers/course.mjs`). Neither is a stranger. A third
                  writer would have to re-open this question.

                  ⚠️ Reported 2026-08-12: this was a hand-rolled paragraph split,
                  which broke twice over. It rendered `- **Quelle** — …` verbatim,
                  asterisks and all; and because the admin form is a `<textarea>`,
                  a blank line arrives as CRLF and holds no two consecutive
                  newlines at all — so every lesson written in a browser was ONE
                  paragraph. `member-text.tsx:26-30` carries that same measurement
                  for the same bug in the same module. `parse()` splits on
                  `/\r?\n/` and has its own test for it. */}
              <LegalBody blocks={bodyBlocks} />
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

        {/* ── Where to go from here ──────────────────────────────────────
            🚨 **The next lesson is a LINK exactly while it is open**, which is
            the same rule the overview's list keeps and for the same reason:
            `page.tsx` (this file) sends a locked lesson straight back, so a
            link into one would bounce off itself.

            A shut next lesson is not silence either — it is the sentence that
            says a week is waiting, without a date, because the date belongs to
            the overview where the whole clock is on screen. Nothing at all is
            printed only at the true end of the course, which is the one place
            where "there is no next lesson" is the honest answer. */}
        {previous || next ? (
          <nav
            aria-label={t("lessonNavLabel")}
            className="flex flex-wrap items-center justify-between gap-3 border-t pt-4"
          >
            <div>
              {previous && previous.unlocked ? (
                <Button asChild variant="outline">
                  <Link
                    href={`/dashboard/course/${encodeURIComponent(course.slug)}/${encodeURIComponent(previous.slug)}`}
                  >
                    <ArrowLeft aria-hidden="true" />
                    <span className="max-w-[16rem] truncate">{previous.title}</span>
                  </Link>
                </Button>
              ) : null}
            </div>
            <div>
              {next ? (
                next.unlocked ? (
                  <Button asChild>
                    <Link
                      href={`/dashboard/course/${encodeURIComponent(course.slug)}/${encodeURIComponent(next.slug)}`}
                    >
                      <span className="max-w-[16rem] truncate">{next.title}</span>
                      <ArrowRight aria-hidden="true" />
                    </Link>
                  </Button>
                ) : (
                  <p className="text-muted-foreground text-sm">{t("lessonNextLocked")}</p>
                )
              ) : null}
            </div>
          </nav>
        ) : null}
      </div>
    </>
  );
}
