// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Rung 5 — the defences that cost nothing to hold, read off this app's own files.
//
// Every other rung on this ladder asks somebody else: npm, OSV.dev, the public
// registry. This one asks nothing at all. Four questions, four answers, all of
// them out of files that are already in the repository:
//
//   are install scripts disabled                 .npmrc, key `ignore-scripts`
//   is package-lock.json committed               the file, and .gitignore
//   is the lockfile in sync with package.json    both files, compared
//   does every `overrides` entry have a reason   scripts/deps.test.ts
//
// So it **never skips for a reason a network could cause**, and that is the
// property it exists for: on a machine with no connection at all, this is the
// rung that still answers. The rungs that talk report `⏭ not asked` and say what
// nobody therefore looked at; this one reports what it found.
//
// ── 🚨 `npm ci --dry-run` DELETES node_modules. Measured. ──────────────────
//
// npm 9.2.0, 2026-08-10, in a throwaway folder with one dependency:
//
//     npm install         → node_modules has 1 entry
//     npm ci --dry-run    → prints "added 1 package in 41ms"
//                           → node_modules has 0 entries
//
// `--dry-run` is documented as "don't make any changes and only report what it
// would have done", and it keeps that promise about the INSTALL. The wipe `npm
// ci` starts with is not part of the install, so it happens anyway — and the
// success line above it says nothing about it. It really happened to this
// template's own tree while this rung was being written: a `security-check`
// left `node_modules` empty, and the next `npm run test` could not find vitest.
//
// A check that breaks the app it is checking is worse than no check. So the
// command runs **in a throwaway folder** holding a copy of `package.json`,
// `package-lock.json` and (where there is one) `.npmrc` — deleting a
// `node_modules` that was never there is a no-op, the question is unchanged
// because it is a question about those two files, and the folder is removed
// whatever happens. Never point this at the project directory again.
//
// ── The one place a partial inability is NOT a skip ────────────────────────
//
// The third question has a stronger version that npm can answer and this file
// cannot: `npm ci --dry-run` re-resolves the whole lockfile and refuses where
// `npm install` would quietly rewrite it. It is asked LAST and only as
// EVIDENCE. When npm cannot be reached, or is not on the PATH at all, the
// evidence line says so in words and **the rung's state does not change** —
// because the question the rung was asked has already been answered offline.
//
// That is a deliberate exception to the ladder's own doctrine, and the reason is
// the doctrine itself: skipping the whole rung over a stronger version of ONE of
// its four questions would throw away three local answers to a network that has
// nothing to do with them. "I could not look" must never read as "there is
// nothing there" — and here nobody is claiming to have looked at more than they
// did: the evidence line names exactly which half went unasked.
//
// ── Why the overrides question reads a TEST FILE ───────────────────────────
//
// `package.json` and `package-lock.json` are JSON and hold no comments, so an
// `overrides` entry looks like an arbitrary version to whoever reads it next.
// `scripts/deps.test.ts` is where this template declares that reasoning lives —
// its own header says so — so "is there a written reason" is answered by looking
// for the package's name in that file, comments and all.
//
// 🚨 **That file is read RAW, and it is the one checker in this project that
// must not call `blankComments()`.** The rule in CLAUDE.md (*a checker that reads
// source as TEXT goes through `blankComments()`*) exists so a file is not
// punished for documenting the thing it is checked against. Here the thing being
// looked for **is** a comment: blanking first would make every override in every
// app look undocumented, for ever. Do not "fix" this into the sixteenth copy of a
// rule that does not apply.
//
// Plain Node, no dependency — Linux, macOS and Git Bash on Windows. Everything
// read off disk is split on `/\r?\n/`; npm is started through `capture()`, never
// a shell, because on Windows npm is a `.cmd` shim and `spawnCommand()` is the
// only thing in this project allowed to know that. Nothing here runs at import
// time.
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { capture } from "../../lib/proc.mjs";

const SOURCE = "posture";

/** Where this template says the reasoning behind a dependency decision lives. */
const REASONS_FILE = "scripts/deps.test.ts";

/** How many names a `Where:` line spells out before it starts counting. */
const NAMED = 4;

// ── the pure half ───────────────────────────────────────────────────────────

/**
 * `a, b, c, d and N more` — the shape `whereOf()` in ./advisories.mjs uses.
 *
 * Bounded on purpose: a `Where:` line is one line, and a finding whose location
 * wraps over four lines is one nobody reads to the end of. The full list always
 * goes in the `Evidence:`, which has no such job.
 *
 * @param {string[]} names
 * @returns {string}
 */
export function whereList(names) {
  const sorted = [...new Set((names ?? []).map(String))].sort();
  const shown = sorted.slice(0, NAMED).join(", ");
  const more = sorted.length > NAMED ? ` and ${sorted.length - NAMED} more` : "";
  return `${shown}${more}`;
}

/**
 * Does an `.npmrc` switch install scripts off?
 *
 * npm's own spelling: `ignore-scripts=true`. Anything else — the key absent, set
 * to false, or no file at all — means a `postinstall` runs. Values npm treats as
 * true are `true` and `1`; everything else is false, and a value nobody can read
 * is not a protection anybody has.
 *
 * ⚠️ This reads the PROJECT's file only. npm also merges a per-user and a global
 * `.npmrc`, and one of those may well say the same thing — but a protection that
 * lives on one developer's machine is not one this app is holding, and the finding
 * says so rather than guessing at what is on the reader's disk.
 *
 * @param {string|null} text  the file's contents, or null when it is not there
 * @returns {boolean}
 */
export function ignoresScripts(text) {
  if (typeof text !== "string") return false;
  let answer = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith(";") || line.startsWith("[")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    if (line.slice(0, eq).trim() !== "ignore-scripts") continue;
    const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "").toLowerCase();
    answer = value === "true" || value === "1";
  }
  return answer;
}

/**
 * The packages this lockfile says run code at install time.
 *
 * Read out of the tree rather than written down here, because the list moves
 * with every dependency change and a list that moves is one that would be stale
 * in the sentence that quotes it. `hasInstallScript` is npm's own field.
 *
 * @param {any} lock
 * @returns {string[]}
 */
export function installScriptPackages(lock) {
  const names = new Set();
  for (const [key, entry] of Object.entries(lock?.packages ?? {})) {
    if (!entry?.hasInstallScript) continue;
    if (!key.includes("node_modules/")) continue;
    names.add(key.slice(key.lastIndexOf("node_modules/") + "node_modules/".length));
  }
  return [...names].sort();
}

/**
 * Install scripts are not switched off — ℹ️ LOW, and never higher.
 *
 * 🚨 The rating is the finding's whole design. `template/` ships no `.npmrc` at
 * all, so on a fresh app this question fails on day one — and a check whose first
 * run opens with a red mark about a default nobody chose is a check its reader
 * learns to scroll past. It is real (a `postinstall` runs with the developer's
 * own permissions, before a single line of the app has been read) and it is not a
 * launch blocker.
 *
 * And the `Fix:` names the MEASUREMENT rather than promising the change is free:
 * this tree really does have packages that build native code at install time, so
 * switching the flag on is something to try and then test, not a line to paste.
 *
 * @param {string|null} text            `.npmrc` contents, or null
 * @param {string[]} [installScripts]   names out of the lockfile
 * @returns {import("../rules.mjs").Finding[]}
 */
export function npmrcFindings(text, installScripts = []) {
  if (ignoresScripts(text)) return [];

  const affected = [...(installScripts ?? [])].sort();
  const measured =
    affected.length > 0
      ? `This lockfile carries hasInstallScript on ${whereList(affected)} — so ` +
        `switching it on is a change to MEASURE with \`npm ci\` and \`node run.mjs test\`, ` +
        `not a line to paste.`
      : `Nothing in this lockfile currently declares an install script, so the ` +
        `change is likely to cost nothing here — measure it with \`npm ci\` and ` +
        `\`node run.mjs test\` anyway.`;

  return [
    {
      severity: "low",
      title: "Install scripts are not switched off",
      where: ".npmrc",
      why:
        "A package's postinstall script runs with your own permissions, on your " +
        "machine, before a single line of this app has been read. `ignore-scripts=true` " +
        "takes that away from every dependency at once, and costs nothing to hold.",
      fix: `Put \`ignore-scripts=true\` in an .npmrc in this folder. ${measured}`,
      evidence:
        typeof text === "string"
          ? "There is an .npmrc here and it does not set ignore-scripts=true."
          : "There is no .npmrc in this project, so npm's default applies and install scripts run.",
      source: SOURCE,
    },
  ];
}

/**
 * Would `.gitignore` keep `package-lock.json` out of the repository?
 *
 * A deliberately small matcher, and its limits are the point: it reads THIS
 * file's lines only — not `.git/info/exclude`, not a user's global ignore file,
 * not a `.gitignore` in a parent folder. A pattern it cannot read is one it does
 * not claim to have matched, so the only mistake it can make is to under-report,
 * which is the safe direction for a finding rated ❌ HIGH.
 *
 * Negation (`!package-lock.json`) is honoured, because git honours it and a
 * matcher that did not would report a file as ignored that git happily tracks.
 *
 * @param {string|null} text
 * @param {string} [path]
 * @returns {boolean}
 */
export function gitignoresLockfile(text, path = "package-lock.json") {
  if (typeof text !== "string") return false;
  let ignored = false;

  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    const negated = line.startsWith("!");
    if (negated) line = line.slice(1).trim();
    // A trailing slash means "a directory", and a lockfile is not one.
    if (line.endsWith("/")) continue;
    const anchored = line.startsWith("/");
    if (anchored) line = line.slice(1);
    if (!line) continue;

    // Without a slash a pattern matches the BASENAME anywhere in the tree; with
    // one it is a path from the repository root. Both compare against the same
    // string here, since the file we ask about sits at the root.
    const subject = line.includes("/") || anchored ? path : path.split("/").pop();
    // One pass, so nothing this produces can be re-read as input by the next
    // step. A chain of `.replace()` calls needs a placeholder for `**`, and a
    // placeholder is a character somebody's filename eventually contains.
    // `\*\*` sits first in the alternation so it wins over the single `*`.
    const pattern = line.replace(/\*\*|[*?]|[.+^${}()|[\]\\]/g, (token) => {
      if (token === "**") return ".*";
      if (token === "*") return "[^/]*";
      if (token === "?") return "[^/]";
      return `\\${token}`;
    });
    if (new RegExp(`^${pattern}$`).test(String(subject))) ignored = !negated;
  }
  return ignored;
}

/**
 * The lockfile is not in the repository — ❌ HIGH.
 *
 * Without it every install re-resolves, so what a colleague, a CI run and a
 * deploy install is not what was tested here — and no advisory answer about
 * "the versions this app resolved" means anything, including three of the rungs
 * above.
 *
 * @param {boolean} present
 * @param {string|null} gitignoreText
 * @returns {import("../rules.mjs").Finding[]}
 */
export function lockfileCommittedFindings(present, gitignoreText) {
  const ignored = gitignoresLockfile(gitignoreText);
  if (present && !ignored) return [];

  return [
    {
      severity: "high",
      title: present
        ? "package-lock.json is here but .gitignore keeps it out of the repository"
        : "There is no package-lock.json in this project",
      where: present ? ".gitignore" : "package-lock.json",
      why:
        "Without a lockfile in the repository every install resolves afresh, so what " +
        "a colleague and a deploy install is not what was tested here. It also takes " +
        "the ground out from under the rest of this check: the advisory rungs answer " +
        "about the versions this app RESOLVED, and with no lockfile there are none.",
      fix: present
        ? "Take the line matching package-lock.json out of .gitignore and commit the file."
        : "Run `npm install` once and commit the package-lock.json it writes.",
      evidence: present
        ? "package-lock.json exists, and a .gitignore pattern matches it."
        : "No package-lock.json at the project root.",
      source: SOURCE,
    },
  ];
}

/**
 * Where `package.json` and the lockfile's root entry disagree.
 *
 * npm records this app's own declared ranges a second time, in
 * `packages[""]` — so the two can be compared with nothing installed and no
 * network at all. Three ways they part company, and all three mean the same
 * thing: the lockfile was written from a different `package.json` than the one
 * next to it.
 *
 * ⚠️ Ranges are compared as WRITTEN, never parsed. `^8.5.25` and `>=8.5.25` admit
 * different sets, and a comparison that treated them as equal would be inventing
 * an opinion about semver that npm does not share. The question here is only
 * whether the two files say the same thing.
 *
 * @param {any} pkg
 * @param {any} lock
 * @returns {{field: string, name: string, said: string}[]}
 */
export function lockfileDisagreements(pkg, lock) {
  const root = lock?.packages?.[""];
  if (!root) return [];
  const out = [];

  for (const field of ["dependencies", "devDependencies"]) {
    const mine = pkg?.[field] ?? {};
    const theirs = root?.[field] ?? {};
    for (const [name, range] of Object.entries(mine)) {
      if (!Object.hasOwn(theirs, name)) {
        out.push({ field, name, said: `package.json declares ${range}, the lockfile has no entry` });
      } else if (String(theirs[name]) !== String(range)) {
        out.push({ field, name, said: `package.json declares ${range}, the lockfile records ${theirs[name]}` });
      }
    }
    for (const name of Object.keys(theirs)) {
      if (!Object.hasOwn(mine, name)) {
        out.push({ field, name, said: `the lockfile records ${theirs[name]}, package.json declares nothing` });
      }
    }
  }
  return out;
}

/**
 * The lockfile does not describe this `package.json` — ❌ HIGH.
 *
 * @param {any} pkg
 * @param {any} lock
 * @returns {import("../rules.mjs").Finding[]}
 */
export function lockfileSyncFindings(pkg, lock) {
  const off = lockfileDisagreements(pkg, lock);
  if (off.length === 0) return [];

  return [
    {
      severity: "high",
      title: "package-lock.json does not describe this package.json",
      where: whereList(off.map((entry) => entry.name)),
      why:
        "`npm ci` — what a deploy runs — refuses a lockfile that does not match, so " +
        "this is a build that fails on the host and not here. `npm install` does the " +
        "opposite and quietly re-resolves, which means the versions a customer ends up " +
        "running were never the versions anybody tested.",
      fix:
        "Run `npm install` locally so npm rewrites package-lock.json from this " +
        "package.json, then commit BOTH files in the same change.",
      evidence: off.map((entry) => `${entry.field}.${entry.name}: ${entry.said}`).join("; "),
      source: SOURCE,
    },
  ];
}

/**
 * The package names in an `overrides` block.
 *
 * npm allows three spellings and this reads all of them: a plain name, a name
 * carrying a range (`"foo@1"`), and a nested block whose keys are the packages
 * that get overridden UNDER the outer one. A nested block's own `.` key is the
 * outer package's own version and names nothing new.
 *
 * @param {any} overrides
 * @returns {string[]}
 */
export function overrideNames(overrides) {
  const names = new Set();
  const walk = (block) => {
    for (const [key, value] of Object.entries(block ?? {})) {
      if (key === ".") continue;
      // `@scope/name@1.2.3` — the version is after the LAST `@`, and a scope's
      // own leading `@` is at position 0, so it can never be that one.
      const at = key.lastIndexOf("@");
      names.add(at > 0 ? key.slice(0, at) : key);
      if (value && typeof value === "object") walk(value);
    }
  };
  walk(overrides);
  return [...names].sort();
}

/**
 * Does `scripts/deps.test.ts` mention this package by name?
 *
 * Boundaries rather than a bare `includes`, or an override on `os` would be
 * "documented" by the word `cost`. The characters that may sit next to a name
 * are the ones that cannot be part of one.
 *
 * @param {string} source
 * @param {string} name
 * @returns {boolean}
 */
export function mentions(source, name) {
  const escaped = String(name).replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9@._/-])${escaped}([^A-Za-z0-9._/-]|$)`).test(String(source ?? ""));
}

/**
 * An override nobody wrote a reason for — ⚠️ MEDIUM.
 *
 * ONE finding for the question, never one per package: the tally line is what an
 * operator reads, and a run that turns four LOW-value lines into four entries
 * drowns whatever else is on the ladder.
 *
 * 🚨 `depsTestSource` arrives RAW — see this file's header. The reasons ARE the
 * comments.
 *
 * @param {any} pkg
 * @param {string} depsTestSource
 * @returns {import("../rules.mjs").Finding[]}
 */
export function overrideReasonFindings(pkg, depsTestSource) {
  const names = overrideNames(pkg?.overrides);
  if (names.length === 0) return [];

  const unexplained = names.filter((name) => !mentions(depsTestSource, name));
  if (unexplained.length === 0) return [];

  return [
    {
      severity: "medium",
      title: "An `overrides` entry has no written reason anywhere in this app",
      where: whereList(unexplained),
      why:
        "An override forces a version onto a package somebody else asked for. JSON " +
        "holds no comments, so to whoever reads it next it is an arbitrary number — " +
        "and the two things that happen to it are that it gets deleted as noise (and " +
        "whatever it was holding back comes back) or narrowed into a pin (and every " +
        "install starts printing ERESOLVE). A decision nobody can review is one " +
        "nobody can keep.",
      fix:
        `Write the reason into ${REASONS_FILE}, in the shape the entries already ` +
        `there have: what it was for, what happens without it, and what was tried ` +
        `and rejected. Where the reason genuinely cannot be recovered, say THAT plus ` +
        `what you measured about removing it — an honest "nobody recorded why" is a ` +
        `reason; an invented rationale is not.`,
      evidence: `${unexplained.join(", ")} — declared in package.json overrides, named nowhere in ${REASONS_FILE}.`,
      source: SOURCE,
    },
  ];
}

/**
 * What `npm ci --dry-run` said, as one sentence for the evidence line.
 *
 * Three answers, and they are three different sentences:
 *
 *   agreed          npm re-resolved the lockfile and had no complaint
 *   refused         npm named the sync refusal — that is a finding, above
 *   could not ask   npm is not here, or the registry is not. NOT a state change
 *
 * @param {{code: number, stdout: string, stderr: string}} result
 * @returns {{agreed: boolean, refused: boolean, said: string}}
 */
export function readCiDryRun(result) {
  const output = `${result?.stdout ?? ""}\n${result?.stderr ?? ""}`;
  const code = Number(result?.code ?? 1);
  if (code === 0) return { agreed: true, refused: false, said: "" };

  // npm's own sentence, and the code it prints beside it. Matched on the words
  // rather than on the exit status, because `npm ci` exits 1 for a network that
  // did not answer just as readily as for a lockfile that does not match.
  const SYNC = /can only install packages when your package\.json and package-lock\.json/i;
  const refused = SYNC.test(output) || (/EUSAGE/.test(output) && /package-lock\.json/i.test(output));

  // npm's own words, with its prefix taken off, and the prefix is not decoration:
  // 🚨 a failing `npm ci` prints a wall of `npm WARN ERESOLVE …` ABOVE its error,
  // measured on this tree, so "the first non-empty line" quotes a warning as if
  // it were the reason. Errors outrank warnings, the sentence outranks
  // `code EUSAGE`, and the evidence line quotes npm to a PERSON.
  const lines = output
    .split(/\r?\n/)
    .map((line) => {
      const match = /^npm\s+(error|ERR!|warn|WARN)\s*/i.exec(line);
      return {
        warning: /warn/i.test(match?.[1] ?? ""),
        text: (match ? line.slice(match[0].length) : line).trim(),
      };
    })
    .filter((line) => line.text.length > 0);

  const errors = lines.filter((line) => !line.warning).map((line) => line.text);
  const said =
    errors.find((text) => SYNC.test(text)) ??
    errors.find((text) => !/^code [A-Z_0-9]+$/.test(text)) ??
    errors[0] ??
    lines[0]?.text ??
    `npm exited ${code}`;

  return { agreed: false, refused, said };
}

/**
 * npm refuses this lockfile outright — ❌ HIGH, and npm's own sentence is the
 * evidence.
 *
 * The structural comparison above can miss this: it reads the ranges the two
 * files declare, where `npm ci` re-resolves the whole tree and refuses when the
 * lockfile could not have come from this `package.json`. When both fire, they are
 * two views of one problem and the operator fixes it once.
 *
 * @param {string} said
 * @returns {import("../rules.mjs").Finding[]}
 */
export function ciRefusalFindings(said) {
  return [
    {
      severity: "high",
      title: "`npm ci` refuses this lockfile",
      where: "package.json ↔ package-lock.json",
      why:
        "`npm ci` is what a deploy runs. Where it refuses, the deploy fails on the " +
        "host — and the tempting fix, `npm install`, silently re-resolves instead, so " +
        "the app that ships is one nobody has tested.",
      fix: "Run `npm install` locally, then commit package.json and package-lock.json together.",
      evidence: `npm ci --dry-run said: ${said}`,
      source: SOURCE,
    },
  ];
}

// ── the half that reads disk ────────────────────────────────────────────────

/** The file's text, or null when it is not there. Never a thrown error over a read. */
function textOf(file) {
  try {
    return existsSync(file) ? readFileSync(file, "utf8") : null;
  } catch {
    return null;
  }
}

/** Parsed JSON, or null. */
function jsonOf(file) {
  const text = textOf(file);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** The files `npm ci` needs to answer, and nothing else of this app. */
const CI_INPUTS = ["package.json", "package-lock.json", ".npmrc"];

/**
 * Ask npm whether it would re-resolve this lockfile — **outside the project**.
 *
 * See the header: `npm ci --dry-run` empties `node_modules` before it reports,
 * so it is run against a copy in the OS temp folder. Deleting a `node_modules`
 * that is not there costs nothing, and the question is a question about two
 * files.
 *
 * `mkdtempSync()` and not `mktemp` — the shell tool takes a template argument on
 * BSD/macOS and refuses one on GNU, and `scripts/portability.test.ts` fails the
 * build on it. The `.npmrc` travels because npm would read it (a private
 * registry, a `legacy-peer-deps`), and the whole folder is removed in a
 * `finally`.
 *
 * ⚠️ An app with npm WORKSPACES will get an honest "npm could not be asked"
 * here: the member packages are not in the copy. That is the right way round —
 * the structural comparison has already answered, and inventing a partial copy
 * of somebody's monorepo would be answering a different question.
 *
 * @param {string} cwd
 * @returns {Promise<{code: number, stdout: string, stderr: string}>}
 */
async function askNpmCi(cwd) {
  let scratch = "";
  try {
    scratch = mkdtempSync(join(tmpdir(), "ds24-security-ci-"));
    for (const name of CI_INPUTS) {
      const from = join(cwd, name);
      if (existsSync(from)) copyFileSync(from, join(scratch, name));
    }
    return await capture("npm", ["ci", "--dry-run"], { cwd: scratch });
  } catch (error) {
    // A temp folder that cannot be made is not a finding about this app.
    return { code: 1, stdout: "", stderr: String(error?.message ?? error) };
  } finally {
    if (scratch) {
      try {
        rmSync(scratch, { recursive: true, force: true });
      } catch {
        /* the OS clears its own temp folder */
      }
    }
  }
}

// ── the rung ────────────────────────────────────────────────────────────────

/** @type {import("../rules.mjs").Rung} */
export const posture = {
  id: "posture",
  label: "The defences that cost nothing to hold (this app's own files)",
  // Tier 1, and the only rung on the ladder that needs no network whatsoever:
  // every question it asks is answered by a file already in the repository.
  tier: 1,
  covers:
    "whether install scripts are switched off, whether the lockfile is committed and " +
    "describes this package.json, and whether every dependency override has a written reason",

  async run({ root } = {}) {
    const cwd = root ?? process.cwd();

    const pkg = jsonOf(join(cwd, "package.json"));
    if (!pkg) {
      // Not a network problem and not a state of the app: there is no project
      // here to ask about. Thrown rather than skipped, so check.mjs turns it into
      // a skip carrying this sentence — which is the honest answer.
      throw new Error("package.json could not be read, so nothing here could be asked");
    }

    const lockPath = join(cwd, "package-lock.json");
    const lock = jsonOf(lockPath);
    const npmrc = textOf(join(cwd, ".npmrc"));
    const gitignore = textOf(join(cwd, ".gitignore"));
    // 🚨 Read RAW — the reasons ARE the comments. See this file's header before
    // routing this through blankComments().
    const reasons = textOf(join(cwd, REASONS_FILE)) ?? "";

    const findings = [
      ...npmrcFindings(npmrc, installScriptPackages(lock)),
      ...lockfileCommittedFindings(existsSync(lockPath), gitignore),
      ...lockfileSyncFindings(pkg, lock),
      ...overrideReasonFindings(pkg, reasons),
    ];

    const read = [
      npmrc === null ? ".npmrc (absent)" : ".npmrc",
      lock === null ? "package-lock.json (absent or unreadable)" : "package-lock.json",
      "package.json",
      gitignore === null ? ".gitignore (absent)" : ".gitignore",
      reasons === "" ? `${REASONS_FILE} (absent)` : REASONS_FILE,
    ].join(", ");

    // LAST, and only as evidence. The structural comparison above has already
    // answered; this is npm's stronger version of one of the four questions, and
    // an npm that cannot answer must not cost the other three.
    // 🚨 In a throwaway folder, never here — see the header. It empties
    // node_modules, and it did so to this template's own tree once.
    let ci = " npm ci --dry-run was not asked: there is no package-lock.json to re-resolve.";
    if (lock !== null) {
      const answer = readCiDryRun(await askNpmCi(cwd));
      if (answer.agreed) {
        ci = " npm ci --dry-run, in a throwaway copy, re-resolved it without complaint.";
      } else if (answer.refused) {
        findings.push(...ciRefusalFindings(answer.said));
        ci = ` npm ci --dry-run, in a throwaway copy, refused it: ${answer.said}`;
      } else {
        // npm answered something, but not the question this rung asked — a
        // package that is not in the registry, a host that did not reply, no npm
        // on the PATH at all (`capture()` answers 127). Its own line goes in the
        // bracket so nobody has to guess which of those it was.
        ci =
          " npm could not be asked, so the in-sync answer is the structural one" +
          ` (npm said: ${answer.said}).`;
      }
    }

    return {
      state: findings.length > 0 ? "found" : "clean",
      findings,
      evidence: `Read ${read}.${ci}`,
    };
  },
};
