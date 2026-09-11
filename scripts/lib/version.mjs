// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// One comparison of two version strings, shared rather than re-typed: a second
// opinion about whether "1.10.0" is newer than "1.9.3" is how two answers
// drift apart. The one caller today is `templateTooOld()` in
// scripts/modules/registry.mjs, for a module somebody else wrote.

/** `"1.10.0"` >= `"1.9.3"` — numerically, not as a string. */
export function versionAtLeast(have, want) {
  const parse = (v) =>
    String(v ?? "")
      .split(".")
      .map((part) => Number.parseInt(part, 10) || 0);
  const [a, b] = [parse(have), parse(want)];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return true;
}
