// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// ESLint flat config.
//
// Since Next.js 16 there is no `next lint` any more — `npm run lint` calls
// `eslint` directly, and eslint-config-next ships its rule sets as flat config
// (the FlatCompat detour from the Next 15 days is gone).
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  // `.dev/` is the local scratch directory of `node run.mjs start` (log, PID, port) —
  // not source code.
  {
    ignores: [
      ".next/**",
      ".dev/**",
      "node_modules/**",
      "drizzle/**",
      "next-env.d.ts",
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      // A warning, not an error — deliberately.
      //
      // Next 16 brought this rule along as an error. It is a good rule: an
      // effect that sets state immediately causes a second render pass. This
      // tree is clean under it since 2026-10-22 — it used to hit two patterns
      // of this app's own, and both have a better answer now:
      //
      //   1. the hydration guard (`useEffect(() => setMounted(true), [])`) in
      //      components/theme-toggle.tsx is `useSyncExternalStore` with a
      //      server snapshot — React's own form of "differs between server and
      //      client";
      //   2. "close the dialog only once the server action succeeded" is
      //      `afterOk(action, then)` (hooks/after-ok.ts) — the close runs
      //      INSIDE the action, in the same transition as the result, instead
      //      of one render later. A prop change that resets state is decided
      //      during the render that sees it, as React's "adjust state when a
      //      prop changes" describes.
      //
      // It stays a warning all the same: an app's agent writes new effects, and
      // a red lint over a performance heuristic is a brake, and a brake is what
      // somebody eventually removes. A warning is read; the sentence above says
      // what to write instead.
      "react-hooks/set-state-in-effect": "warn",

      // 🚨 A leading underscore means "deliberately unused", and this tree has
      // said so for a long time — `_prev` and `_formData` on every Server
      // Action that ignores its previous state, `_gone` and `_dropped` where a
      // destructuring documents what was thrown away, `_id`/`_name` on an
      // `it.each` label. Without this line the linter reported all of them, and
      // eighteen warnings about a convention being followed CORRECTLY is how
      // the other hundred stopped being read.
      //
      // The four patterns are the four places a binding can be unused, and all
      // four are listed on purpose: leaving one out means the convention holds
      // in three places and silently fails in the fourth. `args: "all"` rather
      // than the default "after-used" for the same reason — a leading
      // parameter that exists only for its position is exactly the case the
      // underscore is for, and the default would let it through unnamed.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          args: "all",
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
    },
  },
];

export default eslintConfig;
