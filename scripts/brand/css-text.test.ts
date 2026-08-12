// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Why this module exists at all, as an executable assertion.
//
// There is already a comment blanker in this repo (`blankComments()` in
// `scripts/lib/source-text.mjs`), `CLAUDE.md` forbids a second one, and
// `scripts/lib/source-text.test.ts` refuses a seventeenth copy of the regex.
// So a second blanker needs a reason that survives review — and the reason is
// a measurement, pinned below rather than described.
import { describe, expect, it } from "vitest";

import { blankComments } from "@/scripts/lib/source-text.mjs";
import { blankCssComments, modeAt, selectorAt } from "./css-text.mjs";

describe("🚨 why this is not blankComments()", () => {
  // Measured. Every real stylesheet worth reading is minified onto one line,
  // and minified CSS routinely contains `//` inside url() and base64 data.
  // `blankComments` blanks `//` to end of line, so it eats the rest of the
  // FILE — and the extractor would report "no colours found" with total
  // confidence about most of the sheets it is handed.
  const MINIFIED =
    ".a{background:url(//cdn.example.com/bg.png)}.btn{background:#2e5aac;color:#fff}a{color:#2e5aac}";

  it("blankComments loses everything after a protocol-relative url()", () => {
    expect(blankComments(MINIFIED)).not.toContain("#2e5aac");
  });

  it("blankComments loses everything after a base64 payload containing //", () => {
    const css = ".x{background:url(data:image/png;base64,iVBORw0KAAAA//8AAAAA)}.y{color:#2e5aac}";
    expect(blankComments(css)).not.toContain("#2e5aac");
  });

  it("blankCssComments keeps both", () => {
    expect(blankCssComments(MINIFIED)).toContain("#2e5aac");
    expect(
      blankCssComments(".x{background:url(data:image/png;base64,AA//8A)}.y{color:#2e5aac}"),
    ).toContain("#2e5aac");
  });
});

describe("blankCssComments", () => {
  it("blanks a real CSS comment", () => {
    const out = blankCssComments("a{color:red} /* --brand: #ff0000; */ b{color:blue}");
    expect(out).not.toContain("#ff0000");
    expect(out).toContain("color:blue");
  });

  it("keeps every offset, so reported positions stay right", () => {
    const css = "a{}/* xxxx */b{}";
    expect(blankCssComments(css)).toHaveLength(css.length);
    expect(blankCssComments(css).indexOf("b{}")).toBe(css.indexOf("b{}"));
  });

  it("survives an unterminated comment", () => {
    expect(() => blankCssComments("a{} /* never closed")).not.toThrow();
  });
});

describe("selectorAt", () => {
  const css = ".btn:hover { background: #2e5aac; }";

  it("finds the rule a declaration sits in", () => {
    expect(selectorAt(css, css.indexOf("#2e5aac"))).toBe(".btn:hover");
  });

  it("finds the nested selector rather than its parent", () => {
    const nested = ".card { color: red; &:hover { background: #2e5aac; } }";
    expect(selectorAt(nested, nested.indexOf("#2e5aac"))).toBe("&:hover");
  });

  it("answers nothing for a declaration in no rule at all", () => {
    expect(selectorAt("#2e5aac", 0)).toBe("");
  });
});

describe("modeAt", () => {
  it.each([
    ["@media (prefers-color-scheme: dark) { a { color: #fff; } }"],
    [".dark { a { color: #fff; } }"],
    ['[data-theme="dark"] { a { color: #fff; } }'],
  ])("recognises %s as dark", (css) => {
    expect(modeAt(css, css.indexOf("#fff"))).toBe("dark");
  });

  it("goes back to light once the dark block has closed", () => {
    const css = "@media (prefers-color-scheme: dark){a{color:#000}}b{color:#fff}";
    expect(modeAt(css, css.indexOf("#000"))).toBe("dark");
    expect(modeAt(css, css.indexOf("#fff"))).toBe("light");
  });
});
