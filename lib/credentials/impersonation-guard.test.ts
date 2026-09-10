// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 **An impersonation must not leave a credential behind — enforced, not
// documented.**
//
// While an operator is signed in as a member (`session.user.impersonation` is
// set), the two operations that outlive the thirty minutes refuse: the password
// and the email address. The reasoning is in `lib/credentials/manage.ts`; what
// this file does is make it a build failure to stop doing it.
//
// The intent was already written down at the admin door
// (`app/dashboard/admin/users/actions.ts`): *"this action must never grow a
// 'set their password' sibling: a password the Operator chose is a password the
// Operator knows."* It was true of that file and not of these — an operator
// simply went to the member's own account page instead. Found 2026-08-18 (H-1).
//
// Two halves, and neither replaces the other. The mould is
// `modules/community/lib/impersonation-guard.test.ts`, which solves exactly this
// problem for the DM surfaces.
//
//   **Behavioural** — the refusal itself, and that it happens BEFORE anything is
//   read or written. If it ran after the SELECT, an impersonated operator would
//   still learn whether a password exists.
//
//   **Structural** — the source files are read and the enumeration asserted. It
//   proves the refusal is REACHED, which a behavioural test of one function
//   never can: the realistic failure is not a wrong condition, it is a fourth
//   credential-shaped function written next year by somebody who copied the
//   third.
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { blankComments } from "@/scripts/lib/source-text.mjs";
import { CREDENTIAL_ERROR_CODES } from "./rules";
import { EMAIL_CHANGE_ERROR_CODES } from "@/lib/email-change/rules";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const read = (file: string) => blankComments(readFileSync(join(ROOT, file), "utf8"));

// ── Behavioural: it refuses, and it refuses FIRST ──────────────────────────

// 🚨 The database is mocked to THROW. That is the assertion, not a convenience:
// a refusal that happens after the SELECT would show up here as the mock's
// error instead of the refusal's, and the test would go red.
vi.mock("@/db", () => ({
  db: {
    select: () => {
      throw new Error("the database was touched before the refusal");
    },
    update: () => {
      throw new Error("the database was touched before the refusal");
    },
    insert: () => {
      throw new Error("the database was touched before the refusal");
    },
    delete: () => {
      throw new Error("the database was touched before the refusal");
    },
  },
}));

describe("the credential seam refuses an impersonated session", () => {
  it("refuses to set a password, without reading anything", async () => {
    const { setPassword } = await import("./manage");
    await expect(
      setPassword(
        "member-1",
        { password: "a-long-enough-password", confirmation: "a-long-enough-password" },
        { impersonating: true },
      ),
    ).rejects.toMatchObject({ code: "notWhileImpersonating" });
  });

  it("refuses to remove a password, without reading anything", async () => {
    const { removePassword } = await import("./manage");
    await expect(
      removePassword("member-1", { current: "whatever" }, { impersonating: true }),
    ).rejects.toMatchObject({ code: "notWhileImpersonating" });
  });

  it("refuses to move the address, before even the transport check", async () => {
    // No mail transport is configured in this run either. The refusal has to
    // win that race, or the operator learns about the app's mail setup from a
    // door they are not allowed through.
    const { requestEmailChange } = await import("@/lib/email-change/manage");
    await expect(
      requestEmailChange("member-1", "new@example.com", { impersonating: true }),
    ).rejects.toMatchObject({ code: "notWhileImpersonating" });
  });

  it("lets an ordinary session through to the database", async () => {
    // The counter-proof: with `impersonating: false` the refusal is NOT what
    // stops it — the mocked database is. Without this, a guard that refused
    // unconditionally would pass every test above.
    const { setPassword } = await import("./manage");
    await expect(
      setPassword(
        "member-1",
        { password: "a-long-enough-password", confirmation: "a-long-enough-password" },
        { impersonating: false },
      ),
    ).rejects.toThrow(/database was touched/);
  });
});

// ── Structural: the enumeration, and that the callers tell the truth ───────

describe("every credential-shaped function carries the guard", () => {
  // 🚨 The list is the point. A function added here without an entry below is
  // invisible to this file, so the count is asserted too: `manage.ts` must not
  // grow an exported mutation that nobody thought about.
  const GUARDED = [
    { file: "lib/credentials/manage.ts", fn: "setPassword" },
    { file: "lib/credentials/manage.ts", fn: "removePassword" },
    { file: "lib/email-change/manage.ts", fn: "requestEmailChange" },
  ];

  it.each(GUARDED)("$fn refuses while impersonating", ({ file, fn }) => {
    const source = read(file);
    const start = source.indexOf(`export async function ${fn}(`);
    expect(start, `${fn} not found in ${file}`).toBeGreaterThan(-1);

    // The body from the signature to the next top-level export — enough to see
    // whether the refusal is in THIS function rather than merely in the file.
    const next = source.indexOf("\nexport ", start + 1);
    const body = source.slice(start, next === -1 ? undefined : next);

    expect(body).toMatch(/impersonat/i);
    expect(body).toMatch(/refuseWhileImpersonating\(|notWhileImpersonating/);
  });

  it("the guard is the FIRST statement of each body", () => {
    for (const { file, fn } of GUARDED) {
      const source = read(file);
      const start = source.indexOf(`export async function ${fn}(`);
      const open = source.indexOf("{", source.indexOf("):", start));
      const body = source.slice(open + 1, open + 900);
      const guard = body.search(/refuseWhileImpersonating\(|throw new EmailChangeError\("notWhileImpersonating"\)/);
      const db = body.search(/\bdb\s*\n?\s*\./);
      expect(guard, `${fn}: no guard found`).toBeGreaterThan(-1);
      if (db > -1) expect(guard, `${fn}: the guard runs after the database`).toBeLessThan(db);
    }
  });

  it("no credential-shaped export escaped the list", () => {
    // Mutating exports of the two manage files, enumerated. A new one here is a
    // deliberate red: decide whether it needs the guard, then add it above.
    const KNOWN: Record<string, string[]> = {
      "lib/credentials/manage.ts": [
        "signInState",
        "setPassword",
        "removePassword",
        "addressHasPassword",
        "mayMailSignInLink",
        "verifyPasswordLogin",
        "isRateLimited",
        "recordFailedAttempt",
        "clearAttempts",
        "resetAttempts",
      ],
      "lib/email-change/manage.ts": [
        "pendingChangeFor",
        "requestEmailChange",
        "confirmEmailChange",
      ],
    };
    for (const [file, expected] of Object.entries(KNOWN)) {
      const source = read(file);
      const found = [...source.matchAll(/export (?:async )?function (\w+)/g)].map((m) => m[1]);
      expect(found.sort(), `${file}: an export appeared or vanished`).toEqual(
        [...expected].sort(),
      );
    }
  });

  it("the callers pass the flag from the SESSION, not a literal", () => {
    // A call site that hard-codes `{ impersonating: false }` would satisfy the
    // type and defeat the whole thing.
    const source = read("app/dashboard/account/actions.ts");
    const sites = [...source.matchAll(/impersonating:\s*([^,\n}]+)/g)].map((m) => m[1].trim());
    expect(sites).toHaveLength(3);
    for (const site of sites) {
      expect(site).toBe("Boolean(session.user.impersonation)");
    }
  });

  it("both error catalogues carry the code, so a refusal has a sentence", () => {
    expect(CREDENTIAL_ERROR_CODES).toContain("notWhileImpersonating");
    expect(EMAIL_CHANGE_ERROR_CODES).toContain("notWhileImpersonating");
  });
});
