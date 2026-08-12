// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// **The guard order `EmbeddedDiscussion` promises in its own header, pinned.**
//
// Nothing before this file called the component itself — `embed-refusal.test.ts`
// and `embeds.test.ts` cover the decision layer underneath it, and the Dev
// Agent Record for Story 20.1 says the component's own render was checked by
// mounting it on `/dashboard` by hand and reverting the change afterwards. A
// Server Component is a plain async function, so it needs no renderer: this
// calls it directly and reads the React element it returns (or doesn't).
//
// ⚠️ **What this file can and cannot prove, said once so no test here has to
// claim more than it does.** The access decision is MOCKED — so the identity of
// the two refusals (unknown subject / not entitled) cannot be proved here at
// all, and a test that mocked both to `null` and then compared them would be
// comparing its own fixture. That proof lives one layer down, against the real
// function, in `modules/community/pages/embed-refusal.test.ts`. What is worth
// pinning HERE is everything the component adds on top of that answer: the
// order of its four refusals, that it asks with the SESSION's viewer rather
// than anything a caller handed it, that a refused view renders nothing at all
// (not even the heading), and that the Subject Key travels as a scope and never
// as text somebody can read.
import { beforeEach, describe, expect, it, vi } from "vitest";

// The page size the component divides by, declared once and handed to the
// mocked module — so a test that reasons about page counts and the value it
// reasons with cannot drift apart. Deliberately NOT imported from
// `modules/community/lib/manage.ts`: that module opens the database client, which a
// component test has no business starting. `vi.hoisted` because `vi.mock` is
// lifted above every `const` in the file.
const { PER_PAGE } = vi.hoisted(() => ({ PER_PAGE: 50 }));

vi.mock("@/modules/community/lib/config", () => ({
  isCommunityEnabled: vi.fn(() => true),
  livePollSchedule: vi.fn(() => ({ visibleMs: 5000, hiddenMs: 30000 })),
}));

vi.mock("@/lib/authz", () => ({
  currentActiveUser: vi.fn(async () => ({ state: "anonymous" })),
}));

vi.mock("@/modules/community/lib/manage", () => ({
  POSTS_PER_PAGE: PER_PAGE,
  embeddedDiscussionView: vi.fn(),
  profileFor: vi.fn(async () => null),
  // The composer's picture policy (Story 26.2). A stub with a REAL-looking `max`
  // rather than zero: an embed is a place to write like any other, and pinning it
  // at zero here would make this file agree with a version that had quietly
  // stopped offering pictures in embeds.
  postImagePolicy: vi.fn(() => ({ max: 3, ceilingBytes: 10_485_760, maxLabel: "10 MB" })),
}));

vi.mock("@/modules/community/lib/rules", () => ({
  canParticipate: vi.fn(() => null),
  cursorToken: vi.fn(() => "cursor-1"),
  // ⚠️ **A DIFFERENT value from `cursorToken()`'s, deliberately.** The whole
  // point of `liveCursorBeginning()` is that "I rendered nothing" is its own
  // position and not the same as "here is where the render stood" — a stub
  // returning one string for both would make the test below unable to fail.
  liveCursorBeginning: vi.fn(() => "cursor-beginning"),
}));

vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(
    async (namespace: string) => (key: string, values?: unknown) =>
      `${namespace}.${key}(${JSON.stringify(values ?? null)})`,
  ),
  // The reader's locale, for the picture policy's already-formatted byte ceiling
  // (`postImagePolicy()`). The component asks for it and hands it straight on; it
  // decides nothing here.
  getLocale: vi.fn(async () => "de"),
}));

// A stand-in for the live channel — its own behaviour is Story 20.2's, not
// this file's. What matters here is only whether it gets mounted at all.
vi.mock("./live-discussion", () => ({
  LiveDiscussion: vi.fn(() => null),
}));

import { EmbeddedDiscussion } from "./embedded-discussion";
import { isCommunityEnabled } from "@/modules/community/lib/config";
import { currentActiveUser } from "@/lib/authz";
import { embeddedDiscussionView } from "@/modules/community/lib/manage";
import { LiveDiscussion } from "./live-discussion";
import { Pager } from "./pager";

const ACTIVE = {
  state: "active" as const,
  session: {
    user: { id: "member-1", role: "member", name: "A Member" },
    expires: "2099-01-01T00:00:00.000Z",
  },
};

const VIEW = {
  discussionId: "d1",
  locked: false,
  rows: [],
  total: 0,
  page: 1,
};

/** A post row as `postsFor()` hands one over, reduced to what this file reads. */
function post(id: string) {
  return {
    id,
    discussionId: "d1",
    authorId: "member-1",
    content: "hello",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    editedAt: null,
    deletedAt: null,
    deletedBy: null,
    removedAt: null,
    removedBy: null,
    removedReason: null,
    authorProfileName: "A Member",
    authorAccountName: "A Member",
    // Post images (Story 26.2). The empty list is this fixture's whole interest
    // in them — what the embed has to keep doing is hand `LiveDiscussion` the
    // same shape the live endpoint's `wirePost()` sends, and a post with no
    // pictures is the case every assertion below is about.
    images: [],
  };
}

type El = { type: unknown; props: Record<string, unknown> };

function isElement(node: unknown): node is El {
  return typeof node === "object" && node !== null && "type" in node;
}

/**
 * There is no renderer in this project (`vitest.config.ts` runs Server
 * Components as plain functions, never through `react-dom`) — so what a
 * component "renders" is inspected by walking the element tree its call
 * returns, the same tree a renderer would otherwise walk for us.
 *
 * ⚠️ **It descends every prop, not only `children`.** A first version of this
 * walker followed `props.children` alone, which made whole branches invisible
 * to it: `<EmptyState icon title description>` carries its entire content in
 * props, so an assertion about the empty state could never fail no matter what
 * the component did.
 */
function findElement(node: unknown, predicate: (el: El) => boolean): El | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, predicate);
      if (found) return found;
    }
    return null;
  }
  if (!isElement(node)) return null;
  if (predicate(node)) return node;
  for (const value of Object.values(node.props ?? {})) {
    const found = findElement(value, predicate);
    if (found) return found;
  }
  return null;
}

/**
 * Every string a reader would SEE, and deliberately not every string in the
 * tree. Text reaches a person two ways — as a child, and through the props that
 * are text by contract — so those are the two this collects. A Subject Key
 * handed to `LiveDiscussion` as `scope` is not visible text and must not count
 * as one; that is the whole distinction this function exists to draw.
 */
const TEXT_PROPS = ["title", "description", "label", "aria-label", "alt", "placeholder"];

function visibleText(node: unknown, into: string[] = []): string[] {
  if (typeof node === "string") {
    into.push(node);
    return into;
  }
  if (Array.isArray(node)) {
    for (const child of node) visibleText(child, into);
    return into;
  }
  if (!isElement(node)) return into;
  const props = node.props ?? {};
  visibleText(props.children, into);
  for (const name of TEXT_PROPS) visibleText(props[name], into);
  return into;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isCommunityEnabled).mockReturnValue(true);
  vi.mocked(currentActiveUser).mockResolvedValue(ACTIVE);
  vi.mocked(embeddedDiscussionView).mockResolvedValue(VIEW);
});

describe("the four things it refuses, in order", () => {
  it("renders nothing at all when the community is off", async () => {
    vi.mocked(isCommunityEnabled).mockReturnValue(false);
    const result = await EmbeddedDiscussion({ subjectKey: "course:x:unit-1" });
    expect(result).toBeNull();
    // Not merely null — nothing downstream was even asked.
    expect(embeddedDiscussionView).not.toHaveBeenCalled();
  });

  it("renders nothing when nobody is signed in", async () => {
    vi.mocked(currentActiveUser).mockResolvedValue({ state: "anonymous" });
    const result = await EmbeddedDiscussion({ subjectKey: "course:x:unit-1" });
    expect(result).toBeNull();
    expect(embeddedDiscussionView).not.toHaveBeenCalled();
  });

  it("renders nothing when the account is blocked", async () => {
    vi.mocked(currentActiveUser).mockResolvedValue({ state: "blocked" });
    const result = await EmbeddedDiscussion({ subjectKey: "course:x:unit-1" });
    expect(result).toBeNull();
    expect(embeddedDiscussionView).not.toHaveBeenCalled();
  });

  it("renders nothing when the view refuses — not even the heading it was given", async () => {
    // The identity of the two refusals is `embed-refusal.test.ts`'s (see the
    // file header). What this pins is that the component adds no branch of its
    // own on top of a refusal: given a heading, a description and a key, a
    // `null` view still produces a `null` render. A component that drew its
    // heading before consulting the view would tell an unentitled member that
    // the page has a discussion on it at all, which is the disclosure the whole
    // merge exists to prevent.
    vi.mocked(embeddedDiscussionView).mockResolvedValue(null);
    const result = await EmbeddedDiscussion({
      subjectKey: "course:invented:unit-9",
      heading: "Unit 9",
      description: "Talk about it",
    });
    expect(result).toBeNull();
  });

  it("renders when declared and entitled", async () => {
    const result = await EmbeddedDiscussion({
      subjectKey: "course:x:unit-1",
      heading: "Unit 1",
    });
    expect(result).not.toBeNull();
    expect(findElement(result, (el) => el.type === LiveDiscussion)).not.toBeNull();
  });
});

describe("who it asks on whose behalf", () => {
  it("asks with the SESSION's viewer, never with anything a caller handed in", async () => {
    // ⚠️ The IDOR-shaped line in this component: `viewer` is built from
    // `currentActiveUser()` inside the function body, and the props carry no
    // member id, no role and no access level — "a gate the browser sends is no
    // gate". A component that widened this to `role: "owner"`, or accepted a
    // level as a prop, would pass every other test in this file.
    await EmbeddedDiscussion({ subjectKey: "course:x:unit-1", heading: "Unit 1" });

    expect(embeddedDiscussionView).toHaveBeenCalledTimes(1);
    expect(embeddedDiscussionView).toHaveBeenCalledWith(
      "course:x:unit-1",
      { memberId: "member-1", role: "member" },
      "last",
    );
  });

  it("passes the page a host page asked for, unchanged", async () => {
    await EmbeddedDiscussion({ subjectKey: "course:x:unit-1", page: 2 });
    expect(embeddedDiscussionView).toHaveBeenCalledWith(
      "course:x:unit-1",
      expect.anything(),
      2,
    );
  });
});

describe("the heading", () => {
  it("comes from the prop, never from the Subject Key", async () => {
    const result = await EmbeddedDiscussion({
      subjectKey: "course:birth-prep:unit-3",
      heading: "Week three",
    });
    const live = findElement(result, (el) => el.type === LiveDiscussion);
    // The component takes a Subject Key and hands it to the live channel as
    // a SCOPE, never as visible text.
    expect(live?.props.scope).toEqual({
      kind: "subject",
      subjectKey: "course:birth-prep:unit-3",
    });

    const h2 = findElement(result, (el) => el.type === "h2");
    expect(h2?.props.children).toBe("Week three");

    // And the stronger half of the same rule: nothing a reader can SEE carries
    // the slug — not a heading, not an empty state, not a label. A scope is
    // not text, which is why `visibleText` walks children and the text props
    // rather than the whole tree.
    expect(visibleText(result).join("\n")).not.toContain("birth-prep");
  });
});

describe("the cursor this render hands the live channel", () => {
  // ⚠️ **The swallowed first post, pinned at the place it was swallowed.** An
  // empty embed used to hand the channel no cursor at all; the endpoint reads a
  // missing cursor as one it cannot parse and takes the resynchronise branch —
  // answering `posts: []` together with a cursor pointing PAST whatever had
  // arrived meanwhile. So the first post ever written into a declared embed
  // never reached a page that was already open, and every post after it did.
  // Which is the state EVERY embed is in on the day somebody declares it, so
  // this is the case the feature is met in, not an edge of it.
  it("says 'before everything' for a view that rendered nothing", async () => {
    // `VIEW` is the empty view — no rows, which is where an embed starts.
    const result = await EmbeddedDiscussion({ subjectKey: "course:x:unit-1" });
    const live = findElement(result, (el) => el.type === LiveDiscussion);

    expect(live?.props.initialCursor).toBe("cursor-beginning");
    // Said twice on purpose: `null` is the defect, and it is the value a
    // reasonable-looking "there is nothing to point at" would produce.
    expect(live?.props.initialCursor).not.toBeNull();
  });

  it("says where the render stood once there IS a row", async () => {
    vi.mocked(embeddedDiscussionView).mockResolvedValue({
      ...VIEW,
      rows: [post("p1")],
      total: 1,
    });
    const result = await EmbeddedDiscussion({ subjectKey: "course:x:unit-1" });
    const live = findElement(result, (el) => el.type === LiveDiscussion);

    expect(live?.props.initialCursor).toBe("cursor-1");
  });
});

describe("the pager", () => {
  const paged = (page: number, total: number) => ({
    ...VIEW,
    rows: [post("p1")],
    total,
    page,
  });

  it("is not rendered at all when a host page supplied no href builder", async () => {
    vi.mocked(embeddedDiscussionView).mockResolvedValue(paged(1, PER_PAGE * 3));
    const result = await EmbeddedDiscussion({ subjectKey: "course:x:unit-1" });
    expect(findElement(result, (el) => el.type === Pager)).toBeNull();
  });

  it("hands the pager the page it is on and how many there are", async () => {
    vi.mocked(embeddedDiscussionView).mockResolvedValue(paged(2, PER_PAGE * 3));
    const result = await EmbeddedDiscussion({
      subjectKey: "course:x:unit-1",
      pageHref: (p) => `?page=${p}`,
    });
    const pager = findElement(result, (el) => el.type === Pager);
    expect(pager?.props.page).toBe(2);
    expect(pager?.props.pages).toBe(3);
  });

  it("is absent on a single-page discussion", async () => {
    vi.mocked(embeddedDiscussionView).mockResolvedValue(paged(1, 3));
    const result = await EmbeddedDiscussion({
      subjectKey: "course:x:unit-1",
      pageHref: (p) => `?page=${p}`,
    });
    expect(findElement(result, (el) => el.type === Pager)).toBeNull();
  });
});
