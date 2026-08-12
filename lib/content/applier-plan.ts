// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 What a `content-apply` against THIS environment WOULD do — asked of the
// appliers themselves, and answered without writing a row.
//
// ── The third export, and why it had to exist ──────────────────────────────
// An applier exports `apply(sql, helpers)` and `present(sql)` and nothing else.
// `present()` counts rows that ARE there; neither can say what WOULD be created
// or changed. So the convention gains a THIRD, OPTIONAL export — `plan(sql)`,
// read-only, no helpers (`docs/content.md`):
//
//     export async function plan(sql) {
//       return { created: 12, reasserted: 43, subjects: ["block-1", …], problems: [] };
//     }
//
// **Optional, and its absence is an ANSWER.** An applier without one is reported
// as "this applier does not say what it would change", with its label — never as
// `created: 0, changed: 0`. Zero and unknown are the two numbers an operator
// would act on differently, and collapsing them here would rebuild, inside the
// plan, the silence `_appliers.mjs` and `presence.ts` were both rewritten to end.
//
// ── The shortcut that was refused, and the measurement behind it ───────────
// The obvious way to get a plan out of the existing contract is to run `apply()`
// inside a transaction and roll it back. It needs no new export, and it is wrong
// three times over:
//
//   · **It runs arbitrary customer code against PROD.** An applier is a plain
//     `.mjs` loaded by path. Nothing constrains it to `sql`: it may `fetch()`,
//     write a file, or hold a lock on a table for the length of a big upsert. A
//     rollback contains ROWS and nothing else.
//   · **It fails for exactly the condition it exists to report.** `apply()`
//     resolves media through `mediaIdFor()`, which throws BY NAME when the row
//     is missing (`scripts/content/apply.mjs`). Publishing into an environment
//     whose product media have not landed yet is the ordinary first case — and
//     the rollback probe would answer *"the plan failed"* where the plan should
//     answer *"7 files are missing, here they are"*.
//   · **It makes "read-only" a word about the outcome.** Under a rollback,
//     "nothing was written" is true about the final state and false about the
//     act. The claim this file makes is the stronger one.
//
// ── Read-only is the DATABASE's refusal, not our promise ───────────────────
// Every `plan(sql)` runs inside a transaction whose first statement is
// `set transaction read only`, so an `insert`, `update` or `delete` inside a
// planner is refused by Postgres with its own error — reported as that applier's
// problem — rather than by our good intentions. The transaction is then rolled
// back unconditionally: a planner that somehow wrote in a way the flag permits
// still leaves nothing behind.
//
// ── What is NOT handed to a planner ────────────────────────────────────────
// `apply()` gets `{ mediaIdFor }`. `plan()` gets nothing, for the middle reason
// above: `mediaIdFor` throws on a missing row, so handing it to a planner would
// make the plan fail on the state it is there to describe. What is missing in
// the target's media store is answered ONCE, by `productMediaPresence()`, for
// the whole app — not per applier, and not twice.

import { pathToFileURL } from "node:url";

import { applierSql } from "@/db";

/** Past this many, `subjects` carries a count instead of a list. */
export const SUBJECTS_CAP = 20;

/**
 * The little of a postgres.js handle this walker uses.
 *
 * Structural rather than `postgres.Sql`, because the appliers are bare `.mjs`
 * with no types at all and the only two things asked of the handle are `begin()`
 * and a tagged template inside it.
 */
export type PlanTag = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;

export interface PlanSql {
  begin<T>(fn: (tx: PlanTag) => Promise<T>): Promise<T>;
}

/**
 * What ONE applier says it would do — or why it did not say.
 *
 * 🚨 `answered: false` is a FIELD, not a zero, and everything downstream (the
 * `content_publish` tool, Story 34.3's apply, Epic 35's "new / would change /
 * untouched") depends on being able to tell "cannot say" from "nothing to do".
 * The numbers are therefore ABSENT rather than zero whenever `answered` is
 * false, and such an entry is excluded from the sums instead of contributing
 * zeros to them.
 *
 * Three states, and each has its own shape:
 *
 *   answered: true    `created` / `reasserted` / `subjects` are this applier's own
 *   answered: false + `note`        it exports no `plan(sql)` — a legitimate state
 *   answered: false + `problems`    it has one and it failed, or could not be loaded
 */
export interface ApplierPlan {
  /**
   * The applier's label — `courses:course.mjs` for a module's, bare for the
   * core's. Never the file PATH: that is absolute, machine-specific, and it
   * changes under `output: "standalone"`.
   */
  readonly label: string;
  /** The module that brought it, or null for the core's own. */
  readonly module: string | null;
  readonly answered: boolean;
  /** Rows this applier would create. Absent when `answered` is false. */
  readonly created?: number;
  /** Rows it would re-assert — they exist and would be written over. */
  readonly reasserted?: number;
  /** Identifying slugs, capped — see `capSubjects()`. */
  readonly subjects?: readonly string[];
  /** What this applier found wrong, plus whatever stopped it answering. */
  readonly problems?: readonly string[];
  /** A word for a reader about a legitimate state. Never a problem. */
  readonly note?: string;
}

export interface ApplierPlanOptions {
  /** The app root. `process.cwd()` in the running app — see `presence.ts`. */
  readonly root?: string;
  /** The installed module ids, for a test that has no `config/modules.json`. */
  readonly ids?: string[];
  readonly sql?: PlanSql;
}

/**
 * Forty slugs in a tool answer is a payload nobody reads and a transcript
 * nobody wants to pay for — the shape `security-check`'s `Where:` line uses.
 */
export function capSubjects(subjects: readonly string[], cap = SUBJECTS_CAP): string[] {
  if (subjects.length <= cap) return [...subjects];
  return [...subjects.slice(0, cap), `and ${subjects.length - cap} more`];
}

/**
 * Every applier's answer, in the order `content-apply` would run them.
 *
 * 🚨 **The enumeration is NOT wrapped in a try/catch, and that is the single
 * most important line in this file.** `applierSources()` throws on an unreadable
 * directory — `ENOENT` included, because "not carried into a built output" IS
 * `ENOENT` — and on a module declaring `appliers` with no `.mjs` in it. A catch
 * here that produced an empty list would answer *"0 applier(s) would run"* for
 * an app whose appliers were deleted, which rebuilds inside the plan exactly the
 * silence `scripts/content/_appliers.mjs` was rewritten to end. The caller turns
 * this throw into a refusal carrying the sentence.
 */
export async function applierPlans(options: ApplierPlanOptions = {}): Promise<ApplierPlan[]> {
  const root = options.root ?? process.cwd();
  const sql = options.sql ?? (applierSql as unknown as PlanSql);
  const { applierSources } = await import("@/scripts/content/_appliers.mjs");

  const plans: ApplierPlan[] = [];
  for (const source of applierSources(root, options.ids)) {
    plans.push(await planOne(sql, source));
  }
  return plans;
}

async function planOne(
  sql: PlanSql,
  source: { label: string; file: string; module: string | null },
): Promise<ApplierPlan> {
  const { label, file, module } = source;

  let loaded: { plan?: unknown };
  try {
    // 🚨 **The bundler has to be told to keep its hands off**, exactly as in
    // `applier-presence.ts` — this runs inside the Next bundle, and a fully
    // dynamic specifier there answers "Cannot find module as expression is too
    // dynamic". A file URL rather than a bare path: a native dynamic import of
    // an absolute path is deprecated on POSIX and fails outright on Windows,
    // and this template ships to three systems.
    loaded = (await import(
      /* webpackIgnore: true */ /* turbopackIgnore: true */ /* @vite-ignore */
      pathToFileURL(file).href
    )) as { plan?: unknown };
  } catch (error) {
    return {
      label,
      module,
      answered: false,
      note: `${label} could not be loaded, so it said nothing about what it would change`,
      // Prefixed with the label, like `normalisePlan()`'s — the tool aggregates
      // every applier's problems into one list, and a Postgres sentence with no
      // applier in front of it is a finding nobody can act on.
      problems: [`${label}: ${messageOf(error)}`],
    };
  }

  if (typeof loaded.plan !== "function") {
    // Not a defect, and the sentence says so. An applier written before this
    // export existed still APPLIES correctly; what it cannot do is say in
    // advance what it would write.
    return {
      label,
      module,
      answered: false,
      note:
        `${label} exports no plan(sql) — what it would create and change is not knowable ` +
        `from here. Its rows still travel with content-apply; the optional third export is ` +
        `what would let a plan report them (docs/content.md).`,
    };
  }

  const plan = loaded.plan as (tx: PlanTag) => Promise<unknown>;

  let raw: unknown;
  try {
    raw = await readOnlyTransaction(sql, (tx) => plan(tx));
  } catch (error) {
    // Includes the needle: an `insert` inside a planner comes back as Postgres's
    // own "cannot execute INSERT in a read-only transaction". The walk carries
    // on — one broken planner must not cost the report for the others.
    return {
      label,
      module,
      answered: false,
      note: `${label} has a plan(sql) and it failed — which is not "nothing to do"`,
      problems: [`${label}: ${messageOf(error)}`],
    };
  }

  return normalisePlan(label, module, raw);
}

/**
 * A planner's return value, taken at face value where it is a report and
 * refused where it is not.
 *
 * A planner that answers something this cannot read is `answered: false` with a
 * problem — never `created: 0`. Same ruling as everywhere else on this path: an
 * answer nobody can read is "I could not look".
 */
export function normalisePlan(label: string, module: string | null, raw: unknown): ApplierPlan {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      label,
      module,
      answered: false,
      note: `${label}'s plan(sql) returned no report`,
      problems: [
        `${label}: plan(sql) must return { created, reasserted, subjects, problems } — ` +
          `got ${describe(raw)} (docs/content.md)`,
      ],
    };
  }

  const report = raw as Record<string, unknown>;
  const problems = strings(report.problems).map((problem) => `${label}: ${problem}`);

  return {
    label,
    module,
    answered: true,
    created: count(report.created),
    reasserted: count(report.reasserted),
    subjects: capSubjects(strings(report.subjects)),
    ...(problems.length > 0 ? { problems } : {}),
  };
}

/**
 * One read-only transaction, rolled back unconditionally.
 *
 * The rollback is a THROW rather than a `return`, because postgres.js commits a
 * `begin()` whose callback resolves. The sentinel carries the planner's answer
 * back out, so the report survives a transaction that never committed — which is
 * the whole arrangement: the answer travels, the transaction does not.
 *
 * 🚨 **Exported for ONE caller, and it is not an invitation.**
 * `lib/content/publish.ts` asks each applier's `plan()` the same way, right
 * before it writes, so that a publish can say how many of its rows were NEW
 * rather than reporting one undivided count. Giving it a second read-only
 * mechanism of its own is how one of the two eventually stops sending
 * `set transaction read only` first — and that flag is the whole guarantee.
 */
export async function readOnlyTransaction<T>(
  sql: PlanSql,
  work: (tx: PlanTag) => Promise<T>,
): Promise<T> {
  try {
    await sql.begin(async (tx) => {
      // 🚨 The FIRST statement, and the reason "nothing was written" is a
      // property of this transaction rather than a claim about the planner.
      await tx`set transaction read only`;
      throw new PlanDone(await work(tx));
    });
  } catch (error) {
    if (error instanceof PlanDone) return error.value as T;
    throw error;
  }
  // Only reachable if something swallowed the sentinel. Refusing beats
  // inventing a report about a production database.
  throw new Error("the read-only transaction ended without handing back a report");
}

class PlanDone extends Error {
  constructor(readonly value: unknown) {
    super("plan complete — rolling back");
    this.name = "PlanDone";
  }
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function describe(value: unknown): string {
  return value === null ? "null" : Array.isArray(value) ? "an array" : typeof value;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
