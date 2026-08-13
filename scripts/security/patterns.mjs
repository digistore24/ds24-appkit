// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What a credential LOOKS like — the rule set, the allowlist, and the scan.
//
// Pure, in the same sense `./rules.mjs` is pure: it takes a string and returns
// rows. No `node:fs`, no `node:child_process`, no `process.cwd()`, no exit code.
// That is what makes `./patterns.test.ts` able to plant a secret in a string and
// prove the scanner finds it, in milliseconds, with nothing spawned — and a
// scanner without that probe measures nothing at all
// (`scripts/lib/source-text.test.ts`: *"a guard whose probe cannot fire is worse
// than no guard: it reports success"*).
//
// The rung that reads disk and asks git is `./rungs/secrets.mjs`.
//
// ── 🚨 Every rule is anchored on a VALUE, and there is no entropy rule ──────
//
// The obvious rule is the name-anchored one: `*SECRET*`/`*TOKEN*`/`*PASSWORD*`/
// `*API_KEY*` assigned twenty-odd characters. It is refused here, and the reason
// is a measurement rather than a taste. Run over this template's own tree
// (`git ls-files -z | xargs -0 grep -nE …`, 2026-08-10):
//
//   ds24(api|setup)_[A-Za-z0-9_-]{20,}        0 hits  → ship it
//   \bsk-[A-Za-z0-9_-]{20,}                   1 hit   → a 21-character fixture in
//                                                       lib/diagnostics/redact.test.ts.
//                                                       Real OpenAI and Anthropic keys are
//                                                       90–160 characters, so the floor goes
//                                                       to 32 → 0 hits
//   BEGIN .*PRIVATE KEY                       1 hit   → the line in the security-gateway
//                                                       reference that DOCUMENTS the rule,
//                                                       written with a Unicode ellipsis.
//                                                       Anchoring the middle as ASCII → 0 hits
//   <scheme>://user:pass@host                 27 occurrences in 12 files → every one of them
//                                                       app:app, u:p, x:x, build:build, app:pw
//                                                       or hunter2. A password floor of 12 → 0
//   *SECRET*|*TOKEN*|*PASSWORD*|*API_KEY*     10–11 hits, of which **0 are secrets**.
//     assigned 20+ characters                 Four survive every honest exclusion
//                                             (auth.config.test.ts, proxy.test.ts,
//                                             scripts/cron/remote.test.ts) because they are
//                                             test fixtures shaped exactly like real values.
//                                             🚨 REFUSED.
//
// That last rule is entropy detection wearing a name, and entropy detection with
// a decade of tuning behind it is a TOOL rather than five lines here. What this
// refusal buys is the property to protect: **the shipped template scans to zero
// findings**, so the first thing a customer sees is a clean rung rather than
// five things they have to learn to ignore. A scanner that cries wolf on the
// tree it ships with is a scanner nobody reads.
//
// ── This is not `lib/diagnostics/redact.mjs`, and that is deliberate ────────
//
// `lib/diagnostics/redact.mjs:40-54` holds a pattern list that includes
// `ds24(api|setup)_…`, `sk-…`, a DSN shape, any 32+ hex run and any 7+ digit
// run. It is importable from a script and it looks like exactly what this file
// wants. It is not: it is a REDACTION set, applied on the way INTO the error
// window, where over-redaction is the safe direction and a false positive costs
// one `<secret>` in a log line. Used for DETECTION the same breadth is a flood —
// `[0-9a-f]{32,}` matches every integrity hash in a lockfile and `\d{7,}`
// matches a port range.
//
// Two of its classes ARE this app's own credentials (`ds24(api|setup)_`, `sk-`),
// and the two files must not contradict each other about the SHAPE. They are
// deliberately different in BREADTH and the same in shape; when one changes,
// read the other.
//
// ── The app's own key shapes are written out, and cannot be imported ────────
//
// Three other places in this app spell them, and none of them can be reached
// from a plain-Node script that has to run before anything is built:
//
//   lib/setup/rules.ts:171          SETUP_KEY_PREFIX  — TypeScript
//   modules/api/keys/rules.ts:37    KEY_PREFIXES      — TypeScript, and a MODULE:
//                                                       absent from a fresh app
//   lib/diagnostics/redact.mjs:46   CLASSES           — importable, wrong breadth (above)
//
// So they are copied here, once, with this note. A prefix that changes changes
// in four places, and `./patterns.test.ts` is what notices the day it does not.
//
// Plain Node, no dependency — Linux, macOS and Git Bash on Windows.
import { blankComments } from "../lib/source-text.mjs";
import { isLocalDatabaseUrl } from "../lib/media-env.mjs";

// `media-env.mjs` reaches `node:path`, `node:url` and `scripts/ds24/_env.mjs`,
// and none of those three touches the filesystem, a child process or
// `process.cwd()` at import time. It is imported rather than copied because
// "what counts as a local database" is a decision this project has already made
// once, and a second opinion about it is a second thing to keep in step.

/** What every finding from this file says reported it. Beside `"npm audit"`. */
export const SOURCE = "working tree";

// ── the rules ───────────────────────────────────────────────────────────────

/**
 * @typedef {object} SecretRule
 * @property {string} id        stable, machine-readable — it goes in the evidence line
 * @property {string} label     the finding's title
 * @property {RegExp} pattern   anchored on a literal prefix, a PEM header or a URL shape
 * @property {"critical"} severity
 * @property {string} why       what somebody gets out of it, in plain words
 * @property {string} fix       a change somebody can make
 * @property {(match: {value: string, host?: string}) => boolean} [holds]
 *                              a second, structural condition. A rule with one fires only
 *                              where it returns true — the DSN rule's host filter is the
 *                              only user, and it is a filter rather than a regex because
 *                              "is this host local" is a question this project answers
 *                              somewhere else already
 * @property {true} [qualifies] this rule never fires on its own; it RE-RATES another
 *                              rule's match on the same line. See NEXT_PUBLIC below
 */

/** 32 bytes as base64url is 43 characters, unpadded — `modules/api/keys/rules.ts`. */
// ⚠️ The same number as `SETUP_KEY_BODY_CHARS` in `lib/setup/key.mjs`, and NOT
// imported from it: this pattern covers two key families (`ds24api_` and
// `ds24setup_`) whose byte counts are each their own module's business, and a
// scanner that followed one of them would silently stop recognising the other.
// So it is written out and coupled by an assertion instead —
// `lib/setup/rules.test.ts` fails if the setup key outgrows this.
const APP_KEY_BODY = 43;

/**
 * How much key alphabet has to follow a vendor's marker.
 *
 * 32, and the number is measured rather than chosen: the one `sk-` in this tree
 * is a 21-character fixture, and the real thing is 90–160 characters. A floor
 * between the two turns one false positive into none and loses nothing real.
 */
const VENDOR_KEY_BODY = 32;

/** How long a password in a connection string has to be before it is a secret. */
const DSN_PASSWORD = 12;

/**
 * Hosts a connection string may name without it being a leak.
 *
 * The reserved documentation and testing names (RFC 2606, RFC 6761) plus
 * `.example` — everything a doc, a README or a test fixture legitimately spells.
 * "Local" is a separate question and `isLocalDatabaseUrl()` already answers it.
 */
const DOCUMENTATION_HOSTS = /(?:^|\.)(?:example\.(?:com|net|org)|example|invalid|test|localhost)$/i;

/** Is this host one nobody's credentials can reach? */
export function isDocumentationHost(host) {
  return DOCUMENTATION_HOSTS.test(String(host ?? "").trim().toLowerCase());
}

/**
 * The shipped rule set — five rows, every one of them measured above.
 *
 * A customer may extend it: this file is theirs, exactly as
 * `scripts/security/accepted.mjs` is theirs, and `node run.mjs update` carries
 * guidance text and never touches code. Whoever adds a rule re-derives the
 * measurement for it — a rule that fires on this tree is a rule its own reader
 * learns to skip past.
 *
 * @type {SecretRule[]}
 */
export const SECRET_RULES = [
  {
    id: "app-key",
    label: "A key this app itself issues is written into a file",
    // ds24api_ (the HTTP API module) and ds24setup_ (the setup surface), each
    // followed by exactly 43 characters of base64url — the shapes
    // `looksLikeKey()` and `looksLikeSetupKey()` define. See the header for why
    // neither of those two can be imported here.
    pattern: new RegExp(
      `(?<![A-Za-z0-9_-])ds24(?:api|setup)_[A-Za-z0-9_-]{${APP_KEY_BODY}}(?![A-Za-z0-9_-])`,
      "g",
    ),
    severity: "critical",
    why:
      "This is a live credential for THIS app. A ds24api_ key acts as the member " +
      "who minted it over the whole HTTP API; a ds24setup_ key writes into the " +
      "environment it was minted in. Whoever reads the file is that member.",
    fix:
      "Revoke it first — the App keys card on /dashboard/account for a ds24api_ " +
      "key, /dashboard/admin/setup-keys for a ds24setup_ one — then take the value " +
      "out of the file and read it from the environment instead. Rotating before " +
      "removing is the order that matters: a value removed but still valid is still out.",
  },
  {
    id: "vendor-key",
    label: "A vendor's secret key is written into a file",
    // Each marker followed by at least 32 characters of key alphabet.
    // `sk-` covers sk-ant-, sk-proj- and sk-or- without naming them, because the
    // hyphen is in the body alphabet.
    // ⚠️ `pk_live_` and `pk_test_` are deliberately NOT here: "publishable" is
    // what that prefix means, and a rule that raises them is a rule an operator
    // learns to skip past.
    pattern: new RegExp(
      `(?<![A-Za-z0-9_-])(?:sk-|sk_live_|xoxb-|ghp_|github_pat_)[A-Za-z0-9_-]{${VENDOR_KEY_BODY},}`,
      "g",
    ),
    severity: "critical",
    why:
      "A secret key for somebody else's service — an AI provider, Stripe, Slack, " +
      "GitHub. It bills to your account and reads whatever that account can read, " +
      "and it keeps working for as long as nobody rotates it.",
    fix:
      "Rotate it at the provider FIRST, then take the value out of the file and " +
      "read it from the environment (.env, and the host's secret storage in " +
      "STAGING/PROD). Cleaning the file before rotating leaves a live key out there.",
  },
  {
    id: "private-key",
    label: "A private key block is in a file",
    // ASCII only in the middle, which is what keeps the security-gateway
    // reference legal where it writes `-----BEGIN … PRIVATE KEY-----` with a
    // Unicode ellipsis. PUBLIC keys cannot match: the word is required.
    pattern: /-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY(?: BLOCK)?-----/g,
    severity: "critical",
    why:
      "A private key is the whole credential — a signing key, an SSH identity, a " +
      "TLS certificate's other half. Unlike an API key there is usually nothing to " +
      "rotate it at: whatever trusts it has to be told to stop.",
    fix:
      "Generate a new key pair and replace the public half everywhere it is " +
      "trusted, then take this one out of the file. Keys belong in the host's " +
      "secret storage or on disk outside the repository, never in git.",
  },
  {
    id: "dsn-password",
    label: "A connection string carries a password to a host that is not local",
    // scheme://user:password@host — the password at least 12 characters, and the
    // host neither local nor a documentation domain. Quotes and backticks are
    // excluded from every part so a match cannot run past a string literal's end.
    pattern: new RegExp(
      "(?<![A-Za-z0-9+.-])([a-z][a-z0-9+.-]*)://" +
        "([^\\s:@/\"'`]+):" +
        `([^\\s@/"'\`]{${DSN_PASSWORD},})@` +
        "([^\\s/:?#\"'`$<>{}\\\\]+)",
      "g",
    ),
    severity: "critical",
    holds: ({ value, host }) =>
      !isLocalDatabaseUrl(`x://${host}`) && !isDocumentationHost(host) && value.length > 0,
    why:
      "A connection string with a real password in it is a database somebody else " +
      "can open — every row of it, including the customer data this app is built " +
      "around. The host is not on this machine, so the credential travels.",
    fix:
      "Change the password at the database FIRST, then read the whole URL from " +
      "DATABASE_URL (or the host's secret storage) instead of writing it down. A " +
      "local development URL is fine and is not reported.",
  },
  {
    id: "browser-secret",
    label: "A secret is on a line that names a NEXT_PUBLIC_ variable",
    // 🚨 This rule NEVER fires on its own — a NEXT_PUBLIC_ name is not a secret,
    // it is a name. It re-rates a match one of the four rules above made on the
    // same line, because that prefix is what decides where the value ends up.
    pattern: /NEXT_PUBLIC_[A-Z0-9_]+/g,
    qualifies: true,
    severity: "critical",
    why:
      "🚨 NEXT_PUBLIC_ is not a naming convention — it is an instruction to Next.js " +
      "to inline the value into the JavaScript bundle every visitor downloads. A " +
      "credential there is not at risk of leaking; it has already been published " +
      "to everybody who ever loaded a page.",
    fix:
      "Rotate the value at whatever issued it, then move it to a variable WITHOUT " +
      "the prefix and read it on the server only. Nothing behind NEXT_PUBLIC_ can " +
      "be a secret, whatever it is renamed to afterwards.",
  },
];

/** The qualifying rule, by name — the rung composes its prose onto a match. */
export const BROWSER_RULE = SECRET_RULES.find((rule) => rule.id === "browser-secret");

/**
 * The same pattern without `g`.
 *
 * ⚠️ Not tidiness: `RegExp.prototype.test()` on a `/g/` regex advances its
 * `lastIndex` and answers false on the very next call. A stateful regex asked
 * once per line reports roughly every other line, which is the kind of bug that
 * makes a scanner look flaky rather than broken.
 */
const BROWSER_ON_LINE = new RegExp(BROWSER_RULE.pattern.source);

/** The four rules that can fire on their own. */
const VALUE_RULES = SECRET_RULES.filter((rule) => !rule.qualifies);

// ── what is not a finding ───────────────────────────────────────────────────

/**
 * The built-in Digistore24 developer key.
 *
 * It is a client id, not a credential: it identifies the TEMPLATE to
 * `requestApiKey` / `retrieveApiKey` and carries no rights to any account. The
 * rights-bearing key comes into existence only once a merchant grants access in
 * their browser, and then lives in their own `.env`. `lib/digistore/config.mjs`
 * carries the full reasoning above the value.
 *
 * ⚠️ It sits in `lib/digistore/config.mjs`, NOT in
 * `scripts/ds24/connect-api-key.mjs` — that file imports it. Both `.gitleaks.toml`
 * and the security-gateway reference named only the importer, which is a path
 * that would have excused nothing; both now name the file the value is in.
 */
export const DEVELOPER_KEY_VALUE = "1706550-aASzoSnqcChueKmMDBvcwqUWvOqnfhXTncfkTN6X"; // gitleaks:allow trufflehog:ignore pragma: allowlist secret NOSONAR nosemgrep

/** Where that value legitimately appears. The same list `.gitleaks.toml` carries. */
export const DEVELOPER_KEY_PATHS = [
  "lib/digistore/config.mjs",
  "scripts/ds24/connect-api-key.mjs",
  ".gitleaks.toml",
  "scripts/security/patterns.mjs",
];

const normalisePath = (path) => String(path ?? "").split(/[\\/]/).join("/");

/**
 * What this rung does NOT report, as a SET of reasons.
 *
 * The shape `scripts/security/accepted.mjs` set, and its sentence applies here
 * word for word: **an entry that matches nothing today is good news**, and
 * ⚠️ nothing in this project may assert how many entries are in here — not a
 * test, not a sentence, not a log line. The set is the truth; its size is a fact
 * about today, and a check that allowed "the known findings" goes green on the
 * day a new, real one lands inside the allowance.
 *
 * `when` is asked per MATCH, never per file: a blanket path exemption excuses
 * everything anybody ever writes into that file, which is precisely where a real
 * key would come to rest.
 *
 * @typedef {object} AllowlistEntry
 * @property {string} id      stable, machine-readable
 * @property {string} reason  why it is not a finding, in prose. An exemption
 *                            nobody can name is an exemption nobody can review
 * @property {(match: {ruleId: string, value: string, path: string}) => boolean} when
 *
 * @type {AllowlistEntry[]}
 */
export const ALLOWLIST = [
  {
    id: "ds24-developer-key",
    reason:
      "The Digistore24 developer key built into this template. It is a client id in " +
      "the OAuth sense — it identifies the application to requestApiKey and carries " +
      "no rights to any account; the key that carries rights is minted only when a " +
      "merchant grants access in their browser and lives in their own .env. A " +
      "scanner WILL raise it, which is why .gitleaks.toml:17-22 allowlists the same " +
      "value: the two agree by construction rather than by luck. ⚠️ The condition " +
      "here is value AND path where gitleaks ORs the two — a blanket path exemption " +
      "would excuse a real key pasted into the same file, and this entry is narrower " +
      "on purpose. ⚠️ MEASURED 2026-08-10: it matches nothing, because no rule in " +
      "this file raises that value's shape. It is here so that a customer who adds " +
      "one does not have to re-derive the judgement.",
    when: ({ value, path }) =>
      String(value ?? "").includes(DEVELOPER_KEY_VALUE) &&
      DEVELOPER_KEY_PATHS.includes(normalisePath(path)),
  },
  {
    id: "sandbox-marker",
    reason:
      "A value carrying _test_, _sandbox_, test- or sandbox-. A sandbox key moves no " +
      "money and opens no live account; it is the same skip list the skill's own " +
      "reference carries (references/checks-secrets-and-deps.md:16-29), so the " +
      "command and the human pass agree about it. The marker is read off the MATCHED " +
      "VALUE, never off the line — a file called `token-test.ts` excuses nothing.",
    when: ({ value }) => /(?:_test_|_sandbox_|test-|sandbox-)/i.test(String(value ?? "")),
  },
  {
    id: "publishable-key",
    reason:
      "Publishable and public keys: pk_live_*, pk_test_*, -----BEGIN PUBLIC KEY-----, " +
      "ssh-rsa, ssh-ed25519 and any *.pub file. Publishable is what that prefix MEANS " +
      "— the value is designed to sit in a browser bundle — and a rule that raises " +
      "one is a rule an operator learns to skip past. ⚠️ MEASURED 2026-08-10: it " +
      "matches nothing, because no shipped rule here raises a publishable form in the " +
      "first place. It stays because the rule set is extensible (AC3) and a customer " +
      "who adds a pk_ rule should not have to rediscover why it was wrong.",
    when: ({ value, path }) =>
      /^(?:pk_live_|pk_test_|ssh-rsa|ssh-ed25519)/.test(String(value ?? "")) ||
      /-----BEGIN(?: [A-Z0-9]+)* PUBLIC KEY-----/.test(String(value ?? "")) ||
      normalisePath(path).endsWith(".pub"),
  },
  {
    id: "placeholder-value",
    reason:
      "A placeholder rather than a value — a run of x's, a literal `...`, `<…>`, " +
      "`your-…`, `changeme`. This is what .env.example is made of. 🚨 It is written " +
      "as a VALUE shape and deliberately NOT as a path exemption for .env.example: " +
      "excusing that file wholesale would make patterns.test.ts's second needle probe " +
      "— the shipped .env.example must scan silent — pass without measuring anything, " +
      "and a real value written into that git-tracked file is a genuine CRITICAL.",
    when: ({ value }) => {
      const text = String(value ?? "");
      return (
        /^(?:x{4,}|X{4,})/.test(text) ||
        /\.\.\.|…|<[^>]*>|\$\{|changeme|your-|yourdomain|placeholder/i.test(text)
      );
    },
  },
];

/** The first entry that excuses this match, or null. */
export function allowlistFor(match) {
  return ALLOWLIST.find((entry) => entry.when(match)) ?? null;
}

// ── the scan ────────────────────────────────────────────────────────────────

/** Where every line starts, so an offset becomes a 1-based line number. */
function lineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

/** The 1-based line an offset falls on. Binary search over `lineStarts()`. */
function lineAt(starts, index) {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (starts[mid] <= index) low = mid;
    else high = mid - 1;
  }
  return low + 1;
}

/** Every value-rule match in `text`, with its offset. Fresh regexes, no shared state. */
function matchesIn(text) {
  const out = [];
  for (const rule of VALUE_RULES) {
    const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
    let match;
    while ((match = pattern.exec(text)) !== null) {
      // A zero-length match would spin forever. None of the rules can produce
      // one, and a rule added later must not be able to either.
      if (match[0].length === 0) {
        pattern.lastIndex += 1;
        continue;
      }
      if (rule.holds && !rule.holds({ value: match[0], host: match[4] })) continue;
      out.push({ ruleId: rule.id, index: match.index, value: match[0] });
    }
  }
  return out;
}

const keyOf = (match) => `${match.ruleId}:${match.index}`;

/**
 * Every credential-shaped value in `text`, as rows.
 *
 * 🚨 **A row never carries the matched value.** `line` and `ruleId` are what a
 * finding is built from, and the operator has the file open. That is the rule
 * `rules.mjs:496-520` keeps for the record, applied to this file's output so no
 * caller can leak one by accident.
 *
 * ── The two passes, and why neither of them is enough alone ────────────────
 *
 * `blank: true` (a `.ts`, `.tsx`, `.mjs`, `.js` or `.cjs` file) runs the text
 * through `blankComments()` from `scripts/lib/source-text.mjs` — never a regex of
 * its own, which is the rule `CLAUDE.md` → *Rules* states (in full:
 * `docs/conventions.md`) and
 * `scripts/lib/source-text.test.ts` enforces by refusing a seventeenth copy.
 *
 * But blanking alone has a blind spot, and it is the one this whole command
 * exists against: **a comment is exactly where somebody parks a key they mean to
 * delete.** So the raw text is scanned as well. Blanking replaces comment
 * content with SPACES of the same length, so offsets line up between the two
 * passes and the difference is a set difference:
 *
 *   present in both        the value is in the CODE       → the rule's severity
 *   present only in raw    the value is in a COMMENT      → ⚠️ MEDIUM, its own Why
 *
 * Do not "simplify" this back to one pass in either direction: one pass on
 * blanked text has the blind spot, one pass on raw text reports files for
 * explaining themselves.
 *
 * @param {string} text
 * @param {{path?: string, blank?: boolean}} [options]
 * @returns {{ruleId: string, line: number, severity: string, inComment: boolean,
 *            browser: boolean, accepted: boolean, allowlistId: string}[]}
 */
export function scanText(text, { path = "", blank = false } = {}) {
  const source = String(text ?? "");
  if (source === "") return [];

  const raw = matchesIn(source);
  if (raw.length === 0) return [];

  // Blanked matches are always a SUBSET of raw ones — blanking only ever turns
  // characters into spaces, and a space breaks every rule here — so what is
  // missing from this set is precisely what lives inside a comment.
  const inCode = blank ? new Set(matchesIn(blankComments(source)).map(keyOf)) : null;

  const starts = lineStarts(source);
  const lines = source.split(/\r?\n/);
  const rows = [];

  for (const match of raw) {
    const rule = SECRET_RULES.find((entry) => entry.id === match.ruleId);
    const line = lineAt(starts, match.index);
    const inComment = inCode !== null && !inCode.has(keyOf(match));
    const entry = allowlistFor({ ruleId: match.ruleId, value: match.value, path });

    rows.push({
      ruleId: match.ruleId,
      line,
      // A value in a comment is real enough to report and not certain enough to
      // rate as a live credential: it is either something somebody meant to
      // delete or an example somebody wrote, and the finding says both.
      severity: inComment ? "medium" : (rule?.severity ?? "critical"),
      inComment,
      browser: BROWSER_ON_LINE.test(lines[line - 1] ?? ""),
      accepted: entry !== null,
      allowlistId: entry?.id ?? "",
    });
  }

  // Stable and readable: by line, then by rule, so two rules firing on one line
  // always come out in the same order.
  rows.sort((a, b) => a.line - b.line || a.ruleId.localeCompare(b.ruleId));
  return rows;
}

/** How many credential-shaped values are in this text — the `.env` half's answer. */
export function countSecrets(text, options = {}) {
  return scanText(text, options).filter((row) => !row.accepted).length;
}

/** The rule behind a row, for composing a finding. Never throws over a lookup. */
export const ruleFor = (ruleId) => SECRET_RULES.find((rule) => rule.id === ruleId) ?? null;

/** Is this a file whose comments have to be blanked before it is scanned? */
export function isSourceFile(path) {
  return /\.(?:ts|tsx|mjs|js|cjs)$/i.test(normalisePath(path));
}
