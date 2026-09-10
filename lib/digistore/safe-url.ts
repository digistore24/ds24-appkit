// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// One scheme whitelist for every URL that arrives from Digistore24.
//
// Finding L-3 of the 2026-08-18 scan named the API path — `renew_url`,
// `rebilling_stop_url` and `invoice_url` out of `getPurchase`, straight into an
// `href`. There is a second entry point for the SAME three columns, and it is
// the one the billing page actually renders: the IPN body, written to the
// database by `payment-event.ts` and `member-billing.ts` with no filter at all.
// Guarding one of two doors is a list somebody has to keep current, so the
// judgement lives here and both doors call it.
//
// ⚠️ **This is depth, not a boundary.** Both paths carry values Digistore24
// sent us, and the IPN's SHA512 signature is checked before any of this runs.
// What it costs is one regex; what it buys is that the tree's own doctrine —
// *never put a URL from somewhere else into an href without a scheme check* —
// holds where the values actually come from, rather than only where somebody
// happened to look.
//
// `https:` only, deliberately. Digistore24 is an HTTPS-only service, so `http:`
// would be a downgrade rather than a convenience, and `javascript:` and `data:`
// are the shapes this exists to refuse.

/**
 * The value if it is an `https://` URL, otherwise `undefined` — with a line in
 * the log saying which field was dropped.
 *
 * 🚨 It reports through `console.error` WITH an Error, not `console.warn`:
 * `lib/diagnostics/parse.mjs` keys on the error shape, and a missing "cancel
 * subscription" button is otherwise indistinguishable from Digistore24 not
 * having sent one.
 */
export function ds24HttpsUrl(field: string, value: string | null | undefined): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (/^https:\/\//i.test(value)) return value;
  console.error(
    `[digistore] refusing a non-https ${field} from Digistore24: ${value.slice(0, 60)}`,
    new Error(`non-https URL in ${field}`),
  );
  return undefined;
}

/** The same judgement where the column is `string | null` rather than optional. */
export function ds24HttpsUrlOrNull(field: string, value: string | null | undefined): string | null {
  return ds24HttpsUrl(field, value) ?? null;
}
