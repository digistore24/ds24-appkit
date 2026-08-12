// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

"use client";

// **The polling loop, once, for every surface that breathes.**
//
// ⚠️ **This file exists because the loop was copied instead of shared, and the
// copies drifted apart in the way copies do.** Story 20.2 wrote it inside
// `live-discussion.tsx`; Story 21.1 duplicated the whole component into
// `live-conversation.tsx`; Story 22.2 wrote a third variant in
// `feed-list.tsx`. When the Epic-20 review found four defects in the loop on
// 2026-08-06 they were fixed in ONE of the three, and the other two stood
// beside it with the same bugs — which is how a form-check found them a day
// later. A shared hook is the only version of this that stays fixed.
//
// What it owns, and what the caller keeps:
//
//   - **it owns** the request, the cursor, the timer, the back-off, the
//     visibility handling and the one latch that stops everything;
//   - **the caller keeps** what an answer MEANS — merging rows, refreshing a
//     route, flipping a lock. The hook has no opinion about content.
//
// ── The four things it does that a naive loop does not ────────────────────
//
// 1. **One request at a time.** The visibility handler polls straight away
//    when a tab comes back; without a guard it did so while a scheduled poll
//    was still in flight, and both continuations rescheduled. Two chains, then
//    three — a member flicking between tabs bought the endpoint a permanent
//    multiple of the configured rate.
//
// 2. **One chain, enforced by a generation number.** Clearing the handle is
//    not enough on its own: by the time the handler runs, the timeout it wants
//    to cancel may already have fired, so the clear is a no-op and its
//    callback goes on to arm a chain nobody can reach any more.
//
// 3. **An ANSWERED refusal is not a transport failure.** A dropped connection
//    says nothing about what a member may read, and treating it as a refusal
//    would put a permanent "no longer available" over a conversation that is
//    fine. But 404 (the module switched off) and 401 (the session ended) are
//    the server telling us something. While every non-`ok` was retried at the
//    unchanged interval, flipping the kill switch — the documented incident
//    response — relieved none of the load it was flipped to relieve.
//
// 4. **Repeated failures back off, and one good answer resets.** A server
//    answering 500 used to be asked again every five seconds by every open
//    tab, for as long as it stayed broken: the load arriving exactly when the
//    host could least carry it.
import { useCallback, useEffect, useRef, useState } from "react";

import { pollDelayMs, type PollSchedule } from "@/modules/community/lib/rules";

/** One scope's answer, as the endpoint sends it. */
export type ScopeAnswer<T> =
  | { state: "unavailable" }
  | {
      state: "ok";
      cursor: string | null;
      locked: boolean;
      /**
       * Something the caller is HOLDING changed, and this answer does not say
       * what. Only the feed ever sets it — see `feedSince()` in
       * `lib/community/manage.ts` for why that scope cannot carry tombstones.
       */
      stale: boolean;
      posts: T[];
    };

/** The `ok` half — what a caller is handed. */
export type LiveAnswer<T> = Extract<ScopeAnswer<T>, { state: "ok" }>;

export function useLiveScope<T>(input: {
  /** The scope object, exactly as `/api/community/live` expects it minus the cursor. */
  scope: Record<string, unknown>;
  /**
   * Where to start reading.
   *
   * ⚠️ Never `null` for a view that simply rendered nothing — the endpoint
   * cannot tell that apart from a token it failed to parse, and answers both
   * by resynchronising PAST whatever arrived meanwhile. A view with no rows
   * sends `liveCursorBeginning()`.
   */
  initialCursor: string | null;
  schedule: PollSchedule;
  /** Whether this view should breathe at all. */
  live: boolean;
  /** What an `ok` answer means here. Called on every good poll. */
  onAnswer: (answer: LiveAnswer<T>) => void;
}): { stopped: boolean; poll: () => Promise<void> } {
  const [stopped, setStopped] = useState(false);

  const cursor = useRef(input.initialCursor);
  const stoppedRef = useRef(false);
  /** Consecutive failed polls. Feeds the back-off; reset by one good answer. */
  const failures = useRef(0);
  /** Is a request already in flight? See point 1 in the header. */
  const inFlight = useRef(false);

  // Scope and callback live in refs so that a caller building either inline —
  // which every caller does — cannot churn the effect below into tearing the
  // timer down and up on every render.
  const scopeRef = useRef(input.scope);
  scopeRef.current = input.scope;
  const onAnswerRef = useRef(input.onAnswer);
  onAnswerRef.current = input.onAnswer;

  const poll = useCallback(async (): Promise<void> => {
    if (stoppedRef.current) return;
    if (inFlight.current) return;
    inFlight.current = true;

    // Every path out of here has to put the flag down, or the loop stops
    // asking after its first bad poll.
    try {
      let answer: ScopeAnswer<T> | undefined;
      try {
        const response = await fetch("/api/community/live", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            scopes: [{ ...scopeRef.current, cursor: cursor.current }],
          }),
        });
        if (response.status === 404 || response.status === 401) {
          stoppedRef.current = true;
          setStopped(true);
          return;
        }
        if (!response.ok) {
          failures.current += 1;
          return;
        }
        const body = (await response.json()) as { scopes?: ScopeAnswer<T>[] };
        answer = body.scopes?.[0];
      } catch {
        // A thrown fetch is the wire, not the server. Back off and ask again.
        failures.current += 1;
        return;
      }
      if (!answer) {
        failures.current += 1;
        return;
      }

      if (answer.state === "unavailable") {
        // Once. No retry, no repeated error, and nothing touched in whatever
        // the member was composing.
        stoppedRef.current = true;
        setStopped(true);
        return;
      }

      failures.current = 0;
      cursor.current = answer.cursor;
      onAnswerRef.current(answer);
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    if (!input.live || stopped) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    let generation = 0;

    const arm = () => {
      if (cancelled || stoppedRef.current) return;
      if (timer) clearTimeout(timer);
      const mine = ++generation;
      const hidden =
        typeof document !== "undefined" && document.visibilityState === "hidden";
      timer = setTimeout(async () => {
        if (cancelled || mine !== generation) return;
        await poll();
        if (cancelled || mine !== generation) return;
        arm();
      }, pollDelayMs(input.schedule, hidden, failures.current));
    };

    // A tab coming back to the foreground asks straight away rather than
    // waiting out the interval it was scheduled for while hidden — that wait
    // is what would make somebody switching back see a stale room.
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      void poll().then(() => arm());
    };

    arm();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [input.live, input.schedule, stopped, poll]);

  return { stopped, poll };
}
