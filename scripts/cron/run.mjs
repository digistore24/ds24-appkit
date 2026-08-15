#!/usr/bin/env node
// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The scheduled jobs, from the terminal.
//
//   node run.mjs cron              # run everything that is due, now
//   node run.mjs cron --list       # what exists, when it last ran, what it said
//   node run.mjs cron --job prune-ai-usage    # run one, due or not
//
//   node run.mjs cron --list --url https://app.example.com   # a DEPLOYED app
//
// ── It calls the RUNNING APP, and that is the point ───────────────────────
// The obvious alternative is a script that connects to the database and does
// the work itself. That gives you two implementations of every job which agree
// until the day they do not, and it means triggering a job by hand proves
// nothing about the path production actually takes.
//
// So this calls `/api/cron` on the app. One registry, one runner, and a manual
// run exercises the authentication, the lock and the bookkeeping exactly as the
// scheduler does.
//
// For the case where the app is NOT running and you want rows gone anyway,
// `node run.mjs db-prune-ai` and `db-prune-ipn` still go straight at the
// database. They are the offline twins, and they are documented as such.
//
// ── The second address ──────────────────────────────────────────────────────
// `--url https://…` asks the DEPLOYED app the same question, over the same
// endpoint, with no shell on the host — this replaces the raw `GET
// /api/cron?list` that `docs/DEPLOY.md` used to tell operators to send by hand.
// It is the sibling of `node run.mjs errors --url …` and follows it exactly:
// the flag is two tokens, the credential is resolved from the URL's HOSTNAME
// and never from a flag (`scripts/cron/remote.mjs`), and *unreachable*,
// *refused* and *not configured on the host* are three different sentences.
//
// 🚨 Nothing about the LOCAL path changes. The port still comes from
// `.dev/port`, the secret is still generated into `.env` on first use, and the
// "restart the app" advice is still what a local 401 gets — that advice is
// local-only and is precisely what must not be said about somebody else's host.
import { existsSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

import "../lib/env.mjs";
import { readEnvValue, setEnvValue } from "../lib/env-write.mjs";
import { describeEvery, jobFindings } from "../../lib/cron/rules.mjs";
import {
  readBody,
  jobsFrom,
  formatRefusal,
  formatEmpty,
  formatJob,
  formatFindingsSummary,
} from "./list-report.mjs";
import {
  resultsFrom,
  knownJobs,
  emptyRunVerdict,
  jobResultFrom,
  isUnknownJob,
  formatUnknownJob,
  formatRunRefusal,
  formatRunSummary,
} from "./run-report.mjs";
import { cronSecretFor, hostOf } from "./remote.mjs";
// The health probes' bound, imported rather than restated. A listing is a read
// and gets that one; running a job really does work at the other end, so it gets
// its own, longer bound rather than a second copy of the short one.
import { TIMEOUT_MS } from "../health/probes/_transport.mjs";

/** Running a job is work, not a read — a minute, not ten seconds. */
const JOB_TIMEOUT_MS = 60_000;

const argv = process.argv.slice(2);
const wantsList = argv.includes("--list");
const jobFlag = argv.indexOf("--job");
const jobId = jobFlag >= 0 ? argv[jobFlag + 1] : null;

if (jobFlag >= 0 && !jobId) {
  console.error("ERROR: --job needs a job id. `--list` shows them.");
  process.exit(2);
}

const urlFlag = argv.indexOf("--url");
const askedUrl = urlFlag >= 0 ? argv[urlFlag + 1] : null;

// `--url --list` is a typo, not an address. Catching it here rather than
// letting `new URL("--list")` throw inside the resolver is the difference
// between a sentence and a stack trace.
if (urlFlag >= 0 && (!askedUrl || askedUrl.startsWith("--"))) {
  console.error(
    "ERROR: --url needs an address:  node run.mjs cron --list --url https://app.example.com",
  );
  process.exit(2);
}

// The port the app actually came up on. `node run.mjs start` moves to the next
// free one and remembers it here, so hard-coding 3000 would talk to whatever
// else is listening there. Same file every other dev script reads.
function appPort() {
  if (existsSync(".dev/port")) {
    const port = Number(readFileSync(".dev/port", "utf8").trim());
    if (Number.isFinite(port) && port > 0) return port;
  }
  return 3000;
}

// A secret is required by the endpoint, and a developer has no reason to think
// about one. Generated on first use exactly as AUTH_SECRET is
// (scripts/dev/ensure-env.mjs) — never overwriting a value that is already set,
// because in STAGING/PROD it belongs to the host's secret management.
function cronSecret() {
  const existing = readEnvValue(".env", "CRON_SECRET");
  if (existing) return existing;

  const generated = randomBytes(32).toString("hex");
  setEnvValue(".env", "CRON_SECRET", generated);
  console.log("→ CRON_SECRET generated in .env (local development secret).");
  console.log("  In STAGING/PROD it belongs in the host's secrets — see docs/DEPLOY.md.\n");
  // No "now restart the app" here: in dev Next.js picks a changed .env up by
  // itself, so saying it would be wrong most of the time. The 401 branch below
  // says it exactly when it is true.
  return generated;
}

function url(origin) {
  const base = `${origin}/api/cron`;
  if (wantsList) return `${base}?list`;
  if (jobId) return `${base}?job=${encodeURIComponent(jobId)}`;
  return base;
}

function ago(iso) {
  if (!iso) return "never";
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

// ── Which app, and with which secret ────────────────────────────────────────
// Three outcomes, and only the first two ever send anything. `remote` is what
// every message below branches on: the local advice ("restart it") is wrong
// three times over about a host somebody else runs.
let origin;
let secret;
let remote = null; // { host, keyVar } while talking to a deployed app

if (askedUrl) {
  const scoped = cronSecretFor(process.env, askedUrl);
  if (scoped.reason) {
    // 🚨 Nothing has been written and nothing has been sent. In particular no
    // CRON_SECRET has been generated into the local `.env` — that would mint a
    // value the deployed app has never heard of and guarantee a 401 blamed on
    // the wrong file.
    console.error(`ERROR: ${scoped.reason}.`);
    process.exit(1);
  }
  origin = String(askedUrl).replace(/\/+$/, "");
  if (scoped.envName === "local") {
    secret = cronSecret();
  } else {
    secret = scoped.secret;
    // The same normalisation the scoping decision was made with — a message
    // naming a differently-spelled host than the one that was matched is a
    // message that sends somebody looking for a second configuration.
    remote = { host: hostOf(origin), keyVar: scoped.keyVar };
  }
} else {
  origin = `http://127.0.0.1:${appPort()}`;
  secret = cronSecret();
}

// Held in a variable because every refusal below names it. An operator who is
// told "could not read the answer" and not WHICH address was called has to
// guess at the port, and the most likely cause of an unreadable answer on a
// developer's machine is that something else is listening on it.
const called = url(origin);

let response;
try {
  response = await fetch(called, {
    // A read is a GET. The endpoint takes both, but `?list` arriving as a POST
    // is what a reverse proxy and a platform WAF are most likely to argue with,
    // and it disagrees with what docs/cron.md and docs/DEPLOY.md have always
    // told operators to call. The run and `--job` paths change state and stay POST.
    method: wantsList ? "GET" : "POST",
    headers: { authorization: `Bearer ${secret}` },
    // Never follow a redirect. A platform login wall or an http→https hop would
    // otherwise be followed with the bearer token attached, and the 200 that came
    // back would be somebody else's page.
    redirect: "manual",
    // 🚨 And a bound, for the same reason every health probe carries one: a host
    // that accepts the connection and never answers otherwise leaves this
    // command standing until somebody presses Ctrl-C. `--job` runs a real job,
    // so the wait is longer than a probe's on purpose.
    signal: AbortSignal.timeout(wantsList ? TIMEOUT_MS : JOB_TIMEOUT_MS),
  });
} catch (error) {
  // `fetch` rather than curl — Node has it built in and curl is not on every
  // machine (CLAUDE.md → Three systems).
  if (remote) {
    console.error(`ERROR: nothing answered at ${remote.host}.`);
    console.error(`  url:  ${called}`);
    console.error(`  ${error.message}`);
    console.error("Check the address, and that the app is deployed and up.");
  } else {
    console.error(`ERROR: no app answering on ${origin}.`);
    console.error("Start it first:  node run.mjs start");
    console.error("Or, without a running app:  node run.mjs db-prune-ai --dry-run");
  }
  process.exit(1);
}

if (response.status === 401) {
  if (remote) {
    console.error(`ERROR: ${remote.host} rejected the CRON_SECRET.`);
    console.error(`That host has a different value than ${remote.keyVar} in this .env — that`);
    console.error("key is the reference copy of what is in the host's secret storage.");
    console.error("Set the same value on both sides:  docs/DEPLOY.md");
  } else {
    console.error("ERROR: the app rejected the CRON_SECRET in your .env.");
    console.error("It reads its environment at start — restart it:  node run.mjs restart");
  }
  process.exit(1);
}
if (response.status === 503) {
  // The endpoint answers 503 for exactly one reason, and it says so in its own
  // comment: an operator has to be able to tell "I never set the secret" apart
  // from "the wrong one is being sent". Those have different fixes.
  if (remote) {
    console.error("ERROR: the deployed app has no CRON_SECRET set.");
    console.error(`${remote.host} answers 503 for exactly that reason — the value is missing in`);
    console.error("the HOST's secret storage, not here. Set it there and redeploy:  docs/DEPLOY.md");
  } else {
    console.error("ERROR: the app has no CRON_SECRET set.");
    console.error("It is in your .env now; restart the app:  node run.mjs restart");
  }
  process.exit(1);
}
// A 404 is the "no such job" answer of the `?job=<id>` path, and it arrives as
// JSON there — which is why it falls through below. For `?list` AND for the bare
// run it is nothing of the kind: locally something else is answering on that
// port, remotely the address is not this app's. Handled here rather than left to
// the parse, where it would surface as "the answer is not JSON" and send
// somebody hunting a proxy.
//
// 🚨 The condition is `!jobId`, not `!wantsList`: the ONE mode in which a 404 is
// the app's own answer is the mode that named a job. `--list --job x` is a typo
// that still sends `?list`, so `wantsList` keeps its branch too.
if ((wantsList || !jobId) && response.status === 404) {
  if (remote) {
    console.error(`ERROR: ${remote.host} answered 404 for ${called}.`);
    console.error("That address is not this app's /api/cron — check the domain and the path.");
  } else {
    console.error(`ERROR: the app answered 404 for ${called}.`);
    console.error("Something else may be listening on that port:  node run.mjs status");
  }
  process.exit(1);
}
// A redirect is never this endpoint's own answer. `redirect: "manual"` above is
// what makes it visible at all — followed, it would have carried the bearer
// token to whatever answered next and the 200 that came back would have been
// somebody else's page. This is the platform login wall and the http→https hop,
// and neither is a fault in the app's log.
if (response.status >= 300 && response.status < 400) {
  const to = response.headers.get("location") ?? "(no Location header)";
  console.error(`ERROR: ${remote ? remote.host : origin} answered ${response.status}, a redirect.`);
  console.error(`  to:  ${to}`);
  console.error("Something in front of the app answered instead of the app — a login wall, an");
  console.error("access proxy, or a hop to another address. Point --url at the app itself.");
  process.exit(1);
}
if (!response.ok && response.status !== 404) {
  if (remote) {
    console.error(`ERROR: ${remote.host} answered ${response.status}.`);
    console.error("The reason is in the app's own log on the host — the errors it kept are");
    console.error(`readable from here:  node run.mjs errors --url ${origin}`);
  } else {
    console.error(`ERROR: the app answered ${response.status}.`);
    console.error("What went wrong is in the app's log:  node run.mjs logs");
  }
  process.exit(1);
}

// Text first, then parse. `response.json()` consumes the stream and leaves
// nothing to quote, and an operator who is handed undici's stack trace over a
// proxy's HTML error page has been told nothing about their app. The guard sits
// HERE rather than inside the --list branch because the parse is above the fork
// and all three modes read the same body — a second parse in one branch would
// be a second copy of the decision, which is the shape of the defect this
// fixes. The decision itself is pure, in scripts/cron/list-report.mjs.
// 🚨 The guard has to cover the READ as well as the parse. `response.text()`
// itself throws when the body is cut off mid-stream — a socket reset, or this
// command's own `AbortSignal.timeout` firing while the body is arriving, since
// the signal binds the whole fetch and not just the headers. Measured
// 2026-08-15 against a throwaway server that sent `content-length: 500`, half a
// body and then destroyed the socket: `TypeError: terminated` out of
// `node:internal/deps/undici`, exit 1 — the exact frame AC1 of Story 42.1
// forbids in those words. The story's own measurement only used bodies that
// arrived whole.
let text;
try {
  text = await response.text();
} catch (error) {
  console.error(`ERROR: ${called} answered ${response.status} and then stopped sending.`);
  console.error(`  The connection was cut while the answer was arriving (${error.message}).`);
  console.error(`  Nothing was learned about the jobs — this is a transport fault, not a`);
  console.error(`  verdict. A proxy or a load balancer between here and the app is the`);
  console.error(`  usual cause; try again, and read the host's own log if it repeats.`);
  process.exit(1);
}
const read = readBody({ status: response.status, url: called, text });
if (!read.ok) {
  for (const line of formatRefusal(read)) console.error(line);
  process.exit(1);
}
const body = read.body;

if (wantsList) {
  // An answer with no `jobs` key used to print the header, loop zero times and
  // exit 0 — "I could not look" wearing "there is nothing there"'s clothes. An
  // EMPTY array is the other thing entirely and stays a clean exit 0.
  const list = jobsFrom(body, { status: response.status, url: called });
  if (!list.ok) {
    for (const line of formatRefusal(list)) console.error(line);
    process.exit(1);
  }
  // Two states are findings rather than rows: an ENABLED job that has never
  // run, and any job with a failed run behind it. Judged once, over the whole
  // list, so the per-job markers and the closing line can never disagree.
  const findings = jobFindings(list.jobs);

  console.log("Scheduled jobs (config/cron.json):\n");
  if (list.jobs.length === 0) {
    for (const line of formatEmpty()) console.log(line);
  } else {
    for (const job of list.jobs) {
      const mine = findings.filter((finding) => finding.job === job.job);
      for (const line of formatJob(job, { describeEvery, ago, findings: mine })) console.log(line);
    }
  }
  console.log("Run one now:  node run.mjs cron --job <id>");
  console.log("");
  console.log(formatFindingsSummary(findings));
  // 🚨 Exit 0 whatever it found. On a freshly deployed app every enabled job
  // says `never`, and `scripts/deploy-test.mjs` reads a non-zero exit from this
  // command as a failed release. A finding here is a sentence; the verdict and
  // the alert are other commands' business (one reporter per channel).
  process.exit(0);
}

// ── The run, and what its answer is allowed to mean ─────────────────────────
// `body.results ?? []` was the same defect `--list` had: an answer with no
// results — the other query's `{ jobs: [...] }`, another JSON endpoint's `{}` —
// printed "Nothing to do — no job is due." and exited 0. The decision is pure
// and lives in scripts/cron/run-report.mjs, beside the list's.
const run = resultsFrom(body, { status: response.status, url: called });
if (!run.ok) {
  for (const line of formatRunRefusal(run)) console.error(line);
  process.exit(1);
}
// What the app says it HAS. Never read until now, and it is what tells "nothing
// was due" apart from "that was not an answer about my jobs".
const known = knownJobs(body);

let results = run.results;

if (jobId) {
  // "I do not know that job" and "that job failed" are two different answers,
  // and until now they were one line apart in nothing but the detail text.
  if (isUnknownJob({ status: response.status, known, job: jobId })) {
    for (const line of formatUnknownJob(jobId, known, { url: called })) console.error(line);
    // 2, like the two argument refusals at the top of this file: a job id that
    // does not exist is a mistake in the command, not a job that went wrong. A
    // scheduler alerting on exit 1 must not be told a deletion failed.
    process.exit(2);
  }
  const one = jobResultFrom(results, { job: jobId, status: response.status, url: called });
  if (!one.ok) {
    for (const line of formatRunRefusal(one)) console.error(line);
    process.exit(1);
  }
  results = one.results;
} else if (results.length === 0) {
  // A bare run reports on EVERY registered job, `skipped` included — so an empty
  // array is not "nothing was due", it is an answer about something else. The
  // one exception is an app whose registry is genuinely empty, and only `known`
  // can say so. Three answers, and the third stays exit 0.
  const verdict = emptyRunVerdict(known, { status: response.status, url: called });
  if (!verdict.ok) {
    for (const line of formatRunRefusal(verdict)) console.error(line);
    process.exit(1);
  }
  for (const line of verdict.lines) console.log(line);
  process.exit(0);
}

let failed = 0;
for (const result of results) {
  const mark = result.outcome === "ok" ? "✓" : result.outcome === "skipped" ? "·" : "✗";
  console.log(`${mark} ${result.job}: ${result.detail}${result.ms ? ` (${result.ms}ms)` : ""}`);
  if (result.outcome === "failed") failed++;
}
// The sentence a run of the whole registry ends on — and where "no job was due"
// now lives, attached to the answer that really means it: a full list of skipped
// rows. `--job <id>` gets none; one result needs no tally.
if (!jobId) console.log(formatRunSummary(results));
// A non-zero exit so a host's scheduler notices. A cron entry whose command
// always succeeds is a cron entry nobody ever gets an alert from. 🚨 Only a
// FAILED job counts — nothing being due is a normal night, not an alert.
process.exit(failed > 0 ? 1 : 0);
