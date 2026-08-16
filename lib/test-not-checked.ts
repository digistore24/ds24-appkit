// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// How a test says "I did not check this, and here is why".
//
// ── Why this is a file and not a `ctx.skip()` ───────────────────────────────
//
// Some of the shipped tests cannot ask their question in every app. A suite
// that reads `config/digistore-products.json` has nothing to compare against in
// an app whose operator deleted the example products — CLAUDE.md tells them
// to — and a suite that reads the four AI programs' config files has nothing to
// open once `node run.mjs agent-setup --apply` has taken three of them away,
// which is that command's whole documented purpose. The third of that family
// arrived from the field on 2026-08-16: `scripts/ux/rules.test.ts` proves that
// `ux-check` still recognises the SHIPPED placeholder home, and the skill
// `salespage` — step 2.4 of the path in `CLAUDE.md` — replaces that page. One
// red test out of 7 700-odd, in an app whose only fault was doing the
// recommended thing.
//
// 🚨 **The precondition is always read INDEPENDENTLY of the mechanism under
// test.** A test that asks its own subject whether it may skip can be talked
// into skipping by the very defect it exists to catch — which is a silent pass
// wearing a `⏭`. Measured on the third case: with the marker rule broken and the
// page replaced, the four fixture assertions still go red and only the
// shipped-page probe skips.
//
// Both used to turn red, which was wrong: nothing is broken. Turning them
// silently green would be worse — "I could not look" and "there is nothing
// wrong" are different answers, and keeping them apart is the rule this repo is
// built on (NFR-60). So the test is SKIPPED and the reason is printed.
//
// 🚨 **Two channels, because one of them does not arrive.** `ctx.skip(note)`
// makes the run count the test as skipped rather than passed, and a verbose
// reporter shows the note — but **measured**: vitest 4's default reporter, the
// one behind a plain `npx vitest run`, prints console output only for tests
// that FAIL. A `console.warn` from a skipped test reaches nobody, and the
// operator would see nothing but `N passed | M skipped`. `process.stderr.write`
// is not intercepted, and does arrive.

/**
 * The part of vitest's test context this needs.
 *
 * Structural on purpose: nothing under `lib/` may import vitest, and these two
 * members are all that is used. Vitest's own `TestContext` satisfies it.
 */
export interface SkippableTest {
  readonly task: { readonly name: string; readonly file: { readonly name: string } };
  skip(note?: string): void;
}

/** One line per file per reason — six skipped tests are not six paragraphs. */
const announced = new Set<string>();

/**
 * Skip this test, and say on stderr what was not checked and why.
 *
 * `ctx.skip()` throws, so nothing after the call runs — write it as
 * `return notChecked(ctx, "…")` where the compiler needs convincing.
 */
export function notChecked(ctx: SkippableTest, reason: string): void {
  const file = ctx.task.file.name;
  const once = `${file} ${reason}`;
  if (!announced.has(once)) {
    announced.add(once);
    process.stderr.write(`⏭ ${file}: NOT CHECKED — ${reason}\n`);
  }
  ctx.skip(reason);
}

/** For this mechanism's own test: forget what has already been printed. */
export function resetNotCheckedLog(): void {
  announced.clear();
}
