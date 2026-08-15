// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The guide has to know what the app can do.
//
// Whoever builds here is guided by an AI agent, and that agent knows exactly
// what the text in this project tells it: CLAUDE.md is loaded on every session,
// docs/ and .claude/skills/ are read when something points at them. A command,
// a skill or a config switch that appears in none of those does not exist as far
// as the agent is concerned — it will rebuild the feature by hand, or answer
// that the app cannot do it.
//
// That is the quiet half of the failure. The loud half is the opposite
// direction: a guide that names a skill or a doc which is no longer there sends
// the agent after a file it cannot open, and it says so to the user.
//
// So this test measures the guide against the inventory, in both directions:
//
//   1. every `node run.mjs` command is documented somewhere,
//   2. the skill list in CLAUDE.md is exactly what .claude/skills/ holds,
//   3. every docs/*.md is reachable from CLAUDE.md, the README or a skill,
//   4. no text points at a docs/ file that does not exist,
//   5. every config/*.json is named somewhere.
//
// It is the same kind of guard as scripts/portability.test.ts: it fails on a
// CLASS of mistake — "feature shipped, guide not touched" — rather than on an
// instance. Documentation drift cannot be caught by review, because the reviewer
// reads the diff, and the omission is precisely what is not in it.
//
// Not checked here: which pages ship under app/dashboard/ (that is
// scripts/session-start.test.ts, which needs it for the greeting).
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { blankCommentsFor } from "./lib/source-text.mjs";
import { JOURNEY } from "./dev/journey.mjs";
import { requiresFrom } from "./dev/update-plan.mjs";
import { availableModules } from "./modules/registry.mjs";

const ROOT = path.join(import.meta.dirname, "..");

/**
 * 🚨 A MIXED corpus through one door, so the blanking question is asked per
 * FILE. Almost everything here is markdown — `CLAUDE.md`, every `docs/*.md`,
 * every `SKILL.md` — where the prose IS the subject and blanking would delete
 * the sentences these checks are about. But `commands()` below reads `run.mjs`,
 * and that one is source: it slices from `const TASKS = {` and matches command
 * names out of the text, so a comment naming either would move the slice or add
 * a command that does not exist.
 *
 * Measured on 2026-08-15: `run.mjs` loses 247 comment lines this way and
 * `.template-version` — read through the same helper and then `JSON.parse`d —
 * comes back byte-identical, because a version stamp has nothing a comment
 * could look like.
 */
const read = (rel: string) => blankCommentsFor(rel, readFileSync(path.join(ROOT, rel), "utf8"));
const list = (dir: string, ext: string) =>
  readdirSync(path.join(ROOT, dir))
    .filter((entry) => entry.endsWith(ext))
    .sort();

// ── the inventory ───────────────────────────────────────────────────────────

/**
 * Every command `node run.mjs <name>` accepts.
 *
 * Read as text, not imported: run.mjs executes the command on import — that is
 * what the file is for. Each entry runs from its key to the next `\n  },` at
 * exactly two spaces of indent, so nested objects inside do not end it early.
 */
function commands(): string[] {
  const source = read("run.mjs");
  const table = source.slice(source.indexOf("const TASKS = {"));
  return [...table.matchAll(/^ {2}"?([a-z0-9_-]+)"?: \{([\s\S]*?)\n {2}\},/gm)]
    .filter(([, , body]) => !/hidden:\s*true/.test(body))
    .map(([, name]) => name)
    .sort();
}

const COMMANDS = commands();

/**
 * The skills THIS TEMPLATE shipped — never simply what is in the folder.
 *
 * 🚨 An app may hold skills that are not ours. A third party publishes one, the
 * agent drops it into `.claude/skills/`, and from that moment every assertion
 * below that reads the folder is asking our questions about somebody else's
 * file. Measured before this existed, with one throwaway folder planted: `names
 * exactly the skills that exist` and `names each skill folder once` both went
 * RED — and `CLAUDE.md` makes green the commit condition while
 * `.githooks/pre-commit` refuses on red, so installing a skill locked the
 * customer out of committing their own work. There is no way for them to fix it
 * either: the answer the test asks for is a line in `## The path`, and that
 * section is byte-capped below AND editing `CLAUDE.md` makes it `local-change`
 * for ever, which costs them every future update of the file.
 *
 * So the folder is filtered against `.template-version`, which is the record of
 * what shipped and therefore already the answer to "is this ours". A foreign
 * skill is not held to our path, our journey or our size caps — and it also
 * cannot SATISFY any of them, because it never enters `CORPUS` either: a
 * stranger's file may not be the reason a command counts as documented.
 *
 * ⚠️ Unreadable stamp ⇒ every folder counts as ours, which is what this file
 * did before. The fail-safe direction here is STRICTER, never laxer: a missing
 * stamp must not be a way to switch these checks off.
 */
function ourSkills(): string[] {
  const onDisk = readdirSync(path.join(ROOT, ".claude/skills")).sort();
  let shipped: Record<string, unknown>;
  try {
    shipped = JSON.parse(read(".template-version")).files ?? {};
  } catch {
    return onDisk;
  }
  const ours = onDisk.filter((skill) => `.claude/skills/${skill}/SKILL.md` in shipped);
  // A stamp that lists none of them is a stamp this code no longer understands,
  // and answering "then nothing is ours" would turn every check below green by
  // emptiness — the one outcome a test about omissions may never have. The
  // count guard in the inventory block is the backstop; this is the reason it
  // can be trusted to fire.
  return ours.length === 0 ? onDisk : ours;
}

const SKILLS = ourSkills();
const FOREIGN = readdirSync(path.join(ROOT, ".claude/skills"))
  .filter((skill) => !SKILLS.includes(skill))
  .sort();
const DOCS = list("docs", ".md");
const CONFIGS = list("config", ".json");

/** Everything the agent can end up reading. The keys are for the error message. */
const CORPUS = new Map<string, string>([
  ["CLAUDE.md", read("CLAUDE.md")],
  ["README.md", read("README.md")],
  ...DOCS.map((file): [string, string] => [`docs/${file}`, read(`docs/${file}`)]),
  ...SKILLS.map((skill): [string, string] => [
    `.claude/skills/${skill}/SKILL.md`,
    read(`.claude/skills/${skill}/SKILL.md`),
  ]),
]);

const GUIDE = CORPUS.get("CLAUDE.md")!;
const EVERYWHERE = [...CORPUS.values()].join("\n");

// A parse that quietly stops matching would turn every check below green — the
// worst possible outcome for a test whose whole job is to notice omissions.
describe("the inventory is readable at all", () => {
  it("finds the commands, skills, docs and configs", () => {
    expect(COMMANDS.length, "no commands parsed out of run.mjs").toBeGreaterThan(30);
    // 🚨 Also the backstop under `ourSkills()`: everything about the skills
    // below is asked of THIS list, so a filter that came out empty would make
    // the whole of section 2 and section 6 pass by describing nothing.
    expect(SKILLS.length, "no skills recognised as this template's own").toBeGreaterThan(10);
    expect(DOCS.length).toBeGreaterThan(5);
    expect(CONFIGS.length).toBeGreaterThan(3);
  });

  // 🚨 The exemption has to be legible, or it becomes a way for one of OUR
  // skills to fall silently out of every check below — drop its line from
  // `.template-version` and it would simply stop being asked about.
  //
  // What makes that impossible is that our guidance NAMES our skills: a folder
  // this file treats as a stranger's, while `## The path` or the journey points
  // at it, is not a stranger's at all — it is ours with a stale stamp, and the
  // repair is the stamp rather than this list. (The journey's own half of this
  // is `unknown` in section 6, which fires on the same fault from the other
  // side; here is where CLAUDE.md's path is held to it.)
  it("treats no skill of ours as a stranger's", () => {
    const claimed = FOREIGN.filter((skill) => new RegExp(`\`${skill}\``).test(GUIDE));
    expect(
      claimed,
      `not in .template-version, yet CLAUDE.md names ${claimed.join(", ")} — either ` +
        `this skill shipped with the template and the stamp is stale (run make sync), ` +
        `or it came from somewhere else and CLAUDE.md should not be pointing at it`,
    ).toEqual([]);
  });
});

// ── 1. commands ─────────────────────────────────────────────────────────────

/**
 * Commands that need no prose, with the reason. Everything else has to be
 * written down somewhere.
 *
 * This list is the decision, not the exception: whoever adds a command either
 * documents it or explains here, in one line, why nobody ever needs to be told
 * about it. "I did not get around to it" is not one of the reasons.
 */
const SELF_EXPLANATORY = new Map([
  ["help", "prints the list of commands itself"],
  ["env", "prerequisite of start/setup, never typed by hand"],
  ["db-up", "prerequisite of start, never typed by hand"],
  ["db-down", "the counterpart of db-up, same reason"],
  ["dev", "start with the log in the terminal — the README documents start"],
  ["typecheck", "the guides name `npm run typecheck`, which is the same thing"],
  ["lint", "the guides name `npm run lint`, which is the same thing"],
]);

describe("every command is documented", () => {
  const undocumented = COMMANDS.filter(
    (name) =>
      !SELF_EXPLANATORY.has(name) &&
      // The form an agent copies into a terminal, not the bare word: "cron",
      // "setup" and "errors" appear in running prose on nearly every page.
      !new RegExp(`run\\.mjs ${name}(?![a-z0-9-])`).test(EVERYWHERE),
  );

  it("names each one in CLAUDE.md, the README, a doc or a skill", () => {
    expect(
      undocumented,
      `documented nowhere: ${undocumented.join(", ")} — write it into a doc, ` +
        `or add it to SELF_EXPLANATORY with the reason`,
    ).toEqual([]);
  });

  it("keeps no reason for a command that is gone", () => {
    const stale = [...SELF_EXPLANATORY.keys()].filter((name) => !COMMANDS.includes(name));
    expect(stale, `run.mjs no longer has: ${stale.join(", ")}`).toEqual([]);
  });
});

// ── 2. skills ───────────────────────────────────────────────────────────────

describe("the skill list in CLAUDE.md is the truth", () => {
  // The ORDER is the only thing about the skills that lives nowhere else, so it is
  // the copy that carries the completeness proof. The descriptions are NOT here any
  // more: the frontmatter is already resident on every turn, and a second telling of
  // it was 5.4 kB that every session of every app paid for.
  const OPENS = "## The path";
  const CLOSES = "## Where guidance lives";
  const from = GUIDE.indexOf(OPENS);
  const to = GUIDE.indexOf(CLOSES);
  const block = from === -1 || to === -1 ? "" : GUIDE.slice(from, to);
  // Every backticked word in the section, kept only where it is a skill folder.
  // The section also backticks `node run.mjs journey` and the odd file name, and
  // neither is a claim about the path.
  const listed = [...new Set([...block.matchAll(/`([a-z0-9-]+)`/g)].map((m) => m[1]))]
    .filter((word) => SKILLS.includes(word))
    .sort();

  // 🚨 The one deliberate loss, written down so nobody discovers it as a surprise:
  // nothing below proves each skill's POSITION is the intended one. The gate proves
  // the list is COMPLETE, never that step 2.5 belongs after 2.4. The order is
  // generated from `scripts/dev/journey.mjs` by the factory's `journey-stamp.mjs`,
  // so the two files cannot disagree — but whether the data itself has the steps in
  // the right sequence is a human contract, and `journey.mjs` is where it is argued.

  it("finds the section in the form this test can read", () => {
    // A slice that came out empty would turn the two checks below green for the
    // worst possible reason, so the shape is asserted before the content: both
    // anchors present, in that order, and more than ten names inside.
    expect(from, `"${OPENS}" not found in CLAUDE.md`).not.toBe(-1);
    expect(to, `"${CLOSES}" not found in CLAUDE.md`).toBeGreaterThan(from);
    expect(listed.length, "no backticked skill names in that section").toBeGreaterThan(10);
  });

  it("names exactly the skills that exist", () => {
    // Both directions matter, and the filter above only weakens one of them: a
    // word that is not a skill drops out, so a LEFTOVER name can no longer be
    // caught here — `journey.mjs`'s own both-directions check does that, against
    // the folders. A MISSING skill still breaks this equality, which is the
    // direction that hides a whole guided step from the agent.
    expect(listed).toEqual(SKILLS);
  });

  it("stays an ordering rather than a second set of descriptions", () => {
    // The gate that replaces the deleted duplication. Thirty names, four phase
    // labels and the arrows between them fit in 1,800 bytes; thirty one-line
    // descriptions were 5,360 and could not. So this number is what makes the
    // deletion permanent — the next person who pastes a description back in has
    // to argue with a failing test rather than with a review comment.
    expect(
      Buffer.byteLength(block),
      "## The path has grown past an ordering — the descriptions belong in each " +
        "skill's own frontmatter, which is loaded on every turn anyway",
    ).toBeLessThanOrEqual(1_800);
  });
});

// ── 3. + 4. docs ────────────────────────────────────────────────────────────

// Top level only, deliberately: `docs/reports/security-2026-07-26.md` and its
// kind are dated output the gateways write, so neither their absence nor their
// number says anything about the guide.
const DOC_REF = /docs\/([a-zA-Z0-9._-]+\.md)/g;
const refsIn = (text: string) => [...text.matchAll(DOC_REF)].map((m) => m[1]);

/**
 * Docs that the customer's own work produces, not ones we ship. They are
 * missing in a fresh clone and that is correct — a skill writes them, and other
 * skills read them afterwards.
 *
 * The distinction is load-bearing in both directions: shipping one of these
 * would put our example text where the customer's own belongs, and treating a
 * shipped doc as generated would hide a broken link.
 */
const GENERATED = new Map([
  ["product-brief.md", "written by market-research, or minimally by build-app step 0 when the idea was already there"],
  ["app.md", "this app's own notebook — created by build-app, grown per feature"],
  ["design.md", "this app's visual identity — written by the skill design"],
  [
    "plan.md",
    "what is still TO be built — written by build-app step 1f, or by market-research phase 5; each line moves into app.md once it exists",
  ],
  [
    "go-to-market.md",
    "positioning, price, the channels chosen and the ones rejected, and the launch plan — written by go-to-market at the end of its run",
  ],
]);

describe("every doc can be found", () => {
  it("reaches each docs/*.md from CLAUDE.md, the README or a skill", () => {
    // A doc that only another unreferenced doc points at is unreachable too, so
    // this follows the links rather than just scanning everything at once.
    const roots = [...CORPUS].filter(([file]) => !file.startsWith("docs/"));
    const reached = new Set<string>();
    const queue = roots.flatMap(([, text]) => refsIn(text));
    while (queue.length > 0) {
      const file = queue.shift()!;
      if (reached.has(file)) continue;
      reached.add(file);
      const text = CORPUS.get(`docs/${file}`);
      if (text) queue.push(...refsIn(text));
    }

    const orphans = DOCS.filter((file) => !reached.has(file));
    expect(
      orphans,
      `nothing points at: ${orphans.map((f) => `docs/${f}`).join(", ")} — an agent ` +
        `never opens a file it was not told about. Mention it where it belongs ` +
        `(CLAUDE.md, or the doc/skill it goes with)`,
    ).toEqual([]);
  });

  it("points at no doc that does not exist", () => {
    // The same mistake as an assistant citing a handbook page nobody can open —
    // except here the agent quotes it to the person paying for the app.
    const dangling = [...CORPUS]
      .flatMap(([file, text]) => refsIn(text).map((ref) => ({ file, ref })))
      .filter(({ ref }) => !DOCS.includes(ref) && !GENERATED.has(ref));
    expect(
      dangling.map(({ file, ref }) => `${file} → docs/${ref}`),
      "these links lead nowhere",
    ).toEqual([]);
  });

  // No "ships no doc it declares as generated" test here, deliberately: that
  // invariant only holds for the PRISTINE template, before any app was built.
  // `docs/app.md` existing is `build-app` having done its job, not a defect —
  // an app that follows the golden path must not fail a check written against
  // the state it is supposed to leave behind. (A field-test session had to
  // delete this test mid-build; this comment is what keeps it deleted.)
  // GENERATED keeps its other job above: a link to `docs/app.md` from
  // CLAUDE.md is not flagged as dangling on a fresh clone.
});

// ── 5. config ───────────────────────────────────────────────────────────────

describe("every config file is named somewhere", () => {
  it("explains each config/*.json", () => {
    // These are the product's switches. One that no text mentions is a feature
    // the operator owns and the agent cannot find — it will build a second
    // switch of its own beside it.
    const unexplained = CONFIGS.filter((file) => !EVERYWHERE.includes(`config/${file}`));
    expect(unexplained, `not named anywhere: ${unexplained.join(", ")}`).toEqual([]);
  });
});

// ── 6. the path in scripts/dev/journey.mjs is complete ──────────────────────
//
// `scripts/dev/journey.mjs` is the machine-readable original of the project's
// path — the thirty steps, the phase each belongs to, what proves each one done.
// It exists because that path USED to be written out in FOUR places (the bullet
// list and the arrow chain in CLAUDE.md, the table in README.md, the greeting's
// own sentence, and a twenty-two-row look-first table in coach's SKILL.md) and
// nothing could hold one against another: prose cannot be compared with prose.
// That table is GONE rather than moved — `coach/references/where-am-i.md` runs
// this command instead and keeps only the four shapes of judgement no predicate
// can read. The bug that
// motivated it is the small kind that proves the point — the greeting's chain
// omitted `operate`, so the phase that begins the day the app goes live and does
// not end was missing from the one line every session reads, while all three
// other tellings had it, and every gate was green.
//
// A derived artefact is only worth as much as the data under it, so this block is
// the proof that the data is COMPLETE before anything reads it. What follows are
// the five properties a machine can be certain about; the sixth — is the trace
// the RIGHT predicate for that step — is a judgement, and `journey.test.ts`
// measures the state machine that evaluates it.

describe("the journey covers every skill exactly once", () => {
  const skills = new Set(SKILLS);
  // Rows that name a skill. 🚨 The filter is NOT "skip the nulls" — the one row
  // that may have none is named by hand in the test below, because a blanket skip
  // would let a typo (a row whose `skill` came out `undefined`) become a silent
  // hole in exactly the direction this whole block exists to close.
  const named = JOURNEY.map((row) => row.skill).filter((skill): skill is string => Boolean(skill));

  it("🚨 allows EXACTLY ONE row with no skill, and it is the plan", () => {
    // Phase 1's own deliverable, `docs/plan.md`, has no skill folder of its own
    // because two existing skills write it — `build-app` step 1f, or
    // `market-research` phase 5. Inventing a thirty-first skill to own one file
    // would be a folder nobody opens.
    //
    // Without that row, all three of phase 1's rows were `optional: true` and
    // `currentPhase` answered `bauen` on a fresh clone — the planning phase was
    // invisible to the beginner it exists for. So the row is required, and the
    // exception it needs is bounded here rather than waved through: one row, that
    // step number, and a `startedBy` naming a skill that really exists.
    const nameless = JOURNEY.filter((row) => !row.skill);
    expect(
      nameless.map((row) => row.step),
      "only the plan row (1.4) may have no skill — every other row names one",
    ).toEqual(["1.4"]);
    expect(nameless[0].startedBy, "the plan row must say who writes it").toBe("build-app");
    expect(skills.has(String(nameless[0].startedBy))).toBe(true);
    expect(nameless[0].optional, "the plan is phase 1's binding deliverable").toBe(false);
  });

  it("names each skill folder once, in both directions", () => {
    // Both directions, and both fail differently. A skill missing from the list
    // is a whole guided step no derived table can show — which is the omission
    // this file exists for. A row naming a skill that is gone sends the agent
    // after a file it cannot open, and it says so to the person paying for the
    // app.
    const missing = SKILLS.filter((skill) => !named.includes(skill));
    const unknown = named.filter((skill) => !skills.has(skill));
    const twice = named.filter((skill, i) => named.indexOf(skill) !== i);

    expect(
      missing,
      `in .claude/skills/ but not in JOURNEY: ${missing.join(", ")} — add a row, ` +
        `it is a step of the path nothing can render without one`,
    ).toEqual([]);
    expect(unknown, `named by JOURNEY but no such skill folder: ${unknown.join(", ")}`).toEqual([]);
    expect(twice, `named twice by JOURNEY: ${twice.join(", ")}`).toEqual([]);
  });

  it("mirrors each skill's own `requires:` rather than restating it", () => {
    // `requires` is one claim with two readers: `node run.mjs update` refuses the
    // TEXT of a skill this copy cannot run, and the path refuses the STEP. The
    // frontmatter is the original and this list is a mirror — so the parser is
    // `requiresFrom()` from update-plan.mjs, imported and never re-implemented.
    // The factory's own `scripts/skill-requires-lint.mjs` sets that precedent
    // explicitly, for the same reason: a second parser is a second opinion about
    // whether a customer may read a page.
    // ⚠️ `row.skill ?? ""` rather than a non-null assertion: the plan row has no
    // skill and therefore no frontmatter to mirror, so it drops out of this
    // comparison here rather than being asserted about somewhere it cannot answer.
    const wrong = JOURNEY.filter((row) => skills.has(row.skill ?? ""))
      .map((row) => {
        const frontmatter = requiresFrom(CORPUS.get(`.claude/skills/${row.skill}/SKILL.md`));
        return { skill: row.skill, row: row.requires, frontmatter };
      })
      .filter(({ row, frontmatter }) => (row ?? null) !== (frontmatter ?? null))
      .map(({ skill, row, frontmatter }) => `${skill}: JOURNEY says ${row}, SKILL.md says ${frontmatter}`);

    expect(
      wrong,
      `a mirrored value has drifted from its original — fix the row in ` +
        `scripts/dev/journey.mjs, never the skill:\n${wrong.join("\n")}`,
    ).toEqual([]);
  });

  it("has nine rows with no `requires:` at all, and finds them", () => {
    // Non-vacuity for the check above. A `requiresFrom()` that answered `null`
    // for everything — a frontmatter parser is one regex away from that — would
    // pass the whole comparison the moment somebody "simplified" the rows to
    // match. Nine is what the tree really holds — eight skills plus the plan row,
    // which needs no version because `docs/plan.md` is a file rather than a
    // feature; the number is allowed to move and the assertion is that BOTH sides
    // move together.
    const withRequires = JOURNEY.filter((row) => row.requires !== null);
    expect(withRequires.length).toBe(JOURNEY.length - 9);
    expect(withRequires.every((row) => /^\d+\.\d+\.\d+$/.test(String(row.requires)))).toBe(true);
  });
});

describe("the journey's other joins resolve", () => {
  it("names a module that exists and that names the skill back", () => {
    // A module row is the only kind that can be `blocked`, and the id is what
    // decides it. The manifest has to agree in BOTH directions: `modules/<id>/`
    // must be there, and its own `skill` field must name this skill — the field
    // `node run.mjs module list` prints so that a module somebody has just heard
    // of never leaves them guessing which of thirty skills is its one.
    const wrong: string[] = [];

    for (const row of JOURNEY.filter((entry) => entry.module !== null)) {
      let manifest: { skill?: string } | null = null;
      try {
        manifest = JSON.parse(read(`modules/${row.module}/module.json`));
      } catch {
        wrong.push(`${row.skill}: modules/${row.module}/module.json cannot be read`);
        continue;
      }
      if (manifest?.skill !== row.skill) {
        wrong.push(`${row.skill}: modules/${row.module}/module.json says skill "${manifest?.skill}"`);
      }
    }

    expect(wrong, `a module join is broken:\n${wrong.join("\n")}`).toEqual([]);

    // ⚠️ The other direction, and it replaces a hard-coded 5.
    //
    // Non-vacuity is what that number was for — a loop over an empty list
    // satisfies the check above perfectly. But a count cannot say WHICH module
    // is missing, and it fails on the day a sixth one lands with a message
    // ("expected 6 to be 5") that names nothing and reads like a broken test
    // rather than an unfinished job. So the guard asks the real question
    // instead: every module of OURS is a step of the path, and the path is the
    // only place an agent learns the step exists.
    //
    // 🚨 "Ours" is read off `docs`, never off a list kept here: a module of
    // this template points at a page in the core tree, one from outside points
    // inside itself (`docs/modules.md` → *A module from somewhere else*). A
    // customer who installs a stranger's module is not thereby missing a row in
    // OUR journey, and this must not turn their suite red for it.
    const ours = availableModules(ROOT).filter((id) => {
      try {
        return !String(JSON.parse(read(`modules/${id}/module.json`)).docs).startsWith("modules/");
      } catch {
        return false;
      }
    });
    const named = new Set(JOURNEY.filter((row) => row.module !== null).map((row) => row.module));
    const unwalked = ours.filter((id) => !named.has(id));

    expect(ours.length, "no module of this template found — the join checked nothing").toBeGreaterThan(1);
    expect(
      unwalked,
      `these modules ship with the template and no journey step names them: ${unwalked.join(", ")} ` +
        `— add a row to scripts/dev/journey.mjs, or the path cannot show the step`,
    ).toEqual([]);
  });

  it("gives every step a unique number and hands to a row that exists", () => {
    const steps = JOURNEY.map((row) => row.step).filter((step) => step !== null);
    const twice = steps.filter((step, i) => steps.indexOf(step) !== i);
    expect(twice, `two rows carry the same step number: ${twice.join(", ")}`).toEqual([]);

    // `handsTo` IS the arrow chain the four prose tellings drew with `→`, and a
    // chain pointing at nothing is exactly the class of fault this file exists
    // for: it renders as a path that stops.
    const named = new Set(JOURNEY.map((row) => row.skill));
    const dangling = JOURNEY.filter((row) => row.handsTo !== null && !named.has(row.handsTo)).map(
      (row) => `${row.skill} → ${row.handsTo}`,
    );
    expect(dangling, `the chain leads nowhere: ${dangling.join(", ")}`).toEqual([]);
  });

  it("keeps `kind: \"ask\"` countable", () => {
    // 🚨 Why a cap at all: `ask` is the honest escape hatch for a step that
    // leaves no trace — `go-to-market` writes nothing that proves it ran, and
    // coach says so in as many words. It has to stay COUNTABLE, because the
    // moment it is the easy answer it becomes the default, and a path where every
    // row answers "I do not know" is a path nobody can be routed along.
    //
    // Six is what the path holds today — it was nine until `go-to-market` became
    // a `file` row, because its phase 5 now writes `docs/go-to-market.md`, and
    // eight until `visuals` and `user-onboarding` became `note` rows. Two of
    // the six can never be anything else: `guardrails` and `coach` are not steps
    // that get done. So the real budget for a step is four, and the direction to
    // move this number is DOWN — by finding the file a step already leaves behind,
    // never by adding a seventh ask and raising the cap.
    const asks = JOURNEY.filter((row) => row.trace?.kind === "ask").map((row) => row.skill);
    expect(asks.length, `${asks.length} rows say "ask": ${asks.join(", ")}`).toBeLessThanOrEqual(6);
  });

  it("gives every row a phase, a title in both languages and a sentence", () => {
    // The three fields a derived table renders. A row missing one of them is a
    // blank cell in a README somebody generated, which is how a step stops being
    // read at all.
    const phases = new Set(["voraussetzung", "planen", "bauen", "live", "betrieb", "daneben"]);
    const incomplete = JOURNEY.filter(
      (row) =>
        !phases.has(row.phase) ||
        !row.title?.de ||
        !row.title?.en ||
        !row.what ||
        typeof row.optional !== "boolean" ||
        typeof row.recurring !== "boolean",
    ).map((row) => row.skill);
    expect(incomplete, `incomplete row(s): ${incomplete.join(", ")}`).toEqual([]);
  });
});

// ── 7. the guidance stays the size it was cut to ────────────────────────────
//
// The two checks below exist because a property was established once and then
// decayed within four days, with every gate green the whole time.
//
// `CLAUDE.md` was condensed from 2,252 lines to 1,469 and its topic blocks were
// given one shape: hard invariants, a few points worth knowing, and a bold link
// to the docs/ file that carries the long form. The five biggest skills were
// split the same way — a navigating SKILL.md under the official ~500-line mark,
// with the catalogues beside it in `references/`. Both held at the commit that
// did the work. Four days later CLAUDE.md was back to 2,011 lines and
// `build-app/SKILL.md` had walked from 499 to 562, because nothing anywhere
// measured either one.
//
// What is NOT checked here, deliberately: whether a block actually follows the
// shape. "Invariants plus at most three points plus a pointer" is a judgement,
// and a test that pretends to make it would be worse than no test — it would
// pass on prose that satisfies the letter. That judgement is a human contract,
// and `condensate.stamp.json` is what schedules it.
//
// What IS checked is the part a machine can be sure about: a size, and a file
// agreeing with itself. Both were violated in real life, neither needs taste.

describe("the guidance does not quietly grow back", () => {
  // The skill spec loads the FULL body of a SKILL.md when the skill triggers.
  // Over the mark it stops being a procedure and becomes a catalogue the
  // customer's session pays for on every use. The fix is never to delete it: it
  // is to move the catalogue into `references/` beside the skill, which is
  // loaded only when something actually reads it.
  const SKILL_MAX_LINES = 500;

  it(`keeps every SKILL.md under ${SKILL_MAX_LINES} lines`, () => {
    const oversized = SKILLS.map((skill) => {
      const lines = CORPUS.get(`.claude/skills/${skill}/SKILL.md`)!.split("\n").length;
      return { skill, lines };
    })
      .filter(({ lines }) => lines >= SKILL_MAX_LINES)
      .map(({ skill, lines }) => `${skill} (${lines})`);

    expect(
      oversized,
      `over ${SKILL_MAX_LINES} lines — move the catalogues, tables and long ` +
        `examples into .claude/skills/<name>/references/*.md and link them from ` +
        `the point of use. Keep the rules in SKILL.md: ${oversized.join(", ")}`,
    ).toEqual([]);
  });

  // 🚨 A line cap falls to dense tables, and here it already has.
  //
  // The exact hole `scripts/guidance-budget.test.mjs` describes for CLAUDE.md
  // and closed there with a second cap in BYTES. It was never carried across,
  // and the measurement says why it needed to be: `setup-monitoring/SKILL.md`
  // is **498 lines / 36,866 bytes = 74 bytes a line** — two lines under the cap
  // above, and the densest file in the tree. In absolute bytes it is bigger
  // than `build-app` (28,716) and `security-gateway` (25,249) at the same line
  // count. Three skills sit at 498; that is not a coincidence, it is a cap
  // being written against.
  //
  // What a session pays for is bytes, not newlines.
  //
  // ⚠️ The number is today's maximum plus room, and it is stated as a
  // measurement rather than a round figure so the next reader can tell whether
  // raising it is a decision or a reflex. `references/` is deliberately NOT
  // capped: the split there is right — a run loads SKILL.md plus the one
  // reference its step names — so a folder cap would be a brake with no finding
  // behind it.
  const SKILL_MAX_BYTES = 40_000;

  it(`keeps every SKILL.md under ${SKILL_MAX_BYTES.toLocaleString("en-US")} bytes`, () => {
    const measured = SKILLS.map((skill) => ({
      skill,
      bytes: Buffer.byteLength(CORPUS.get(`.claude/skills/${skill}/SKILL.md`)!, "utf8"),
    }));

    // The count guard: an empty corpus would make the assertion below vacuous.
    expect(measured.length, "no skills were measured").toBeGreaterThan(20);

    const oversized = measured
      .filter(({ bytes }) => bytes >= SKILL_MAX_BYTES)
      .map(({ skill, bytes }) => `${skill} (${bytes.toLocaleString("en-US")} bytes)`);

    expect(
      oversized,
      `over ${SKILL_MAX_BYTES.toLocaleString("en-US")} bytes. The line cap above ` +
        `does not catch a dense table — move it into references/ rather than ` +
        `rewrapping it: ${oversized.join(", ")}`,
    ).toEqual([]);
  });

  // "Three things that are easy to get wrong:" followed by four bullets. Nobody
  // writes that on purpose — it is what a later change looks like when it adds
  // a bullet and does not re-read the sentence above it. It is worth catching
  // because the number is the block's own claim about its size, and an agent
  // reading four items under a promise of three has been told, in the file it
  // trusts most, that the file does not track itself.
  const NUMBER_WORDS = new Map([
    ["two", 2],
    ["three", 3],
    ["four", 4],
    ["five", 5],
    ["six", 6],
    ["seven", 7],
  ]);
  const COUNTED = new RegExp(
    `\\*{0,2}(${[...NUMBER_WORDS.keys()].join("|")})\\*{0,2} ` +
      `(?:things?|rules?|properties|invariants|steps?|answers?)\\b[^\\n]*:\\s*$`,
    "i",
  );

  it("counts as many bullets as the sentence above them promises", () => {
    const wrong: string[] = [];

    for (const [name, text] of CORPUS) {
      const lines = text.split("\n");
      lines.forEach((line, i) => {
        const claim = line.match(COUNTED);
        if (!claim) return;
        // Only a list that starts on the next non-empty line is the one being
        // counted; a sentence followed by prose is promising something else.
        let j = i + 1;
        while (j < lines.length && lines[j].trim() === "") j += 1;
        if (!/^[-*] /.test(lines[j] ?? "")) return;

        let bullets = 0;
        for (; j < lines.length; j += 1) {
          if (/^[-*] /.test(lines[j])) bullets += 1;
          else if (lines[j].trim() === "" || /^\s+\S/.test(lines[j])) continue;
          else break;
        }

        const promised = NUMBER_WORDS.get(claim[1].toLowerCase())!;
        if (bullets !== promised) {
          wrong.push(`${name}:${i + 1} promises ${promised}, lists ${bullets} — "${line.trim()}"`);
        }
      });
    }

    expect(wrong, `a counted list disagrees with its own count:\n${wrong.join("\n")}`).toEqual([]);
  });
});
