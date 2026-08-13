// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The error parser, and the renderer that prints what it found.
//
// Why this sits in `lib/` rather than beside the command that grew it. There
// are TWO readers of the same text now: `node run.mjs errors` reads
// `.dev/dev.log` on this machine, and `GET /api/diagnostics/errors` reads the
// deployed app's own stderr out of a bounded in-memory ring
// (`lib/diagnostics/capture.ts`). Both are the same bytes — a dev log IS the
// dev server's stderr captured to a file — so they must be the same verdict by
// construction rather than by two implementations agreeing today. One parser,
// one renderer, two callers.
//
// `.mjs` and not `.ts` for a mechanical reason: `scripts/dev/log-errors.mjs`
// has to import it, and a script cannot import TypeScript. Same split as
// `lib/ai/task-rules.mjs` beside `lib/ai/tasks.ts`.
//
// Why this class of defect needs its own command at all. `node run.mjs smoke`
// judges a page by its HTTP status, and there is a whole class of defect that
// never changes the status:
//
//   {format.dateTime(person.since, { dateStyle: "medium" })}
//
// If `person.since` is not a Date, Intl throws — but next-intl catches it,
// writes the error to stderr and renders `String(value)` instead. The page
// answers 200, the table cell reads "2026-07-25 11:29:17.552095", and every
// automated check in this project is happy. The log is the only witness.
//
// The same is true of a missing translation, a hydration mismatch, and an
// unhandled rejection in a server action: all visible in the log, none of them
// visible in a status code.

/**
 * The subsystem prefix this app puts in front of its own log lines.
 *
 * `[cron]`, `[media]`, `[ipn]`, `[ops]`, `[chat]`, … — 28 of them across the
 * tree at the time of writing, and the list grows with every feature. It is
 * NOT enumerated here on purpose: an allowlist is a list somebody forgets to
 * extend, and forgetting it here means the command answers `✓` over a real
 * failure. `[intl]` and `[browser]` are the two that are not ours (next-intl
 * and Next's dev-server browser channel) and they are the two this pattern
 * used to know.
 *
 * @see PREFIXED_ERROR — the line shape that made this a defect rather than an
 *   inelegance.
 */
const PREFIX = String.raw`(?:\[[\w.:-]+\]\s+)?`;

/**
 * 🚨 `[prefix] some sentence: Error: …` — the shape that made this a defect.
 *
 *     console.error(`[cron] ${job.id} FAILED after ${ms}ms:`, error)
 *     → [cron] prune-ipn-log FAILED after 0ms: Error: connect ECONNREFUSED
 *           at Object.run (lib/cron/jobs.ts:140:13)
 *
 * Every pattern in `ERROR_START` anchors on a line that BEGINS with an error,
 * optionally behind a prefix. This one begins with a prefix and a SENTENCE.
 * Measured against a real planted job failure, all three lines a failing
 * scheduler produces (`… FAILED after …`, `[cron] tick failed:`, `[cron] could
 * not record the outcome of …`) gave 0 findings — and a job has no status code
 * to hide behind, so the log line is its only signal.
 *
 * 69 of the 76 prefixed `console.error` / `console.warn` sites in this tree
 * have exactly this shape: a message ending in a colon, then the caught error.
 * That is the house style, not a cron peculiarity.
 *
 * ⚠️ What it does NOT match, deliberately: `[cron] prune-ipn-log ok in 2ms — 0
 * row(s) deleted`. A prefix says which subsystem spoke, never that something
 * went wrong — `console.log` wears the same prefix as `console.error` once both
 * are in one stream — so the ERROR SHAPE is still required. A prefixed line
 * whose tail is not an error object (`[ops] media store misconfigured: 3
 * problem(s)`) stays invisible; widening to "prefixed and printed loudly" is
 * what would open with a wall, and a parser that opens with a wall is one
 * somebody switches off.
 *
 * `\w*Error\b` rather than `Error:` because an Error with an empty message
 * prints as a bare `Error` with the stack under it.
 */
const PREFIXED_ERROR = new RegExp(
  String.raw`^(?:⨯\s+)?\[[\w.:-]+\]\s+\S.*:\s+(?:Uncaught\s+(?:\(in promise\)\s+)?)?\w*Error\b`,
);

/**
 * What starts an error in the log.
 *
 * Next writes an error as a block at column 0 — `Error: …`, sometimes with a
 * `⨯` in front — followed by an indented stack and a code frame. `[intl]` is
 * next-intl's prefix, and the rest come from this app's own `console.error`.
 *
 * **`[browser]` is not the app's own output at all**, and it is the one worth
 * knowing about: Next forwards an error the BROWSER raised into this log, as
 * `[browser] Uncaught Error: …`. For as long as these patterns only matched a
 * line beginning with `Error`, such a block was invisible here — and it is
 * exactly the class of failure this command exists for, because the server
 * answered 200 and noticed nothing.
 *
 * ⚠️ The `[browser]` family is a DEV-SERVER channel. A production build has no
 * such forwarding, so the remote reader sees server-side output only — said in
 * words in `docs/DEPLOY.md` rather than left for somebody to infer from a green
 * remote run.
 */
const ERROR_START = [
  // `Uncaught (in promise)` is the browser's wording for a rejected promise
  // nobody caught — the async half of the same class, and in fetch-heavy
  // client code the more common one.
  new RegExp(
    String.raw`^(?:⨯\s+)?${PREFIX}(?:Uncaught\s+(?:\(in promise\)\s+)?)?\w*Error(?::|\b.*\bat\b)`,
  ),
  new RegExp(String.raw`^(?:⨯\s+)?${PREFIX}unhandledRejection\b`),
  new RegExp(String.raw`^(?:⨯\s+)?${PREFIX}Warning:.*hydrat`, "i"),
  /^(?:⨯\s+)?.*\bHydration failed\b/,
  /^⨯\s+\S/,
  PREFIXED_ERROR,
];

/**
 * What is NOT an error, however loudly it is printed.
 *
 * The dev-login banner is the one that matters: it carries a ⚠️ and a
 * "no mail transport configured", and flagging it would make this command cry
 * wolf on every single fresh project.
 */
const BENIGN = [
  /^⚠️/,
  /^[✓○▲ℹ✗•-]/,
  /^\s*(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s/,
  /^\s*(?:Local|Network|Environments|Ready|Compiled|Compiling|Starting|Reload)\b/,
  /^\s*[▲✓]?\s*Next\.js\s/,
];

/** The named error codes worth pulling out of a message as the headline. */
const CODES = [
  "FORMATTING_ERROR",
  "MISSING_MESSAGE",
  "MISSING_FORMAT",
  "INSUFFICIENT_PATH",
  "INVALID_MESSAGE",
  "INVALID_KEY",
  "ENVIRONMENT_FALLBACK",
];

/**
 * What to do about it. The point of these is that the fix is almost never at
 * the line the stack trace names — that line is where the bad value surfaced,
 * not where it was made.
 */
const HINTS = [
  {
    when: /FORMATTING_ERROR.*Invalid time value/,
    say:
      "the value is not a Date. A raw sql`` expression and anything through JSON\n" +
      "    both hand you a string — see docs/troubleshooting.md,\n" +
      "    'Dates and raw SQL'. Fix where the value is produced, not at the\n" +
      "    format.dateTime call.",
  },
  {
    when: /MISSING_MESSAGE/,
    say: "the key is missing in messages/de.json or messages/en.json — both need it.",
  },
  {
    when: /MISSING_FORMAT/,
    say: "the named format is not declared in i18n/request.ts → formats.",
  },
  {
    when: /hydrat/i,
    say:
      "server and browser rendered different markup. Usually a date, a random value\n" +
      "    or a `typeof window` check inside the render — but read the attributes React\n" +
      "    prints as differing FIRST: a vendor name in them (data-darkreader-*,\n" +
      "    data-gr-*) means a browser extension rewrote the page and the code is fine.\n" +
      "    See docs/troubleshooting.md, 'A hydration mismatch is not always yours'.",
  },
  {
    when: /unexpected response was received from the server/i,
    say:
      "usually the browser's cookies for localhost no longer fit in one request —\n" +
      "    the giveaway is this page's GET in the log with NO POST after it. Every copy\n" +
      "    of this template ever started on this machine leaves a session cookie there,\n" +
      "    cookies ignore ports, and past ~16 KB Node answers 431 BEFORE Next.js sees\n" +
      "    the request. The stack trace names the page that was waiting, which is the\n" +
      "    one place the fault is not. Clear the cookies for localhost (DevTools →\n" +
      "    Application → Cookies); below the point where even the GET dies, the app\n" +
      "    prunes them itself (lib/auth/cookie-names.ts). If a POST IS in the log,\n" +
      "    this is something else — most often a stale tab talking to a rebuilt server.",
  },
  {
    when: /unhandledRejection/,
    say: "a promise rejected with nobody awaiting it — add the await, or catch it.",
  },
  {
    when: /ECONNREFUSED|ENOTFOUND/,
    say: "something the app talks to is not answering — the database? Try: node run.mjs status",
  },
];

function isBenign(line) {
  return BENIGN.some((pattern) => pattern.test(line));
}

function isErrorStart(line) {
  if (!line.trim() || isBenign(line)) return false;
  return ERROR_START.some((pattern) => pattern.test(line));
}

/** The headline: a named code if there is one, else the first line as written. */
function headline(firstLine) {
  // `[browser]` goes the same way as `[intl]`: it names where the error was
  // raised, not what it was. `Uncaught` stays — that is the browser's own
  // wording, and the rest of the line is kept verbatim here too.
  const clean = firstLine
    .replace(/^⨯\s+/, "")
    .replace(/^\[(?:intl|browser)\]\s+/, "")
    .trim();
  const code = CODES.find((name) => clean.includes(name));
  if (!code) return clean;
  // "Error: FORMATTING_ERROR: Invalid time value" → "FORMATTING_ERROR: Invalid time value"
  return clean.slice(clean.indexOf(code));
}

/**
 * What makes two headlines the SAME finding.
 *
 * The count exists so a table with 40 rows is one finding rather than forty.
 * That only worked while the repeated headline was byte-identical, and a
 * message built at the moment it is printed is not:
 *
 *     [cron] prune-ipn-log FAILED after 3ms: Error: …
 *     [cron] prune-ipn-log FAILED after 5ms: Error: …
 *
 * 🚨 Measured, not argued: a job failing on a one-minute schedule produced
 * three failures and THREE findings, identical but for the milliseconds. The
 * window holds 500 lines, so a job broken overnight is a page of them — which
 * is the wall this parser must not open with, arriving through the fix for the
 * blindness rather than in spite of it.
 *
 * So numbers do not distinguish two headlines. The location still does, and it
 * is NOT normalised — two errors on two lines of one file stay two findings.
 * The message shown is the first one seen, verbatim.
 */
function dedupeKey(message) {
  return message.replace(/\d+/g, "#");
}

/**
 * Every error in a piece of log text, deduped. Pure — parse.test.ts drives this
 * one directly with a captured log, so the patterns above can be tested without
 * a running app.
 *
 * A block is read with a bounded lookahead rather than by finding its exact
 * end: a code frame puts `>` and `}` at column 0, so "the block ends at the
 * next unindented line" would cut it in half. All that is needed from the
 * block is the first source location and the marked frame line.
 *
 * @param {string} text
 * @returns {{ message: string, location: string | null, frame: string | null, count: number }[]}
 */
export function parseErrors(text) {
  const lines = text.split("\n");
  const findings = new Map();

  for (let index = 0; index < lines.length; index++) {
    if (!isErrorStart(lines[index])) continue;

    const block = [];
    for (let ahead = index + 1; ahead < lines.length && block.length < 25; ahead++) {
      if (isErrorStart(lines[ahead])) break;
      if (isBenign(lines[ahead])) break;
      block.push(lines[ahead]);
    }

    const message = headline(lines[index]);
    // The app's own files first: the top of a stack is often inside next/react,
    // and what the reader needs is the line they wrote.
    const own = block.find((line) => /\b(app|lib|components|hooks|db|i18n)\/\S+:\d+:\d+/.test(line));
    const any = block.find((line) => /\S+:\d+:\d+/.test(line));
    // No parentheses in the class: the stack writes `at X (app/…/page.tsx:174:35)`
    // and the opening bracket is not part of the path.
    const location = (own ?? any ?? "").match(/([\w./[\]@-]+:\d+):\d+/)?.[1] ?? null;
    // The line the code frame marks with `>` — the actual offending expression.
    const frame = block.find((line) => /^>\s*\d+\s*\|/.test(line))?.replace(/^>\s*\d+\s*\|\s*/, "").trim() ?? null;

    const key = `${dedupeKey(message)}@${location ?? "?"}`;
    const seen = findings.get(key);
    if (seen) seen.count += 1;
    else findings.set(key, { message, location, frame, count: 1 });
  }

  return [...findings.values()];
}

/**
 * The findings as lines, ready to print. Pure — no `console`, no `process`.
 *
 * 🚨 One renderer, two callers, for the same reason there is one parser: "the
 * remote output has the same format as the local one" is a claim, and two
 * format strings that agree today are the way such a claim quietly stops being
 * true. `report()` in `scripts/dev/log-errors.mjs` prints this, and so does
 * `node run.mjs errors --url …`.
 *
 * Exactly two strings legitimately differ between the two callers, and both are
 * parameters rather than a fork:
 *
 *   · `source` — "in the log" is a lie about a bounded in-memory ring, so the
 *     remote caller passes the window it actually looked at.
 *   · `logHint` — locally the full context is `node run.mjs logs`; on a
 *     deployed app it is the host's own log, which this app cannot read.
 *
 * ⚠️ **The stream split belongs to the caller and is load-bearing.** `report()`
 * writes head, body and tail to **stderr** and only the `✓` / no-log lines to
 * stdout. Whoever moves one of them changes what a caller redirecting `2>` sees,
 * silently.
 *
 * @param {{ message: string, location: string | null, frame: string | null, count: number }[]} findings
 * @param {{ source?: string, logHint?: string }} [options]
 * @returns {{ head: string[], body: string[], tail: string[] }} each an array of
 *   whole lines; printing them one per `console.error` reproduces the output
 *   this command has always had, byte for byte.
 */
export function renderFindings(findings, options = {}) {
  const source = options.source ?? "in the log";
  const logHint = options.logHint ?? "The full context, with stack traces: node run.mjs logs";

  const total = findings.reduce((sum, finding) => sum + finding.count, 0);
  const head = [`✗ ${total} error(s) ${source} — ${findings.length} distinct:`, ""];

  const body = [];
  for (const { message, location, frame, count } of findings) {
    body.push(`  ${message}${count > 1 ? `  (${count}×)` : ""}`);
    if (location) body.push(`    ${location}`);
    if (frame) body.push(`    ${frame}`);
    const hint = HINTS.find(({ when }) => when.test(message));
    if (hint) body.push(`    → ${hint.say}`);
    body.push("");
  }

  const tail = [
    "A page that answers 200 can still be broken — this is what the status code",
    "cannot tell you. Fix these before you report the work as done.",
    logHint,
  ];

  return { head, body, tail };
}
