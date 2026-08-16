// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What state a step is in — and above all which answer beats which.
//
// PURE by construction, exactly like `./operations.test.ts`: no filesystem, no
// clock, no spawn. Every fixture below is a hand-built `facts` object, and that
// is the point of the seam `journey.mjs` keeps — `journeyFacts()` touches the
// disk, `journeyState()` decides, and only the second one is worth a test. A
// test that read the real tree would measure this checkout instead of the rule,
// and would go green or red with whatever somebody happened to leave in
// `docs/reports/`.
//
// 🚨 **Every "it is open" claim here has a needle beside it.** A state machine
// that answered `"open"` unconditionally would pass a whole file of open-state
// assertions, so each one is paired with the same fixture changed in one place
// and asserted to answer something else. That is the doctrine
// `scripts/lib/source-text.test.ts` records after a guard shipped for months
// with a needle no file could contain.
//
// The complementary half — is the DATA complete, does every skill appear, does
// every `requires` mirror its frontmatter — is in `scripts/docs-coverage.test.ts`,
// where the rest of the inventory checks live.
import { describe, expect, it } from "vitest";

import {
  JOURNEY,
  PHASES,
  journeyState,
  newestReportDate,
  performerOf,
  phaseOf,
  rowsFor,
} from "./journey.mjs";

/** A fixed clock. Every date below is relative to it and nothing reads Date.now(). */
const NOW = Date.parse("2026-08-11T12:00:00.000Z");

type Facts = Parameters<typeof journeyState>[0];

/**
 * A fresh app's facts: nothing built, nothing measured, no module installed.
 *
 * The DEFAULTS are the fresh-clone state, so every fixture below is written as
 * "a fresh app, except…" — which is how the fixtures stay readable and how a new
 * row added to `JOURNEY` lands in every one of them at once.
 *
 * ⚠️ `version` is a version the whole path fits inside on purpose. The rows'
 * `requires` values are mirrored from the skills and the newest of them moves
 * with the template; a fixture pinned to today's number would start refusing
 * rows the day somebody ships a skill needing more.
 */
function facts(over: Partial<NonNullable<Facts>> = {}): Facts {
  return {
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
  };
}

/** The state of one skill's row in a given fixture. */
function stateOf(over: Partial<NonNullable<Facts>>, skill: string): string {
  const row = journeyState(facts(over)).rows.find((entry) => entry.skill === skill);
  expect(row, `no row for ${skill}`).toBeDefined();
  return row!.state;
}

/**
 * One row by STEP NUMBER, for the row that has no skill to be found by.
 *
 * The plan row (1.4) names no skill — two existing skills write its file — so
 * every assertion about it goes through its number.
 */
function rowAt(over: Partial<NonNullable<Facts>>, step: string) {
  const row = journeyState(facts(over)).rows.find((entry) => entry.step === step);
  expect(row, `no row for step ${step}`).toBeDefined();
  return row!;
}

/**
 * A fixture in which nothing on the shipped defaults reads `done`.
 *
 * ⚠️ These values are what an untouched clone really has on disk, quoted here
 * rather than read, so the tests stay pure. They exist because four rows once
 * read `done` in a fresh app; every one of them now has a predicate that says
 * otherwise, and this is the fixture that proves it.
 */
const SHIPPED_DEFAULTS: Partial<NonNullable<Facts>> = {
  json: {
    "config/digistore-products.json": { billingMode: "both" },
    "config/ai-chat.json": { enabled: true },
    "config/ai-models.json": { default: { provider: "auto" } },
  },
  dirs: {
    content: { entries: ["knowledge", "knowledge-media", "legal"], moduleOwned: [] },
    "content/knowledge": {
      entries: [
        "00-onboarding/welcome.md",
        "10-reference/account.md",
        "10-reference/plans-and-credit.md",
        "20-howto/cancel-a-subscription.md",
        "20-howto/set-a-password.md",
        "90-glossary.md",
      ],
      moduleOwned: [],
    },
    "app/dashboard": { entries: ["account", "admin", "billing", "chat"], moduleOwned: [] },
  },
  text: {
    "app/page.tsx": 'const included = [{ term: "features.authTitle" }]',
    "content/legal/impressum.de.md": "<!-- ds24-appkit:placeholder -->\nnoch nicht ausgefüllt",
    "content/legal/impressum.en.md": "<!-- ds24-appkit:placeholder -->\nnot filled in yet",
    "content/legal/datenschutz.de.md": "<!-- ds24-appkit:placeholder -->\nnoch nicht ausgefüllt",
    "content/legal/datenschutz.en.md": "<!-- ds24-appkit:placeholder -->\nnot filled in yet",
  },
  exists: { "app/impressum": true, "app/datenschutz": true },
};

const daysAgo = (days: number) => new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

// ── The list is readable at all ─────────────────────────────────────────────

describe("the journey is readable at all", () => {
  it("has thirty-two rows in six phases", () => {
    // Non-vacuity. Everything below filters `rows`, and a filter over an empty
    // list satisfies almost any assertion anybody writes about it.
    //
    // Thirty-one skills plus ONE row that names no skill — phase 1's own deliverable,
    // `docs/plan.md`, written by `build-app` step 1f or `market-research` phase 5.
    expect(JOURNEY.length).toBe(32);
    expect(PHASES.map((phase) => phase.id)).toEqual([
      "voraussetzung",
      "planen",
      "bauen",
      "live",
      "betrieb",
      "daneben",
    ]);
    expect(PHASES.filter((phase) => phase.num !== null).map((phase) => phase.num)).toEqual([1, 2, 3, 4]);
  });

  it("answers the phase of a skill, and null for a name that is not one", () => {
    expect(phaseOf("build-app")).toBe("bauen");
    expect(phaseOf("operate")).toBe("betrieb");
    expect(phaseOf("not-a-skill")).toBeNull();
    // 🚨 The needle for the falsy guard. One row's `skill` IS `null`, so a
    // `find(row => row.skill === skill)` with nothing to look for would answer
    // that row's phase — and every unknown name would come back as "planen".
    expect(phaseOf(null as unknown as string)).toBeNull();
    expect(phaseOf(undefined as unknown as string)).toBeNull();
  });

  it("names who performs a row, including the one with no skill of its own", () => {
    // `performerOf()` is what every caller asks instead of reaching for `skill`.
    // Without it the plan row renders as a step with nothing behind it — "here is
    // what to do next" followed by no way to do it.
    expect(performerOf(JOURNEY.find((row) => row.skill === "build-app"))).toBe("build-app");
    expect(performerOf(rowAt({}, "1.4"))).toBe("build-app");
    expect(performerOf({})).toBeNull();
  });

  it("gives a phase's rows in step order", () => {
    // Written in order and filtered, never sorted — a comparator over "2.3a" and
    // "2.10" would be a second opinion about the order.
    expect(rowsFor("live").map((row) => row.step)).toEqual(["3.1", "3.2", "3.3", "3.4"]);
    expect(rowsFor("planen").map((row) => row.step)).toEqual(["1.1", "1.2", "1.3", "1.4"]);
    expect(rowsFor("bauen")[0].skill).toBe("build-app");
    expect(rowsFor("daneben").map((row) => row.step)).toEqual([null, null]);
  });

  it("has exactly one row with no skill, and it is the plan", () => {
    // 🚨 The exception is NAMED rather than tolerated. A blanket "some rows have
    // no skill" would let a typo — a row whose `skill` came out `undefined` —
    // become a silent hole in the path; naming this one cannot.
    // `scripts/docs-coverage.test.ts` asks the same question against the real
    // skill folders.
    const nameless = JOURNEY.filter((row) => !row.skill);
    expect(nameless.map((row) => row.step)).toEqual(["1.4"]);
    expect(nameless[0].startedBy).toBe("build-app");
    expect(nameless[0].optional).toBe(false);
    expect(nameless[0].trace).toEqual({ kind: "file", path: "docs/plan.md" });
  });

  it("does not annotate the shared list in place", () => {
    // `JOURNEY` is a module-level constant, and a second caller has to see it as
    // the first one did. `{ ...row }` is what keeps that true; a later "small
    // optimisation" that assigns `row.state` would break it invisibly.
    journeyState(facts());
    expect(JOURNEY.every((row) => !("state" in row))).toBe(true);
  });
});

// ── A fresh app ─────────────────────────────────────────────────────────────

describe("a fresh app", () => {
  const fresh = journeyState(facts());

  it("has nothing done", () => {
    const done = fresh.rows.filter((row) => row.state === "done").map((row) => row.skill);
    expect(done).toEqual([]);
  });

  it("🚨 has NO row that the template's own shipped defaults already satisfy", () => {
    // 🚨 **This assertion used to name three rows, and that was the finding.**
    // `billingMode` ships as `"both"`, `content/` ships with three folders in it,
    // `"enabled"` in `config/ai-chat.json` ships as `true` — and a fourth turned
    // up the moment the command was run against the real tree: `app/impressum`
    // and `app/datenschutz` are template ROUTES, so a `routes` predicate over
    // them was true in every app that has ever existed and `compliance-check`
    // read `done` on a fresh clone. The gate with a regulator on the other end.
    //
    // A row that says "done" where nobody did anything is a lie the user reads in
    // the journey output, and the whole point of this data is that they can trust
    // it. So each of the four now asks a question the template's own defaults
    // answer with NO, and this list is empty.
    //
    // ⚠️ It must stay empty, and this test is the reason a fifth cannot arrive
    // quietly: add a row whose predicate the shipped tree satisfies and the
    // failure names it.
    const shipped = journeyState(facts(SHIPPED_DEFAULTS));
    expect(shipped.rows.filter((row) => row.state === "done").map((row) => row.skill)).toEqual([]);
    // …and the fresh app's next step is still phase 1's own deliverable.
    expect(shipped.next?.step).toBe("1.4");
  });

  it("reads each of those four the other way round, so the check is not vacuous", () => {
    // The needle for the assertion above. Four predicates that answered "open"
    // whatever they were handed would satisfy it perfectly, and the row would
    // then be unreachable for every customer instead of for none.
    expect(
      stateOf({ json: { "config/digistore-products.json": { billingMode: "tokens" } } }, "billing-modes"),
    ).toBe("done");
    expect(
      stateOf(
        { dirs: { content: { entries: ["knowledge", "legal", "lessons"], moduleOwned: [] } } },
        "content-production",
      ),
    ).toBe("done");
    expect(
      stateOf(
        {
          dirs: {
            "content/knowledge": {
              entries: ["00-onboarding/welcome.md", "10-reference/how-we-coach.md"],
              moduleOwned: [],
            },
          },
        },
        "ai-chat-knowledge",
      ),
    ).toBe("done");
    expect(
      stateOf(
        {
          text: {
            "content/legal/impressum.de.md": "Kraftwerk GmbH, Musterstr. 1",
            "content/legal/impressum.en.md": "Kraftwerk GmbH, Musterstr. 1",
            "content/legal/datenschutz.de.md": "Wir verarbeiten …",
            "content/legal/datenschutz.en.md": "We process …",
          },
        },
        "compliance-check",
      ),
    ).toBe("done");
  });

  it("has every required step of the path still outstanding", () => {
    const outstanding = fresh.rows
      .filter((row) => row.optional === false && row.phase !== "daneben")
      .every((row) => row.state !== "done" && row.state !== "declined");
    expect(outstanding).toBe(true);
  });

  it("stands in phase 1, because phase 1 has a deliverable of its own", () => {
    // 🚨 This said `bauen` once, and the reason was a HOLE IN THE DATA rather than
    // a property of the path. The three rows above it — an idea, a look, a corpus
    // of existing material — are genuinely CHOICES, all `optional: true`; so with
    // nothing else in the phase, "the earliest phase with a non-optional row not
    // done" answered `bauen` and the whole planning phase was invisible to the
    // beginner it exists for.
    //
    // What was missing was phase 1's own deliverable: `docs/plan.md`, the picture
    // of what this app is going to be. That is not optional — an app built with
    // nobody having written down what it is for is the failure `build-app` step 1f
    // exists to prevent — so the phase now holds something binding and the answer
    // is `planen`. The DEFINITION of `currentPhase` never changed.
    expect(fresh.currentPhase).toBe("planen");
  });

  it("names the plan — not market-research — as the one next step", () => {
    // 🚨 **The decision, argued rather than assumed.** Two rows could plausibly be
    // "next" on a fresh app: `market-research` (1.1) and the plan (1.4).
    //
    // It is the plan, because `market-research` is OPTIONAL and routing somebody
    // there is routing somebody who may already know exactly what they want to
    // sell into an interview about whether they should want it. "Build my app"
    // deserves the honest next step, and that step is *agree the picture and write
    // it down* — which is precisely what `build-app` step 1f does, and why the row
    // hands to `build-app` rather than nowhere.
    //
    // The mechanism carries no special case: `next` is the first non-optional
    // outstanding row in path order, 1.1–1.3 are optional, and 1.4 is not. A
    // reader who later makes `market-research` non-optional will change this
    // answer and should read this comment first.
    expect(fresh.next?.step).toBe("1.4");
    expect(fresh.next?.skill).toBeNull();
    expect(performerOf(fresh.next)).toBe("build-app");
    expect(fresh.next?.title.en).toBe("the plan");
  });

  it("moves to build-app once the plan is written", () => {
    // The needle for the row above: a plan row that could never be satisfied
    // would pin every app in phase 1 for ever, which is worse than the hole it
    // was added to fill.
    const planned = journeyState(facts({ exists: { "docs/plan.md": true } }));
    expect(planned.currentPhase).toBe("bauen");
    expect(planned.next?.skill).toBe("build-app");
  });
});

// ── One next step, never a catalogue ────────────────────────────────────────

describe("next is exactly one row", () => {
  it("is a single row from the list, not a list", () => {
    const state = journeyState(facts());
    expect(Array.isArray(state.next)).toBe(false);
    // Coach's rule 1: name ONE step. A function returning an array is one whose
    // callers eventually print all of it.
    expect(state.rows.filter((row) => row === state.next)).toHaveLength(1);
  });

  it("never names an optional row, however long it has been open", () => {
    // The whole of the 2.3 shelf is open in every fixture here, and none of it
    // may ever be "the next step" — offered when there is a REASON, never
    // because it has not been done yet.
    for (const over of [{}, { exists: { "docs/product-brief.md": true } }]) {
      expect(journeyState(facts(over)).next?.optional).toBe(false);
    }
  });

  it("is null once every required step is answered", () => {
    const finished = facts({
      dirs: { "app/dashboard": { entries: ["coaching"], moduleOwned: [] } },
      env: {
        DIGISTORE_API_KEY: "k",
        DIGISTORE_IPN_PASSPHRASE: "p",
        DIGISTORE_IPN_DOMAIN_ID: "d",
        APP_URL: "https://example.com",
      },
      text: {
        "app/page.tsx": "a page that sells the product",
        "content/legal/impressum.de.md": "Kraftwerk GmbH",
        "content/legal/impressum.en.md": "Kraftwerk GmbH",
        "content/legal/datenschutz.de.md": "Wir verarbeiten …",
        "content/legal/datenschutz.en.md": "We process …",
      },
      reportNames: [
        `ux-${daysAgo(3)}.md`,
        `security-${daysAgo(3)}.md`,
        `performance-${daysAgo(3)}.md`,
        `operations-${daysAgo(3)}.md`,
      ],
      exists: { "docs/plan.md": true },
    });
    const state = journeyState(finished);
    // 🚨 **This assertion used to name `setup-hosting`, and that was the
    // finding.** 3.1 is a `kind: "ask"` row, so it was permanently `unknown` —
    // an OPEN state — which made it the eternal next step of every app that had
    // already gone live, and made phase 4 unreachable from any facts at all.
    // It is now settled by 3.2 (`impliedBy`), so a fixture with every required
    // step answered really answers `null` rather than pointing at a step nobody
    // could ever tick.
    expect(state.next).toBeNull();
    expect(state.currentPhase).toBeNull();
    expect(state.rows.find((row) => row.skill === "go-live")?.state).toBe("done");
    expect(state.rows.find((row) => row.skill === "setup-hosting")?.state).toBe("done");
    expect(state.rows.find((row) => row.skill === "operate")?.state).toBe("done");
  });
});

// ── Phase 4, reached by derivation ──────────────────────────────────────────
//
// 🚨 **`currentPhase` could not become `betrieb` from any facts at all**, and the
// chain was three links long: 3.1 (`setup-hosting`) is a `kind: "ask"` row → its
// state is permanently `unknown` → `unknown` is in `OPEN_STATES` → phase 3 never
// clears, however live the app is. So every app that had been running for a year
// was still being told it was going live, and the operating round — the phase
// that begins the day it is live and does not end — was never current.
//
// The fix is a declared field, `impliedBy`, and the decision behind it is: you
// cannot be live on a real domain without a host, so `go-live` succeeding is
// proof the server exists. Everything below is that mechanism measured — the
// derivation, its needle, and the two answers that still outrank it.

describe("the one row a later step settles", () => {
  it("🚨 is carried by EXACTLY ONE row, whose target sits LATER in path order", () => {
    // A field with one use is a decision; a field with five is a loophole — and
    // the loophole it would open is the one thing this data cannot afford: "every
    // row needs its own trace" stops being true the moment a second row can be
    // waved through by a neighbour. Later in path order is the other half: an
    // EARLIER row implying a later one would be a claim about the future.
    const implied = JOURNEY.filter((row) => row.impliedBy);
    expect(implied.map((row) => row.step)).toEqual(["3.1"]);
    expect(implied[0].impliedBy).toBe("go-live");

    const at = JOURNEY.indexOf(implied[0]);
    const target = JOURNEY.findIndex((row) => row.skill === implied[0].impliedBy);
    expect(target, "impliedBy names a skill that is not a row").toBeGreaterThan(-1);
    expect(target).toBeGreaterThan(at);

    // …and the row keeps its own honest trace. The implication is what settles it
    // when 3.2 is done; with 3.2 open there is still nothing on disk to read, and
    // `doctor --deploy` is still the sentence that says so.
    expect(implied[0].trace.kind).toBe("ask");
  });
});

describe("a live app", () => {
  /** Deployed: a real domain, phases 1 and 2 behind it, the round not yet walked. */
  const live = {
    exists: { "docs/plan.md": true },
    dirs: { "app/dashboard": { entries: ["coaching"], moduleOwned: [] } },
    env: {
      DIGISTORE_API_KEY: "k",
      DIGISTORE_IPN_PASSPHRASE: "p",
      DIGISTORE_IPN_DOMAIN_ID: "d",
      APP_URL: "https://kraftwerk.example",
    },
    text: {
      "app/page.tsx": "<Hero>Lose ten kilos</Hero>",
      "content/legal/impressum.de.md": "Kraftwerk GmbH",
      "content/legal/impressum.en.md": "Kraftwerk GmbH",
      "content/legal/datenschutz.de.md": "Wir verarbeiten …",
      "content/legal/datenschutz.en.md": "We process …",
    },
    reportNames: [`ux-${daysAgo(9)}.md`, `security-${daysAgo(9)}.md`, `performance-${daysAgo(9)}.md`],
  };

  /** The same app before it went live — `APP_URL` still on localhost. */
  const almost = { ...live, env: { ...live.env, APP_URL: "http://localhost:3000" } };

  it("reads 3.1 as done because 3.2 is, and says which step answered it", () => {
    const state = journeyState(facts(live));
    const hosting = state.rows.find((row) => row.skill === "setup-hosting")!;
    expect(hosting.state).toBe("done");
    // Never a bare "done": a row the user did not tick themselves owes them the
    // reason it is ticked, and the reason is another step of their own path.
    expect(hosting.evidence).toBe("3.2 go live is done — impossible without this");
  });

  it("stands in phase 4, with the operating round as the one next step", () => {
    // Phase 3 clears with 3.2 done and 3.1 implied — 3.3 (`setup-environments`)
    // and 3.4 (`setup-monitoring`) are `optional: true`, so neither holds the
    // phase open, and both are correctly still `unknown` rather than pretended
    // away.
    const state = journeyState(facts(live));
    expect(state.currentPhase).toBe("betrieb");
    expect(state.next?.step).toBe("4.1");
    expect(state.next?.skill).toBe("operate");
    expect(state.rows.find((row) => row.step === "3.3")?.state).toBe("unknown");
    expect(state.rows.find((row) => row.step === "3.4")?.state).toBe("unknown");
    expect(state.rows.filter((row) => row.step === "3.3" || row.step === "3.4").every((row) => row.optional)).toBe(
      true,
    );
  });

  it("🚨 needle: without a done 3.2 nothing is implied, and phase 3 is current again", () => {
    // The needle for the whole mechanism, and it is the exact state every app was
    // stuck in before it existed: one value back on localhost and 3.1 has nothing
    // to be settled by, so it says what it always said — nothing on disk answers
    // this — and phase 3 is current however finished phase 2 is.
    const state = journeyState(facts(almost));
    const hosting = state.rows.find((row) => row.skill === "setup-hosting")!;
    expect(hosting.state).toBe("unknown");
    expect(hosting.evidence).toContain("doctor --deploy");
    expect(state.currentPhase).toBe("live");
    expect(state.next?.step).toBe("3.1");
  });

  it("🚨 never reads done on a copy whose code is not there", () => {
    // Precedence: `needs-newer-template` beats the implication, because telling
    // somebody a step is behind them on an app that cannot perform it at all is
    // worse than the `unknown` this replaced — it looks like an achievement.
    //
    // ⚠️ What this fixture can and cannot prove, said rather than implied: on an
    // old copy BOTH rows are refused (`go-live` needs 0.15.0, `setup-hosting`
    // 0.14.0 — the target's bar is the higher one, so no real version refuses the
    // row while the target is done). So this measures that a refused row reads
    // the refusal and never `done`; the guard itself is one line in
    // `settleImplied()` — only an OPEN state is implied — and it is argued there
    // rather than reachable from here.
    const old = journeyState(facts({ ...live, version: "0.13.0" }));
    const hosting = old.rows.find((row) => row.skill === "setup-hosting")!;
    expect(hosting.state).toBe("needs-newer-template");
    expect(hosting.state).not.toBe("done");
    expect(hosting.evidence).toContain("node run.mjs update");
  });

  it("🚨 puts no .env value into the implied row's evidence", () => {
    // The implication's proof is `APP_URL`, and the journey prints the KEYS of the
    // .env and never their contents. A sentence quoting the domain would be that
    // rule broken in the one place nobody would look for it.
    const secret = "sk-live-do-not-print-me";
    const state = journeyState(facts({ ...live, env: { ...live.env, APP_URL: `https://${secret}.example` } }));
    const hosting = state.rows.find((row) => row.skill === "setup-hosting")!;
    expect(hosting.state).toBe("done");
    expect(hosting.evidence).not.toContain(secret);
  });
});

// ── Mid phase 2 ─────────────────────────────────────────────────────────────

describe("an app halfway through phase 2", () => {
  // Pages of their own, a checkout that works, no gate run yet. The plan is
  // written — an app that reached phase 2 by the front door has one, and without
  // it here `currentPhase` would correctly still answer `planen`.
  const mid = {
    exists: { "docs/product-brief.md": true, "docs/plan.md": true },
    dirs: { "app/dashboard": { entries: ["account", "admin", "coaching"], moduleOwned: [] } },
    env: {
      DIGISTORE_API_KEY: "key",
      DIGISTORE_IPN_PASSPHRASE: "pass",
      DIGISTORE_IPN_DOMAIN_ID: "app-x7",
    },
  };

  it("counts a folder of their own and not the shipped ones", () => {
    expect(stateOf(mid, "build-app")).toBe("done");
    expect(stateOf(mid, "setup-digistore")).toBe("done");
    expect(stateOf(mid, "market-research")).toBe("done");
  });

  it("is at the salespage", () => {
    const state = journeyState(facts(mid));
    expect(state.currentPhase).toBe("bauen");
    expect(state.next?.skill).toBe("salespage");
  });

  it("counts nothing of their own when the dashboard holds only what shipped", () => {
    // The needle for the assertion above. `beyond` is the whole predicate, and a
    // comparison that quietly stopped working would report every fresh clone as
    // an app somebody had built.
    expect(
      stateOf(
        { dirs: { "app/dashboard": { entries: ["account", "admin", "billing", "chat"], moduleOwned: [] } } },
        "build-app",
      ),
    ).toBe("open");
  });

  it("does not count a module's parking spot as a page somebody built", () => {
    // `app/dashboard/community/` stays on disk when the module is not installed —
    // it holds nothing but `page.community.tsx` declarations. Announcing it as
    // the customer's own page is a mistake this template has already made once.
    expect(
      stateOf(
        {
          dirs: {
            "app/dashboard": { entries: ["account", "community", "course"], moduleOwned: ["community", "course"] },
          },
        },
        "build-app",
      ),
    ).toBe("open");
  });

  it("refuses a checkout that has a key and nothing else", () => {
    // A key with no passphrase means purchases arrive nowhere — the failure coach
    // routes to `setup-digistore`, and the reason all three keys are in the trace.
    expect(stateOf({ env: { DIGISTORE_API_KEY: "key" } }, "setup-digistore")).toBe("open");
  });
});

// ── 2. declined beats open ─────────────────────────────────────────────────

describe("a recorded no is an answer, not an absence", () => {
  const noIdentity = { text: { "docs/app.md": "## Decisions\n\nNo custom identity — the shipped look is fine.\n" } };

  it("renders declined rather than open", () => {
    // 🚨 The single distinction that makes coach's rule enforceable by a command
    // instead of by a paragraph an agent is asked to remember. Re-proposing the
    // thing somebody turned down in session one is how a coach becomes something
    // people skip.
    expect(stateOf(noIdentity, "design")).toBe("declined");
    expect(stateOf(noIdentity, "design")).not.toBe("open");
  });

  it("is open again when the marker is not there", () => {
    // The needle. A `declined` branch that fired on any `docs/app.md` at all
    // would silence every optional row in every app that has a notebook.
    expect(stateOf({ text: { "docs/app.md": "## Decisions\n\nWe chose the deep-teal direction.\n" } }, "design")).toBe(
      "open",
    );
  });

  it("🚨 reads `setup-monitoring`'s recorded no — the marker is what the skill WRITES", () => {
    // THE NEEDLE, and it was missing for as long as the marker was wrong. This row
    // carried `marker: "No monitoring"` — a string that appears nowhere in this
    // tree. `setup-monitoring` § *Write the decision down — including "none"* writes
    // `- Monitoring: none, deliberately, decided <date> — <reason>`, so the branch
    // could never fire and a recorded refusal to watch the live app was re-proposed
    // for ever. It survived because every assertion about this row asked whether it
    // was `unknown` WITHOUT the marker, and a dead marker satisfies that exactly as
    // well as a live one — proving the walk ran is not proving the comparison did.
    const refused = {
      text: {
        "docs/app.md": [
          "## Decisions worth remembering",
          "",
          "- Monitoring: none, deliberately, decided 2026-08-09 — no paying customers yet.",
          "  Do not propose again; revisit when there are paying customers.",
        ].join("\n"),
      },
    };
    expect(stateOf(refused, "setup-monitoring")).toBe("declined");
    expect(stateOf(refused, "setup-monitoring")).not.toBe("unknown");
    expect(
      journeyState(facts(refused)).rows.find((row) => row.skill === "setup-monitoring")!.evidence,
    ).toBe("you said no, 2026-08-09");
    // The other direction, which is the half that makes the marker a marker rather
    // than a substring: the skill's POSITIVE entry goes into the same section of the
    // same file, and must never read as a refusal.
    const chosen = {
      text: {
        "docs/app.md":
          "- Monitoring: Sentry, chosen 2026-08-09 — errors are the failure this app has.\n",
      },
    };
    expect(stateOf(chosen, "setup-monitoring")).not.toBe("declined");
  });

  it("does not leak between rows that record their no in the same file", () => {
    // Two rows write their refusal into `docs/app.md`, each with its own marker. A
    // predicate that only asked "is there a decisions section" would decline both
    // at once — and the rows that merely READ that file must be untouched by
    // somebody else's refusal.
    const state = journeyState(facts(noIdentity));
    expect(state.rows.find((row) => row.skill === "design")?.state).toBe("declined");
    expect(state.rows.find((row) => row.skill === "setup-monitoring")?.state).toBe("unknown");
    // 🚨 The `note` row reads the same file for its own line. A refusal about the
    // LOOK must not answer it, in either direction.
    const note = state.rows.find((entry) => entry.skill === "visuals")!;
    expect(note.state).toBe("unknown");
    expect(note.state).not.toBe("declined");
    // And the row that USED to read this file — `user-onboarding`, until its
    // question moved to the dashboard checklist — must not be answered by it
    // either. It reads `open` here because no `app/dashboard/page.tsx` was
    // supplied, which is that kind's honest answer to an absent file.
    const moved = state.rows.find((entry) => entry.skill === "user-onboarding")!;
    expect(moved.state).not.toBe("declined");
  });
});

// ── 1. needs-newer-template beats everything ───────────────────────────────

describe("a row whose code is not in this copy", () => {
  it("says so rather than reading as open", () => {
    // 🚨 The load-bearing case. Rendering this as "open" would route somebody at
    // a skill whose code is not there — they would be told to do a thing and then
    // find nothing of it. `node run.mjs update` refuses the TEXT on exactly this
    // value; this refuses the STEP.
    expect(stateOf({ version: "0.9.0" }, "design")).toBe("needs-newer-template");
    expect(stateOf({ version: "0.9.0" }, "design")).not.toBe("open");
    expect(stateOf({ version: "0.9.0" }, "operate")).toBe("needs-newer-template");
  });

  it("beats a recorded no, and beats a trace that says done", () => {
    // Precedence 1 over 2 and over 3. A refusal recorded in an app that cannot
    // run the feature is still a refusal about something that is not there, and
    // saying "declined" would imply the choice was available.
    const old = {
      version: "0.9.0",
      text: { "docs/app.md": "No custom identity", "docs/design.md": "chosen" },
      exists: { "docs/design.md": true },
    };
    expect(stateOf(old, "design")).toBe("needs-newer-template");
  });

  it("leaves a row alone whose requires this copy satisfies exactly", () => {
    // The needle for the version comparison: `>=`, not `>`. An off-by-one here
    // would refuse every row on the version that introduced it.
    expect(stateOf({ version: "0.25.0" }, "design")).toBe("open");
    expect(stateOf({ version: "0.4.0" }, "ux-gateway")).toBe("open");
  });

  it("refuses nothing at all when the version could not be read", () => {
    // "I could not look" is not "your app is too old". Refusing twenty-one of the
    // thirty rows because `package.json` was unreadable would hide the path
    // rather than protect it.
    const state = journeyState(facts({ version: null }));
    expect(state.rows.filter((row) => row.state === "needs-newer-template")).toEqual([]);
    expect(state.next?.step).toBe("1.4");
  });
});

// ── 3. done and stale from the trace ───────────────────────────────────────

describe("a recurring row expires", () => {
  it("is done inside its window and stale past it", () => {
    expect(stateOf({ reportNames: [`operations-${daysAgo(3)}.md`] }, "operate")).toBe("done");
    expect(stateOf({ reportNames: [`operations-${daysAgo(29)}.md`] }, "operate")).toBe("done");
    expect(stateOf({ reportNames: [`operations-${daysAgo(45)}.md`] }, "operate")).toBe("stale");
  });

  it("is stale rather than open — the round HAS run, just not lately", () => {
    // Two different sentences for the operator, and the reason `stale` is a state
    // of its own: "nobody has ever walked the round" and "nobody has walked it
    // this month" are not the same fact.
    expect(stateOf({ reportNames: [] }, "operate")).toBe("open");
  });

  it("never goes stale where no window was declared", () => {
    // `security-gateway` is recurring with no `maxAgeDays`, deliberately: a report
    // older than the last big change is worth as much as none, and "the last big
    // change" is not a number of days.
    expect(stateOf({ reportNames: [`security-${daysAgo(400)}.md`] }, "security-gateway")).toBe("done");
  });

  it("reads the newest report and not the first one it finds", () => {
    expect(
      stateOf({ reportNames: [`operations-${daysAgo(200)}.md`, `operations-${daysAgo(2)}.md`] }, "operate"),
    ).toBe("done");
  });

  it("counts a second report written on the same day", () => {
    expect(stateOf({ reportNames: [`ux-${daysAgo(1)}-2.md`] }, "ux-gateway")).toBe("done");
  });

  it("does not read one prefix's report as another's", () => {
    // The needle for the prefix. One `docs/reports/` holds four kinds of report,
    // and a pattern that matched loosely would mark every gate done at once.
    const state = journeyState(facts({ reportNames: [`security-${daysAgo(1)}.md`] }));
    expect(state.rows.find((row) => row.skill === "security-gateway")?.state).toBe("done");
    expect(state.rows.find((row) => row.skill === "ux-gateway")?.state).toBe("open");
    expect(state.rows.find((row) => row.skill === "performance-gateway")?.state).toBe("open");
  });
});

describe("newestReportDate", () => {
  it("takes the date out of the NAME and never opens the file", () => {
    expect(newestReportDate(["ux-2026-07-01.md", "ux-2026-08-01.md"], "ux", NOW)).toBe("2026-08-01");
  });

  it("answers null for every shape that is not a date", () => {
    // `Date.parse` answers NaN for "2026-13-45" on some engines and rolls it over
    // into next year on others, so the day is parsed back and compared with what
    // was read. Without that round trip a typo becomes a date.
    for (const name of ["ux.md", "uxx-2026-08-01.md", "ux-not-a-date.md", "ux-2026-13-45.md", "ux-2026-08-01.txt"]) {
      expect(newestReportDate([name], "ux", NOW), name).toBeNull();
    }
    expect(newestReportDate(null as unknown as string[], "ux", NOW)).toBeNull();
  });

  it("prefers the newest date at or before today, and falls back to a future one", () => {
    // A mistyped year would otherwise silence a row for a century; a report
    // written today on a machine an hour ahead of UTC must still count as today's.
    expect(newestReportDate(["ux-2126-01-01.md", "ux-2026-08-01.md"], "ux", NOW)).toBe("2026-08-01");
    expect(newestReportDate(["ux-2126-01-01.md"], "ux", NOW)).toBe("2126-01-01");
  });
});

// ── 4. blocked, and the difference between two kinds of no ─────────────────

describe("a row that needs a module", () => {
  it("is blocked while the module is absent", () => {
    expect(stateOf({ modules: [] }, "community")).toBe("blocked");
    expect(stateOf({ modules: ["courses"] }, "community")).toBe("blocked");
  });

  it("is done once it is installed", () => {
    // The needle. A `blocked` branch that never cleared would make all five
    // module rows permanently unreachable.
    expect(stateOf({ modules: ["community"] }, "community")).toBe("done");
    expect(stateOf({ modules: ["activity", "api"] }, "mobile-companion")).toBe("done");
  });

  it("says unknown, not blocked, when the module list could not be read", () => {
    // 🚨 "I could not look" and "there is nothing there" must never be the same
    // answer — the distinction `module remove` refuses on. `installedModules()`
    // throws on a malformed list rather than resolving to "no modules", and this
    // is what that refusal looks like once it reaches the path.
    expect(stateOf({ modules: null }, "community")).toBe("unknown");
    expect(stateOf({ modules: null }, "community")).not.toBe("blocked");
  });

  it("blocks nothing that needs no module", () => {
    const state = journeyState(facts({ modules: [] }));
    const blocked = state.rows.filter((row) => row.state === "blocked").map((row) => row.skill);
    expect(blocked).toEqual([
      "courses",
      "learning-activities",
      "community",
      "ai-companion",
      "mobile-companion",
      "metrics",
    ]);
  });
});

// ── The value traces: present is not the same as answered ──────────────────

describe("a value that ships filled in", () => {
  it("does not count as an answer while it still says localhost", () => {
    // `APP_URL` is always SET — it ships as a localhost address — so presence
    // proves nothing and `notValue` is the whole question.
    expect(stateOf({ env: { APP_URL: "http://localhost:3000" } }, "go-live")).toBe("open");
    expect(stateOf({ env: { APP_URL: "https://kraftwerk.example" } }, "go-live")).toBe("done");
    expect(stateOf({ env: { APP_URL: "" } }, "go-live")).toBe("open");
  });

  it("does not count an AI binding that is still auto", () => {
    const auto = { json: { "config/ai-models.json": { default: { provider: "auto" } } } };
    const named = { json: { "config/ai-models.json": { default: { provider: "anthropic" } } } };
    expect(stateOf(auto, "ai-providers")).toBe("open");
    expect(stateOf(named, "ai-providers")).toBe("done");
  });

  it("reads a dotted pointer, and a missing one is not an answer", () => {
    expect(stateOf({ json: { "config/ai-models.json": {} } }, "ai-providers")).toBe("open");
    expect(stateOf({ json: { "config/ai-models.json": null } }, "ai-providers")).toBe("open");
    // ⚠️ `config/ai-chat.json` is deliberately NOT one of these any more.
    // `"enabled"` is the wrong question for a step whose work is a HANDBOOK — it
    // ships `true`, so the pointer answered `done` on every fresh clone. The row
    // now asks about `content/knowledge/` and has its own block further down.
    expect(stateOf({ json: { "config/ai-chat.json": { enabled: true } } }, "ai-chat-knowledge")).toBe("open");
  });
});

describe("the salespage marker", () => {
  it("is open while the shipped marker is still in the page", () => {
    expect(stateOf({ text: { "app/page.tsx": 'const included = [{ term: "features.authTitle" }]' } }, "salespage")).toBe(
      "open",
    );
  });

  it("is done once the marker is gone", () => {
    expect(stateOf({ text: { "app/page.tsx": "<Hero>Lose ten kilos</Hero>" } }, "salespage")).toBe("done");
  });

  it("is open when there is no page at all", () => {
    // No page is not a page somebody rewrote. Answering `done` for a missing file
    // is how an absence becomes an achievement.
    expect(stateOf({ text: {} }, "salespage")).toBe("open");
    expect(stateOf({ text: { "app/page.tsx": null } }, "salespage")).toBe("open");
  });
});

describe("the legal pages", () => {
  const written = {
    "content/legal/impressum.de.md": "Kraftwerk GmbH",
    "content/legal/impressum.en.md": "Kraftwerk GmbH",
    "content/legal/datenschutz.de.md": "Wir verarbeiten …",
    "content/legal/datenschutz.en.md": "We process …",
  };
  const placeholder = "<!-- ds24-appkit:placeholder -->\nDiese Seite ist noch nicht ausgefüllt.";

  it("is open while ANY of the four still carries the shipped marker", () => {
    // 🚨 The route existing proves nothing — `app/impressum/page.tsx` ships. What
    // is unwritten is the TEXT, and it says so in the marker `lib/legal/pages.ts`
    // and `node run.mjs legal-check` both look for.
    expect(stateOf({ text: { ...written, "content/legal/datenschutz.de.md": placeholder } }, "compliance-check")).toBe(
      "open",
    );
    expect(stateOf({ text: written }, "compliance-check")).toBe("done");
  });

  it("counts only the files that are there, so a dropped locale cannot block it", () => {
    // An app that carries two locales and not four is still an app with written
    // legal pages. A missing file is neither a written one nor a placeholder.
    expect(
      stateOf(
        {
          text: {
            "content/legal/impressum.de.md": "Kraftwerk GmbH",
            "content/legal/datenschutz.de.md": "Wir verarbeiten …",
          },
        },
        "compliance-check",
      ),
    ).toBe("done");
  });

  it("is open when there is no legal text at all", () => {
    // The needle for the rule above: "every file that exists is fine" is
    // vacuously true of no files, and that must not read as done.
    expect(stateOf({ text: {} }, "compliance-check")).toBe("open");
  });
});

// ── The step that used to leave nothing behind ─────────────────────────────

describe("go-to-market writes something down", () => {
  it("is open until the plan exists, and done once it does", () => {
    // 🚨 This row was a `kind: "ask"` — *"it writes nothing that proves it ran"* —
    // which made it the last station in this template that could not be answered
    // from disk while every other one writes something. The skill's phase 5 now
    // writes `docs/go-to-market.md`: positioning, the price and why, the channels
    // chosen and the ones turned down, the launch plan.
    expect(stateOf({}, "go-to-market")).toBe("open");
    expect(stateOf({ exists: { "docs/go-to-market.md": true } }, "go-to-market")).toBe("done");
  });

  it("🚨 names the rows that genuinely cannot leave a trace — and it is not among them", () => {
    // The list rather than a count, because the interesting question is WHICH
    // steps still answer "I do not know": two of them can never be anything else
    // (`guardrails` and `coach` are not steps that get done), and the rest name
    // the thing that would answer them in their own `why`. Whoever gives one of
    // them a real trace deletes a line here, and the direction is only ever down.
    // `scripts/docs-coverage.test.ts` caps the same set from above.
    //
    // `visuals` and `user-onboarding` left this list when the `note` kind arrived:
    // both were asking about a line that was in `docs/app.md` all along, and both
    // carried a `declined` marker that was the string the POSITIVE answer is
    // written with. Six now, and four of them are real steps.
    //
    // `user-onboarding` has since moved on again — to a `placeholder` on the
    // dashboard checklist, because `build-app` now writes the `Activation:` line
    // itself and a row asking about it would answer `done` for every app. Neither
    // move brought anything BACK to this list, which is the only direction it goes.
    const asks = JOURNEY.filter((row) => row.trace?.kind === "ask").map((row) => row.skill);
    expect(asks).toEqual([
      "setup-machine",
      "setup-hosting",
      "setup-environments",
      "setup-monitoring",
      "guardrails",
      "coach",
    ]);
  });
});

// ── The evidence: WHY, in one phrase ───────────────────────────────────────

describe("every row says why it is in the state it is in", () => {
  it("gives every row a non-empty phrase, in every fixture", () => {
    // A blank evidence column reads as "nothing was looked at", which is the one
    // thing this whole file exists to stop a command saying by accident.
    for (const over of [{}, SHIPPED_DEFAULTS, { version: "0.9.0" }, { modules: null }]) {
      const blank = journeyState(facts(over)).rows.filter((row) => !String(row.evidence ?? "").trim());
      expect(blank.map((row) => row.skill ?? row.step)).toEqual([]);
    }
  });

  it("🚨 never says a version-refused row is open — it names the update", () => {
    // The load-bearing sentence. Sending somebody at a feature whose code is not
    // in their copy is exactly what this state exists to prevent, and the
    // evidence is where that reaches the user.
    const row = journeyState(facts({ version: "0.9.0" })).rows.find((r) => r.skill === "design")!;
    expect(row.state).toBe("needs-newer-template");
    expect(row.evidence).toContain("node run.mjs update");
    expect(row.evidence).not.toContain("open");
  });

  it("🚨 tells a missing module apart from a module list nobody could read", () => {
    // `operate` keeps *checked* and *could not be checked* in two columns; so does
    // this. "not installed" about a list that could not be read is a claim nobody
    // measured.
    const absent = journeyState(facts({ modules: [] })).rows.find((r) => r.skill === "community")!;
    const unknown = journeyState(facts({ modules: null })).rows.find((r) => r.skill === "community")!;
    expect(absent.evidence).toContain("node run.mjs module add community");
    expect(unknown.evidence).toContain("could not look");
    expect(unknown.evidence).not.toContain("not installed");
  });

  it("🚨 never puts a value from the .env into the evidence", () => {
    // Two of the three `env` rows read an API key and an IPN passphrase. A journey
    // that prints them writes a credential into whatever the user pastes their
    // terminal into.
    const secret = "sk-live-do-not-print-me";
    const rows = journeyState(
      facts({
        env: {
          DIGISTORE_API_KEY: secret,
          DIGISTORE_IPN_PASSPHRASE: secret,
          DIGISTORE_IPN_DOMAIN_ID: secret,
          APP_URL: `https://${secret}.example`,
        },
      }),
    ).rows;
    expect(rows.some((row) => row.state === "done")).toBe(true);
    for (const row of rows) expect(row.evidence).not.toContain(secret);
  });

  it("carries the date of a recorded no, where the skill wrote one down", () => {
    // Visible so it can be REVOKED — and never with today's date invented for it,
    // which would be this command making up a fact about a decision.
    expect(
      journeyState(
        facts({ text: { "docs/app.md": "- 2026-08-09 No custom identity — the shipped look is fine." } }),
      ).rows.find((row) => row.skill === "design")!.evidence,
    ).toBe("you said no, 2026-08-09");
    expect(
      journeyState(facts({ text: { "docs/app.md": "No custom identity" } })).rows.find(
        (row) => row.skill === "design",
      )!.evidence,
    ).toBe("you said no");
  });

  it("names the report it read, and says when a recurring one is past its bound", () => {
    const rows = journeyState(facts({ reportNames: [`operations-${daysAgo(45)}.md`] })).rows;
    const round = rows.find((row) => row.skill === "operate")!;
    expect(round.state).toBe("stale");
    expect(round.evidence).toContain(`operations-${daysAgo(45)}.md`);
    expect(round.evidence).toContain("30-day bound");
  });
});

// ── The `note` predicate: a recorded YES is not a recorded NO ──────────────
//
// 🚨 **The defect this block exists for was an INVERSION, and it shipped.**
// `visuals` (2.3a) and `user-onboarding` (2.3j) were `kind: "ask"` rows whose
// `declined` marker was the string the POSITIVE answer is written with —
// `Output artifact` and `Activation`. Measured on an app whose `docs/app.md` said
// *"Output artifact: a finished sales page with a hero image"*:
//
//     visuals         → declined | you said no
//     user-onboarding → declined | you said no
//
// A decision the user made, reported back to them as its opposite, in the one
// output built to be trusted. The four vacuous predicates elsewhere in this file
// claimed "done" where nothing had happened; this contradicted the record.
//
// It survived because every assertion about it named a STATE. Nobody ever asserted
// the DIRECTION — that a yes is not a no — so the needles below do exactly that,
// on the evidence string as well as on the state.

describe("a decision recorded in prose is read as the answer it is", () => {
  const NOTEBOOK = "docs/app.md";

  /** A notebook in the shape `build-app/references/app-md-template.md` prescribes. */
  const answered = {
    text: {
      [NOTEBOOK]: [
        "# Bloom — what this app is",
        "",
        "## The product",
        "",
        "- **Sells:** a 30-day nutrition challenge",
        "- **Output artifact:** a finished sales page with a hero image",
        "",
        "## Decisions worth remembering",
        "",
        "- Activation: the member has completed their first lesson (unit_completions row exists).",
      ].join("\n"),
    },
  };

  /**
   * What each row was decided about, in the words the fixture's user wrote.
   *
   * 🚨 **`user-onboarding` was the second entry here and is deliberately gone.**
   * Once `build-app` step 1f asks for the activation event and step 4b writes it
   * into the product block, the `Activation:` line is there on every app this
   * template builds — so a `note` row on it would have read `done` for all of
   * them while the dashboard checklist was still the shipped blueprint, which is
   * the vacuity this whole file exists to refuse. Its trace moved to a
   * `placeholder` on `app/dashboard/page.tsx`, and the block at the foot of this
   * describe is where the moved question is measured instead.
   */
  const DECIDED: Record<string, string> = {
    visuals: "a finished sales page with a hero image",
  };

  it("🚨 reads a recorded YES as done — and never, in any word, as a refusal", () => {
    // THE NEEDLE. State and direction both, because the bug that motivated this
    // block passed every state-shaped assertion anybody had written: the row DID
    // have a state, it was just the wrong one. So: it is `done`, it is not
    // `declined`, the evidence does not say "you said no", and the evidence quotes
    // what the user actually decided — which is the only form of this assertion an
    // inverted predicate cannot satisfy by accident.
    const rows = journeyState(facts(answered)).rows;
    for (const [skill, decided] of Object.entries(DECIDED)) {
      const row = rows.find((entry) => entry.skill === skill)!;
      expect(row.state, skill).toBe("done");
      expect(row.state, skill).not.toBe("declined");
      expect(row.evidence, skill).not.toContain("you said no");
      expect(row.evidence, skill).toContain(decided);
    }
  });

  it("🚨 refuses the notebook's own unfilled slot — `open`, never `done`", () => {
    // The vacuity needle of this kind, and the reason the guard lives on the KIND
    // rather than on a row: `docs/app.md` is copied from the reference template with
    // every unanswered slot as `<…>`, so a predicate that only asked *is the label
    // there* would tick both rows the moment `build-app` step 4b created the file.
    // That is the fault four other rows in this file already shipped once.
    const unfilled = {
      text: {
        [NOTEBOOK]:
          "- **Output artifact:** <what the customer ends up holding — the line from the\n" +
          "- Activation: <the event, one sentence>\n",
      },
    };
    for (const skill of Object.keys(DECIDED)) {
      expect(stateOf(unfilled, skill), skill).toBe("open");
      expect(stateOf(unfilled, skill), skill).not.toBe("done");
    }
    // And an empty slot is the same answer as a bracketed one — a heading standing
    // where an answer should be.
    expect(stateOf({ text: { [NOTEBOOK]: "- **Output artifact:**" } }, "visuals")).toBe("open");
  });

  it("says nothing rather than something about a notebook holding neither line", () => {
    // `unknown` and deliberately not `open`: the decision may have been made and
    // recorded somewhere a predicate cannot see — `visuals` can be settled in
    // `docs/product-brief.md`, and an operator who thought about their onboarding
    // without writing it down still thought about it. `operate` keeps *checked* and
    // *could not be checked* in two columns; so does this.
    const silent = { text: { [NOTEBOOK]: "## Features\n\n### Reports — `/dashboard/reports`\n" } };
    for (const skill of Object.keys(DECIDED)) {
      expect(stateOf(silent, skill), skill).toBe("unknown");
      expect(stateOf(silent, skill), skill).not.toBe("done");
    }
  });

  it("answers the same for no notebook at all — and never `declined`", () => {
    // Same state as the case above, by design: *there is no such line* is one fact
    // whether the file is missing or merely silent. What must never happen is the
    // old behaviour — an absence reading as a refusal, which would silence both
    // rows in every app that has no `docs/app.md` yet.
    for (const skill of Object.keys(DECIDED)) {
      expect(stateOf({}, skill), skill).toBe("unknown");
      expect(stateOf({}, skill), skill).not.toBe("declined");
      expect(stateOf(SHIPPED_DEFAULTS, skill), skill).toBe("unknown");
    }
  });

  it("tells the two absences apart in the evidence, though not in the state", () => {
    // One state, two sentences — the split `ownEntries()` keeps for the same reason:
    // "you have no notebook" and "your notebook does not mention this" are different
    // things to read, and the second is the one that names the missing line.
    const noFile = journeyState(facts({})).rows.find((row) => row.skill === "visuals")!;
    expect(noFile.evidence).toBe("no docs/app.md yet");
    const noLine = journeyState(facts({ text: { [NOTEBOOK]: "# Bloom\n" } })).rows.find(
      (row) => row.skill === "visuals",
    )!;
    expect(noLine.evidence).toBe("no Output artifact: line in docs/app.md");
  });

  it("🚨 reads `visuals`'s recorded NO as declined — the format was the fix, not a regex", () => {
    // This assertion used to say `unknown`, and that was the honest answer to a real
    // finding: step 1b's entry opened `- **No pictures in the challenge messages.**`,
    // where "challenge messages" comes from whichever archetype the app is — the
    // app's own words, and nothing a predicate can hold. `design` showed what a
    // readable refusal looks like (`- **No custom identity.**`, declared load-bearing
    // in `design/references/menu.md`), so the fix was one line where the entry is
    // AUTHORED rather than a cleverer regex here: the entry now opens with the fixed
    // `- **No customer-facing visuals.**` and the app's own sentence follows.
    //
    // Both places that write it carry the same opener — `build-app`'s menus reference
    // step 1b, and `visuals` step 1, which asks the same question for a built app. A
    // marker that is live in one path and dead in the other is the same bug half the
    // time.
    const refused = {
      text: {
        [NOTEBOOK]: [
          "## Decisions worth remembering",
          "",
          "- **No customer-facing visuals.** Decided on 2026-08-09: no pictures in the",
          "  challenge messages — the vendor writes them themselves.",
        ].join("\n"),
      },
    };
    expect(stateOf(refused, "visuals")).toBe("declined");
    expect(stateOf(refused, "visuals")).not.toBe("unknown");
    // The direction that matters most, and the one whose absence let the original
    // inversion ship: a refusal must never read as the step having been taken.
    expect(stateOf(refused, "visuals")).not.toBe("done");
    expect(
      journeyState(facts(refused)).rows.find((row) => row.skill === "visuals")!.evidence,
    ).toBe("you said no, 2026-08-09");
    // 🚨 THE NEEDLE THAT MUST NOT BE LOST. The bug this block exists for was a
    // recorded YES reading as a refusal, so restoring a `declined` marker to this row
    // is exactly the change that could bring it back. The positive answer lives in the
    // same file and must still read `done`, in no word a refusal.
    const yes = journeyState(facts(answered)).rows.find((row) => row.skill === "visuals")!;
    expect(yes.state).toBe("done");
    expect(yes.state).not.toBe("declined");
    expect(yes.evidence).not.toContain("you said no");
  });

  it("🚨 asks `user-onboarding` about the CHECKLIST, not about the line build-app writes", () => {
    // THE NEEDLE for the moved trace, and the reason it moved. `build-app` now
    // writes `Activation:` itself (step 1f asks, step 4b records), so the notebook
    // answers that question for every app this template builds. A `note` row on it
    // would therefore have read `done` on an app whose dashboard still shows the two
    // shipped blueprint steps — "done" where nothing happened, which is the exact
    // fault the four vacuous rows elsewhere in this file were fixed for.
    //
    // So the row asks what is still open: are the blueprint steps GONE?
    const DASHBOARD = "app/dashboard/page.tsx";
    const withActivation = {
      text: {
        [NOTEBOOK]: "- Activation: the member has completed their first lesson.",
        [DASHBOARD]: 'const steps = [{ id: "plan", title: t("onboardingPlanDone") }];',
      },
    };
    expect(stateOf(withActivation, "user-onboarding")).toBe("open");
    expect(stateOf(withActivation, "user-onboarding")).not.toBe("done");

    // And it turns over when the steps really are the app's own.
    const replaced = {
      text: {
        [NOTEBOOK]: "- Activation: the member has completed their first lesson.",
        [DASHBOARD]: 'const steps = [{ id: "firstLesson", title: t("stepsFirstLesson") }];',
      },
    };
    expect(stateOf(replaced, "user-onboarding")).toBe("done");

    // 🚨 One marker surviving is enough to hold it open — an app that replaced the
    // plan step and kept the token one has half a blueprint, which is not a
    // designed onboarding. `some(marked) → open`, and this is that assertion.
    const halfReplaced = {
      text: {
        [NOTEBOOK]: "- Activation: the member has completed their first lesson.",
        [DASHBOARD]: 'const steps = [{ id: "tokens", title: t("onboardingTokensTitle") }];',
      },
    };
    expect(stateOf(halfReplaced, "user-onboarding")).toBe("open");

    // A missing page is not a rewritten one, exactly as `salespage` pins it.
    expect(stateOf({}, "user-onboarding")).toBe("open");

    // `declined: null` still holds, and it is deliberate rather than forgotten: this
    // step has no refusal shape at all — the nos `user-onboarding` records are nos to
    // PATTERNS (no survey, no gamification), never to having a first session. A
    // refusal written in prose must therefore not answer this row.
    const refused = {
      text: {
        [NOTEBOOK]: "- No onboarding designed, deliberately, 2026-08-09: one screen.",
        [DASHBOARD]: 'const steps = [{ id: "plan", title: t("onboardingPlanDone") }];',
      },
    };
    expect(stateOf(refused, "user-onboarding")).not.toBe("declined");
    // Non-vacuity for that paragraph: the refusal mechanism does work, in the same
    // file, for a row whose skill writes a load-bearing string.
    expect(
      stateOf({ text: { [NOTEBOOK]: "- **No custom identity.** Decided on 2026-08-09." } }, "design"),
    ).toBe("declined");
  });

  it("🚨 keeps the blueprint markers off the COMMENT that describes them", () => {
    // The trap this row walked into once, from the other side of the same lesson the
    // `salespage` row documents. `app/dashboard/page.tsx` carries a comment reading
    // "THIS IS THE BLUEPRINT" directly above the two steps, and it is the obvious
    // marker to reach for — but `journeyFacts()` runs source through
    // `blankComments()`, so a comment-only marker is never present and the row would
    // read `done` for every app that exists, for ever.
    //
    // Asserting the markers are real CODE strings is the cheap guard: each one has to
    // appear in the shipped page somewhere a comment blanker cannot reach.
    const row = JOURNEY.find((entry) => entry.skill === "user-onboarding")!;
    expect(row.trace.kind).toBe("placeholder");
    const markers = row.trace.markers ?? [];
    expect(markers.length).toBeGreaterThan(0);
    for (const marker of markers) {
      expect(marker, marker).not.toMatch(/^[A-Z ]+$/);
    }
  });

  it("🚨 keeps every `note` row pointed at a doc, never at the .env", () => {
    // A structural guard rather than an output one. The evidence of a `note` row
    // QUOTES what it read, which is exactly right for a decision somebody wrote down
    // and would be a credential in the terminal the day somebody pointed the kind at
    // a secret. The `env` rows print keys and never values for that reason; this kind
    // cannot be given the chance.
    const notes = JOURNEY.filter((row) => row.trace?.kind === "note");
    expect(notes.map((row) => row.skill)).toEqual(["visuals"]);
    for (const row of notes) {
      expect(row.trace.path, row.skill!).toMatch(/^docs\/[a-z-]+\.md$/);
      expect(row.trace.label, row.skill!).toMatch(/:$/);
    }
  });
});

// ── The `dir` predicate: `beyond` is the whole question ────────────────────

describe("a dir row counts what is not what shipped", () => {
  it("distinguishes an absent folder from one holding only the shipped entries", () => {
    // Two different sentences for one state, and the reason `ownEntries()` answers
    // `null` as well as `[]`: "you have no content/ folder" and "content/ holds
    // only what shipped" are not the same thing to read.
    const missing = journeyState(facts({ dirs: {} })).rows.find((r) => r.skill === "content-production")!;
    const bare = journeyState(
      facts({ dirs: { content: { entries: ["knowledge", "knowledge-media", "legal"], moduleOwned: [] } } }),
    ).rows.find((r) => r.skill === "content-production")!;
    expect(missing.state).toBe("open");
    expect(bare.state).toBe("open");
    expect(missing.evidence).not.toBe(bare.evidence);
  });

  it("reads a deep row's entries as paths, not as folders", () => {
    // The handbook lands INSIDE the shipped section folders, so an
    // immediate-subfolder count can never see it — `deep` is what makes the row
    // answerable at all, and this is the fixture that proves it is being read.
    expect(
      stateOf(
        {
          dirs: {
            "content/knowledge": {
              entries: ["00-onboarding/welcome.md", "20-howto/log-a-meal.md"],
              moduleOwned: [],
            },
          },
        },
        "ai-chat-knowledge",
      ),
    ).toBe("done");
    expect(
      stateOf(
        { dirs: { "content/knowledge": { entries: ["00-onboarding/welcome.md"], moduleOwned: [] } } },
        "ai-chat-knowledge",
      ),
    ).toBe("open");
  });
});
