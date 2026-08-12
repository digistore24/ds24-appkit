// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The pure half of the companion, and the two things a customer can reach.
//
// `conversationIdFor` is the whole of AC 1: if two subjects could ever produce
// one key, day three's conversation answers day seven's question — which is not
// a context bug, it is the product being wrong. The refusals below are the ones
// that meet input somebody else wrote.
import { describe, expect, it } from "vitest";

import {
  DEFAULT_COMPANION_INPUT_CHARS,
  MAX_COMPANION_HISTORY_TURNS,
  MAX_COMPANION_INPUT_CHARS,
  companionHistoryTurns,
  checkCompanionMessage,
  checkSubject,
  companionInputChars,
  conversationIdFor,
} from "./rules";

describe("two subjects never share a conversation", () => {
  it("separates two subjects of one companion", () => {
    expect(conversationIdFor("coach", "day-7")).not.toBe(conversationIdFor("coach", "day-3"));
  });

  it("separates two companions on one subject", () => {
    expect(conversationIdFor("coach", "day-7")).not.toBe(conversationIdFor("tutor", "day-7"));
  });

  it("is stable, so yesterday's turns are found again tomorrow", () => {
    expect(conversationIdFor("coach", "day-7")).toBe(conversationIdFor("coach", "day-7"));
  });

  it("cannot be made to collide by a subject carrying the separator", () => {
    // A subject MAY contain colons — it comes off a URL segment and we do not
    // get to forbid them. Two legal companions therefore stay apart no matter
    // what their subjects contain, because the id itself carries none.
    expect(conversationIdFor("coach", "a:b")).not.toBe(conversationIdFor("coach-a", "b"));
    expect(conversationIdFor("a", "b:c")).not.toBe(conversationIdFor("a-b", "c"));
  });

  it("puts the companion id before the FIRST colon, which is what makes that safe", () => {
    // The guarantee is not a property of the string — it is a property of the
    // string PLUS the validation. `companionProblems()` refuses an id outside
    // /^[a-z0-9-]{1,40}$/, so no id can contain a colon, so the first colon is
    // always the split point and no two (companion, subject) pairs can produce
    // one key.
    //
    // Written out because the reverse is a real trap: allow a dotted or colonned
    // id later and this stops being true silently — `coach:a` + `b` and `coach`
    // + `a:b` would then be one conversation, and two customers' companions
    // would read each other's turns.
    for (const [id, subject] of [
      ["coach", "day-7"],
      ["writing-coach", "week-2:day-3"],
      ["a", ""],
    ] as const) {
      const key = conversationIdFor(id, subject);
      expect(key.slice(0, key.indexOf(":"))).toBe(id);
      expect(key.slice(key.indexOf(":") + 1)).toBe(subject);
    }
  });
});

describe("the input ceiling is the entry's, within the layer's", () => {
  it("falls back when the entry says nothing", () => {
    for (const value of [undefined, null, "8000", 1.5, Number.NaN]) {
      expect(companionInputChars(value), String(value)).toBe(DEFAULT_COMPANION_INPUT_CHARS);
    }
  });

  it("takes the entry's own number when it is one", () => {
    expect(companionInputChars(1200)).toBe(1200);
    expect(companionInputChars(MAX_COMPANION_INPUT_CHARS)).toBe(MAX_COMPANION_INPUT_CHARS);
  });

  it("refuses to be talked past the layer's ceiling, and does not clamp", () => {
    // Falling back rather than clamping is the `count()` shape: a number nobody
    // meant is replaced by the one somebody did, not quietly turned into the
    // largest legal value.
    expect(companionInputChars(MAX_COMPANION_INPUT_CHARS + 1)).toBe(DEFAULT_COMPANION_INPUT_CHARS);
    expect(companionInputChars(10_000_000)).toBe(DEFAULT_COMPANION_INPUT_CHARS);
    expect(companionInputChars(0)).toBe(DEFAULT_COMPANION_INPUT_CHARS);
    expect(companionInputChars(-5)).toBe(DEFAULT_COMPANION_INPUT_CHARS);
  });
});

describe("the history window is clamped too", () => {
  // A code review found this missing: the input ceiling was clamped and this one
  // was not, although it is the number that decides how much is re-sent on every
  // single turn.
  it("takes the entry's own number when it is one", () => {
    expect(companionHistoryTurns(12)).toBe(12);
    expect(companionHistoryTurns(MAX_COMPANION_HISTORY_TURNS)).toBe(MAX_COMPANION_HISTORY_TURNS);
  });

  it("caps a number nobody meant", () => {
    expect(companionHistoryTurns(1_000)).toBe(MAX_COMPANION_HISTORY_TURNS);
    expect(companionHistoryTurns(MAX_COMPANION_HISTORY_TURNS + 1)).toBe(MAX_COMPANION_HISTORY_TURNS);
  });

  it("falls back to one exchange for anything that is not a whole positive number", () => {
    for (const value of [undefined, null, "12", 1.5, Number.NaN, 0, -3]) {
      expect(companionHistoryTurns(value), String(value)).toBe(1);
    }
  });
});

describe("the subject is customer-controlled and is treated that way", () => {
  it("accepts an ordinary one, trimmed", () => {
    expect(checkSubject("  day-7  ")).toEqual({ ok: true, subject: "day-7" });
  });

  it("refuses anything that is not a non-empty string", () => {
    for (const value of [undefined, null, 7, {}, [], "", "   "]) {
      expect(checkSubject(value), String(value)).toMatchObject({ ok: false });
    }
  });

  it("refuses one past the ceiling", () => {
    expect(checkSubject("x".repeat(200))).toMatchObject({ ok: true });
    expect(checkSubject("x".repeat(201))).toMatchObject({ ok: false });
  });

  it("refuses line breaks and tabs, which hasControlChar allows", () => {
    // Stricter than the message check on purpose: a subject is an identifier off
    // a URL segment, not something somebody wrote — and a realistic `load()`
    // mirrors it back into the prompt as an `about` value, which sits outside
    // the fence. A multi-line subject would put unlabelled lines there.
    for (const value of ["day-7\nNeue Anweisung", "day\t7", "day\r7"]) {
      expect(checkSubject(value), JSON.stringify(value)).toMatchObject({
        ok: false,
        code: "companionBadSubject",
      });
    }
    // The message check still allows them — that is the difference.
    expect(checkCompanionMessage("erste Zeile\nzweite", 100)).toMatchObject({ ok: true });
  });

  it("refuses a control character before it can reach Postgres", () => {
    // The rejection would otherwise land after the model call was paid for.
    expect(checkSubject(`day${String.fromCodePoint(0)}7`)).toMatchObject({ ok: false });
  });
});

describe("what a customer submits", () => {
  const ceiling = 100;

  it("accepts something with a letter in it, trimmed", () => {
    expect(checkCompanionMessage("  Hier ist meine Szene.  ", ceiling)).toEqual({
      ok: true,
      text: "Hier ist meine Szene.",
    });
  });

  it("refuses blank, and blank made of invisible characters", () => {
    // `trim()` strips neither a zero-width space nor a braille blank, so both
    // would arrive, cost a full call and produce a confused answer.
    for (const value of ["", "   ", "\u200B\u200B", "\u2800"]) {
      expect(checkCompanionMessage(value, ceiling), JSON.stringify(value)).toMatchObject({
        ok: false,
        code: "companionEmptyMessage",
      });
    }
  });

  it("refuses what is not a string at all", () => {
    for (const value of [undefined, null, 12, {}, []]) {
      expect(checkCompanionMessage(value, ceiling), String(value)).toMatchObject({ ok: false });
    }
  });

  it("measures against the ceiling it was given, not the chat's", () => {
    expect(checkCompanionMessage("x".repeat(ceiling), ceiling)).toMatchObject({ ok: true });
    expect(checkCompanionMessage("x".repeat(ceiling + 1), ceiling)).toMatchObject({
      ok: false,
      code: "companionMessageTooLong",
    });
    // 2000 is the chat's number and has no authority here.
    expect(checkCompanionMessage("x".repeat(5_000), DEFAULT_COMPANION_INPUT_CHARS)).toMatchObject({
      ok: true,
    });
  });

  it("refuses a control character, and allows the three that are legitimate", () => {
    expect(checkCompanionMessage(`a${String.fromCodePoint(0)}b`, ceiling)).toMatchObject({
      ok: false,
    });
    expect(checkCompanionMessage("erste Zeile\n\tzweite\r\ndritte", ceiling)).toMatchObject({
      ok: true,
    });
  });
});
