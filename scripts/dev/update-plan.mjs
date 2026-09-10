// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What may an update touch, and what must it leave alone?
//
// This app is a COPY of a template that keeps being worked on. The code is the
// customer's from the moment they clone it, but the guidance is not: CLAUDE.md
// (and its twin AGENTS.md, for the programs that look for that name instead),
// the docs and the skills under `.claude/skills/` are how the agent knows what
// the app can do, and a copy of them from six months ago is how an agent ends up
// rebuilding by hand a feature that shipped in the meantime.
//
// So `node run.mjs update` refreshes the TEXT and never the code. Text cannot
// conflict with the pages somebody built; a lib/ file can.
//
// Everything difficult about that is one question — has this file been changed
// HERE? — and it is why `.template-version` records a hash per file as shipped:
//
//   current === shipped   the customer never touched it → safe to replace
//   current !== shipped   somebody edited it here → hands off, say so
//
// Getting that wrong in the permissive direction silently deletes the
// guardrails, house rules and hard-won notes that somebody wrote into their own
// CLAUDE.md — the single most valuable file in their repo. When in doubt this
// module refuses.
//
// Pure on purpose: no fetch, no fs, no clock. The shell around it is update.mjs.

/**
 * The text of a guidance file, with the line endings taken out before it is
 * hashed.
 *
 * A hash here answers one question — "is this file still the one that shipped?"
 * — and the answer must not depend on how the file happens to sit on this
 * disk. Git for Windows checks out CRLF by default, and without this every
 * single guidance file in a Windows clone hashes differently from its entry in
 * .template-version. The update would then report the whole tree as
 * `local-change` "edited in this app" and write nothing, for ever, to somebody
 * who never touched a line. On Linux and macOS it is a no-op.
 *
 * template/.gitattributes stops new clones from getting there in the first
 * place; this keeps the ones that already did from being stuck.
 */
export const normalizeText = (text) =>
  stripNextAgentRules(String(text ?? "").replace(/\r\n/g, "\n"));

/**
 * The block `next dev` appends to AGENTS.md on its own — a managed section
 * between `<!-- BEGIN:nextjs-agent-rules -->` and `<!-- END:nextjs-agent-rules -->`
 * (next 16, `node_modules/next/dist/server/lib/generate-agent-files.js`). It
 * is written on the customer's FIRST `node run.mjs start`, so without this
 * every fresh copy reported AGENTS.md as "edited in this app" from that
 * moment on and never received an update to it again (measured 2026-09-10 on
 * a clone nobody had touched). The block is Next's text, not ours; the hash
 * describes the guidance. Blank lines either side go with it so a file that
 * had the block and one that never did hash the same.
 */
const NEXT_AGENT_RULES = /\n*<!-- BEGIN:nextjs-agent-rules -->[\s\S]*?<!-- END:nextjs-agent-rules -->\n*/g;
export const stripNextAgentRules = (text) => {
  if (!text.includes("<!-- BEGIN:nextjs-agent-rules -->")) return text;
  const stripped = text.replace(NEXT_AGENT_RULES, "\n");
  return stripped.endsWith("\n") ? stripped : `${stripped}\n`;
};

/** `"1.10.0"` >= `"1.9.3"` — numerically, not as a string. */
export function versionAtLeast(have, want) {
  const parse = (v) =>
    String(v ?? "")
      .split(".")
      .map((part) => Number.parseInt(part, 10) || 0);
  const [a, b] = [parse(have), parse(want)];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return true;
}

/**
 * The `requires:` line from a skill's frontmatter, or `null` when it has none.
 *
 * A skill may need code that this copy does not have. Landing it anyway would be
 * the worst of both worlds: the agent reads a confident description of a feature
 * and then cannot find any of it.
 */
export function requiresFrom(text) {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text ?? "");
  if (!frontmatter) return null;
  const requires = /^requires:\s*"?([0-9]+(?:\.[0-9]+)*)"?\s*$/m.exec(frontmatter[1]);
  return requires ? requires[1] : null;
}

/**
 * Decide what happens to every file the remote manifest offers, plus the ones it
 * no longer has.
 *
 * @param local   {path: {current: sha|null, shipped: sha|null}} — `current` is
 *                null when the file is not on disk here.
 * @param remote  {path: sha} — the manifest from the site.
 * @param content {path: text} — only needed to read a skill's `requires:`;
 *                pass `{}` while planning without the bundle in hand.
 * @param codeVersion the version of the CODE in this copy (package.json).
 *
 * @returns entries `{ path, action, reason? }` with action one of:
 *   `new` | `update` | `unchanged` | `local-change` | `needs-code` | `withdrawn`
 */
export function planUpdate({ local, remote, content = {}, codeVersion }) {
  const plan = [];

  for (const [path, sha] of Object.entries(remote)) {
    const here = local[path] ?? { current: null, shipped: null };

    const requires = requiresFrom(content[path]);
    if (requires && !versionAtLeast(codeVersion, requires)) {
      // Not a failure and not something the customer can fix by trying again:
      // the text belongs to code this copy does not carry.
      plan.push({
        path,
        action: "needs-code",
        reason: `needs template ${requires}, this app is ${codeVersion}`,
      });
      continue;
    }

    if (here.current === null) {
      plan.push({ path, action: "new" });
      continue;
    }
    if (here.current === sha) {
      plan.push({ path, action: "unchanged" });
      continue;
    }
    if (here.shipped === null || here.current !== here.shipped) {
      plan.push({
        path,
        action: "local-change",
        reason: here.shipped === null ? "not in .template-version" : "edited in this app",
      });
      continue;
    }
    plan.push({ path, action: "update" });
  }

  // Files this copy has and the template no longer ships. Reported, never
  // deleted: a skill we withdrew may be the one somebody built their week on.
  for (const [path, here] of Object.entries(local)) {
    if (path in remote || here.current === null) continue;
    plan.push({ path, action: "withdrawn" });
  }

  return plan;
}

/**
 * The paths an `--apply` would actually write.
 *
 * ⚠️ This asks about the ACTION only, and it is shared with `export-core`, which
 * copies `.ts` files into a companion repo. WHERE a guidance update may write is
 * a second question with its own answer below — `guidanceWritable()`. Do not
 * fold the two together: tightening this one would quietly stop the core export.
 */
export function writable(plan) {
  return plan.filter((entry) => entry.action === "new" || entry.action === "update");
}

// ── what an update is allowed to write ──────────────────────────────────────
//
// The manifest `node run.mjs update` reads names the paths it wants written,
// and that manifest is not ours to trust: it comes over the network, and the
// address it comes FROM lives in `.template-version` — a git-tracked file in
// THIS app. Whoever lands a commit there (a contributor, a pull request, an
// agent that read the wrong page) otherwise decides where the next `--apply`
// writes. `.git/hooks/pre-commit` is code that runs at the next commit; `.env`
// is every secret this app has.
//
// So the rule is an ALLOWLIST and never a list of exclusions: a new way of
// naming somewhere dangerous has to fail closed. It is written out here rather
// than derived from anything, because the only file that could answer "which
// paths belong to the template?" is the manifest — the very file this list
// exists to distrust.
//
// The set is the one the template's knowledge stamp records in
// `.template-version`: CLAUDE.md, its twin AGENTS.md (the name Codex,
// Antigravity and OpenCode look for), README.md, the docs, and the skills under
// both skill roots. Counted on the shipped manifest when this went in: 151
// entries, every one of them a `.md` file in one of those six places, none
// anywhere else. Which is why the extension is part of the rule too.

/** Directories an update may write inside. The trailing `/` is load-bearing. */
export const GUIDANCE_ROOTS = ["docs/", ".claude/skills/", ".agents/skills/"];

/** The three files at the top of the tree an update may replace. */
export const GUIDANCE_FILES = ["AGENTS.md", "CLAUDE.md", "README.md"];

/**
 * May `node run.mjs update` write this path?
 *
 * Judged as TEXT, segment by segment, and deliberately not through
 * `path.resolve()`: the answer must be the same on all three systems, and a
 * resolve-and-compare answers it in the terms of whichever machine happens to
 * be asking. A manifest is written with `/` separators on every platform, so
 * anything else in it is not a path this check can reason about — `..\..\x`
 * reads as one harmless filename here and leaves the tree on Windows.
 */
export function isGuidancePath(file) {
  if (typeof file !== "string" || file === "") return false;
  if (!file.endsWith(".md")) return false;
  if (file.includes("\\") || file.includes("\0")) return false;

  // An empty segment catches a leading `/` (absolute), a trailing one and `//`;
  // `.` and `..` catch every way of walking out of the tree; a `:` catches
  // `C:/x` and the drive-relative `C:x`, which both leave this directory on
  // Windows and neither of which looks unusual here.
  const segments = file.split("/");
  if (segments.some((s) => s === "" || s === "." || s === ".." || s.includes(":"))) return false;

  if (GUIDANCE_FILES.includes(file)) return true;
  // `startsWith("docs/")` and not `startsWith("docs")` — the second would also
  // accept `docs-evil/whatever.md`, a directory of somebody else's choosing
  // sitting next to ours.
  return GUIDANCE_ROOTS.some((root) => file.startsWith(root));
}

/**
 * `writable()` with the allowlist applied — and it THROWS rather than filters.
 *
 * 🚨 Skipping the offending entry would be the wrong shape. A manifest that
 * offers a path outside the guidance tree is not "mostly fine": it is one that
 * nothing in it can be believed from, and applying the rest would leave this app
 * with half an update and no way to see which half. `update.mjs` refuses the
 * whole run, with a readable message, long before it gets here — this is the
 * layer underneath, so a caller who forgets to ask cannot write anyway.
 */
export function guidanceWritable(plan) {
  const entries = writable(plan);
  for (const entry of entries) {
    if (!isGuidancePath(entry.path)) {
      throw new Error(`refusing to write "${entry.path}" — not a guidance path`);
    }
  }
  return entries;
}

/**
 * Does this answer to "write it? [y/N]" mean yes?
 *
 * Only an explicit yes counts. Everything else — an empty line, a stray
 * character, a copy-pasted command — is a no, because the question guards a
 * write and the safe reading of an unclear answer is "leave everything alone".
 */
export function confirmsApply(answer) {
  return ["y", "yes"].includes(String(answer ?? "").trim().toLowerCase());
}
