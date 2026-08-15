// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The secret scanner's needle probes — the half that decides whether it measures
// anything at all.
//
// 🚨 **The one thing this rung can get wrong in a way nobody notices is shipping
// rules that cannot match anything real, and reading green as clean.** So every
// rule is measured twice here: against a planted secret that MUST be found, with
// its line number, and against this template's own shipped files, which MUST
// stay silent. `scripts/lib/source-text.test.ts:188` records what the missing
// half costs — *"a guard whose probe cannot fire is worse than no guard: it
// reports success"* — and it is not hypothetical: sixteen copies of a comment
// blanker were removed while the guard meant to keep them gone could not see one.
//
// ⚠️ **No process is spawned and no network is reached.** `vitest.config.ts:15`
// is `include: ["**/*.test.ts"]`, so this file is inside `make check` by
// construction — and `node run.mjs security-check` must never become a gate
// (CLAUDE.md; check.mjs's own header). Reading three shipped files off disk is
// allowed and is exactly what cases 2 and 3 are for; asking git is the RUNG's
// job and is proven by running the command.
//
// ── Why every fixture is assembled rather than written out ─────────────────
//
// This file is git-tracked, so the rung scans it. A `sk-ant-…` written out as a
// literal here would make the shipped template report itself — which is the one
// property this whole rule set is calibrated to protect. Every planted value is
// therefore built by concatenation, so no complete match exists in the file's own
// text, and the last block below PROVES that by scanning this file from disk.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  ALLOWLIST,
  DEVELOPER_KEY_PATHS,
  DEVELOPER_KEY_VALUE,
  SECRET_RULES,
  countSecrets,
  isSourceFile,
  scanText,
} from "./patterns.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (file: string) => readFileSync(join(ROOT, file), "utf8");

// ── the planted needles ─────────────────────────────────────────────────────
//
// Assembled, never written out — see the header. `AT` exists for the same
// reason: a literal `@` on the DSN line would let the pattern span the
// concatenation and match this file's own source.
const AT = "@";
const APP_KEY = `ds24api_${"A".repeat(43)}`;
const SETUP_KEY = `ds24setup_${"B".repeat(43)}`;
const VENDOR_KEY = `sk-ant-${"api03-"}${"C".repeat(90)}`;
const PEM_HEADER = `-----BEGIN RSA ${"PRIVATE KEY-----"}`;
const REMOTE_DSN = `postgres://app:${"s3cr3t-pw-here".slice(0, 14)}${AT}db.internal.acme-corp.net:5432/app`;

describe("🚨 a planted secret is found, with its line number", () => {
  // The probe before the probes: if the needles are not the shapes they claim to
  // be, every assertion below passes over nothing. Lengths, not shapes — the
  // shapes are what the rules are for.
  it("the needles are the shapes they claim to be", () => {
    expect(APP_KEY, "43 characters of base64url after the marker").toHaveLength(8 + 43);
    expect(SETUP_KEY).toHaveLength(10 + 43);
    expect(VENDOR_KEY.length, "a real vendor key is 90–160 characters").toBeGreaterThan(90);
    expect(REMOTE_DSN, "the password must clear the 12-character floor").toContain("s3cr3t-pw-here");
  });

  const planted: [string, string][] = [
    ["app-key", APP_KEY],
    ["app-key", SETUP_KEY],
    ["vendor-key", VENDOR_KEY],
    ["private-key", PEM_HEADER],
    ["dsn-password", REMOTE_DSN],
  ];

  for (const [ruleId, value] of planted) {
    it(`finds a planted ${ruleId} on the line it was planted on`, () => {
      // Three lines of ordinary code, then the needle: a scanner that reports
      // line 1 for everything would pass a one-line fixture.
      const source = [
        "const a = 1;",
        "const b = 2;",
        "const c = 3;",
        `const leaked = "${value}";`,
        "export default a + b + c;",
      ].join("\n");

      const rows = scanText(source, { path: "lib/planted.ts", blank: true });

      expect(rows, "the planted value produced no row at all").toHaveLength(1);
      expect(rows[0].ruleId).toBe(ruleId);
      expect(rows[0].line, "the line number is what a `Where:` is built from").toBe(4);
      expect(rows[0].severity).toBe("critical");
      expect(rows[0].inComment).toBe(false);
      expect(rows[0].accepted, "nothing here is on the allowlist").toBe(false);
    });
  }

  it("rates a secret on a NEXT_PUBLIC_ line as one that has already been published", () => {
    const rows = scanText(`NEXT_PUBLIC_OPENAI_KEY=${VENDOR_KEY}`, { path: ".env.staging" });
    expect(rows).toHaveLength(1);
    expect(rows[0].browser, "that prefix inlines the value into every browser bundle").toBe(true);
    expect(rows[0].severity).toBe("critical");
  });

  it("does not fire on the shapes the measurement refused", () => {
    // Every one of these is real text out of this tree, and every one of them
    // used to be a hit under an earlier draft of the rules. See patterns.mjs's
    // header for the numbers.
    const nothing = [
      'expect(redactLine("OPENAI_API_KEY=sk-proj-AbCdEfGh12345678")).toBe(',
      "DATABASE_URL=postgresql://app:app@localhost:15432/app",
      "postgres://app:hunter2@db.internal:5432",
      `postgres://u:${"p".repeat(20)}${AT}db.example.com:5432/x`,
      `postgres://app:${"p".repeat(20)}${AT}localhost:5432/app`,
      'const SECRET = "0123456789abcdef0123456789abcdef";',
      "**Do check** `sk_live_*`, `-----BEGIN … PRIVATE KEY-----`, and any secret",
      "-----BEGIN PUBLIC KEY-----",
    ].join("\n");

    expect(
      scanText(nothing, { path: "docs/measured.md" }).filter((row) => !row.accepted),
      "a rule started firing on the tree it ships with — re-derive the measurement " +
        "in patterns.mjs's header before changing anything here",
    ).toEqual([]);
  });
});

describe("🚨 the shipped tree stays silent", () => {
  it("the shipped .env.example produces nothing", () => {
    const text = read(".env.example");
    // Non-vacuity: an empty or missing file would pass an emptiness assertion.
    expect(text.length, "the shipped .env.example could not be read").toBeGreaterThan(2000);

    const rows = scanText(text, { path: ".env.example", blank: isSourceFile(".env.example") });

    expect(
      rows.filter((row) => !row.accepted),
      "the shipped .env.example scanned to a finding, and that means ONE of two " +
        "things — either a REAL value has been written into a git-tracked file, " +
        "which is a genuine CRITICAL and is fixed by rotating it at the provider " +
        "and taking it out; or a new PLACEHOLDER shape has been added that no rule " +
        "in patterns.mjs recognises, in which case the allowlist entry " +
        "`placeholder-value` needs to learn it. Read the line before assuming the second.",
    ).toEqual([]);
  });

  it("the built-in developer key is not a finding, and is where the allowlist says", () => {
    // 🚨 The needle first. The value lives in lib/digistore/config.mjs; the file
    // the skill's reference and .gitleaks.toml used to name — connect-api-key.mjs
    // — only IMPORTS it. An assertion against a file the value is not in would
    // have measured nothing at all.
    const home = "lib/digistore/config.mjs";
    expect(DEVELOPER_KEY_PATHS, "the allowlist must name the file the value is in").toContain(home);
    expect(
      read(home),
      "the built-in developer key is not in the file the allowlist names — either " +
        "it moved (update DEVELOPER_KEY_PATHS and .gitleaks.toml) or it is gone",
    ).toContain(DEVELOPER_KEY_VALUE);

    for (const file of [home, "scripts/ds24/connect-api-key.mjs"]) {
      const rows = scanText(read(file), { path: file, blank: true });
      expect(
        rows.filter((row) => !row.accepted),
        `${file} scanned to a finding — the command and .gitleaks.toml have stopped agreeing`,
      ).toEqual([]);
    }
  });

  it("the files this rung is made of scan clean", () => {
    // This file plants real-shaped keys, and it is git-tracked — so a fixture
    // written out as a literal would make the shipped template report itself.
    // Assembling them is what stops that, and this is what MEASURES it.
    for (const file of [
      "scripts/security/patterns.mjs",
      "scripts/security/patterns.test.ts",
      "scripts/security/rungs/secrets.mjs",
    ]) {
      const rows = scanText(read(file), { path: file, blank: true });
      expect(
        rows.filter((row) => !row.accepted),
        `${file} reports itself — write the fixture as a concatenation so no ` +
          `complete match exists in the file's own text`,
      ).toEqual([]);
    }
  });
});

describe("🚨 a comment is not a blind spot", () => {
  it("reports a key parked in a // comment at MEDIUM instead of swallowing it", () => {
    const source = [
      "const a = 1;",
      `// TODO remove: ${APP_KEY}`,
      "export default a;",
    ].join("\n");

    const rows = scanText(source, { path: "lib/parked.ts", blank: true });

    expect(rows, "the key inside the comment was swallowed — that is the failure " +
      "this two-pass scan exists to prevent").toHaveLength(1);
    expect(rows[0].line).toBe(2);
    expect(rows[0].inComment).toBe(true);
    expect(rows[0].severity, "a comment is either a key somebody meant to delete " +
      "or an example somebody wrote — real, and not certain").toBe("medium");
  });

  it("a // comment containing /* does not make the rest of the file invisible", () => {
    // The measured bug behind scripts/lib/source-text.mjs: a `//` comment with a
    // `/*` in it opened a phantom block that ran to the next `*/`, and a needle
    // planted in between left the checker passing. Line comments are blanked
    // FIRST there, and this is that fix, measured through this scanner.
    const source = [
      "// see the block in /* messages/*.json */ for the shape",
      "const a = 1;",
      `const leaked = "${VENDOR_KEY}";`,
      "/** a real JSDoc block, closed here */",
      "export default a;",
    ].join("\n");

    const rows = scanText(source, { path: "lib/phantom.ts", blank: true });

    expect(rows, "the phantom block swallowed the planted key").toHaveLength(1);
    expect(rows[0].line).toBe(3);
    expect(rows[0].inComment, "line 3 is code, not a comment").toBe(false);
    expect(rows[0].severity).toBe("critical");
  });

  it("does not blank comments in a file that has none to blank", () => {
    // A `.md` file is scanned RAW: running the blanker over a document would eat
    // its fenced code, and there is no JavaScript comment in it to blank anyway.
    expect(isSourceFile("docs/api.md")).toBe(false);
    expect(isSourceFile("scripts/security/patterns.mjs")).toBe(true);
    expect(isSourceFile("app/page.tsx")).toBe(true);

    const rows = scanText(`    // ${APP_KEY}`, { path: "docs/api.md", blank: false });
    expect(rows).toHaveLength(1);
    expect(rows[0].inComment, "nothing in a document is a JavaScript comment").toBe(false);
  });
});

describe("🚨 the allowlist judges the SECRET, never the rest of the match", () => {
  // The sharpest defect this rung has had. `sandbox-marker` and
  // `placeholder-value` were handed the whole connection string, so an ordinary
  // production hostname carried the marker and excused a live password — and
  // `secrets.mjs` then dropped accepted rows entirely, so the finding appeared in
  // no block, no counter, no `--json` and no record. Both halves are pinned here.
  const dsn = (user: string, password: string, host: string) =>
    `const u = "${["postgres:", "//"].join("")}${user}:${password}@${host}/app";`;

  it("does not excuse a live password because the HOST looks like a sandbox", () => {
    const rows = scanText(dsn("svc", "Pr0dPassw0rdXY", "test-eu.db.mycompany.com"), {
      path: "lib/a.ts",
      blank: true,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ruleId: "dsn-password", accepted: false });
  });

  it("still excuses one when the PASSWORD itself is the sandbox value", () => {
    // The counter-proof. Without it the assertion above passes against an
    // allowlist that was simply switched off, which is the shape a nervous fix
    // produces and which reads as strictness while excusing nothing on purpose.
    const sandbox = scanText(dsn("u", "sandbox-password-xy", "db.company.com"), {
      path: "lib/a.ts",
      blank: true,
    });
    expect(sandbox[0]).toMatchObject({ accepted: true, allowlistId: "sandbox-marker" });

    const placeholder = scanText(dsn("u", "your-password-here", "db.company.com"), {
      path: "lib/a.ts",
      blank: true,
    });
    expect(placeholder[0]).toMatchObject({ accepted: true, allowlistId: "placeholder-value" });
  });

  it("🚨 matches an IPv6 literal host and an upper-case scheme at all", () => {
    // Both produced NO match before 2026-08-15 — the detector answered "nothing
    // here", which is worse than "I could not look". `[2001:db8::5]` is what a
    // managed Postgres and a Docker network hand out; the capitalised scheme is
    // what a copied `.env` block or a JDBC habit produces.
    const v6 = `const u = "${["postgres:", "//"].join("")}app:Pr0dPassw0rdXY@[2001:db8:1::5]:5432/app";`;
    expect(scanText(v6, { path: "lib/a.ts", blank: true })).toHaveLength(1);

    const upper = `const u = "${["POSTGRES:", "//"].join("")}svc:Pr0dPassw0rdXY@db.mycompany.com/app";`;
    expect(scanText(upper, { path: "lib/a.ts", blank: true })).toHaveLength(1);

    // …and a local one is still not reported, which is the whole point of the
    // `holds` predicate this widening had to leave intact.
    const local = dsn("svc", "Pr0dPassw0rdXY", "localhost:5432");
    expect(scanText(local, { path: "lib/a.ts", blank: true })).toEqual([]);
  });

  it("🚨 blanks the comments of EVERY source extension, not five of them", () => {
    // `.jsx`, `.mts` and `.cts` were scanned raw: the same explanatory comment
    // was `medium, in a comment` in a `.ts` and 🚨 CRITICAL in a `.jsx`, with the
    // wrong Why/Fix prose and exit 1. `scripts/dev/routes.mjs` accepts `page.jsx`
    // as a page, so this was reachable. The answer now comes from the one owner.
    for (const ext of ["ts", "tsx", "mjs", "js", "cjs", "jsx", "mts", "cts"]) {
      expect(isSourceFile(`lib/a.${ext}`), `${ext} is source and must be blanked`).toBe(true);
    }
    for (const ext of ["md", "json", "yaml", "txt"]) {
      expect(isSourceFile(`docs/a.${ext}`), `${ext} is not source`).toBe(false);
    }
  });
});

describe("the allowlist is a set of reasons", () => {
  // ⚠️ Nothing here asserts HOW MANY entries there are, and that is a rule rather
  // than an omission — the same one `scripts/security/accepted.mjs` carries.
  // An entry that matches nothing today is good news; a count turns "the set
  // shrank because a judgement stopped being needed" into a red test, and the
  // fix somebody reaches for then is to put an entry back.
  it("gives every entry a written reason and a condition", () => {
    for (const entry of ALLOWLIST) {
      expect(entry.id, "an entry with no id cannot be named in a report").toBeTruthy();
      expect(
        entry.reason.length,
        `the allowlist entry "${entry.id}" has no written reason — an exemption ` +
          `nobody can name is an exemption nobody can review`,
      ).toBeGreaterThan(80);
      expect(typeof entry.when).toBe("function");
    }
  });

  it("excuses the built-in developer key by value AND path, never by path alone", () => {
    const rows = scanText(`const k = "${DEVELOPER_KEY_VALUE}";`, {
      path: "lib/digistore/config.mjs",
      blank: true,
    });
    // No shipped rule raises that value's shape, so there is nothing to excuse
    // today — which the entry's own reason says in words. What is asserted here
    // is the CONDITION, because that is what would matter the day a rule does.
    expect(rows.filter((row) => !row.accepted)).toEqual([]);

    // A real key pasted into the allowlisted file is still a finding. A blanket
    // path exemption — which is what a path-only allowlist is — would excuse it.
    const real = scanText(`const k = "${APP_KEY}";`, {
      path: "lib/digistore/config.mjs",
      blank: true,
    });
    expect(real, "a path exemption would have excused this").toHaveLength(1);
    expect(real[0].accepted).toBe(false);
  });

  it("excuses a sandbox marker on the VALUE, never on the file name", () => {
    const sandbox = `sk-test-${"D".repeat(40)}`;
    const excused = scanText(`key = "${sandbox}"`, { path: "lib/x.ts", blank: true });
    expect(excused, "the sandbox key did not match any rule at all").toHaveLength(1);
    expect(excused[0].accepted).toBe(true);
    expect(excused[0].allowlistId).toBe("sandbox-marker");

    // The same live-shaped key in a file whose NAME says test is still a finding.
    const live = scanText(`key = "${VENDOR_KEY}"`, { path: "lib/x.test.ts", blank: true });
    expect(live).toHaveLength(1);
    expect(live[0].accepted, "a file name excuses nothing").toBe(false);
  });
});

describe("the rule set itself", () => {
  it("carries a why and a fix on every rule, and no entropy rule", () => {
    for (const rule of SECRET_RULES) {
      expect(rule.id).toBeTruthy();
      expect(rule.label.length).toBeGreaterThan(10);
      expect(rule.why.length, `${rule.id} has no Why:`).toBeGreaterThan(40);
      expect(rule.fix.length, `${rule.id} has no Fix:`).toBeGreaterThan(40);
      expect(rule.severity).toBe("critical");
    }
  });

  it("🚨 anchors every rule on a literal, never on a run of random characters", () => {
    // The refusal, made mechanical. A pattern whose only requirement is "N
    // characters of some alphabet" is entropy detection, and the measurement in
    // patterns.mjs's header says what that costs on this tree: eleven hits, none
    // of them a secret. Entropy detection is a TOOL, and the tool is a rung of
    // its own — not five lines here.
    const ANCHORS = ["ds24", "sk-", "sk_live_", "xoxb-", "ghp_", "github_pat_", "BEGIN", "://", "NEXT_PUBLIC_"];
    for (const rule of SECRET_RULES) {
      // Backslashes out: V8 escapes `/` when a RegExp is built from a string, so
      // `://` reads as `:\/\/` in `.source` and a literal comparison would miss it.
      const source = rule.pattern.source.replace(/\\/g, "");
      expect(
        ANCHORS.some((anchor) => source.includes(anchor)),
        `${rule.id} names no literal anchor — it is a bare character-class run, ` +
          `which is entropy detection wearing a regex`,
      ).toBe(true);
    }
  });

  it("counts credential-shaped values without ever returning one", () => {
    const text = [`A=${APP_KEY}`, `B=${VENDOR_KEY}`, "C=nothing"].join("\n");
    expect(countSecrets(text, { path: ".env" })).toBe(2);
    // 🚨 A row never carries the matched value. The operator has the file open;
    // a finding, `--json` and .dev/security-check.json all get path:line.
    for (const row of scanText(text, { path: ".env" })) {
      expect(Object.keys(row).sort()).toEqual([
        "accepted",
        "allowlistId",
        "browser",
        "inComment",
        "line",
        "ruleId",
        "severity",
      ]);
    }
  });
});
