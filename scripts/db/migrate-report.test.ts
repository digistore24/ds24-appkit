// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What db-migrate says when it fails — the one output in this project that is
// read exactly once, by somebody in a hurry, in a deploy log.
//
// The case behind the file: a freshly deployed app died on the first statement
// of its first migration and reported
//
//   ✗ Migration failed: Failed query: CREATE TYPE "public"."ipn_result" …
//
// which is the statement, not the reason. The reason — `type "ipn_result"
// already exists` — was sitting in `error.cause` the whole time, and without it
// the failure looks like a broken migration rather than the wrong database.
import { describe, expect, it } from "vitest";

import { diagnose, isLocal, rootCause } from "./migrate-report.mjs";

/** The real shape drizzle throws: its own error, the driver's underneath. */
function drizzleError(query: string, cause: { message: string; code: string }) {
  const inner = Object.assign(new Error(cause.message), { code: cause.code });
  return Object.assign(new Error(`Failed query: ${query}\nparams: `), { query, cause: inner });
}

describe("the reason is read out of the chain, not off the top", () => {
  it("takes the message from the cause", () => {
    const error = drizzleError("CREATE TYPE …", {
      message: 'type "ipn_result" already exists',
      code: "42710",
    });
    expect(rootCause(error).error?.message).toBe('type "ipn_result" already exists');
  });

  it("keeps the query drizzle put on the outer error", () => {
    const error = drizzleError("CREATE TYPE …", { message: "boom", code: "42710" });
    expect(rootCause(error).query).toBe("CREATE TYPE …");
  });

  it("reports the driver's code, which is what the diagnosis hangs on", () => {
    const error = drizzleError("CREATE TABLE …", { message: "boom", code: "42P07" });
    expect(rootCause(error).code).toBe("42P07");
  });

  it("copes with an error that has no cause at all", () => {
    const plain = new Error("connect ECONNREFUSED 127.0.0.1:15999");
    expect(rootCause(plain).error?.message).toBe("connect ECONNREFUSED 127.0.0.1:15999");
    expect(rootCause(plain).code).toBeNull();
  });

  // A chain that points at itself is a hang, not an error message.
  it("does not loop on a self-referential cause", () => {
    const error: Error & { cause?: unknown } = new Error("round");
    error.cause = error;
    expect(rootCause(error).error?.message).toBe("round");
  });
});

const LOCAL = "postgresql://app:app@localhost:15432/app";
const REMOTE = "postgresql://u:p@db.internal.example.com:5432/app";

describe("the diagnosis fires on the case it was written for", () => {
  it.each(["42P07", "42710", "42P06"])("explains a duplicate object (%s)", (code) => {
    const text = diagnose({ code, applied: 38, tables: 28, url: LOCAL });
    expect(text).toContain("did not come out of the chain in");
    expect(text).toContain("28 table(s)");
  });

  // 🚨 THE regression this file exists for. The first version gated on an empty
  // journal, and the foreign database that caused all this had 38 rows in its
  // own — so the diagnosis never printed on the exact failure it was written
  // for. A stranger's database is routinely a perfectly migrated one.
  it("prints even when the foreign database has a full migration journal", () => {
    expect(diagnose({ code: "42710", applied: 38, tables: 28, url: LOCAL })).toContain(
      "38 recorded",
    );
  });

  // The other half of the same trap: a first migration that fails takes the
  // journal table down with it, so there is nothing left to count.
  it("says so plainly when there is no journal to count", () => {
    expect(diagnose({ code: "42710", applied: null, tables: 28, url: LOCAL })).toContain(
      "no migration journal at all",
    );
  });
});

describe("it stays quiet when it would be guessing", () => {
  // A connection error is not a wrong database, and saying it might be sends
  // somebody to wipe a database over a typo in a hostname.
  it("adds nothing to an error that is not a duplicate", () => {
    expect(diagnose({ code: "28P01", applied: null, tables: 28, url: LOCAL })).toBe("");
    expect(diagnose({ code: null, applied: null, tables: 28, url: LOCAL })).toBe("");
  });

  // `tables` is the proof that the survey reached the database at all. Without
  // it, "I could not look" would go out as a finding.
  it.each([null, 0])("adds nothing when the table count is %s", (tables) => {
    expect(diagnose({ code: "42710", applied: null, tables, url: LOCAL })).toBe("");
  });
});

describe("what it offers depends on which database it is", () => {
  it("offers db-nuke on a local one", () => {
    expect(diagnose({ code: "42710", applied: 0, tables: 28, url: LOCAL })).toContain("db-nuke");
  });

  // The sharp end. This script runs in production deploys, and a wipe suggested
  // there is a suggestion somebody will follow at two in the morning.
  it("never offers it on anything else", () => {
    const text = diagnose({ code: "42710", applied: 0, tables: 28, url: REMOTE });
    expect(text).not.toContain("db-nuke");
    expect(text).toContain("never wipe it on a hunch");
  });

  it.each(["localhost", "127.0.0.1", "::1"])("counts %s as local", (host) => {
    expect(isLocal(`postgresql://app:app@${host === "::1" ? "[::1]" : host}:15432/app`)).toBe(true);
  });

  it.each([REMOTE, "not a url at all", ""])("counts %s as not local", (value) => {
    expect(isLocal(value)).toBe(false);
  });
});
