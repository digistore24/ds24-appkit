// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The daily hand-in digest — the one thing this module does with no request
// behind it.
//
// A workshop (shape 3) sells one promise: *a person reads what you send in*.
// Its failure mode is SILENCE, and from the outside silence looks exactly like
// "nothing is waiting". Since 6.3 the operator has had a dot in the sidebar
// (`./module.ts` → `badges`), and the dot has one property: it is only there
// while the operator is already in the app. `docs/cron.md` writes the general
// form of that out — *a state that only a request can discover is a state
// nobody discovers* — and this job is that sentence applied to the queue.
//
// What the mail adds that the dot cannot: it reaches the operator where they
// already read, and it carries a NUMBER — one waiting and forty waiting are
// different days, and a dot cannot tell them apart.
//
// ── 🚨 It ships DISABLED, and that has to be said HERE ─────────────────────
// A job with no entry in `config/cron.json` inherits `JOB_DEFAULTS` —
// enabled, daily — so leaving it out is not "off", it is "on tomorrow". And a
// module CANNOT write that entry: `config/cron.json` belongs to the core, and an
// entry naming `courses-digest` would name a job every app without this module
// does not have (`lib/cron/rules.mjs` reports exactly that, and
// `lib/cron/rules.test.ts` fails the shipped template on it). So the posture is
// declared where the job is, as `enabledByDefault: false` below — the same place
// and the same reason as `modules/community/cron.ts`. **A job that mails does
// not start on its own.** The operator turns it on by ADDING
// `"courses-digest": { "enabled": true, "everyMinutes": 720 }` to
// `config/cron.json`; their file wins in both directions, and only its silence
// consults this file.
//
// ⚠️ Twelve hours for a once-a-day mail is deliberate, not a typo. Due-ness is
// measured from the last FINISH so a run drifts later every day, while
// `digestKey()` is nailed to the UTC calendar day — at 1440 the run eventually
// crosses midnight and one calendar day gets no mail. At 720 every window is
// attempted twice, the marker still lets exactly one through, and the second
// attempt says `already notified today`. `docs/cron.md` writes it out as the
// general rule for a windowed key.
//
// ── The switch is read FIRST, before any query ─────────────────────────────
// Same shape and same argument as `./module.ts`, where it is written out at
// length: a switched-off course costs zero database round-trips and sends
// nothing at all.
//
// ⚠️ **And it is the NARROW question — `isCourseSwitchedOn()`, not
// `isCourseEnabled()`.** `./lib/config.ts` names this file as the second of its
// two lawful callers, with the criterion: neither caller serves anybody a
// course. In the `brokenConfig` state the hand-ins keep arriving, and the page
// this mail points at is the one that DIAGNOSES that state rather than refusing
// in it. Asking the wide question would silence the report in exactly the state
// the operator most needs to hear about.
//
// There is deliberately no check on `shape === "workshop"` either. Rows survive
// a change of shape, `courseShape()` THROWS in the broken state — the state this
// job is meant to survive — and the count answers the question anyway: a
// self-study course has nought waiting hand-ins, so the job sends nothing and
// says so. The price is one indexed `count()` a day.
//
// ── What this job may READ, and what it may not ────────────────────────────
// 🚨 **`waitingSubmissions()` does not appear here, and must not.** It carries
// `memberName` and `memberEmail`; cron rule 2 lets nothing but numbers reach
// `cron_runs.lastDetail`, and the mail is under the same rule for a second
// reason (below). The count is `waitingCount()` and nothing else touches the
// table. `./lib/cron-boundary.test.ts` reads this file as text and fails on the
// list readers by name.
//
// ⚠️ **`hasWaitingSubmission()` is not called either, on purpose.** It answers
// "is there anything", which the count already answers with `=== 0`; asking both
// would be two round-trips for one answer. The next session should not
// "complete" this by adding it.
//
// ── What the mail contains, and what it never will ─────────────────────────
// A NUMBER and a LINK. Not a name, not an address, not a member id, not a
// lesson title, not one word anybody handed in, and not the date of any single
// hand-in. The reason is not cron rule 2 (that is about `cron_runs`) but the
// sharper one `docs/community.md` states about digests: a mail is delivered to
// an inbox this app does not control, stored on a mail provider's disk, and read
// on whichever device holds that inbox. And `./lib/no-roster.test.ts` carries
// the course's own half of it — WHO is working through WHICH lesson is purchase
// information. A waiting list in a mail would be the roster this module refuses
// to have, in the one channel no code here can guard.
//
// No age of the oldest hand-in, no urgency, no escalation: "somebody has been
// waiting six days" is one step closer to "who" than "twelve are waiting", and
// it buys nothing the number does not.
//
// ── The channel is the core's, and this job builds none of it ──────────────
// `notifyOperators()` (`@/lib/notify/operators`) owns the preference, the owner
// query, the transport check, one mail per recipient and the send marker. This
// job supplies the KEY (which carries the window — `digestKey()` in `./rules`)
// and the WORDS, and reads back `{ sent, recipients, reason }` for its own line.
// It builds no second marker: two markers would be two truths about one thing,
// and the failure mode is a duplicate mail nobody notices.
//
// It swallows nothing (rule 3). If the transport was there and failed,
// `notifyOperators()` throws a COUNT and this job lets it through, so
// `cron_runs` records `failed` and the next window tries again.
//
// ⚠️ The type comes from `@/lib/cron/types`, never from `@/lib/cron/jobs` — that
// would close a cycle (`jobs.ts` → `lib/modules/cron-registry.ts` → this file).
import type { CronJob } from "@/lib/cron/types";
import { notifyOperators } from "@/lib/notify/operators";

import { DIGEST_JOB_ID, digestKey } from "./rules";
import { isCourseSwitchedOn } from "./lib/config";
import { waitingCount } from "./lib/manage";

/** Where the mail points. The operator's queue, built in 6.2. */
const QUEUE_PATH = "/dashboard/admin/course/submissions";

/**
 * The absolute address of the queue, or `null` when this app has no usable one.
 *
 * Same rule and same reason as `legalFooterLinks()` in `lib/email.ts`: a mail
 * needs an absolute base, and without a usable `APP_URL` there is none to be
 * had. A relative path in a mail body is a dead string, so the button is left
 * off entirely — the number is the message, and it survives the missing link.
 */
function queueUrl(): string | null {
  const base = process.env.APP_URL?.trim();
  if (!base || !/^https?:\/\//i.test(base)) return null;
  return new URL(QUEUE_PATH, base).toString();
}

const jobs: readonly CronJob[] = [
  {
    id: DIGEST_JOB_ID,
    describe:
      "Tell the operator once a day how many hand-ins are waiting for an answer. " +
      "Names nobody: a count and a link, never a learner or a lesson. " +
      'Ships DISABLED — set "enabled": true for it in config/cron.json.',

    // 🚨 See the header. No entry in `config/cron.json` means enabled-and-daily,
    // a module may not write that file, and this one MAILS — so the posture is
    // declared here and the operator's one flag is a decision rather than a
    // default.
    enabledByDefault: false,

    async run({ now }) {
      // ── 1. The switch, before any query ─────────────────────────────────
      // Zero round-trips and nothing sent when the course is off. The narrow
      // question on purpose — `./lib/config.ts` names this caller and says why.
      if (!isCourseSwitchedOn()) return "course is switched off — nothing checked";

      // ── 2. The number, and nothing but the number ───────────────────────
      const waiting = await waitingCount();
      // `=== 0` IS the existence question. No second query for it.
      if (waiting === 0) return "no hand-in is waiting";

      // ── 3. The message, through the core's channel ──────────────────────
      const url = queueUrl();
      const { sent, reason } = await notifyOperators({
        // The window is in the key, or the digest goes out once and never
        // again. `now` is the tick's clock — never `new Date()` in a job.
        key: digestKey(now),
        now,
        compose: (t) => ({
          // The root translator: this module's namespaces are merged at the top
          // level, so its keys are addressed in full.
          subject: t("coursesAdmin.digestSubject", { count: waiting }),
          heading: t("coursesAdmin.digestHeading", { count: waiting }),
          paragraphs: [t("coursesAdmin.digestBody", { count: waiting })],
          ...(url ? { cta: { label: t("coursesAdmin.digestCta"), url } } : {}),
        }),
      });

      // ── 4. One line of numbers, and the three states told apart ─────────
      // "Green because it sent" and "green because it skipped" are the same
      // colour, so the line says which. `reason` is a code from a closed union
      // — never an address, never a sentence somebody wrote.
      if (reason === "alreadySent") {
        return `${waiting} hand-in(s) waiting, already notified today`;
      }
      if (reason) {
        return `${waiting} hand-in(s) waiting, no notification sent (${reason})`;
      }
      // No partial case to report: `notifyOperators()` attempts every recipient
      // and THROWS a count if any delivery failed, so a null reason means all of
      // them went out.
      return `${waiting} hand-in(s) waiting, ${sent} notification(s) sent`;
    },
  },
];

export default jobs;
