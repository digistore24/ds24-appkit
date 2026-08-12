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

import { beforeEach, describe, expect, it, vi } from "vitest";

const { recordAct, guardSetup, loadManifest, store, revokeGrantByHand, publishContent } =
  vi.hoisted(() => ({
    recordAct: vi.fn(async () => undefined),
    guardSetup: vi.fn(),
    loadManifest: vi.fn(),
    store: { head: vi.fn(), firstBytes: vi.fn(), remove: vi.fn(), createUploadUrl: vi.fn() },
    revokeGrantByHand: vi.fn(),
    publishContent: vi.fn(),
  }));

// The trail's writer, captured rather than mocked away: what is asserted here is
// the ARGUMENT, which is the whole subject of this file.
vi.mock("./manage", () => ({ recordAct, issueConfirmation: vi.fn(), touchKey: vi.fn() }));
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
vi.mock("@/lib/entitlements/manage", () => ({ grantByHand: vi.fn(), revokeGrantByHand }));
vi.mock("@/lib/content/publish", async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  publishContent,
  assertContentMediaRow: vi.fn(async () => ({ created: true, key: "content/x" })),
}));

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
  requiresPlan: "kurs_komplett",
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
  loadManifest.mockReturnValue({ entries: [ENTRY], problems: [] });
  store.head.mockResolvedValue(null);
  store.firstBytes.mockResolvedValue(MP4_HEAD);
  store.remove.mockResolvedValue(undefined);
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
