// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

"use client";

// **One panel, N call sites — the surface of an interactive element.**
//
// A page that wants an element renders exactly this and nothing else:
//
//     <ActivityPanel activityId="silben-spiel" subject={unit.slug}>
//       <SilbenSpiel />
//     </ActivityPanel>
//
// The children are the app's own game UI — a client component that reaches
// everything through `useActivity()`: the loaded material, the resume point,
// `submit()`, `pending`, and `announce()` for anything a screen reader should
// hear. A second element is a second registry entry and a second call site —
// never a second panel (the companion rule, applied here).
//
// Everything that decides anything lives on the server: the gate, the
// attempts, the verdict and the charge are `modules/activity/actions.ts`, and this
// file sends two strings and a submission. What it renders is what `load()`
// returned — which never includes the answers (rule 3 in
// `modules/activity/activities.ts`).
//
// ── The rules for the game UI you put inside ───────────────────────────────
//
// 1. **Keyboard first.** Every interaction must be completable with the
//    keyboard alone — a drag without a key path is a BFSG defect in a
//    consumer product, and it is the naive way to build a game. Use real
//    `<Button>`s from `components/ui/`; a clickable `<div>` is invisible to
//    both keyboard and screen reader.
// 2. **Announce through the seam.** `announce()` feeds the panel's one
//    `aria-live` region. Verdicts and errors are announced by the panel
//    itself; announce your own state changes ("word 3 of 6") — do not build a
//    second live region, two of them talk over each other.
// 3. **A time limit needs an alternative.** If your game runs on a clock,
//    offer an untimed way through — a limit nobody can extend is a wall, not
//    a challenge.
// 4. **Submit through `submit()`, guarded by `pending`.** The panel disables
//    nothing in YOUR UI — render your controls with
//    `disabled={activity.pending}`. Two submissions charge twice
//    (`spendTokens` is not idempotent), and `pending` is the double-click
//    guard.
// 5. **If your `grade()` sends the submission to a model**, the disclosure
//    duty applies exactly as it does to a companion — see
//    `lib/ai/disclosure.mjs` before you switch it on.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslations } from "next-intl";

import { Callout } from "@/components/ui/callout";
import {
  loadActivityAction,
  submitActivityAction,
  type ActivityState,
} from "@/modules/activity/actions";
import type { ActivityErrorCode } from "@/modules/activity/rules";

/** What the game UI inside the panel may reach. */
export interface ActivityApi {
  /** What `load()` returned for this member and subject. */
  data: unknown;
  /**
   * The stored resume point, or `null` on a first visit. JSON-plain: a Date,
   * Map or class your grade() put into `state` comes back as what JSON made
   * of it — store plain data.
   */
  resume: unknown;
  attempts: number;
  maxAttempts: number | null;
  score: number | null;
  maxScore: number | null;
  passed: boolean | null;
  /** Tokens one finalised submission costs — say it BEFORE they play. */
  costsTokens: number;
  /** A submission is on its way — disable your controls on it. */
  pending: boolean;
  /** Send a submission to the server. The verdict comes back through the api. */
  submit: (submission: unknown) => Promise<void>;
  /** Say something to screen readers through the panel's live region. */
  announce: (message: string) => void;
}

const ActivityContext = createContext<ActivityApi | null>(null);

/** The game UI's handle on its panel. Throws outside an `<ActivityPanel>`. */
export function useActivity(): ActivityApi {
  const api = useContext(ActivityContext);
  if (!api) throw new Error("useActivity() must be used inside <ActivityPanel>.");
  return api;
}

export interface ActivityPanelProps {
  /** An id from `modules/activity/activities.ts`. */
  activityId: string;
  /** The unit's slug — the same string a companion on this unit uses. */
  subject: string;
  /** The app's own game UI. It reaches everything via `useActivity()`. */
  children: ReactNode;
}

export function ActivityPanel({ activityId, subject, children }: ActivityPanelProps) {
  const t = useTranslations("activity");
  // Codes are translated through the `errors` namespace, like every other
  // layer that returns codes — i18n/messages.test.ts walks the union.
  const tErrors = useTranslations("errors");

  const [loaded, setLoaded] = useState<ActivityState | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [score, setScore] = useState<number | null>(null);
  const [maxScore, setMaxScore] = useState<number | null>(null);
  const [passed, setPassed] = useState<boolean | null>(null);
  const [pending, setPending] = useState(false);
  const [errorCode, setErrorCode] = useState<ActivityErrorCode | null>(null);
  const [notRecorded, setNotRecorded] = useState(false);
  const [liveMessage, setLiveMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    // A new element starts clean — without this, the previous element's
    // attempts, "Passed!" and error survive a prop change.
    setLoaded(null);
    setAttempts(0);
    setScore(null);
    setMaxScore(null);
    setPassed(null);
    setErrorCode(null);
    setNotRecorded(false);
    setLiveMessage("");
    loadActivityAction({ activityId, subject })
      .then((state) => {
        if (cancelled) return;
        setLoaded(state);
        if (state.state === "ready" && state.stored) {
          setAttempts(state.stored.attempts);
          setScore(state.stored.score);
          setMaxScore(state.stored.maxScore);
          setPassed(state.stored.passed);
        }
      })
      .catch(() => {
        // A transient failure must be a sentence, not an eternal "Loading …".
        if (!cancelled) setLoaded({ state: "off", code: "activityFailed" });
      });
    return () => {
      cancelled = true;
    };
  }, [activityId, subject]);

  const announce = useCallback((message: string) => setLiveMessage(message), []);

  // The double-click guard the header promises. A state variable cannot keep
  // it — two calls in one tick both read pending=false before the re-render,
  // and the server counts BOTH (sequentially they read different attempt
  // counts, so the setWhere guard lets each through). The ref is synchronous.
  const pendingRef = useRef(false);

  const submit = useCallback(
    async (submission: unknown) => {
      if (pendingRef.current) return;
      pendingRef.current = true;
      setPending(true);
      setErrorCode(null);
      setNotRecorded(false);
      try {
        const result = await submitActivityAction({ activityId, subject, submission });
        if (!result.ok) {
          // The danger Callout carries role="status" and announces itself —
          // feeding the live region too would say every error twice.
          setErrorCode(result.code);
          return;
        }
        setAttempts(result.attempts);
        setScore(result.verdict.score);
        setMaxScore(result.verdict.maxScore);
        setPassed(result.verdict.passed);
        if (!result.recorded) setNotRecorded(true);
        // The live region says only what no Callout will: a pass renders the
        // success Callout (role="status", announces itself).
        if (!result.verdict.final) {
          setLiveMessage(t("checkpointSaved"));
        } else if (result.verdict.passed === false) {
          setLiveMessage(t("passedNo"));
        } else if (result.verdict.passed === null) {
          setLiveMessage(t("finished"));
        }
      } catch {
        setErrorCode("activityFailed");
      } finally {
        pendingRef.current = false;
        setPending(false);
      }
    },
    [activityId, subject, t],
  );

  // Memoised, or every announce() re-renders the whole game subtree — and
  // ABOVE the early returns, because a hook behind a conditional return
  // changes the hook order the moment loading turns ready.
  const ready = loaded !== null && loaded.state === "ready" ? loaded : null;
  const api: ActivityApi | null = useMemo(
    () =>
      ready
        ? {
            data: ready.data,
            resume: ready.stored?.state ?? null,
            attempts,
            maxAttempts: ready.maxAttempts,
            costsTokens: ready.costsTokens,
            score,
            maxScore,
            passed,
            pending,
            submit,
            announce,
          }
        : null,
    [ready, attempts, score, maxScore, passed, pending, submit, announce],
  );

  if (loaded === null) {
    return <p className="text-muted-foreground text-sm">{t("loading")}</p>;
  }

  if (loaded.state === "off") {
    // One honest sentence instead of a dead surface — the same shape as the
    // plans page's blocker. The code decides the sentence; this component has
    // no language of its own.
    return <Callout variant="warning" title={tErrors(loaded.code)} />;
  }

  return (
    <div className="flex flex-col gap-3">
      {loaded.maxAttempts !== null && (
        <p className="text-muted-foreground text-sm">
          {t("attemptsOf", { count: attempts, max: loaded.maxAttempts })}
        </p>
      )}

      <ActivityContext.Provider value={api!}>{children}</ActivityContext.Provider>

      {errorCode && (
        <Callout variant="danger" title={tErrors(errorCode)} />
      )}
      {notRecorded && (
        <Callout variant="info" title={tErrors("activityNotRecorded")} />
      )}
      {passed === true && <Callout variant="success" title={t("passedYes")} />}

      {/* The live region for what no Callout says (rule 2) — checkpoints,
          fails, finishes, and the game's own announce(). Callouts carry
          role="status" and announce themselves. */}
      <div aria-live="polite" className="sr-only">
        {liveMessage}
      </div>
    </div>
  );
}
