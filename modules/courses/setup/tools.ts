// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What a developer's coding agent may ask an environment to do on the course's
// behalf (docs/setup-mcp.md).
//
// ── Why this module needs any of it, measured ──────────────────────────────
// Ten dogfood runs built a course from `docs/courses.md`. The two that chose
// database-backed content — the shape this module ships — ran out of budget
// BEFORE a single page existed, both times at the authoring surface: roughly a
// thousand lines of admin CRUD, written from scratch, in a session that also
// had to invent the schema. The drip runs, which need no authoring surface at
// all, finished five times out of five.
//
// The answer to that is NOT a second authoring surface here. It is that the
// agent authors `content/course/*.json` — files, which it is good at — and
// `content-apply` carries them into whichever environment is asked for. No
// admin CRUD gets written, and no MCP write tool has to exist for that to work.
//
// 🚨 ── ONE WRITER, AND THIS FILE IS NOT IT (spine AD-82) ────────────────────
// Every row class this module owns — blocks, lessons — belongs to the APPLIER
// route, keyed by slug, from files in the repo. **Nothing here mutates**, and
// `lib/content/writers.test.ts` holds that mechanically rather than on trust.
//
// The reason is the one `docs/content.md` is written about. Two lawful ways to
// create the same row drift, and here the drift has a direction: `content-apply`
// re-asserts every block and lesson on every run, so a lesson typed through a
// tool would be silently overwritten by the next deploy's apply — the operator
// would watch their edit disappear and have nothing to read about why.
//
// What this surface is FOR is the other half: an agent can ask a remote
// environment what it holds without a production connection string, which is a
// far narrower door than the database. `presence` counts; this says what.
//
// ── Also deliberately NOT here ─────────────────────────────────────────────
// Nothing about a MEMBER. No completions, no submissions, no progress: those
// are the learners' rows, answered by `privacy/sections.ts` to the person they
// belong to, and a setup surface is exactly the "just for support" door that
// argument refuses.
//
// ── The fingerprint: what it IS, and what it is NOT ────────────────────────
// Each lesson carries a `fingerprint` — SHA-256 over that lesson's own content
// (`lib/fingerprint.mjs` pins the field list and the normalisation, and is bare
// Node so that `node run.mjs courses-diff` computes the LOCAL side with the very
// same function rather than a second one that agrees today). It exists so an
// agent preparing a publish can see WHICH lesson differs between its files and
// this environment without downloading the course: a difference becomes one hex
// string instead of a megabyte of prose. That is the same refusal as above,
// pressed harder — the opposite of returning the text.
//
// It is **not** a way to reconstruct a lesson: a hash is one-way, and this file
// still puts no body, no task prompt and no media id on the wire. It is **not a
// secret** either — anybody holding the lesson can recompute it — so nothing may
// ever treat it as a credential.
//
// ⚠️ **Each of the four media slots is hashed as its STORAGE KEY**, resolved
// here by `mediaKeysFor()` and never sent. That is what makes *"the video was
// swapped for another file"* a difference the comparison can see — it read as
// UNTOUCHED while the slots were hashed as a boolean, which is the one
// product-visible gap this surface used to carry. The key is derivable on both
// sides (`content/<topic>/<file>.<ext>`) where a media id is not, and it stays
// off the wire exactly as the id does: what travels is the digest.
//
// 🚨 The payload therefore also carries **`fingerprintVersion`**, once, at the
// top. A comparison against an environment whose deploy computes an older
// version is not a comparison, and without the tag it reads as every lesson
// having changed. Naming it is the difference between a verdict and *"I could
// not compare"* (NFR-60) — `lib/fingerprint.mjs` argues it in full.
//
// ── `origin`, and why a comparison needs it ────────────────────────────────
// 🚨 Every block and every lesson also carries `origin` — which WRITER owns that
// row over there. One string per row, and deliberately NOT in the fingerprint:
// it says who may write the row, not what the lesson says. A comparison needs it
// because a local slug sitting on a row this applier does not own is not a
// change a publish would make — it is a publish that REFUSES entirely
// (`content/appliers/course.mjs` → `refuseClaimedSlugs()`), and a report calling
// that "would change" promises a write that is guaranteed not to happen.
//
// What did NOT change: this tool does not mutate, it contributes no second tool,
// and `SetupResult`'s counters and `detail` line are exactly what they were. The
// payload grew by `fingerprint` and `origin` per lesson and by `unitCount`,
// `summary` and `origin` per block — no body, no task prompt, no media id, and
// nothing about a member.
import { mediaIdsIn, outlinePayload } from "../lib/outline";
import { FINGERPRINT_VERSION } from "../lib/fingerprint.mjs";
import { allCourses, courseProblems } from "../lib/courses";
import { courseOutline, mediaKeysFor } from "../lib/manage";
import type { ModuleSetupTools, SetupResult, SetupTool } from "@/lib/setup/types";

const outline: SetupTool = {
  name: "courses_outline",
  // ⚠️ One or two sentences, because this string travels in every `tools/list`
  // for every agent — and it now names what the payload CARRIES rather than only
  // what it is of. An agent that does not know there is a comparison key on each
  // lesson downloads nothing and can still answer "which lesson differs"; one
  // that does not know each row says who owns it will propose a publish that
  // `refuseClaimedSlugs()` throws out entirely. Phrased as "does not mutate" on
  // purpose: this file may not contain the literal the writers check reads.
  description:
    "The course this environment holds: every block with its lessons, in order. Each lesson carries a fingerprint — a comparison key over its own content, so you can see WHICH lesson differs from your files without downloading any of them — and each row carries the origin that says whose row it is. This tool does not mutate; read it before changing anything.",
  // ⚠️ **Deliberately null although the schema now HAS a field — and this
  // comment is a correction.** The reasoning that replaced the original one was
  // wrong: "an app may hold several courses, so the act is about one of them,
  // and `targetField` says which." `courses_outline` with no argument answers
  // for the WHOLE environment, so `course` is a FILTER over every course, not
  // the thing the act is about — exactly the shape `user_list`'s `role` has one
  // file over, with exactly that ruling.
  //
  // `lib/setup/registry.test.ts` is what said so, and its rule is the sharper
  // half: a `targetField` must be REQUIRED, because an optional one makes the
  // audit row's target present or absent depending on how the caller phrased
  // the request — which is the ambiguity the whole mechanism exists to remove.
  // 🚨 It was invisible to `make check`: the empty profile has no `courses`
  // module, so nothing composed this tool into the registry. `make
  // deploy-test-modules` found it on its first run after the change.
  targetField: null,
  // A course outline is about the repo's rows, never about one member.
  subjectEmailField: null,
  mutates: false,
  inputSchema: {
    type: "object",
    properties: {
      // Optional, and the two answers are different questions: with a slug,
      // "what does this course hold"; without one, "what does this environment
      // hold at all". An agent preparing a publish asks the first; one that has
      // just arrived asks the second and gets the slugs to ask it with.
      course: { type: "string", maxLength: 200 },
    },
    additionalProperties: false,
  },
  async run(context, input): Promise<SetupResult> {
    const wanted = typeof input.course === "string" ? input.course : null;
    // ⚠️ `allCourses()`, not `usableCourses()`: this is the OPERATOR's surface,
    // and a course whose row does not hold is precisely what an agent needs to
    // be told about. `problems` travels with each one rather than the course
    // being dropped.
    const courses = (await allCourses()).filter((row) => !wanted || row.slug === wanted);
    if (wanted && courses.length === 0) {
      return {
        mode: context.mode,
        created: 0,
        found: 0,
        changed: 0,
        subjects: [],
        detail: `no course "${wanted}" in ${context.appEnv}`,
        data: { fingerprintVersion: FINGERPRINT_VERSION, courses: [] },
      };
    }

    const outlines = await Promise.all(
      courses.map(async (course) => {
        const blocks = await courseOutline(course.id);
        const mediaKeys = await mediaKeysFor(mediaIdsIn(blocks));
        return {
          slug: course.slug,
          title: course.title,
          shape: course.shape,
          planKeys: course.planKeys,
          origin: course.origin,
          // 🚨 What is WRONG with it, carried rather than hidden. An agent
          // comparing files to an environment has to be able to see that a
          // course is there and unusable — that is a different repair from a
          // course that is missing.
          problems: courseProblems(course),
          ...outlinePayload(blocks, mediaKeys),
        };
      }),
    );

    const blocks = outlines.reduce((sum, row) => sum + row.blocks.length, 0);
    const units = outlines.reduce(
      (sum, row) => sum + row.blocks.reduce((n, block) => n + block.units.length, 0),
      0,
    );
    // The second read, and the only one that leaves this module's own tables:
    // media id → storage key, for the four slots the fingerprint hashes. One
    return {
      mode: context.mode,
      created: 0,
      found: courses.length,
      changed: 0,
      subjects: courses.map((course) => course.slug),
      detail: `${courses.length} course(s), ${blocks} block(s), ${units} lesson(s) in ${context.appEnv}`,
      // I/O here, the shape in the domain — `lib/setup/types.ts` asks a `run()`
      // for exactly that and never for a second implementation. It is also what
      // lets the refusal above be TESTED without a database: `outline.test.ts`
      // asserts no lesson text reaches this payload, which nothing could do
      // while the mapping lived inside this call.
      // One level up from what it used to be: the payload is a LIST of courses,
      // each carrying the block outline that used to be the whole answer.
      // `courses-diff` and `lib/diff.mjs` read this shape.
      data: { fingerprintVersion: FINGERPRINT_VERSION, courses: outlines },
    };
  },
};

const tools: ModuleSetupTools = {
  id: "courses",
  TOOLS: [outline],
};

export default tools;
