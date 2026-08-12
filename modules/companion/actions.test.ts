// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The guard order, read off the source.
//
// ── Why structurally and not by calling it ─────────────────────────────────
// Every one of these checks needs a session, a database or both, and this
// project has no test database on purpose (commit `4261477`). What can be
// asserted without either is the thing that actually goes wrong: a check
// **missing**, or a check in the **wrong place**. Charging before the work,
// asking `hasPlan` after the model call, or recording the rate limit before the
// input was validated are all silent — the feature keeps working and somebody
// pays for it.
//
// The same technique `app/use-server-exports.test.ts` and
// `scripts/portability.test.ts` use: a rule nobody can be expected to remember,
// enforced by something that reads the tree.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { blankComments } from "@/scripts/lib/source-text.mjs";

const raw = readFileSync(
  fileURLToPath(new URL("./actions.ts", import.meta.url)),
  "utf8",
);

/**
 * The file with its comments removed.
 *
 * 🚨 The first version of this guard read the raw source, and a code review
 * found what that costs: this file's own header comment names
 * `hasSufficientBalance(` and `askCompanion({` in prose, so a comment alone
 * could satisfy every ordering assertion below while the code underneath was
 * reordered. `lib/ai/companion-config.test.ts` next door already strips
 * comments *"because a guard that reads a tree must not fail on prose"* — the
 * same reason applies in the other direction, and it is sharper here.
 */
const source = blankComments(raw);

/** Where a marker appears, or `-1`. */
const at = (needle: string) => source.indexOf(needle);

describe("the file is what this test thinks it is", () => {
  // Non-vacuity first: every ordering assertion below would pass against an
  // empty string, which is the one way a structural test lies.
  it("is a non-empty server action file", () => {
    expect(source.length).toBeGreaterThan(1_000);
    expect(raw.startsWith('"use server"')).toBe(true);
    expect(at("askCompanionAction")).toBeGreaterThan(0);
  });

  it("strips comments without stripping the code — the guard's own guard", () => {
    // If `source` ever came back empty, every ordering assertion below would
    // pass for a file that broke every rule.
    expect(source).toContain("askCompanion({");
    expect(source).toContain("spendTokens({");
    // And the stripping really happened: this sentence is in a comment only.
    expect(source).not.toContain("a guard that reads a tree must not fail on prose");
  });
});

describe("askCompanionAction performs the chat route's checks in the chat route's order", () => {
  // The seven, in the order they must appear.
  const ORDER = [
    ["signed in", "requireActiveUser()"],
    ["feature on", "isCompanionEnabled()"],
    ["companion known", "companionById("],
    ["plan held", "hasPlan("],
    ["under the rate limit", "isLimited("],
    ["input sane", "checkCompanionMessage("],
    ["can afford it", "hasSufficientBalance("],
  ] as const;

  for (const [what, marker] of ORDER) {
    it(`checks ${what}`, () => {
      expect(at(marker), marker).toBeGreaterThan(0);
    });
  }

  it("checks them in that order", () => {
    const positions = ORDER.map(([, marker]) => at(marker));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});

describe("what the customer wrote never reaches the model as instruction", () => {
  // The defect a code review found: the typed message was passed as `ask`,
  // which `buildFencedRequest` appends AFTER the fence and does not
  // neutralise — so the one string an attacker fully controls was the one the
  // fence did not cover. It now travels as `work`, which is the fenced field.
  it("passes the typed message as `work`, never as `ask`", () => {
    expect(source).toMatch(/work: \[\.\.\.\(material\.work \?\? \[\]\), \{ label: CUSTOMER_TURN_LABEL, text: checked\.text \}\]/);
    expect(source).not.toMatch(/ask:\s*checked\.text/);
  });

  it("keeps `ask` app-authored, as a constant", () => {
    expect(source).toMatch(/ask: ASK/);
    expect(source).toMatch(/const ASK = "/);
  });

  it("keeps `about` app-authored too — the facts travel outside the fence", () => {
    // The same shape of mistake one field along, and the quieter one. `about`
    // is rendered BEFORE the first marker (`lib/ai/customer-text.ts` says so
    // over the field), so a fact is read as this app's own voice — which is
    // exactly what `ask` is, and exactly why neither may carry what somebody
    // else typed. Here it comes from the companion's own `load()`.
    expect(source).toMatch(/about: material\.about/);
    expect(source).not.toMatch(/about:[^\n]*checked\.text/);
  });

  it("does not send the just-stored question a second time as history", () => {
    // Storing it and also sending it as `work` would put the customer's text
    // into the request twice — once outside the fence — and bill for both.
    expect(source).toMatch(/filter\(\(turn\) => turn\.id !== questionId\)/);
  });

  it("clamps the history window as well as the input", () => {
    expect(source).toContain("companionHistoryTurns(");
    expect(source).toContain("companionInputChars(");
  });

  it("bounds what load() returned, not only what was typed", () => {
    expect(source).toMatch(/loaded > ceiling/);
  });
});

describe("check → work → charge", () => {
  it("asks whether they can afford it before the model is called", () => {
    // The mistake that actually gets made: doing the work with no check in
    // front gives the answer away for free, because by the time `spendTokens`
    // throws the expensive part has already run.
    expect(at("hasSufficientBalance(")).toBeLessThan(at("askCompanion({"));
  });

  it("charges only after the answer exists", () => {
    // Charging first bills for work that then fails.
    expect(at("askCompanion({")).toBeLessThan(at("spendTokens({"));
  });

  it("charges BEFORE the answer is stored", () => {
    // The other half, and a code review found it missing: storing first means a
    // charge that fails still leaves the answer in `chat_messages`, where it
    // appears on the customer's next load — free, while they were told it
    // failed, and while the operator paid.
    expect(at("spendTokens({")).toBeLessThan(at('role: "assistant"'));
  });

  it("neither stores nor charges for an empty answer", () => {
    expect(at('answer.trim() === ""')).toBeGreaterThan(0);
    expect(at('answer.trim() === ""')).toBeLessThan(at("spendTokens({"));
  });

  it("turns an illegal price into a failure rather than letting it escape", () => {
    // `spendTokens` throws a plain Error — deliberately not a TokenError — for
    // an amount that is not a legal price. Rethrowing it would reach a surface
    // that cannot show it.
    expect(source).not.toMatch(/throw error;/);
  });

  it("stores the question before the call, so a failure does not lose it", () => {
    expect(at('role: "user"')).toBeLessThan(at("askCompanion({"));
  });

  it("records the rate limit only after the input passed", () => {
    // Recording first charges somebody's allowance for a message that was
    // refused before it could cost anything.
    expect(at("checkCompanionMessage(")).toBeLessThan(at("record(CHAT_RATE_BUCKET"));
  });
});

describe("every refusal says whether the question survived it", () => {
  // 🚨 Found by hand in the browser, after the tests were green — and it was a
  // defect introduced by an earlier fix from the same review. The panel had
  // learnt to take its optimistic row back on a refusal and hand the text to the
  // customer again, which is right for everything refused BEFORE the question is
  // stored and wrong for everything after it: a failed model call has already
  // written the question, so the customer watched their message vanish, got the
  // text back, and found it in the transcript on the next reload — ready to be
  // sent a second time.
  //
  // Which of the two happened is knowledge only this file has. `kept` is how it
  // says so, and these assertions are what stop a new refusal being added
  // without answering the question.
  const refusals = [...source.matchAll(/return \{ ok: false[^}]*\}/g)].map((match) => ({
    text: match[0],
    at: match.index ?? -1,
  }));

  it("has refusals on both sides of the write, so the split below is real", () => {
    // Non-vacuity: the whole point is that the file has two kinds.
    expect(refusals.length).toBeGreaterThanOrEqual(10);
    expect(refusals.some((refusal) => refusal.text.includes("kept: false"))).toBe(true);
    expect(refusals.some((refusal) => refusal.text.includes("kept: true"))).toBe(true);
  });

  it("answers it in every single one", () => {
    for (const refusal of refusals) {
      expect(refusal.text, refusal.text).toMatch(/kept: (true|false)/);
    }
  });

  it("says `false` before the question is written and `true` after it", () => {
    // The position of the write IS the rule — not a list of codes that a new
    // refusal could be added to without anybody noticing it was needed.
    const written = at('role: "user"');
    expect(written).toBeGreaterThan(0);

    for (const refusal of refusals) {
      expect(refusal.text, `${refusal.text} — before the question is stored`).toContain(
        refusal.at < written ? "kept: false" : "kept: true",
      );
    }
  });

  it("is a promise the panel actually keeps", () => {
    const panel = readFileSync(
      fileURLToPath(new URL("./components/companion-panel.tsx", import.meta.url)),
      "utf8",
    );

    // The rollback is behind the flag, and the text is handed back in the same
    // branch — restoring it without the row, or the other way round, is the
    // half-fix that produced the duplicate.
    const guard = panel.indexOf("if (!result.kept)");
    expect(guard, "the panel rolls back without asking whether anything was stored").toBeGreaterThan(
      0,
    );
    const branch = panel.slice(guard, panel.indexOf("}", panel.indexOf("setMessage(text)", guard)));
    expect(branch).toContain("current.filter(");
    expect(branch).toContain("setMessage(text)");
  });
});

describe("what the customer is allowed to learn", () => {
  it("shares the chat's rate-limit bucket rather than creating a second", () => {
    expect(source).toContain("CHAT_RATE_BUCKET");
    expect(source).not.toMatch(/COMPANION_RATE_BUCKET/);
  });

  it("composes the conversation key server-side and never takes one", () => {
    // If the browser could send the whole key it could name another companion's
    // conversation and read its turns.
    expect(source).toContain("conversationIdFor(companion.id");
    expect(source).not.toMatch(/input\.conversationId/);
  });

  it("never returns a provider message, a stack or a model name", () => {
    // The precise reason goes to the log; the customer gets a code.
    expect(source).toContain('code: "companionFailed"');
    expect(source).toContain("console.error(");
    expect(source).not.toMatch(/error\.message/);
    expect(source).not.toMatch(/String\(error\)/);
  });

  it("labels the spend rather than passing what the customer wrote", () => {
    // `note` reaches a subject access request.
    expect(source).toMatch(/note: `companion: \$\{companion\.id\}`/);
    expect(source).not.toMatch(/note:.*checked\.text/);
  });

  it("takes no member id from its argument", () => {
    // The `spendTokens` rule, one level up: the account acted on is always the
    // session's own.
    expect(source).toContain("session.user.id");
    expect(source).not.toMatch(/input\.memberId/);
  });
});

describe("loadCompanionAction is the cheap half and is guarded anyway", () => {
  const load = source.slice(at("export async function loadCompanionAction"));

  it("exists and still asks who is calling", () => {
    expect(load.length).toBeGreaterThan(200);
    expect(load).toContain("requireActiveUser()");
    expect(load).toContain("hasPlan(");
  });

  it("does not meter — it costs no model call and reads only the caller's rows", () => {
    expect(load).not.toContain("isLimited(");
    expect(load).not.toContain("record(");
  });
});
