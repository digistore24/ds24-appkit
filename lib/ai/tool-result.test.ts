// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";

import { toolData, toolFailure, toolText } from "./tool-result";

describe("tool results", () => {
  it("marks a failure as a result, not a hard error", () => {
    // The model is meant to read this and adapt; a hard error hides the
    // reason and produces an identical retry.
    expect(toolFailure("out of tokens")).toEqual({
      content: [{ type: "text", text: "out of tokens" }],
      isError: true,
    });
    expect(toolText("fine")).not.toHaveProperty("isError");
  });

  it("serialises structured data into the text block", () => {
    const result = toolData({ balance: 100 });
    expect(JSON.parse(result.content[0].text)).toEqual({ balance: 100 });
    expect(result).not.toHaveProperty("isError");
  });
});
