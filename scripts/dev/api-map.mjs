#!/usr/bin/env node
// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT
//
// api-map.mjs — the API map: the signatures behind every `lib/` file the
// guidance names, plus the tables, projected into `docs/api-map.md`.
//
// ── Why a generated map and not "read the file" ────────────────────────────
//
// The guidance names `lib/` files by path — "the entitlement API
// (`lib/entitlements/manage.ts`)" — and a path is a reading invitation. Measured
// over 26 field-test sessions (2026-09-03): `lib/entitlements/manage.ts` was
// read 24 times, 13,700 characters each, for the three signatures a page
// needs; the four `db/schema*.ts` files 44 times; `docs/entitlements.md`, which
// documents the same three functions under their own headings, zero times.
// Every one of those reads stayed in the session's context for every request
// after it. A map that sits where the path sits, and carries the signature,
// is what replaces the read; a map that is generated is the only kind that
// stays true.
//
// ── Why it is generated from the GUIDANCE's own list of files ──────────────
//
// Not from all of `lib/` (1,082 exports — a map of everything is itself a
// document nobody reads in full), and not from a list kept here (which would be
// the second copy of a fact). The files are the ones `CLAUDE.md` and the skills
// name by path, read out of those files at generation time — the same way
// `condensate-stamp.mjs` finds the docs it stamps. Name a new file in a skill
// and it is on the map at the next `node run.mjs api-map`; drop the mention and
// it leaves.
//
// `scripts/api-map.test.ts` compares the projection with the file on disk, so a
// new exported function without a regenerated map fails the suite instead of
// leaving the map quietly one function behind.
//
// Reads source as TEXT, so it goes through `blankComments()` — an
// `export function` inside a JSDoc example is prose, not an export. The summary
// line, on the other hand, IS a comment, and is taken from the original text at
// the position the blanked text located.
//
// Usage:
//   node run.mjs api-map            # write docs/api-map.md
//   node run.mjs api-map --check    # exit 1 when the file is behind the tree

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { blankComments } from "../lib/source-text.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, "..", "..");
export const MAP_PATH = "docs/api-map.md";

/** Every markdown file under a directory, recursively, as repo-relative posix paths. */
function markdownUnder(root, dir) {
  const out = [];
  const walk = (folder) => {
    for (const entry of readdirSync(join(root, folder), { withFileTypes: true })) {
      const rel = `${folder}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (entry.name.endsWith(".md")) out.push(rel);
    }
  };
  if (existsSync(join(root, dir))) walk(dir);
  return out;
}

/**
 * The `lib/` files the guidance names by path — `CLAUDE.md` and every markdown
 * file of every skill. Test files are left out (nobody is told to call one),
 * and a path that no longer exists is left out silently: a dangling mention is
 * `scripts/citations.test.mjs`'s finding, not this map's.
 */
export function namedLibFiles(root = ROOT) {
  const sources = ["CLAUDE.md", ...markdownUnder(root, ".claude/skills")];
  const found = new Set();
  for (const file of sources) {
    const path = join(root, file);
    if (!existsSync(path)) continue;
    for (const hit of readFileSync(path, "utf8").matchAll(/\blib\/[a-z0-9-]+(?:\/[a-z0-9-]+)*\.(?:ts|mjs)\b/g)) {
      const rel = hit[0];
      if (/\.test\.(?:ts|mjs)$/.test(rel)) continue;
      if (existsSync(join(root, rel)) && statSync(join(root, rel)).isFile()) found.add(rel);
    }
  }
  return [...found].sort();
}

/** The nearest comment above line `index` of the ORIGINAL text, as one sentence. */
function summaryAbove(lines, index) {
  let i = index - 1;
  while (i >= 0 && lines[i].trim() === "") i -= 1;
  if (i < 0) return "";
  const collected = [];
  if (/\*\/\s*$/.test(lines[i])) {
    // A JSDoc block: walk up to its opening, collect the body.
    let j = i;
    while (j >= 0 && !/^\s*\/\*\*/.test(lines[j])) j -= 1;
    if (j < 0) return "";
    for (let k = j; k <= i; k += 1) {
      const text = lines[k].replace(/^\s*\/\*\*?/, "").replace(/\*\/\s*$/, "").replace(/^\s*\*\s?/, "");
      collected.push(text);
    }
  } else if (/^\s*\/\//.test(lines[i])) {
    let j = i;
    while (j >= 0 && /^\s*\/\//.test(lines[j])) j -= 1;
    for (let k = j + 1; k <= i; k += 1) collected.push(lines[k].replace(/^\s*\/\/\s?/, ""));
  } else return "";
  // The first paragraph, then its first sentence. A JSDoc that opens with a tag
  // (`@param`) has no summary, and an empty string is the honest answer.
  const paragraph = collected.join("\n").trim().split(/\n\s*\n/)[0].replace(/\s+/g, " ").trim();
  if (paragraph === "" || paragraph.startsWith("@")) return "";
  const sentence = paragraph.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? paragraph;
  return sentence.length > 140 ? `${sentence.slice(0, 137).trimEnd()}…` : sentence;
}

/**
 * The exported functions of one source file: name, signature, summary, line.
 *
 * `export function` and `export async function` — the shape every `lib/` file
 * in this tree uses for what it offers. `export const` is deliberately not
 * listed: in the files the guidance names it is a constant or a table, and a
 * table's columns are the schema map's job below.
 */
export function exportsOf(source) {
  const blanked = blankComments(source);
  const blankedLines = blanked.split(/\r?\n/);
  const lines = source.split(/\r?\n/);
  const out = [];
  for (let i = 0; i < blankedLines.length; i += 1) {
    const head = blankedLines[i].match(/^export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/);
    if (!head) continue;
    // The signature runs from `export` to the `{` that opens the body — over as
    // many lines as the parameter list takes. Read off the blanked text so a
    // brace inside a comment cannot end it early.
    let depth = 0;
    let end = null;
    for (let j = i; j < blankedLines.length && end === null; j += 1) {
      for (const ch of blankedLines[j]) {
        if (ch === "(" || ch === "<") depth += 1;
        else if (ch === ")" || ch === ">") depth -= 1;
        else if (ch === "{" && depth <= 0) { end = j; break; }
      }
    }
    if (end === null) end = i;
    // Printed from the BLANKED lines too: a comment inside the parameter list
    // is spaces there, and collapses away below instead of landing in the map.
    const raw = blankedLines.slice(i, end + 1).join(" ");
    // `hasPlan(memberId: string, productKey: string): Promise<boolean>` — the
    // `function` keyword says nothing the signature does not, and `async` is
    // visible in the `Promise<…>` return type; both are dropped, 4 kB over the map.
    const signature = raw
      .replace(/\{[^]*$/, "")
      .replace(/^export\s+(?:async\s+)?function\s+/, "")
      .replace(/\s+/g, " ")
      .replace(/\(\s+/g, "(")
      .replace(/,\s*\)/g, ")")
      .replace(/\s+\)/g, ")")
      .trim();
    out.push({ name: head[1], signature, summary: summaryAbove(lines, i), line: i + 1 });
  }
  return out;
}

/**
 * The tables: every `pgTable("name", { … })` in `db/schema*.ts` and in each
 * module's `schema.ts`, with its column keys at depth one of the column object.
 * Indexes and constraints (the third argument) are not columns and are not
 * listed.
 */
export function tablesOf(source) {
  const blanked = blankComments(source);
  const out = [];
  for (const hit of blanked.matchAll(/export const ([A-Za-z0-9_$]+)\s*=\s*pgTable\(\s*"([a-z0-9_]+)"\s*,\s*\{/g)) {
    const columns = [];
    const types = {};
    let depth = 1;
    let at = hit.index + hit[0].length;
    let lineStart = true;
    let key = "";
    while (at < blanked.length && depth > 0) {
      const ch = blanked[at];
      if (ch === "{" || ch === "(" || ch === "[") depth += 1;
      else if (ch === "}" || ch === ")" || ch === "]") depth -= 1;
      if (depth === 1 && lineStart) {
        // Only the key on THIS line. `\s*` would run across the blank lines a
        // blanked comment leaves behind and count the next key once per line.
        // The builder after the colon is the column's TYPE — `numeric(`,
        // `integer(`, `text(`, an enum's name — and it is kept because one of
        // them changes what a page must do with the value (see `types`).
        const m = blanked.slice(at).match(/^[ \t]*([A-Za-z0-9_$]+)\s*:\s*([A-Za-z0-9_$]+)\s*\(/);
        if (m) { key = m[1]; columns.push(key); types[key] = m[2]; }
      }
      lineStart = ch === "\n";
      at += 1;
    }
    out.push({ constant: hit[1], table: hit[2], columns, types });
  }
  return out;
}

/** The schema files, in the order the map lists them. */
export function schemaFiles(root = ROOT) {
  const core = readdirSync(join(root, "db"))
    .filter((f) => /^schema.*\.ts$/.test(f) && !/\.test\.ts$/.test(f))
    .map((f) => `db/${f}`);
  const modules = existsSync(join(root, "modules"))
    ? readdirSync(join(root, "modules"), { withFileTypes: true })
        .filter((e) => e.isDirectory() && existsSync(join(root, "modules", e.name, "schema.ts")))
        .map((e) => `modules/${e.name}/schema.ts`)
    : [];
  return [...core.sort(), ...modules.sort()];
}

const PAGE_SHAPE = `## Page shape — what a protected page is made of

Read this before opening a shipped page as a model; then open a RANGE of the
model, never the file. Every dashboard page in this tree has the same four
parts, in this order, and each has a grep anchor:

1. **The guard, first line of the component** — \`requireActiveUser()\` for a
   member page, \`requireOwner()\` for an admin page (\`lib/authz.ts\` below).
   Model: \`app/dashboard/account/page.tsx\`, grep \`requireActiveUser\`.
2. **The access question, from the entitlement API** — \`hasPlan(memberId,
   productKey)\` for one feature, \`entitlementsFor(memberId)\` for the list;
   never a billing table. The worked snippet is
   \`.claude/skills/build-app/references/gating-examples.md\`.
3. **The query and the page** — \`<PageHeader>\` (\`components/page-header.tsx\`),
   then components from \`components/ui/\`; an \`<EmptyState>\` for the state most
   customers meet first.
4. **The actions, in \`actions.ts\` beside the page** — every server action opens
   with the same guard as the page, returns a CODE, and the page turns it into a
   sentence through next-intl. Model: \`app/dashboard/account/actions.ts\`, grep
   \`"use server"\`.

The navigation entry is one line in \`NAVIGATION\` (\`components/app-shell.tsx\`,
grep \`NAVIGATION\`) plus its label in every \`messages/<code>.json\` — find a key
with grep, never by reading a catalogue.

Three things a field run got wrong on the first app built with this map, each
now a rule in \`docs/ux.md\` and repeated here because this is where a page is
laid out:

- **Actions go straight into \`<PageHeader>\` as its children** — never inside a
  wrapper \`<div className="flex">\` of your own. The header's own container
  wraps at 390 px; your div does not, and the page scrolled sideways.
- **Your app's card is the FIRST card on \`/dashboard\`**, above the shipped
  "Das hast du" and "Abrechnung": a member came for the product, and on a phone
  the third card is below two scrolls (\`docs/ux.md\` → *0. What a page is built
  from*).
- **A table on a phone shows the column that IS the product first**, or becomes
  cards below \`sm:\`; and copy never says "rechts", "unten" or "links" — every
  layout stacks on a phone (\`docs/ux.md\` → *6. Small screens*, *4. Words*).

Five more from the second app, found by looking at it rather than at its
tests — \`docs/ux.md\` owns each, this is where they are needed:

- **Gated-Tool: the RESULT is a \`<Card>\` ABOVE the form, and the form keeps
  what was typed** (\`defaultValue\` from the last action state). Measured: the
  quote landed below the form, a phone had to scroll for it, and every field
  was empty again — changing one number meant retyping four.
- **Your app's card is the FIRST card on \`/dashboard\`**, with the state in it
  and the button. \`app/dashboard/overview-links.test.ts\` is red for a section
  of yours the overview never links; the order is the skill \`ux-gateway\`'s.
  Measured twice: "Basic (monthly) · not connected" was all a buyer saw.
- **A document the member hands to THEIR customer has a minimum form** —
  recipient, the member's own details, number and date, every position as
  quantity × unit price, a VAT line, and the member's voice ("Angebot Nr. 7"),
  never the app's ("Dein Angebot"). Measured: a 1.3 KB PDF with three totals
  and no m² anywhere, which nobody could send.
- **A gate sends the member to \`/plans?needs=<productKey>\`**, never to a bare
  \`/plans\`: the page then says which plan the click was waiting for. The
  parameter is a key the registry knows, never a sentence (\`app/plans/needs.ts\`).
- **Every \`<Input type="number">\` says its \`step\`** — \`"1"\` for a count,
  the unit's grain (\`0.01\` money and m², \`0.1\` km) otherwise, \`"any"\` when
  it does not matter; \`node run.mjs ux-check\` refuses one without. The
  browser's own refusal speaks the browser's language, so the binding range
  check lives in the action, translated.
`;

/**
 * A summary that names a billing table's column — `subscriptions.status`,
 * `orders.status` — is the function's own comment, quoted, and not a rule about
 * where access comes from. `lib/entitlements/instructions.test.ts` reads every
 * doc for exactly that shape and accepts the marker it defines on the same
 * line; a map that quotes a comment carries the marker so the reader of the
 * map is told the same thing the reader of the test is.
 */
const BILLING_MENTION = /\b(?:orders|subscriptions|invoices|grants|token_[a-z_]+)`?\.[a-z_]+/i;
function exemption(summary) {
  return BILLING_MENTION.test(summary) ? " <!-- not-an-access-check: a signature list quoting the function's own comment -->" : "";
}

/** The whole map as markdown. Pure over the tree; the CLI writes or compares it. */
export function renderApiMap(root = ROOT) {
  const files = namedLibFiles(root);
  const sections = [];
  let functions = 0;
  for (const file of files) {
    const exports = exportsOf(readFileSync(join(root, file), "utf8"));
    if (exports.length === 0) continue;
    functions += exports.length;
    const rows = exports.map((e) => `- \`${e.signature}\`${e.summary ? ` — ${e.summary}` : ""}${exemption(e.summary)}`);
    sections.push(`## ${file}\n\n${rows.join("\n")}\n`);
  }
  const tableSections = [];
  let tables = 0;
  for (const file of schemaFiles(root)) {
    const found = tablesOf(readFileSync(join(root, file), "utf8"));
    if (found.length === 0) continue;
    tables += found.length;
    // A column's type is shown only where it is not `text` — that is where a
    // page has to do something with the value before it can be shown.
    const shown = (t, c) => (t.types[c] && t.types[c] !== "text" ? `\`${c}\` (${t.types[c]})` : `\`${c}\``);
    const rows = found.map((t) => `- \`${t.table}\` (\`${t.constant}\`): ${t.columns.map((c) => shown(t, c)).join(", ")}`);
    tableSections.push(`### ${file}\n\n${rows.join("\n")}\n`);
  }

  return `# API map — the signatures behind the file names the guidance uses

<!-- GENERATED by \`node run.mjs api-map\` from the tree. Do not edit by hand:
     scripts/api-map.test.ts compares this file with what the generator
     produces, and a hand edit is undone by the next run. -->

_${files.length} files, ${functions} exported functions, ${tables} tables. Regenerate
with \`node run.mjs api-map\` after adding an export or a table; the suite says so
when it is behind._

**Read the section, not the file.** \`grep -n "^## " docs/api-map.md\` lists the
sections; each is one \`lib/\` file the guidance names, with every function it
exports and the first sentence of its comment. Open the source only when a
signature is not enough — and then a range around the function, never the whole
file. Measured over 26 field-test sessions before this map existed: the file
behind the first section below was read 24 times, 13,700 characters each, for
three signatures.

**In an app built on the template**, this file describes the template until
\`node run.mjs api-map\` has been run here; then it describes this app, your own
exports included, and \`node run.mjs update\` leaves it alone.

${PAGE_SHAPE}
${sections.join("\n")}
## Tables — every \`pgTable\` and its columns

Core schema first, then each module's. Columns only; indexes and constraints
live in the file. A table's column named \`memberId\` is the customer
(\`users.id\`); \`NULL\` means "not", a timestamp means "since when".

🚨 **A \`numeric\` column arrives as a STRING** — Drizzle hands you \`"40.00"\`,
not \`40\` — so it is formatted on the way out (\`useFormatter().number()\` /
\`getFormatter()\`, with a unit or \`style: "currency"\`), never rendered raw
and never \`toFixed\`-ed by hand; an input's \`defaultValue\` is formatted the
same way. Measured in a field run: \`{offer.areaSqm} m²\` printed \`40.00 m²\`
on a German quote beside a correctly formatted \`367,50 €\`. The rule is
\`docs/conventions.md\` → *Text, dates and prices*.

**And a table keyed on the member is personal data**: the moment it exists it
gets its row in \`docs/data-protection.md\` and its section in
\`lib/privacy/export.ts\` (a module: its \`privacy/sections\`), in the same
commit — \`lib/privacy/inventory.test.ts\` fails the build otherwise.

${tableSections.join("\n")}`;
}

// ── CLI ─────────────────────────────────────────────────────────────────────

// `--check` is a bare switch, not a `--flag value`, so it is read the way
// `run.mjs` reads its own (`has()`), and `flagsFrom()` is not involved.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rendered = renderApiMap();
  const target = join(ROOT, MAP_PATH);
  if (process.argv.includes("--check")) {
    const onDisk = existsSync(target) ? readFileSync(target, "utf8") : "";
    if (onDisk === rendered) {
      console.log(`✓ ${MAP_PATH} matches the tree`);
    } else {
      console.error(`✗ ${MAP_PATH} is behind the tree — run: node run.mjs api-map`);
      process.exit(1);
    }
  } else {
    writeFileSync(target, rendered);
    const files = (rendered.match(/^## lib\//gm) ?? []).length;
    console.log(`✓ wrote ${MAP_PATH} (${files} lib files, ${rendered.length} bytes)`);
  }
}
