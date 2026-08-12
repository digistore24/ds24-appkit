// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The half of the slot mechanism nothing else can check.
//
// `lib/modules/slots.ts` names the places a module may fill, and the compiler
// enforces one direction of that: a module naming a slot that does not exist
// fails `npm run typecheck`. The OTHER direction has no compiler behind it —
// a slot name that no page renders is a promise the core has stopped keeping,
// and every module that fills it disappears silently.
//
// So: every name in `SLOT_NAMES` is rendered somewhere, measured by reading the
// tree. Same shape as `lib/ai/disclosure.test.ts` — a registry, walked.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SLOT_NAMES } from "@/lib/modules/slots";
import { MODULE_SLOTS } from "@/lib/modules/slot-registry";
import { generatedFiles } from "./generate.mjs";
import { installedModules } from "./installed.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(join(ROOT, dir))) {
    if (entry === "node_modules" || entry === ".next") continue;
    const rel = join(dir, entry);
    if (statSync(join(ROOT, rel)).isDirectory()) yield* sourceFiles(rel);
    else if (/\.tsx$/.test(entry)) yield rel;
  }
}

const PAGES = [...sourceFiles("app"), ...sourceFiles("components")];
const sourceOf = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("the walk is not empty", () => {
  it("read real files", () => {
    // Without this every assertion below passes against an empty list — the
    // vacuity this repo refuses everywhere else.
    expect(PAGES.length).toBeGreaterThan(50);
    expect(PAGES.some((file) => sourceOf(file).includes("ModuleSlots"))).toBe(true);
  });
});

describe("every slot the core offers is really rendered", () => {
  // Non-vacuity for the loop itself: a `SLOT_NAMES` that became empty would
  // make this whole describe pass while the mechanism was gone.
  it("there is at least one slot to check", () => {
    expect(SLOT_NAMES.length).toBeGreaterThan(0);
  });

  for (const name of SLOT_NAMES) {
    it(`"${name}" has a page that renders it`, () => {
      const mount = `name="${name}"`;
      const found = PAGES.filter((file) => {
        const source = sourceOf(file);
        return source.includes("<ModuleSlots") && source.includes(mount);
      });
      expect(
        found,
        `no page renders <ModuleSlots name="${name}" />. A slot nobody renders is ` +
          `a place modules can declare and never appear in — remove the name from ` +
          `SLOT_NAMES, or put the renderer back on the page that lost it.`,
      ).not.toEqual([]);
    });
  }
});

describe("the registry points at things that exist", () => {
  // ⚠️ This used to be `expect(MODULE_SLOTS).toEqual([])` — the shipped state.
  // True of the template and false of any app that installed `api` or
  // `community`, which BOTH fill `account`: a customer following this template's
  // own instructions got a red suite about a fault that was not one. The
  // shipped-empty claim moved to `scripts/shipped-lists.test.mjs` in the
  // factory, where `template/` is pristine by construction.
  //
  // "A page with an empty slot is the page that had no slot" is still asserted,
  // and better than before — against the renderer with an empty registry fed to
  // it by hand, below. What holds in EVERY app is that each entry in this
  // generated file points at something real; `generated.test.ts` compares the
  // file to the manifests byte for byte, and cannot say that.
  //
  // Both loops are empty in the shipped state, which is what
  // `scripts/modules/profiles.test.ts` exists to fix: it runs the same question
  // over all four real modules without installing any of them.
  it("names only modules this app has", () => {
    const installed = installedModules(ROOT);
    for (const entry of MODULE_SLOTS) {
      expect(
        installed,
        `MODULE_SLOTS names "${entry.module}", which is not installed — a card ` +
          `from a module this app does not have would render on the account page`,
      ).toContain(entry.module);
    }
  });

  it("hands the renderer a real component for every entry", () => {
    // The typecheck covers `slot` (it is typed against `SlotName`, so a manifest
    // naming a slot that does not exist fails the build by name). What no type
    // can cover is a generated import that resolved to nothing: a component file
    // renamed inside a module leaves `Component: undefined` here, and the
    // failure surfaces as React throwing on `/dashboard/account` — a page every
    // member visits — rather than in a test.
    for (const entry of MODULE_SLOTS) {
      expect(typeof entry.Component, `${entry.module} → ${entry.slot}`).toBe("function");
    }
  });
});

describe("the renderer actually renders what the registry holds", () => {
  // The shipped registry is EMPTY, so every assertion about `<ModuleSlots>` in
  // a real app would be about the empty case for ever — "renders nothing" is
  // trivially true of a component that renders nothing at all. These feed it a
  // registry by hand.
  //
  // No DOM: the test environment is `node`, and none is needed. `ModuleSlots`
  // is a plain function returning a React element, so calling it and reading
  // the element back measures exactly the decision it makes.
  const viewer = { memberId: "m1", role: "member" };
  const A = () => null;
  const B = () => null;

  const render = async (registry: unknown[], name: string) => {
    vi.resetModules();
    vi.doMock("@/lib/modules/slot-registry", () => ({ MODULE_SLOTS: registry }));
    const { ModuleSlots } = await import("@/components/module-slots");
    return ModuleSlots({ name, viewer } as never) as { props: { children: unknown[] } } | null;
  };

  afterEach(() => {
    vi.doUnmock("@/lib/modules/slot-registry");
    vi.resetModules();
  });

  it("renders null — not an empty wrapper — when nothing fills the slot", async () => {
    // An empty fragment would still be a child of the page's flex column, and
    // a column with `gap` renders a gap for it. "Costs the page nothing" has to
    // mean nothing.
    expect(await render([], "account")).toBeNull();
  });

  it("renders the module that filled it", async () => {
    const result = await render([{ module: "apiv1", slot: "account", Component: A }], "account");
    const children = result!.props.children as { key: string; type: unknown }[];
    expect(children).toHaveLength(1);
    expect(children[0].type).toBe(A);
    expect(children[0].key, "the key is the module id").toBe("apiv1");
  });

  it("ignores a module that filled a DIFFERENT slot", async () => {
    // The failure this catches is a card appearing on a page it was never
    // declared for, which no type can see: `slot` is a string at runtime.
    expect(await render([{ module: "x", slot: "elsewhere", Component: A }], "account")).toBeNull();
  });

  it("renders two modules in one slot, both of them", async () => {
    const result = await render(
      [
        { module: "alpha", slot: "account", Component: A },
        { module: "beta", slot: "account", Component: B },
      ],
      "account",
    );
    const children = result!.props.children as { key: string }[];
    expect(children.map((c) => c.key)).toEqual(["alpha", "beta"]);
  });
});

describe("what the generator emits for a module with a slot", () => {
  const record = (id: string, manifest: Record<string, unknown>) => ({
    id,
    dir: `modules/${id}`,
    manifest,
  });
  const noLocales = () => [];

  it("imports the component and names the module that brought it", () => {
    const files = generatedFiles(
      [record("apiv1", { slots: { account: "components/account-card.tsx" } })],
      noLocales,
    );
    const registry = files.get("lib/modules/slot-registry.ts")!;
    // ⚠️ WITHOUT the extension, for the same reason the schema barrel drops it:
    // TypeScript refuses `from "…/x.tsx"`.
    expect(registry).toContain(
      'import apiv1_account_slot from "@/modules/apiv1/components/account-card";',
    );
    expect(registry).toContain(
      '{ module: "apiv1", slot: "account", Component: apiv1_account_slot },',
    );
  });

  it("leaves a module with no slot out entirely", () => {
    const files = generatedFiles([record("tiny", {})], noLocales);
    expect(files.get("lib/modules/slot-registry.ts")).toContain(
      "export const MODULE_SLOTS: readonly ModuleSlotEntry[] = [];",
    );
  });

  it("keeps two modules in one slot in INSTALL order, not alphabetical", () => {
    // Deliberate, and the opposite of what the name might suggest: the order
    // across modules is `config/modules.json`'s, exactly like `MODULES` and
    // `MODULE_NAV`. That file is checked in, so every copy of an app renders
    // the same order — and having one rule for all four registries beats a
    // special case for the one that happens to be visible on a page.
    const files = generatedFiles(
      [
        record("zebra", { slots: { account: "card.tsx" } }),
        record("alpha", { slots: { account: "card.tsx" } }),
      ],
      noLocales,
    );
    const registry = files.get("lib/modules/slot-registry.ts")!;
    // The records arrive in install order and are NOT re-sorted — only a single
    // module's own slots are. Said out loud because the two are easy to confuse:
    // the order of MODULES is the app's, the order of one module's slots is not.
    expect(registry.indexOf('module: "zebra"')).toBeLessThan(registry.indexOf('module: "alpha"'));
  });
});
