// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 What a REFUSED act says it was about.
//
// The defect this holds shut, measured in Story 34.4 and carried as A53: a
// domain refusal reaches `dispatch.ts` as an error and not as a `SetupResult`,
// so the row it wrote had no `target` — `contentMediaLengthMismatch` said the
// length disagreed and never which of forty files it was. Against a real
// database the trail read:
//
//   content_media_confirm |                       | refused | contentMediaLengthMismatch | 0
//   grant_revoke          |                       | refused | grantNotFound              | 0
//
// …where the planned row two lines above it named its subject. An operator
// reads this table AFTER something went wrong, which makes the refused row the
// one that has to carry the identifier most.
//
// The tests below drive the REAL tools through the REAL dispatch and read what
// `recordAct()` was handed. Deleting the `target:` line from either refusal
// branch turns them red; so does dropping a tool's `targetField`.

import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

const {
  recordAct,
  memberIdForEmail,
  guardSetup,
  loadManifest,
  store,
  grantByHand,
  createUser,
  countOwners,
  selected,
  memberOfGrant,
  revokeGrantByHand,
  publishContent,
  applierPlans,
  issueConfirmation,
} = vi.hoisted(() => ({
  recordAct: vi.fn(async () => undefined),
  memberIdForEmail: vi.fn(async () => null as string | null),
  guardSetup: vi.fn(),
  applierPlans: vi.fn(),
  issueConfirmation: vi.fn(async () => "confirmation-token"),
  loadManifest: vi.fn(),
  store: { head: vi.fn(), firstBytes: vi.fn(), remove: vi.fn(), createUploadUrl: vi.fn() },
  grantByHand: vi.fn(),
  createUser: vi.fn(async () => ({ id: "member-42", email: "neu@example.com", role: "member" })),
  // `user_upsert` asks the role rule before it writes, and the rule needs the
  // owner count (lib/users/manage.ts → createUser). Two owners, so the answer
  // never turns on `lastOwnerRole` — the cases here are about the TRAIL, and a
  // fixture that also refused would be measuring the wrong thing.
  countOwners: vi.fn(async () => 2),
  /** What the tools' own `db.select(...).limit(1)` answers with. */
  selected: { rows: [] as unknown[] },
  memberOfGrant: vi.fn(async () => null as string | null),
  revokeGrantByHand: vi.fn(),
  publishContent: vi.fn(),
}));

// The trail's writer, captured rather than mocked away: what is asserted here is
// the ARGUMENT, which is the whole subject of this file.
vi.mock("./manage", () => ({
  recordAct,
  memberIdForEmail,
  issueConfirmation,
  touchKey: vi.fn(),
}));
// The guard has its own file and its own tests; what it hands over is fixed here
// so these tests are about the recording and nothing else.
vi.mock("./guard", () => ({ guardSetup }));
// `after()` throws outside a request scope. Running the callback straight away
// keeps the bookkeeping half of the success path from turning into a second,
// invented audit row here.
vi.mock("next/server", () => ({
  after: (fn: () => unknown) => {
    void fn();
  },
}));
vi.mock("@/scripts/content/_manifest.mjs", async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  loadManifest,
}));
vi.mock("@/lib/media/store", () => ({ mediaStore: () => store }));
vi.mock("@/lib/entitlements/manage", () => ({ grantByHand, memberOfGrant, revokeGrantByHand }));
// The two person-shaped tools look an address up themselves before they act.
// That read is the DOMAIN's business and not this file's subject, so it answers
// from here — otherwise every act below reaches for a database that is not
// there and every refusal arrives as `internal`.
vi.mock("@/db", () => {
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.where = () => chain;
  chain.innerJoin = () => chain;
  chain.limit = () => Promise.resolve(selected.rows);
  return { db: { select: () => chain } };
});
vi.mock("@/lib/users/manage", () => ({
  createUser,
  countOwners,
  listUsers: vi.fn(async () => []),
}));
vi.mock("@/lib/content/publish", async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  publishContent,
  assertContentMediaRow: vi.fn(async () => ({ created: true, key: "content/x" })),
}));
// Only `content_publish`'s PLAN half reaches this, and only the A75 block below
// uses it — the enumeration failing is one of the five refusals-by-answer.
vi.mock("@/lib/content/applier-plan", async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  applierPlans,
}));

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "@/scripts/lib/source-text.mjs";
import { runSetupCall } from "./dispatch";
import { toolsByName } from "./registry";
import type { AuditEntry } from "./manage";

/** One entry of a `content/media-manifest.json`, as `loadManifest()` returns it. */
const ENTRY = {
  path: "kurs-basics/intro.mp4",
  key: "content/kurs-basics/intro.mp4",
  kind: "video",
  contentType: "video/mp4",
  visibility: "entitled",
  requiresPlan: "course_complete",
  alt: null,
  filename: "intro.mp4",
  bytes: 15_728_640,
  sha256: "a".repeat(64),
};

/** The first sixteen bytes of a real MP4 — what `sniff.ts` reads. */
const MP4_HEAD = new Uint8Array([
  0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x02, 0x00,
]);

/** A typed domain error, in the shape every domain here throws. */
class DomainError extends Error {
  readonly code: string;
  constructor(name: string, code: string, message = code) {
    super(message);
    this.name = name;
    this.code = code;
  }
}

/** Run one act through the real dispatch, and hand back the row it recorded. */
async function actOn(
  name: string,
  input: Record<string, unknown>,
  mode: "plan" | "apply" = "apply",
): Promise<AuditEntry> {
  const tool = toolsByName().get(name);
  expect(tool, `${name} is not in the registry`).toBeDefined();
  guardSetup.mockResolvedValue({
    ok: true,
    keyId: "key-1",
    ownerId: "owner-1",
    appEnv: "production",
    tool,
    mode,
    input,
  });
  await runSetupCall({
    request: new Request("http://localhost:3003/api/setup", { method: "POST" }),
    body: { tool: name, env: "production", mode, input },
  });
  const rows = recordAct.mock.calls as unknown as AuditEntry[][];
  expect(rows.length, `${name} recorded no act at all`).toBe(1);
  return rows[0][0];
}

beforeEach(() => {
  vi.clearAllMocks();
  memberIdForEmail.mockResolvedValue(null);
  memberOfGrant.mockResolvedValue(null);
  selected.rows = [];
  loadManifest.mockReturnValue({ entries: [ENTRY], problems: [] });
  store.head.mockResolvedValue(null);
  store.firstBytes.mockResolvedValue(MP4_HEAD);
  store.remove.mockResolvedValue(undefined);
  // The local driver's honest answer, and the one A75's fifth case turns on.
  store.createUploadUrl.mockReturnValue(null);
  issueConfirmation.mockResolvedValue("confirmation-token");
});

describe("🚨 a refused act keeps its target", () => {
  // The measured case from Story 34.4, finding 2 — the reason A53 exists.
  it("names the file a length mismatch was about", async () => {
    store.head.mockResolvedValue({ bytes: 12 });

    const row = await actOn("content_media_confirm", { path: ENTRY.path });

    expect(row.outcome).toBe("refused");
    expect(row.code).toBe("contentMediaLengthMismatch");
    // The whole point: WHAT happened, and to WHICH file.
    expect(row.target).toBe(ENTRY.path);
    // The object it removed is named by its content key, and that key stays out
    // of the trail — the target is the manifest path, as docs/setup-mcp.md says.
    expect(row.target).not.toContain("content/");
  });

  // A second domain, so the mechanism is not one tool's special case.
  it("names the grant a revoke was refused for", async () => {
    revokeGrantByHand.mockRejectedValue(new DomainError("GrantError", "grantNotFound"));

    const row = await actOn("grant_revoke", {
      grantId: "gr_7f3a9c21",
      reason: "granted to the wrong address",
    });

    expect(row.outcome).toBe("refused");
    expect(row.code).toBe("grantNotFound");
    expect(row.target).toBe("gr_7f3a9c21");
  });

  // 🚨 The invariant behind both: a refusal names what a success would have
  // named. Same tool, same input, the two outcomes side by side.
  it("names on the refusal what the success path names", async () => {
    store.head.mockResolvedValue({ bytes: ENTRY.bytes });
    const succeeded = await actOn("content_media_confirm", { path: ENTRY.path }, "plan");

    vi.clearAllMocks();
    loadManifest.mockReturnValue({ entries: [ENTRY], problems: [] });
    store.head.mockResolvedValue({ bytes: 12 });
    store.remove.mockResolvedValue(undefined);
    const refused = await actOn("content_media_confirm", { path: ENTRY.path }, "plan");

    expect(succeeded.outcome).toBe("planned");
    expect(refused.outcome).toBe("refused");
    expect(refused.target).toBe(succeeded.target);
  });

  // The other branch that records without a result. An act that threw halfway is
  // exactly what somebody goes looking for, and "which one" is the question.
  it("names the subject of a crash, not only of a refusal", async () => {
    // The `console.error` below is the behaviour under test, not an accident — this
    // test PROVOKES the failure. Silenced so an UNEXPECTED error stays visible in
    // the run's output instead of drowning in expected noise.
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    onTestFinished(() => quiet.mockRestore());
    const broken = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    store.head.mockRejectedValue(broken);

    const row = await actOn("content_media_confirm", { path: ENTRY.path });

    // A Node system error is not a domain refusal — this is the internal branch.
    expect(row.code).toBe("internal");
    expect(row.target).toBe(ENTRY.path);
  });

  // ⚠️ An empty target is an ANSWER here, and this is what makes it one:
  // `content_publish` declares that it has nothing to name, so the blank column
  // is a decision somebody took rather than an identifier that fell out.
  it("leaves the target empty where the tool declares it has none", async () => {
    publishContent.mockRejectedValue(
      new DomainError(
        "PublishError",
        "applierWithoutApply",
        "courses:course.mjs exports no apply(sql, helpers)",
      ),
    );

    const row = await actOn("content_publish", {});

    expect(row.outcome).toBe("refused");
    expect(row.code).toBe("applierWithoutApply");
    expect(row.target).toBeNull();
    // Not an omission: the tool says so, and `registry.test.ts` holds every tool
    // to saying one or the other.
    expect(toolsByName().get("content_publish")?.targetField).toBeNull();
  });

  // A refusal must never turn a whitespace field into a target that looks
  // answered — and `String(input.path)` inside a tool would not save this,
  // because the tool never runs on the branches above.
  it("treats a blank identifier as absent rather than as an answer", async () => {
    revokeGrantByHand.mockRejectedValue(new DomainError("GrantError", "grantNotFound"));

    const row = await actOn("grant_revoke", { grantId: "   ", reason: "a reason" });

    expect(row.outcome).toBe("refused");
    expect(row.target).toBeNull();
  });

  // The refusal a stranger causes is deliberately the other way round: the guard
  // refuses before `validateInput()` has judged anything, so there is no
  // identifier this file would be entitled to write. Asserted so that "the guard
  // branch has no target" stays a decision with a test on it.
  it("writes no target for a refusal the guard made", async () => {
    guardSetup.mockResolvedValue({
      ok: false,
      response: Response.json({ error: "unknownTool" }, { status: 400 }),
    });

    await runSetupCall({
      request: new Request("http://localhost:3003/api/setup", { method: "POST" }),
      body: { tool: "no_such_tool", env: "production", mode: "plan", input: { path: "x" } },
    });

    const rows = recordAct.mock.calls as unknown as AuditEntry[][];
    expect(rows.length).toBe(1);
    expect(rows[0][0].tool).toBe("no_such_tool");
    expect(rows[0][0].target ?? null).toBeNull();
  });
});

// 🚨 A70 — WHO the act was about, and A72 — WHY, on the paths that refuse.
//
// Two defects with one shape: a column that only the success path ever filled.
//
// `setup_audit.subject_member_id` was written by NOTHING — `dispatch.ts` is the
// trail's only writer and never passed the field, so `manage.ts` put `?? null`
// in every row. Meanwhile `lib/privacy/export.ts` and
// `scripts/privacy/export-data.mjs` both cut the `setupActs` section with
// `where subject_member_id = <memberId>`: that section was empty in BOTH Art. 15
// exports of every member of every app, while rows about exactly that person sat
// in the table. `docs/data-protection.md` calls the column "what makes the
// section sliceable per person".
//
// `reason` and `role` were recorded only where the act SUCCEEDED. So a refused
// `grant_revoke` — the irreversible one, whose tool DEMANDS a written reason
// before it will run — kept no reason at all, and `docs/setup-mcp.md` calls that
// reason "the accountability".
//
// The tests below drive the real tools through the real dispatch and read what
// `recordAct()` was handed, the same way the block above does for `target`.
describe("🚨 an act names its member, and a refusal keeps its reason", () => {
  it("resolves the member behind the address, on the success path", async () => {
    memberIdForEmail.mockResolvedValue("member-42");

    const row = await actOn("user_upsert", { email: "Neu@Example.com", role: "member" });

    expect(row.outcome).toBe("applied");
    expect(row.subjectMemberId).toBe("member-42");
    // The address is what an operator reads; the id is what an export slices on.
    // Both, never one standing in for the other.
    expect(row.target).toBe("neu@example.com");
    expect(memberIdForEmail).toHaveBeenCalledWith("Neu@Example.com");
    // The role is the security question this trail exists to answer.
    expect(row.role).toBe("member");
  });

  // The one that made A70 sharp: an act about a person that was REFUSED is
  // still an act about that person.
  it("names the member of a refused grant, and keeps the reason with it", async () => {
    memberIdForEmail.mockResolvedValue("member-42");
    selected.rows = [{ id: "member-42" }];
    grantByHand.mockRejectedValue(new DomainError("GrantError", "unknownProduct"));

    const row = await actOn("grant_by_hand", {
      email: "kunde@example.com",
      productKey: "course_complete",
      reason: "paid by invoice, order 4711",
    });

    expect(row.outcome).toBe("refused");
    expect(row.code).toBe("unknownProduct");
    expect(row.subjectMemberId).toBe("member-42");
    expect(row.reason).toBe("paid by invoice, order 4711");
  });

  // The irreversible tool, on both halves of the two-act protocol. Its input
  // names a GRANT, so the member comes from the row and not from the input —
  // the result-side half of the declaration.
  it("takes the member of a revoke off the grant row, in plan and in apply", async () => {
    memberOfGrant.mockResolvedValue("member-7");
    const planned = await actOn("grant_revoke", { grantId: "gr_1", reason: "wrong person" }, "plan");

    vi.clearAllMocks();
    memberIdForEmail.mockResolvedValue(null);
    revokeGrantByHand.mockResolvedValue({
      id: "gr_1",
      memberId: "member-7",
      productKey: "course_complete",
      endedAt: new Date("2026-08-12T08:00:00.000Z"),
    });
    const applied = await actOn("grant_revoke", { grantId: "gr_1", reason: "wrong person" });

    expect(planned.subjectMemberId).toBe("member-7");
    expect(applied.subjectMemberId).toBe("member-7");
    // 🚨 And never from the input: the id is read out of the row that was
    // closed, so a caller cannot decide whose export an act turns up in.
    expect(revokeGrantByHand).toHaveBeenCalledWith({
      actor: { id: "owner-1", role: "owner" },
      grantId: "gr_1",
    });
  });

  it("keeps the reason when the irreversible act is REFUSED", async () => {
    revokeGrantByHand.mockRejectedValue(new DomainError("GrantError", "alreadyEnded"));

    const row = await actOn("grant_revoke", { grantId: "gr_1", reason: "asked to reverse it" });

    expect(row.outcome).toBe("refused");
    expect(row.reason).toBe("asked to reverse it");
  });

  it("keeps the reason when the act CRASHED", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    onTestFinished(() => quiet.mockRestore());
    revokeGrantByHand.mockRejectedValue(
      Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
    );

    const row = await actOn("grant_revoke", { grantId: "gr_1", reason: "asked to reverse it" });

    expect(row.code).toBe("internal");
    expect(row.reason).toBe("asked to reverse it");
  });

  // ⚠️ The distinction the empty column has to carry. Both rows say `null`, and
  // they are different statements — so the difference lives where it can: the
  // tool's own declaration, and the address still standing in `target`.
  it("tells 'looked and found nobody' from 'this tool knows no person'", async () => {
    // The real case, not a contrived one: a PLAN for somebody who does not have
    // an account yet. The address is perfectly good; nobody is behind it.
    memberIdForEmail.mockResolvedValue(null);
    const lookedAndFoundNobody = await actOn(
      "user_upsert",
      { email: "niemand@example.com", role: "member" },
      "plan",
    );

    vi.clearAllMocks();
    selected.rows = [];
    publishContent.mockRejectedValue(new DomainError("PublishError", "applierWithoutApply"));
    const knowsNoPerson = await actOn("content_publish", {});

    expect(lookedAndFoundNobody.subjectMemberId ?? null).toBeNull();
    expect(knowsNoPerson.subjectMemberId ?? null).toBeNull();

    // What tells them apart, from the row plus the enumerated surface:
    expect(toolsByName().get("user_upsert")?.subjectEmailField).toBe("email");
    expect(lookedAndFoundNobody.target).toBe("niemand@example.com");
    expect(toolsByName().get("content_publish")?.subjectEmailField).toBeNull();
    expect(knowsNoPerson.target).toBeNull();
  });

  // 🚨 The line A53 drew and A72 does NOT move. The guard refuses before
  // `validateInput()` has judged anything: `body.input` is unbounded text from a
  // stranger who need not even hold a key, and a trail whose rule is
  // "identifiers and numbers" must not let them choose what these columns say.
  it("writes no reason, no role and no member for a refusal the guard made", async () => {
    guardSetup.mockResolvedValue({
      ok: false,
      response: Response.json({ error: "badKey" }, { status: 401 }),
    });

    await runSetupCall({
      request: new Request("http://localhost:3003/api/setup", { method: "POST" }),
      body: {
        tool: "grant_revoke",
        env: "production",
        mode: "apply",
        input: { grantId: "gr_1", reason: "x".repeat(5000), role: "owner", email: "a@b.de" },
      },
    });

    const row = (recordAct.mock.calls as unknown as AuditEntry[][])[0][0];
    expect(row.reason ?? null).toBeNull();
    expect(row.role ?? null).toBeNull();
    expect(row.subjectMemberId ?? null).toBeNull();
    // And nothing was looked up on that path either — an unauthenticated caller
    // does not get to make the trail query the user table.
    expect(memberIdForEmail).not.toHaveBeenCalled();
  });
});

// 🚨 A75 — a tool that REFUSES BY ANSWERING is recorded as a refusal.
//
// The third defect of the same family, and the one that reached the sharpest
// column. Five branches hand back a `SetupResult` instead of throwing, so they
// never pass the `catch` that the two blocks above are about — they run the
// SUCCESS path, and it wrote `applied` (or `planned`), `code: null`, `rows: 0`:
//
//   user_upsert       | neuer.chef@example.com | owner | applied | — | 0
//   grant_by_hand     | niemand@example.com    |       | applied | — | 0
//   media_upload      | /home/op/held.png      |       | applied | — | 0
//   content_media_url | kurs-basics/intro.mp4  |       | applied | — | 0
//   content_publish   |                        |       | planned | — | 0
//
// Measured against Postgres 16 with all eight migrations, a real key through the
// real `guardSetup()`, and the real `recordAct()` — not read off the code. Every
// one of those five is a refusal before any write, which `docs/setup-mcp.md`'s
// four-state table has always said is `refused` carrying the refusal's code.
//
// ⚠️ **Returning rather than throwing stays**, and the repair is on this side:
// three of the five carry a payload the caller acts on (`content_media_url`
// hands back the two ways forward and `scripts/content/publish.mjs` branches on
// it), and all five carry `subjects`, which an exception cannot. So the tools
// declare the refusal (`SetupResult.refused`) and `dispatch.ts` reads it —
// never guessing off `created === 0`, which is also what an honest no-op success
// looks like. That last sentence is the counter-proof at the foot of this block.
describe("🚨 a refusal the tool ANSWERS with is recorded as one", () => {
  /** The five, as the reproduction drove them. */
  const CASES: {
    tool: string;
    input: Record<string, unknown>;
    mode: "plan" | "apply";
    code: string;
    target: string | null;
    arrange?: () => void;
  }[] = [
    {
      // AD-92: the one irreversible escalation, refused outside DEV. The row
      // that most needs to say it was refused said the opposite.
      tool: "user_upsert",
      input: { email: "neuer.chef@example.com", role: "owner", name: "Chef" },
      mode: "apply",
      code: "ownerPromotionRefused",
      target: "neuer.chef@example.com",
    },
    {
      // 🚨 The half AD-92 was written without. `moderator` is not an admin —
      // `requireOwner()` refuses one exactly as it refuses a member — which is
      // why the rule read as complete while naming only the owner. It is reach
      // over other people's words all the same: `moderators`-visible rooms, and
      // removing somebody else's post. The injected sentence asking for one
      // costs what the one asking for an owner costs.
      tool: "user_upsert",
      input: { email: "neuer.mod@example.com", role: "moderator" },
      mode: "apply",
      code: "ownerPromotionRefused",
      target: "neuer.mod@example.com",
    },
    {
      tool: "grant_by_hand",
      input: {
        email: "niemand@example.com",
        productKey: "course_complete",
        reason: "paid by invoice, order 4711",
      },
      mode: "apply",
      code: "notFound",
      target: "niemand@example.com",
      arrange: () => {
        selected.rows = [];
      },
    },
    {
      // Reached through the JSON door, which carries no bytes — `actOn` passes
      // no `file`, which IS the refusal.
      tool: "media_upload",
      input: { path: "/home/op/bilder/held.png", visibility: "public", alt: "Held" },
      mode: "apply",
      code: "badRequest",
      target: "/home/op/bilder/held.png",
    },
    {
      // The local driver cannot mint an address. The one of the five that had no
      // name at all — it sets no `data.refused` either, because its CLI reads
      // `data.upload` / `data.reason` instead.
      tool: "content_media_url",
      input: { path: ENTRY.path },
      mode: "apply",
      code: "noUploadAddress",
      target: ENTRY.path,
      arrange: () => {
        store.head.mockResolvedValue(null);
        store.createUploadUrl.mockReturnValue(null);
      },
    },
    {
      // "I could not look" and "there is nothing there" must never be the same
      // answer — including in the row.
      tool: "content_publish",
      input: {},
      mode: "plan",
      code: "appliersUnreadable",
      target: null,
      arrange: () => {
        applierPlans.mockRejectedValue(new Error("content/appliers: ENOENT"));
      },
    },
  ];

  for (const testCase of CASES) {
    it(`records ${testCase.tool} → ${testCase.code} as refused`, async () => {
      testCase.arrange?.();

      const row = await actOn(testCase.tool, testCase.input, testCase.mode);

      expect(row.outcome).toBe("refused");
      expect(row.code).toBe(testCase.code);
      // The four-state table's third column: nothing was written.
      expect(row.rows ?? 0).toBe(0);
      // A53 holds on this path too — a refusal names what it was about.
      expect(row.target ?? null).toBe(testCase.target);
    });
  }

  // 🚨 THE COUNTER-PROOF, and the reason `refused` is a declared field rather
  // than something `dispatch.ts` infers. An upsert of somebody who already has
  // that role changes nothing: `created: 0, changed: 0, rows: 0` — the very
  // numbers every refusal above carries. It is an honest `applied`, and a rule
  // that read the numbers would have turned it into a refusal.
  // 🚨 AD-92's chain pointed the OTHER WAY, and it is a different mechanism
  // from the five above — which is why it is not one of the CASES.
  //
  // Those five are DECLARED refusals: the tool returns `SetupResult.refused`
  // and `dispatch.ts` reads the field. This one is a domain error THROWN by
  // `createUser()` and recovered by `domainCodeOf()`, so the scan at the foot
  // of this block would not find it in the source — correctly. Putting it in
  // the table made that scan red, and the scan was right.
  //
  // What it protects: `role` defaults to "member", so an upsert naming the sole
  // owner and simply OMITTING the field demoted them — in production, from an
  // agent reading text somebody else wrote — and the tool reported `changed: 1`
  // about it. Not "make somebody an owner" but "remove the one there is".
  //
  // Asked in `plan` on purpose. The apply refuses either way; what is pinned
  // here is that the FIRST act refuses too, instead of promising a change the
  // second one will not make.
  it("refuses to demote the last owner — in the PLAN, not only the apply", async () => {
    // A different id from the harness's `ownerId` ("owner-1"): the same person
    // would trip `selfDemote` first, and this test is about the other half.
    selected.rows = [{ id: "owner-9", role: "owner" }];
    countOwners.mockResolvedValue(1);
    memberIdForEmail.mockResolvedValue("owner-9");

    const row = await actOn("user_upsert", { email: "der.einzige@example.com" }, "plan");

    expect(row.outcome).toBe("refused");
    expect(row.code).toBe("lastOwnerRole");
    expect(row.rows ?? 0).toBe(0);
    expect(row.target).toBe("der.einzige@example.com");
  });

  it("refuses an owner demoting themselves through this surface", async () => {
    selected.rows = [{ id: "owner-1", role: "owner" }];
    countOwners.mockResolvedValue(2);
    memberIdForEmail.mockResolvedValue("owner-1");

    const row = await actOn("user_upsert", { email: "ich@example.com" }, "plan");

    expect(row.outcome).toBe("refused");
    expect(row.code).toBe("selfDemote");
  });

  it("leaves an honest no-op success as applied", async () => {
    selected.rows = [{ id: "member-42", role: "member" }];
    memberIdForEmail.mockResolvedValue("member-42");

    const row = await actOn("user_upsert", { email: "schon.da@example.com", role: "member" });

    expect(row.outcome).toBe("applied");
    expect(row.code ?? null).toBeNull();
    expect(row.rows).toBe(0);
  });

  // The branch NEXT DOOR to the fifth refusal, in the same tool: the object is
  // already there, nothing is minted, and that is a success. Two results that
  // both mint nothing, and only one of them is a refusal.
  it("leaves content_media_url's found answer as applied", async () => {
    store.head.mockResolvedValue({ bytes: ENTRY.bytes });

    const row = await actOn("content_media_url", { path: ENTRY.path });

    expect(row.outcome).toBe("applied");
    expect(row.code ?? null).toBeNull();
  });

  // `code` REFINES an outcome, `refused` REPLACES it — so the `??` ordering in
  // `dispatch.ts` must not have swallowed the partial publish.
  it("still carries contentPublishPartial on a half-finished apply", async () => {
    publishContent.mockResolvedValue({
      created: 3,
      changed: 0,
      rows: 3,
      appliers: [{ label: "course", ran: true }],
      unreached: ["media"],
      media: null,
      problems: [],
      partial: true,
    });

    const row = await actOn("content_publish", {});

    expect(row.outcome).toBe("applied");
    expect(row.code).toBe("contentPublishPartial");
  });

  // ⚠️ A plan that refused hands back no confirmation. A token is a capability
  // with an hour on it, and minting one for an act the tool has just declined
  // offers a second act that will decline identically.
  it("mints no confirmation for a plan that refused", async () => {
    await actOn("user_upsert", { email: "chef@example.com", role: "owner" }, "plan");
    expect(issueConfirmation).not.toHaveBeenCalled();

    vi.clearAllMocks();
    issueConfirmation.mockResolvedValue("confirmation-token");
    memberIdForEmail.mockResolvedValue(null);
    selected.rows = [];
    await actOn("user_upsert", { email: "kunde@example.com", role: "member" }, "plan");
    expect(issueConfirmation).toHaveBeenCalledTimes(1);
  });

  // ── the discovery half ────────────────────────────────────────────────────
  //
  // 🚨 A list of five read off the code is exactly as complete as the attention
  // of whoever read it — which is how `content_media_url` stayed invisible: it
  // is the one branch that never wrote the word `refused` anywhere. So the set
  // is DISCOVERED from the sources of every tool the app can compose, and the
  // cases above have to cover it.
  //
  // ⚠️ What this can and cannot see, said plainly rather than left to be
  // assumed: it finds a branch that DECLARES `refused`, and it finds the
  // established `data: { refused: … }` idiom used without one. It cannot find a
  // sixth refusal written like `content_media_url`'s original — an ordinary
  // return whose only tell is prose. Nothing short of a parser could, and a
  // scanner that guessed off `created: 0` would call every no-op success above a
  // refusal. `docs/setup-mcp.md` therefore carries the rule in words as well.
  /**
   * The core's tools plus every module's, found on the TREE rather than listed
   * here — so the module that lands next year is covered the day it does instead
   * of being silently skipped. A module's file is read whether or not
   * `config/modules.json` installs it: the tools are in the tree either way, and
   * a scan that only saw the installed set would measure this app rather than
   * the template.
   */
  function toolSources(): string[] {
    const modulesDir = join(process.cwd(), "modules");
    const found = readdirSync(modulesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join("modules", entry.name, "setup", "tools.ts"))
      .filter((relative) => existsSync(join(process.cwd(), relative)));
    // A count guard on the walk itself: this template ships two modules with
    // setup tools, and finding none would mean the directory moved and this
    // scan is reading one file while believing it read the surface.
    expect(found.length, "no module setup tools found — this walk is looking at nothing").toBeGreaterThan(0);
    return ["lib/setup/tools.ts", ...found];
  }

  /** Every `refused: "code"` a tool DECLARES, per file. */
  function declaredRefusals(source: string): string[] {
    // Anchored at the start of a line, which is what keeps a `detail` out of it:
    // those lines begin `detail:` or with the quote of a wrapped string, never
    // with the bare key. Comments are blanked, or this file's own prose about
    // the five would answer for them.
    return [...source.matchAll(/^\s*refused: "([A-Za-z][A-Za-z0-9]*)",$/gm)].map((m) => m[1]);
  }

  it("finds no refusal the cases above do not cover", () => {
    const found: string[] = [];
    let payloadIdioms = 0;

    for (const relative of toolSources()) {
      const source = blankComments(readFileSync(join(process.cwd(), relative), "utf8"));
      found.push(...declaredRefusals(source));

      // The wire signal, and the half that can be checked mechanically: a branch
      // that tells the CALLER it refused must tell the TRAIL as well. Four of
      // the five spell both; the fifth deliberately spells only the trail's.
      for (const match of source.matchAll(/data:\s*\{\s*refused:\s*"([A-Za-z][A-Za-z0-9]*)"/g)) {
        payloadIdioms += 1;
        const before = source.slice(source.lastIndexOf("return {", match.index), match.index);
        expect(
          before,
          `${relative}: a branch answers the caller with data.refused="${match[1]}" and does ` +
            `not declare SetupResult.refused, so the trail records it as a success`,
        ).toMatch(new RegExp(`\\brefused: "${match[1]}"`));
      }
    }

    // Two count guards. Zero found means the scan is looking at nothing — the
    // exact way a green check comes to mean "I did not measure".
    expect(found.length, "no tool declares a refusal — this scan found nothing").toBeGreaterThan(0);
    expect(payloadIdioms, "no tool answers with data.refused — this scan found nothing").toBeGreaterThan(0);

    expect([...new Set(found)].sort()).toEqual([...new Set(CASES.map((c) => c.code))].sort());
  });
});
