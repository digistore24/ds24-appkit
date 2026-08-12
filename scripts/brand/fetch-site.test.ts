// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Reading somebody's website — driven by an injected `fetch`, so this test
// never touches a network. A test that reached out would be slow, flaky, and a
// second place where this app talks to a host nobody chose.
import { describe, expect, it, vi } from "vitest";

import {
  LIMITS,
  acceptableTarget,
  inlineStyles,
  logoCandidates,
  readSite,
  stylesheetLinks,
  themeColor,
} from "./fetch-site.mjs";

const PAGE = `<!doctype html><html><head>
  <meta name="theme-color" content="#2e5aac">
  <link rel="icon" href="/favicon.svg">
  <link rel="stylesheet" href="/a.css">
  <link rel="stylesheet" href="//cdn.example.com/b.css">
  <link rel="stylesheet" href="https://other.example/c.css">
  <link rel="preload" href="/not-a-sheet.css">
  <meta property="og:image" content="https://example.test/card.png">
  <style>.btn{background:#2e5aac}</style>
</head><body></body></html>`;

describe("acceptableTarget", () => {
  it.each([
    ["file:///etc/passwd", /only http/],
    ["data:text/html,x", /only http/],
    ["not a url", /not a web address/],
    ["http://localhost:3000", /this machine/],
    ["http://127.0.0.1:3000/", /this machine/],
  ])("refuses %s", (url, why) => {
    const verdict = acceptableTarget(url);
    expect(verdict.ok).toBe(false);
    expect(verdict.why).toMatch(why);
  });

  it("accepts a real address", () => {
    expect(acceptableTarget("https://example.test/").ok).toBe(true);
  });
});

describe("reading the page", () => {
  it("finds stylesheets and resolves every href shape", () => {
    const links = stylesheetLinks(PAGE, "https://example.test/x/");
    expect(links).toContain("https://example.test/a.css");
    expect(links).toContain("https://cdn.example.com/b.css");
    expect(links).toContain("https://other.example/c.css");
    expect(links.join(" ")).not.toContain("not-a-sheet");
  });

  it("finds inline styles and the theme colour", () => {
    expect(inlineStyles(PAGE)[0]).toContain("#2e5aac");
    expect(themeColor(PAGE)).toBe("#2e5aac");
  });

  it("finds where the site keeps its mark", () => {
    const logos = logoCandidates(PAGE, "https://example.test/");
    expect(logos).toContain("https://example.test/favicon.svg");
    expect(logos).toContain("https://example.test/card.png");
  });
});

/** A `fetch` that answers from a map, and records what was asked for. */
function stubFetch(routes: Record<string, { body?: string; status?: number; url?: string }>) {
  const asked: string[] = [];
  const impl = vi.fn(async (url: string) => {
    asked.push(url);
    const route = routes[url];
    if (!route) throw new Error("ENOTFOUND");
    return {
      ok: (route.status ?? 200) < 400,
      status: route.status ?? 200,
      url: route.url ?? url,
      body: {
        getReader() {
          let done = false;
          return {
            async read() {
              if (done) return { done: true, value: undefined };
              done = true;
              return { done: false, value: new TextEncoder().encode(route.body ?? "") };
            },
            async cancel() {},
          };
        },
      },
    };
  });
  return { impl: impl as unknown as typeof fetch, asked };
}

describe("readSite", () => {
  it("reads the page and its stylesheets", async () => {
    const { impl, asked } = stubFetch({
      "https://example.test/": { body: PAGE },
      "https://example.test/a.css": { body: ".x{color:#2e5aac}" },
      "https://cdn.example.com/b.css": { body: ".y{color:#f26430}" },
      "https://other.example/c.css": { body: ".z{color:#000}" },
    });
    const site = await readSite("https://example.test/", { fetchImpl: impl });
    expect(site.failed).toBeNull();
    expect(site.css).toContain("#2e5aac");
    expect(site.css).toContain("#f26430");
    expect(site.themeColor).toBe("#2e5aac");
    expect(asked[0]).toBe("https://example.test/");
  });

  it("never fetches more stylesheets than its own limit", async () => {
    const sheets = Array.from({ length: 20 }, (_, i) => `/s${i}.css`);
    const html = `<head>${sheets.map((s) => `<link rel=stylesheet href="${s}">`).join("")}</head>`;
    const routes: Record<string, { body: string }> = { "https://example.test/": { body: html } };
    for (const s of sheets) routes[`https://example.test${s}`] = { body: "a{color:red}" };
    const { impl, asked } = stubFetch(routes);
    await readSite("https://example.test/", { fetchImpl: impl });
    // The page itself plus at most the cap.
    expect(asked).toHaveLength(1 + LIMITS.stylesheets);
  });

  it("says so when the page answers an error, and does not throw", async () => {
    const { impl } = stubFetch({ "https://example.test/": { status: 500, body: "" } });
    const site = await readSite("https://example.test/", { fetchImpl: impl });
    expect(site.failed).toMatch(/nothing could be read/);
    expect(site.notes.join(" ")).toMatch(/500/);
  });

  it("says so when there is no network at all", async () => {
    const impl = (async () => {
      throw Object.assign(new Error("getaddrinfo ENOTFOUND"), { name: "TypeError" });
    }) as unknown as typeof fetch;
    const site = await readSite("https://example.test/", { fetchImpl: impl });
    expect(site.failed).toBeTruthy();
    expect(site.notes.join(" ")).toMatch(/could not be read/);
  });

  it("🚨 reports a redirect to another host", async () => {
    // A parked or sold domain should be visible before its colours are adopted
    // as somebody's brand.
    const { impl } = stubFetch({
      "https://example.test/": { body: "<head></head>", url: "https://parked.example/" },
    });
    const site = await readSite("https://example.test/", { fetchImpl: impl });
    expect(site.notes.join(" ")).toMatch(/redirected to parked\.example/);
  });

  it("🚨 never downloads the logo it found", async () => {
    // Writing somebody else's image into the customer's repository is a licence
    // decision, not a convenience — docs/knowledge.md's Licence Gate stance.
    const { impl, asked } = stubFetch({
      "https://example.test/": { body: PAGE },
      "https://example.test/a.css": { body: "" },
      "https://cdn.example.com/b.css": { body: "" },
      "https://other.example/c.css": { body: "" },
    });
    const site = await readSite("https://example.test/", { fetchImpl: impl });
    expect(site.logoCandidates).toContain("https://example.test/favicon.svg");
    expect(asked).not.toContain("https://example.test/favicon.svg");
    expect(asked).not.toContain("https://example.test/card.png");
  });

  it("refuses a target it may not read without calling fetch at all", async () => {
    const { impl, asked } = stubFetch({});
    const site = await readSite("http://localhost:3000/", { fetchImpl: impl });
    expect(site.failed).toMatch(/this machine/);
    expect(asked).toHaveLength(0);
  });
});
