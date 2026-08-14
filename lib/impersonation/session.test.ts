// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 The callback that turns one person into another.
//
// `applyImpersonationUpdate()` runs inside Auth.js's `jwt` callback (`auth.ts`)
// and rewrites who the session is. Measured before this file existed:
// **`lib/impersonation/session.ts` was at 0 % — 0 of 63 statements, 0 of its
// branches** — while `claim.ts`, the pure half beside it, sat at 100 %. The
// tested part was the part that decides nothing.
//
// Thirteen branches live here and every one of them is a security decision. The
// sharpest is line 122, whose own comment says it plainly: *"Everything above
// is lookup. This line is the authorisation … Deleting it turns this module
// into an account-takeover endpoint."*
//
// ── Why this is cheap, which is the reason it is inexcusable that it was 0 ──
// `session.ts` has exactly two static imports and both are pure (`./claim` and
// a type). Everything with I/O — `./manage`, `@/db`, the schema, drizzle — is a
// dynamic `await import()` INSIDE the functions. So two mocks are the whole
// setup: no database, no Auth.js, no request.
//
// **Measured, and the first needle is the interesting one:**
//
//   · `row.operatorId !== caller` DELETED — `npm run typecheck` goes red, but
//     for a type reason and not a security one: the comparison is also what
//     narrows `operatorId` from `string | null`, so `inArray()` stops
//     type-checking. Declare that column non-null one day and the deletion
//     compiles. So the honest needle keeps the narrowing and removes only the
//     authorisation (`row.operatorId === null`): **typecheck clean, 2 red.**
//     One of those two is `impersonation-guard.test.ts`, which already asserted
//     that the line EXISTS — this file is the half that asserts it WORKS.
//   · the allowlist turned into a denylist (`member.role === "owner"`):
//     typecheck clean, **4 red** — a moderator and an invented role both get
//     impersonated.
//
// ⚠️ What this does NOT claim: that impersonation works over real HTTP, or that
// the server action in front of it refuses what it should. The action has its
// own rule (`canImpersonate()` in `lib/users/rules.ts`, tested there), and
// whether the deployed app serves the flow is `make deploy-test`'s question.
// This file is about the layer that runs AFTER both — the one that must refuse
// again, because the row and this callback are two separate requests.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { findOpenImpersonation, closeImpersonation, selected } = vi.hoisted(() => ({
  findOpenImpersonation: vi.fn(),
  closeImpersonation: vi.fn(async () => undefined),
  /** What the `users` lookup answers with. */
  selected: { rows: [] as unknown[] },
}));

vi.mock("./manage", () => ({ findOpenImpersonation, closeImpersonation }));

// The `users` read is a plain select; what matters here is which rows come
// back, never how the query is built. `manage.test.ts` beside this file is
// where the statements themselves are asserted.
vi.mock("@/db", () => {
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.where = () => chain;
  chain.limit = () => Promise.resolve(selected.rows);
  // `startImpersonating` awaits the builder itself (no `.limit()`).
  (chain as { then: unknown }).then = (resolve: (v: unknown) => unknown) =>
    resolve(selected.rows);
  return { db: { select: () => chain } };
});

import { IMPERSONATION_CLAIM } from "./claim";
import { applyImpersonationUpdate } from "./session";

const OPERATOR = {
  id: "operator-1",
  email: "chef@example.com",
  name: "Chefin",
  image: null,
  role: "owner",
  blockedAt: null,
};
const MEMBER = {
  id: "member-9",
  email: "kundin@example.com",
  name: "Kundin",
  image: null,
  role: "member",
  blockedAt: null,
};

const RECORD = {
  id: "imp-1",
  operatorId: OPERATOR.id,
  memberId: MEMBER.id,
  startedAt: new Date("2026-08-13T09:00:00.000Z"),
  expiresAt: new Date("2026-08-13T09:30:00.000Z"),
};

/** A signed-in operator's token, before anything happened. */
function operatorToken(over: Record<string, unknown> = {}) {
  return { sub: OPERATOR.id, role: "owner", email: OPERATOR.email, ...over } as Record<
    string,
    unknown
  >;
}

/** A token that is already inside an impersonation. */
function impersonatingToken(expiresAt = Date.now() + 60_000) {
  return {
    sub: MEMBER.id,
    role: "member",
    email: MEMBER.email,
    [IMPERSONATION_CLAIM]: {
      id: RECORD.id,
      operatorId: OPERATOR.id,
      operatorEmail: OPERATOR.email,
      operatorRole: "owner",
      memberEmail: MEMBER.email,
      expiresAt,
    },
  } as Record<string, unknown>;
}

const start = (id = RECORD.id) => ({ impersonation: { start: id } });
const stop = { impersonation: { stop: true } };

beforeEach(() => {
  vi.clearAllMocks();
  findOpenImpersonation.mockResolvedValue(RECORD);
  selected.rows = [OPERATOR, MEMBER];
});

describe("applyImpersonationUpdate — what it does with a payload at all", () => {
  it("ignores a payload that asks for nothing", async () => {
    const token = operatorToken();
    await expect(applyImpersonationUpdate(token, {})).resolves.toBe(token);
    await expect(applyImpersonationUpdate(token, null)).resolves.toBe(token);
    await expect(applyImpersonationUpdate(token, { impersonation: {} })).resolves.toBe(token);
    expect(findOpenImpersonation).not.toHaveBeenCalled();
  });

  it("ignores `stop` that is not exactly `true`", async () => {
    // `"stop" in request && request.stop === true` — a truthy value is not a
    // request to stop, and neither is a string.
    const token = impersonatingToken();
    await expect(
      applyImpersonationUpdate(token, { impersonation: { stop: "yes" } }),
    ).resolves.toBe(token);
    expect(closeImpersonation).not.toHaveBeenCalled();
  });
});

describe("🚨 starting — the authorisation, and the four refusals around it", () => {
  it("swaps the session to the member when everything agrees", async () => {
    // The positive case. Without it every refusal below could be satisfied by a
    // function that refuses everything.
    const token = await applyImpersonationUpdate(operatorToken(), start());

    expect(token?.sub).toBe(MEMBER.id);
    expect(token?.role).toBe("member");
    expect(token?.email).toBe(MEMBER.email);
    expect(token?.[IMPERSONATION_CLAIM]).toMatchObject({
      id: RECORD.id,
      operatorId: OPERATOR.id,
      operatorEmail: OPERATOR.email,
      memberEmail: MEMBER.email,
      expiresAt: RECORD.expiresAt.getTime(),
    });
  });

  it("🚨 refuses when the row names a DIFFERENT operator", async () => {
    // THE check. The record — not the request — is the authorisation: the row
    // has to name the caller as the operator who opened it. A caller who knows
    // or guesses somebody else's record id gets nothing.
    const token = await applyImpersonationUpdate(
      operatorToken({ sub: "somebody-else" }),
      start(),
    );

    expect(token?.sub, "the session was swapped for a record that is not theirs").toBe(
      "somebody-else",
    );
    expect(token?.[IMPERSONATION_CLAIM]).toBeUndefined();
  });

  it("refuses when the caller has no id at all", async () => {
    const token = await applyImpersonationUpdate({ role: "owner" }, start());
    expect(token?.[IMPERSONATION_CLAIM]).toBeUndefined();
    expect(findOpenImpersonation, "looked the record up before knowing who asked").not
      .toHaveBeenCalled();
  });

  it("refuses when there is no open record — an ended or expired one is none", async () => {
    // `findOpenImpersonation()` filters on `endedAt IS NULL` and a future
    // `expiresAt`; a spent id must not be replayable. That filter is asserted
    // in `manage.test.ts`; this is the half that acts on its answer.
    findOpenImpersonation.mockResolvedValue(null);

    const token = await applyImpersonationUpdate(operatorToken(), start());
    expect(token?.sub).toBe(OPERATOR.id);
    expect(token?.[IMPERSONATION_CLAIM]).toBeUndefined();
  });

  it("refuses when either account has since disappeared", async () => {
    selected.rows = [OPERATOR];

    const token = await applyImpersonationUpdate(operatorToken(), start());
    expect(token?.sub).toBe(OPERATOR.id);
    expect(token?.[IMPERSONATION_CLAIM]).toBeUndefined();
  });

  it("🚨 refuses an operator who is no longer an owner", async () => {
    // Defence in depth: the rule refused this before the row was written, but
    // the row and this callback are two separate requests and an account can
    // change between them.
    selected.rows = [{ ...OPERATOR, role: "member" }, MEMBER];

    const token = await applyImpersonationUpdate(operatorToken(), start());
    expect(token?.sub).toBe(OPERATOR.id);
    expect(token?.[IMPERSONATION_CLAIM]).toBeUndefined();
  });

  it("🚨 refuses a target who is a MODERATOR — the allowlist, not a denylist", async () => {
    // The lesson this line carries: `canImpersonate()` gained
    // `moderatorImpersonate` for Story 19.2 while this layer still asked only
    // about `"owner"`, so the second refusal silently stopped mirroring the
    // first. `users.role` is `text` with no enum, so a denylist here goes stale
    // every time somebody adds a role — silently, which is the one failure mode
    // a defence-in-depth layer cannot afford.
    selected.rows = [OPERATOR, { ...MEMBER, role: "moderator" }];

    const token = await applyImpersonationUpdate(operatorToken(), start());
    expect(token?.sub, "a moderator was impersonated").toBe(OPERATOR.id);
    expect(token?.[IMPERSONATION_CLAIM]).toBeUndefined();
  });

  it("…and refuses a target with any other role a future story invents", async () => {
    // The allowlist's actual claim, which a denylist cannot make: an unknown
    // role is refused because it is not `member`, not because somebody
    // remembered to add it.
    selected.rows = [OPERATOR, { ...MEMBER, role: "auditor" }];

    const token = await applyImpersonationUpdate(operatorToken(), start());
    expect(token?.[IMPERSONATION_CLAIM]).toBeUndefined();
  });

  it("refuses a blocked target", async () => {
    selected.rows = [OPERATOR, { ...MEMBER, blockedAt: new Date() }];

    const token = await applyImpersonationUpdate(operatorToken(), start());
    expect(token?.[IMPERSONATION_CLAIM]).toBeUndefined();
  });

  it("🚨 refuses to chain — a RUNNING impersonation cannot start another", async () => {
    const token = await applyImpersonationUpdate(impersonatingToken(), start("imp-2"));

    expect(token?.[IMPERSONATION_CLAIM]).toMatchObject({ id: RECORD.id });
    expect(findOpenImpersonation, "looked up a second record while inside one").not
      .toHaveBeenCalled();
  });

  it("…but an EXPIRED claim is a leftover, not a running session", async () => {
    // The distinction between STATE and presence. Refusing on presence alone
    // would lock an operator out of the feature for the rest of their sign-in
    // the first time they let one time out — with no way to tell why.
    const token = await applyImpersonationUpdate(
      impersonatingToken(Date.now() - 60_000),
      start(),
    );

    expect(token?.sub).toBe(MEMBER.id);
    expect(token?.[IMPERSONATION_CLAIM]).toMatchObject({ id: RECORD.id });
  });
});

describe("stopping — the record closes either way", () => {
  it("restores the operator from the CLAIM, never from the request", async () => {
    selected.rows = [OPERATOR];

    const token = await applyImpersonationUpdate(impersonatingToken(), stop);

    expect(token?.sub).toBe(OPERATOR.id);
    expect(token?.role).toBe("owner");
    expect(token?.[IMPERSONATION_CLAIM]).toBeUndefined();
  });

  it("closes the record as `operator` when they left on purpose", async () => {
    selected.rows = [OPERATOR];
    await applyImpersonationUpdate(impersonatingToken(), stop);
    expect(closeImpersonation).toHaveBeenCalledWith(RECORD.id, "operator");
  });

  it("🚨 closes it as `expired` when the cap had passed — derived, never sent", async () => {
    // Only a label on the record page, but a label somebody else gets to choose
    // is a label that can be made to lie — and this one is read by whoever is
    // answering "was an admin really in my account for thirty minutes?"
    selected.rows = [OPERATOR];
    await applyImpersonationUpdate(impersonatingToken(Date.now() - 60_000), stop);
    expect(closeImpersonation).toHaveBeenCalledWith(RECORD.id, "expired");
  });

  it("🚨 destroys the session when the operator was demoted while inside", async () => {
    // `null` lands them on /login. Restoring a role they no longer hold is the
    // alternative, and it is not one.
    selected.rows = [{ ...OPERATOR, role: "member" }];

    await expect(applyImpersonationUpdate(impersonatingToken(), stop)).resolves.toBeNull();
  });

  it("…and when they were blocked, or deleted", async () => {
    selected.rows = [{ ...OPERATOR, blockedAt: new Date() }];
    await expect(applyImpersonationUpdate(impersonatingToken(), stop)).resolves.toBeNull();

    selected.rows = [];
    await expect(applyImpersonationUpdate(impersonatingToken(), stop)).resolves.toBeNull();
  });

  it("🚨 closes the record even when there is nowhere to return to", async () => {
    // The two halves are independent: the operator LEFT, and an open row would
    // be a lie about that whatever became of their account.
    selected.rows = [];

    await applyImpersonationUpdate(impersonatingToken(), stop);
    expect(closeImpersonation, "the row stayed open on a destroyed session").toHaveBeenCalledWith(
      RECORD.id,
      "operator",
    );
  });

  it("does nothing on a token that carries no claim", async () => {
    const token = operatorToken();
    await expect(applyImpersonationUpdate(token, stop)).resolves.toBe(token);
    expect(closeImpersonation).not.toHaveBeenCalled();
  });
});
