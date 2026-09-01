// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";

import {
  DEFAULT_CURRENCY,
  costMicros,
  estimateMicros,
  formatMicros,
  priceFor,
  priceKey,
  recommendedCurrency,
} from "./pricing.mjs";
import prices from "@/config/ai-prices.json";
import { pricesUpdatedAt } from "./prices";
import { allBindings } from "./tasks";

const TABLE = {
  defaultCurrency: "USD",
  models: {
    "anthropic/m": { input: 3, output: 15, cachedInput: 0.3, cacheWrite: 3.75 },
    "mistral/small": { input: 0.1, output: 0.3, currency: "EUR" },
    "gemini/pro": { input: 1, output: 8, thinking: 8 },
    "openai/bare": { input: 2, output: 6 },
  },
};

describe("priceKey", () => {
  it("is provider/model, never a bare model name", () => {
    // OpenRouter serves models whose names belong to other vendors: a bare name
    // would collide the moment somebody routes the same model two ways to
    // compare price.
    expect(priceKey("openrouter", "anthropic/claude-sonnet-5"))
      .toBe("openrouter/anthropic/claude-sonnet-5");
    expect(priceKey("anthropic", "claude-sonnet-5")).toBe("anthropic/claude-sonnet-5");
  });
});

describe("priceFor", () => {
  it("reads a full entry", () => {
    expect(priceFor(TABLE, "anthropic", "m")).toEqual({
      input: 3,
      output: 15,
      // A text model draws nothing, so its per-picture rate is zero rather
      // than absent — the cost sum adds every term unconditionally.
      image: 0,
      cachedInput: 0.3,
      cacheWrite: 3.75,
      thinking: 15,
      currency: "USD",
    });
  });

  it("lets an entry name its own currency", () => {
    // What makes an installation drawing on providers who bill differently
    // honest rather than approximately right (AD-21).
    expect(priceFor(TABLE, "mistral", "small")?.currency).toBe("EUR");
  });

  it("falls back to the table's default currency", () => {
    expect(priceFor(TABLE, "openai", "bare")?.currency).toBe("USD");
  });

  it("falls back again when the table names none", () => {
    expect(priceFor({ models: { "a/b": { input: 1, output: 1 } } }, "a", "b")?.currency)
      .toBe(DEFAULT_CURRENCY);
  });

  it("falls back to the OUTPUT rate for thinking, because that is how it is billed", () => {
    expect(priceFor(TABLE, "openai", "bare")?.thinking).toBe(6);
    expect(priceFor(TABLE, "gemini", "pro")?.thinking).toBe(8);
  });

  it("falls back to the INPUT rate for cached and cache-write", () => {
    // Over-states rather than under-states: better to look expensive than free.
    const price = priceFor(TABLE, "openai", "bare")!;
    expect(price.cachedInput).toBe(2);
    expect(price.cacheWrite).toBe(2);
  });

  it("returns null for a model with no entry — a real answer, not an error", () => {
    // A model with no price produces a row with token counts and NO cost, which
    // the report counts and names. Recording zero would produce a page reading
    // "0.00" for a month that cost real money.
    expect(priceFor(TABLE, "openai", "unknown-model")).toBeNull();
    expect(priceFor({}, "openai", "x")).toBeNull();
  });

  it("returns null for a malformed entry rather than half a price", () => {
    expect(priceFor({ models: { "a/b": { input: "three", output: 1 } } }, "a", "b")).toBeNull();
    expect(priceFor({ models: { "a/b": {} } }, "a", "b")).toBeNull();
  });
});

describe("costMicros", () => {
  const price = priceFor(TABLE, "anthropic", "m")!;

  it("is tokens × price-per-million, exactly", () => {
    // The unit cancellation: 1000 input tokens at 3 per million = 3000 micros.
    expect(costMicros({ inputTokens: 1000, outputTokens: 0 }, price)).toBe(3000);
    expect(costMicros({ inputTokens: 0, outputTokens: 1000 }, price)).toBe(15000);
  });

  it("prices the cached share separately, and subtracts it from the fresh part", () => {
    // 1000 total input, 900 of it cached: 100 × 3 + 900 × 0.3 = 300 + 270.
    expect(
      costMicros({ inputTokens: 1000, outputTokens: 0, cachedInputTokens: 900 }, price),
    ).toBe(570);
  });

  it("prices a cache write at its own rate and takes it out of fresh input too", () => {
    // Anthropic reports cache writes inside our input total. 1000 total, 900
    // cached, 50 written: 50 × 3 + 900 × 0.3 + 50 × 3.75.
    expect(
      costMicros(
        { inputTokens: 1000, outputTokens: 0, cachedInputTokens: 900, cacheWriteTokens: 50 },
        price,
      ),
    ).toBe(150 + 270 + 188);
  });

  it("never lets the fresh share go negative", () => {
    // A provider reporting more cached than total would otherwise produce a
    // NEGATIVE cost — a credit note that never happened.
    expect(
      costMicros({ inputTokens: 100, outputTokens: 0, cachedInputTokens: 900 }, price),
    ).toBe(Math.round(900 * 0.3));
  });

  it("handles a call with no output", () => {
    expect(costMicros({ inputTokens: 10, outputTokens: 0 }, price)).toBe(30);
  });

  it("handles a call that was entirely cached", () => {
    expect(
      costMicros({ inputTokens: 1000, outputTokens: 0, cachedInputTokens: 1000 }, price),
    ).toBe(300);
  });

  it("returns null when there is no usage or no price", () => {
    expect(costMicros(null, price)).toBeNull();
    expect(costMicros({ inputTokens: 1, outputTokens: 1 }, null)).toBeNull();
  });

  it("produces an integer, always", () => {
    const value = costMicros({ inputTokens: 7, outputTokens: 3 }, priceFor(TABLE, "mistral", "small")!);
    expect(Number.isInteger(value)).toBe(true);
  });
});

describe("estimateMicros", () => {
  it("prices a hypothetical call at the fresh-input rate", () => {
    // Nothing is cached before a call has been made, so an estimate that
    // assumed a cache hit would flatter every model that has one.
    expect(estimateMicros(priceFor(TABLE, "anthropic", "m")!, 1000, 500)).toBe(3000 + 7500);
  });
});

describe("formatMicros", () => {
  it("shows the amount with its currency", () => {
    expect(formatMicros(1_234_567, "USD")).toBe("1.2346 USD");
  });

  it("says nothing rather than zero when there is no cost", () => {
    expect(formatMicros(null, "EUR")).toBe("— EUR");
  });
});

describe("recommendedCurrency", () => {
  it("suggests EUR for the euro-area languages", () => {
    // German, Spanish and French. The proxy is crude and the function's own
    // comment says so — it is a SUGGESTION `ai-check` prints, never a rule, and
    // the alternative to being crude here is asking an operator for a country
    // the app has no other use for.
    expect(recommendedCurrency("de")).toBe("EUR");
    expect(recommendedCurrency("es")).toBe("EUR");
    expect(recommendedCurrency("fr")).toBe("EUR");
  });

  it("suggests USD for English and for a language it does not know", () => {
    // English is deliberately NOT in the euro set: it is the language the rest
    // of the world shares, so its likeliest operator is outside the euro area.
    expect(recommendedCurrency("en")).toBe("USD");
    expect(recommendedCurrency("xx")).toBe("USD");
  });
});

describe("the shipped price table", () => {
  it("names a currency and when it was last checked", () => {
    expect(typeof prices.defaultCurrency).toBe("string");
    // Without a date nobody knows whether the numbers are a year old.
    expect(prices.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("prices every model the shipped bindings actually use", () => {
    // Not a hard requirement of the layer — an unpriced model is recorded and
    // counted separately, by design. But shipping a template whose OWN default
    // has no price would put "no price on file" in front of every new customer
    // on their first `ai-check`.
    for (const [task, binding] of Object.entries(allBindings())) {
      expect(
        priceFor(prices, binding.provider, binding.model),
        `task "${task}" is bound to ${binding.provider}/${binding.model}, which has no price entry`,
      ).not.toBeNull();
    }
  });
});

describe("pricesUpdatedAt", () => {
  it("returns the shipped date", () => {
    expect(pricesUpdatedAt()).toBe(prices.updated);
  });

  it("is the only thing the cost page will format", () => {
    // The guard the assertion above cannot make: `updated` is hand-maintained,
    // and "soon" or "Juli 2026" in there would reach Intl.DateTimeFormat as an
    // Invalid Date. Whether that throws or merely renders "Invalid Date" in a
    // heading, a typo in a price file must not damage the page that exists to
    // tell the Operator about the price file. So only a real YYYY-MM-DD gets
    // through, and everything else becomes "no date on record".
    expect(pricesUpdatedAt()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Number.isNaN(Date.parse(`${pricesUpdatedAt()}T00:00:00.000Z`))).toBe(false);
  });
});

describe("images", () => {
  const TABLE_WITH_IMAGE = {
    defaultCurrency: "USD",
    models: {
      // An image model billed per picture AND for its prompt tokens.
      "openai/draws": { input: 5, output: 40, image: 0.04 },
      // One billed per picture only. A complete price, not a broken one.
      "gemini/draws": { image: 0.03 },
      // Neither. Nothing to price with.
      "openai/nothing": { currency: "EUR" },
    },
  };

  it("reads an entry that is priced per picture only", () => {
    const price = priceFor(TABLE_WITH_IMAGE, "gemini", "draws");
    if (!price) throw new Error("expected a price");
    expect(price.image).toBe(0.03);
    // Requiring token rates here would leave every image call unpriced, and the
    // cost page would then report "could not account for" about a price we have.
    expect(price.input).toBe(0);
    expect(price.output).toBe(0);
  });

  it("still refuses an entry with no usable rate at all", () => {
    expect(priceFor(TABLE_WITH_IMAGE, "openai", "nothing")).toBeNull();
  });

  it("prices a picture per piece, not per million", () => {
    const price = priceFor(TABLE_WITH_IMAGE, "gemini", "draws");
    if (!price) throw new Error("expected a price");
    // 0.03 currency units = 30_000 micros. Quoting images per million would put
    // a six-zero conversion between the vendor's price page and this file.
    expect(costMicros({ images: 1 }, price)).toBe(30_000);
    expect(costMicros({ images: 4 }, price)).toBe(120_000);
  });

  it("adds the picture and the prompt tokens where a model bills both", () => {
    const price = priceFor(TABLE_WITH_IMAGE, "openai", "draws");
    if (!price) throw new Error("expected a price");
    // 1000 input tokens at 5/M = 5000 micros, plus one picture at 0.04 = 40_000.
    expect(costMicros({ inputTokens: 1000, images: 1 }, price)).toBe(45_000);
  });

  it("charges nothing for pictures on a text model", () => {
    const price = priceFor(TABLE, "anthropic", "m");
    if (!price) throw new Error("expected a price");
    expect(costMicros({ inputTokens: 1000, images: 0 }, price)).toBe(3000);
  });
});

// ── The shipped image entries, against their own stated price ──────────────
//
// Added after a code review measured one picture at $0.101 against a price file
// that says $0.053. The entry carried an `image` rate AND an `output` rate, and
// for an image model the picture IS the output — so both were charged. The
// arithmetic was right; the table was wrong, and nothing compared the two.

describe("the shipped image prices", () => {
  const shipped = prices as unknown as {
    models: Record<string, { image?: number; output?: number; _note?: string }>;
  };
  // DERIVED, not listed. A hard-coded pair covers the two entries that exist
  // today and silently ships the third one somebody adds next year — which is
  // exactly the shape of the bug these tests were written for. Every entry
  // carrying an `image` rate is an image entry, by definition.
  const IMAGE_MODELS = Object.keys(shipped.models).filter(
    (key) => shipped.models[key]?.image !== undefined,
  );

  it("finds the image entries at all", () => {
    // Without this, deleting both entries would make every test below vacuous
    // and the suite would report the deletion as a pass.
    expect(IMAGE_MODELS.length).toBeGreaterThanOrEqual(2);
  });

  for (const key of IMAGE_MODELS) {
    const [provider, ...rest] = key.split("/");
    const model = rest.join("/");

    it(`${key} names no output rate`, () => {
      // The line that caused the double count. An image model's output IS the
      // picture; a rate here is charged on top of the per-image price.
      expect(shipped.models[key]?.output, `${key} must not price output tokens`).toBeUndefined();
    });

    it(`${key} prices one picture at its stated figure`, () => {
      const price = priceFor(shipped, provider, model);
      if (!price) throw new Error(`no price for ${key}`);
      // Exactly the per-image rate, in micros, for a call that produced one
      // picture and read no prompt.
      expect(costMicros({ images: 1 }, price)).toBe(Math.round(price.image * 1_000_000));
    });

    it(`${key} adds the prompt tokens on top, and nothing else`, () => {
      const price = priceFor(shipped, provider, model);
      if (!price) throw new Error(`no price for ${key}`);
      // 1000 prompt tokens, and an output-token count the provider reported for
      // the picture itself. Only the prompt may add to the per-image price.
      const withOutput = costMicros({ inputTokens: 1000, outputTokens: 1600, images: 1 }, price);
      const withoutOutput = costMicros({ inputTokens: 1000, images: 1 }, price);
      expect(withOutput).toBe(withoutOutput);
      expect(withOutput).toBe(Math.round(price.image * 1_000_000) + Math.round(1000 * price.input));
    });
  }
});

describe("priceFor coerces per field", () => {
  it("keeps a token rate that is present when the other is absent", () => {
    // An image model may bill for the prompt it reads and not for text it does
    // not write. Treating the pair as all-or-nothing zeroed the rate that WAS
    // there — an undercharge with no symptom.
    const price = priceFor({ models: { "openai/x": { input: 5, image: 0.04 } } }, "openai", "x");
    if (!price) throw new Error("expected a price");
    expect(price.input).toBe(5);
    expect(price.output).toBe(0);
    expect(price.image).toBe(0.04);
  });

  it("still refuses an entry with no rate at all", () => {
    expect(priceFor({ models: { "openai/x": { currency: "EUR" } } }, "openai", "x")).toBeNull();
  });
});

// ── The relaxation that became an undercharge ──────────────────────────────
//
// The image fix above needed `priceFor` to accept an entry with no `output`
// rate, because for an image model the picture IS the output. Applied to every
// entry rather than to image entries, that turned an ordinary hand-edit — a
// chat model whose `output` line was forgotten — into a price of zero for
// every token the model writes. Measured: 10k in and 50k out reported 2,500
// micros against a true 102,500, with `ai-check` green and nothing on the cost
// page saying so. Refusing the entry puts it back in the "could not account
// for" column, which is what this function's docstring promises.

describe("priceFor refuses what it cannot price honestly", () => {
  const table = (models: Record<string, unknown>) => ({ currency: "USD", models }) as never;

  it("refuses a token entry that names only one of the two rates", () => {
    expect(priceFor(table({ "openai/gpt-5-mini": { input: 0.25 } }), "openai", "gpt-5-mini")).toBeNull();
    expect(priceFor(table({ "openai/gpt-5-mini": { output: 2 } }), "openai", "gpt-5-mini")).toBeNull();
  });

  it("still accepts an image entry that names no output rate", () => {
    // The case the relaxation exists for, and the one it must keep.
    const price = priceFor(table({ "openai/x": { input: 5, image: 0.04 } }), "openai", "x");
    expect(price?.image).toBe(0.04);
    expect(price?.output).toBe(0);
  });

  it("refuses a rate that is present and not a number", () => {
    // `Number(" ")` and `Number([])` are both 0 and both finite, so a
    // non-numeric rate used to be priced at zero rather than refused.
    for (const bad of [" ", [], true, {}, "0.25"]) {
      expect(priceFor(table({ "a/b": { input: bad, output: 1 } }), "a", "b"), String(bad)).toBeNull();
    }
  });

  it("refuses a negative rate", () => {
    // Not a discount — a typo that subtracts from the month's total and hides
    // other spend while doing it.
    expect(priceFor(table({ "a/b": { input: -5, output: 1 } }), "a", "b")).toBeNull();
    expect(priceFor(table({ "a/b": { input: 1, output: -5 } }), "a", "b")).toBeNull();
  });

  it("refuses an entry whose every rate is zero", () => {
    // Reporting real calls as accounted-for at 0.00 is worse than reporting
    // them as unpriced: one is a wrong number, the other is a known gap.
    expect(priceFor(table({ "a/b": { input: 0, output: 0 } }), "a", "b")).toBeNull();
    expect(priceFor(table({ "a/b": { image: 0 } }), "a", "b")).toBeNull();
  });
});
