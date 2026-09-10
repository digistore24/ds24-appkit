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
      // effect that sets state immediately causes a second render pass. But it
      // also hits two patterns this app uses on purpose and for which React
      // offers no better answer:
      //
      //   1. the hydration guard (`useEffect(() => setMounted(true), [])`) in
      //      components/theme-toggle.tsx — the server does not know the theme,
      //      it lives in localStorage;
      //   2. "close the dialog only once the server action succeeded"
      //      (`useActionState` → `if (state.ok) setOpen(false)`) in the admin
      //      pages.
      //
      // As an error the rule would make `node run.mjs lint` red out of the box on a
      // freshly deployed app. As a warning it stays visible — whoever writes a
      // NEW effect that sets state should take it seriously.
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
