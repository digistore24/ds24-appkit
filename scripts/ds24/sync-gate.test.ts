// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 The gate between running `ds24-sync` and having products in a
// Digistore24 account nobody chose.
//
// Creating a product over there cannot be undone from here — deleting the
// entry from `config/digistore-products.json` afterwards does not unpublish
// it. And `node run.mjs ds24-sync` passes `--apply` by itself, so on a fresh
// app the very first run would create every example plan the template ships
// with. The refusal below is what stands between the two.
//
// It is asserted on the SOURCE because `sync-products.mjs` is top-level code
// with no exports, and because the property that matters is POSITIONAL: the
// refusal has to come before anything is written. That is this repo's
// convention for exactly this shape of risk — `scripts/modules/data-gate.test.ts`
// does the same for the module system's own irreversible step.
//
// The decidable half — which rows would be created — is a pure function with
// real tests (`_match.test.ts`). What cannot be measured here is the gate
// firing over real HTTP: that needs a writable DIGISTORE_API_KEY, and a run
// that really creates products is the thing this gate exists to prevent.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { blankComments } from "@/scripts/lib/source-text.mjs";

// Comments blanked: the refusal's own prose explains what it refuses and
// quotes the flag while doing so, and several comments in this file name
// `createProduct`. A checker that read them as code would find the needle in
// the explanation.
const source = blankComments(
  readFileSync(new URL("./sync-products.mjs", import.meta.url), "utf8"),
);

const at = (needle: string) => {
  const i = source.indexOf(needle);
  expect(i, `not found in sync-products.mjs: ${needle}`).toBeGreaterThan(-1);
  return i;
};

describe("the gate stands before anything is written", () => {
  it("refuses before the first createProduct", () => {
    // Anchored on the GATE's own exit, not on `process.exit(2)` — this file
    // holds three other refusals and every one of them is already above the
    // loop, so a bare search for the first exit would pass no matter where
    // the gate sat.
    const gate = at("apply && creations.length > 0");
    const exit = source.indexOf("process.exit(2)", gate);
    expect(exit).toBeGreaterThan(gate);
    expect(exit).toBeLessThan(at('ds24Call("createProduct"'));
  });

  it("refuses before the product GROUP is created", () => {
    // A refused run must not leave a folder behind at Digistore24 either.
    // resolveProductGroup() is what would create it, and it is called after
    // the gate on purpose.
    expect(at("creations.length > 0")).toBeLessThan(at("resolveProductGroup()"));
  });

  it("counts creations from the same classification the loop uses", () => {
    // A gate computing its own list would eventually disagree with the loop
    // that then creates the products — and a gate that lies about what is
    // coming is worse than no gate.
    expect(source).toContain("classifyTargets(targets, list, env)");
    expect(source).toContain('r.action === "create"');
    expect(source).toContain("for (const target of rows)");
  });
});

describe("the gate hangs on apply, so the preview stays open", () => {
  it("is conditional on apply", () => {
    // Without this the refusal would also block `--dry-run` — the very run it
    // sends the reader to look at.
    expect(source).toContain("apply && creations.length > 0");
  });

  it("only fires while something would be CREATED", () => {
    // What keeps it from becoming a flag people type without reading: once an
    // offering is synced it carries an id, and every later run passes through.
    expect(source).toContain('creations.length > 0 && !args["create-new"]');
  });

  it("does not gate updates", () => {
    // Updates are reversible; gating them would train the reflex the gate
    // depends on not existing. Pinned POSITIVELY: the count the gate fires
    // on is `creations`, never the full `rows` — and the refusal accounts
    // for the rows that pass as mere updates. (An earlier version asserted
    // the absence of `updateProduct` in an arbitrary slice, which a gate
    // that DID block updates would also have satisfied.)
    expect(source).toContain('rows.filter((r) => r.action === "create")');
    expect(source).not.toContain("apply && rows.length");
    expect(source).toContain("would only be updated");
  });
});

describe("the refusal says what happened and how to go on", () => {
  it("says the step cannot be undone", () => {
    expect(source).toContain("cannot be undone from here");
  });

  it("names both legitimate ways forward", () => {
    // A refusal that only says "no" gets worked around. One way is to accept
    // the list, the other is to park what is not wanted — and the second only
    // exists because `sell` does.
    expect(source).toContain("--create-new`");
    expect(source).toContain('"sell": false');
  });

  it("the suggested re-run keeps the refused run's scope", () => {
    // A bare `ds24-sync --create-new` after an `--env prod` refusal would
    // confirm the wrong environment's set, and after a `--key`-scoped one it
    // would create every new product instead of the one that was asked
    // about — the mass creation the gate exists to prevent, with the
    // confirmation flag attached.
    const rerun = at("node run.mjs ds24-sync --env ${env}");
    expect(source.indexOf("--key ${onlyKey}", rerun)).toBeGreaterThan(rerun);
  });

  it("says that nothing was changed", () => {
    expect(source).toContain("Nothing was created. Nothing was changed.");
  });
});
