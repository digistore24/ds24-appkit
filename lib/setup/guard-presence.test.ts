// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 Every handler under `app/api/setup/` opens with `guardSetup()`.
//
// This reads the handlers rather than trusting a list, and that is the whole
// point: `proxy.ts` matches `/dashboard` only, so everything under `app/api/`
// is public until it protects itself. The equivalent test for `/api/v1`
// (`modules/api/routes/guard-presence.test.ts`) exists because that footgun is
// structural rather than a review item — a new handler is exactly the moment
// somebody forgets, and a reviewer reading a diff sees a plausible-looking
// function.
//
// A new file under app/api/setup/ is picked up by itself. Nobody has to
// remember to add it here, which is the property a list does not have.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "@/scripts/lib/source-text.mjs";

const ROOT = join(process.cwd(), "app/api/setup");

/**
 * Handlers that legitimately do not guard, each with the reason.
 *
 * The bar is the one the API module's token endpoint had to clear: it is not
 * "this one is fine", it is "this one cannot reach a tool, a key or a row".
 */
const EXEMPT: Record<string, string> = {
  "route.ts:GET":
    "answers 'use POST' and nothing else — it reaches no tool, no key and no row, so guarding it would only make the surface's shape observable to an unauthenticated caller",
};

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...filesUnder(full));
    else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

/** `export async function POST(` … up to the next top-level `}`. */
function handlersIn(source: string): { method: string; body: string }[] {
  const out: { method: string; body: string }[] = [];
  const pattern = /export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\s*\(/g;
  for (const match of source.matchAll(pattern)) {
    const start = match.index ?? 0;
    const next = source.slice(start + match[0].length).search(/\nexport\s/);
    const body = next === -1 ? source.slice(start) : source.slice(start, start + match[0].length + next);
    out.push({ method: match[1], body });
  }
  return out;
}

describe("every setup handler goes through the one door", () => {
  const files = filesUnder(ROOT);

  it("finds handlers at all — an empty sweep is not a pass", () => {
    // The needle probe. A walk that silently found nothing would report green
    // for ever, which is the failure mode of every structural test that reads
    // a tree.
    expect(files.length).toBeGreaterThan(0);
    const total = files.reduce((n, file) => n + handlersIn(readFileSync(file, "utf8")).length, 0);
    expect(total).toBeGreaterThan(0);
  });

  for (const file of files) {
    // Comments are blanked FIRST — a checker that greps source punishes the
    // file that documents the rule. `scripts/lib/source-text.mjs` is the one
    // implementation of that, and writing a seventeenth regex here is refused.
    const source = blankComments(readFileSync(file, "utf8"));
    const relative = file.slice(file.indexOf("app/api/setup"));

    for (const handler of handlersIn(source)) {
      const key = `${relative.split("/").pop()}:${handler.method}`;

      it(`${relative} ${handler.method}() calls guardSetup()`, () => {
        if (EXEMPT[key]) {
          expect(EXEMPT[key].length).toBeGreaterThan(40);
          return;
        }
        // Either the guard itself, or the ONE shared runner whose first act is
        // the guard — and the chain from that runner to `guardSetup()` is
        // proven below rather than taken on the strength of a name. Both doors
        // (JSON and multipart) go through the runner so they cannot drift into
        // two implementations of the same sequence.
        expect(
          handler.body.includes("guardSetup(") || handler.body.includes("runSetupCall("),
          `${relative} ${handler.method}() reaches neither guardSetup() nor runSetupCall(). ` +
            `Either call one of them, or add it to EXEMPT with the sentence saying what ` +
            `protects it instead — a route under app/api/ is public until it guards itself.`,
        ).toBe(true);
      });
    }
  }
});

describe("the shared runner is the guard, and not merely named like it", () => {
  // 🚨 Without this, the test above degrades into a spell-check. A handler
  // could call `runSetupCall()` for ever while somebody quietly took the guard
  // out of it, and every assertion would stay green.
  const dispatch = blankComments(readFileSync(join(process.cwd(), "lib/setup/dispatch.ts"), "utf8"));

  it("calls guardSetup()", () => {
    expect(dispatch).toContain("guardSetup(");
  });

  it("refuses before it runs anything", () => {
    // The refusal branch has to come before the tool is invoked. Compared by
    // position rather than by reading the logic: a `tool.run(` that moved above
    // the `if (!guard.ok)` would be exactly the regression this catches.
    const refusal = dispatch.indexOf("if (!guard.ok)");
    const invocation = dispatch.indexOf("tool.run(");
    expect(refusal).toBeGreaterThan(-1);
    expect(invocation).toBeGreaterThan(refusal);
  });

  it("records the act", () => {
    // The audit row is not optional decoration — it is what pays for a surface
    // that takes ids. A runner that stopped writing it would leave both doors
    // silent at once.
    expect(dispatch).toContain("recordAct(");
  });
});

describe("the endpoint does not reach around its own guard", () => {
  it("never touches the key or confirmation tables directly", () => {
    for (const file of filesUnder(ROOT)) {
      const source = blankComments(readFileSync(file, "utf8"));
      // Authenticating and spending belong to lib/setup/manage.ts, called by
      // the guard. A route that queried those tables itself would be a second
      // implementation of the check, and the two would drift.
      expect(source).not.toMatch(/\bsetupKeys\b/);
      expect(source).not.toMatch(/\bsetupConfirmations\b/);
    }
  });
});

describe("a switched-off surface gives nothing away", () => {
  // 🚨 Found by probing the running app with the switch off.
  //
  // Both doors used to PARSE before they checked the switch, so a stranger got
  // `400 "Body must be JSON."` from one and
  // `400 "Attach the file as the form field file."` from the other. Either one
  // says out loud that this app has a setup surface — which is exactly what the
  // 404 exists not to say. A route that was never built does not have opinions
  // about your Content-Type.
  //
  // Position, not presence: the check has to come BEFORE the first read of the
  // body, and "it is in the file somewhere" is what this would degrade into.
  const doors = ["app/api/setup/route.ts", "app/api/setup/media/route.ts"];

  for (const door of doors) {
    it(`${door} checks the switch before it reads the body`, () => {
      const source = blankComments(readFileSync(join(process.cwd(), door), "utf8"));
      const check = source.indexOf("surfaceOffResponse(");
      expect(check, `${door} never calls surfaceOffResponse()`).toBeGreaterThan(-1);

      for (const read of ["request.json(", "request.formData("]) {
        const at = source.indexOf(read);
        if (at === -1) continue;
        expect(
          at,
          `${door} reads the body at ${read} before checking the switch — that answer ` +
            `tells a stranger the route exists`,
        ).toBeGreaterThan(check);
      }
    });
  }
});
