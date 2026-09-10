// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 `spendTokensAs()` has exactly ONE caller, and this file is why it can.
//
// `spendTokens()` takes no member id — a caller cannot bill somebody else — and
// a dozen files in this tree cite that shape as the precedent for their own
// session-scoped functions. Finding L-10 (2026-08-18) found the one seam where
// it does not fit: `runChatRequest()` is entered by two doors, one with a
// cookie and one with a bearer key, and deriving the payer from the session
// there meant a request carrying both did the work for one member and charged
// the other.
//
// The finding proposed putting `memberId` on `spendTokens()` itself. That would
// have made the sentence "it takes no member id, ever" false in `CLAUDE.md`, in
// the `build-app` skill's gating examples and in every file citing it — a
// doctrine weakened everywhere to fix one seam. So the seam got its own
// function, and this test is the price of that: the exception stays ONE, and it
// stays the one that was argued for.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

import { blankComments } from "@/scripts/lib/source-text.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SKIP = new Set(["node_modules", ".next", ".git", ".dev", "drizzle"]);

/** The one place allowed to name it, plus where it is defined and tested. */
const ALLOWED = new Set([
  "lib/tokens/spend.ts",
  "lib/ai/chat-endpoint.ts",
  "lib/tokens/spend-callers.test.ts",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("the explicit-payer spend", () => {
  it("is named in one file and nowhere else", () => {
    const files = walk(ROOT);
    // A walk that found nothing is a broken walk, not a clean tree.
    expect(files.length, "the walk found no source files").toBeGreaterThan(200);

    const offenders: string[] = [];
    for (const file of files) {
      const code = blankComments(readFileSync(file, "utf8"));
      if (!/spendTokensAs\s*\(/.test(code)) continue;
      const rel = relative(ROOT, file).split("\\").join("/");
      if (!ALLOWED.has(rel)) offenders.push(rel);
    }

    expect(
      offenders,
      "a second caller of spendTokensAs() appeared. It bills whoever it is told to — " +
        "decide deliberately whether that door really authenticates its own payer, " +
        "and if it does, add it to ALLOWED with the reason.",
    ).toEqual([]);
  });

  it("`spendTokens()` still takes no member id — the sentence twelve files cite", () => {
    const source = blankComments(readFileSync(join(ROOT, "lib/tokens/spend.ts"), "utf8"));
    const start = source.indexOf("export async function spendTokens(args: {");
    expect(start, "spendTokens changed shape").toBeGreaterThan(-1);
    const signature = source.slice(start, source.indexOf("}", start));
    expect(signature).not.toMatch(/memberId/);
  });

  it("the one caller passes a payer its OWN door authenticated", () => {
    const source = blankComments(readFileSync(join(ROOT, "lib/ai/chat-endpoint.ts"), "utf8"));
    // Not `requireActiveUser()` and not a session read — the id and the
    // impersonation flag both arrive as arguments of runChatRequest.
    expect(source).toMatch(/spendTokensAs\(\{\s*memberId,\s*impersonating,/);
    expect(source).not.toMatch(/requireActiveUser\(\)/);
  });

  it("both doors state the impersonation flag rather than defaulting it", () => {
    for (const door of ["app/api/chat/route.ts", "modules/api/routes/chat-messages.ts"]) {
      const code = blankComments(readFileSync(join(ROOT, door), "utf8"));
      expect(code, `${door} does not say what it authenticated`).toMatch(/impersonating:/);
    }
  });
});
