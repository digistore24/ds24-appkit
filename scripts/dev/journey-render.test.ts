// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What the user actually READS — measured, not described.
//
// PURE, on the same contract as `./journey.test.ts`: every fixture is a hand-built
// `facts` object put through `journeyState()`, and the renderer is handed the
// result. No filesystem, no clock, no spawn — a test that ran the real command
// would measure this checkout rather than the rules, and would go green or red
// with whatever somebody left in `docs/reports/`.
//
// Each rule the renderer obeys has a failure behind it (`./journey-render.mjs`
// carries the arguments), so each one is asserted here with a NEEDLE beside it —
// a second fixture proving the assertion can come out the other way. An output
// that always printed one `Next:` line by printing none would satisfy half of
// this file otherwise.
import { describe, expect, it } from "vitest";

import { journeyState } from "./journey.mjs";
import {
  describeJourney,
  describeJourneyLine,
  describeNext,
  groupRows,
  journeyJson,
} from "./journey-render.mjs";

const NOW = Date.parse("2026-08-11T12:00:00.000Z");
const daysAgo = (days: number) => new Date(NOW - days * 86_400_000).toISOString().slice(0, 10);

type Facts = Parameters<typeof journeyState>[0];

function state(over: Partial<NonNullable<Facts>> = {}) {
  return journeyState({
    now: NOW,
    version: "99.0.0",
    exists: {},
    text: {},
    json: {},
    dirs: {},
    env: {},
    reportNames: [],
    modules: [],
    ...over,
  });
}

/** Written legal texts — every fixture past phase 2 needs them or 2.8 stays open. */
const LEGAL = {
  "content/legal/impressum.de.md": "Kraftwerk GmbH",
  "content/legal/impressum.en.md": "Kraftwerk GmbH",
  "content/legal/datenschutz.de.md": "Wir verarbeiten …",
  "content/legal/datenschutz.en.md": "We process …",
};

/** A fresh clone: nothing built, nothing measured, no module installed. */
const FRESH = state();

/** Halfway through phase 2 — pages, a checkout, no gate run yet. */
const MID = state({
  exists: { "docs/product-brief.md": true, "docs/plan.md": true, "docs/design.md": true },
  dirs: { "app/dashboard": { entries: ["account", "coaching"], moduleOwned: [] } },
  env: { DIGISTORE_API_KEY: "k", DIGISTORE_IPN_PASSPHRASE: "p", DIGISTORE_IPN_DOMAIN_ID: "d" },
  text: { "app/page.tsx": 'const included = [{ term: "features.authTitle" }]' },
});

/**
 * Deployed: a real domain, every gate run — and therefore in **phase 4**.
 *
 * 🚨 This fixture used to be one phase lower, and the hand-built `PHASE_4` object
 * that stood here carried the reason as an apology: `journeyState()` could not
 * produce `currentPhase: "betrieb"` from ANY facts, because 3.1 (`setup-hosting`)
 * is a `kind: "ask"` row, `unknown` is an OPEN state, and phase 3 therefore never
 * cleared however live the app was. 3.1 is now settled by 3.2 (`impliedBy` in
 * `./journey.mjs` — you cannot be live on a real domain without a host), so the
 * renderer is handed a real derivation instead of a shape somebody typed.
 *
 * `READY` below is the same app one value earlier, and it is the needle: with
 * `APP_URL` still on localhost nothing implies 3.1 and phase 3 is current again.
 */
const LIVE = state({
  exists: { "docs/product-brief.md": true, "docs/plan.md": true },
  dirs: { "app/dashboard": { entries: ["coaching"], moduleOwned: [] } },
  env: {
    DIGISTORE_API_KEY: "k",
    DIGISTORE_IPN_PASSPHRASE: "p",
    DIGISTORE_IPN_DOMAIN_ID: "d",
    APP_URL: "https://kraftwerk.example",
  },
  text: { "app/page.tsx": "<Hero>Lose ten kilos</Hero>", ...LEGAL },
  reportNames: [
    `ux-${daysAgo(9)}.md`,
    `security-${daysAgo(9)}.md`,
    `performance-${daysAgo(9)}.md`,
  ],
});

/** The same app the day before the launch: everything built, `APP_URL` still local. */
const READY = state({
  exists: { "docs/product-brief.md": true, "docs/plan.md": true },
  dirs: { "app/dashboard": { entries: ["coaching"], moduleOwned: [] } },
  env: {
    DIGISTORE_API_KEY: "k",
    DIGISTORE_IPN_PASSPHRASE: "p",
    DIGISTORE_IPN_DOMAIN_ID: "d",
    APP_URL: "http://localhost:3000",
  },
  text: { "app/page.tsx": "<Hero>Lose ten kilos</Hero>", ...LEGAL },
  reportNames: [`ux-${daysAgo(9)}.md`, `security-${daysAgo(9)}.md`, `performance-${daysAgo(9)}.md`],
});

const lines = (text: string) => text.split("\n");

// ── The shape is there at all ───────────────────────────────────────────────

describe("the human view", () => {
  it("opens with the phase count, where they are, and the optional promise", () => {
    // Non-vacuity for everything below: a renderer answering `""` would satisfy
    // most "does not contain" assertions in this file perfectly.
    const out = lines(describeJourney(FRESH, { appName: "Zuschnitt" }));
    expect(out[0]).toBe("Zuschnitt — four phases. You are in phase 1.");
    expect(out[1]).toContain("Every step is optional");
    expect(out.length).toBeGreaterThan(15);
  });

  it("omits the name rather than printing a placeholder", () => {
    // `lib/app.ts` falls back to "Your App", and a placeholder in the position of
    // a name reads as the app being called that. So: name it, or say nothing.
    expect(lines(describeJourney(FRESH))[0]).toBe("Four phases. You are in phase 1.");
  });

  it("names all four phases, in order, with their numbers", () => {
    const out = describeJourney(MID);
    for (const [num, title] of [[1, "PLAN"], [2, "BUILD"], [3, "GO LIVE"], [4, "RUN IT"]] as const) {
      expect(out, `phase ${num}`).toContain(`  ${num}  ${title} —`);
    }
  });
});

// ── ONE next line ───────────────────────────────────────────────────────────

describe("exactly one Next: line", () => {
  it("prints one, in every fixture, with a reason and an offer", () => {
    // 🚨 Coach's rule 1: one next step, never a catalogue. Somebody who asks what
    // to do next is already unsure, and fourteen options is not an answer.
    for (const [name, s] of [["fresh", FRESH], ["mid", MID], ["live", LIVE]] as const) {
      const out = describeJourney(s);
      const starts = lines(out).filter((line) => line.startsWith("Next:"));
      expect(starts, `${name}: Next: lines`).toHaveLength(1);
      expect(out, `${name}: an offer`).toMatch(/Shall I .+\?$/);
    }
  });

  it("draws the reason from the row's own evidence", () => {
    // Not from a sentence written in advance: a prepared reason can describe a
    // state the app is not in, and this one cannot.
    // ⚠️ Quoted verbatim, not sentence-cased: the evidence routinely begins with a
    // path or a command, and `Node run.mjs` is not a command anybody can type.
    expect(describeNext(FRESH)).toContain("no docs/plan.md yet");
    expect(describeNext(MID)).toContain("app/page.tsx is still the template");
  });

  it("says so when nothing the path asks for is outstanding", () => {
    // The needle: `next === null` must not print a blank where the next step goes,
    // or "everything is answered" and "this command is broken" look the same.
    const done = state({
      exists: { "docs/plan.md": true },
      dirs: { "app/dashboard": { entries: ["coaching"], moduleOwned: [] } },
      env: {
        DIGISTORE_API_KEY: "k",
        DIGISTORE_IPN_PASSPHRASE: "p",
        DIGISTORE_IPN_DOMAIN_ID: "d",
        APP_URL: "https://kraftwerk.example",
      },
      text: { "app/page.tsx": "sells", ...LEGAL },
      reportNames: [
        `ux-${daysAgo(2)}.md`,
        `security-${daysAgo(2)}.md`,
        `performance-${daysAgo(2)}.md`,
        `operations-${daysAgo(2)}.md`,
      ],
    });
    // `setup-hosting` is a `kind: "ask"` row and stays outstanding — that is the
    // honest answer, so the "nothing left" sentence is asserted on its own.
    expect(describeNext({ rows: [], currentPhase: null, next: null })).toContain(
      "nothing the path asks for is outstanding",
    );
    expect(lines(describeJourney(done)).filter((l) => l.startsWith("Next:"))).toHaveLength(1);
  });

  it("🚨 never proposes a row whose code is not in this copy — and says why it cannot", () => {
    // Two halves of one rule. The row PRINTS the refusal and the command that
    // would lift it, and it is never what `Next:` names: `OPEN_STATES` excludes
    // `needs-newer-template` one layer down, so being routed at a feature whose
    // code is absent is impossible rather than merely unlikely.
    const old = state({ version: "0.1.0", exists: { "docs/plan.md": true } });
    const out = describeJourney(old);
    expect(out).toContain("needs a newer template");
    expect(out).toContain("node run.mjs update");
    const refused = old.rows.filter((row) => row.state === "needs-newer-template");
    expect(refused.length).toBeGreaterThan(5);
    expect(refused.map((row) => row.step)).not.toContain(old.next?.step);
    // …and no refused row's title ever appears in the Next: sentence.
    for (const row of refused) expect(describeNext(old)).not.toContain(row.title.en);
  });

  it("names the operating round in a phase-4 app", () => {
    // 🚨 The fixture is DERIVED, not hand-built: `LIVE` is a facts object, and
    // `currentPhase: "betrieb"` comes out of the state machine because 3.2 settles
    // 3.1. Asserted here rather than assumed, because this line is the whole
    // difference between the renderer being asked a hypothetical question and
    // being asked a real one.
    expect(LIVE.currentPhase).toBe("betrieb");
    const out = describeJourney(LIVE);
    expect(lines(out).filter((line) => line.startsWith("Next:"))).toHaveLength(1);
    expect(out).toContain("4  RUN IT");
    expect(describeNext(LIVE)).toContain("the operating round");
    // …and the row nobody could ever tick reads its reason rather than a bare tick.
    expect(out).toContain("3.2 go live is done");
  });

  it("🚨 needle: the same app one value earlier is still in phase 3", () => {
    // Without the implication this is what every deployed app looked like for
    // ever. Here it is the honest answer to a genuinely different question: with
    // `APP_URL` on localhost, 3.2 is open, so nothing settles 3.1 and the next
    // step is the server.
    expect(READY.currentPhase).toBe("live");
    expect(describeNext(READY)).toContain("set the server up");
    expect(describeJourney(READY)).toContain("← you are here");
  });
});

// ── The shelf ───────────────────────────────────────────────────────────────

describe("the 2.3 shelf", () => {
  const out = describeJourney(MID);

  it("prints a count and a question, never its eleven rows", () => {
    // 🚨 Eleven optional things most apps do not want, listed in order, is a
    // checklist — and a checklist is what makes somebody build a mobile app for a
    // product nobody has bought yet.
    expect(out).toContain("2.3  what else it can do");
    expect(out).toMatch(/0 of 11 taken/);
    expect(out).toContain('Ask "what else can it do?"');
    for (const letter of "abcdefghijk") {
      expect(out, `2.3${letter} must not appear as a row`).not.toContain(`2.3${letter}`);
    }
  });

  it("names at most five of the remaining steps", () => {
    // The second door is a QUESTION the user can ask, so the line names a handful
    // and stops. A line that grows with the shelf is the shelf.
    const all = lines(out);
    const at = all.findIndex((line) => line.includes("more steps are available here"));
    expect(at).toBeGreaterThan(0);
    const block = all.slice(at, at + 3).join(" ").replace(/\s+/g, " ");
    expect(block).toMatch(/and \d+ others/);
    expect(block.split(",").length).toBeLessThanOrEqual(7);
  });

  it("counts what has been taken", () => {
    // The needle for the count: a shelf that always said `0 of 11` would be
    // telling an app with a community and a course that it has neither.
    const withModules = state({
      exists: { "docs/product-brief.md": true, "docs/plan.md": true },
      dirs: { "app/dashboard": { entries: ["coaching"], moduleOwned: [] } },
      modules: ["community", "courses"],
    });
    expect(describeJourney(withModules)).toMatch(/2 of 11 taken/);
  });

  it("leaves a lettered step with no siblings as a step of its own", () => {
    // 🚨 Three, not one: `2.2b` (`billing-modes`) is a lettered step with no
    // siblings and a real step, while `2.3a`–`2.3j` are ten faces of ONE decision
    // point. Folding by "has a letter" would hide a step; folding on a hard-coded
    // "2.3" would stop working the day somebody renumbers.
    expect(out).toContain("2.2b");
    const grouped = groupRows(MID.rows.filter((row) => row.phase === "bauen"));
    expect(grouped.filter((entry) => entry.kind === "shelf")).toHaveLength(1);
    expect(grouped.filter((entry) => entry.kind === "row").map((entry) => entry.row.step)).toContain(
      "2.2b",
    );
  });
});

// ── Declined, blocked, unknown ──────────────────────────────────────────────

describe("a recorded no stays visible", () => {
  it("prints it with its date, so it can be revoked", () => {
    // *"A recorded 'no' is an answer"* cuts both ways: never re-proposed, and never
    // hidden either — a refusal nobody can see is a refusal nobody can revoke.
    const declined = state({
      exists: { "docs/plan.md": true },
      text: { "docs/app.md": "- 2026-08-09 No custom identity — the shipped look is fine." },
      dirs: { "app/dashboard": { entries: ["coaching"], moduleOwned: [] } },
    });
    const out = describeJourney(declined);
    expect(out).toContain("you said no, 2026-08-09");
    expect(out).toContain("–  choose the look");
    // …and it is never the next step.
    expect(describeNext(declined)).not.toContain("choose the look");
  });
});

describe("a module that is not installed", () => {
  it("says so and names the command that would install it", () => {
    const shelf = MID.rows.find((row) => row.skill === "community")!;
    expect(shelf.state).toBe("blocked");
    expect(shelf.evidence).toContain("node run.mjs module add community");
  });

  it("says could not look — never not installed — when the list is unreadable", () => {
    // `operate` keeps *checked* and *could not be checked* in two columns and this
    // is held to the same rule.
    const unknown = state({ modules: null, exists: { "docs/plan.md": true } });
    const row = unknown.rows.find((r) => r.skill === "community")!;
    expect(row.evidence).toContain("could not look");
    expect(row.evidence).not.toContain("not installed");
  });
});

// ── Collapse, and never dragging an app backwards ───────────────────────────

describe("the picture fits one screen", () => {
  it("collapses an unreached phase to a header plus its numbers", () => {
    const out = lines(describeJourney(FRESH));
    const at = out.findIndex((line) => line.includes("GO LIVE"));
    expect(at).toBeGreaterThan(0);
    // Header, then the folded step list, then a blank line — never one line per row.
    const block = out.slice(at + 1, out.indexOf("", at + 1));
    expect(block.join(" ")).toContain("3.1 set the server up · 3.2 go live");
    expect(block.length).toBeLessThanOrEqual(3);
  });

  it("keeps the whole thing inside a screen", () => {
    // A picture that scrolls is one nobody reads to the end of, and the end is
    // where the next step is. ⚠️ 100 columns rather than 80: a phase header
    // carries its blurb AND its status, and the alternative is truncating a
    // sentence, which this renderer never does.
    for (const [name, s] of [["fresh", FRESH], ["mid", MID], ["ready", READY], ["live", LIVE]] as const) {
      const out = lines(describeJourney(s));
      expect(out.length, `${name}: ${out.length} lines`).toBeLessThanOrEqual(40);
      const longest = Math.max(...out.map((line) => line.length));
      expect(longest, `${name}: longest line ${longest}`).toBeLessThanOrEqual(100);
    }
  });

  it("never proposes an earlier phase's optional row once a later one has moved", () => {
    // 🚨 A live app is not dragged back to branding. The row is a RECORD — "not
    // taken" — rather than an invitation.
    const out = describeJourney(LIVE);
    expect(LIVE.currentPhase).toBe("betrieb");
    expect(out).toContain("not taken");
    expect(describeNext(LIVE)).not.toContain("choose the look");
    // The phase it belongs to still shows the row: hiding it would be the other
    // failure, an app whose history disappears as it progresses.
    expect(out).toContain("choose the look");
  });

  it("marks the current phase and only the current phase", () => {
    for (const s of [FRESH, MID, READY, LIVE]) {
      const here = lines(describeJourney(s)).filter((line) => line.includes("← you are here"));
      expect(here).toHaveLength(1);
    }
  });
});

// ── The machine shape ───────────────────────────────────────────────────────

describe("--json", () => {
  it("carries the same facts as the human view, with no display strings", () => {
    const json = journeyJson(MID, { appName: "Zuschnitt" });
    expect(json.appName).toBe("Zuschnitt");
    expect(json.currentPhase).toBe("bauen");
    expect(json.phases.map((phase) => phase.state)).toEqual(["done", "current", "not-yet", "not-yet"]);
    // ⚠️ No arrow in the data: a display string is one somebody's code compares
    // against, and the day the arrow changes their comparison breaks in silence.
    expect(JSON.stringify(json)).not.toContain("you are here");
    expect(json.next?.step).toBe("2.4");
    expect(json.nextSentence).toBe(describeNext(MID));
  });

  it("says who performs a row that has no skill of its own", () => {
    const plan = journeyJson(FRESH).rows.find((row) => row.step === "1.4")!;
    expect(plan.skill).toBeNull();
    expect(plan.startedBy).toBe("build-app");
    expect(plan.performedBy).toBe("build-app");
    expect(journeyJson(FRESH).next?.performedBy).toBe("build-app");
  });
});

// ── The greeting's one line ─────────────────────────────────────────────────

describe("the greeting's [Journey: …] line", () => {
  it("is one line: one phase, one count, one next step, one command", () => {
    // ⚠️ It prints EVERY time, unlike `[Operations: …]` and `[Machine: …]`, and the
    // price of that is that it cannot grow. This test is the ceiling.
    const line = describeJourneyLine(MID);
    expect(lines(line)).toHaveLength(1);
    expect(line).toMatch(/^\[Journey: 2 Build — \d+ of \d+ done, next: 2\.4 salespage\./);
    expect(line).toContain("`node run.mjs journey`");
    expect(line.length).toBeLessThanOrEqual(120);
  });

  it("never carries a declined row", () => {
    const declined = state({
      exists: { "docs/plan.md": true },
      text: { "docs/app.md": "2026-08-09 No custom identity" },
      dirs: { "app/dashboard": { entries: ["coaching"], moduleOwned: [] } },
    });
    expect(describeJourneyLine(declined)).not.toContain("said no");
    expect(describeJourneyLine(declined)).not.toContain("choose the look");
  });

  it("says so rather than going blank when the path is answered", () => {
    expect(describeJourneyLine({ rows: [], currentPhase: null, next: null })).toContain(
      "nothing outstanding",
    );
  });

  it("names phase 1 on a fresh clone", () => {
    // The measured regression this whole change came out of, in one assertion: a
    // fresh app used to be greeted as being in phase 2, which hid the planning
    // phase from the only user it exists for.
    expect(describeJourneyLine(FRESH)).toContain("[Journey: 1 Plan");
    expect(describeJourneyLine(FRESH)).toContain("next: 1.4 the plan");
  });
});
