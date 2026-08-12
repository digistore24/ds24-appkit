// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// One line of the app's own stderr, with anything that could identify a person
// or unlock something taken out of it.
//
// 🚨 **This runs on the way IN, not on the way out.** The ring in `capture.ts`
// stores what this function returns and never the original, so the process does
// not retain an address, a token or a connection string at any moment — the
// endpoint cannot leak what was never kept. Redacting at response time would
// leave the payload in memory and only make the door polite.
//
// The host's own log keeps the FULL text: whoever has shell access on the
// server still sees everything, and only the remote reader gets the safe
// subset. That is the right way round.
//
// ── The failure to design against is over-redaction ───────────────────────
// `at AdminChallengePage (app/dashboard/admin/challenges/[id]/page.tsx:161:35)`
// and `> 174 |   {format.dateTime(person.since, …)}` are the whole product of
// this command: the location and the offending expression. A pattern that eats
// a line number or a path turns a useful finding into a shrug. Both shapes have
// their own test case in redact.test.ts, and they are not decoration.
//
// `.mjs` and not `.ts` for the same reason as `parse.mjs`: `capture.ts` is
// import-light by rule, and this file has to stay importable from anywhere.

/** Past this the line is cut, with a visible mark. Bounds one pathological line. */
export const MAX_LINE_CHARS = 500;

/**
 * The classes, in the order they are applied. Order matters:
 *
 *   · a DSN carries a password AND a host, so it goes before the credential
 *     patterns would nibble at its middle;
 *   · a UUID is 32 hex digits with dashes, so it goes before the bare hex run;
 *   · digit runs go LAST, because `161:35` in a stack line and `> 174 |` in a
 *     code frame are digits too and must survive — which is why the threshold
 *     is seven, well above any line or column number.
 */
const CLASSES = [
  // postgres://user:pass@host:5432/db — the whole thing, not only the password.
  { when: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s@/]*@\S+/gi, with: "<dsn>" },
  { when: /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g, with: "<email>" },
  // `Bearer …` keeps its scheme — that is the shape of the finding, not a secret.
  { when: /\bBearer[ \t]+\S+/gi, with: "Bearer <secret>" },
  { when: /\bds24(?:api|setup)_[A-Za-z0-9_-]+/g, with: "<secret>" },
  { when: /\bsk-[A-Za-z0-9_-]{8,}/g, with: "<secret>" },
  {
    when: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    with: "<id>",
  },
  { when: /\b[0-9a-f]{32,}\b/gi, with: "<secret>" },
  { when: /\b\d{7,}\b/g, with: "<number>" },
];

/**
 * A single log line, safe to keep.
 *
 * @param {string} line
 * @returns {string}
 */
export function redactLine(line) {
  let out = String(line);
  for (const { when, with: replacement } of CLASSES) {
    out = out.replace(when, replacement);
  }
  // Cut AFTER redacting, never before: a secret at character 900 of a very long
  // line would otherwise be dropped from the cut half and kept in nothing —
  // which sounds safe until the cut lands in the middle of one.
  if (out.length > MAX_LINE_CHARS) out = `${out.slice(0, MAX_LINE_CHARS)}…`;
  return out;
}
