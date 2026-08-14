// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 Taking `owner` away must take the admin area away.
//
// `CLAUDE.md` → *Users & roles* says it in as many words — "a role is re-read
// from the DATABASE at the moment of each act, never taken from the session" —
// and `lib/authz.ts` said it again in its own docstring. Measured on 2026-08-14,
// neither was true: `auth.config.ts` puts `token.role` in the JWT at sign-in and
// only there, the session callback reads it back, `currentActiveUser()` checked
// the BLOCK freshly and not the role, and `setUserRole()` writes the column and
// nothing else — no session invalidation, no token bump, and Auth.js's default
// thirty idle-refreshing days on top.
//
// So an operator who took `owner` off somebody kept nothing from them: plans,
// token balances, deleting users, impersonation, appointing moderators. The
// block took effect at once; the role change did not.
//
// This file is the guard for that, and it drives the REAL `currentActiveUser()`
// against a session and a database that disagree — because the two agreeing is
// exactly the state in which the defect was invisible.
import { afterEach, describe, expect, it, vi } from "vitest";

const session = vi.fn();
const state = vi.fn();

vi.mock("@/auth", () => ({ auth: session }));
vi.mock("@/lib/users/blocked", () => ({ accountState: state }));

import { currentActiveUser } from "./authz";

/** A session as Auth.js hands it over, carrying whatever the token said. */
const signedInAs = (role: string) => ({
  user: { id: "member-1", email: "a@b.de", role },
  expires: "",
});

afterEach(() => {
  session.mockReset();
  state.mockReset();
});

describe("🚨 the role a guard believes comes from the database", () => {
  it("overrides a token that still says owner", async () => {
    // The whole defect, in one assertion: the JWT was signed while this person
    // was an owner, the column says member now.
    session.mockResolvedValue(signedInAs("owner"));
    state.mockResolvedValue({ blocked: false, role: "member" });

    const current = await currentActiveUser();
    expect(current.state).toBe("active");
    expect(
      current.state === "active" && current.session.user.role,
      "the guard is still reading the token — every requireOwner() in the app " +
        "would let this person through",
    ).toBe("member");
  });

  it("promotes as well — a token minted before the promotion is not a ceiling", async () => {
    // The other direction, and it is not symmetry for its own sake: without it
    // an operator who appoints somebody has to tell them to sign out and in
    // again, which is the kind of instruction that turns into "it does not
    // work".
    session.mockResolvedValue(signedInAs("member"));
    state.mockResolvedValue({ blocked: false, role: "owner" });

    const current = await currentActiveUser();
    expect(current.state === "active" && current.session.user.role).toBe("owner");
  });

  it("asks about the id in the session — which during an impersonation is the MEMBER's", async () => {
    // AD-23: while an Operator is signed in as a customer, `session.user.id` IS
    // the customer. Asking about that id is what keeps the answer the member's
    // own role rather than the operator's, with no guard modified to make it so.
    session.mockResolvedValue(signedInAs("member"));
    state.mockResolvedValue({ blocked: false, role: "member" });

    await currentActiveUser();
    expect(state).toHaveBeenCalledWith("member-1");
  });

  it("still refuses a blocked account before it looks at any role", async () => {
    session.mockResolvedValue(signedInAs("owner"));
    state.mockResolvedValue({ blocked: true, role: "owner" });

    expect((await currentActiveUser()).state).toBe("blocked");
  });

  it("keeps the token's role when the row is gone — that path is `blocked` anyway", async () => {
    // `accountState()` answers `{ blocked: true, role: null }` for a deleted
    // account, so this combination cannot occur; the `??` is there so that a
    // future caller cannot make `role` undefined by accident.
    session.mockResolvedValue(signedInAs("owner"));
    state.mockResolvedValue({ blocked: false, role: null });

    expect((await currentActiveUser()).state === "active").toBe(true);
  });

  it("hands back the very same session object when nothing changed", async () => {
    // Not a micro-optimisation: `auth()` may hand out a cached object, and a
    // guard that rewrote it in place would change what an unrelated caller in
    // the same request sees.
    const original = signedInAs("owner");
    session.mockResolvedValue(original);
    state.mockResolvedValue({ blocked: false, role: "owner" });

    const current = await currentActiveUser();
    expect(current.state === "active" && current.session).toBe(original);
  });

  it("does not mutate the session it was given when the role DID change", async () => {
    const original = signedInAs("owner");
    session.mockResolvedValue(original);
    state.mockResolvedValue({ blocked: false, role: "member" });

    await currentActiveUser();
    expect(original.user.role).toBe("owner");
  });

  it("is anonymous without a session, and asks the database nothing", async () => {
    session.mockResolvedValue(null);

    expect((await currentActiveUser()).state).toBe("anonymous");
    expect(state).not.toHaveBeenCalled();
  });
});
