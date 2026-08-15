// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

"use server";

// Click-time checkout for a signed-in Member.
//
// The page no longer builds a link for every plan while rendering. A Member
// presses a button, and only then does this run: record who is buying what,
// then ask Digistore24 for a checkout URL that carries that record's id.
//
// The buyer's identity travels WITH the checkout: their member id, their
// checkout token and the product key, in tracking[custom]. Digistore24 stores
// it on the purchase and hands it back on every later event, which is what
// lets a payment find its owner even when the buyer pays under an address the
// app has never seen.
//
// SECURITY: a server action is an HTTP endpoint of its own. The button only
// renders for a signed-in Member, but that is cosmetics — the check below is
// what actually holds.
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";

import { auth } from "@/auth";
import { getProduct, isSold } from "@/lib/digistore/products";
import { checkoutLinkFor } from "@/lib/digistore/checkout";
import { buildIdentity, purchaseOriginFor } from "@/lib/digistore/custom";
import { ensureCheckoutToken } from "@/lib/users/checkout-token";

export async function startCheckoutAction(formData: FormData): Promise<void> {
  const session = await auth();
  const memberId = session?.user?.id;
  const email = session?.user?.email ?? undefined;

  if (!memberId) redirect("/login");

  const productKey = String(formData.get("planKey") ?? "");
  // The checkbox on a token card. Only meaningful for a package — a
  // subscription has no balance to keep topped up — so the product decides
  // below, not the form.
  const wantsAutoReload = formData.get("autoReload") === "on";
  let url: string | null = null;

  try {
    // Throws on an unknown key — a tampered form must not silently do nothing.
    const def = getProduct(productKey);
    // 🚨 And throws on a PARKED one, for the same reason. This is an HTTP
    // endpoint: taking an offering off `/plans` removes the button, not the
    // route, so a product that was synced while it was on sale would stay
    // buyable by anyone who kept the form field — the buyer pays for
    // something the vendor withdrew. Exactly the failure the registry loader
    // describes for a `kind` typo: "silently vanish from the sales page while
    // STAYING BUYABLE via a direct POST".
    //
    // A refusal here and nowhere near `hasPlan()`, `getTokenPackage()` or the
    // IPN: this is a NEW purchase decision, and those are existing payment
    // relationships.
    if (!isSold(def)) {
      throw new Error(`Produkt "${productKey}" wird nicht mehr verkauft.`);
    }
    const checkoutToken = await ensureCheckoutToken(memberId);
    // Decides WHICH of the offering's Digistore24 products they are sent to,
    // and with it the language of the order form — a DS24 product carries
    // exactly one (lib/digistore/products.ts). A Member reading the app in
    // English must not be handed a German checkout page.
    const locale = await getLocale();

    const link = await checkoutLinkFor(
      def,
      {
        // Pins the checkout to the address they signed in with. They may still
        // pay with another one at Digistore24 — the identity string is what
        // makes that harmless.
        ...(email ? { buyer: { email } } : {}),
        customTracking: buildIdentity({
          memberId,
          checkoutToken,
          productKey,
          // Plans and prepaid top-ups are told apart by this; an unattended
          // auto top-up carries "auto" (set in autoReloadIfNeeded). The rule
          // lives with the type it belongs to — a `one_time` purchase is a
          // plan, not a top-up, and used to be recorded as one.
          kind: purchaseOriginFor(def.kind),
          // Travels as one more pair in tracking[custom] (AD-5) rather than a
          // column, because the thing it will be attached to does not exist yet:
          // the chargeable purchase_id is created when Digistore24 confirms this
          // payment. The IPN reads the pair back and arms the mandate then.
          armAutoReload: wantsAutoReload && def.kind === "token",
        }),
      },
      locale,
    );
    url = link.url;
  } catch (error) {
    // Visible in `node run.mjs logs`. The buyer gets a sentence, not a stack trace,
    // and never a fabricated checkout URL — a failed checkout must never look
    // like a successful one (see the `guardrails` skill).
    console.error("[checkout] could not start checkout:", error);
  }

  // MUST stay outside the try/catch above. redirect() works by throwing a
  // NEXT_REDIRECT control-flow error; caught, it would be logged as an
  // unexpected failure and the buyer would be stranded on /plans with a
  // generic message while everything had in fact worked.
  if (!url) redirect("/plans?checkout=error");
  redirect(url);
}
