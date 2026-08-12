// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { MAX_EMAIL_LENGTH } from "./rules";

describe("normalizeEmail — length bound", () => {
  // A security bound, not a formatting one: the columns are unbounded `text`
  // and an address also becomes a key in the in-memory rate-limit map. Before
  // this cap the pattern accepted a 200,000-character address in a millisecond.
  it("refuses an address longer than RFC 5321 allows", async () => {
    const { normalizeEmail } = await import("./rules");
    const huge = "a".repeat(100_000) + "@" + "b".repeat(100_000) + ".de";
    expect(normalizeEmail(huge)).toBeNull();
  });

  it("accepts one exactly at the limit", async () => {
    const { normalizeEmail } = await import("./rules");
    const domain = "@example.de";
    const at = "a".repeat(MAX_EMAIL_LENGTH - domain.length) + domain;
    expect(at).toHaveLength(MAX_EMAIL_LENGTH);
    expect(normalizeEmail(at)).toBe(at);
  });

  it("refuses one character over", async () => {
    const { normalizeEmail } = await import("./rules");
    const domain = "@example.de";
    const over = "a".repeat(MAX_EMAIL_LENGTH - domain.length + 1) + domain;
    expect(normalizeEmail(over)).toBeNull();
  });

  it("still accepts an ordinary address", async () => {
    const { normalizeEmail } = await import("./rules");
    expect(normalizeEmail("  Sabine@Neu.DE ")).toBe("sabine@neu.de");
  });
});
import {
  canDeleteUser,
  canDeleteOwnAccount,
  canChangeRole,
  canCreateUser,
  canBlockUser,
  canChangeEmail,
  canSendLoginLink,
  canImpersonate,
  canStopImpersonating,
  impersonationExpired,
  IMPERSONATION_MINUTES,
  normalizeEmail,
} from "./rules";

const admin = { id: "u1", role: "owner" };
const secondAdmin = { id: "u2", role: "owner" };
const customer = { id: "u3", role: "member" };
const blockedCustomer = {
  id: "u4",
  role: "member",
  email: "blocked@example.com",
  blockedAt: new Date("2026-01-01"),
};
const moderator = { id: "u5", role: "moderator", email: "mod@example.com" };

describe("canDeleteOwnAccount", () => {
  // The Art. 17 self-service path. The neighbouring `canDeleteUser` refuses
  // self-deletion outright; here it is the entire point, and mixing the two up
  // is the mistake this pair of describes exists to prevent.
  it("lets a customer delete themselves", () => {
    expect(canDeleteOwnAccount(customer, 1)).toBeNull();
  });

  it("lets an admin delete themselves while another admin remains", () => {
    expect(canDeleteOwnAccount(admin, 2)).toBeNull();
  });

  it("refuses the last admin", () => {
    // Not for their sake — for the installation's. An app with no owner has no
    // way back in and no support desk that could let anyone in. The refusal is
    // temporary and in their own hands: promote somebody, then leave.
    expect(canDeleteOwnAccount(admin, 1)).toBe("lastOwnerDelete");
  });

  it("does not refuse a customer just because one admin exists", () => {
    // The owner count is about owners. A member is never the last one.
    expect(canDeleteOwnAccount(customer, 1)).toBeNull();
  });

  it("is not canDeleteUser with the same arguments", () => {
    // Belt and braces on the distinction: the admin-facing rule says no to
    // exactly the case this one says yes to.
    expect(canDeleteUser(customer, customer, 2)).not.toBeNull();
    expect(canDeleteOwnAccount(customer, 2)).toBeNull();
  });
});

describe("canDeleteUser", () => {
  it("lets an admin delete a customer", () => {
    expect(canDeleteUser(admin, customer, 1)).toBeNull();
  });

  it("refuses non-admins", () => {
    expect(canDeleteUser(customer, admin, 2)).toBe("notOwner");
  });

  it("refuses deleting yourself", () => {
    expect(canDeleteUser(admin, admin, 2)).toBe("selfDelete");
  });

  it("refuses deleting the last admin", () => {
    expect(canDeleteUser(admin, secondAdmin, 1)).toBe("lastOwnerDelete");
  });

  it("allows deleting an admin while others remain", () => {
    expect(canDeleteUser(admin, secondAdmin, 2)).toBeNull();
  });
});

describe("canChangeRole", () => {
  it("lets an admin promote a customer to admin", () => {
    expect(canChangeRole(admin, customer, "owner", 1)).toBeNull();
  });

  it("refuses non-admins", () => {
    expect(canChangeRole(customer, customer, "owner", 1)).toBe("notOwner");
  });

  it("refuses demoting yourself", () => {
    expect(canChangeRole(admin, admin, "member", 2)).toBe("selfDemote");
  });

  it("refuses demoting the last admin", () => {
    expect(canChangeRole(admin, secondAdmin, "member", 1)).toBe("lastOwnerRole");
  });

  it("allows demoting an admin while others remain", () => {
    expect(canChangeRole(admin, secondAdmin, "member", 2)).toBeNull();
  });

  it("allows setting the role that already applies, as a no-op", () => {
    // Also for the last admin: owner -> owner changes nothing and is allowed.
    expect(canChangeRole(admin, admin, "owner", 1)).toBeNull();
  });
});

describe("canCreateUser", () => {
  it("allows admins", () => {
    expect(canCreateUser(admin)).toBeNull();
  });
  it("refuses customers", () => {
    expect(canCreateUser(customer)).toBe("notOwner");
  });
});

describe("canBlockUser", () => {
  it("lets an admin block a customer", () => {
    expect(canBlockUser(admin, customer, 1, true)).toBeNull();
  });

  it("refuses non-admins", () => {
    expect(canBlockUser(customer, admin, 2, true)).toBe("notOwner");
  });

  it("refuses blocking yourself", () => {
    // Otherwise nobody could reach the account to lift the block again.
    expect(canBlockUser(admin, admin, 2, true)).toBe("selfBlock");
  });

  it("refuses blocking the last admin", () => {
    expect(canBlockUser(admin, secondAdmin, 1, true)).toBe("lastOwnerBlock");
  });

  it("allows blocking an admin while others remain", () => {
    expect(canBlockUser(admin, secondAdmin, 2, true)).toBeNull();
  });

  it("always allows unblocking — even the last admin, even yourself", () => {
    // Unblocking grants nobody rights they did not already have. A state you
    // cannot get out of, on the other hand, would be a trap.
    expect(canBlockUser(admin, secondAdmin, 1, false)).toBeNull();
    expect(canBlockUser(admin, admin, 1, false)).toBeNull();
  });

  it("refuses unblocking too when the actor is not an admin", () => {
    expect(canBlockUser(customer, blockedCustomer, 2, false)).toBe("notOwner");
  });
});

describe("canChangeEmail", () => {
  it("allows admins", () => {
    expect(canChangeEmail(admin)).toBeNull();
  });
  it("refuses customers", () => {
    expect(canChangeEmail(customer)).toBe("notOwner");
  });
});

describe("canSendLoginLink", () => {
  const customerWithEmail = { ...customer, email: "customer@example.com" };

  it("lets an admin send a customer a link", () => {
    expect(canSendLoginLink(admin, customerWithEmail)).toBeNull();
  });

  it("refuses non-admins", () => {
    expect(canSendLoginLink(customer, customerWithEmail)).toBe("notOwner");
  });

  it("refuses accounts without an email address", () => {
    expect(canSendLoginLink(admin, { ...customer, email: null })).toBe(
      "userWithoutEmail",
    );
  });

  it("refuses blocked accounts", () => {
    // A link that invites you to sign in and is then rejected only confuses —
    // the block applies anyway (auth.ts).
    expect(canSendLoginLink(admin, blockedCustomer)).toBe("userBlocked");
  });
});

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Owner@Example.COM ")).toBe("owner@example.com");
  });

  it("rejects unusable input", () => {
    for (const bad of ["", "no-at", "a@b", "a b@c.de", null, 42, undefined]) {
      expect(normalizeEmail(bad)).toBeNull();
    }
  });
});

describe("canImpersonate", () => {
  const on = { enabled: true, alreadyImpersonating: false };

  it("lets an admin sign in as a customer", () => {
    expect(canImpersonate(admin, customer, on)).toBeNull();
  });

  it("refuses a customer", () => {
    expect(canImpersonate(customer, admin, on)).toBe("notOwner");
  });

  it("refuses while the feature is switched off", () => {
    expect(
      canImpersonate(admin, customer, { ...on, enabled: false }),
    ).toBe("impersonationDisabled");
  });

  // A chain has no end anybody can see, and the record could not say who is
  // really at the keyboard.
  it("refuses a second impersonation from inside one", () => {
    expect(
      canImpersonate(admin, customer, { ...on, alreadyImpersonating: true }),
    ).toBe("alreadyImpersonating");
  });

  it("refuses yourself", () => {
    expect(canImpersonate(admin, admin, on)).toBe("selfImpersonate");
  });

  // THE privilege-escalation rule. Every guard in this app answers from
  // session.user.role, so this would hand over every right the target holds.
  // It lives here rather than in the menu because a request that never passed
  // through the menu has to be refused identically.
  it("refuses another admin", () => {
    expect(canImpersonate(admin, secondAdmin, on)).toBe("ownerImpersonate");
  });

  it("refuses an admin target even when the menu never rendered", () => {
    // The same call an attacker would make straight against the server action.
    expect(canImpersonate(admin, { id: "u9", role: "owner" }, on)).toBe(
      "ownerImpersonate",
    );
  });

  // Not because a blocked account is uninteresting: requireActiveUser() sends a
  // blocked session to /login, and the way out lives inside the app — the
  // Operator would be stranded in a session they can neither see nor end.
  it("refuses a blocked customer", () => {
    expect(canImpersonate(admin, blockedCustomer, on)).toBe("userBlocked");
  });

  it("checks the role before anything else, so a customer learns nothing", () => {
    // A member poking at the action gets "notOwner" whatever else is true —
    // never "that account is blocked", which would be an oracle.
    expect(canImpersonate(customer, blockedCustomer, on)).toBe("notOwner");
  });
});

// ---------------------------------------------------------------------------
// The third role (Story 19.2, FR-204). One describe per decided answer, so a
// change to any of them has to look a test in the eye.
// ---------------------------------------------------------------------------

describe("a moderator actor is refused by every admin rule", () => {
  // A moderator manages neither users nor roles nor anything billing: every
  // rule that asks `actor.role !== "owner"` answers notOwner. requireOwner()
  // gives the same answer server-side (isOwner("moderator") is false).
  it("cannot delete users", () => {
    expect(canDeleteUser(moderator, customer, 2)).toBe("notOwner");
  });

  it("cannot change roles — including granting moderator", () => {
    expect(canChangeRole(moderator, customer, "moderator", 2)).toBe("notOwner");
    expect(canChangeRole(moderator, customer, "owner", 2)).toBe("notOwner");
  });

  it("cannot create users", () => {
    expect(canCreateUser(moderator)).toBe("notOwner");
  });

  it("cannot block or unblock", () => {
    expect(canBlockUser(moderator, customer, 2, true)).toBe("notOwner");
    expect(canBlockUser(moderator, blockedCustomer, 2, false)).toBe("notOwner");
  });

  it("cannot change email addresses", () => {
    expect(canChangeEmail(moderator)).toBe("notOwner");
  });

  it("cannot send sign-in links", () => {
    expect(
      canSendLoginLink(moderator, { ...customer, email: "c@example.com" }),
    ).toBe("notOwner");
  });

  it("cannot impersonate anybody", () => {
    expect(
      canImpersonate(moderator, customer, {
        enabled: true,
        alreadyImpersonating: false,
      }),
    ).toBe("notOwner");
  });
});

describe("the owner alone grants and revokes the moderator role", () => {
  it("owner makes a member a moderator", () => {
    expect(canChangeRole(admin, customer, "moderator", 1)).toBeNull();
  });

  it("owner makes a moderator a member again", () => {
    expect(canChangeRole(admin, moderator, "member", 1)).toBeNull();
  });

  it("owner promotes a moderator to owner", () => {
    expect(canChangeRole(admin, moderator, "owner", 1)).toBeNull();
  });

  it("owner demoting THEMSELVES to moderator is selfDemote", () => {
    // A moderator is not an admin — owner→moderator loses admin access
    // exactly like owner→member would.
    expect(canChangeRole(admin, admin, "moderator", 2)).toBe("selfDemote");
  });
});

describe("last-owner rules are untouched by moderators", () => {
  // ownerCount counts OWNERS and nothing else (countOwners() in manage.ts is
  // scoped to role = 'owner'). These tests pass ownerCount explicitly: a
  // moderator existing changes no count and opens no way back into a
  // locked-out app.
  it("the last owner stays undeletable however many moderators exist", () => {
    expect(canDeleteUser(admin, secondAdmin, 1)).toBe("lastOwnerDelete");
  });

  it("the last owner cannot be demoted to moderator", () => {
    expect(canChangeRole(admin, secondAdmin, "moderator", 1)).toBe(
      "lastOwnerRole",
    );
  });

  it("the last owner stays unblockable however many moderators exist", () => {
    expect(canBlockUser(admin, secondAdmin, 1, true)).toBe("lastOwnerBlock");
  });

  it("a moderator never trips a last-owner refusal", () => {
    // Even with only one owner in the app, acting on a MODERATOR is free:
    // they are not the way back in.
    expect(canDeleteUser(admin, moderator, 1)).toBeNull();
    expect(canChangeRole(admin, moderator, "member", 1)).toBeNull();
    expect(canBlockUser(admin, moderator, 1, true)).toBeNull();
  });
});

describe("a moderator is blocked like any member", () => {
  // "The block strips nothing extra" means: no moderator branch exists in
  // canBlockUser at all. Blocking ends the session (lib/users/blocked.ts),
  // and duties are inert without a usable account (FR-204).
  it("blocking a moderator is allowed, no special case", () => {
    expect(canBlockUser(admin, moderator, 1, true)).toBeNull();
  });

  it("unblocking a moderator is allowed", () => {
    expect(canBlockUser(admin, moderator, 1, false)).toBeNull();
  });
});

describe("canImpersonate stays operator→member — the full matrix", () => {
  const on = { enabled: true, alreadyImpersonating: false };

  it("owner → member is the one allowed pair", () => {
    expect(canImpersonate(admin, customer, on)).toBeNull();
  });

  it("owner → moderator is refused with its own code", () => {
    // Not escalation (an impersonated session's role is `member` either way):
    // a moderator's badge in a room must never be an operator in disguise.
    expect(canImpersonate(admin, moderator, on)).toBe("moderatorImpersonate");
  });

  it("owner → owner stays refused", () => {
    expect(canImpersonate(admin, secondAdmin, on)).toBe("ownerImpersonate");
  });

  it("a moderator actor is refused", () => {
    expect(canImpersonate(moderator, customer, on)).toBe("notOwner");
  });

  it("a blocked target stays refused", () => {
    expect(canImpersonate(admin, blockedCustomer, on)).toBe("userBlocked");
  });
});

describe("canStopImpersonating", () => {
  it("lets a running impersonation end", () => {
    expect(canStopImpersonating({ alreadyImpersonating: true })).toBeNull();
  });

  it("refuses when there is nothing to end", () => {
    expect(canStopImpersonating({ alreadyImpersonating: false })).toBe(
      "notImpersonating",
    );
  });

  // The regression this guards: somebody reads the exit action, sees no
  // requireOwner(), reads it as an oversight and "fixes" it. During an
  // impersonation the session's role IS the member's (AD-23), so an owner check
  // here refuses the only way out. The rule takes no role at all — it CANNOT be
  // made to depend on one without changing its signature, which is the point.
  it("does not consider the actor's role at all", () => {
    expect(canStopImpersonating.length).toBe(1);
  });
});

describe("impersonationExpired", () => {
  const start = new Date("2026-07-25T10:00:00Z").getTime();
  const expiresAt = start + IMPERSONATION_MINUTES * 60_000;

  it("is not expired one minute in", () => {
    expect(impersonationExpired(expiresAt, start + 60_000)).toBe(false);
  });

  it("is not expired one millisecond before the cap", () => {
    expect(impersonationExpired(expiresAt, expiresAt - 1)).toBe(false);
  });

  it("is expired exactly at the cap", () => {
    expect(impersonationExpired(expiresAt, expiresAt)).toBe(true);
  });

  it("is expired long after", () => {
    expect(impersonationExpired(expiresAt, expiresAt + 86_400_000)).toBe(true);
  });

  it("caps at thirty minutes", () => {
    expect(IMPERSONATION_MINUTES).toBe(30);
  });
});
