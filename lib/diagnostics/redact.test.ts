// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Redaction has two failure modes and they pull in opposite directions.
//
// Under-redact and a member's address leaves the process in an HTTP response.
// Over-redact and the location and the code frame — the entire product of
// `node run.mjs errors` — turn into `<number>` soup, at which point the command
// is green-looking noise. So both directions are tested, and the two
// must-survive lines are captured from the real log fixture in
// `parse.test.ts` rather than invented here.

import { describe, expect, it } from "vitest";

import { MAX_LINE_CHARS, redactLine } from "./redact.mjs";

describe("what must not survive", () => {
  it("takes an address out of a Postgres unique violation", () => {
    // The shape this rule exists for: a member's address arrives in an error
    // message nobody wrote, from a constraint nobody thought about.
    const line =
      'Error: duplicate key value violates unique constraint "users_email_unique" ' +
      "Key (email)=(anna@example.com)";
    const out = redactLine(line);
    expect(out).not.toContain("anna@example.com");
    expect(out).toContain("<email>");
    // …and the rest of the sentence is intact, or the finding says nothing.
    expect(out).toContain("users_email_unique");
  });

  it("takes a bearer token out, and keeps the word that identifies the shape", () => {
    const out = redactLine("  authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc.def");
    expect(out).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(out).toBe("  authorization: Bearer <secret>");
  });

  it("takes this app's own key prefixes out", () => {
    expect(redactLine("key=ds24api_AbC-123_xyz")).toBe("key=<secret>");
    expect(redactLine("key=ds24setup_AbC-123_xyz")).toBe("key=<secret>");
  });

  it("takes a provider key out", () => {
    expect(redactLine("OPENAI_API_KEY=sk-proj-AbCdEfGh12345678")).toBe(
      "OPENAI_API_KEY=<secret>",
    );
  });

  it("takes a long hex run out — a session token, a hash, a raw secret", () => {
    const hex = "a".repeat(48);
    expect(redactLine(`token ${hex} rejected`)).toBe("token <secret> rejected");
  });

  it("takes a UUID out — it is an identifier of a row about somebody", () => {
    expect(redactLine("member 3f2504e0-4f89-11d3-9a0c-0305e82c3301 not found")).toBe(
      "member <id> not found",
    );
  });

  it("takes a connection string out, password and host together", () => {
    const out = redactLine("ECONNREFUSED postgres://app:hunter2@db.internal:5432/app");
    expect(out).not.toContain("hunter2");
    expect(out).not.toContain("db.internal");
    expect(out).toBe("ECONNREFUSED <dsn>");
  });

  it("takes a long digit run out", () => {
    expect(redactLine("order 4711000123456 refunded")).toBe("order <number> refunded");
  });

  it("caps a pathological line, visibly", () => {
    const out = redactLine("x".repeat(MAX_LINE_CHARS + 200));
    expect(out).toHaveLength(MAX_LINE_CHARS + 1);
    expect(out.endsWith("…")).toBe(true);
  });

  it("redacts BEFORE it cuts", () => {
    // A secret past the cut must not be dropped by the cut alone — the cut can
    // land inside one, and a half-secret in a response is still a secret.
    const out = redactLine(`${"x".repeat(MAX_LINE_CHARS - 5)}anna@example.com tail`);
    expect(out).not.toContain("anna@example.com");
  });
});

describe("what must survive — this is the product", () => {
  it("leaves a stack line with its file, line and column alone", () => {
    const line =
      "    at AdminChallengePage (app/dashboard/admin/challenges/[id]/page.tsx:161:35)";
    expect(redactLine(line)).toBe(line);
  });

  it("leaves a code frame alone", () => {
    const line = '> 174 |   {format.dateTime(person.since, { dateStyle: "medium" })}';
    expect(redactLine(line)).toBe(line);
  });

  it("leaves the headline of a next-intl formatting error alone", () => {
    const line = "Error: FORMATTING_ERROR: Invalid time value";
    expect(redactLine(line)).toBe(line);
  });

  it("leaves an ordinary request line alone", () => {
    const line = " GET /dashboard/admin/challenges 200 in 624ms (next.js: 518ms)";
    expect(redactLine(line)).toBe(line);
  });
});
