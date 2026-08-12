// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// One claim that no behavioural test can make, because it is about the line
// somebody adds NEXT: **nothing on the operator-mail path reads a request.**
//
// `operators.test.ts` proves it for the code that exists — it mocks
// `next/headers` to throw and drives the whole channel through it. What it
// cannot prove is that the sixth function added to `lib/notify/` next spring
// keeps the property. The failure mode is quiet in the worst way: through
// `POST /api/cron` there IS a request, just one with no language cookie, so a
// relapse does not throw at all. It renders every operator mail in
// DEFAULT_LOCALE and nobody finds out.
//
// 🚨 **Through `blankComments()`, never a regex of its own.** A checker that
// greps source punishes a file for explaining itself, and this rule is
// explained a lot: `i18n/translator.ts` cannot say why it avoids
// `getTranslations` without writing the word down. `scripts/lib/source-text.mjs`
// carries the measured post-mortem (a `//` comment containing `/*` opening a
// phantom block that swallowed eighteen lines).
//
// Built from `modules/courses/admin/guard.test.ts` — the non-vacuity claim, the
// planted needle and the comment probe are that file's, and they are the three
// things that keep a scanner from being green because it looked at nothing.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";

import { blankComments } from "@/scripts/lib/source-text.mjs";

const ROOT = process.cwd();

/**
 * The forbidden names, each built from halves.
 *
 * Spelled in one piece this file would match itself — and it is in
 * `lib/notify/`, so it would be in its own scan. Same trick, same reason, as
 * `modules/community/lib/render-safety.test.ts`.
 */
const FORBIDDEN: { needle: string; why: string }[] = [
  {
    needle: "next-intl" + "/server",
    why: "every export of it resolves the locale through i18n/request.ts, which reads the cookie jar",
  },
  { needle: "next" + "/headers", why: "there is no request here to read one from" },
  {
    needle: "getTrans" + "lations(",
    why: "even with an explicit { locale } it lands in our getRequestConfig handler — see i18n/translator.ts",
  },
  { needle: "getLoc" + "ale(", why: "the locale is a parameter on this path, never a lookup" },
  { needle: "cook" + "ies(", why: "a scheduled job has no cookies; outside a request this throws" },
  { needle: "head" + "ers(", why: "same — and through POST /api/cron it does not even throw" },
];

interface Scanned {
  label: string;
  /** Comments blanked, so a file may explain the rule it keeps. */
  source: string;
}

/**
 * Every `lib/notify/` file that is not a test — at any depth.
 *
 * AC 3 says `lib/notify/**`, and a flat `readdirSync` says `lib/notify/*`. The
 * difference is invisible today (there are no subdirectories) and would stay
 * invisible on the day somebody adds `lib/notify/senders/`: the non-vacuity
 * probe below counts files and would go on finding seven.
 */
function notifyFiles(dir = join(ROOT, "lib", "notify"), prefix = "lib/notify"): Scanned[] {
  const found: Scanned[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      found.push(...notifyFiles(full, `${prefix}/${name}`));
    } else if (/\.(ts|tsx|mjs)$/.test(name) && !name.includes(".test.")) {
      found.push({
        label: `${prefix}/${name}`.split(sep).join("/"),
        source: blankComments(readFileSync(full, "utf8")),
      });
    }
  }
  return found;
}

/**
 * One named function out of `lib/email.ts`, from its declaration to the
 * top-level `}` that closes it.
 *
 * 🚨 **The section boundary below is not enough, and that was measured.** The
 * scan used to be "the `// --- Operator mail` section and nothing else", which
 * left `mailFooter()` and `legalFooterLinks()` — the two functions this channel
 * MOVED off `getTranslations`, and the two every operator mail runs through —
 * outside it, because they sit hundreds of lines further up among the
 * request-bound member mails. The one place in this file the property was newly
 * won was the one place the guard did not look.
 *
 * They cannot be covered by widening the section: the rest of `lib/email.ts` is
 * request-bound by design and should stay that way. So they are named.
 */
function emailFunction(name: string): Scanned {
  const raw = readFileSync(join(ROOT, "lib", "email.ts"), "utf8").split("\n");
  // Same split-on-raw / slice-the-blanked trick as `operatorSection()` below:
  // `blankComments()` blanks, never strips, so the line counts agree.
  const blanked = blankComments(raw.join("\n")).split("\n");
  const start = raw.findIndex((line) => new RegExp(`^(export )?(async )?function ${name}\\(`).test(line));
  expect(start, `lib/email.ts has no function ${name}() any more`).toBeGreaterThan(0);
  const close = raw.findIndex((line, i) => i > start && line === "}");
  expect(close, `function ${name}() in lib/email.ts has no top-level close`).toBeGreaterThan(start);
  return {
    label: `lib/email.ts → ${name}()`,
    source: blanked.slice(start, close + 1).join("\n"),
  };
}

/**
 * The operator-mail section of `lib/email.ts`, and only that.
 *
 * The rest of the file is request-bound by design — the three mails to a MEMBER
 * are composed inside the request that triggered them, and that is correct. So
 * the boundary is the file's own `// --- …` section headings, which is why the
 * Auth.js provider below it got one when this section arrived.
 */
function operatorSection(): Scanned {
  const source = blankComments(readFileSync(join(ROOT, "lib", "email.ts"), "utf8"));
  const lines = source.split("\n");
  // The headings survive `blankComments()` as blank lines, so the split is done
  // on the RAW file and applied to the blanked one — same line count, by
  // construction (that function blanks, never strips).
  const raw = readFileSync(join(ROOT, "lib", "email.ts"), "utf8").split("\n");
  const start = raw.findIndex((line) => line.startsWith("// --- Operator mail"));
  expect(start, "lib/email.ts has no `// --- Operator mail` section any more").toBeGreaterThan(0);
  const after = raw.findIndex((line, i) => i > start && line.startsWith("// --- "));
  const end = after === -1 ? raw.length : after;
  return { label: "lib/email.ts → the operator-mail section", source: lines.slice(start, end).join("\n") };
}

const SCANNED: Scanned[] = [
  ...notifyFiles(),
  operatorSection(),
  // The three functions on the operator mail's path that live OUTSIDE that
  // section — the shared footer. See `emailFunction()` for why they are named
  // one by one rather than covered by a wider slice.
  emailFunction("mailFooter"),
  emailFunction("legalFooterLinks"),
  emailFunction("imprintFor"),
  // The two files the channel gets its texts from. They are the ones that
  // WOULD reach for the request-bound API, because it is the documented one.
  {
    label: "i18n/translator.ts",
    source: blankComments(readFileSync(join(ROOT, "i18n", "translator.ts"), "utf8")),
  },
  {
    label: "i18n/catalogue.ts",
    source: blankComments(readFileSync(join(ROOT, "i18n", "catalogue.ts"), "utf8")),
  },
];

describe("the operator-mail path never reads a request", () => {
  it("finds the files at all", () => {
    // The needle that keeps every claim below from being vacuous. A scan that
    // matched nothing would report the rule as kept — "green because it
    // checked" and "green because it found nothing" are the same colour.
    const labels = SCANNED.map((file) => file.label);
    expect(labels).toContain("lib/notify/operators.ts");
    expect(labels).toContain("lib/notify/config.ts");
    expect(labels).toContain("lib/notify/owners.ts");
    expect(labels).toContain("lib/notify/sent-once.ts");
    expect(labels).toContain("lib/email.ts → the operator-mail section");
    expect(labels).toContain("i18n/translator.ts");
    // The shared footer, by name. Every operator mail runs through all three,
    // and none of them is inside the section above.
    expect(labels).toContain("lib/email.ts → mailFooter()");
    expect(labels).toContain("lib/email.ts → legalFooterLinks()");
    expect(labels).toContain("lib/email.ts → imprintFor()");
    expect(SCANNED.length).toBeGreaterThanOrEqual(10);
    for (const file of SCANNED) {
      expect(file.source.trim(), `${file.label} scanned as empty`).not.toBe("");
    }
  });

  it("🚨 names none of the request-bound APIs", () => {
    for (const { label, source } of SCANNED) {
      for (const { needle, why } of FORBIDDEN) {
        expect(
          source,
          `${label} names \`${needle}\` in CODE. ${why}. The locale travels as a ` +
            `parameter on this path — translatorFor()/formatterFor() in i18n/translator.ts.`,
        ).not.toContain(needle);
      }
    }
  });

  it("🚨 the scan finds a planted fault", () => {
    // The needle probe. Without it, a scan that had stopped matching anything
    // would report the claim above as satisfied for ever.
    const planted = blankComments(
      "export async function bad(to: string) {\n" +
        '  const { getTranslations } = await import("next-intl/server");\n' +
        '  const t = await getTranslations("email");\n' +
        "  return t;\n}\n",
    );
    const hit = FORBIDDEN.filter(({ needle }) => planted.includes(needle));
    expect(hit.map(({ needle }) => needle).sort()).toEqual(
      ["getTrans" + "lations(", "next-intl" + "/server"].sort(),
    );
  });

  it("🚨 a comment can neither satisfy nor break the claim", () => {
    // What `blankComments()` is for, stated as a measurement. `translator.ts`'s
    // header MUST be able to say the word it is arguing against.
    const explained = blankComments(
      "// Deliberately not getTranslations({ locale }) — it reads cookies().\n" +
        "/* and not next-intl/server either, for the same reason */\n" +
        "export const fine = 1;\n",
    );
    for (const { needle } of FORBIDDEN) {
      expect(explained, `a comment tripped the scan on \`${needle}\``).not.toContain(needle);
    }
    // And the line count survived, so a reported line number still points at
    // the right line.
    expect(explained.split("\n")).toHaveLength(4);
  });
});
