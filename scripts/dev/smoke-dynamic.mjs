// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The half of `smoke` that calls a route with a real record behind it.
//
// ── What was missing, and why it was the expensive omission ─────────────────
// `smoke` finds its pages under `app/` and skips every dynamic segment, because
// there is no id to put in one. Honest, written down in `CLAUDE.md`, and it
// left `/api/media/[id]` — the route that decides whether a PRIVATE FILE is
// handed out — called by no run that has ever existed (Retro-Action A15).
//
// ── 🚨 The interesting case is the PAIR, never the 200 ──────────────────────
// "The owner gets 200" measures nothing: a route that answered 200 to EVERYBODY
// gives the same green. So this asks the same URL twice — once with the session
// that owns the item, once with no session at all — and the finding is a
// DIFFERENCE, not a status code. The defect it exists for is the one where both
// answers are the same.
//
// `mayAccess()` before `mediaUrlFor()` is `CLAUDE.md` → **Media**, and
// `lib/media/manage.ts` has the unit tests for it. This is the other question:
// does the route as it is DEPLOYED, with a real session, a real row and a real
// store behind it, still refuse the stranger. A test of `mayAccess()` as a
// function measures our own assumption about who calls it.
//
// ── What the run does NOT do, and says so ──────────────────────────────────
// Every dynamic route the walk finds and this file cannot exercise is printed
// with the reason. 🚨 `smoke` exists to keep "green because it checked" and
// "green because it skipped" apart; a silent skip here would be the same
// confusion one level down.
//
// Plain Node, no bundler, no TypeScript, no dependency — Linux, macOS and Git
// Bash on Windows (CLAUDE.md, "Three systems").
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { collectDynamicApiRoutes } from "./api-routes.mjs";

/** The route this file knows how to put a real record behind. */
export const PROBED_ROUTE = "/api/media/[id]";

/**
 * Every OTHER dynamic route, and why no run calls it.
 *
 * 🚨 This is a table of REASONS, not a list of routes to check — the routes
 * come from the walk. A route that is not in here is not silently exempt: it is
 * printed as "not exercised, and nobody has said why", which is a sentence
 * somebody eventually gets tired of reading. That is the intended pressure, and
 * it is deliberately not a failure: `smoke` is what a customer runs after a
 * 500, and a customer's own new route must never turn this command red for a
 * reason that has nothing to do with a broken page.
 */
export const NOT_EXERCISED = [
  {
    route: "/api/auth/[...nextauth]",
    why:
      "NextAuth's own handler, and the one dynamic route every run already " +
      "depends on: the sign-in below goes through it, so a broken one shows up " +
      "as a second pass that never happened",
  },
  {
    route: "/api/knowledge-media/[...path]",
    why:
      "the path IS the identity — there is no row to plant, only a file in " +
      "content/knowledge-media/, and a fresh app has none. `node run.mjs " +
      "kb-check` is what verifies those references",
  },
  {
    route: "/api/v1/media/[id]",
    why:
      "the same pipeline behind a BEARER key rather than a cookie, and smoke " +
      "holds no API key. `node run.mjs module list` says whether this app has " +
      "the api module at all",
  },
  // The five a MODULE contributes to the v1 surface. Every one of them is
  // behind the same bearer key smoke does not hold, so none can be exercised
  // here — and `node run.mjs api-check --live` is the command that does mint a
  // key and really call the surface. The reasons are separate rather than one
  // shared sentence because the second half differs per route: what a run would
  // have to plant before the call could mean anything.
  {
    route: "/api/v1/courses/[course]",
    why:
      "a bearer-key route, and smoke holds no API key — and the segment names " +
      "a COURSE, which a fresh app has none of until `content-apply` runs. The " +
      "index one level up (`/api/v1/courses`) is not dynamic and IS swept: it " +
      "answers the empty list, which is the honest answer for a pristine app",
  },
  {
    route: "/api/v1/courses/units/[slug]",
    why:
      "a bearer-key route, and smoke holds no API key. It would also need a " +
      "course: a fresh app's `courses_units` is empty until `content-apply` " +
      "runs, so the slug would name nothing. `node run.mjs courses-check` is " +
      "what reads the course itself",
  },
  {
    route: "/api/v1/courses/units/[slug]/completion",
    why:
      "a bearer-key route with WRITE scope — smoke holds no key at all, let " +
      "alone a writing one, and a tick against a lesson that does not exist " +
      "would prove nothing about the one that will",
  },
  {
    route: "/api/v1/courses/units/[slug]/submission",
    why:
      "a bearer-key route with WRITE scope, and it needs more than a key: a " +
      "hand-in belongs to a workshop-shaped course with a task prompt on the " +
      "lesson, which a pristine app has not got",
  },
  {
    route: "/api/v1/community/discussions/[id]",
    why:
      "a bearer-key route, and rooms are ROWS: a fresh app has no group and no " +
      "discussion to name, because a room made on a laptop does not travel " +
      "with a deploy (docs/community.md)",
  },
  {
    route: "/api/v1/community/discussions/[id]/posts",
    why:
      "a bearer-key route with WRITE scope, into a discussion a pristine app " +
      "does not have — and writing would additionally need a display name on " +
      "the account, which is the community's own precondition for posting",
  },
];

/** A 1×1 PNG, 70 bytes — the smallest thing the upload door will accept. */
const PIXEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/**
 * Where the planted item's id is remembered, so a machine ends up with ONE of
 * them rather than one per run.
 *
 * `.dev/` is where this app keeps session artifacts, and the memo is keyed by
 * the app's address because two apps on one machine are two databases. A memo
 * pointing at a row that is gone (a `db-reset`, a different app on the same
 * port) is not an error: the owner's own fetch answers 404, and the run plants
 * a new one.
 */
const MEMO = ".dev/smoke-media.json";

function readMemo(root, baseUrl) {
  try {
    const memo = JSON.parse(readFileSync(join(root, MEMO), "utf8"));
    return typeof memo?.[baseUrl] === "string" ? memo[baseUrl] : null;
  } catch {
    return null;
  }
}

function writeMemo(root, baseUrl, id) {
  const file = join(root, MEMO);
  let memo = {};
  try {
    memo = JSON.parse(readFileSync(file, "utf8")) ?? {};
  } catch {
    memo = {};
  }
  memo[baseUrl] = id;
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(memo, null, 2)}\n`);
  } catch {
    // A read-only tree is not a reason to fail the sweep; the next run just
    // plants again.
  }
}

/**
 * Put one private item into the running app, through its OWN upload door.
 *
 * Not through the database, deliberately: the row a customer's app really has
 * is the row `POST /api/media` writes — same visibility (`owner`, the only one
 * that door hands out), same owner binding, same bytes on the same store. A row
 * inserted beside the app would be a fixture measuring a pipeline nobody uses.
 *
 * @returns {Promise<{id: string, sha256: string} | {reason: string}>}
 */
async function plantItem({ baseUrl, cookie, bytes }) {
  const form = new FormData();
  form.set("file", new Blob([bytes], { type: "image/png" }), "smoke-pixel.png");
  // An image without alt text is refused (`altRequired`, `lib/media/rules.ts`),
  // and rightly — the door a customer's form posts to has the same rule, so a
  // plant that skipped it would be measuring a door this app does not have.
  form.set("alt", "smoke test pixel");
  let answer;
  try {
    answer = await fetch(`${baseUrl}/api/media`, { method: "POST", headers: { cookie }, body: form });
  } catch (error) {
    return { reason: `the upload door is not reachable: ${error.message}` };
  }
  if (answer.status !== 201) {
    let detail = "";
    try {
      const body = await answer.json();
      detail = body?.error ? ` (${body.error}${body.detail ? `: ${body.detail}` : ""})` : "";
    } catch {
      /* a non-JSON body says nothing more than the status already did */
    }
    // Every one of these is a real state of a real app — media switched off in
    // `config/media.json`, a store the app cannot write to, an hourly ceiling
    // already spent — and none of them is a defect in the route below.
    return {
      reason:
        `POST /api/media answered ${answer.status}${detail}, so there is no item to ask about. ` +
        `What the media layer can and cannot do here: node run.mjs media-check`,
    };
  }
  const body = await answer.json();
  if (typeof body?.id !== "string") {
    return { reason: "POST /api/media answered 201 without an id" };
  }
  return { id: body.id, sha256: createHash("sha256").update(bytes).digest("hex") };
}

/** One call, reduced to what the judgement below needs. */
async function ask(url, cookie) {
  try {
    const answer = await fetch(url, {
      redirect: "manual",
      headers: cookie ? { cookie } : undefined,
    });
    const bytes = Buffer.from(await answer.arrayBuffer());
    return {
      status: answer.status,
      location: answer.headers.get("location") ?? "",
      sha256: createHash("sha256").update(bytes).digest("hex"),
      length: bytes.length,
    };
  } catch (error) {
    return { status: 0, location: "", sha256: "", length: 0, error: error.message };
  }
}

/**
 * The judgement, as a pure function — the half worth testing without a server.
 *
 * `entitled` is the session that owns the item, `stranger` is nobody at all.
 * What each may see is `mayAccess()` (`lib/media/manage.ts`) and the refusal
 * semantics are `lib/media/deliver.ts`: **404, never 403**, so that an item
 * somebody may not have is indistinguishable from one that is not there.
 *
 * @returns {{failures: number, lines: string[]}}
 */
export function judgePair({ route, id, entitled, stranger, sha256 }) {
  const lines = [];
  let failures = 0;
  const where = `${route} → ${id}`;

  const delivered =
    entitled.status === 200 || (entitled.status >= 300 && entitled.status < 400);
  const toLogin = /\/login(\?|$)/.test(entitled.location);

  if (entitled.status === 0) {
    failures++;
    lines.push(`  ✗ ---  ${where} — not reachable for the owner: ${entitled.error}`);
  } else if (toLogin) {
    failures++;
    lines.push(`  ✗ ${entitled.status}  ${where} — the owner was sent to /login; the session did not take`);
  } else if (!delivered) {
    failures++;
    lines.push(
      `  ✗ ${entitled.status}  ${where} — the owner of this file did not get it. ` +
        `A 404 here means the row, the store or mayAccess() disagrees with the upload that just wrote it`,
    );
  } else if (entitled.status === 200 && sha256 && entitled.sha256 !== sha256) {
    // A 200 is not proof that the right bytes came back — the same sentence
    // `smoke` makes about a page that renders wrong at 200.
    failures++;
    lines.push(
      `  ✗ 200  ${where} — the owner got ${entitled.length} byte(s), but not the file that was uploaded`,
    );
  }

  // 🚨 The half the whole probe exists for. Anything but a 404 here is a
  // private file reaching somebody with no session.
  if (stranger.status === 404) {
    if (failures === 0) {
      lines.push(
        `  ✓ ${entitled.status}/404  ${where} — the owner gets the file` +
          `${entitled.status === 200 ? " (bytes compared)" : " (signed redirect)"}, ` +
          `a caller with no session gets 404`,
      );
    }
  } else if (stranger.status === 0) {
    failures++;
    lines.push(`  ✗ ---  ${where} — not reachable without a session: ${stranger.error}`);
  } else {
    failures++;
    lines.push(
      `  ✗ ${stranger.status}  ${where} — 🚨 a PRIVATE file was handed to a caller with NO session. ` +
        `Every non-public item is authorised by mayAccess() before mediaUrlFor() ` +
        `(CLAUDE.md → Media); this route answered ${stranger.status}` +
        `${stranger.location ? ` → ${stranger.location}` : ""} instead of 404`,
    );
  }

  return { failures, lines };
}

/**
 * The whole pass: what the walk found, what was exercised, and what was not.
 *
 * `plant` is `true` only where writing a row is this run's business — see the
 * caller. Everything else about the outcome is printed, including a count, so
 * that "one route checked" and "no route checked" can never read alike.
 *
 * @returns {Promise<number>} failures
 */
export async function runDynamicRoutes({ baseUrl, cookie, plant, plantReason, root = process.cwd() }) {
  const routes = collectDynamicApiRoutes({ cwd: root });

  // 🚨 A count guard, not a formality. Every app built on this template has at
  // least NextAuth's handler, so an empty walk is a broken walk — and it would
  // otherwise print "0 dynamic route(s), all accounted for" in green.
  if (routes.length === 0) {
    console.log(
      "\n  ✗ No dynamic API route found under app/api — the walk is broken, not the tree.\n" +
        "     Every app has at least the sign-in handler. Nothing below was checked.",
    );
    return 1;
  }

  console.log(`\nDynamic API routes — ${routes.length} found:\n`);

  let failures = 0;
  let exercised = 0;

  if (routes.includes(PROBED_ROUTE)) {
    const result = await probeMediaPair({ baseUrl, cookie, plant, plantReason, root });
    failures += result.failures;
    if (result.exercised) exercised++;
    for (const line of result.lines) console.log(line);
  }

  for (const route of routes) {
    if (route === PROBED_ROUTE) continue;
    const known = NOT_EXERCISED.find((entry) => entry.route === route);
    console.log(
      known
        ? `  ·  ${route} — NOT exercised: ${known.why}`
        : `  ·  ${route} — NOT exercised, and nobody has said why. If it can be given a real ` +
          `record, teach scripts/dev/smoke-dynamic.mjs how; if it cannot, put the reason there`,
    );
  }

  console.log(
    `\n  ${exercised} of ${routes.length} dynamic API route(s) exercised, ` +
      `${routes.length - exercised} named with a reason.`,
  );

  return failures;
}

/**
 * `/api/media/[id]`, both ways round.
 *
 * @returns {Promise<{failures: number, exercised: boolean, lines: string[]}>}
 */
async function probeMediaPair({ baseUrl, cookie, plant, plantReason, root }) {
  if (!plant) {
    return {
      failures: 0,
      exercised: false,
      lines: [`  ·  ${PROBED_ROUTE} — NOT exercised: ${plantReason}`],
    };
  }

  const bytes = Buffer.from(PIXEL_PNG_BASE64, "base64");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const lines = [];

  // The memo first: one item per app rather than one per run.
  let id = readMemo(root, baseUrl);
  let entitled = id ? await ask(`${baseUrl}/api/media/${id}`, cookie) : null;

  if (!entitled || entitled.status === 404) {
    const planted = await plantItem({ baseUrl, cookie, bytes });
    if (planted.reason) {
      return {
        failures: 0,
        exercised: false,
        lines: [`  ·  ${PROBED_ROUTE} — NOT exercised: ${planted.reason}`],
      };
    }
    id = planted.id;
    writeMemo(root, baseUrl, id);
    lines.push(
      `  ·  planted one 70-byte private item through POST /api/media — it is reused by later runs`,
    );
    entitled = await ask(`${baseUrl}/api/media/${id}`, cookie);
  }

  // `lib/media/deliver.ts` answers 503 for a store it cannot use, on purpose:
  // that is a fact about the APP, not about any item, and it is the one status
  // this pair cannot be judged through. Said, never counted as a pass.
  if (entitled.status === 503) {
    return {
      failures: 0,
      exercised: false,
      lines: [
        `  ·  ${PROBED_ROUTE} — NOT exercised: the media store answered 503, so nothing ` +
          `can be delivered to anybody. What it can and cannot do: node run.mjs media-check`,
      ],
    };
  }

  const stranger = await ask(`${baseUrl}/api/media/${id}`, "");
  const verdict = judgePair({ route: PROBED_ROUTE, id, entitled, stranger, sha256 });
  return { failures: verdict.failures, exercised: true, lines: [...lines, ...verdict.lines] };
}
