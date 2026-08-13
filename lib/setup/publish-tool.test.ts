// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 `content_publish`'s apply branch, and the ONE row it leaves behind.
//
// The writer is measured in `lib/content/publish.test.ts`. What is measured here
// is the other half — what the surface answers with, and what reaches the audit
// table — because that is where the four states of a publish either stay
// distinguishable or quietly collapse into "applied, 12 rows".
//
// The four states, and why the fourth needs anything at all:
//
//   nobody ever published        no row for content_publish at all
//   refused before any write     outcome refused, rows 0, the domain code
//   published whole              outcome applied, code null
//   published in part            outcome applied, code contentPublishPartial
//
// `setup_outcome` is a three-value Postgres enum and this epic creates no
// tables, so the fourth state lives in the `code` column — which already exists,
// is already read on the page and by `list_acts`, and was shipped for exactly
// this kind of refinement.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { blankComments } from "@/scripts/lib/source-text.mjs";
// ⚠️ Through the REGISTRY, and that is not a preference: `tools.ts` and
// `registry.ts` import each other, and entering that cycle at `tools.ts` leaves
// `ALL_SETUP_TOOLS` spreading a `CORE_SETUP_TOOLS` still in its temporal dead
// zone. `registry.test.ts` imports them in this order for the same reason.
import { toolsByName } from "./registry";

const { publishContent } = vi.hoisted(() => ({ publishContent: vi.fn() }));
vi.mock("@/lib/content/publish", () => ({ publishContent }));

const tool = toolsByName().get("content_publish")!;

const CONTEXT = { appEnv: "production", ownerId: "owner-1", mode: "apply" } as const;

function report(over: Record<string, unknown> = {}) {
  return {
    appEnv: "production",
    appliers: [
      { label: "courses:course.mjs", module: "courses", ran: true, rows: 12, created: 5, changed: 7 },
    ],
    media: {
      declared: 2,
      rowsCreated: 2,
      rowsChanged: 0,
      copied: 1,
      present: 1,
      skipped: [],
      unprocessed: null,
    },
    created: 7,
    changed: 7,
    rows: 14,
    partial: false,
    unreached: [],
    problems: [],
    ...over,
  };
}

beforeEach(() => publishContent.mockReset());

describe("what a finished publish answers with", () => {
  it("reports the counts, the applier LABELS and the exit condition", async () => {
    publishContent.mockResolvedValue(report());

    const result = await tool.run(CONTEXT, {});

    expect(result.mode).toBe("apply");
    expect(result.created).toBe(7);
    expect(result.changed).toBe(7);
    // `dispatch.ts` derives the audit row's `rows` from exactly this sum.
    expect(result.created + result.changed).toBe(14);
    // 🚨 The label, not one slug out of forty — `subjects[0]` becomes `target`.
    expect(result.subjects).toEqual(["courses:course.mjs"]);
    expect(result.code).toBeUndefined();

    const data = result.data as Record<string, unknown>;
    // ⚠️ The environment filled in, never left as a placeholder.
    expect(data.nextStep).toBe("node run.mjs content-check --env production");
    expect(String(data.nextStepMeans)).toMatch(/not that the page renders/);
  });

  it("writes one line of NUMBERS — no path, no title, no member", async () => {
    publishContent.mockResolvedValue(report());

    const result = await tool.run(CONTEXT, {});

    expect(result.detail).toBe(
      "1 of 1 applier(s) ran; 14 row(s); 2 media row(s) asserted; 1 file(s) copied, 1 already there",
    );
  });

  it("says so in words when this app declares no product media", async () => {
    publishContent.mockResolvedValue(report({ media: null }));

    const result = await tool.run(CONTEXT, {});

    // ⚠️ A sentence, never "0 of null" — a formatting artefact in the one line an
    // operator reads is how a legitimate state becomes a question about the tool.
    expect(result.detail).toContain("no product media declared here");
  });
});

describe("🚨 the fourth state — a partial publish must not read as a whole one", () => {
  it("carries contentPublishPartial and the rows that really committed", async () => {
    publishContent.mockResolvedValue(
      report({
        appliers: [
          { label: "a.mjs", module: null, ran: true, rows: 3, created: 3, changed: 0 },
          { label: "z.mjs", module: null, ran: false, rows: 0, created: 0, changed: 0 },
        ],
        created: 5,
        changed: 0,
        rows: 5,
        partial: true,
        problems: ["z.mjs — failed and was rolled back: boom"],
      }),
    );

    const result = await tool.run(CONTEXT, {});

    expect(result.code).toBe("contentPublishPartial");
    // What survived, never what was attempted.
    expect(result.created + result.changed).toBe(5);
    expect(result.detail).toContain("PARTIAL");
    expect(result.detail).toContain("1 problem(s)");
  });

  it("names the appliers a stopped run never reached", async () => {
    publishContent.mockResolvedValue(
      report({
        appliers: [{ label: "a.mjs", module: null, ran: true, rows: 3, created: 3, changed: 0 }],
        created: 5,
        changed: 0,
        rows: 5,
        partial: true,
        unreached: ["b.mjs", "c.mjs"],
        problems: ["the 25s publish budget ran out"],
      }),
    );

    const result = await tool.run(CONTEXT, {});

    // The `store-sync.mjs` shape. Never a bare "Done".
    expect(result.detail).toContain("1 of 3 applier(s) ran");
    expect(result.detail).toContain("STOPPED — 2 applier(s) never reached: b.mjs, c.mjs");
    expect(result.code).toBe("contentPublishPartial");
  });

  it("the code is an IDENTIFIER — never a sentence, a path or a reason", async () => {
    publishContent.mockResolvedValue(report({ partial: true }));

    const result = await tool.run(CONTEXT, {});

    // It lands in a text column that is read on a page and by `list_acts`. A
    // sentence there is how an audit trail becomes a second copy of the data it
    // exists to police.
    expect(result.code).toMatch(/^[a-zA-Z][a-zA-Z0-9]*$/);
    expect(String(result.code).length).toBeLessThan(40);
  });
});

describe("🚨 the audit row carries no token and no secret", () => {
  // Read against the row that is actually WRITTEN, not asserted about it. The
  // success path in `dispatch.ts` is the only writer of a successful act, and
  // this reads the object it hands `recordAct()`.
  const DISPATCH = blankComments(
    readFileSync(join(process.cwd(), "lib", "setup", "dispatch.ts"), "utf8"),
  );

  /**
   * The keys of the `recordAct({ … })` call that follows a successful run.
   *
   * ⚠️ Found from `rows: result.created + result.changed` backwards, not from the
   * first `recordAct(` forwards: there are three calls in that file and the
   * first belongs to the GUARD's refusal branch. A scan that read that one would
   * pass while saying nothing about the row a successful publish writes.
   */
  function successPathKeys(): string[] {
    const anchor = DISPATCH.indexOf("rows: result.created + result.changed");
    expect(
      anchor,
      "the success path's recordAct() call moved — this scan is looking at nothing",
    ).toBeGreaterThan(0);
    const at = DISPATCH.lastIndexOf("recordAct({", anchor);
    const body = DISPATCH.slice(at + "recordAct({".length);
    const literal = body.slice(0, body.indexOf("});"));
    const keys = [...literal.matchAll(/^\s+([a-zA-Z]+)\s*[:,]/gm)].map((match) => match[1]);

    // 🚨 A spread is a hole in a scan that reads keys. `...accountability(input)`
    // is the ONE this file knows about — the two named exceptions, in one
    // spelling so the success path and the refusal paths cannot drift — and it
    // is resolved rather than tolerated: what it contributes is read out of that
    // function's own body. Any OTHER spread here is a set of columns nothing
    // measures, so it fails.
    const spreads = [...literal.matchAll(/^\s+\.\.\.(\w+)\(/gm)].map((match) => match[1]);
    expect(spreads, "an unrecognised spread hides columns from this scan").toEqual([
      "accountability",
    ]);
    return [...keys, ...accountabilityKeys()];
  }

  /** What `accountability()` contributes, read from the function itself. */
  function accountabilityKeys(): string[] {
    const at = DISPATCH.indexOf("function accountability(");
    expect(at, "accountability() moved — this scan is looking at nothing").toBeGreaterThan(0);
    const body = DISPATCH.slice(DISPATCH.indexOf("return {", at));
    return [...body.slice(0, body.indexOf("};")).matchAll(/^\s+([a-zA-Z]+):/gm)].map(
      (match) => match[1],
    );
  }

  it("writes identifiers and numbers, and nothing a caller sent", () => {
    expect(successPathKeys().sort()).toEqual([
      "appEnv",
      "code",
      "keyId",
      "outcome",
      "reason",
      "role",
      "rows",
      // A70: the foreign key both Art. 15 exports slice on. An id this app
      // issued — never an address, and never anything a caller sent.
      "subjectMemberId",
      "target",
      "tool",
      "ownerId",
    ].sort());
  });

  it("cannot write a confirmation, a key, a detail or a payload", () => {
    const written = successPathKeys().join(" ").toLowerCase();
    for (const forbidden of ["confirmation", "token", "secret", "detail", "data", "input"]) {
      expect(
        written.includes(forbidden),
        `dispatch.ts writes "${forbidden}" into setup_audit. The row is identifiers and ` +
          `numbers — a trail that quotes what was written becomes a second copy of the data ` +
          `it exists to police, outside the retention rules and outside the Art. 15 inventory.`,
      ).toBe(false);
    }
  });

  it("finds no reason and no role on this tool, because its schema has neither", () => {
    // `dispatch.ts` reads `input.reason` and `input.role`; `content_publish`'s
    // input schema is empty, so both stay null without anybody remembering to.
    expect(Object.keys(tool.inputSchema.properties)).toEqual([]);
    expect(DISPATCH).toContain('typeof input.reason === "string" ? input.reason : null');
  });

  it("passes the result's code through, and only the code", () => {
    // 🚨 Two fields, and both are identifiers the tool declared: `refused`
    // REPLACES the outcome (A75), `code` REFINES it. Neither is a sentence, and
    // nothing else off the result reaches this column — a `detail` here would be
    // the second copy of the payload this whole file exists to refuse.
    expect(DISPATCH).toMatch(/code:\s*\(result\.refused \?\? result\.code \?\? null\)/);
    // The rows are derived, not taken from a field a tool could fill freely.
    expect(DISPATCH).toContain("rows: result.created + result.changed");
  });
});
