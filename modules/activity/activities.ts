// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// **The interactive elements this app has. Nothing else.**
//
// One list for EVERY interactive element — the free, unlimited practice
// element as much as the three-attempt exam. "Attempt-limited" is a field
// (`maxAttempts`), never the framework: a hand-rolled grading path built
// beside this registry "because it is only practice" is a second place that
// must keep answers server-side, and the second one is where they leak.
//
// One list the app edits — exactly the role `lib/ai/companions.ts` plays, and
// deliberately that model rather than `lib/cron/jobs.ts`, which ships five
// real jobs: an activity the template put in front of a vendor's own
// customers would be an activity nobody chose. So this ships **empty**, and a
// page renders
// the surface (story 14.3 builds it) for each entry an app adds.
//
// ── The three rules that make an element worth paying for ──────────────────
//
// 1. 🚨 **IDOR.** `subject` is a string the customer's browser sent — it comes
//    off a URL segment or a component prop, and it is theirs to change.
//    **Every read inside `load()` and `grade()` must be scoped by
//    `memberId`.** Return `null` when there is no such subject FOR THIS
//    MEMBER — deliberately the same answer as "it belongs to somebody else",
//    so nothing here can be used to find out which subjects exist. And
//    `grade()` owns the same rule: THROW for a subject that does not exist
//    for this member (the worked example does) — a grade() that shrugs
//    mints one result row per invented string.
//
// 2. 🚨 **`requiresPlan` and `maxAttempts` are registry entries, not props.**
//    A gate the browser sends is no gate: the surface takes an activity id
//    and a subject from the client, and everything else comes from this list.
//
// 3. 🚨 **The solution never leaves the server, and neither does the
//    verdict.** A submission from a browser is *data about an attempt*, never
//    the result of one — `grade()` is the only place a score comes into
//    being, and `load()` returns what the browser may SEE, which never
//    includes the answer key. An activity that ships its solutions to the
//    client so the browser can mark the answer has built a test that renders
//    correctly, returns 200, passes vitest and passes `ux-check` — and is
//    worthless the day one buyer opens the dev tools. (The same shape as the
//    companion rule "an instruction sent by the browser is the entire prompt
//    handed to the customer", applied to answers instead of instructions.)
//
//    **And `state` is browser-visible**: the resume point your grade()
//    stores ships to the client on the next load. Per-answer correctness in
//    `state` is the same free probe as a scored checkpoint — store positions,
//    never judgements.
//
//    The quiet corner of the same rule: **checkpoints leak too.** A verdict
//    with `final: false` never counts an attempt — so on a judged element,
//    a checkpoint verdict carrying a score is a free probe, as many as the
//    rate limit allows. Put scores on FINAL verdicts; a checkpoint carries
//    the resume point and at most neutral feedback.
//
// ── The `subject` convention ───────────────────────────────────────────────
// `subject` is **this app's own stable slug for the thing the element sits
// on** — a lesson, a challenge day, a week: `"lektion-3"`, `"woche-7"`. Never
// a database row id (a slug survives a re-seed; an id does not), and **the
// same string passed to `<CompanionPanel subject=…>`** for that unit — which
// is what lets a lesson's coach and a lesson's game share coordinates without
// either side knowing the other exists. Results are keyed by
// `(memberId, activityId, subject)` in `activity_results`.
//
// A worked example, to copy rather than to uncomment — it references tables
// that do not exist here:
//
// ```ts
// export const ACTIVITIES: readonly Activity[] = [
//   {
//     id: "silben-spiel",
//     requiresPlan: "kurs_komplett",   // a key from config/digistore-products.json
//     costsTokens: 0,
//     maxAttempts: null,               // a game is replayable
//     async load({ memberId, subject }) {
//       // ⚠️ scoped by memberId — and the six words go out WITHOUT their
//       // syllable boundaries: the split is the solution, and the solution
//       // stays here.
//       const round = await db.query.gameRounds.findFirst({
//         where: and(eq(gameRounds.memberId, memberId), eq(gameRounds.subject, subject)),
//       });
//       if (!round) return null;
//       return { words: round.words.map((w) => w.text) };
//     },
//     async grade({ memberId, subject, submission, previous }) {
//       const round = await db.query.gameRounds.findFirst({ /* same scope */ });
//       if (!round) throw new Error("no such round");
//       const answers = parseAnswers(submission);        // data, never a verdict
//       const done = answers.length === round.words.length;
//       return {
//         final: done,
//         // The score only on the FINAL verdict — a scored checkpoint is a
//         // free probe (see rule 3).
//         ...(done
//           ? { score: countCorrectSplits(round.words, answers), maxScore: round.words.length }
//           : {}),
//         state: { answered: answers.length },           // the resume point
//       };
//     },
//   },
// ];
// ```
import type { ActivityVerdict, StoredResult } from "./rules";

export interface Activity {
  /**
   * Stable, `[a-z0-9-]`, at most 40 characters — `activityProblems()` refuses
   * anything else. It travels as a prop from a client component and is what a
   * vendor writes into `docs/app.md`, so it is an identifier, not a label.
   */
  id: string;
  /** A product key that gates it, or `null` for every signed-in member. */
  requiresPlan: string | null;
  /** Tokens one GRADED submission costs. `0` = not metered. A refused attempt never charges. */
  costsTokens: number;
  /** Finalised attempts allowed, or `null` for unlimited. Checkpoints never count. */
  maxAttempts: number | null;
  /** Fraction of `maxScore` that counts as passing. Omit for elements that do not judge. */
  passMark?: number;

  /**
   * What the browser may see when the element loads — and nothing else. Runs
   * on the server; `null` means "no such subject for this member" (see rule 1).
   */
  load(ctx: { memberId: string; subject: string }): Promise<unknown | null>;

  /**
   * THE VERDICT. Runs on the server, and nowhere else — see rule 3. The
   * `submission` is whatever the browser sent, to be treated as untrusted
   * data; `previous` is this member's stored result, for activities whose
   * grading depends on where they left off.
   */
  grade(ctx: {
    memberId: string;
    subject: string;
    submission: unknown;
    previous: StoredResult | null;
  }): Promise<ActivityVerdict>;
}

/**
 * Every interactive element this app has.
 *
 * It ships **empty** — see the header for why, and for the worked example.
 */
export const ACTIVITIES: readonly Activity[] = [];

/** The entry for an id, or `null` — the registry is the only source, never a prop. */
export function findActivity(id: string): Activity | null {
  return ACTIVITIES.find((a) => a.id === id) ?? null;
}
