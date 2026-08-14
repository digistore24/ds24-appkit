// What is still missing before this app may meet a customer.
//
//   node run.mjs legal-check
//
// The counterpart to `ai-check`, `api-check` and `kb-check`, for the
// obligations in `docs/compliance.md`. Without a command like this the whole
// subject is an intention: a placeholder Impressum, a consent purpose with no
// wording behind it and a retention job that has never run all look exactly
// like a finished app from the outside.
//
// It reports; it never writes. The skill `compliance-check` is what fixes
// things, and `go-live` runs this before the app goes public.
//
// Plain Node, no bundler, no TypeScript, no dependency — Linux, macOS and Git
// Bash on Windows (CLAUDE.md, "Three systems").
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

// The registry, the language patterns and the problem codes — one copy, shared
// with `lib/ai/disclosure.test.ts` so the build guard and this report cannot
// disagree about a rule that has a legal deadline behind it.
import {
  DISCLOSURE_SURFACES,
  disclosureProblems,
  mountFor,
} from "../../lib/ai/disclosure.mjs";
// 🚨 The catalogue this command judges must be the one the APP renders. A
// module owns whole namespaces and carries its own texts — the companion's
// Art. 50 notice is in `modules/companion/messages/de.json` — so reading
// `messages/<locale>.json` alone reported a missing disclosure in every app
// with that module installed, for a sentence the app was showing perfectly.
// `composedMessages()` is the same merge `i18n/catalogue.ts` performs.
import { composedMessages } from "../modules/inventory.mjs";
// The two Digistore24 PLATFORM rules — not law, and that is what makes them
// worth a machine: breaking one produces no error and no unhappy customer, only
// a product refused at approval or an account closed months into selling.
import {
  RESELLER_SURFACES,
  durationClaims,
  namesReseller,
} from "../../lib/legal/digistore-claims.mjs";
import { blankComments } from "../lib/source-text.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** The marker a shipped placeholder carries — mirrors lib/legal/pages.ts. */
const PLACEHOLDER_MARKER = "<!-- ds24-appkit:placeholder -->";

/** Mirrors LEGAL_SLUGS in lib/legal/pages.ts. */
const LEGAL_SLUGS = ["impressum", "datenschutz", "agb", "widerruf"];

/** The two that are required of every app, whoever sells. */
const ALWAYS_REQUIRED = ["impressum", "datenschutz"];

/** The evidence pack `compliance-check` writes. See docs/compliance.md §1.3. */
const EVIDENCE = [
  ["verarbeitungsverzeichnis.md", "record of processing activities (Art. 30)"],
  ["tom.md", "technical and organisational measures (Art. 32)"],
  ["loeschkonzept.md", "deletion concept (Art. 5(1)(e), 17)"],
  ["avv-register.md", "processor agreements (Art. 28)"],
  ["ki-register.md", "AI systems, roles and Art. 50 measures"],
  ["ki-kompetenz.md", "AI literacy measures (Art. 4 AI Act)"],
  ["datenpanne.md", "data breach procedure (Art. 33, 34)"],
];

let problems = 0;
let warnings = 0;

const fail = (what, why) => {
  problems++;
  console.log(`  ❌ ${what}\n     ${why}`);
};
const warn = (what, why) => {
  warnings++;
  console.log(`  ⚠️  ${what}\n     ${why}`);
};
const ok = (what) => console.log(`  ✓ ${what}`);

function readJson(relative) {
  try {
    return JSON.parse(readFileSync(join(ROOT, relative), "utf8"));
  } catch {
    return null;
  }
}

/** A source file as text, or `null`. For "does anything actually render it?". */
function readSource(relative) {
  try {
    return readFileSync(join(ROOT, relative), "utf8");
  } catch {
    return null;
  }
}

function locales() {
  const dir = join(ROOT, "messages");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));
}

/**
 * The texts a customer really sees in one locale: the core's catalogue with
 * every installed module's merged in, exactly as the running app composes it.
 *
 * Every catalogue read in this file goes through here. The locales themselves
 * stay the CORE's — a module adds keys, never a language.
 */
function messagesFor(locale) {
  return composedMessages(locale, readJson(`messages/${locale}.json`) ?? {}, ROOT);
}

// ── 1. The legal pages ─────────────────────────────────────────────────────
console.log("\nLegal pages (content/legal/)");

const legalDir = join(ROOT, "content", "legal");
const written = [];

for (const slug of LEGAL_SLUGS) {
  const files = locales()
    .map((locale) => ({ locale, path: join(legalDir, `${slug}.${locale}.md`) }))
    .filter((f) => existsSync(f.path));

  if (files.length === 0) {
    if (ALWAYS_REQUIRED.includes(slug)) {
      fail(
        `/${slug} does not exist`,
        `Every app needs one, whoever sells. Run the skill compliance-check.`,
      );
    }
    // AGB and Widerruf are deliberately absent where Digistore24 resells —
    // saying nothing is the correct report, not a gap.
    continue;
  }

  written.push(slug);

  const placeholders = files.filter((f) =>
    readFileSync(f.path, "utf8").includes(PLACEHOLDER_MARKER),
  );

  if (placeholders.length === files.length) {
    fail(
      `/${slug} is still the shipped placeholder`,
      `It says so on the page, in a warning box, to every visitor. ` +
        `Run the skill compliance-check to write the real text.`,
    );
  } else if (placeholders.length > 0) {
    warn(
      `/${slug} is filled in for ${files.length - placeholders.length} of ${files.length} languages`,
      `Still a placeholder: ${placeholders.map((f) => f.locale).join(", ")}. ` +
        `The page falls back to the language that exists, so nobody sees a ` +
        `broken page — they see a finished policy in the wrong language.`,
    );
  } else {
    ok(`/${slug} (${files.map((f) => f.locale).join(", ")})`);
  }
}

// ── 2. Anything here that talks as a machine ───────────────────────────────
// The rule is not "the chat carries a notice" — it is *anything here that talks
// to a person as a machine says so*, and whatever AI surface is added next
// inherits it. So this walks a REGISTRY rather than asking about the assistant.
//
// The registry, the language patterns and the problem codes all live in
// `lib/ai/disclosure.mjs`, which `lib/ai/disclosure.test.ts` also reads. Until
// this story that rule existed twice — once as assertions, once as a regular
// expression right here with a comment admitting it was a copy. Two copies of a
// rule with a legal deadline attached is what this template does not do.
console.log("\nAI transparency (Art. 50(1) EU AI Act, since 2 August 2026)");

const problemsBySurface = new Map();
for (const problem of disclosureProblems({
  locales: locales(),
  messagesFor,
  sourceOf: readSource,
  configFor: readJson,
})) {
  if (!problemsBySurface.has(problem.surface)) problemsBySurface.set(problem.surface, []);
  problemsBySurface.get(problem.surface).push(problem);
}

for (const surface of DISCLOSURE_SURFACES) {
  const config = readJson(surface.configFile);

  // Switched off owes nothing, and saying so is the honest answer rather than a
  // pass. For the companion this is the shipped state.
  if (!surface.isOn(config)) {
    ok(`${surface.label}: switched off — nothing to disclose`);
    continue;
  }

  const found = problemsBySurface.get(surface.id) ?? [];

  // Report the locales that are fine, whether or not another one is not. The
  // first version of this made "all correct" and "one locale has no word
  // pattern" the same branch — so an app that added `messages/fr.json` was told
  // nothing at all about the German and English sentences this command had just
  // verified.
  const troubled = new Set(found.map((problem) => problem.locale).filter(Boolean));
  for (const locale of locales()) {
    if (troubled.has(locale)) continue;
    const line = messagesFor(locale)?.[surface.id]?.disclaimer;
    if (line) ok(`${surface.label} (${locale}): "${line}"`);
  }

  if (found.length === 0) continue;

  // A surface may add one sentence of its own to the refusal — the accepted
  // false positive it knows about and the core does not. The companion's is
  // "the switch says on and the registry may be empty"; its file is TypeScript
  // and this command has no bundler, so it cannot be asked.
  //
  // ⚠️ **Written by the surface, not by this file.** The clause used to live
  // here behind `surface.id === "companion"` — the core naming a module — and it
  // pointed at `lib/ai/companions.ts`, which stopped existing when the companion
  // became a module. So the one place this command tries hardest to be helpful
  // sent whoever hit it to a file that is not there. A surface that knows the
  // caveat also knows the path.
  const emptyRegistryClause =
    typeof surface.switchedOnHint === "string" ? ` ${surface.switchedOnHint}` : "";

  for (const problem of found) {
    if (problem.code === "missingKey") {
      fail(
        `${surface.label} (${problem.locale}): ${surface.id}.disclaimer is missing`,
        `It is switched on, so people must be told they are dealing with a ` +
          `machine at the latest at the first interaction. Add the key to ` +
          `messages/${problem.locale}.json.${emptyRegistryClause}`,
      );
    } else if (problem.code === "doesNotNameAMachine") {
      fail(
        `${surface.label} (${problem.locale}): ${surface.id}.disclaimer no longer says it is an AI`,
        `"${problem.text}" — whatever else it says, it has to say that. ` +
          `The skill compliance-check (check "ai") has the wording.`,
      );
    } else if (problem.code === "nothingRendersIt") {
      fail(
        `${surface.label}: the notice is written but nothing renders it`,
        `${problem.rendersIn} no longer mounts ${mountFor(surface.id)}. ` +
          `The sentence existing is not the same as the customer seeing it, and ` +
          `it has to be above the transcript, not under the input box.` +
          emptyRegistryClause,
      );
    } else {
      warn(
        `${surface.label} (${problem.locale}): cannot check the wording automatically`,
        `No word pattern for this language. Read it yourself: "${problem.text}"`,
      );
    }
  }
}

// ── 3. What the app PROMISES about access (Digistore24 product criteria) ──
//
// Digistore24 forbids promising a members' area "lebenslangen" access and names
// ten words to avoid, while allowing access to be limited to at most two years.
// Their reason costs money: an offer that is gone after 24 months can oblige
// the vendor to refund the full price.
//
// 🚨 The words are matched as STEMS with an ACCESS word in the same sentence —
// `lib/legal/digistore-claims.mjs` carries both halves and the reasoning. A bare
// word list would report "unbegrenzt viele Notizen", which is allowed, and a
// check that opens with a wall is one somebody switches off.
console.log("\nWhat this app promises about access (Digistore24 criteria)");

/** Everything a CUSTOMER reads, and where it comes from. */
function customerText() {
  const sources = [];

  for (const locale of locales()) {
    // 🚨 One entry per STRING, never the file as one blob. A message value is
    // the unit a customer reads, and a stringified catalogue makes the end of
    // one key and the start of the next into one "sentence": measured, that
    // reported five findings on this template — "unbegrenzt" from a grant hint
    // meeting "Zugriff" from the label two keys away. The composed catalogue,
    // so a module's own sales copy is judged too.
    for (const [path, value] of flatten(messagesFor(locale))) {
      sources.push([`messages/${locale}.json → ${path}`, value]);
    }
  }

  // The registry: name, tagline, description and the feature bullets are what
  // /plans renders. The `_comment` keys are not — they are notes to the
  // app-builder, and one of them says "unbegrenzt" about a rate limit.
  const registry = readJson("config/digistore-products.json");
  for (const [key, def] of Object.entries(registry?.products ?? {})) {
    const copy = [def?.name, def?.tagline, def?.description, ...(def?.features ?? [])]
      .filter((part) => typeof part === "string")
      .join("\n");
    if (copy) sources.push([`config/digistore-products.json → ${key}`, copy]);
  }

  for (const dir of ["content/legal", "content/knowledge"]) {
    for (const file of markdownUnder(dir)) {
      sources.push([file, readSource(file) ?? ""]);
    }
  }

  // Pages and components, with comments blanked — this app's own rule is that
  // there is no visible text in code, but a salespage is exactly where somebody
  // writes one anyway, and that is the page this rule is about.
  for (const file of sourceUnder(["app", "components", "modules"])) {
    sources.push([file, blankComments(readSource(file) ?? "")]);
  }

  return sources;
}

/**
 * Every string in a nested object, with the key path that leads to it.
 *
 * @param {unknown} value
 * @param {string} [prefix]
 * @returns {[string, string][]}
 */
function flatten(value, prefix = "") {
  if (typeof value === "string") return [[prefix, value]];
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, inner]) =>
    flatten(inner, prefix ? `${prefix}.${key}` : key),
  );
}

/** Every `.md` below a directory, relative to the app root. */
function markdownUnder(relative) {
  const found = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(join(ROOT, dir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const next = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(next);
      else if (entry.name.endsWith(".md")) found.push(next);
    }
  };
  walk(relative);
  return found;
}

/** Every `.ts`/`.tsx` below the given directories, tests excluded. */
function sourceUnder(dirs) {
  const found = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(join(ROOT, dir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const next = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") walk(next);
      } else if (/\.tsx?$/.test(entry.name) && !entry.name.includes(".test.")) {
        found.push(next);
      }
    }
  };
  for (const dir of dirs) walk(dir);
  return found;
}

let promises = 0;
let unjudged = 0;
for (const [where, text] of customerText()) {
  for (const claim of durationClaims(text)) {
    if (!claim.aboutAccess) {
      unjudged++;
      continue;
    }
    promises++;
    fail(
      `${where}: "${claim.term}" promises how long access lasts`,
      `"${claim.sentence.trim().slice(0, 160)}"\n     Digistore24's product ` +
        `criteria refuse this wording for a members' area, and access may be ` +
        `limited to at most two years. Write what is TRUE instead — "pay once, ` +
        `no subscription" for a one-off, "as long as your plan runs" for a ` +
        `subscription. docs/courses.md → Shape 1 carries their list and the reason.`,
    );
  }
}
if (promises === 0) {
  ok(
    `no promise about how long access lasts, in ${locales().length} language(s)`,
  );
}
// Said out loud rather than counted silently: these are the sentences carrying
// one of the ten words WITHOUT naming access — "unbegrenzt viele Notizen", a
// "Lifetime in days" form label. They are allowed, and the number is here so
// that nobody reads the tick above as "the words do not occur".
if (unjudged > 0) {
  console.log(
    `  … ${unjudged} sentence(s) carry one of the words about something other ` +
      `than access (a feature, a form label). Not a finding.`,
  );
}

// ── 3b. Who took the money (Digistore24 is the reseller) ──────────────────
//
// 🚨 Two halves, and either alone is a check that passes while the buyer reads
// nothing: the KEY in every language, and the MOUNT in the page. The same shape
// as the Art. 50 disclosure above, and for the same reason.
console.log("\nThe thank-you page names who charged (Digistore24 is the reseller)");

let unnamed = 0;
for (const surface of RESELLER_SURFACES) {
  const [namespace, key] = surface.key.split(".");
  const source = readSource(surface.rendersIn);

  if (source === null) {
    unnamed++;
    fail(
      `${surface.label}: ${surface.rendersIn} is missing`,
      `There is nothing left to carry the notice — and, on the thank-you page, ` +
        `nothing to catch the buyer at all.`,
    );
    continue;
  }

  // Comments blanked: the file explains the rule at length right above the
  // mount, and a checker that reads that as the mount would pass a page that
  // only TALKS about showing it.
  if (!blankComments(source).includes(surface.mount)) {
    unnamed++;
    fail(
      `${surface.label}: ${surface.rendersIn} no longer renders ${surface.mount}`,
      `The sentence is in the message files and nobody shows it. Digistore24 ` +
        `GmbH is the name on the buyer's bank statement, not yours: a line ` +
        `nobody recognises becomes a call to their bank rather than a mail to ` +
        `you, and a chargeback costs the sale, the fee and a mark on your account.`,
    );
    continue;
  }

  for (const locale of locales()) {
    const line = messagesFor(locale)?.[namespace]?.[key];
    if (typeof line !== "string" || !line.trim()) {
      unnamed++;
      fail(
        `${surface.label} (${locale}): ${surface.key} is missing`,
        `The page would render the key itself at a buyer.`,
      );
    } else if (!namesReseller(line)) {
      unnamed++;
      fail(
        `${surface.label} (${locale}): ${surface.key} does not name Digistore24`,
        `"${line}" — the one job of this sentence is the name that turns up on ` +
          `the bank statement. Any wording is fine as long as it says whose it is.`,
      );
    }
  }
}
if (unnamed === 0) {
  ok(
    `${RESELLER_SURFACES.length} surface(s) name Digistore24, in ` +
      `${locales().length} language(s) — a signed-in buyer never sees the ` +
      `thank-you page, which is why there are two`,
  );
}

// ── 4. Consent ─────────────────────────────────────────────────────────────
console.log("\nConsent (config/consent.json)");

const consent = readJson("config/consent.json");
const purposes = Array.isArray(consent?.purposes) ? consent.purposes : [];

if (!consent) {
  fail(
    "config/consent.json is missing or unreadable",
    "An unreadable file means no purposes at all, so anything gated on a " +
      "consent stays off. That is the safe direction, but it is not what you meant.",
  );
} else if (purposes.length === 0) {
  ok(
    "no purposes declared — correct as long as this app adds no tracking " +
      "and sends no marketing mail",
  );
} else {
  for (const purpose of purposes) {
    const key = purpose?.key;
    if (typeof key !== "string") {
      fail("a purpose has no key", JSON.stringify(purpose));
      continue;
    }
    if (!purpose?.textVersion) {
      fail(
        `purpose "${key}" has no textVersion`,
        `Without it, a consent given to the old wording silently counts as ` +
          `covering the new one.`,
      );
    }
    // The check an operator actually trips over: a purpose declared, the
    // wording forgotten, and the dialog rendering "consent.marketing_email.title"
    // at a customer.
    for (const locale of locales()) {
      const messages = messagesFor(locale);
      for (const part of ["title", "body"]) {
        if (typeof messages?.consent?.[key]?.[part] !== "string") {
          fail(
            `${locale}: consent.${key}.${part} is missing`,
            `The dialog would show the key itself to a customer.`,
          );
        }
      }
    }
  }
  if (problems === 0) ok(`${purposes.length} purpose(s) declared, all with wording`);
}

// ── 5. The evidence pack ───────────────────────────────────────────────────
console.log("\nEvidence (docs/compliance/) — GDPR Art. 5(2), accountability");

const evidenceDir = join(ROOT, "docs", "compliance");
const missing = EVIDENCE.filter(([file]) => !existsSync(join(evidenceDir, file)));

if (missing.length === EVIDENCE.length) {
  warn(
    "none of the evidence documents exist yet",
    `Accountability means being able to SHOW compliance, not only achieve it. ` +
      `Run the skill compliance-check — it writes them from what the code ` +
      `actually does rather than from a template.`,
  );
} else if (missing.length > 0) {
  for (const [file, what] of missing) warn(`docs/compliance/${file} is missing`, what);
  ok(`${EVIDENCE.length - missing.length} of ${EVIDENCE.length} written`);
} else {
  ok(`all ${EVIDENCE.length} written`);
}

// ── 5. Do the retention jobs actually run? ─────────────────────────────────
// The retention windows in a privacy policy are promises. This is the only
// check here that asks the database rather than the filesystem, because it is
// the only one whose answer is not on disk — and "last run: never" means the
// sentence you published is not describing what your app does.
console.log("\nRetention (the promises in your privacy policy)");

try {
  const { connect } = await import("../users/_db.mjs");
  const sql = connect();
  try {
    // Column names from db/schema-cron.ts: the primary key is `job`, and the
    // outcome is the text "ok" | "failed".
    const rows = await sql`select job, last_finished_at, last_outcome from cron_runs`;
    const byId = new Map(rows.map((r) => [r.job, r]));

    // `config/cron.json` keys its jobs by id — an OBJECT, not an array.
    const config = readJson("config/cron.json");
    const jobs = config?.jobs && typeof config.jobs === "object" ? config.jobs : {};
    const pruning = Object.entries(jobs).filter(
      ([id, job]) => id.startsWith("prune-") && job?.enabled !== false,
    );

    if (pruning.length === 0) {
      ok("no retention jobs enabled");
    } else {
      for (const [id] of pruning) {
        const row = byId.get(id);
        if (!row?.last_finished_at) {
          warn(
            `${id} has never run`,
            `Nothing is being deleted. If your privacy policy names a retention ` +
              `period, it is not currently true. Force one: node run.mjs cron --job ${id}`,
          );
        } else if (row.last_outcome === "failed") {
          fail(`${id} last failed`, `node run.mjs cron --list for the detail.`);
        } else {
          ok(
            `${id} last ran ${new Date(row.last_finished_at).toISOString().slice(0, 16)}`,
          );
        }
      }
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
} catch {
  // A database that is not up is not a compliance finding — it is a machine
  // that is off. Everything above still answered.
  console.log(
    "  … skipped: the database did not answer. Start the app and run this again.",
  );
}

// ── Verdict ────────────────────────────────────────────────────────────────
console.log("");
if (problems > 0) {
  console.log(
    `❌ ${problems} thing(s) must be fixed before this app meets a customer` +
      (warnings > 0 ? `, and ${warnings} worth looking at.` : "."),
  );
  console.log("   The guided path is the skill: compliance-check\n");
  process.exit(1);
}
if (warnings > 0) {
  console.log(`⚠️  ${warnings} thing(s) worth looking at. Nothing blocking.\n`);
} else {
  console.log("✓ Nothing missing.\n");
}
