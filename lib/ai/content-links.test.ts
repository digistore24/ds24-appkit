// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The per-request link ledger. Pure — no database, no stream, no model.
import { describe, it, expect } from "vitest";

import { MAX_OFFERED_LINKS, createLinkLedger } from "./content-links";

const MARKER = "[link:/dashboard/kurs/knoten#uebung-2|Lektion 3]";

describe("createLinkLedger", () => {
  it("composes a marker for a hit that has a page", () => {
    const ledger = createLinkLedger();
    expect(ledger.offer("/dashboard/kurs/knoten", "uebung-2", "Lektion 3")).toBe(MARKER);
    expect(ledger.markers()).toEqual([MARKER]);
  });

  // The shipped template's every hit: the handbook has no served page. This is
  // what makes the whole feature inert on a fresh app with no switch to set.
  it("offers nothing for a hit with no page", () => {
    const ledger = createLinkLedger();
    expect(ledger.offer(null, "uebung-2", "Lektion 3")).toBeNull();
    expect(ledger.markers()).toEqual([]);
  });

  it("offers nothing for a target the grammar refuses", () => {
    const ledger = createLinkLedger();
    expect(ledger.offer("//evil.com/x", null, "Lektion 3")).toBeNull();
    expect(ledger.offer("/dashboard/kurs", null, "Knoten | Basics")).toBeNull();
    expect(ledger.markers()).toEqual([]);
  });

  it("deduplicates — the same lesson found twice costs one entry", () => {
    const ledger = createLinkLedger();
    const first = ledger.offer("/dashboard/kurs/knoten", "uebung-2", "Lektion 3");
    const second = ledger.offer("/dashboard/kurs/knoten", "uebung-2", "Lektion 3");
    expect(second).toBe(first);
    expect(ledger.markers()).toEqual([MARKER]);
  });

  it("refuses past the ceiling rather than dropping what it already offered", () => {
    // A truncation would invalidate a marker the model may already have
    // copied into the sentence it is halfway through writing.
    const ledger = createLinkLedger();
    for (let i = 0; i < MAX_OFFERED_LINKS; i += 1) {
      expect(ledger.offer(`/dashboard/kurs/l-${i}`, null, `Lektion ${i}`)).not.toBeNull();
    }
    expect(ledger.offer("/dashboard/kurs/one-too-many", null, "Zu viel")).toBeNull();
    expect(ledger.markers()).toHaveLength(MAX_OFFERED_LINKS);
    // …and a repeat of something already offered still works, because it costs
    // no new capacity.
    expect(ledger.offer("/dashboard/kurs/l-0", null, "Lektion 0")).not.toBeNull();
  });

  describe("the history seed", () => {
    it("carries a marker the model may repeat from an earlier answer", () => {
      const ledger = createLinkLedger([MARKER]);
      expect(ledger.markers()).toEqual([MARKER]);
      expect(ledger.used(`Wie gesagt: ${MARKER}`)).toEqual([MARKER]);
    });

    it("drops a malformed stored marker rather than trusting it", () => {
      const ledger = createLinkLedger(["[link://evil.com/x|Lektion 3]", "nonsense", ""]);
      expect(ledger.markers()).toEqual([]);
    });

    it("does not let a long history crowd out this turn's own lookups", () => {
      // The failure this guards: the feature switching itself off, silently,
      // for exactly the people who use the chat most.
      const seed = Array.from(
        { length: MAX_OFFERED_LINKS * 2 },
        (_, i) => `[link:/dashboard/alt/s-${i}|Alt ${i}]`,
      );
      const ledger = createLinkLedger(seed);
      expect(ledger.offer("/dashboard/kurs/frisch", null, "Frisch")).toBe(
        "[link:/dashboard/kurs/frisch|Frisch]",
      );
    });

    it("keeps the most recent seeded markers when there are too many", () => {
      const seed = Array.from(
        { length: MAX_OFFERED_LINKS + 5 },
        (_, i) => `[link:/dashboard/alt/s-${i}|Alt ${i}]`,
      );
      const markers = createLinkLedger(seed).markers();
      expect(markers).toHaveLength(MAX_OFFERED_LINKS);
      expect(markers.at(-1)).toBe(seed.at(-1));
    });
  });

  describe("used()", () => {
    it("returns the offered markers the answer actually carries, in order", () => {
      const ledger = createLinkLedger();
      const a = ledger.offer("/dashboard/kurs/a", null, "Lektion A")!;
      const b = ledger.offer("/dashboard/kurs/b", null, "Lektion B")!;
      ledger.offer("/dashboard/kurs/c", null, "Lektion C");
      expect(ledger.used(`Erst ${b}, dann ${a}.`)).toEqual([a, b]);
    });

    it("stores nothing for an answer that used none of them", () => {
      const ledger = createLinkLedger();
      ledger.offer("/dashboard/kurs/a", null, "Lektion A");
      expect(ledger.used("Dazu weiß ich nichts.")).toEqual([]);
      expect(ledger.used("")).toEqual([]);
    });
  });
});
