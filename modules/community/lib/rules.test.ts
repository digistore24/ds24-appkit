// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";

import { CHAT_RATE_BUCKET } from "@/lib/ai/rules";
import { planProblem } from "@/lib/media/config";
import { keysOrSkip, planShapedKey, tokenKey } from "@/lib/digistore/test-product-keys";

import {
  COMMUNITY_DM_RATE_BUCKET,
  COMMUNITY_ERROR_CODES,
  COMMUNITY_POST_RATE_BUCKET,
  CommunityError,
  GROUP_ACCESS_LEVELS,
  MAX_DISCUSSION_TITLE_LENGTH,
  MAX_MESSAGE_LENGTH,
  MAX_POST_LENGTH,
  MAX_COMMUNITY_ABOUT_LENGTH,
  MAX_COMMUNITY_DISPLAY_NAME_LENGTH,
  MAX_GROUP_DESCRIPTION_LENGTH,
  MAX_GROUP_NAME_LENGTH,
  canDeleteOwnPost,
  canEditOwnPost,
  canParticipate,
  canSendMessage,
  canonicalPair,
  compareCursor,
  counterpartOf,
  canPost,
  canStartDiscussion,
  checkCommunityAbout,
  checkCommunityDisplayName,
  checkDiscussionTitle,
  checkGroupDescription,
  checkGroupName,
  checkMessageContent,
  checkPostContent,
  checkPostImages,
  MAX_IMAGE_ALT_LENGTH,
  contentState,
  communityNavVisible,
  displayNameFor,
  groupPlanProblems,
  hasUnread,
  isGroupAccessLevel,
  isParticipant,
  advanceCursor,
  liveCursorBeginning,
  liveCursorToken,
  mayEnterGroup,
  messageLimit,
  mayViewEmbed,
  parseCursorToken,
  parseLiveCursorToken,
  planKeysToResolve,
  pollDelayMs,
  pollInstants,
  cursorToken,
  postLimit,
  postSegments,
  titleState,
  type Cursor,
  type GroupAccessLevel,
  type LiveCursor,
} from "./rules";

describe("communityNavVisible", () => {
  it("shows the entry to everyone when the community is usable", () => {
    expect(communityNavVisible(true, true, false)).toBe(true);
    expect(communityNavVisible(true, true, true)).toBe(true);
  });

  it("keeps the entry for the operator when wanted but not usable", () => {
    // Switched on but incoherent: the operator must keep the route to the
    // diagnosis — hiding the broken feature must not hide the page that
    // names the fault.
    expect(communityNavVisible(false, true, true)).toBe(true);
    expect(communityNavVisible(false, true, false)).toBe(false);
  });

  it("shows nothing to anybody when not wanted — the operator included", () => {
    // Disabled means gone, for everyone (AD-67). There is no operator
    // preview of a community that is switched off.
    expect(communityNavVisible(false, false, true)).toBe(false);
    expect(communityNavVisible(false, false, false)).toBe(false);
  });
});

const UUID = "3f2a91c4-7b0e-4d18-9a55-0c6b2e8f41d7";

describe("displayNameFor", () => {
  it("prefers the name the member chose for the community", () => {
    expect(
      displayNameFor({
        profileName: "Ada",
        accountName: "A. Lovelace",
        memberId: UUID,
        placeholderLabel: "Member",
      }),
    ).toBe("Ada");
  });

  it("falls back to the account name when no profile name exists", () => {
    expect(
      displayNameFor({
        profileName: null,
        accountName: "A. Lovelace",
        memberId: UUID,
        placeholderLabel: "Member",
      }),
    ).toBe("A. Lovelace");
  });

  it("names a magic-link account that has no name at all", () => {
    // THE case this function exists for, and the common one on a fresh app:
    // the template's default sign-up is a magic link, and such accounts carry
    // no name. Both inputs null must still produce something to put beside
    // somebody's words.
    const name = displayNameFor({
      profileName: null,
      accountName: null,
      memberId: UUID,
      placeholderLabel: "Member",
    });
    expect(name.trim()).not.toBe("");
    expect(name).toMatch(/^Member /);
  });

  it("never leaks an address, on any fallback path", () => {
    // The pin is on the FALLBACK outputs, deliberately — a chosen name may
    // legally contain an "@" because a person may type anything, and
    // sanitising what somebody chose to call themselves is not this function's
    // job. What must never happen is the code REACHING for the address when it
    // runs out of names.
    for (const memberId of [UUID, "member@example.com", "", "!!!"]) {
      for (const accountName of [null, ""]) {
        const name = displayNameFor({
          profileName: null,
          accountName,
          memberId,
          placeholderLabel: "Member",
        });
        expect(name, memberId).not.toContain("@");
        expect(name.trim(), memberId).not.toBe("");
      }
    }
  });

  it("is stable per member — the same person is called the same thing twice", () => {
    // A thread is unreadable if the placeholder changes between renders.
    const once = displayNameFor({
      profileName: null,
      accountName: null,
      memberId: UUID,
      placeholderLabel: "Member",
    });
    const twice = displayNameFor({
      profileName: null,
      accountName: null,
      memberId: UUID,
      placeholderLabel: "Member",
    });
    expect(once).toBe(twice);
  });

  it("gives two members two different placeholders", () => {
    const a = displayNameFor({
      profileName: null,
      accountName: null,
      memberId: UUID,
      placeholderLabel: "Member",
    });
    const b = displayNameFor({
      profileName: null,
      accountName: null,
      memberId: "9c1d77e0-55af-4b32-8e10-1a4f6d3b0982",
      placeholderLabel: "Member",
    });
    expect(a).not.toBe(b);
  });

  it("treats a whitespace-only name as no name", () => {
    // A stored "   " must not render as a blank author.
    expect(
      displayNameFor({
        profileName: "   ",
        accountName: "Ada",
        memberId: UUID,
        placeholderLabel: "Member",
      }),
    ).toBe("Ada");
    expect(
      displayNameFor({
        profileName: "   ",
        accountName: "  ",
        memberId: UUID,
        placeholderLabel: "Member",
      }),
    ).toMatch(/^Member /);
  });
});

describe("canParticipate", () => {
  it("refuses a member with no profile row at all", () => {
    expect(canParticipate(null)).toBe("communityProfileIncomplete");
  });

  it("refuses a row whose name is empty or whitespace", () => {
    expect(canParticipate({ displayName: "" })).toBe("communityProfileIncomplete");
    expect(canParticipate({ displayName: "   " })).toBe("communityProfileIncomplete");
    expect(canParticipate({ displayName: null })).toBe("communityProfileIncomplete");
  });

  it("allows a member who has named themselves", () => {
    expect(canParticipate({ displayName: "Ada" })).toBeNull();
  });
});

describe("checkCommunityDisplayName", () => {
  it("trims and collapses whitespace", () => {
    expect(checkCommunityDisplayName("  Ada   Lovelace ")).toEqual({
      ok: true,
      name: "Ada Lovelace",
    });
  });

  it("REFUSES a blank — the difference from the account name check", () => {
    // `checkDisplayName` in lib/users/rules.ts reads a blank as "clear it".
    // Here there is no such state: a member either has a name or has no row.
    for (const blank of ["", "   ", "\n\t "]) {
      expect(checkCommunityDisplayName(blank)).toEqual({
        ok: false,
        code: "communityDisplayNameInvalid",
      });
    }
  });

  it("refuses a non-string and anything past the cap", () => {
    expect(checkCommunityDisplayName(null).ok).toBe(false);
    expect(checkCommunityDisplayName(42).ok).toBe(false);
    expect(checkCommunityDisplayName(undefined).ok).toBe(false);
    expect(
      checkCommunityDisplayName("x".repeat(MAX_COMMUNITY_DISPLAY_NAME_LENGTH))
        .ok,
    ).toBe(true);
    expect(
      checkCommunityDisplayName(
        "x".repeat(MAX_COMMUNITY_DISPLAY_NAME_LENGTH + 1),
      ).ok,
    ).toBe(false);
  });

  it("measures the cap on the RAW input, not on the trimmed value", () => {
    // Otherwise a megabyte of spaces is trimmed to a valid name and the cheap
    // refusal never happens.
    const padded = " ".repeat(MAX_COMMUNITY_DISPLAY_NAME_LENGTH) + "Ada";
    expect(checkCommunityDisplayName(padded).ok).toBe(false);
  });
});

describe("checkCommunityAbout", () => {
  it("treats blank and absent alike as 'not written one'", () => {
    // Unlike the name: an empty about is the shipped state of every profile.
    expect(checkCommunityAbout(null)).toEqual({ ok: true, about: null });
    expect(checkCommunityAbout(undefined)).toEqual({ ok: true, about: null });
    expect(checkCommunityAbout("   ")).toEqual({ ok: true, about: null });
  });

  it("keeps the shape of what they wrote", () => {
    // Line breaks survive — a few sentences about oneself may have them.
    expect(
      checkCommunityAbout("  I build things.\nMostly in Berlin.  "),
    ).toEqual({
      ok: true,
      about: "I build things.\nMostly in Berlin.",
    });
  });

  it("refuses anything past the cap", () => {
    expect(checkCommunityAbout("x".repeat(MAX_COMMUNITY_ABOUT_LENGTH)).ok).toBe(
      true,
    );
    expect(
      checkCommunityAbout("x".repeat(MAX_COMMUNITY_ABOUT_LENGTH + 1)),
    ).toEqual({
      ok: false,
      code: "communityAboutTooLong",
    });
  });
});

// ── Everything below was added by the code review of 19.3 ──────────────────
// Each of these reached shipped code that typechecked, passed 3007 tests and
// rendered without an error. They are here as the class, not the instance.

const ZERO_WIDTH = "​​​";
const RTL_OVERRIDE = "‮eval";

describe("a name that renders as nothing is not a name", () => {
  it("is refused as a display name", () => {
    // `trim()` and `\s` follow the ECMAScript definition of whitespace, which
    // contains none of the zero-width characters — so this passed every check,
    // was stored in a NOT NULL column, and rendered as a blank author beside a
    // blank avatar. Exactly the "row of blanks" the module exists to prevent.
    expect(checkCommunityDisplayName(ZERO_WIDTH)).toEqual({
      ok: false,
      code: "communityDisplayNameInvalid",
    });
    expect(checkCommunityDisplayName(` ${ZERO_WIDTH} `).ok).toBe(false);
  });

  it("does not let a stored one satisfy canParticipate", () => {
    // A row written before this check existed — or by a script, or an import.
    expect(canParticipate({ displayName: ZERO_WIDTH })).toBe(
      "communityProfileIncomplete",
    );
  });

  it("falls through the naming chain instead of rendering blank", () => {
    expect(
      displayNameFor({
        profileName: ZERO_WIDTH,
        accountName: "Ada",
        memberId: UUID,
        placeholderLabel: "Member",
      }),
    ).toBe("Ada");
    // Both invisible → the placeholder, never an empty string.
    const name = displayNameFor({
      profileName: ZERO_WIDTH,
      accountName: ZERO_WIDTH,
      memberId: UUID,
      placeholderLabel: "Member",
    });
    expect(name).toMatch(/^Member /);
  });

  it("refuses a bidi override, which is worse than blank", () => {
    // It does not merely fail to render — it reverses the text AROUND it in
    // every list the name appears in.
    expect(checkCommunityDisplayName(RTL_OVERRIDE).ok).toBe(false);
  });

  it("still accepts an ordinary name containing a combining mark", () => {
    // The guard must not overreach: "José" decomposed is a real name.
    expect(checkCommunityDisplayName("José").ok).toBe(true);
    expect(checkCommunityDisplayName("北京の人").ok).toBe(true);
    expect(checkCommunityDisplayName("🎉 Ada").ok).toBe(true);
  });

  it("does NOT refuse a right-to-left name", () => {
    // The half of the bidi rule that is easy to get wrong, and the reason it is
    // written down rather than assumed. Hebrew and Arabic render correctly from
    // the characters' own properties — the bidi algorithm needs no override,
    // and refusing these scripts because the CONTROLS are refused would lock
    // out exactly the members an app should welcome.
    expect(checkCommunityDisplayName("שרה").ok).toBe(true);
    expect(checkCommunityDisplayName("عائشة").ok).toBe(true);
    expect(checkCommunityDisplayName("שרה Cohen").ok).toBe(true);
  });
});

describe("the placeholder is translatable and wide enough", () => {
  it("uses the label the caller passes, in the caller's language", () => {
    // It is the most-rendered string this module produces (a magic-link
    // account has no name at all), and it used to be hardcoded English below
    // the delivery layer — a German member read "Member 8f41d7" beside every
    // post while the rest of the page was German.
    const german = displayNameFor({
      profileName: null,
      accountName: null,
      memberId: UUID,
      placeholderLabel: "Mitglied",
    });
    expect(german).toMatch(/^Mitglied /);
    expect(german).not.toMatch(/Member/);
  });

  it("carries enough of the id that two members do not collide in one room", () => {
    // Six hex characters is a 16.7M space, and the 50% collision point is
    // ~4,800 members — measured. Since the placeholder is the COMMON case, a
    // community of a few thousand unnamed members would reliably show two
    // different people under one name, in one thread, with nothing to tell
    // them apart.
    const suffix = displayNameFor({
      profileName: null,
      accountName: null,
      memberId: UUID,
      placeholderLabel: "M",
    }).slice(2);
    expect(suffix.length).toBeGreaterThanOrEqual(12);
  });

  it("never renders a trailing space when the id has no usable characters", () => {
    expect(
      displayNameFor({
        profileName: null,
        accountName: null,
        memberId: "!!!",
        placeholderLabel: "Member",
      }),
    ).toBe("Member ?");
  });
});

describe("checkCommunityAbout, corrected", () => {
  it("names a non-string for what it is, not 'too long'", () => {
    // One code for two unrelated conditions told a member "at most 500
    // characters" about a value that might be three characters or a file.
    expect(checkCommunityAbout(42)).toEqual({
      ok: false,
      code: "communityAboutInvalid",
    });
    expect(checkCommunityAbout({})).toEqual({
      ok: false,
      code: "communityAboutInvalid",
    });
  });

  it("measures the cap after normalising CRLF, as the browser sends it", () => {
    // A textarea's `maxLength` counts "\n" as one character; the browser
    // submits "\r\n". Without normalising, a text the member could see was
    // short enough was refused on arrival with no way to tell why.
    // 250 single-character lines: 499 characters with LF, 748 with CRLF. The
    // member typed something the textarea accepted; the browser lengthened it.
    const crlf = Array(250).fill("a").join("\r\n");
    expect(crlf.length).toBeGreaterThan(MAX_COMMUNITY_ABOUT_LENGTH);
    expect(crlf.replace(/\r\n/g, "\n").length).toBeLessThanOrEqual(
      MAX_COMMUNITY_ABOUT_LENGTH,
    );
    expect(checkCommunityAbout(crlf).ok).toBe(true);
  });

  it("treats an invisible-only about as none written", () => {
    expect(checkCommunityAbout(ZERO_WIDTH)).toEqual({ ok: true, about: null });
  });
});

describe("CommunityError", () => {
  it("carries its code and keeps the code as the message", () => {
    const error = new CommunityError("communityProfileIncomplete");
    expect(error.code).toBe("communityProfileIncomplete");
    expect(error.message).toBe("communityProfileIncomplete");
    expect(error.name).toBe("CommunityError");
    expect(error).toBeInstanceOf(Error);
  });

  it("every declared code is one the delivery layer can translate", () => {
    // The registry in i18n/messages.test.ts is what proves the texts exist;
    // this pins that the union is non-empty and free of duplicates, which that
    // test cannot see.
    expect(COMMUNITY_ERROR_CODES.length).toBeGreaterThan(0);
    expect(new Set(COMMUNITY_ERROR_CODES).size).toBe(
      COMMUNITY_ERROR_CODES.length,
    );
  });

  it("carries the values the sentence needs, and nothing when there are none", () => {
    expect(
      new CommunityError("communityUnknownPlanKey", "typo", { key: "nope" }).detail,
    ).toEqual({
      key: "nope",
    });
    expect(new CommunityError("notFound").detail).toBeUndefined();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Groups
// ───────────────────────────────────────────────────────────────────────────

describe("isGroupAccessLevel", () => {
  it("accepts exactly the four levels", () => {
    for (const level of GROUP_ACCESS_LEVELS)
      expect(isGroupAccessLevel(level)).toBe(true);
    expect(GROUP_ACCESS_LEVELS).toHaveLength(4);
  });

  it("refuses anything else a form could send", () => {
    for (const value of [
      "",
      "OPEN",
      "public",
      "plans",
      null,
      undefined,
      1,
      {},
    ]) {
      expect(isGroupAccessLevel(value)).toBe(false);
    }
  });
});

describe("mayEnterGroup", () => {
  const open = { accessLevel: "open" as const, planKeys: [], archivedAt: null };
  const plan = {
    accessLevel: "plan" as const,
    planKeys: ["basic_monthly", "basic_yearly"],
    archivedAt: null,
  };
  const mods = {
    accessLevel: "moderators" as const,
    planKeys: [],
    archivedAt: null,
  };
  const operator = {
    accessLevel: "operator" as const,
    planKeys: [],
    archivedAt: null,
  };

  const member = { role: "member", grantedKeys: [] as string[] };
  const buyer = { role: "member", grantedKeys: ["basic_monthly"] };
  const moderator = { role: "moderator", grantedKeys: [] as string[] };
  const owner = { role: "owner", grantedKeys: [] as string[] };

  // The whole matrix, written out rather than generated: this table IS the
  // feature, and a loop that builds it from the implementation's own logic
  // would agree with any mistake in it.
  it("answers every level × viewer combination", () => {
    expect(mayEnterGroup(open, member)).toBe(true);
    expect(mayEnterGroup(open, buyer)).toBe(true);
    expect(mayEnterGroup(open, moderator)).toBe(true);
    expect(mayEnterGroup(open, owner)).toBe(true);

    expect(mayEnterGroup(plan, member)).toBe(false);
    expect(mayEnterGroup(plan, buyer)).toBe(true);
    expect(mayEnterGroup(plan, moderator)).toBe(false);
    // Deliberate, and the function comment says why: a plan room is an
    // entitlement question for everybody. The operator grants themselves the
    // plan if they want to sit in it — one visible, revocable row.
    expect(mayEnterGroup(plan, owner)).toBe(false);

    expect(mayEnterGroup(mods, member)).toBe(false);
    expect(mayEnterGroup(mods, buyer)).toBe(false);
    expect(mayEnterGroup(mods, moderator)).toBe(true);
    expect(mayEnterGroup(mods, owner)).toBe(true);

    expect(mayEnterGroup(operator, member)).toBe(false);
    expect(mayEnterGroup(operator, buyer)).toBe(false);
    expect(mayEnterGroup(operator, moderator)).toBe(false);
    expect(mayEnterGroup(operator, owner)).toBe(true);
  });

  it("lets ANY of the listed keys in, not all of them", () => {
    // The upgrade window: a member mid plan switch holds the other key.
    expect(
      mayEnterGroup(plan, { role: "member", grantedKeys: ["basic_yearly"] }),
    ).toBe(true);
    // And a key the room does not list opens nothing.
    expect(
      mayEnterGroup(plan, { role: "member", grantedKeys: ["starter"] }),
    ).toBe(false);
  });

  it("closes an archived room to everybody, whatever its level", () => {
    const archivedAt = new Date("2026-08-01T00:00:00Z");
    for (const group of [open, plan, mods, operator]) {
      for (const viewer of [member, buyer, moderator, owner]) {
        expect(mayEnterGroup({ ...group, archivedAt }, viewer)).toBe(false);
      }
    }
  });

  it("is total over every level — no branch falls through to undefined", () => {
    // Renamed to what it actually checks. It used to be called "asks nothing
    // outside its arguments" and asserted `typeof answer === "boolean"`, which
    // is totality and says nothing about what the function READS — the very
    // property the name claimed.
    for (const level of GROUP_ACCESS_LEVELS) {
      const answer = mayEnterGroup(
        { accessLevel: level, planKeys: [], archivedAt: null },
        owner,
      );
      expect(typeof answer).toBe("boolean");
    }
  });

  it("asks nothing outside its arguments", () => {
    // The property the name promises, pinned by taking the outside away: no
    // clock, and every property access on the two arguments accounted for. A
    // `hasPlan()` call, a `Date.now()`, or a reach for a module-level set
    // would show up here.
    const realNow = Date.now;
    let clockReads = 0;
    const read: string[] = [];
    try {
      Date.now = () => {
        clockReads += 1;
        return 0;
      };
      const group = new Proxy(
        { accessLevel: "plan" as const, planKeys: ["basis"], archivedAt: null },
        {
          get(target, key: string) {
            read.push(`group.${key}`);
            return target[key as keyof typeof target];
          },
        },
      );
      const viewer = new Proxy(
        { role: "member", grantedKeys: ["basis"] },
        {
          get(target, key: string) {
            read.push(`viewer.${key}`);
            return target[key as keyof typeof target];
          },
        },
      );
      expect(mayEnterGroup(group, viewer)).toBe(true);
    } finally {
      Date.now = realNow;
    }
    expect(clockReads).toBe(0);
    // Only the four fields the signature declares were touched.
    expect(new Set(read)).toEqual(
      new Set([
        "group.archivedAt",
        "group.accessLevel",
        "group.planKeys",
        "viewer.grantedKeys",
      ]),
    );
  });
});

describe("planKeysToResolve", () => {
  it("collects the distinct keys of plan rooms only", () => {
    const keys = planKeysToResolve([
      { accessLevel: "plan", planKeys: ["basic_monthly", "basic_yearly"] },
      { accessLevel: "plan", planKeys: ["basic_monthly"] },
      // A stale key on a non-plan room must not become a query — the shell
      // stores none, and a row from before that rule must not cost anything.
      { accessLevel: "open", planKeys: ["starter"] },
      { accessLevel: "operator", planKeys: [] },
    ]);
    expect(keys.sort()).toEqual(["basic_monthly", "basic_yearly"]);
  });

  it("asks nothing for a list with no plan rooms", () => {
    expect(planKeysToResolve([{ accessLevel: "open", planKeys: [] }])).toEqual(
      [],
    );
    expect(planKeysToResolve([])).toEqual([]);
  });
});

describe("groupPlanProblems", () => {
  // 🚨 This is the one block here that asks the REAL registry — `planProblem`
  // is the shipped one, which is the point: the question is whether a room's
  // keys and this app's products agree. So the keys come out of
  // `config/digistore-products.json` rather than out of a literal, because the
  // operator is told to delete the examples they do not sell. Where a shape is
  // absent the test skips and says why
  // (`lib/digistore/test-product-keys.ts`). Everything above this block is a
  // PURE function taking strings, and its example keys are just strings.
  const PLAN = planShapedKey();
  const TOKEN = tokenKey();

  it("passes a key this app really sells", (ctx) => {
    const [plan] = keysOrSkip(ctx, PLAN);
    expect(
      groupPlanProblems({ accessLevel: "plan", planKeys: [plan] }, planProblem),
    ).toBeNull();
  });

  it("refuses a typo and names the key", () => {
    expect(
      groupPlanProblems(
        { accessLevel: "plan", planKeys: ["basis_monatlik"] },
        planProblem,
      ),
    ).toMatchObject({ code: "communityUnknownPlanKey", key: "basis_monatlik" });
  });

  it("refuses a token package — a balance is not an entitlement", (ctx) => {
    // `hasPlan()` answers false for these for ever, so a room gated on one
    // would be a room nobody could ever enter.
    //
    // ⚠️ A token package this app REALLY sells. With a key the registry does
    // not hold, this test kept passing on the typo branch above — same code,
    // different reason — and stopped measuring anything about token packages.
    const [token] = keysOrSkip(ctx, TOKEN);
    expect(
      groupPlanProblems({ accessLevel: "plan", planKeys: [token] }, planProblem),
    ).toMatchObject({ code: "communityUnknownPlanKey", key: token });
  });

  it("refuses a plan room with no keys, with its own code", () => {
    expect(
      groupPlanProblems({ accessLevel: "plan", planKeys: [] }, planProblem),
    ).toEqual({
      code: "communityPlanKeysRequired",
    });
  });

  it("names the FIRST bad key when several are wrong", (ctx) => {
    // Good key first, so "the first bad one" is a real claim and not merely
    // "the first one".
    const [plan, token] = keysOrSkip(ctx, PLAN, TOKEN);
    expect(
      groupPlanProblems(
        { accessLevel: "plan", planKeys: [plan, token, "nonsense"] },
        planProblem,
      ),
    ).toMatchObject({ code: "communityUnknownPlanKey", key: token });
  });

  it("does not check keys on a room that is not plan-gated", () => {
    for (const level of [
      "open",
      "moderators",
      "operator",
    ] as GroupAccessLevel[]) {
      expect(
        groupPlanProblems(
          { accessLevel: level, planKeys: ["nonsense"] },
          planProblem,
        ),
      ).toBeNull();
      expect(
        groupPlanProblems({ accessLevel: level, planKeys: [] }, planProblem),
      ).toBeNull();
    }
  });
});

describe("checkGroupName", () => {
  it("accepts a name and collapses its whitespace", () => {
    expect(checkGroupName("  Premium   Lounge ")).toEqual({
      ok: true,
      name: "Premium Lounge",
    });
  });

  it("refuses blank, invisible-only and over-long names", () => {
    expect(checkGroupName("")).toEqual({ ok: false, code: "communityGroupNameInvalid" });
    expect(checkGroupName("   ")).toEqual({
      ok: false,
      code: "communityGroupNameInvalid",
    });
    expect(checkGroupName(ZERO_WIDTH)).toEqual({
      ok: false,
      code: "communityGroupNameInvalid",
    });
    expect(checkGroupName("a".repeat(MAX_GROUP_NAME_LENGTH + 1))).toEqual({
      ok: false,
      code: "communityGroupNameInvalid",
    });
    expect(checkGroupName(42)).toEqual({ ok: false, code: "communityGroupNameInvalid" });
  });

  it("refuses a bidi override even beside visible text", () => {
    // It reorders the text AROUND it — in the nav, in the admin table, in the
    // page title. Visible characters beside it do not make it harmless.
    expect(checkGroupName(`Lounge ${RTL_OVERRIDE}`)).toEqual({
      ok: false,
      code: "communityGroupNameInvalid",
    });
  });
});

describe("checkGroupDescription", () => {
  it("treats absent, blank and invisible-only alike as none", () => {
    expect(checkGroupDescription(null)).toEqual({
      ok: true,
      description: null,
    });
    expect(checkGroupDescription(undefined)).toEqual({
      ok: true,
      description: null,
    });
    expect(checkGroupDescription("  ")).toEqual({
      ok: true,
      description: null,
    });
    expect(checkGroupDescription(ZERO_WIDTH)).toEqual({
      ok: true,
      description: null,
    });
  });

  it("keeps line breaks and refuses only what is too long", () => {
    expect(checkGroupDescription("one\ntwo")).toEqual({
      ok: true,
      description: "one\ntwo",
    });
    expect(
      checkGroupDescription("a".repeat(MAX_GROUP_DESCRIPTION_LENGTH + 1)),
    ).toEqual({ ok: false, code: "communityGroupDescriptionTooLong" });
  });

  it("measures after normalising CRLF, like the about text", () => {
    const crlf = Array(250).fill("a").join("\r\n");
    expect(crlf.length).toBeGreaterThan(MAX_GROUP_DESCRIPTION_LENGTH);
    expect(checkGroupDescription(crlf).ok).toBe(true);
  });

  it("names a non-string for what it is, instead of dropping it", () => {
    // It used to answer `{ ok: true, description: null }` — success, with the
    // operator's text silently wiped and a "saved" toast over the top of it.
    // `formData.get()` returns `string | File | null`, so this is reachable.
    // Absent stays absent: null/undefined is "the operator wrote none".
    expect(checkGroupDescription(new File([], "x"))).toEqual({
      ok: false,
      code: "communityGroupDescriptionInvalid",
    });
    expect(checkGroupDescription(42)).toEqual({
      ok: false,
      code: "communityGroupDescriptionInvalid",
    });
    expect(checkGroupDescription(null)).toEqual({ ok: true, description: null });
  });

  it("refuses a megabyte without rewriting it first", () => {
    // The loose raw guard. Twice the cap is the tightest bound that cannot
    // refuse a value which would have fitted after CRLF normalisation.
    const huge = "a".repeat(MAX_GROUP_DESCRIPTION_LENGTH * 2 + 1);
    expect(checkGroupDescription(huge)).toEqual({
      ok: false,
      code: "communityGroupDescriptionTooLong",
    });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Talk
// ───────────────────────────────────────────────────────────────────────────

describe("titleState", () => {
  it("reads a normal title as visible", () => {
    expect(titleState({ title: "Wie fange ich an?" })).toBe("visible");
  });

  it("reads the empty title left by an account deletion as scrubbed", () => {
    // `checkDiscussionTitle` refuses a blank title, so an empty one in the
    // database can only have come from `scrubPostsOfDepartingMember()`. The
    // sentence the reader sees is chosen in the delivery layer, in their
    // language — the same split `contentState()` uses for a post.
    expect(titleState({ title: "" })).toBe("scrubbed");
  });
});

describe("contentState", () => {
  it("reads a live post as visible", () => {
    expect(contentState({ deletedAt: null, deletedBy: null })).toBe("visible");
    // `deletedBy` alone is not a deletion — the timestamp is the fact.
    expect(contentState({ deletedAt: null, deletedBy: "moderator" })).toBe("visible");
  });

  it("tells the three deletions apart", () => {
    const at = new Date("2026-08-06T10:00:00Z");
    expect(contentState({ deletedAt: at, deletedBy: "author" })).toBe("authorDeleted");
    expect(contentState({ deletedAt: at, deletedBy: "moderator" })).toBe(
      "moderatorRemoved",
    );
    expect(contentState({ deletedAt: at, deletedBy: "system" })).toBe("accountDeleted");
  });

  it("reads a deletion with no actor as the mildest of the three", () => {
    // Not a state this app writes. Being wrong towards "the author tidied up"
    // is better than announcing a moderation decision that never happened.
    expect(contentState({ deletedAt: new Date(), deletedBy: null })).toBe(
      "authorDeleted",
    );
  });
});

describe("canStartDiscussion / canPost", () => {
  const named = { displayName: "Ada" };

  it("needs a display name before writing anything", () => {
    expect(canStartDiscussion(null)).toBe("communityProfileIncomplete");
    expect(canStartDiscussion({ displayName: "  " })).toBe("communityProfileIncomplete");
    expect(canPost(null, { lockedAt: null })).toBe("communityProfileIncomplete");
  });

  it("lets a named member write into an open thread", () => {
    expect(canStartDiscussion(named)).toBeNull();
    expect(canPost(named, { lockedAt: null })).toBeNull();
  });

  it("refuses a locked thread", () => {
    expect(canPost(named, { lockedAt: new Date() })).toBe("communityDiscussionLocked");
  });

  it("answers the refusal the member can act on first", () => {
    // Both wrong: "choose a name" is about them and is actionable; "this
    // thread is closed" is about the thread and would leave them stuck.
    expect(canPost(null, { lockedAt: new Date() })).toBe("communityProfileIncomplete");
  });
});

describe("canDeleteOwnPost", () => {
  const me = "member-1";
  const open = { lockedAt: null };

  it("allows the author to delete their own live post", () => {
    expect(
      canDeleteOwnPost({ authorId: me, deletedAt: null }, me, open),
    ).toBeNull();
  });

  it("answers notFound for somebody else's post", () => {
    // Not "notAuthor": saying "that is not yours" confirms it exists.
    expect(
      canDeleteOwnPost({ authorId: "someone-else", deletedAt: null }, me, open),
    ).toBe("notFound");
    expect(canDeleteOwnPost({ authorId: null, deletedAt: null }, me, open)).toBe(
      "notFound",
    );
  });

  it("refuses a SECOND deletion event — including over a moderator's removal", () => {
    // The direction that matters: without this, an author could relabel
    // "removed by a moderator" as "deleted by the author". The moderator's
    // removal is constructed HERE rather than described in a comment: the
    // function only reads `deletedAt` today, so a test that passes a bare
    // `deletedAt` proves "some deletion event exists" and would keep passing
    // if a later change branched on `deletedBy` — which Epic 23's removal act
    // and `removedReason` both land on.
    const moderatorRemoved = {
      authorId: me,
      deletedAt: new Date("2026-08-01T10:00:00Z"),
      deletedBy: "moderator" as const,
    };
    expect(canDeleteOwnPost(moderatorRemoved, me, open)).toBe("communityAlreadyDeleted");

    const ownDeletion = {
      authorId: me,
      deletedAt: new Date("2026-08-01T10:00:00Z"),
      deletedBy: "author" as const,
    };
    expect(canDeleteOwnPost(ownDeletion, me, open)).toBe("communityAlreadyDeleted");
  });

  it("refuses a deletion in a LOCKED thread", () => {
    // A lock freezes the thread rather than only closing it to new posts —
    // deleting your side of an argument rewrites the record as effectively as
    // editing it.
    expect(
      canDeleteOwnPost({ authorId: me, deletedAt: null }, me, {
        lockedAt: new Date(),
      }),
    ).toBe("communityDiscussionLocked");
  });

  it("reports the ROW's state before the room's", () => {
    // An already-deleted post in a locked thread answers `communityAlreadyDeleted`:
    // the truer sentence, and the one that keeps the one-deletion-event rule
    // legible.
    expect(
      canDeleteOwnPost({ authorId: me, deletedAt: new Date() }, me, {
        lockedAt: new Date(),
      }),
    ).toBe("communityAlreadyDeleted");
  });
});

describe("canEditOwnPost", () => {
  const me = "member-1";
  const open = { lockedAt: null };

  it("allows the author to edit their own live post", () => {
    expect(canEditOwnPost({ authorId: me, deletedAt: null }, me, open)).toBeNull();
  });

  it("answers notFound for somebody else's post", () => {
    expect(
      canEditOwnPost({ authorId: "someone-else", deletedAt: null }, me, open),
    ).toBe("notFound");
  });

  it("refuses editing a deleted post back into existence", () => {
    expect(
      canEditOwnPost({ authorId: me, deletedAt: new Date() }, me, open),
    ).toBe("communityAlreadyDeleted");
  });

  it("refuses an edit in a LOCKED thread", () => {
    // The gap this function was written to close: `canPost()` refused new
    // posts in a locked thread while every participant could still rewrite the
    // posts already in it — including the text that caused the lock.
    expect(
      canEditOwnPost({ authorId: me, deletedAt: null }, me, {
        lockedAt: new Date(),
      }),
    ).toBe("communityDiscussionLocked");
  });
});

describe("checkDiscussionTitle", () => {
  it("trims, collapses whitespace and refuses the empty shapes", () => {
    expect(checkDiscussionTitle("  Wie   fange ich an? ")).toEqual({
      ok: true,
      title: "Wie fange ich an?",
    });
    expect(checkDiscussionTitle("")).toEqual({ ok: false, code: "communityTitleInvalid" });
    expect(checkDiscussionTitle(ZERO_WIDTH)).toEqual({ ok: false, code: "communityTitleInvalid" });
    expect(checkDiscussionTitle(7)).toEqual({ ok: false, code: "communityTitleInvalid" });
    expect(
      checkDiscussionTitle("x".repeat(MAX_DISCUSSION_TITLE_LENGTH + 1)),
    ).toEqual({ ok: false, code: "communityTitleInvalid" });
  });

  it("refuses a bidi override — it reorders the neighbouring titles", () => {
    expect(checkDiscussionTitle(`Frage ${RTL_OVERRIDE}`).ok).toBe(false);
  });
});

describe("checkPostContent", () => {
  it("keeps paragraphs and trims the edges", () => {
    expect(checkPostContent("  erste Zeile\n\nzweite Zeile  ")).toEqual({
      ok: true,
      content: "erste Zeile\n\nzweite Zeile",
    });
  });

  it("refuses empty, invisible-only and over-long", () => {
    expect(checkPostContent("")).toEqual({ ok: false, code: "communityPostEmpty" });
    expect(checkPostContent("   ")).toEqual({ ok: false, code: "communityPostEmpty" });
    expect(checkPostContent(ZERO_WIDTH)).toEqual({ ok: false, code: "communityPostEmpty" });
    expect(checkPostContent(null)).toEqual({ ok: false, code: "communityPostEmpty" });
    expect(checkPostContent("x".repeat(MAX_POST_LENGTH + 1))).toEqual({
      ok: false,
      code: "communityPostTooLong",
    });
  });

  it("measures after normalising CRLF", () => {
    // A browser submits a textarea with CRLF, so a text `maxLength` accepted
    // arrives longer. Refusing it names a limit the member cannot see.
    const crlf = Array(MAX_POST_LENGTH / 2).fill("a").join("\r\n");
    expect(crlf.length).toBeGreaterThan(MAX_POST_LENGTH);
    expect(checkPostContent(crlf).ok).toBe(true);
  });

  it("does NOT refuse a bidi override inside prose", () => {
    // Deliberately different from a name: inside a post an override mangles
    // that post's own text, which is the author's to do. In a NAME it reorders
    // every neighbouring row of a list.
    expect(checkPostContent(`ein Satz ${RTL_OVERRIDE} weiter`).ok).toBe(true);
  });
});

describe("postSegments — the rendering policy", () => {
  it("leaves plain text alone, as one segment", () => {
    expect(postSegments("Hallo, wie geht es dir?")).toEqual([
      { kind: "text", value: "Hallo, wie geht es dir?" },
    ]);
  });

  it("keeps a script tag as TEXT — the stored-XSS case", () => {
    const hostile = '<script>alert(1)</script>';
    expect(postSegments(hostile)).toEqual([{ kind: "text", value: hostile }]);
    // Nothing in the output is a link, so nothing reaches an href.
    expect(postSegments(hostile).some((s) => s.kind === "link")).toBe(false);
  });

  it("keeps an img onerror payload as TEXT", () => {
    const hostile = '<img src=x onerror="alert(1)">';
    expect(postSegments(hostile)).toEqual([{ kind: "text", value: hostile }]);
  });

  it("never makes a link out of a scheme that executes", () => {
    // THE one XSS React's escaping does not stop: a javascript: URL in an
    // href runs on click. The whitelist is why these stay text.
    for (const hostile of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
      "ftp://example.com/x",
    ]) {
      const segments = postSegments(`schau mal: ${hostile}`);
      expect(
        segments.filter((s) => s.kind === "link"),
        hostile,
      ).toEqual([]);
    }
  });

  it("never makes a link out of an address carrying a bidi override", () => {
    // The phishing shape this module says it will not render: the URL is both
    // the href and the anchor text, so an override makes the visible text read
    // as one host while the target is another. `checkPostContent` permits
    // overrides in PROSE on the argument that they mangle only that post's own
    // text — an argument that does not survive the segment becoming an href.
    const spoof = "https://evil.example/‮elpmaxe.knab//:sptth";
    const segments = postSegments(`schau mal: ${spoof}`);
    expect(segments.filter((s) => s.kind === "link")).toEqual([]);
    // Still readable and copyable — refused as a LINK, not stripped from the
    // post. Rewriting somebody's address is its own kind of lie.
    expect(segments.map((s) => s.value).join("")).toBe(`schau mal: ${spoof}`);

    for (const control of ["‪", "‫", "‭", "⁦", "⁩"]) {
      expect(
        postSegments(`https://example.com/${control}x`).filter(
          (s) => s.kind === "link",
        ),
        control,
      ).toEqual([]);
    }
  });

  it("keeps a bracket the URL opened itself", () => {
    // `TRAILING` stripped every trailing `)`, which is right for a sentence
    // and wrong for an address that ends in a bracket it opened — the link
    // pointed at a 404 with a stray `)` rendered beside it.
    expect(
      postSegments("https://en.wikipedia.org/wiki/Ruby_(programming_language)"),
    ).toEqual([
      {
        kind: "link",
        value: "https://en.wikipedia.org/wiki/Ruby_(programming_language)",
      },
    ]);

    // The sentence still gets its bracket back when the URL never opened one.
    expect(postSegments("(siehe https://example.com/x)")).toEqual([
      { kind: "text", value: "(siehe " },
      { kind: "link", value: "https://example.com/x" },
      { kind: "text", value: ")" },
    ]);

    // And a balanced pair followed by real punctuation loses only the latter.
    expect(postSegments("https://example.com/a_(b).")).toEqual([
      { kind: "link", value: "https://example.com/a_(b)" },
      { kind: "text", value: "." },
    ]);
  });

  it("makes a link out of http and https, and only the address", () => {
    expect(postSegments("siehe https://example.com/x hier")).toEqual([
      { kind: "text", value: "siehe " },
      { kind: "link", value: "https://example.com/x" },
      { kind: "text", value: " hier" },
    ]);
    expect(postSegments("http://example.com")).toEqual([
      { kind: "link", value: "http://example.com" },
    ]);
  });

  it("gives the sentence its full stop back", () => {
    expect(postSegments("siehe https://example.com.")).toEqual([
      { kind: "text", value: "siehe " },
      { kind: "link", value: "https://example.com" },
      { kind: "text", value: "." },
    ]);
    expect(postSegments("(https://example.com)")).toEqual([
      { kind: "text", value: "(" },
      { kind: "link", value: "https://example.com" },
      { kind: "text", value: ")" },
    ]);
  });

  it("handles several links in one post", () => {
    const segments = postSegments("a https://one.example b https://two.example c");
    expect(segments.filter((s) => s.kind === "link").map((s) => s.value)).toEqual([
      "https://one.example",
      "https://two.example",
    ]);
  });

  it("does not carry state between calls", () => {
    // A module-level /g regex keeps `lastIndex`, so the second post rendered
    // in one pass would start its scan wherever the first stopped — and would
    // quietly stop linking.
    const once = postSegments("https://example.com");
    const twice = postSegments("https://example.com");
    expect(twice).toEqual(once);
  });

  it("puts every character back — nothing is dropped on the way through", () => {
    // The property that makes this safe to render: the segments ARE the post.
    for (const post of [
      "plain",
      "siehe https://example.com. und weiter",
      "<script>x</script> javascript:void(0)",
      "a\nb\n\nc",
      "(https://x.example)",
    ]) {
      expect(postSegments(post).map((s) => s.value).join("")).toBe(post);
    }
  });
});

describe("postLimit", () => {
  it("is a ten-minute window, like the assistant's", () => {
    expect(postLimit(20)).toEqual({ max: 20, windowMs: 10 * 60 * 1000 });
  });

  it("has a bucket of its own", () => {
    // Buckets are namespaces in one shared Map (`lib/rate-limit.ts`). Sharing
    // the assistant's would make asking a question spend a posting allowance.
    //
    // Asserted against the OTHER bucket, not against its own literal. The
    // previous form (`toBe("community-post")`) restated the constant's
    // definition and would have gone on passing if somebody set both to the
    // same string — which is the only way the property can actually break.
    expect(COMMUNITY_POST_RATE_BUCKET).not.toBe(CHAT_RATE_BUCKET);
    expect(COMMUNITY_POST_RATE_BUCKET).toBeTruthy();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Unread
// ───────────────────────────────────────────────────────────────────────────

const T1 = new Date("2026-08-06T10:00:00.000Z");
const T2 = new Date("2026-08-06T10:00:00.001Z");

describe("compareCursor", () => {
  it("orders by time first", () => {
    expect(compareCursor({ at: T1, id: "z" }, { at: T2, id: "a" })).toBeLessThan(0);
    expect(compareCursor({ at: T2, id: "a" }, { at: T1, id: "z" })).toBeGreaterThan(0);
  });

  it("breaks a tie by id, the way Postgres compares text", () => {
    // Two posts in one millisecond are real under load. Without this the order
    // is not total and "newer than" is undecidable for them.
    expect(compareCursor({ at: T1, id: "a" }, { at: T1, id: "b" })).toBeLessThan(0);
    expect(compareCursor({ at: T1, id: "b" }, { at: T1, id: "a" })).toBeGreaterThan(0);
    expect(compareCursor({ at: T1, id: "a" }, { at: T1, id: "a" })).toBe(0);
  });

  it("is a total order — sorting agrees with pairwise comparison", () => {
    const cursors = [
      { at: T2, id: "b" },
      { at: T1, id: "b" },
      { at: T2, id: "a" },
      { at: T1, id: "a" },
    ];
    const sorted = [...cursors].sort(compareCursor);
    expect(sorted.map((c) => `${c.at.getTime()}:${c.id}`)).toEqual([
      `${T1.getTime()}:a`,
      `${T1.getTime()}:b`,
      `${T2.getTime()}:a`,
      `${T2.getTime()}:b`,
    ]);
  });

  it("constructs no date and reads no clock", () => {
    // Timezone-innocent by construction: the same two values must compare the
    // same whatever the host's zone is, and a function that built a Date from
    // a string or consulted `Date.now()` would not.
    //
    // This used to assert `Date.now() >= before`, which is true of any two
    // readings of a non-decreasing clock — it held whatever `compareCursor`
    // did, including calling `Date.now()` a thousand times. Taking the clock
    // and the constructor AWAY is what actually pins the property.
    const realNow = Date.now;
    const realDate = globalThis.Date;
    let touched = 0;
    try {
      Date.now = () => {
        touched += 1;
        return 0;
      };
      // A Date the function did not receive cannot be built.
      globalThis.Date = new Proxy(realDate, {
        construct(target, args) {
          touched += 1;
          return Reflect.construct(target, args);
        },
      }) as DateConstructor;

      expect(compareCursor({ at: T1, id: "a" }, { at: T1, id: "a" })).toBe(0);
      expect(compareCursor({ at: T1, id: "a" }, { at: T2, id: "a" })).toBeLessThan(0);
    } finally {
      Date.now = realNow;
      globalThis.Date = realDate;
    }
    expect(touched).toBe(0);
  });
});

describe("hasUnread", () => {
  it("says no when nothing has happened at all", () => {
    // Not the same as "read" — there is simply nothing to have missed.
    expect(hasUnread(null, null)).toBe(false);
    expect(hasUnread(null, { at: T1, id: "a" })).toBe(false);
  });

  it("says yes when there is content and no marker", () => {
    expect(hasUnread({ at: T1, id: "a" }, null)).toBe(true);
    // The nav shape too — no id on the activity side.
    expect(hasUnread({ at: T1 }, null)).toBe(true);
  });

  it("compares by time when the timestamps differ", () => {
    expect(hasUnread({ at: T2, id: "a" }, { at: T1, id: "z" })).toBe(true);
    expect(hasUnread({ at: T1, id: "z" }, { at: T2, id: "a" })).toBe(false);
  });

  it("resolves an equal timestamp by id when BOTH sides carry one", () => {
    expect(hasUnread({ at: T1, id: "b" }, { at: T1, id: "a" })).toBe(true);
    expect(hasUnread({ at: T1, id: "a" }, { at: T1, id: "b" })).toBe(false);
    expect(hasUnread({ at: T1, id: "a" }, { at: T1, id: "a" })).toBe(false);
  });

  it("treats an equal timestamp as READ on the nav path, which has no id", () => {
    // The documented asymmetry. `lastActivityAt` is written from the same
    // `now` as the post it records, so equality is overwhelmingly "you have
    // read exactly this" — and answering unread would leave a dot that never
    // clears, which is a feature people learn to ignore.
    expect(hasUnread({ at: T1 }, { at: T1, id: "anything" })).toBe(false);
  });
});

describe("mayViewEmbed", () => {
  // The pure half of the enumeration-oracle defence. The other half — that the
  // delivery surface really cannot tell the two apart — is measured in
  // `modules/community/pages/embed-refusal.test.ts`.
  const PLAN_GATED = {
    accessLevel: "plan" as const,
    planKeys: ["course_complete"],
  };

  it("refuses an undeclared key with the SAME code as an unentitled one", () => {
    const undeclared = mayViewEmbed(null, { role: "member", grantedKeys: [] });
    const unentitled = mayViewEmbed(PLAN_GATED, {
      role: "member",
      grantedKeys: [],
    });

    expect(undeclared).toBe("communityNotEntitled");
    expect(undeclared).toBe(unentitled);
  });

  it("lets a member with any one of the declared keys through", () => {
    // ANY of them, not all: a member mid-upgrade briefly holds two keys, or
    // neither — the same ruling `mayEnterGroup()` makes, because it IS
    // `mayEnterGroup()`.
    expect(
      mayViewEmbed(
        { accessLevel: "plan", planKeys: ["a", "b"] },
        { role: "member", grantedKeys: ["b"] },
      ),
    ).toBeNull();
  });

  it("does not open a plan-gated embed for the operator", () => {
    // The levels are about entitlement and role SEPARATELY. An operator who
    // wants into their own paid discussion grants themselves the plan — one
    // visible, revocable row — so that what they see is what they configured.
    expect(mayViewEmbed(PLAN_GATED, { role: "owner", grantedKeys: [] })).toBe(
      "communityNotEntitled",
    );
  });

  it("answers every level the same way a room does", () => {
    const viewer = { role: "member" as const, grantedKeys: [] as string[] };
    for (const accessLevel of GROUP_ACCESS_LEVELS) {
      const declaration = { accessLevel, planKeys: ["k"] };
      const embed = mayViewEmbed(declaration, viewer) === null;
      const room = mayEnterGroup({ ...declaration, archivedAt: null }, viewer);
      expect(embed, `level "${accessLevel}" disagrees between an embed and a room`).toBe(
        room,
      );
    }
  });
});

describe("the cursor token", () => {
  const AT = new Date("2026-08-06T10:00:00.000Z");

  it("round-trips a tuple exactly", () => {
    const back = parseCursorToken(cursorToken({ at: AT, id: "post-1" }));
    expect(back?.at.getTime()).toBe(AT.getTime());
    expect(back?.id).toBe("post-1");
  });

  it("survives a real uuid, which is what ids actually are", () => {
    const id = "3f2a91c4-7b0e-4d18-9a55-0c6b2e8f41d7";
    expect(parseCursorToken(cursorToken({ at: AT, id }))?.id).toBe(id);
  });

  it("is url-safe — no +, / or = to be mangled in transit", () => {
    for (let i = 0; i < 200; i += 1) {
      const token = cursorToken({
        at: new Date(1_760_000_000_000 + i * 7919),
        id: `${i}-${"ab".repeat(i % 9)}`,
      });
      expect(token, token).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it("keeps the total order the tuple has — including the id tie-break", () => {
    // Two posts in the SAME millisecond is real under load, and "newer than"
    // has to stay decidable for them. The token must not lose the half that
    // decides it.
    const a = parseCursorToken(cursorToken({ at: AT, id: "aaa" }))!;
    const b = parseCursorToken(cursorToken({ at: AT, id: "bbb" }))!;
    expect(compareCursor(a, b)).toBeLessThan(0);
    expect(compareCursor(b, a)).toBeGreaterThan(0);
    expect(compareCursor(a, a)).toBe(0);
  });

  it("orders by time before id, once the times differ", () => {
    const older = parseCursorToken(cursorToken({ at: AT, id: "zzz" }))!;
    const newer = parseCursorToken(
      cursorToken({ at: new Date(AT.getTime() + 1), id: "aaa" }),
    )!;
    expect(compareCursor(older, newer)).toBeLessThan(0);
  });

  it("answers null for everything that is not a token — one refusal, no detail", () => {
    for (const bad of [
      undefined,
      null,
      "",
      42,
      {},
      "not base64 at all !!!",
      "Zm9v", // valid base64, wrong shape
      btoa("2|123|x"), // a version this build does not know
      btoa("1|123"), // too few fields
      btoa("1|123|x|y"), // too many
      btoa("1||x"), // no timestamp
      btoa("1|abc|x"), // a timestamp that is not a number
      btoa("1| 12 |x"), // Number() would have accepted this
      btoa("1|1e3|x"), // and this
      btoa("1|123|"), // no id
    ]) {
      expect(parseCursorToken(bad as unknown), String(bad)).toBeNull();
    }
  });

  it("refuses a tampered payload rather than decoding it into something else", () => {
    const token = cursorToken({ at: AT, id: "post-1" });
    // Flip one character. Most flips break base64 or the grammar; the point is
    // that none of them produces a cursor claiming to be the original.
    let differed = 0;
    for (let i = 0; i < token.length; i += 1) {
      const flipped =
        token.slice(0, i) + (token[i] === "A" ? "B" : "A") + token.slice(i + 1);
      const parsed = parseCursorToken(flipped);
      if (parsed === null || parsed.id !== "post-1" || parsed.at.getTime() !== AT.getTime()) {
        differed += 1;
      }
    }
    expect(differed).toBe(token.length);
  });
});

describe("the live cursor token — two positions, one comparison", () => {
  // ⚠️ **There was no test over any of this until 2026-08-06**, which is how a
  // live channel that stops for ever after fifty tombstones shipped and
  // survived review: the arithmetic was pinned, the LOOP around it was not.
  // The half of the repair that lives in `modules/community/lib/manage.ts` is measured
  // in `live-parity.test.ts`; what is measured here is the currency it moves.
  const CREATED = new Date("2026-08-06T10:00:00.000Z");
  const CHANGED = new Date("2026-08-06T11:30:00.000Z");

  it("round-trips both positions, independently of one another", () => {
    // Independently is the whole point. A serializer that carried one position
    // and duplicated it would pass a test that used the same instant twice,
    // and would then silently reintroduce the single-position window this
    // shape exists to replace.
    const cursor: LiveCursor = {
      created: { at: CREATED, id: "post-a" },
      changed: { at: CHANGED, id: "post-b" },
    };
    const back = parseLiveCursorToken(liveCursorToken(cursor));

    expect(back?.created.at.getTime()).toBe(CREATED.getTime());
    expect(back?.created.id).toBe("post-a");
    expect(back?.changed.at.getTime()).toBe(CHANGED.getTime());
    expect(back?.changed.id).toBe("post-b");
  });

  it("keeps the two positions apart even when one is behind the other", () => {
    // The normal state of a live window, not an edge case: half (b) delivers
    // old rows, so its position routinely sits far behind half (a)'s.
    const cursor: LiveCursor = {
      created: { at: CHANGED, id: "zzz" },
      changed: { at: CREATED, id: "aaa" },
    };
    const back = parseLiveCursorToken(liveCursorToken(cursor))!;
    expect(compareCursor(back.changed, back.created)).toBeLessThan(0);
  });

  it("is url-safe — no +, / or = to be mangled in transit", () => {
    for (let i = 0; i < 200; i += 1) {
      const token = liveCursorToken({
        created: { at: new Date(1_760_000_000_000 + i * 7919), id: `${i}-a` },
        changed: { at: new Date(1_759_000_000_000 + i * 104_729), id: `${i}-b` },
      });
      expect(token, token).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it("accepts a SINGLE-position token and reads it as BOTH positions", () => {
    // ⚠️ **This is the upgrade path, and without it every client with the page
    // open resynchronises the moment this version deploys.** Two producers mint
    // a one-position token: the thread page, which knows where the RENDER stood
    // and has only that one position to offer, and every browser still holding
    // a token from before the two-position shape existed. Reading `X` as
    // `{created: X, changed: X}` is exactly what the old window meant by `X`,
    // so nothing is invented and nothing is skipped.
    const one: Cursor = { at: CREATED, id: "post-a" };
    const back = parseLiveCursorToken(cursorToken(one));

    expect(back?.created.at.getTime()).toBe(CREATED.getTime());
    expect(back?.created.id).toBe("post-a");
    expect(back?.changed.at.getTime()).toBe(CREATED.getTime());
    expect(back?.changed.id).toBe("post-a");
    expect(compareCursor(back!.created, back!.changed)).toBe(0);
  });

  it("answers null for everything that is not a token — one refusal, no detail", () => {
    // The same single refusal `parseCursorToken()` gives, for the same reason:
    // a client that cannot produce a valid token has no window to defend, and
    // a refusal that explained itself would teach a prober the format.
    for (const bad of [
      undefined,
      null,
      "",
      42,
      {},
      "not base64 at all !!!",
      "Zm9v", // valid base64, wrong shape
      btoa("L2|1|a|2|b"), // a live version this build does not know
      btoa("L1|1|a|2"), // truncated — four fields
      btoa("L1|1|a|2|b|c"), // one field too many
      btoa("L1|1||2|b"), // no created id
      btoa("L1|1|a|2|"), // no changed id
      btoa("L1|abc|a|2|b"), // a created timestamp that is not a number
      btoa("L1|1|a|xyz|b"), // a changed timestamp that is not a number
      btoa("L1| 1 |a|2|b"), // Number() would have accepted this
      btoa("L1|1e3|a|2|b"), // and this
      btoa("L1|1|a|1e3|b"), // and this, on the other position
    ]) {
      expect(parseLiveCursorToken(bad as unknown), String(bad)).toBeNull();
    }
  });

  it("refuses a tampered payload rather than decoding it into something else", () => {
    const token = liveCursorToken({
      created: { at: CREATED, id: "post-a" },
      changed: { at: CHANGED, id: "post-b" },
    });
    let differed = 0;
    for (let i = 0; i < token.length; i += 1) {
      const flipped =
        token.slice(0, i) + (token[i] === "A" ? "B" : "A") + token.slice(i + 1);
      const parsed = parseLiveCursorToken(flipped);
      if (
        parsed === null ||
        parsed.created.id !== "post-a" ||
        parsed.changed.id !== "post-b" ||
        parsed.created.at.getTime() !== CREATED.getTime() ||
        parsed.changed.at.getTime() !== CHANGED.getTime()
      ) {
        differed += 1;
      }
    }
    expect(differed).toBe(token.length);
  });
});

describe("liveCursorBeginning — 'I have nothing' is not 'I cannot read my token'", () => {
  // The defect this function exists for: an empty view used to send no cursor
  // at all, the endpoint could not tell that from an unreadable token, and the
  // resynchronise branch answered `posts: []` together with a cursor PAST the
  // post that had arrived meanwhile. So the first post ever written into a
  // freshly declared embed never arrived — and every embed is in that state on
  // the day somebody declares it.
  it("is a token this build can read", () => {
    // The load-bearing half. A value that parsed to `null` would be the very
    // "no cursor" it was minted to stop being.
    expect(parseLiveCursorToken(liveCursorBeginning())).not.toBeNull();
  });

  it("lies before every real cursor, on both positions", () => {
    const beginning = parseLiveCursorToken(liveCursorBeginning())!;
    const real: Cursor[] = [
      { at: new Date(1), id: "0" },
      { at: new Date(0), id: "3f2a91c4-7b0e-4d18-9a55-0c6b2e8f41d7" },
      { at: new Date("2026-08-06T10:00:00.000Z"), id: "post-1" },
    ];

    for (const cursor of real) {
      expect(
        compareCursor(beginning.created, cursor),
        `${cursor.at.toISOString()}/${cursor.id} is not past the beginning`,
      ).toBeLessThan(0);
      expect(compareCursor(beginning.changed, cursor)).toBeLessThan(0);
    }
  });

  it("sorts before a real id even where the timestamps tie", () => {
    // `id: "0"` is chosen for this: `crypto.randomUUID()` never produces a
    // string below it. The epoch makes the tie-break unreachable in practice,
    // so this asserts the belt as well as the braces.
    const beginning = parseLiveCursorToken(liveCursorBeginning())!;
    expect(beginning.created.at.getTime()).toBe(0);
    expect(
      compareCursor(beginning.created, { at: new Date(0), id: UUID }),
    ).toBeLessThan(0);
  });
});

describe("advanceCursor — monotonic, or the window redelivers for ever", () => {
  const T0 = new Date("2026-08-06T10:00:00.000Z");
  const T1 = new Date("2026-08-06T10:00:00.001Z");
  const T2 = new Date("2026-08-06T11:00:00.000Z");

  it("moves to the newest row delivered, whatever order they arrive in", () => {
    // The rows come back ordered, but the position is the MAXIMUM rather than
    // the last element — half (b) is ordered by a key that is computed, and a
    // position that trusted the ordering would be one refactor away from
    // stepping over a row it had already sent.
    const from: Cursor = { at: T0, id: "a" };
    const delivered: Cursor[] = [
      { at: T2, id: "c" },
      { at: T1, id: "b" },
      { at: T0, id: "z" },
    ];
    expect(advanceCursor(from, delivered)).toEqual({ at: T2, id: "c" });
  });

  it("breaks a tie by id, exactly as compareCursor does", () => {
    const from: Cursor = { at: T1, id: "a" };
    expect(advanceCursor(from, [{ at: T1, id: "b" }])).toEqual({ at: T1, id: "b" });
  });

  it("NEVER goes backwards, however old the rows it delivered are", () => {
    // ⚠️ This is the property the whole two-position shape rests on. Half (b)
    // delivers rows written last month; a position that took the newest of
    // THEM would rewind the window and redeliver everything after it on every
    // poll — for ever, because the next poll would rewind again.
    const from: Cursor = { at: T2, id: "m" };
    const older: Cursor[] = [
      { at: T0, id: "a" },
      { at: T1, id: "zzz" },
      { at: T2, id: "a" }, // same instant, smaller id
    ];
    expect(advanceCursor(from, older)).toBe(from);
  });

  it("stands still on an empty answer", () => {
    // The overwhelmingly common poll: nothing happened. Standing still is what
    // makes the next poll ask the same question rather than a wider one.
    const from: Cursor = { at: T1, id: "a" };
    expect(advanceCursor(from, [])).toBe(from);
  });

  it("keeps the position it was given when only some rows are ahead", () => {
    const from: Cursor = { at: T1, id: "m" };
    const mixed: Cursor[] = [
      { at: T0, id: "z" },
      { at: T2, id: "a" },
      { at: T0, id: "a" },
    ];
    expect(advanceCursor(from, mixed)).toEqual({ at: T2, id: "a" });
  });
});

describe("the poll schedule — SM-16's counter-metric, counted", () => {
  // ⚠️ The SHIPPED defaults, deliberately. SM-16 is a claim about what this
  // template does to a host out of the box, so a test that configured its own
  // numbers would be measuring the test.
  const SHIPPED: { visibleMs: number; hiddenMs: number } = {
    visibleMs: 5_000,
    hiddenMs: 30_000,
  };
  const TEN_MINUTES = 10 * 60 * 1000;

  it("polls faster while the tab is visible than while it is hidden", () => {
    expect(pollDelayMs(SHIPPED, false)).toBe(5_000);
    expect(pollDelayMs(SHIPPED, true)).toBe(30_000);
  });

  it("keeps the visible interval inside NFR-38's ten seconds", () => {
    expect(pollDelayMs(SHIPPED, false)).toBeLessThanOrEqual(10_000);
  });

  it("makes an idle tab cost a measurable fraction of a watched one", () => {
    const visible = pollInstants(SHIPPED, TEN_MINUTES, () => false);
    const hidden = pollInstants(SHIPPED, TEN_MINUTES, () => true);

    // The RATIO, not the literals: a tuned default must not break the intent.
    expect(hidden.length).toBeLessThan(visible.length / 2);
    expect(visible.length).toBeGreaterThan(0);
    expect(hidden.length).toBeGreaterThan(0);
  });

  it("switches rate mid-window when the tab is hidden part of the time", () => {
    const half = TEN_MINUTES / 2;
    const mixed = pollInstants(SHIPPED, TEN_MINUTES, (at) => at >= half);
    const visible = pollInstants(SHIPPED, TEN_MINUTES, () => false);

    expect(mixed.length).toBeLessThan(visible.length);
    // Everything before the switch is on the visible cadence. One short of
    // `half / 5_000`, because the poll AT the switch point is the last one the
    // visible cadence scheduled and lands exactly on it.
    expect(mixed.filter((at) => at < half).length).toBe(half / 5_000 - 1);
    expect(mixed).toContain(half);
  });

  it("terminates on a nonsense schedule instead of enumerating infinity", () => {
    // The config readers bound the real values; this function is pure and
    // takes what it is given, so the floor is what keeps a `0` from hanging
    // whoever calls it.
    expect(pollInstants({ visibleMs: 0, hiddenMs: 0 }, 10, () => false)).toHaveLength(10);
  });
});

// ── Direct messages ────────────────────────────────────────────────────────

describe("canonicalPair", () => {
  it("orders two ids the way the column order demands", () => {
    // `a < b`, which is what the CHECK constraint says and what Postgres does
    // for `text`. The two are the same comparison rather than two that agree
    // today — that is the whole reason this function exists.
    expect(canonicalPair("a", "b")).toEqual({
      participantAId: "a",
      participantBId: "b",
    });
    expect(canonicalPair("b", "a")).toEqual({
      participantAId: "a",
      participantBId: "b",
    });
  });

  it("gives the same answer whichever member starts the conversation", () => {
    // The property that matters: the unique index can only do its job if the
    // two directions produce one row. A test per direction would pass on an
    // implementation that returned its arguments unchanged.
    const ids = ["11111111", "8f41c0de", "zzz", "0", "Ä", "a"];
    for (const one of ids) {
      for (const other of ids) {
        if (one === other) continue;
        expect(canonicalPair(one, other)).toEqual(canonicalPair(other, one));
      }
    }
  });

  it("refuses a conversation with oneself", () => {
    // Refused here so no write path has to remember to — the CHECK constraint
    // would otherwise reach a member as a 500.
    expect(canonicalPair("me", "me")).toBeNull();
  });
});

describe("isParticipant", () => {
  const conversation = { participantAId: "a", participantBId: "b" };

  it("recognises both sides and nobody else", () => {
    expect(isParticipant(conversation, "a")).toBe(true);
    expect(isParticipant(conversation, "b")).toBe(true);
    expect(isParticipant(conversation, "c")).toBe(false);
  });

  it("does not let a departed participant's NULL match anybody", () => {
    // The FK NULLs the column when an account goes. A comparison that treated
    // that NULL as a wildcard would open a deleted member's conversation to
    // whoever asked with an undefined id.
    const departed = { participantAId: null, participantBId: "b" };
    expect(isParticipant(departed, "b")).toBe(true);
    expect(isParticipant(departed, "a")).toBe(false);
  });
});

describe("counterpartOf", () => {
  it("answers the other side, from either side", () => {
    const conversation = { participantAId: "a", participantBId: "b" };
    expect(counterpartOf(conversation, "a")).toBe("b");
    expect(counterpartOf(conversation, "b")).toBe("a");
  });

  it("answers null for a departed counterpart", () => {
    // A normal state, not an error: the conversation survives the account
    // (FR-203) and the inbox renders a former member.
    expect(counterpartOf({ participantAId: "a", participantBId: null }, "a")).toBeNull();
  });

  it("answers null for somebody who is not in it", () => {
    expect(
      counterpartOf({ participantAId: "a", participantBId: "b" }, "c"),
    ).toBeNull();
  });
});

describe("canSendMessage", () => {
  it("needs a display name, like every other write in this module", () => {
    expect(canSendMessage(null)).toBe("communityProfileIncomplete");
    expect(canSendMessage({ displayName: "" })).toBe("communityProfileIncomplete");
    expect(canSendMessage({ displayName: "Ada" })).toBeNull();
  });
});

describe("checkMessageContent", () => {
  it("keeps line breaks and normalises CRLF before measuring", () => {
    const result = checkMessageContent("one\r\ntwo");
    expect(result).toEqual({ ok: true, content: "one\ntwo" });
  });

  it("refuses a message that renders as nothing", () => {
    // `visibleLength`, not `=== ""`: zero-width characters would otherwise be
    // a message with somebody's name on it and nothing in it.
    expect(checkMessageContent("   ")).toEqual({ ok: false, code: "communityMessageEmpty" });
    expect(checkMessageContent("​​")).toEqual({
      ok: false,
      code: "communityMessageEmpty",
    });
    expect(checkMessageContent(42)).toEqual({ ok: false, code: "communityMessageEmpty" });
  });

  it("refuses a message past the cap, and the megabyte before that", () => {
    expect(checkMessageContent("x".repeat(MAX_MESSAGE_LENGTH))).toEqual({
      ok: true,
      content: "x".repeat(MAX_MESSAGE_LENGTH),
    });
    expect(checkMessageContent("x".repeat(MAX_MESSAGE_LENGTH + 1))).toEqual({
      ok: false,
      code: "communityMessageTooLong",
    });
    expect(checkMessageContent("x".repeat(MAX_MESSAGE_LENGTH * 2 + 1))).toEqual({
      ok: false,
      code: "communityMessageTooLong",
    });
  });

  it("does not refuse a CRLF message the browser's own maxLength accepted", () => {
    // The reason the raw guard is twice the cap: CRLF normalisation halves the
    // length, and a browser submits a textarea with CRLF.
    const typed = "ab\r\n".repeat(MAX_MESSAGE_LENGTH / 4 + 100);
    expect(typed.length).toBeGreaterThan(MAX_MESSAGE_LENGTH);
    expect(checkMessageContent(typed).ok).toBe(true);
  });
});

describe("messageLimit", () => {
  it("is its own bucket, not a share of the posting one", () => {
    // The third of the module's three. One bucket for two behaviours would let
    // a conversation in a room eat the allowance for writing to people.
    expect(COMMUNITY_DM_RATE_BUCKET).not.toBe(COMMUNITY_POST_RATE_BUCKET);
    expect(COMMUNITY_DM_RATE_BUCKET).not.toBe(CHAT_RATE_BUCKET);
  });

  it("uses the same ten-minute window as the posting brake", () => {
    expect(messageLimit(10)).toEqual({ max: 10, windowMs: 10 * 60 * 1000 });
    expect(messageLimit(10).windowMs).toBe(postLimit(20).windowMs);
  });
});

describe("checkPostImages", () => {
  // ── What this pins ─────────────────────────────────────────────────────────
  // Three refusals that all happen BEFORE a byte is read, which is the whole
  // reason this function is pure: the ceiling has to be applied without
  // buffering fifty files to find out there are fifty. Every one of them is a
  // sentence a member can act on, so each has its own code.
  const ALT = "Mein fertiges Regal";

  it("waves through a post with no pictures, whatever the ceiling says", () => {
    // Including a ceiling of zero: a text-only community still takes posts.
    expect(checkPostImages(0, [], 3)).toEqual({ ok: true, alts: [] });
    expect(checkPostImages(0, [], 0)).toEqual({ ok: true, alts: [] });
  });

  it("trims each description and hands them back in order", () => {
    expect(checkPostImages(2, ["  eins  ", "zwei"], 3)).toEqual({
      ok: true,
      alts: ["eins", "zwei"],
    });
  });

  it("ignores descriptions past the picture count", () => {
    // The form delivers one `imageAlt` per RENDERED slot, and the action drops
    // the pairs whose file was empty — so a trailing description is normal
    // rather than a malformed request.
    expect(checkPostImages(1, [ALT, "for a slot nobody filled"], 3)).toEqual({
      ok: true,
      alts: [ALT],
    });
  });

  it("refuses more pictures than the ceiling allows", () => {
    expect(checkPostImages(4, Array(4).fill(ALT), 3)).toEqual({
      ok: false,
      code: "communityTooManyImages",
    });
    // Exactly at the ceiling is fine — an off-by-one here is a member told they
    // may attach three and refused for attaching three.
    expect(checkPostImages(3, Array(3).fill(ALT), 3).ok).toBe(true);
  });

  it("refuses any picture at all when the operator switched them off", () => {
    // ⚠️ A DIFFERENT code from "too many", and the difference is the sentence:
    // "at most 0 per post" is not something anybody can act on. The composer
    // renders no field in this state, so anything arriving here is a crafted
    // request — and a Server Action is a public endpoint.
    expect(checkPostImages(1, [ALT], 0)).toEqual({
      ok: false,
      code: "communityImagesOff",
    });
  });

  it("refuses a picture nobody described — missing, blank or invisible", () => {
    for (const value of [undefined, null, 42, "", "   ", ZERO_WIDTH]) {
      expect(checkPostImages(1, [value], 3), String(value)).toEqual({
        ok: false,
        code: "communityImageAltInvalid",
      });
    }
  });

  it("refuses a description longer than the cap", () => {
    expect(checkPostImages(1, ["x".repeat(MAX_IMAGE_ALT_LENGTH + 1)], 3)).toEqual({
      ok: false,
      code: "communityImageAltInvalid",
    });
    expect(checkPostImages(1, ["x".repeat(MAX_IMAGE_ALT_LENGTH)], 3).ok).toBe(true);
  });

  it("🚨 refuses the SECOND picture's missing description, not only the first", () => {
    // The loop's own boundary. A check written as "the first one has a
    // description" would pass here — and what ships is a post whose second
    // picture is announced to a screen reader as nothing at all.
    expect(checkPostImages(2, [ALT, ""], 3)).toEqual({
      ok: false,
      code: "communityImageAltInvalid",
    });
  });
});
