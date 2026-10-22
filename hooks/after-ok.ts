// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import type { ActionState } from "./use-action-toast";

/**
 * Run something once a server action has SUCCEEDED — close the dialog, empty
 * the field, drop the confirmation — and nothing on a refusal.
 *
 *   const [state, action, pending] = useActionState(
 *     afterOk(createUserAction, () => setOpen(false)),
 *     EMPTY_ACTION_STATE,
 *   );
 *   useActionToast(state);
 *
 * ── Why a wrapper and not an effect ─────────────────────────────────────────
 * Until 2026-10-22 every one of these sites was
 * `useEffect(() => { if (state.ok) setOpen(false); }, [state])` — twenty-two
 * copies, and every one a second render pass: the action's result commits, the
 * effect sees it, sets state, and React renders again. `react-hooks/
 * set-state-in-effect` names exactly that, and React's own answer is "handle
 * it where the event happens". The event is the action finishing, so this
 * wraps the action: the callback runs INSIDE the transition `useActionState`
 * opened, and the result and the state it causes land in ONE render. It is
 * also where a parent's callback (`onChanged?.()`) may be called — a render
 * may not set another component's state, an action may.
 *
 * `then` sees the result, so a site that needs the message or an id gets it.
 * A refusal (`ok === null`) runs nothing: that is the whole point of closing
 * on success only — the dialog stays up with the input intact and the toast
 * saying why, and a `then` that wants the error has `useActionToast(state)`
 * next door. The wrapper is created afresh on every render and that is fine:
 * React reads the action it was last given, so `then` is never stale.
 *
 * ⚠️ What a wrapped action gives up is progressive enhancement — a
 * `<form action={serverAction}>` works before hydration only with the server
 * reference itself. Nothing here is such a form: a dialog does not exist
 * before hydration, and the composers submit through `useTransition` already.
 */
export function afterOk<S extends ActionState, P>(
  action: (previous: S, payload: P) => Promise<S> | S,
  then: (state: S) => void,
): (previous: S, payload: P) => Promise<S> {
  return async (previous, payload) => {
    const next = await action(previous, payload);
    if (next.ok) then(next);
    return next;
  };
}
