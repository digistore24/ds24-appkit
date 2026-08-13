#!/usr/bin/env node
// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The command line of this app.
//
//   node run.mjs                 show every command
//   node run.mjs start           database + migrations + app
//   node run.mjs stop            stop everything
//   node run.mjs test            TypeScript check + tests
//   node run.mjs db-migrate      apply pending migrations
//   node run.mjs db-reset        wipe the database and rebuild it (local only)
//
// Arguments go straight through:
//   node run.mjs user-create --email you@example.com --role owner --apply
//   node run.mjs ds24-sync --dry-run
//   node run.mjs start --port 3005
//
// ── Why a Node script and not a Makefile ────────────────────────────────────
// This app is built with an AI program — Claude Code, Codex, Antigravity or OpenCode
// — and all of them run on Linux, macOS and Windows. `make` does not: it is
// absent on Windows and needs the Xcode Command Line Tools on macOS. Node is present anyway — it is a Next.js app. See
// CLAUDE.md → Three systems. (A Makefile is still in the project, but only as
// an alias that forwards here.)
//
// ── The two rules for starting other programs ───────────────────────────────
//  1. Our own scripts run through `process.execPath`, never a shell, so their
//     arguments survive verbatim.
//  2. A .cmd shim is the only thing that still needs cmd.exe — `npm` is one on
//     Windows, and Node has refused to spawn those without a shell since
//     18.20/20.12. Everything else is a real .exe and is started directly.
// Both live in scripts/lib/proc.mjs; use the helpers, don't call spawn here —
// and never pass a `shell` option, scripts/portability.test.ts refuses it.
import * as app from "./scripts/dev/app.mjs";
import { dbUp } from "./scripts/db/up.mjs";
import { doctor } from "./scripts/dev/doctor.mjs";
import { depsFresh, markDepsFresh } from "./scripts/dev/deps.mjs";
import { ensureEnv } from "./scripts/dev/ensure-env.mjs";
import { journeyCommand } from "./scripts/dev/journey-cli.mjs";
import { wireCommitHook } from "./scripts/dev/hooks.mjs";
import { writeStamp } from "./scripts/dev/setup-stamp.mjs";
import { usesLocalPostgres } from "./scripts/db/driver.mjs";
import { composeProjectFlag } from "./scripts/db/compose.mjs";
import { moduleCommands } from "./scripts/modules/tasks.mjs";
import { localDown, localNuke } from "./scripts/db/local.mjs";
import { run, runNpm, runScript } from "./scripts/lib/proc.mjs";

// ── little helpers ──────────────────────────────────────────────────────────

/** An npm script. Ends the run with its exit code if it fails. */
async function npm(...args) {
  const code = await runNpm(["run", ...args]);
  if (code !== 0) process.exit(code);
}

/** One of our own scripts under scripts/. Ends the run with its exit code. */
async function script(file, args = []) {
  const code = await runScript(file, args);
  if (code !== 0) process.exit(code);
}

/** docker, straight through — it is a real executable on all three systems. */
async function docker(...args) {
  const code = await run("docker", args);
  if (code !== 0) process.exit(code);
}

// ── the tasks ───────────────────────────────────────────────────────────────
// `needs` are the tasks that have to run first — the same idea as a Makefile's
// prerequisites, and each of them runs at most once per invocation.

const TASKS = {
  // ── Start / Stop ──────────────────────────────────────────────────────────
  start: {
    group: "Start / Stop",
    help: "Start everything: DB + migrations + app (http://localhost:3000)",
    needs: ["env", "node_modules", "hooks", "db-up", "db-migrate"],
    run: (_args, { port }) => app.start(port),
  },
  stop: {
    group: "Start / Stop",
    help: "Stop everything: tunnel + app + database",
    run: () => app.stop(),
  },
  restart: {
    group: "Start / Stop",
    help: "Restart",
    needs: ["stop"],
    // Through runTask, not TASKS.start.run: `stop` took the database down, so
    // start's own prerequisites have to run again.
    run: (args, options) => runTask("start", args, options),
  },
  status: {
    group: "Start / Stop",
    help: "Is the app running? Is the database running?",
    run: () => app.status(),
  },
  logs: {
    group: "Start / Stop",
    help: "Follow the running app's log (Ctrl-C to stop)",
    run: () => app.logs(),
  },
  dev: {
    group: "Start / Stop",
    help: "Run the app in the foreground (logs straight in the terminal)",
    needs: ["env", "node_modules", "db-up", "db-migrate"],
    run: (_args, { port }) => app.dev(port),
  },

  // ── Tests & quality ───────────────────────────────────────────────────────
  test: {
    group: "Tests & quality",
    help: "Tests (vitest) + TypeScript check",
    needs: ["node_modules"],
    run: async () => {
      await npm("typecheck");
      await npm("test");
    },
  },
  typecheck: {
    group: "Tests & quality",
    help: "TypeScript check on its own",
    needs: ["node_modules"],
    run: () => npm("typecheck"),
  },
  smoke: {
    group: "Tests & quality",
    help: 'Call every page once — finds "Internal Server Error" (the app must be running)',
    // --url explicitly: otherwise the script stubbornly checks localhost:3000 and
    // reports green while another project answers there. The user's own --url
    // wins, because the first one counts.
    run: (args, { port }) =>
      script("scripts/dev/smoke.mjs", [...args, "--url", `http://localhost:${port ?? app.appPort()}`]),
  },
  errors: {
    group: "Tests & quality",
    help:
      "What went wrong in the running app's log — the errors a 200 hides; " +
      "--url https://… asks a DEPLOYED app instead",
    // No `needs`: locally it only reads .dev/dev.log, and it has to work
    // precisely when the app has fallen over and nothing else can run. The
    // --url path loads the .env itself (scripts/dev/errors-remote.mjs).
    run: (args) => script("scripts/dev/log-errors.mjs", args),
  },
  "ai-check": {
    group: "Tests & quality",
    help:
      "Which task runs on which model, are the keys there, what does a call cost; " +
      "--live makes one REAL call per binding (costs money, needs the app running)",
    needs: ["env", "node_modules"],
    run: (args) => script("scripts/ai/check.mjs", args),
  },
  "media-check": {
    group: "Tests & quality",
    help: "Where uploaded files go, whether that place answers, and what may go in",
    needs: ["env", "node_modules"],
    run: (args) => script("scripts/media/check.mjs", args),
  },
  module: {
    group: "Tests & quality",
    help: "What this app is made of — `module list`, `module check`",
    // No `needs`: it only reads files, and has to work in a half-set-up project
    // — the same reason `export-core` has none.
    run: (args) => script("scripts/modules/cli.mjs", args),
  },
  "legal-check": {
    group: "Tests & quality",
    help: "What is still missing legally — placeholder pages, the AI notice, consent, evidence",
    // No `needs`: most of it reads files and JSON, and it has to work in a
    // half-set-up project — which is exactly when somebody asks whether they
    // may go live. The one check that wants a database says so and skips.
    run: (args) => script("scripts/legal/check.mjs", args),
  },
  "ux-check": {
    group: "Tests & quality",
    help: "The interface, measured — contrast in both modes, the design system, names, menus",
    // No `needs`: it reads .tsx and .css and prints findings. It has to work in
    // a half-set-up project, because "does this look right?" is asked long
    // before there is a database. The judgement half is the skill: ux-gateway.
    run: (args) => script("scripts/ux/check.mjs", args),
  },
  "security-check": {
    group: "Tests & quality",
    help: "What is known to be wrong with what this app runs — a ladder of checks, and a rung that could not look says so (--json)",
    // No `needs`: it reads the lockfile and asks npm. "Is this safe?" gets asked
    // in a half-set-up project — the same argument `legal-check` and `ux-check`
    // carry above — and the ladder is built for it: a rung that cannot look
    // reports a skip with its reason, never a clean bill.
    //
    // ⚠️ Deliberately NOT in the `test` task and in no Makefile. It asks the
    // network, and its answer moves without anything in this project changing;
    // a check like that inside a gate is a brake, and a brake is what somebody
    // eventually removes — taking the intent with it.
    run: (args) => script("scripts/security/check.mjs", args),
  },
  health: {
    group: "Tests & quality",
    help: "Is the DEPLOYED app healthy — six probes, one verdict, one exit code (--url https://…, --json)",
    // No `needs`: the same argument `errors` carries. It has to work precisely
    // when the app has fallen over, and it loads the .env itself
    // (scripts/health/check.mjs → import "../lib/env.mjs").
    //
    // ⚠️ Deliberately NOT in the `test` task and in no Makefile. It asks a
    // deployed app over the network, and its answer moves without anything in
    // this project changing; a check like that inside a gate is a brake, and a
    // brake is what somebody eventually removes — taking the intent with it.
    run: (args) => script("scripts/health/check.mjs", args),
  },
  "security-scope": {
    group: "Tests & quality",
    help: "What a RECURRING security pass would look at since the last report — and what it would NOT (--json)",
    // No `needs`: it reads git and docs/reports/ and prints a scope. It has to
    // answer in a half-set-up project — "is my app still safe?" is asked three
    // weeks after a launch, on a machine that may never have run an install.
    //
    // ⚠️ Deliberately NOT in the `test` task and in no Makefile, for the same
    // reason `security-check` above is not: it is the countable half of a
    // judgement, and a judgement wired into a gate is a brake somebody removes.
    // This one adds a second reason — it reports a SCOPE and judges nothing, so
    // it exits 0 whatever it finds. There is nothing here for a gate to read.
    run: (args) => script("scripts/security/scope.mjs", args),
  },
  brand: {
    group: "Tests & quality",
    help: "Take the look from your own brand: accent colours out of a CSS file, your website or a hex, and the five app icons out of one logo (dry run; --apply writes)",
    // `node_modules` and nothing else — sharp is a native module and there is
    // no icon without it. Deliberately NOT `env`: no key, no database, no
    // media store. "What would my colour look like here?" is asked long before
    // any of that exists, exactly as with `ux-check` above.
    needs: ["node_modules"],
    run: (args) => script("scripts/brand/cli.mjs", args),
  },
  "kb-check": {
    group: "Tests & quality",
    help: "Check the assistant's handbook (content/knowledge/) — format, size, media references, cost per answer",
    // No `needs`: it reads Markdown and prints numbers. It has to work in a
    // half-set-up project, because that is exactly when somebody is writing
    // the handbook for the first time.
    run: (args) => script("scripts/ai/kb-check.mjs", args),
  },
  "kb-media-sync": {
    group: "Tests & quality",
    help: "Copy .data/knowledge-media/ into the media store (dry run; --apply writes; --env prod)",
    // Only `env`: the MEDIA_* variables decide which store it fills. No
    // `node_modules` — it is plain Node, and filling a store must work in a
    // project that never ran an install.
    needs: ["env"],
    run: (args) => script("scripts/knowledge/kb-media-sync.mjs", args),
  },
  // The three content commands: how what this app SELLS reaches an
  // environment. Rows and files written locally stay local — content-apply
  // asserts the manifest's media rows + the appliers' tables, content-media-sync
  // moves the staged bytes, and content-check asks the environment whether it
  // HOLDS it all. ⚠️ That third one counts nothing itself: it asks whoever owns
  // the rows — the core for product media and the appliers, every module for its
  // own through `presence`. The story: docs/content.md.
  "content-apply": {
    group: "Tests & quality",
    help: "Apply the repo's content: media rows, repo-leg bytes, appliers (--env prod; preview: --dry-run)",
    // This one is expected to really apply (the ds24-sync convention), so it
    // passes --apply by itself; the script stays at "a dry run is the normal
    // case". Whoever only wants to look: --dry-run.
    needs: ["env", "node_modules"],
    run: (args) => {
      const apply = args.includes("--dry-run") ? [] : ["--apply"];
      return script("scripts/content/apply.mjs", [...apply, ...args]);
    },
  },
  "content-media-sync": {
    group: "Tests & quality",
    help: "Copy .data/content-media/ into the media store (dry run; --apply writes; --env prod)",
    needs: ["env"],
    run: (args) => script("scripts/content/content-media-sync.mjs", args),
  },
  "content-publish": {
    group: "Tests & quality",
    // The fourth content command, and the one that needs no password: it talks
    // to the running app over the setup surface and writes the staged media
    // straight into that environment's bucket. `content-apply` is its sibling
    // and not its replacement — that one needs DATABASE_URL and MEDIA_S3_* in
    // the shell, this one needs APP_URL_* and SETUP_KEY_* in the .env.
    help: "Publish content into an environment over the setup surface, staged media and all (dry run; --apply writes)",
    // Only `env`: it talks HTTP and reads files. No `node_modules` — it is plain
    // Node, and a publish must work in a project that never ran an install.
    needs: ["env"],
    // Deliberately NOT the `content-apply` convention of injecting --apply: that
    // one writes into whatever DATABASE_URL is in the shell, this one is aimed
    // at production by name. A dry run is the safe default here.
    run: (args) => script("scripts/content/publish.mjs", args),
  },
  lint: {
    group: "Tests & quality",
    help: "Lint",
    needs: ["node_modules"],
    run: () => npm("lint"),
  },
  build: {
    group: "Tests & quality",
    help: "Production build",
    needs: ["node_modules"],
    run: () => npm("build"),
  },

  // ── Database ──────────────────────────────────────────────────────────────
  // The golden path: change the schema in db/schema.ts → `db-generate` creates a
  // SQL migration in drizzle/ → `db-migrate` applies it. Migrations are
  // committed; in production ONLY db-migrate runs (never db:push).
  // Details: docs/database.md
  "db-up": {
    group: "Database",
    help: "Start Postgres and wait until it is ready",
    run: () => dbUp(),
  },
  "db-down": {
    group: "Database",
    help: "Stop Postgres (data is kept)",
    run: async () =>
      (await usesLocalPostgres())
        ? localDown()
        : docker("compose", ...composeProjectFlag(), "down"),
  },
  "db-migrate": {
    group: "Database",
    help: "Apply pending migrations (in production too)",
    needs: ["env", "node_modules", "db-up"],
    run: () => npm("db:migrate"),
  },
  "db-generate": {
    group: "Database",
    help: "Create a migration from a schema change (db/schema.ts, or --module <id>)",
    needs: ["node_modules"],
    run: async (args) => {
      // A module owns its own chain and its own journal, so its migration is
      // generated against its own schema — the golden path ("change the schema,
      // run db-generate") stays one sentence for a module too.
      if (args.includes("--module")) {
        await script("scripts/db/generate-module.mjs", args);
        return;
      }
      await npm("db:generate");
      console.log(
        "→ Review the new file in drizzle/, commit it and apply it with 'node run.mjs db-migrate'.",
      );
    },
  },
  "db-reset": {
    group: "Database",
    help: "Wipe the database + migrations + seed (LOCAL only)",
    needs: ["env", "node_modules", "db-up"],
    run: () => npm("db:reset"),
  },
  "db-seed": {
    group: "Database",
    help: "Create test data / an admin account (scripts/db/seed.mjs)",
    needs: ["env", "node_modules", "db-up"],
    run: () => npm("db:seed"),
  },
  "db-studio": {
    group: "Database",
    help: "Inspect the database in the browser (Drizzle Studio)",
    needs: ["env", "node_modules"],
    run: () => npm("db:studio"),
  },
  "db-nuke": {
    group: "Database",
    help: "Stop everything (tunnel + app + DB) AND delete the database (all data gone)",
    // `stop` first: a running app still holds connections to the database, and
    // nuking the data out from under it leaves both in a mess.
    needs: ["stop"],
    run: async () => {
      if (await usesLocalPostgres()) await localNuke();
      else await docker("compose", ...composeProjectFlag(), "down", "-v");
      console.log("✓ Database deleted — all data gone.");
    },
  },
  // The scheduled jobs run by themselves while the app is up (docs/cron.md).
  // This is for looking at them and for running one now.
  cron: {
    group: "Database",
    help:
      "Scheduled jobs: run what is due, --list them, or --job <id> to force one; " +
      "--list --url https://… asks a DEPLOYED app instead",
    needs: ["env", "node_modules"],
    run: (args) => script("scripts/cron/run.mjs", args),
  },
  // The offline twins of two of those jobs: straight at the database, no
  // running app needed, and a --dry-run the scheduled path does not have.
  "db-prune-ipn": {
    group: "Database",
    help: "Delete IPN-log entries older than 60 days (--days 30) — without the app running",
    needs: ["env", "node_modules"],
    run: (args) => script("scripts/db/prune-ipn-log.mjs", args),
  },
  "db-prune-ai": {
    group: "Database",
    help: "Delete AI-usage rows older than 365 days (--days 90) — they are the cost history",
    needs: ["env", "node_modules"],
    run: (args) => script("scripts/db/prune-ai-usage.mjs", args),
  },

  "data-export": {
    group: "Database",
    help: 'Everything held about one person, as JSON (--email "kunde@example.de")',
    needs: ["env", "node_modules"],
    run: (args) => script("scripts/privacy/export-data.mjs", args),
  },

  // ── Users & roles ─────────────────────────────────────────────────────────
  "user-create": {
    group: "Users & roles",
    help: "Create a user / set a role (--email … --role owner --apply)",
    run: (args) => script("scripts/users/create-user.mjs", args),
  },
  "content-check": {
    group: "Tests & quality",
    help: "Does an environment hold this app's content? Every owner answers for its own rows",
    // `env` only: it asks the environment over HTTP and touches no database.
    needs: ["env"],
    run: (args) => script("scripts/content/check.mjs", args),
  },
  "setup-check": {
    group: "Tests & quality",
    help: "Where the setup surface stands: the switch, the keys, and (--live) a real call",
    // `env` only: it reads config and .env and talks over HTTP. It has to work
    // in a half-set-up project, because "is this on?" is asked exactly then.
    needs: ["env"],
    run: (args) => script("scripts/setup/check.mjs", args),
  },
  "setup-bootstrap": {
    group: "Users & roles",
    help: "First owner + first setup key for an environment that has neither (--email … --apply)",
    // `env` and `node_modules` only: it talks to the database directly and
    // deliberately does NOT need the app to be running — the whole point is an
    // environment where nobody can sign in yet.
    needs: ["env", "node_modules"],
    run: (args) => script("scripts/setup/bootstrap.mjs", args),
  },
  "setup-key": {
    group: "Users & roles",
    help: "A further setup key for an owner who already exists, straight into .env (--apply)",
    // The other half of `setup-bootstrap`, which refuses once an owner exists —
    // correctly, and then names the admin page as the only way on. An agent
    // with no browser stops there, and so does `content-check`. Same `needs`
    // and the same reason: it talks to the database and does not need the app.
    needs: ["env", "node_modules"],
    run: (args) => script("scripts/setup/mint-key.mjs", args),
  },
  "user-list": {
    group: "Users & roles",
    help: "List users and roles (--role owner)",
    run: (args) => script("scripts/users/list-users.mjs", args),
  },
  "smoke-account": {
    group: "Users & roles",
    help: "Provision the smoke sign-in for a deployed app (--env prod --apply)",
    run: (args) => script("scripts/users/smoke-account.mjs", args),
  },

  // ── Mail delivery (sign-in) ───────────────────────────────────────────────
  "mail-setup": {
    group: "Mail delivery",
    help: "Set up email delivery (Postmark or SMTP) + a test mail",
    run: () => script("scripts/dev/mail-setup.mjs"),
  },

  // ── Digistore24 setup ─────────────────────────────────────────────────────
  "ds24-connect": {
    group: "Digistore24",
    help: "Fetch the API key (opens the browser) and store it in .env",
    run: (args) => script("scripts/ds24/connect-api-key.mjs", args),
  },
  "ds24-sync": {
    group: "Digistore24",
    help: "Create/update products + the IPN hookup, per environment (--env dev|staging|prod, default from APP_ENV; idempotent; preview: --dry-run)",
    // This one is expected to really create the products, so it passes --apply
    // by itself; the scripts themselves stay at "a dry run is the normal case".
    // Whoever only wants to look: `node run.mjs ds24-sync --dry-run`.
    run: async (args) => {
      const apply = args.includes("--dry-run") ? [] : ["--apply"];
      await script("scripts/ds24/sync-products.mjs", [...apply, ...args]);
      await script("scripts/ds24/ipn-setup.mjs", ["--auto", ...apply, ...args]);
    },
  },
  "ds24-approval": {
    group: "Digistore24",
    help: "Show + request product approval (dry run = status view; --apply requests; marketplace per product language)",
    run: (args) => script("scripts/ds24/request-approval.mjs", args),
  },
  "ds24-ipn": {
    group: "Digistore24",
    help: 'Set up the IPN hookup manually (--url … --domain … --apply)',
    run: (args) => script("scripts/ds24/ipn-setup.mjs", args),
  },
  "ds24-ipn-verify": {
    group: "Digistore24",
    help: "Diagnose a failed IPN signature from the stored payload (--order ABC123)",
    needs: ["env", "node_modules"],
    run: (args) => script("scripts/ds24/ipn-verify.mjs", args),
  },
  "ds24-purchase": {
    group: "Digistore24",
    help: "What Digistore24 says about one order — status, product, links (--order ABC123)",
    run: (args) => script("scripts/ds24/purchase-info.mjs", args),
  },
  "ds24-testpay": {
    group: "Digistore24",
    help: "Test-purchase key: DEV checkout links carry it by themselves (--recreate rotates, --json)",
    run: (args) => script("scripts/ds24/testpay.mjs", args),
  },
  "ds24-tunnel": {
    group: "Digistore24",
    help: "Receive IPNs locally: public address in the background + IPN registered",
    run: (args, { port }) =>
      script("scripts/ds24/tunnel.mjs", ["start", String(port ?? app.appPort()), ...args]),
  },

  // ── Setup helpers ─────────────────────────────────────────────────────────
  journey: {
    group: "Setup",
    help: "Where am I, and what comes next (--json, --next)",
    // No `needs`: it reads files and nothing else, and "where am I" is a
    // question worth answering in a project that is not set up yet — which is
    // exactly where somebody asks it.
    run: (args) => journeyCommand(args),
  },
  doctor: {
    group: "Setup",
    help: "What has to be installed — and what is missing on this machine (--json, --deploy)",
    run: (args) => doctor(args),
  },
  setup: {
    group: "Setup",
    help: "Get this project ready to work in: .env, dependencies, database, migrations",
    // The same prerequisites as `start`, without starting the app. One command
    // for the whole preparation, so the setup-machine skill calls one and not
    // five — and so a person has a single thing to type after a fresh clone.
    needs: ["env", "node_modules", "hooks", "db-up", "db-migrate"],
    // The stamp is written HERE, after the needs above have all run: this is the
    // moment the expensive half of the setup is genuinely through. From then on
    // the greeting says `[Setup: ok — verified …]` and nobody has to walk the
    // checklist again (scripts/dev/setup-stamp.mjs).
    run: () => {
      writeStamp();
      console.log("\n✓ Ready. Start it with: node run.mjs start");
    },
  },
  env: {
    group: "Setup",
    help: "Ensure .env exists (create it + generate AUTH_SECRET)",
    run: () => ensureEnv(),
  },
  update: {
    group: "Setup",
    help: "Bring the guidance up to date (CLAUDE.md, docs/, skills) — --apply writes",
    run: (args) => script("scripts/dev/update.mjs", args),
  },
  "update-agents": {
    group: "Setup",
    help: "The same update, guided: show what would change, ask, then write it",
    // `update` with the safety question built in — for a person at the terminal.
    // An agent keeps using `update` / `update --apply`: the question needs a TTY,
    // and without one this refuses rather than applying on its own.
    run: (args) => script("scripts/dev/update.mjs", ["--confirm", ...args]),
  },
  "export-core": {
    group: "Setup",
    help: "Copy the shared core into a companion repo (plan; --apply writes; re-run to update)",
    // No `needs`: it only reads files and must work in a half-set-up project.
    // What it copies is config/core-export.json; the story is docs/mobile.md.
    run: (args) => script("scripts/core/export.mjs", args),
  },
  "agent-setup": {
    group: "Setup",
    help: "Reduce this app to the AI program you use (--apply writes; --undo restores all four)",
    // No `needs`: it only moves text files around, and the first session in a
    // fresh clone is exactly when it is wanted.
    run: (args) => script("scripts/dev/agent-setup.mjs", args),
  },
  greet: {
    group: "Setup",
    help: "The session greeting — where this project stands and what to do next",
    // The same thing three of the four programs print when a session starts,
    // available as a command. Three reasons it has to be:
    //
    //   1. Each of the three wires it up differently (.claude/settings.json,
    //      .codex/hooks.json, .opencode/plugins/), and they are young enough to
    //      break. When the hook does not fire, the greeting is not a nicety
    //      that goes missing — it carries the `[Setup: blocked]` line, and
    //      CLAUDE.md makes a node answer this session a precondition for
    //      writing any file at all. Silence would read as "all fine" on a
    //      machine with nothing installed.
    //   2. 🚨 In Antigravity CLI this command is not the fallback but the ONLY
    //      way. That program has no session-start event to hang a hook on, so
    //      the app ships it none; the guidance tells its agent to run this
    //      first instead. Deleting this command would take the greeting away
    //      from a whole program rather than merely from a broken hook.
    //   3. An agent that starts in a project with no greeting has a command it
    //      can run instead of guessing.
    //
    // No `needs`: it has to work in a project where nothing is set up yet —
    // that is the case it exists for.
    run: () => script("scripts/dev/session-start.mjs"),
  },
  help: {
    group: "Setup",
    help: "Show this overview (--json for the machine-readable list)",
    run: (args) => showHelp(args),
  },

  // Runs when something needs it, never listed.
  node_modules: {
    hidden: true,
    run: async () => {
      if (depsFresh()) return;
      const code = await runNpm(["install"]);
      if (code !== 0) process.exit(code);
      markDepsFresh();
    },
  },

  // Point this clone's git at .githooks, so typecheck + tests run before a
  // commit. Hidden and never a command of its own: it is a property of a
  // prepared clone, not something anybody should have to remember to do. Says
  // nothing when it is already wired, and never fails what it precedes —
  // scripts/dev/hooks.mjs.
  hooks: {
    hidden: true,
    run: () => wireCommitHook(),
  },
};

// ── the commands installed modules bring ────────────────────────────────────
//
// Merged in AFTER the literal above, and that placement is the point:
// `scripts/docs-coverage.test.ts` reads `const TASKS = {` as TEXT and insists
// every command it finds is documented in the core's own guidance. A module
// command is documented by its module, so it must not appear to that parser —
// and a module that ships without a help line is refused at its manifest, so
// it cannot arrive here undocumented either.
//
// A module command never shadows a core one: the manifest requires the module's
// id as a prefix, and the guard below is the second lock on that door — a
// silent overwrite here would replace, say, `db-migrate` with a module's script.
for (const command of moduleCommands()) {
  if (Object.hasOwn(TASKS, command.name)) {
    throw new Error(
      `Module "${command.module}" declares the command "${command.name}", which already ` +
        `exists. A module may not replace a core command — rename it in ` +
        `modules/${command.module}/module.json.`,
    );
  }
  TASKS[command.name] = {
    group: "Modules",
    help: command.help,
    needs: ["env", "node_modules"],
    run: (args) => script(command.file, args),
  };
}

// ── help ────────────────────────────────────────────────────────────────────

function showHelp(args = []) {
  // --json is for an agent, not a person: a program that starts here with no
  // greeting and no memory can read the command list instead of guessing at it,
  // and get the same answer every time. Together with `greet` that is two calls
  // to full orientation in a project it has never seen.
  if (args.includes("--json")) {
    const commands = Object.entries(TASKS)
      .filter(([, task]) => !task.hidden)
      .map(([name, task]) => ({ name, group: task.group, help: task.help }));
    console.log(JSON.stringify({ usage: "node run.mjs <command> [arguments]", commands }, null, 2));
    return;
  }

  console.log("Commands for this app — node run.mjs <command> [arguments]\n");
  const groups = new Map();
  for (const [name, task] of Object.entries(TASKS)) {
    if (task.hidden) continue;
    if (!groups.has(task.group)) groups.set(task.group, []);
    groups.get(task.group).push([name, task.help]);
  }
  for (const [group, entries] of groups) {
    console.log(`${group}:`);
    for (const [name, help] of entries) console.log(`  ${name.padEnd(18)} ${help}`);
    console.log("");
  }
  console.log("The npm scripts behind them (npm run dev, npm run db:migrate, …) keep working.");
}

// ── the runner ──────────────────────────────────────────────────────────────

/** Pull `--port 3005` out of the arguments; PORT=3005 in the environment also counts. */
function takePort(args) {
  const index = args.indexOf("--port");
  if (index !== -1 && args[index + 1]) {
    const given = args.splice(index, 2)[1];
    const port = Number(given);
    // ⚠️ Both elements are already spliced out by the time this is asked, so a
    // value that is not a number used to leave nothing behind and say nothing:
    // `--port abc` took the flag AND its value away and the command ran on the
    // default. Refused instead — somebody who typed a port meant one.
    if (!Number.isFinite(port) || port <= 0 || port > 65535) {
      console.error(`✗ --port needs a number between 1 and 65535 (got ${given}).\n`);
      process.exit(2);
    }
    return port;
  }
  const fromEnv = Number(process.env.PORT);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : undefined;
}

const done = new Set();

async function runTask(name, args, options) {
  const task = TASKS[name];
  for (const need of task.needs ?? []) {
    if (done.has(need)) continue;
    done.add(need);
    await runTask(need, [], options);
  }
  await task.run(args, options);
}

const argv = process.argv.slice(2);
const command = argv.shift() ?? "help";

// `node run.mjs --help` and `-h` are what a first-time reader types, and they
// answered "✗ Unknown command: --help" until 2026-08-12 — the lookup below ran
// first and a flag is not a command.
if (command === "--help" || command === "-h") {
  showHelp();
  process.exit(0);
}

if (!Object.hasOwn(TASKS, command) || TASKS[command].hidden) {
  console.error(`✗ Unknown command: ${command}\n`);
  showHelp();
  process.exit(2);
}

// 🚨 `--help` answers instead of running. Reported 2026-08-12:
// `node run.mjs content-apply --help` RAN THE APPLIER — nothing here looked at
// flags, `--help` was passed through, and the one script it reached does not
// know the flag either. Asking a writing command what it does must never be the
// way to make it do it.
//
// ⚠️ This is the ONE flag `run.mjs` claims. Rejecting unknown flags in general
// would need a per-command list this file does not have: every command has its
// own set, `module` takes positional subcommands, and `ds24-sync` feeds one
// array to two scripts that know different flags. That is a bigger change, and
// it is written down rather than half-done here.
//
// (This paragraph used to carry a count — "28 documented flags across 40
// commands". The commands grew past sixty and the sentence kept the old number,
// so the reason to do nothing rested on an argument that was 60 % wrong. A
// number in a comment is a measurement with a date on it; this one had neither,
// and the point stands without it.)
//
// ⚠️ `brand` is exempt: it is the one command in this tree with a help text of
// its own — subcommands, the contrast behaviour, a paragraph about what a `--url`
// tells a foreign host — and swallowing that behind a three-line stub would make
// this fix a regression for the one command it could not improve.
if ((argv.includes("--help") || argv.includes("-h")) && command !== "brand") {
  const task = TASKS[command];
  console.log(`\n  node run.mjs ${command}\n`);
  console.log(`  ${task.help ?? "(no description)"}\n`);
  console.log(`  Full list: node run.mjs help   (machine-readable: --json)\n`);
  process.exit(0);
}

// 🚨 A near-miss of `--dry-run` on a command that WRITES by default.
// `content-apply` and `ds24-sync` append `--apply` unless the argument is
// exactly `--dry-run`, which is the documented convention and stays — but it
// makes `--dryrun`, `--dry_run` and `--dry` silent writes, and somebody typing
// any of those has said plainly what they wanted. So they are refused rather
// than swallowed. Narrow on purpose: it is a guard on one measured failure, not
// the flag validator this file cannot yet have.
const WRITES_UNLESS_DRY_RUN = new Set(["content-apply", "ds24-sync"]);
const nearMiss = argv.find((arg) => /^--dry/.test(arg) && arg !== "--dry-run");
if (nearMiss !== undefined) {
  console.error(`✗ Unknown flag: ${nearMiss}\n`);
  console.error(`  Did you mean --dry-run? Spelled any other way it is ignored.`);
  // 🚨 The consequence, and it is the OPPOSITE for the two conventions this
  // tree has. Saying "writes unless it reads --dry-run" about `setup-key` or
  // `user-create` — which write nothing without `--apply` — would be telling
  // somebody the alarming thing about the safe case, on the one question where
  // being wrong costs them.
  console.error(
    WRITES_UNLESS_DRY_RUN.has(command)
      ? `  ⚠️  ${command} WRITES unless it reads exactly --dry-run.`
      : `  ${command} writes nothing without --apply, so nothing happened.`,
  );
  console.error("");
  process.exit(2);
}

// takePort removes the flag from argv, so the rest passes through untouched.
const options = { port: takePort(argv) };

try {
  await runTask(command, argv, options);
} catch (error) {
  console.error(error?.message ?? error);
  process.exit(1);
}
