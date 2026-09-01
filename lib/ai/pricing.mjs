// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Turning token counts into money. Pure, and the only arithmetic in this layer.
//
// ── The unit cancellation, once ────────────────────────────────────────────
// Prices are quoted per MILLION tokens. Money is stored in MICROS (millionths
// of a currency unit), the same integer discipline `orders.amountCents` uses,
// one step finer because a call can cost 0.0004 of a unit.
//
//     tokens ÷ 1_000_000  ×  price  ×  1_000_000 micros-per-unit  =  tokens × price
//
// So `costMicros = tokens × pricePerMillion`, exactly. A model at 3 per million
// costs 3,000 micros for 1,000 input tokens. Writing that out removes a whole
// class of rounding bug that would otherwise be found on an invoice.
//
// ── Why .mjs ───────────────────────────────────────────────────────────────
// `scripts/ai/check.mjs` estimates what a call will cost, and `lib/ai/usage.ts`
// computes what one did cost. Same arithmetic, two readers, and the scripts here
// do not import TypeScript (CLAUDE.md → Three systems).

/** Fallback when the price file names none. */
export const DEFAULT_CURRENCY = "USD";

/**
 * The languages whose operators are, by a large majority, billed in euro.
 *
 * A crude proxy and openly one — the app has no country, only a language, and
 * `de` covers Austria as well as Switzerland, `fr` covers France as well as
 * Canada. It is right often enough for a SUGGESTION and would be indefensible
 * as a rule, which is exactly why it is only ever the former.
 *
 * `en` is deliberately not here: it is the language the rest of the world
 * shares, and its most likely operator is not in the euro area.
 */
const EURO_LOCALES = new Set(["de", "es", "fr"]);

/**
 * The currency recommended for an installation, by its language.
 *
 * A RECOMMENDATION and never a rule (FR-42a): a provider bills in what it bills
 * in, and refusing a currency would only push somebody into entering a
 * hand-converted number with no rate and no date attached to it — the worst
 * possible place for an exchange rate to live. `ai-check` suggests; nothing
 * enforces.
 */
export function recommendedCurrency(locale) {
  return EURO_LOCALES.has(locale) ? "EUR" : "USD";
}

/** The key a price entry is filed under. `provider/model`, never bare model. */
export function priceKey(provider, model) {
  return `${provider}/${model}`;
}

/**
 * The price entry for one model, with its currency resolved.
 *
 * Returns null when there is none — and that is a real answer, not an error.
 * A model with no price produces a usage row carrying its token counts and NO
 * cost, which the report then counts and names. Recording zero instead would
 * produce a page reading "0.00" for a month that cost real money.
 *
 * The key is `provider/model` because OpenRouter serves models whose names
 * belong to other vendors: a bare model name would collide the moment somebody
 * routes the same model two ways to compare price.
 */
export function priceFor(table, provider, model) {
  const entry = table?.models?.[priceKey(provider, model)];
  if (!entry || typeof entry !== "object") return null;

  const rawInput = Number(entry.input);
  const rawOutput = Number(entry.output);
  // An image model may be billed per PICTURE and not per token at all, so an
  // entry carrying only `image` is a complete price rather than a broken one.
  // Requiring token rates here would leave every image call unpriced, which the
  // cost page would then correctly report as "could not account for" — a true
  // statement about a price we do have.
  const image = Number(entry.image);
  // ── Absent is not the same as unreadable, and the difference is money ────
  // An entry naming only SOME rates is a real thing: an image model bills for
  // the prompt it reads and not for text it does not write, so a missing
  // `output` legitimately means zero. A rate that is PRESENT and unparseable
  // ("three") is a typo, and pricing a typo at zero is an undercharge with no
  // symptom — so that one refuses the whole entry, as it always has.
  //
  // `stated` asks whether the operator WROTE something, and it has to be strict
  // about the type: `Number(" ")` and `Number([])` are both 0 and both finite,
  // so a rate written `" "`, `[]` or `true` used to sail through as zero. Only
  // a number is a rate.
  const stated = (value) => value !== undefined && value !== null && value !== "";
  const broken = (raw, value) => stated(value) && (typeof value !== "number" || !Number.isFinite(raw));
  if (broken(rawInput, entry.input) || broken(rawOutput, entry.output) || broken(image, entry.image)) {
    return null;
  }

  const input = Number.isFinite(rawInput) ? rawInput : 0;
  const output = Number.isFinite(rawOutput) ? rawOutput : 0;
  const hasImage = Number.isFinite(image) && image >= 0;

  // A negative rate is not a discount, it is a typo that SUBTRACTS from the
  // month's total and hides other spend while doing it.
  if (input < 0 || output < 0) return null;

  // ── The relaxation above belongs to image entries, and only to them ───────
  // "A missing `output` legitimately means zero" is true of a model billed per
  // picture and false of every model billed per token. Applied to both, it
  // turned a chat entry that forgot its `output` rate — an ordinary hand-edit
  // of `config/ai-prices.json` — into a price of zero for every token the model
  // writes: measured, 10k in and 50k out reported 2,500 micros against a true
  // 102,500, with nothing anywhere saying so. Refusing the entry instead puts
  // the model in `ai-check`'s unpriced list and on the cost page beside the
  // total as "could not account for", which is the honest answer and the one
  // this function's own docstring promises.
  if (!hasImage && !(stated(entry.input) && stated(entry.output))) return null;

  // Something has to be priceable, or this is not a price at all. An entry
  // whose every rate is zero prices real calls at 0.00 and reports them as
  // accounted for, which is worse than reporting them as unpriced.
  if (input <= 0 && output <= 0 && !(hasImage && image > 0)) return null;

  return {
    input,
    output,
    /**
     * Price of ONE picture, in whole currency units — not per million, unlike
     * every other rate here. Images are sold by the piece, and quoting them per
     * million would put a six-zero conversion between the vendor's price page
     * and this file for somebody to get wrong.
     */
    image: hasImage ? image : 0,
    // Cached input is far cheaper than fresh input wherever it is reported;
    // absent, it falls back to the full input rate, which over-states rather
    // than under-states. Better to look expensive than to look free.
    cachedInput: Number.isFinite(Number(entry.cachedInput)) ? Number(entry.cachedInput) : input,
    // A cache WRITE costs more than plain input (Anthropic charges 1.25x/2x).
    // Absent, the input rate is the closest honest guess.
    cacheWrite: Number.isFinite(Number(entry.cacheWrite)) ? Number(entry.cacheWrite) : input,
    // Thinking is billed as output where it is billed at all, so that is the
    // fallback — and it is why a Gemini entry MAY name its own rate but need
    // not (PRD §9.7).
    thinking: Number.isFinite(Number(entry.thinking)) ? Number(entry.thinking) : output,
    currency:
      typeof entry.currency === "string" && entry.currency.trim() !== ""
        ? entry.currency.trim()
        : (typeof table?.defaultCurrency === "string" && table.defaultCurrency.trim() !== ""
            ? table.defaultCurrency.trim()
            : DEFAULT_CURRENCY),
  };
}

/**
 * What a call cost, in micros of the price entry's currency.
 *
 * Rounded PER TERM rather than once at the end, so each term can be checked
 * independently against a provider's own invoice line.
 *
 * `inputTokens` is the TOTAL including the cached part — that is how every
 * adapter in this repo normalizes it — so the cached share is subtracted before
 * the fresh part is priced. Getting that sign wrong produces a plausible-looking
 * number, which is the kind of wrong that survives review.
 */
export function costMicros(usage, price) {
  if (!usage || !price) return null;

  const cached = Math.max(0, usage.cachedInputTokens ?? 0);
  const cacheWrite = Math.max(0, usage.cacheWriteTokens ?? 0);
  // Anthropic reports cache writes inside our `inputTokens` total as well, so
  // both cached-read and cache-write tokens come off before the rest is priced
  // at the fresh-input rate.
  const fresh = Math.max(0, (usage.inputTokens ?? 0) - cached - cacheWrite);

  // Billed but not itemised (FR-43a). Priced at the OUTPUT rate — the
  // conservative choice, because where this happens at all it is thinking, and
  // thinking is billed as output. Pricing it lower would reproduce exactly the
  // undercount the reconciliation exists to catch.
  const unexplained = Math.max(0, usage.unexplainedTokens ?? 0);

  // Pictures are priced per piece, in whole currency units, so they need the
  // six-zero conversion the token terms get for free from being quoted per
  // million. An image model that also bills for its prompt tokens is priced by
  // both halves of this sum, which is why the term is added rather than
  // branched on.
  const images = Math.max(0, usage.images ?? 0);

  return (
    Math.round(fresh * price.input) +
    Math.round(cached * price.cachedInput) +
    Math.round(cacheWrite * price.cacheWrite) +
    Math.round((usage.outputTokens ?? 0) * price.output) +
    Math.round(unexplained * price.output) +
    Math.round(images * (price.image ?? 0) * 1_000_000)
  );
}

/**
 * What a call of a given shape would cost — for the check command, before any
 * call has been made.
 *
 * An ESTIMATE, and labelled as one wherever it is printed: nobody knows how
 * long an answer will be. It exists so an Operator choosing between two models
 * sees the order of magnitude at the moment they choose, rather than on an
 * invoice.
 */
export function estimateMicros(price, inputTokens, outputTokens) {
  return costMicros(
    {
      inputTokens,
      outputTokens,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
    },
    price,
  );
}

/** Micros as a human-readable amount. `1234567` → `"1.234567"`. */
export function formatMicros(micros, currency, digits = 4) {
  if (micros === null || micros === undefined) return `— ${currency}`;
  return `${(micros / 1_000_000).toFixed(digits)} ${currency}`;
}
