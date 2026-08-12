// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// **A way into a private conversation — offered only to a session that has
// one.**
//
// ⚠️ **The gate lives with the thing it gates, and that is the point.** The
// member profile page used to render `StartConversationButton` directly and
// wrap it in a condition of its own. That works and cannot be PROVEN to work:
// a structural test reading the source can see that the page consults the
// seam and that the button appears after it, but not that the condition
// actually encloses the button — measured, by deleting the wrapper and
// watching the guard stay green.
//
// Moving the check in here turns a heuristic into a fact. A mixed surface may
// name this component; naming `StartConversationButton` itself is what
// `lib/community/impersonation-guard.test.ts` refuses, and there is then
// nothing left to get subtly wrong at the call site.
//
// ── Why it renders nothing rather than something disabled ─────────────────
// FR-209 removes the CAPABILITY rather than logging its use, and
// `dm-actor.ts` carries the argument: reading somebody's mail leaves no second
// trace, so "an operator was in the account for thirty minutes" is not an
// answer to "did anybody read my messages". A greyed-out button would still
// say a private conversation is a thing that exists here for this member. The
// module's promise is that an impersonated session "finds no DM surface at
// all", and a painted door is one.
//
// The action behind the button refuses anyway (`requireDmActor()` → 404). This
// is not that refusal — it is not offering the dead end in the first place.
import { auth } from "@/auth";
import { mayUseDmSurfaces } from "@/modules/community/lib/dm-presence";

import { StartConversationButton } from "@/modules/community/pages/messages/ui";

export async function DmEntryPoint({ memberId }: { memberId: string }) {
  const session = await auth();
  if (!session || !mayUseDmSurfaces(session)) return null;
  return <StartConversationButton memberId={memberId} />;
}
