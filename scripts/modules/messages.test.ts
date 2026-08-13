// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 A module's texts, and the merge that must not destroy the core's.
//
// This file exists for a bug that was written and caught before any module used
// it: the first merge was a plain spread. A module owns whole namespaces named
// after itself, and for those a spread is right — but `errors` and `nav` belong
// to the CORE and are looked up by a COMPUTED key
// (`t(\`errors.${code}\`)`, `t(item.labelKey)`), so a module that returns error
// codes has to add to them.
//
// A spread would have replaced the core's whole `errors` object with a module's
// two or three keys, and every refusal in the app — token balances, sign-in,
// media uploads — would have rendered as its raw key. In every language, on
// every page, from the first module onwards.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { SHARED_NAMESPACES, mergeModuleMessages } from "@/lib/modules/messages-merge";
import { availableModules } from "./registry.mjs";
import { blankComments } from "@/scripts/lib/source-text.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

describe("🚨 a module cannot destroy a core namespace", () => {
  const core = {
    errors: { insufficientBalance: "…", selfDelete: "…" },
    nav: { overview: "…", account: "…" },
    account: { title: "…" },
  };

  it("merges INTO errors instead of over it", () => {
    const merged = mergeModuleMessages(core, { errors: { activityNoAccess: "…" } });
    expect(merged.errors).toEqual({
      insufficientBalance: "…",
      selfDelete: "…",
      activityNoAccess: "…",
    });
  });

  it("merges INTO nav instead of over it", () => {
    const merged = mergeModuleMessages(core, { nav: { activity: "…" } });
    expect(Object.keys(merged.nav as object).sort()).toEqual(["account", "activity", "overview"]);
  });

  it("replaces an OWNED namespace wholesale", () => {
    // Nothing of the core's can sit under a module's own name — the manifest
    // saw to that — so replacing is the whole operation.
    const merged = mergeModuleMessages(core, { activity: { title: "…" } });
    expect(merged.activity).toEqual({ title: "…" });
    expect(merged.account).toEqual({ title: "…" });
  });

  it("changes nothing when no module brings texts", () => {
    expect(mergeModuleMessages(core, {})).toEqual(core);
  });

  it("keeps the shared list short and closed", () => {
    // Each entry is a namespace the DELIVERY layer looks in by a computed key.
    // A third is a decision about the core, not about a module.
    expect([...SHARED_NAMESPACES]).toEqual(["errors", "nav"]);
  });
});

describe("i18n/catalogue.ts really uses it", () => {
  // The merge used to sit inline in `i18n/request.ts`. It moved here when
  // operator mail needed the same catalogue with no request behind it
  // (`i18n/translator.ts`) — and MOVED is the word: a copy would agree with the
  // original right up to the day somebody installed a module.
  const source = readFileSync(join(ROOT, "i18n/catalogue.ts"), "utf8");

  it("merges through mergeModuleMessages", () => {
    expect(source).toContain("mergeModuleMessages(");
  });

  it("does not spread the module catalogue over the core one", () => {
    // The exact shape of the bug: `{...core, ...module}`.
    const code = blankComments(source);
    expect(code, "the plain spread is back").not.toMatch(/\.\.\.\(MODULE_MESSAGES\[locale\]/);
  });

  it("and the request path goes through it rather than round it", () => {
    const request = blankComments(readFileSync(join(ROOT, "i18n/request.ts"), "utf8"));
    expect(request).toMatch(/messagesFor\(/);
    expect(request, "a second merge is back in i18n/request.ts").not.toContain(
      "mergeModuleMessages(",
    );
  });
});

describe("what a module may put in a shared namespace", () => {
  // AVAILABLE, not installed — the same correction as `privacy.test.ts` and
  // `modules/boundary.test.ts` §2. `config/modules.json` ships empty, so this
  // read zero catalogues in the tree a customer clones. Which keys a module's
  // own `de.json` puts in a SHARED namespace is a property of that file; it
  // does not become true or false by installing anything.
  const records = availableModules(ROOT).map((id) => {
    const dir = join("modules", id);
    return {
      id,
      dir,
      manifest: JSON.parse(readFileSync(join(ROOT, dir, "module.json"), "utf8")),
    };
  });

  it(`checks the ${records.length} available module(s)`, () => {
    // The count guard — zero records is what used to look like a pass.
    expect(records.length, "no modules found in the tree").toBeGreaterThan(1);
    let read = 0;
    for (const { id, dir, manifest } of records) {
      const messages = manifest.messages as { dir: string } | undefined;
      if (!messages) continue;
      for (const locale of ["de", "en"]) {
        const file = join(ROOT, dir, messages.dir, `${locale}.json`);
        if (!existsSync(file)) continue;
        const catalogue = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;

        for (const namespace of SHARED_NAMESPACES) {
          const keys = Object.keys((catalogue[namespace] as object) ?? {});
          const stray = keys.filter((key) => !key.startsWith(id));
          expect(
            stray,
            `modules/${id}/${messages.dir}/${locale}.json puts ${stray.join(", ")} in the shared ` +
              `"${namespace}" namespace without the module's own prefix. Two modules would ` +
              `overwrite each other, and a module could silently replace a core text.`,
          ).toEqual([]);
        }
        read += 1;
      }
    }

    // The second half of the guard: records exist, but if none of them declared
    // a `messages` dir the loop would still assert nothing.
    expect(read, "no module catalogue was read at all").toBeGreaterThan(1);
  });
});
