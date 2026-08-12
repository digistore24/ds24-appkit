// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Reading the operator's own website, to take the look off it.
//
// 🚨 **This is the only command in the template that fetches a host the CUSTOMER
// chose**, so three things are non-negotiable and all three are visible in the
// output rather than only here:
//
//   · it prints every URL it is about to fetch, before it fetches it;
//   · it says in one sentence what that host learns (that an IP asked for
//     public pages — nothing about this app, its `.env` or its customers);
//   · `--url` is never a default and is never inferred from anything.
//
// `fetch()` and nothing else. `curl` and `wget` are two of the fifteen tools
// `scripts/portability.test.ts` refuses, and for a good reason: neither is
// guaranteed on macOS or in a Git Bash, and their flags differ.
//
// No network is never a crash. A DNS failure, a timeout, a 500 or a page that
// parses to nothing produce one line naming the host and the reason, and the
// run carries on with whatever else it was given — the posture
// `scripts/dev/update-check.mjs` already takes.

import { isLocalhostUrl } from "../ds24/_public-url.mjs";

/** Every limit in one place, so they can be read rather than hunted for. */
export const LIMITS = {
  timeoutMs: 8000,
  bytesPerDocument: 1_000_000,
  bytesTotal: 3_000_000,
  stylesheets: 6,
};

/**
 * Is this an address this command may fetch at all?
 *
 * @returns {{ ok: boolean, why?: string }}
 */
export function acceptableTarget(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, why: `"${raw}" is not a web address` };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, why: `only http and https are read, not ${url.protocol}` };
  }
  if (isLocalhostUrl(url.href)) {
    // Not a security rule — a clarity one. Pointing this at your own dev app
    // extracts THIS template's tokens and calls them your brand.
    return {
      ok: false,
      why: "that is this machine. Reading your own development app would extract the template's own colours and call them your brand",
    };
  }
  return { ok: true };
}

/** Read at most `limit` bytes of a response, then give up on the rest. */
async function readCapped(response, limit) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    chunks.push(value);
    if (total >= limit) {
      await reader.cancel();
      break;
    }
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** `<link rel="stylesheet" href="…">`, resolved against the page. */
export function stylesheetLinks(html, base) {
  const out = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/rel\s*=\s*["']?[^"'>]*stylesheet/i.test(tag)) continue;
    const href = /href\s*=\s*["']([^"']+)["']/i.exec(tag);
    if (!href) continue;
    try {
      out.push(new URL(href[1], base).href);
    } catch {
      /* a href nothing can resolve is a href nothing can fetch */
    }
  }
  return [...new Set(out)];
}

/** The contents of every inline `<style>` block. */
export function inlineStyles(html) {
  return [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]);
}

/** `<meta name="theme-color" content="…">` — the site saying what colour it is. */
export function themeColor(html) {
  const m = /<meta\b[^>]*name\s*=\s*["']theme-color["'][^>]*>/i.exec(html);
  if (!m) return null;
  const content = /content\s*=\s*["']([^"']+)["']/i.exec(m[0]);
  return content ? content[1].trim() : null;
}

/**
 * Where the site keeps its own mark.
 *
 * 🚨 Reported as ADDRESSES and never downloaded. Writing somebody else's image
 * into the customer's repository is a licence decision — the Licence Gate
 * stance in `docs/knowledge.md` — not a convenience this command may take on
 * their behalf. Usually it is their own site and their own logo; sometimes it
 * is not, and the difference is not visible from here.
 */
export function logoCandidates(html, base) {
  const out = [];
  const push = (href) => {
    try {
      out.push(new URL(href, base).href);
    } catch {
      /* ignore */
    }
  };
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    if (!/rel\s*=\s*["']?[^"'>]*icon/i.test(m[0])) continue;
    const href = /href\s*=\s*["']([^"']+)["']/i.exec(m[0]);
    if (href) push(href[1]);
  }
  const og = /<meta\b[^>]*property\s*=\s*["']og:image["'][^>]*>/i.exec(html);
  if (og) {
    const content = /content\s*=\s*["']([^"']+)["']/i.exec(og[0]);
    if (content) push(content[1]);
  }
  return [...new Set(out)];
}

/**
 * Fetch a site and return everything worth ranking.
 *
 * @param {string} target
 * @param {{ fetchImpl?: typeof fetch }} [opts] — injected so the test can drive
 *   a 500, a redirect to another host, an oversized body and a hang without
 *   ever touching a network.
 */
export async function readSite(target, { fetchImpl = fetch } = {}) {
  const verdict = acceptableTarget(target);
  if (!verdict.ok) return { failed: verdict.why, sources: [], css: "", notes: [] };

  const sources = [];
  const notes = [];
  let budget = LIMITS.bytesTotal;

  const get = async (url) => {
    if (budget <= 0) {
      notes.push("stopped reading: the total size budget was used up");
      return null;
    }
    try {
      const response = await fetchImpl(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(LIMITS.timeoutMs),
        headers: { accept: "text/html,text/css,*/*" },
      });
      if (!response.ok) {
        notes.push(`${url} answered ${response.status}`);
        return null;
      }
      const text = await readCapped(response, Math.min(LIMITS.bytesPerDocument, budget));
      budget -= text.length;
      sources.push({ url, bytes: text.length, finalUrl: response.url || url });
      return { text, finalUrl: response.url || url };
    } catch (error) {
      notes.push(`${url} could not be read (${String(error?.name ?? error)})`);
      return null;
    }
  };

  const page = await get(target);
  if (!page) {
    return { failed: `nothing could be read from ${target}`, sources, css: "", notes };
  }

  try {
    if (new URL(page.finalUrl).host !== new URL(target).host) {
      notes.push(`redirected to ${new URL(page.finalUrl).host} — check that is still you`);
    }
  } catch {
    /* ignore */
  }

  const html = page.text;
  const pieces = inlineStyles(html);
  for (const href of stylesheetLinks(html, page.finalUrl).slice(0, LIMITS.stylesheets)) {
    const sheet = await get(href);
    if (sheet) pieces.push(sheet.text);
  }

  return {
    failed: null,
    sources,
    css: pieces.join("\n"),
    themeColor: themeColor(html),
    logoCandidates: logoCandidates(html, page.finalUrl),
    notes,
  };
}
