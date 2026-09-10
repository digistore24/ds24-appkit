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

  it("says WHY --prune does not make it undoable", () => {
    // Since --prune the refusal is easy to read as "removable later", and it
    // is — but only while the product never sold. One that took money is
    // deactivated and stays, because its buyers' refunds still arrive as IPNs
    // naming its id. A refusal that dropped that half would be a refusal
    // people talk themselves past.
    expect(source).toContain("only while it never sold");
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

describe("the warnings read the same shape the writes do", () => {
  it("checks price and interval PER WAY TO PAY, not per offering", () => {
    // The bug this pins was invisible to every unit test in the tree, because
    // each of them hands `checkDefinition` its own fixture. It showed on the
    // first dry run against a real account: an entry using `paymentOptions`
    // has no `priceCents` and no `billingInterval` of its own, so a correctly
    // written registry was told, twice, that it had no price. A warning that
    // fires on correct input is worse than none — it teaches the reader to
    // stop reading them.
    const check = at("function checkDefinition");
    const price = source.indexOf("no priceCents", check);
    expect(source.slice(check, price)).toContain("paymentOptionsOf(def)");
    // And not by reading the entry's own fields beside it.
    expect(source.slice(check, price)).not.toContain("def.priceCents");
  });
});

describe("data[tag] cannot break a sync while the field does not exist", () => {
  it("both writes go through the fallback, not straight to ds24Call", () => {
    // Measured on 2026-09-09: `data` is validated against a strict allowlist
    // and `tag` is not on it — `createProduct` and `updateProduct` both REFUSE
    // it outright rather than ignoring it. Sending it unconditionally would
    // break every product creation for every customer on day one.
    const create = at('ds24Call("createProduct"');
    const update = at('ds24Call("updateProduct", apiKey, { product_id: String(existingId)');
    expect(source.lastIndexOf("withoutTag(", create)).toBeGreaterThan(-1);
    expect(source.lastIndexOf("withoutTag(", update)).toBeGreaterThan(-1);
  });

  it("gives up on the field for the whole run, not once per product", () => {
    expect(source).toContain("tagsAccepted = false");
  });

  it("throws the ORIGINAL error when the retry fails too", () => {
    // The retry is the call we would have made anyway, so a failure that was
    // never about the tag must surface as itself — the same safeguard the
    // affiliate retry in buyUrl.ts carries.
    const fn = at("async function withoutTag");
    const end = source.indexOf("\n}", fn);
    expect(source.slice(fn, end)).toContain("throw err;");
  });
});

describe("--prune is as careful as the gate", () => {
  it("acts only on rows _own.mjs graded ours, never on a name that merely matches", () => {
    // The whole safety of a delete is in this call. Ownership is the stamp in
    // data[note] — not the internal name, which two apps built from this same
    // template would collide on.
    expect(source).toContain("orphanProducts(list");
    expect(source).toContain("syncId");
  });

  it("refuses to prune when the notes did not come back at all", () => {
    // Zero orphans out of a comparison that could not run is silence, not an
    // answer — and acting on silence here deletes nothing today and anything
    // tomorrow. Proving the walk ran is not proving the comparison did.
    const guard = at("!classifiable && args.prune");
    const exit = source.indexOf("process.exit(2)", guard);
    expect(exit).toBeGreaterThan(guard);
    expect(exit).toBeLessThan(at('ds24Call("deleteProduct"'));
  });

  it("asks about sales BEFORE it deletes, and deactivates instead when there are any", () => {
    const purchases = at('ds24Call("listPurchases"');
    expect(purchases).toBeLessThan(at('ds24Call("deleteProduct"'));
    expect(source).toContain('"data[is_active]": "N"');
  });

  it("keeps a PARKED product out of the orphan list", () => {
    // "sell": false takes an offering off the page, never out of the account —
    // and its id still has to reach the IPN connection so its buyers' refunds
    // keep arriving.
    const keep = at("const keepIds");
    expect(source.indexOf("parkedTargets", keep)).toBeGreaterThan(keep);
  });

  it("still runs with an EMPTY registry — the last product must be removable", () => {
    // Measured against a live account: the "nothing to sync" refusal fires
    // before anything looks at Digistore24, so taking the last entry out left
    // its product in the vendor's account with no way to remove it. "Nothing
    // to sync" and "nothing to clean up" are different questions.
    expect(source).toContain("targets.length === 0 && !args.prune");
  });

  it("does nothing at all without the flag", () => {
    expect(source).toContain("orphans.length > 0 && !args.prune");
    expect(source).toContain("apply && args.prune && orphans.length > 0");
  });
});
