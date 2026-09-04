<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# Gating examples — entitlement check and token charge

_The signatures of every function used below, and of every other `lib/` file the
guidance names, are in `docs/api-map.md` — one section per file. Read the
section; open the source only when a signature is not enough._

_Read from `build-app`, step 3: the two worked snippets. The rules around them
— check → work → charge in that order, never a member id in `spendTokens`'
signature, never answering access from a billing table — stay in the skill
itself._

## Purchase-dependent content asks the entitlement API

```ts
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { hasPlan } from "@/lib/entitlements/manage";

const session = await auth();
if (!session?.user?.id) redirect("/login");
// A plan key from config/digistore-products.json. A token package is a
// balance, not an entitlement, and always answers false here.
// The key travels along: /plans then says which plan this page was waiting
// for (app/plans/needs.ts) — a bare /plans reads as the price list.
if (!(await hasPlan(session.user.id, "basic_monthly"))) redirect("/plans?needs=basic_monthly");
```

## Usage-metered content charges tokens

```ts
import { getTokenAccount, hasSufficientBalance } from "@/lib/tokens/account";
import { spendTokens } from "@/lib/tokens/spend";
import { TokenError } from "@/lib/tokens/rules";

const COST = 5;

// 1. CHECK — before anything expensive runs.
const account = await getTokenAccount(session.user.id);
if (!hasSufficientBalance(account?.balance ?? 0, COST)) {
  return { error: t("insufficientBalance") };
}

// 2. WORK
const report = await buildReport();

// 3. CHARGE
try {
  await spendTokens({ amount: COST, note: "report generation" });
} catch (err) {
  if (err instanceof TokenError) return { error: t(err.code) };
  throw err;
}
```

## Typical test cases (step 4)

Typical cases: access rules (entitled → feature, not entitled → no feature,
refunded → gone, cancelled → still there until the paid period ends), input
validation, edge and error cases.
