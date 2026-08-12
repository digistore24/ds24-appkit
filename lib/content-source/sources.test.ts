// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Registry invariants. `lib/ai/tools.test.ts` does this job for the tool
// registry; this file does it for the content sources — every rule here fails
// the build on a registry entry, not on a customer's first call.
import { describe, it, expect } from "vitest";

import { CONTENT_SOURCES, contentSourceById } from "./sources";
import { isLinkableAppPath } from "./link-marker";
import type { ContentHit } from "./types";

const VIEWER = { memberId: null, role: null };

/**
 * The one judgement this file makes about a url, in one place.
 *
 * ⚠️ It used to be `hit.url.startsWith("/")`, and that was wrong in a way that
 * only mattered once something rendered the url: `"//evil.com/x"` starts with
 * a slash and is a PROTOCOL-RELATIVE URL — a valid href that leaves the site.
 * Since the assistant can now put a hit's url in front of a customer as a
 * link, the check is the link grammar itself.
 */
function expectAppRelativeOrNull(url: string | null, where: string) {
  expect(url === null || isLinkableAppPath(url), `${where}: ${url}`).toBe(true);
}

describe("the content-source registry", () => {
  it("has unique ids in the companion-id grammar", () => {
    const ids = CONTENT_SOURCES.map((source) => source.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(id.length).toBeLessThanOrEqual(40);
    }
  });

  it("is frozen — nothing can register a source at runtime", () => {
    expect(Object.isFrozen(CONTENT_SOURCES)).toBe(true);
  });

  it("every source carries a non-empty model-facing label", () => {
    for (const source of CONTENT_SOURCES) {
      expect(source.label.trim().length).toBeGreaterThan(0);
    }
  });

  it("finds a source by id and answers undefined for strangers", () => {
    expect(contentSourceById("handbook")?.id).toBe("handbook");
    expect(contentSourceById("missing")).toBeUndefined();
  });

  // A hit's url is the app's own page or nothing. A signed media URL here
  // would expire under the model's feet and bypass mayAccess() — the delivery
  // layer absolutizes with APP_URL, sources never do. And since Epic 25 the
  // same url can become an href in an answer, so "relative" is not enough:
  // it has to be a path this app could actually route.
  it("no live hit, entry or medium carries anything but a linkable app path or null", async () => {
    for (const source of CONTENT_SOURCES) {
      const hits = await source.search("konto account", VIEWER, 5);
      for (const hit of hits) {
        expectAppRelativeOrNull(hit.url, `${source.id}.search`);
      }

      const entries = (await source.list?.(VIEWER)) ?? [];
      for (const entry of entries) {
        expectAppRelativeOrNull(entry.url, `${source.id}.list`);
      }

      const media = (await source.findMedia?.("video bild", VIEWER, 5)) ?? [];
      for (const hit of media) {
        expectAppRelativeOrNull(hit.url, `${source.id}.findMedia`);
        // A media hit links the PAGE, never the bytes — a signed URL would
        // expire and bypass mayAccess().
        expect(hit.kind).toBe("media");
      }
    }
  });

  // The check above is only worth having if it actually refuses. A registered
  // source is free to compose its own paths, and this is the shape that gets
  // composed by accident — a leading slash concatenated onto something that
  // already had one.
  it("would refuse a source that returned a protocol-relative url", () => {
    const rogue: ContentHit = {
      sourceId: "rogue",
      ref: "x",
      kind: "page",
      title: "Lektion 3",
      snippet: "…",
      url: "//evil.com/x",
      anchor: null,
    };
    expect(() => expectAppRelativeOrNull(rogue.url, "rogue.search")).toThrow();
    expect("//evil.com/x".startsWith("/")).toBe(true); // …which is why that test is gone
  });
});
