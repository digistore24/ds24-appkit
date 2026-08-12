// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The greeting's hint about docs/app.md has to be right on the two occasions it
// is read: a fresh clone (no notes, no pages — say nothing) and a project under
// way (pages built, notes behind — name exactly the ones missing).
//
// A hint that fires when nothing is missing is worse than none: it appears on
// every session start, and whoever learns to ignore it also ignores it on the
// day it is correct.
import { describe, expect, it } from "vitest";
import { describeUnwritten, readNotes, unwrittenItems } from "./app-notes.mjs";

/** The shape the greeting builds — a page, unless the test says otherwise. */
const pages = (...names: string[]) => names.map((name) => ({ kind: "page", name }));

describe("readNotes", () => {
  it("returns the text when the file is there", () => {
    expect(readNotes(() => "# This app")).toBe("# This app");
  });

  it("returns null instead of throwing when it is not", () => {
    expect(
      readNotes(() => {
        throw new Error("ENOENT");
      }),
    ).toBeNull();
  });
});

describe("unwrittenItems", () => {
  it("says nothing about a template nobody has built on yet", () => {
    // The most common case by far — and the one where a hint would be noise.
    expect(unwrittenItems([], null)).toEqual([]);
  });

  it("counts everything as unwritten while there are no notes", () => {
    expect(unwrittenItems(pages("reports", "invoices"), null)).toEqual(pages("reports", "invoices"));
  });

  it("names only what the notes leave out", () => {
    const notes = "## Features\n\n### Reports — `/dashboard/reports`\n";
    expect(unwrittenItems(pages("reports", "invoices"), notes)).toEqual(pages("invoices"));
  });

  it("is quiet when the notes cover everything", () => {
    const notes = "### Reports `/dashboard/reports`\n### Invoices `/dashboard/invoices`\n";
    expect(unwrittenItems(pages("reports", "invoices"), notes)).toEqual([]);
  });

  it("does not let `reports` cover a page called `report`", () => {
    // The near-miss: substring matching would call this covered, and the entry
    // that is actually missing is the one nobody notices.
    expect(unwrittenItems(pages("report"), "### Reports — `/dashboard/reports`")).toEqual(
      pages("report"),
    );
  });

  it("treats a folder with regex characters as a name, not a pattern", () => {
    expect(unwrittenItems(pages("[id]"), "nothing here")).toEqual(pages("[id]"));
    expect(unwrittenItems(pages("[id]"), "the detail page `[id]` shows one record")).toEqual([]);
  });

  it("asks the same question of a table and a job", () => {
    // The point of the widening: these are the two nobody sees in the browser.
    const items = [
      { kind: "table", name: "submissions" },
      { kind: "job", name: "weekly-digest" },
    ];
    const notes = "### Submissions — table `submissions`, written by the intake form\n";
    expect(unwrittenItems(items, notes)).toEqual([{ kind: "job", name: "weekly-digest" }]);
  });

  it("counts a feature written up once as covered, whatever it is made of", () => {
    // A page and its table share a name on purpose in most apps, and the notes
    // describe the FEATURE. Asking twice for one entry would train people to
    // ignore the line.
    const items = [
      { kind: "page", name: "submissions" },
      { kind: "table", name: "submissions" },
    ];
    expect(unwrittenItems(items, "### Submissions — `/dashboard/submissions`")).toEqual([]);
  });
});

describe("describeUnwritten", () => {
  it("says nothing when there is nothing to say", () => {
    expect(describeUnwritten([])).toBe("");
  });

  it("names what is missing, with its kind", () => {
    const line = describeUnwritten([
      { kind: "page", name: "coaching" },
      { kind: "table", name: "submissions" },
    ]);
    expect(line).toContain("coaching (page), submissions (table)");
    expect(line).toContain("Adding a feature, step 9");
  });

  it("caps the list instead of burying the rest of the greeting", () => {
    // Twelve tables after one big session is an ordinary morning, and the
    // `[Setup: …]` line below must not be pushed off the screen by it.
    const many = Array.from({ length: 9 }, (_, index) => ({
      kind: "table",
      name: `table_${index}`,
    }));
    const line = describeUnwritten(many);
    expect(line).toContain("+5 more");
    expect(line).not.toContain("table_4");
    expect(line.split("\n")).toHaveLength(1);
  });
});
