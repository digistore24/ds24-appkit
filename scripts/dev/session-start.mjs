// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Greeting when a session starts in this project.
//
// It lives here and not under any one program's folder because three of the four
// invoke it: .claude/settings.json, .codex/hooks.json and
// .opencode/plugins/session-start.js all point at this file, and
// `node run.mjs greet` runs it by hand when a hook did not fire — or, in
// Antigravity CLI, which has no session-start event at all, every time.
// Whatever lands
// on stdout is what the user sees in the terminal — and the agent gets it as
// context. So: keep it short, say concretely what to do next.
//
// Node and not bash, like everything else that has to run on Linux, macOS and
// Windows alike (CLAUDE.md → Three systems). This one matters more than most:
// it is the very first thing anybody sees in this project.
//
// And exactly there is the one thing this file cannot do: it is started WITH
// `node`, so on a machine that has none it does not run, prints nothing, and
// "nothing" reads like "all fine". That is why each config carries a second,
// tiny hook in front of this one — three words of shell asking whether `node`
// exists at all. It is the one check that cannot be written here, and
// CLAUDE.md → Three systems says so out loud.
//
// Note: when a freshly cloned project is opened for the first time, most of
// these programs ask whether they should trust the folder. Only after that does
// the greeting run.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { approvalReport, describeApproval } from "../ds24/_approval.mjs";
import { blockers, inspect } from "./doctor.mjs";
import { describeUnwritten, readNotes, unwrittenItems } from "./app-notes.mjs";
import { JOB_IDS } from "../../lib/cron/ids.mjs";
import { canOpenBrowser } from "../lib/proc.mjs";
import { PHASES, journeyFacts, journeyState } from "./journey.mjs";
import { describeJourneyLine } from "./journey-render.mjs";
import { describeOperations, operationalFacts } from "./operations.mjs";
import { readStamp, stampValid, verifiedOn } from "./setup-stamp.mjs";
import {
  moduleCronJobs,
  moduleNavAreas,
  moduleTablePrefixes,
} from "../modules/inventory.mjs";
import { describe as describeUpdate, updateAvailable } from "./update-check.mjs";

const hasEnv = existsSync(".env");
const hasBrief = existsSync("docs/product-brief.md");

// Is this machine ready to work in? Only the cheap half of the checklist runs
// here — file lookups and one TCP connect. The full `node run.mjs doctor` asks
// the Docker daemon, which takes seconds, and this hook sits in front of EVERY
// session. A slow greeting would be paid for on every single start, to answer a
// question that is only interesting on the first few.
//
// Never fatal: a hook that throws greets the user with a stack trace, and the
// one situation this exists for — a half-set-up project — is exactly where
// something is most likely to be missing.
let blocked = [];
try {
  blocked = blockers(await inspect({ quick: true }));
} catch {
  /* then we simply say nothing about the setup */
}

// Has an app of their own already been built? A rough, but reliable indicator:
// own pages below app/dashboard/ beyond the ones that ship with the template.
//
// This list has to match what is actually in app/dashboard/, and it silently
// stops doing so the moment somebody adds a page here — the count then never
// reaches 0 and every first-time user is greeted with "carry on with what?"
// instead of the one line the whole README points at ("Build my app").
//
// That is not hypothetical: `community` shipped without being added here, and
// for as long as it was missing EVERY fresh app counted one page of its own and
// was greeted as a project already under way. `scripts/session-start.test.ts`
// could not catch it — it ships inside the customer's app, so it can only ask
// "does this list name something that is gone", never "is something here the
// list does not name" (an app with more pages than the template is the
// product, not a fault). The other direction is asked in the FACTORY, by
// `scripts/shipped-lists.test.mjs` in the source repo, where template/ is
// pristine by construction.
const SHIPPED = new Set(["account", "admin", "billing", "chat"]);
// Plus whatever an installed module brought. A module joins this list by
// declaring `navAreas` in its manifest — the fix for the CLASS of fault the
// community caused by not joining it at all, rather than for the instance.
//
// ⚠️ Added afterwards rather than spread into the literal, and that is not
// style: `scripts/session-start.test.ts` and the factory's
// `scripts/shipped-lists.test.mjs` both read this Set as TEXT, with a regex
// that stops at the first `]`. A spread would put a bracket inside the literal
// and quietly blind both of them.
for (const area of moduleNavAreas()) SHIPPED.add(area);

/**
 * Is this folder a module's parking spot rather than somebody's page?
 *
 * 🚨 **Asked, not listed, and that is the whole point of this function.**
 * `"community"` used to be a fifth entry in the literal above, from the time the
 * community was core. It is a module now, and the folder that stayed behind
 * holds nothing but one-line `page.<id>.tsx` declarations — Next scans `app/`
 * and nothing else, so a module's routes have to live there physically
 * (`scripts/modules/page-extensions.mjs`).
 *
 * The hard-coded entry gave the right answer for the wrong reason, and only for
 * the module somebody had thought of: with the module UNINSTALLED the folder is
 * still on disk, so the next module to park a `/dashboard/…` area would have had
 * its folder announced to the customer as a page they built and forgot to write
 * down. `moduleNavAreas()` does not cover it either — that reads the manifests of
 * INSTALLED modules, and this is exactly the uninstalled case.
 *
 * So the question is asked of the folder: a route file with no module suffix
 * (`page.tsx`) is somebody's page; only module-suffixed ones and nothing else is
 * a parking spot. A customer who builds their own `app/dashboard/community/page.tsx`
 * in an app without the module therefore still gets told about it.
 */
function isModuleParkingSpot(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  let suffixed = 0;
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (isModuleParkingSpot(`${dir}/${entry.name}`)) suffixed++;
      continue;
    }
    if (/^(?:page|route|layout)\.tsx?$/.test(entry.name)) return false;
    if (/^(?:page|route|layout)\.[a-z0-9-]+\.tsx?$/.test(entry.name) && !entry.name.includes(".test."))
      suffixed++;
  }
  return suffixed > 0;
}

let ownPages = [];
try {
  ownPages = readdirSync("app/dashboard", { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !SHIPPED.has(entry.name))
    .filter((entry) => !isModuleParkingSpot(`app/dashboard/${entry.name}`))
    .map((entry) => entry.name);
} catch {
  /* no dashboard folder yet — then there is nothing of their own either */
}
const customPages = ownPages.length;

// Is there an app here yet, or is this still the untouched template? Named once
// and used twice — the greeting's own beginner/carry-on fork below, and the
// operational line's decision not to nag about a security check nobody could
// have run on an app nobody has built. Two derivations of one question is how
// the two eventually disagree.
const appUnderWay = customPages > 0 || hasBrief;

// ── The rest of the inventory ─────────────────────────────────────────────
// A page is the artefact hardest to forget — somebody clicks it. A scheduled
// job, a table and a page area outside the dashboard are the ones a later
// session cannot see, and therefore builds again. All three are sync reads of
// files this project has anyway.
//
// Every list below is one-directional, exactly like SHIPPED above and for the
// same reason (scripts/session-start.test.ts spells it out): these tests ship
// inside the customer's app, so "the template grew something the list does not
// know" can be checked here, while "the app has more than the list" is the
// normal state of every app ever built on this template.
const SHIPPED_AREAS = new Set([
  "account",
  "api",
  "dashboard",
  "datenschutz",
  "ds24-connected",
  "impressum",
  "login",
  "optin",
  "plans",
]);
const SHIPPED_TABLES = new Set([
  "accounts",
  "ai_usage",
  "buy_url_cache",
  "chat_messages",
  "consent_records",
  "cron_runs",
  "email_changes",
  "grants",
  "impersonations",
  "invoices",
  "ipn_events",
  "media",
  "media_uploads",
  "notification_sends",
  "orders",
  "sessions",
  "setup_audit",
  "setup_confirmations",
  "setup_keys",
  "subscriptions",
  "token_accounts",
  "token_ledger",
  "users",
  "verificationTokens",
]);
// An installed module's tables are matched by PREFIX, from its manifest's
// `tablePrefix` — never listed by name, and that is a decision rather than a
// shortcut. `modules/community/lib/dm-guard.test.ts` fails the build on any
// file outside a short allowlist that so much as NAMES
// `community_conversations`, `community_messages` or `community_member_blocks`,
// because a file that cannot name a table cannot read it. A greeting script has
// no business on that allowlist: joining it would make this file one that MAY
// name them for ever, and the erosion that follows is a query somebody adds
// here three years from now with no test left to object.
//
// A prefix is also truer than a list: it covers the tables a module gains
// later, which a list would not.
//
// ⚠️ This constant used to be seeded with a hard-coded `"community_"`, because
// the community's twelve tables shipped in every app whether or not anybody
// switched them on — so without the rule every app was told it had built them
// itself. The community is a MODULE now: an app that did not install it has no
// such table, and one that did contributes the prefix through the manifest like
// every other module. A hard-coded entry here would excuse a prefix nothing
// matches, which is how a list starts lying quietly;
// `scripts/shipped-lists.test.mjs` in the factory fails on exactly that.
const SHIPPED_TABLE_PREFIXES = [...moduleTablePrefixes()];

const SHIPPED_JOBS = new Set([
  "prune-ai-usage",
  "prune-ipn-log",
  "close-impersonations",
  "prune-impersonations",
  "check-stuck-reloads",
  "prune-setup-audit",
  "prune-abandoned-uploads",
  "check-advisories",
  "ops-watchdog",
]);
// A scheduled job a module registers is the template's, not the customer's.
for (const job of moduleCronJobs()) SHIPPED_JOBS.add(job);

/** Page areas of their own outside the dashboard — `app/coaching/`, say. */
let ownAreas = [];
try {
  ownAreas = readdirSync("app", { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !SHIPPED_AREAS.has(entry.name))
    // Route groups and private folders are not areas anybody would write an
    // entry about; `_components` is where somebody puts a helper.
    .filter((entry) => !entry.name.startsWith("(") && !entry.name.startsWith("_"))
    // 🚨 The same question the dashboard walk above asks, one directory level
    // up — and it has to be asked in BOTH places or the fix is half a fix. A
    // manifest may declare a TOP-LEVEL subtree (`"app": ["coaching"]`; the api
    // module's `api/v1` only nests under an existing entry by luck), and such a
    // folder sits under `app/` whether or not the module is installed. Without
    // this, the greeting would announce it to the customer as a page area they
    // built and forgot to write down — the exact sentence `isModuleParkingSpot()`
    // exists to prevent, missed by one level.
    .filter((entry) => !isModuleParkingSpot(`app/${entry.name}`))
    .map((entry) => entry.name);
} catch {
  /* no app/ folder — then this is not the app we think it is */
}

/** Tables of their own. Read as text: importing db/ would pull in the driver. */
let ownTables = [];
try {
  const found = new Set();
  for (const file of readdirSync("db")) {
    if (!file.startsWith("schema") || !file.endsWith(".ts") || file.includes(".test.")) continue;
    const source = readFileSync(`db/${file}`, "utf8");
    // The name as Postgres knows it, which is also the name a migration and a
    // raw query use — `pgTable(\n  "verificationTokens",` counts too.
    for (const match of source.matchAll(/pgTable\(\s*"([A-Za-z0-9_]+)"/g)) found.add(match[1]);
  }
  ownTables = [...found].filter(
    (name) =>
      !SHIPPED_TABLES.has(name) && !SHIPPED_TABLE_PREFIXES.some((p) => name.startsWith(p)),
  );
} catch {
  /* no db/ folder, or unreadable — say nothing rather than guess */
}

/** Jobs of their own — JOB_IDS is the registry the app itself runs on. */
const ownJobs = JOB_IDS.filter((id) => !SHIPPED_JOBS.has(id));

// Is what they built written down? `docs/app.md` is this app's own notebook, and
// the next session's only source for what the last one did — see
// scripts/dev/app-notes.mjs for why this is asked by content and not by date.
const unwritten = unwrittenItems(
  [
    ...ownPages.map((name) => ({ kind: "page", name })),
    ...ownAreas.map((name) => ({ kind: "page", name })),
    ...ownTables.map((name) => ({ kind: "table", name })),
    ...ownJobs.map((name) => ({ kind: "job", name })),
  ],
  readNotes((file) => readFileSync(file, "utf8")),
);

// Has this machine ever been through the full checklist? The quick checks above
// answer "is something obviously missing"; this answers "did anybody ever look",
// which is a different question and the one that decides whether `build-app` has
// to run `doctor` itself (scripts/dev/setup-stamp.mjs).
const stamp = readStamp();
const verifiedDay = stampValid(stamp) ? verifiedOn(stamp) : "";

// What is open about RUNNING this app — read, never measured. One synchronous
// read of one small JSON file that `node run.mjs security-check` already wrote,
// so it belongs up here beside `readStamp()` and deliberately NOT in the
// `Promise.all` below: that one is for the two calls that reach a network, and a
// promise added there is a promise somebody later awaits in sequence.
//
// Wrapped like `blockers()` above, and for the same reason: a hook that throws
// greets somebody with a stack trace instead of a greeting. Every failure path
// in scripts/dev/operations.mjs already resolves to "say nothing"; this is the
// belt to that pair of braces.
let operationsLine = "";
try {
  operationsLine = describeOperations(operationalFacts({ appUnderWay }));
} catch {
  /* then we simply say nothing about what is open */
}

// Where this project stands on the path — READ from scripts/dev/journey.mjs, the
// one machine-readable original, and never restated here.
//
// 🚨 **This is the fix for a measured drift bug, and the fix is deletion.** This
// file used to print the path as one hand-typed arrow chain, and that chain
// omitted `operate` — the phase that begins the day the app goes live and does
// not end was missing from the one line every session reads, while CLAUDE.md, the
// README and `coach` all had it. No gate could see it: four prose tellings of one
// list, each internally consistent, and prose cannot be held against prose. So
// the chain is gone rather than corrected, and **after this change there is no
// list of steps in this file that anybody CAN forget to update.**
//
// ⚠️ Unlike `[Operations: …]` and `[Machine: …]`, which speak only when there is
// something to say, `[Journey: …]` prints EVERY time. That asymmetry is
// deliberate and it has an argument: it answers the most common question in this
// project, and it REPLACES a line that already printed every time. It cannot
// grow — one phase, one next step, one count, the command — and a declined row
// never appears in it. Anything more is `node run.mjs journey`.
//
// Wrapped like the two above: a hook that throws greets somebody with a stack
// trace. `journeyFacts()` treats a missing file as a fact rather than an error,
// so this is the belt to those braces.
let journeyLine = "";
let journeyPhase = null;
try {
  const state = journeyState(journeyFacts());
  journeyPhase = PHASES.find((phase) => phase.id === state.currentPhase) ?? null;
  journeyLine = describeJourneyLine(state);
} catch {
  /* then the greeting says nothing about the path, and nothing about it lies */
}

/**
 * The phase list the greeting prints — derived from `PHASES`, never typed.
 *
 * `1 Plan   2 Build   3 Go live   4 Run it`. A phase added to the path appears
 * here the day it lands, and a phase renamed cannot end up with two names in two
 * files. The unnumbered two are not the path: one comes before it and one runs
 * alongside all of it (`journey.mjs` argues that where the numbers are decided).
 */
const phaseNames = (separator) =>
  PHASES.filter((phase) => phase.num !== null)
    .map((phase) => `${phase.num} ${phase.title.en}`)
    .join(separator);

// Two questions that may cost a request, and neither depends on the other:
//
//   Has the template been improved since this app was copied out of it? Asked
//   at most once a day — scripts/dev/update-check.mjs, including how to switch
//   it off.
//   Are the synced Digistore24 products approved for sale yet? Same shape, one
//   listProducts call a day at most — scripts/ds24/_approval.mjs.
//
// **Together, not one after the other.** Awaited in sequence they add up to
// 5.5 s of dead air in front of every session on a network that blackholes
// instead of refusing — in the file whose own header says to keep it short.
// The `.catch` on each is belt and braces: both are written never to reject,
// and if that ever stops being true a rejected promise here would take the
// whole greeting with it, which is the one thing this file must not do.
const [updateResult, approvalResult] = await Promise.all([
  updateAvailable().catch(() => null),
  approvalReport().catch(() => null),
]);
const updateLine = describeUpdate(updateResult);
const approvalLine = describeApproval(approvalResult);

const line = "──────────────────────────────────────────────────────────────────";
console.log(line);
console.log("Digistore SAAS Template — this is where you build your own SAAS app,");
console.log("billed through Digistore24.");
console.log("");

if (appUnderWay) {
  // A project already under way — do not bother them with beginner text.
  console.log("What do you want to carry on with?");
  // Where the hand-typed arrow chain used to be. The phases come off `PHASES`
  // and the number off the state, so this sentence cannot drift from the path.
  console.log(
    `Four phases: ${phaseNames(" · ")}` +
      (journeyPhase ? ` — you are in ${journeyPhase.num}.` : "."),
  );
  console.log(
    'Say e.g. "carry on with the app", "what\'s next", or `node run.mjs journey`.',
  );
} else {
  // The "only door" promise, unchanged — it is the one line the whole README
  // points at, and it is what a beginner needs before any structure.
  console.log("This is how you start — just say:");
  console.log("");
  console.log('    "Build my app"');
  console.log("");
  console.log("No idea yet? Just say so, and we will find one together.");
  console.log("");
  console.log("Four phases, and every step in them is optional:");
  console.log(`  ${phaseNames("   ")}`);
}

if (blocked.length > 0) {
  console.log("");
  console.log("(A couple of things still need setting up here — I will take care of that first.)");
}

console.log(line);

// Context for Claude (the user sees these lines as well, so keep them neutral
// and terse):
console.log(`[Project state: .env=${hasEnv}, product-brief=${hasBrief}, own pages=${customPages}]`);
if (updateLine) console.log(updateLine);
if (approvalLine) console.log(approvalLine);
// Every time, unlike its two neighbours below — the reasoning is beside the
// derivation above. It is only silent when the whole read threw, and then there
// is genuinely nothing known to say.
if (journeyLine) console.log(journeyLine);
const notesLine = describeUnwritten(unwritten);
if (notesLine) console.log(notesLine);
// Here rather than further down because the lines above and this one describe
// the PROJECT, while `[Machine: …]` and `[Setup: …]` describe the machine and
// stay last. Absent on the ordinary developer's machine, which is the same
// asymmetry the next line argues for itself — scripts/dev/operations.mjs.
if (operationsLine) console.log(operationsLine);
// Printed only when it is false, and that asymmetry is the point: on the
// overwhelmingly common machine — a desktop with the person in front of it —
// this line is noise, and a line that appears every time gets read by nobody.
// Where it does appear, it changes what may be promised: no browser opens
// itself, and the `localhost` address the skills hand out reaches this machine
// rather than the person's. docs/machine.md is the whole of it.
if (!canOpenBrowser()) {
  console.log("[Machine: no browser here — hand the user links, and see docs/machine.md " +
    "before promising a localhost address.]");
}
if (blocked.length > 0) {
  console.log(
    `[Setup: blocked — ${blocked.map((c) => c.id).join(", ")}. ` +
      `Run the skill setup-machine BEFORE building anything.]`,
  );
} else if (verifiedDay) {
  // The full checklist went through on this machine — so whoever starts building
  // may take this line as the answer and skip their own `doctor` run.
  console.log(`[Setup: ok — verified ${verifiedDay}]`);
} else {
  // The cheap checks are green, but the expensive half (the Docker daemon, the
  // dependencies, the migrations) has never been confirmed here. Said as a
  // separate state on purpose: "ok" alone would be read as "checked", and the
  // one thing this project cannot afford is an app built on an untested machine.
  console.log("[Setup: ok — not verified yet. Run `node run.mjs doctor` before building.]");
}
