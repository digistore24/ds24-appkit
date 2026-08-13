// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// A body quoted in the guide has to be the body the route sends.
//
// ── The defect this exists for, measured rather than described ─────────────
// `app/api/readyz/route.ts` answers 200 `{"status":"ready"}` and 503
// `{"status":"not-ready"}`. **`ready` is a substring of `not-ready`.** Every
// uptime provider offers "the answer must contain this keyword", it is the first
// thing an operator reaches for, and the obvious word for a readiness endpoint is
// `ready` — so configured, the check reports SUCCESS on exactly the outage it
// exists to catch, silently and for ever, because the substring always matches.
//
// The first test below produces that: it drives the real route both ways and
// shows `includes("ready")` answering **true on both bodies**, while the rule the
// guide now hands over — `"status":"ready"` with its quotes and its colon —
// answers true / false. Nothing else in this repo makes that measurement, and the
// three customer documents that handed the operator the bare word
// (`docs/DEPLOY.md`, `go-live` step 5, `setup-hosting` step 9) were written
// against a browser tab, where `→ ready` is correct enough. They stopped being
// harmless the moment something automatic read them.
//
// ── Why prose needed a guard of its own ───────────────────────────────────
// The brackets this project already had all measure STRUCTURE: `links.test.ts`
// asks whether a link resolves, `docs-coverage.test.ts` whether a name appears,
// the condensate stamp whether a document MOVED. None of them asks whether a body
// printed in quotation marks is still the body. The pattern exists in the house —
// `lib/entitlements/instructions.test.ts` nails the call shape of `hasPlan()` down
// in the guidance — it had simply never been pointed at an HTTP response.
//
// ── The anchor, and why it is not the "completeness" anchor ───────────────
// The house rule for a LIST is that it is only a site when a sentence beside it
// claims completeness (`make setup-tools-check`), never because a name appears in
// it. That rule answers a different question. Here nothing is claimed to be
// complete: the claim is that ONE shown literal EQUALS what one named route
// really sends. So the anchor is the RENDERING — an arrow or an "answers" after a
// route this app really serves — and the literal that follows it. A route name on
// its own is not a site (`README.md` names both endpoints and offers no body; the
// `performance-gateway` load test hits `/api/healthz` and never quotes it), which
// is why those two files are silent here and stay silent.
//
// ── Measured at zero before it was armed ──────────────────────────────────
// 106 guidance files, 27 routes (the core's plus the module routes that live in
// the same tree as `route.<id>.ts`), 4 sites, 0 findings. What was deliberately
// measured and LEFT OUT, so the list does not grow into an allowlist:
//
//   · a bare word after an arrow in PROSE — `| /api/v1/auth/token | POST | sign
//     in → key (above) |` is a narrative arrow in a table, not a rendering. Bare
//     words count inside a fenced code block, where an arrow after a URL means
//     one thing only. JSON objects count everywhere.
//   · a body on a CONTINUATION line — `docs/DEPLOY.md` prints the 503 body on the
//     line below the route. The reader is line-based; a window would have to
//     guess how far a rendering reaches.
//   · a SHAPE SKETCH — `POST /api/media/upload-url { … } → { ticketId, url,
//     expiresAt }` in `docs/visuals.md` is not a literal and does not parse as
//     JSON. Parsing is the discriminator, so no marker and no allowlist is needed.
//   · the `keyword_type` POLARITY itself. Which value of a third-party form field
//     means "alert when absent" is the one guidance class nothing in this repo can
//     execute, and no regex separates a document that gets it right from one that
//     merely mentions it. What IS checked is weaker and honest: a document that
//     hands over a confusable route's body must NAME the trap and the direction
//     (last test below). The wording lives in the documents.
import { describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

import { blankComments } from "./lib/source-text.mjs";

const ROOT = path.join(import.meta.dirname, "..");
const rel = (p: string) => path.relative(ROOT, p).split(path.sep).join("/");

// ── what the routes really answer ───────────────────────────────────────────

/** One statically readable answer of one route. */
export type RouteAnswer = { status: number; body: string };

/**
 * Every route file under `app/api/`, including the ones a MODULE brings.
 *
 * A module's route is `route.<id>.ts` in the same tree (`scripts/modules/
 * page-extensions.mjs`), so `/api/v1/me` is covered here without a second list to
 * keep in step — a rule that only knew `/api/readyz` would be this same finding
 * again in a year. ⚠️ `route.test.ts` matches that shape with the id "test",
 * which is exactly why `manifest.mjs` reserves that id; it is excluded by name.
 */
function routeFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) routeFiles(p, out);
    else if (/^route(\.[a-z0-9-]+)?\.ts$/.test(entry.name) && entry.name !== "route.test.ts")
      out.push(p);
  }
  return out;
}

/**
 * The response bodies a route file spells out as an object LITERAL.
 *
 * Read as text through `blankComments()` — a route that documents its own answer
 * in a comment must not be read as sending it. Anything whose values are not
 * literals (`Response.json(payload)`, `Response.json({ id })`) yields nothing:
 * this reads what a document could have COPIED, and a document cannot copy a
 * variable. Routes that yield nothing are reported rather than skipped — see
 * "a literal shown for a route this guard cannot read".
 */
function answersOf(source: string): RouteAnswer[] {
  const text = blankComments(source);
  const answers: RouteAnswer[] = [];
  const call = /\b(?:Response|NextResponse)\.json\(\s*(\{[^{}]*\})\s*(?:,\s*(\{[^{}]*\}))?\s*\)/g;
  for (const [, literal, options] of text.matchAll(call)) {
    let body: string;
    try {
      // `{ status: "ready" }` is a JS object literal, not JSON: the key is bare.
      // Quoting the keys is the whole conversion; a value that is an identifier
      // makes the parse throw, which is the intended rejection.
      body = JSON.stringify(JSON.parse(literal.replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')));
    } catch {
      continue;
    }
    const status = options && /\bstatus:\s*(\d{3})\b/.exec(options);
    answers.push({ status: status ? Number(status[1]) : 200, body });
  }
  return answers;
}

/** Every route this app serves, by URL, with what it statically answers. */
export function apiRoutes(): Map<string, { file: string; answers: RouteAnswer[] }> {
  const routes = new Map<string, { file: string; answers: RouteAnswer[] }>();
  for (const file of routeFiles(path.join(ROOT, "app", "api")).sort()) {
    const url =
      "/" + path.relative(path.join(ROOT, "app"), path.dirname(file)).split(path.sep).join("/");
    routes.set(url, { file: rel(file), answers: answersOf(readFileSync(file, "utf8")) });
  }
  return routes;
}

// ── the files a customer reads ──────────────────────────────────────────────

/** Every markdown file under a directory, recursively. */
function markdown(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) markdown(p, out);
    else if (entry.name.endsWith(".md")) out.push(p);
  }
  return out;
}

/**
 * Everything an agent or an operator reads as instruction — DISCOVERED, so a new
 * skill or doc is covered the day it lands. `references/*.md` are in, and have to
 * be: two of the four sites live in one (`go-live/references/smoke-live.md`).
 *
 * Not blanked the way source is. Markdown is not source, and `blankComments()`
 * would eat a `//` in a prose line.
 */
export function guidanceFiles(): string[] {
  return [
    path.join(ROOT, "README.md"),
    path.join(ROOT, "CLAUDE.md"),
    ...markdown(path.join(ROOT, "docs")),
    ...markdown(path.join(ROOT, ".claude", "skills")),
  ]
    .filter(existsSync)
    .sort();
}

// ── finding a rendered response in real markdown ────────────────────────────

/** A literal shown in a guidance file as the answer of a named route. */
export type Site = {
  file: string;
  line: number;
  route: string;
  /** As the operator would type it — the JSON normalised, a word unwrapped. */
  literal: string;
  /** True when the literal parses as JSON, i.e. it is a body and not a word. */
  json: boolean;
  shape: "arrow" | "verb";
  text: string;
};

/** The span of a balanced `{ … }` starting at index 0, or null. */
function braceSpan(s: string): string | null {
  if (s[0] !== "{") return null;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "{") depth++;
    else if (s[i] === "}" && --depth === 0) return s.slice(0, i + 1);
  }
  return null;
}

/** A word the way markdown writes one: bare, backticked, or double-quoted. */
function wordSpan(s: string): { raw: string; value: string } | null {
  const m = /^(?:`([^`\n]+)`|"([^"\n]+)"|([A-Za-z][\w.-]*))/.exec(s);
  return m ? { raw: m[0], value: m[1] ?? m[2] ?? m[3] } : null;
}

/** Every route mention on a line whose next character ends the path. */
function routesOn(line: string, urls: string[]): { url: string; end: number }[] {
  const found: { url: string; end: number }[] = [];
  for (const url of urls) {
    let at = line.indexOf(url);
    while (at >= 0) {
      const after = line[at + url.length] ?? "";
      // `/api/media` inside `/api/media/upload-url` is not a mention of `/api/media`.
      if (!/[A-Za-z0-9_/-]/.test(after)) found.push({ url, end: at + url.length });
      at = line.indexOf(url, at + 1);
    }
  }
  return found;
}

const ARROW = /(→|-->|->|=>)/;
const VERB = /\b(?:answers?|returns?|responds? with|replies)\b/g;

/**
 * Every place a guidance file RENDERS what a route answers.
 *
 * Two shapes, and each is narrowed by what it can be confused with:
 *
 *  · **arrow** — `https://YOUR-DOMAIN/api/readyz → {"status":"ready"}`. The
 *    literal must be followed by end of line or an opening parenthesis, so
 *    `→ the database` (a pipeline diagram in `docs/setup-mcp.md`) and
 *    `` → `PUT` to the bucket `` are prose and not renderings. A BARE word only
 *    counts inside a fenced code block: in a table `sign in → key (above)` is a
 *    narrative arrow, and reading it as a body is how a guard opens with a wall.
 *  · **verb** — `` `/api/readyz` answers `ready` ``. The literal has to sit
 *    IMMEDIATELY after the verb and be backticked or braced; a path is rejected,
 *    because "`/api/healthz` (the process answers) and `/api/readyz`" would
 *    otherwise read the second route name as the first one's body.
 */
export function renderedSites(routes: Map<string, { answers: RouteAnswer[] }>): Site[] {
  const urls = [...routes.keys()];
  const sites: Site[] = [];

  for (const file of guidanceFiles()) {
    let fenced = false;
    readFileSync(file, "utf8")
      .split(/\r?\n/)
      .forEach((line, i) => {
        if (/^\s*(?:```|~~~)/.test(line)) {
          fenced = !fenced;
          return;
        }
        const push = (route: string, raw: string, value: string, json: boolean, shape: Site["shape"]) =>
          sites.push({ file: rel(file), line: i + 1, route, literal: value, json, shape, text: raw });

        for (const { url, end } of routesOn(line, urls)) {
          const rest = line.slice(end);

          // ── arrow ──────────────────────────────────────────────────────────
          const arrow = ARROW.exec(rest);
          if (arrow) {
            const after = rest.slice(arrow.index + arrow[0].length).replace(/^\s+/, "");
            const brace = braceSpan(after);
            const word = brace ? null : wordSpan(after);
            const raw = brace ?? word?.raw ?? "";
            const tail = raw ? after.slice(raw.length).trim() : "x";
            if (raw && (tail === "" || tail.startsWith("("))) {
              if (brace) {
                // A sketch (`{ ticketId, url }`) does not parse; a literal does.
                try {
                  push(url, brace, JSON.stringify(JSON.parse(brace)), true, "arrow");
                } catch {
                  /* a shape sketch, not a literal — see the header */
                }
              } else if (fenced && word) {
                push(url, word.raw, word.value, false, "arrow");
              }
            }
          }

          // ── verb ───────────────────────────────────────────────────────────
          for (const verb of rest.matchAll(VERB)) {
            const after = rest.slice(verb.index + verb[0].length);
            const m = /^\s*(?:`([^`\n]+)`|(\{[^}\n]*\}))/.exec(after);
            if (!m) continue;
            const value = m[1] ?? m[2];
            if (value.startsWith("/") || /^\d+$/.test(value)) continue; // a path, a status code
            if (m[2]) {
              try {
                push(url, value, JSON.stringify(JSON.parse(value)), true, "verb");
              } catch {
                /* a shape sketch */
              }
            } else {
              push(url, value, value, false, "verb");
            }
          }
        }
      });
  }
  return sites;
}

// ────────────────────────────────────────────────────────────────────────────

const ROUTES = apiRoutes();
const SITES = renderedSites(ROUTES);
const READABLE = (url: string) => (ROUTES.get(url)?.answers.length ?? 0) > 0;

// The one dependency the readiness route has. Module scope on purpose: `vi.mock`
// is hoisted above everything, so a factory closing over a `const` declared
// inside `describe` reads it before it exists — and the ReferenceError lands in
// the `catch`, turning the healthy pass into a 503 that looks like a real one.
const execute = vi.fn();
vi.mock("@/db", () => ({ db: { execute: (...args: unknown[]) => execute(...args) } }));

describe("the readiness route, driven both ways", () => {
  // The measurement the whole file rests on. It is not a claim about the guide;
  // it is the route running, so it cannot go stale while the route changes.
  it("answers two bodies, and the obvious keyword rule cannot tell them apart", async () => {
    const { GET } = await import("@/app/api/readyz/route");

    execute.mockResolvedValueOnce([{ "?column?": 1 }]);
    const up = await GET();
    const upBody = await up.text();

    execute.mockRejectedValueOnce(new Error("connection refused"));
    const down = await GET();
    const downBody = await down.text();

    expect([up.status, upBody]).toEqual([200, '{"status":"ready"}']);
    expect([down.status, downBody]).toEqual([503, '{"status":"not-ready"}']);

    // 🚨 THE FINDING. Both true — an uptime check written on the bare word is
    // green while the database is unreachable, which is the only failure it was
    // created to see.
    expect(
      [upBody.includes("ready"), downBody.includes("ready")],
      'the bare word "ready" must match BOTH bodies — if this ever stops being ' +
        "true the trap is gone and the warnings in docs/DEPLOY.md, go-live and " +
        "setup-hosting can be re-read rather than copied forward",
    ).toEqual([true, true]);

    // …and the rule the three documents hand over instead, which can.
    expect([
      upBody.includes('"status":"ready"'),
      downBody.includes('"status":"ready"'),
    ]).toEqual([true, false]);
  });
});

describe("route response literals in the guidance", () => {
  it("reads routes, files and sites — none of the three may be zero", () => {
    // A zero anywhere here is a broken reader reporting a clean tree.
    expect(ROUTES.size).toBeGreaterThan(0);
    expect(guidanceFiles().length).toBeGreaterThan(0);
    expect(SITES.length).toBeGreaterThan(0);

    // The needle probe: the extractor really reads a body out of real source,
    // and both shapes of the trap are present. Written out, because "some route
    // had some answer" is the assertion that passes on a broken parser.
    expect(ROUTES.get("/api/readyz")?.answers).toEqual([
      { status: 200, body: '{"status":"ready"}' },
      { status: 503, body: '{"status":"not-ready"}' },
    ]);
    expect(ROUTES.get("/api/healthz")?.answers).toEqual([{ status: 200, body: '{"status":"ok"}' }]);

    // …and the reader really finds a rendering in real markdown. These four are
    // the sites of the day; the list is a floor, not a ceiling — a fifth site is
    // welcome, a missing one means the reader went blind.
    const seen = SITES.map((s) => `${s.file}:${s.route}`);
    for (const expected of [
      "docs/DEPLOY.md:/api/readyz",
      "docs/DEPLOY.md:/api/healthz",
      ".claude/skills/go-live/references/smoke-live.md:/api/readyz",
      ".claude/skills/setup-hosting/SKILL.md:/api/readyz",
    ])
      expect(seen, `the reader no longer finds the rendering in ${expected}`).toContain(expected);
  });

  it("shows no bare word where the route answers a JSON object", () => {
    const bare = SITES.filter((s) => !s.json && READABLE(s.route)).map(
      (s) =>
        `${s.file}:${s.line} shows ${JSON.stringify(s.text)} for ${s.route}, which answers ` +
        `${ROUTES.get(s.route)!.answers.map((a) => a.body).join(" / ")}`,
    );

    expect(
      bare,
      "a guidance file renders a route's answer as a bare word while the route " +
        "sends a JSON object. An operator copies that word into an uptime check's " +
        'keyword field. Show the whole body with its quotes — `"status":"ready"` — ' +
        "and say which way round the rule points",
    ).toEqual([]);
  });

  it("quotes only bodies the route really sends", () => {
    const wrong = SITES.filter((s) => s.json && READABLE(s.route))
      .filter((s) => !ROUTES.get(s.route)!.answers.some((a) => a.body === s.literal))
      .map(
        (s) =>
          `${s.file}:${s.line} quotes ${s.literal} for ${s.route}, which answers ` +
          `${ROUTES.get(s.route)!.answers.map((a) => `${a.status} ${a.body}`).join(" / ")}`,
      );

    expect(
      wrong,
      "a body printed in the guide is not a body that route sends. The source in " +
        "app/api/ wins; fix the document, not this test",
    ).toEqual([]);
  });

  it("hands over no literal that also matches the same route's other answers", () => {
    // The second defect, and the real one here: `ready` is syntactically fine and
    // still useless, because it matches the failure body too. A literal is only a
    // usable keyword when it appears in ONE of a route's answers.
    const ambiguous = SITES.filter((s) => READABLE(s.route)).flatMap((s) =>
      ROUTES.get(s.route)!
        .answers.filter((a) => a.body !== s.literal && a.body.includes(s.literal))
        .map(
          (a) =>
            `${s.file}:${s.line} offers ${JSON.stringify(s.literal)} for ${s.route}, but its ` +
            `${a.status} answer ${a.body} contains it too — a keyword check on it passes ` +
            "on the very failure it exists to catch",
        ),
    );

    expect(ambiguous, "an ambiguous keyword handed to an operator").toEqual([]);
  });

  it("treats a literal shown for a route it cannot read as undecided, not as a pass", () => {
    // `Response.json(payload)` yields no literal, so nothing here could compare a
    // rendering against it. Empty today; when it stops being empty somebody has
    // to judge that site by hand rather than inherit a silent green.
    const undecided = SITES.filter((s) => !READABLE(s.route)).map(
      (s) => `${s.file}:${s.line} renders ${JSON.stringify(s.text)} for ${s.route}`,
    );

    expect(
      undecided,
      "this guard cannot read that route's answers out of its source, so it can " +
        "neither confirm nor refute the rendering. Read the handler and decide",
    ).toEqual([]);
  });

  it("names the trap and the alarm direction wherever it hands over a confusable body", () => {
    // A CONFUSABLE route is one where a VALUE of one answer sits inside a value
    // of another — derived, not listed, so a second route of this shape is
    // covered the day it appears. 🚨 Measured on the bodies it is not visible:
    // `{"status":"not-ready"}` does not contain `{"status":"ready"}`. The trap
    // lives one level down, in the words an operator actually types. Today
    // exactly one route qualifies, and its three documents are the three that
    // carried the defect.
    const values = (body: string): string[] =>
      Object.values(JSON.parse(body) as Record<string, unknown>).filter(
        (v): v is string => typeof v === "string",
      );
    const confusable = new Set(
      [...ROUTES]
        .filter(([, r]) =>
          r.answers.some((a, i) =>
            r.answers.some(
              (b, j) =>
                i !== j &&
                values(b.body).some((w) => values(a.body).some((v) => v !== w && w.includes(v))),
            ),
          ),
        )
        .map(([url]) => url),
    );
    expect(confusable, "the trap is derived, not assumed").toContain("/api/readyz");

    const files = [...new Set(SITES.filter((s) => confusable.has(s.route)).map((s) => s.file))];
    expect(files.length, "no document renders a confusable route — the reader went blind").toBeGreaterThan(0);

    // Two halves, and the second is scoped to a PARAGRAPH on purpose. Measured:
    // file-wide, `setup-hosting` step 9 satisfies "names the direction" out of a
    // sentence twenty lines further down about a log line — *"its absence means
    // the app is not the one answering"*. A guard a stranger's sentence can
    // satisfy is green for the wrong reason, so the polarity word has to stand in
    // the same paragraph as the word `keyword`, which is the field it is about.
    const silent = files.filter((f) => {
      const text = readFileSync(path.join(ROOT, f), "utf8");
      const namesTheTrap = /substring/i.test(text);
      const namesTheDirection = text
        .split(/\n\s*\n/)
        .some((para) => /absen(t|ce)|not present/i.test(para) && /keyword/i.test(para));
      return !namesTheTrap || !namesTheDirection;
    });

    expect(
      silent,
      "this document hands an operator the body of a route whose answers contain " +
        "one another, without naming the trap (the word `substring`) AND the " +
        "direction the alarm points (`absent`). Both halves are the defect: the " +
        "bare word matches the failure body, and the polarity chosen the wrong way " +
        "round is a check that is green exactly while the app is down",
    ).toEqual([]);
  });
});
