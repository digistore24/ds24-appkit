// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The two facts about this app that nothing outside it can answer.
//
//   * **does the media store answer** — the bucket this app's customers'
//     pictures, recordings and downloads live in
//   * **when did the last IPN arrive** — the payment notification that turns a
//     purchase into access
//
// Everything else an operator wants to know about a deployed app is already
// answerable from outside: `/api/healthz` says it is up, `/api/readyz` says the
// database answers, `/api/cron?list` says what the scheduler did, and
// `/api/diagnostics/errors` says what a 200 is hiding. These two are not, and
// the reason is the same for both: the credentials are the HOST's. An operator's
// laptop has neither the production bucket keys nor a production connection
// string, and `docs/DEPLOY.md` is written so it never needs them.
//
// ── It returns FACTS. It says nothing ──────────────────────────────────────
//
// No sentence, no glyph, no severity, no formatting. `node run.mjs health`
// turns these codes into an operator's words and Story 32.4's watchdog turns
// the same codes into a mail's; a shared evaluator that already contained
// English would make one of the two speak in the other's voice.
//
// 🚨 **`code` is a CLOSED UNION declared here, never `error.message`.** A media
// driver's error carries the bucket URL and a Postgres error carries the
// query's parameters. This object goes out over HTTP to whoever holds
// `DIAGNOSTICS_SECRET`, and the same discipline `notifyOperators()` keeps
// applies: the original goes to `console.error`, the code goes on the wire.
//
// 🚨 **No `state: "ok"` is ever composed from a `catch`.** Each probe sits in
// its own `try`, neither can throw out of `operationalState()`, and every catch
// produces `finding` or `unchecked` — never the state that reads as health.
//
// ── Read-only, on purpose ──────────────────────────────────────────────────
//
// `node run.mjs media-check` writes a throwaway object, reads it back and
// deletes it, and that is right for a command a PERSON runs. This evaluator is
// called on a schedule by Story 32.4, and a scheduled writer putting objects
// into a customer's production bucket several times a day is a cost and a
// lifecycle-rule surprise nobody asked for. So the probe here is a `HEAD` of a
// key that is not there: the store ANSWERING is the whole question, and "not
// found" is a perfectly good answer.
//
// What that cannot catch is a bucket that accepts `HEAD` and refuses `PUT`. If
// that ever turns out to matter, the honest answer is a `--deep` flag on the
// COMMAND that writes — never a scheduled writer.
import { access, constants } from "node:fs/promises";

import { db } from "@/db";
import { ipnEvents, orders } from "@/db/schema";
import { desc, gte } from "drizzle-orm";

import { appEnv } from "@/lib/env-guard";
import { sellableProducts, productIdsOf, type SyncEnv } from "@/lib/digistore/products";
import { IPN_LOG_RETENTION_DAYS } from "@/lib/digistore/ipn-log";
import { localDirFromEnv } from "@/lib/media/local";
import { driverFromEnv, mediaStore, mediaStoreProblems, type MediaDriver } from "@/lib/media/store";

/** What a component answered. There is no fourth. */
export type OpsComponentState = "ok" | "finding" | "unchecked";

/**
 * Why the media component answered what it did — closed.
 *
 *   answered              the store replied. On `s3` that is a real HTTP round
 *                         trip; on `local` the configured directory is there
 *                         and writable
 *   misconfigured         the store cannot be used at all — an unknown
 *                         `MEDIA_DRIVER`, a missing key, an endpoint carrying a
 *                         path. Answered without a single request
 *   unreachable           the store was asked and did not answer
 *   timedOut             it was asked and had not answered inside the window
 *   localDirUnwritable    `MEDIA_DRIVER=local` and the directory is gone or
 *                         read-only. Its own code because the fix is a disk,
 *                         not a credential
 */
export type MediaCode =
  | "answered"
  | "misconfigured"
  | "unreachable"
  | "timedOut"
  | "localDirUnwritable";

/**
 * Why the IPN component answered what it did — closed.
 *
 *   noProducts        no Digistore24 product id is configured for this
 *                     environment, so this app sells nothing here and has no
 *                     silence to report
 *   noRecentSales     it sells, but nothing has been bought inside
 *                     `IPN_ACTIVE_DAYS`. An app that has not sold in three
 *                     months has no missing purchases; that is a marketing
 *                     question, and mailing about it would be the noise this
 *                     whole epic exists to avoid
 *   recent            the newest notification is inside `IPN_SILENCE_DAYS`
 *   silent            it sells, it sold recently, and the newest notification
 *                     is older than `IPN_SILENCE_DAYS`
 *   emptyLog          🚨 it sells, it sold recently, and the log is EMPTY. That
 *                     is not "never": `prune-ipn-log` deletes past
 *                     `IPN_LOG_RETENTION_DAYS`, so an empty table under recent
 *                     orders means at least that many days of silence. Reported
 *                     as a finding naming the window, never as an unknown
 *   dbUnreachable     the database did not answer, so the log could not be read
 */
export type IpnCode =
  | "noProducts"
  | "noRecentSales"
  | "recent"
  | "silent"
  | "emptyLog"
  | "dbUnreachable";

export interface MediaState {
  state: OpsComponentState;
  driver: MediaDriver | "unknown";
  code: MediaCode;
  /** How long the probe took, in milliseconds. A number, never a timestamp. */
  ms: number;
}

export interface IpnState {
  state: OpsComponentState;
  code: IpnCode;
  /** The newest notification, or null — including when nothing was asked. */
  lastEventAt: string | null;
  /** Does this app sell anything in THIS environment at all? */
  sells: boolean;
  /** Orders inside `IPN_ACTIVE_DAYS`. `-1` means the question was not asked. */
  ordersRecent: number;
  /** Restated so a reader of the JSON can judge `emptyLog` without this file. */
  logRetentionDays: number;
  /** Whole days since `lastEventAt`, or null when there is none. */
  silentDays: number | null;
}

export interface OperationalState {
  checkedAt: string;
  media: MediaState;
  ipn: IpnState;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Beyond this many days with no notification, an app that sells and has sold
 * recently is reported as silent.
 *
 * ⚠️ **Unmeasured, and the number most likely to be wrong for a real product.**
 * A weekly-sales app reads as silent on day eight. Seven days is chosen because
 * it spans a week of every shape — a weekend, a bank holiday, a quiet Monday —
 * and because the failure it catches (an IPN endpoint that stopped verifying
 * after a passphrase rotation) is one nobody notices from inside the app.
 *
 * If the first field reports say it is wrong, the NUMBER is wrong and not the
 * design: the escape hatch is this constant with this comment, never a
 * `config/ops.json`. `lib/setup/config.ts` is the cautionary tale — one unknown
 * key there switches a whole surface off — and `docs-coverage.test.ts` requires
 * every `config/*.json` to be named in the guidance.
 */
export const IPN_SILENCE_DAYS = 7;

/**
 * How recently this app must have sold for its silence to mean anything.
 *
 * Ninety days. An app with no sale in a quarter has nothing to be missing, and
 * reporting one as broken would train its operator to ignore the report.
 */
export const IPN_ACTIVE_DAYS = 90;

/** How long the store gets to answer before the probe gives up. */
const MEDIA_TIMEOUT_MS = 8_000;

/**
 * The key the store is asked about.
 *
 * Built as a LITERAL on the reserved `.media-check` prefix
 * (`RESERVED_MEDIA_NAMESPACES`, `lib/media/rules.ts`) and never through
 * `storageKey()` — which THROWS on exactly that namespace. That throw is not a
 * bug being worked around here: it is what stops an upload key ever being built
 * on this prefix, which is why the prefix is safe to use for a probe that must
 * never collide with a customer's object.
 *
 * Nothing is written, so the key never has to be unique — but it has to be one
 * nothing could plausibly have stored, or "not found" would stop being the
 * answer that means the store is healthy.
 */
const MEDIA_PROBE_KEY = ".media-check/ops-health/probe";

/** `development` → `dev`, and the two that keep their names. */
function syncEnvOf(value?: string): SyncEnv {
  const environment = appEnv(value);
  if (environment === "development") return "dev";
  if (environment === "staging") return "staging";
  return "prod";
}

/**
 * The seams, so the test can hand this file a store that throws and a database
 * that is not there.
 *
 * Injected rather than mocked: every one of the branches below is a state of
 * somebody's production app, and a test that can only reach them by stubbing a
 * module is a test that stops reaching them the day an import moves.
 */
export interface OpsProbes {
  /** Everything wrong with the store's configuration — empty when it is usable. */
  mediaProblems: () => string[];
  mediaDriver: () => MediaDriver;
  /** A `HEAD` against the store. Resolves (with anything) when it answered. */
  headObject: (key: string, signal: AbortSignal) => Promise<unknown>;
  /** Throws when the local media directory is absent or read-only. */
  localStoreWritable: () => Promise<void>;
  /** How many products carry a Digistore24 id for THIS environment. */
  sellingProducts: () => number;
  recentOrderCount: (since: Date) => Promise<number>;
  latestIpnAt: () => Promise<Date | null>;
}

export const defaultProbes: OpsProbes = {
  mediaProblems: () => mediaStoreProblems(process.env),
  mediaDriver: () => driverFromEnv(process.env),
  headObject: (key) => mediaStore().head(key),
  localStoreWritable: () => access(localDirFromEnv(process.env), constants.W_OK),
  sellingProducts: () => {
    const environment = syncEnvOf(process.env.APP_ENV);
    // Parked offerings are not counted: the question this probe asks is "does
    // this app sell anything", and a plan taken off sale is not on offer even
    // though its Digistore24 product is still there. Counting it would keep
    // the IPN alarm armed on an app that deliberately sells nothing.
    return sellableProducts().filter((def) => Object.keys(productIdsOf(def, environment)).length > 0)
      .length;
  },
  recentOrderCount: async (since) => {
    const rows = await db
      .select({ id: orders.id })
      .from(orders)
      .where(gte(orders.createdAt, since))
      .limit(1);
    return rows.length;
  },
  latestIpnAt: async () => {
    const [row] = await db
      .select({ receivedAt: ipnEvents.receivedAt })
      .from(ipnEvents)
      .orderBy(desc(ipnEvents.receivedAt))
      .limit(1);
    return row?.receivedAt ?? null;
  },
};

/**
 * Does the store this app writes to answer?
 *
 * The configuration is asked FIRST, because a misconfigured store answers
 * without a single request — and the sentence an operator needs there
 * ("MEDIA_S3_ENDPOINT carries a path") is one no round trip could produce.
 *
 * ⚠️ The two drivers need two different probes, and that is not tidiness.
 * `lib/media/local.ts`'s `head()` returns `null` on ANY error, so on that driver
 * it cannot tell "the object is not there" from "the disk is gone" — the one
 * distinction this probe exists to make. So `local` is asked about its
 * DIRECTORY instead, through `node:fs/promises` and never by reaching into that
 * file's internals.
 */
async function probeMedia(probes: OpsProbes): Promise<MediaState> {
  const started = Date.now();
  const since = () => Date.now() - started;

  let driver: MediaDriver | "unknown" = "unknown";
  try {
    const problems = probes.mediaProblems();
    if (problems.length > 0) {
      // The problems themselves are the operator's to read from
      // `node run.mjs media-check`; what travels here is that there ARE some.
      console.error(`[ops] media store misconfigured: ${problems.length} problem(s)`);
      return { state: "finding", driver, code: "misconfigured", ms: since() };
    }
    driver = probes.mediaDriver();
  } catch (error) {
    console.error("[ops] media store configuration could not be read:", error);
    return { state: "finding", driver, code: "misconfigured", ms: since() };
  }

  if (driver === "local") {
    try {
      await probes.localStoreWritable();
      return { state: "ok", driver, code: "answered", ms: since() };
    } catch (error) {
      console.error("[ops] local media directory is not writable:", error);
      return { state: "finding", driver, code: "localDirUnwritable", ms: since() };
    }
  }

  try {
    // A `null` answer means the store answered and the object is not there,
    // which is this probe passing. Anything it returns is equally good news.
    await probes.headObject(MEDIA_PROBE_KEY, AbortSignal.timeout(MEDIA_TIMEOUT_MS));
    return { state: "ok", driver, code: "answered", ms: since() };
  } catch (error) {
    const timedOut =
      (error as { name?: string })?.name === "TimeoutError" ||
      (error as { name?: string })?.name === "AbortError";
    console.error("[ops] media store did not answer:", error);
    return {
      state: "finding",
      driver,
      code: timedOut ? "timedOut" : "unreachable",
      ms: since(),
    };
  }
}

/** The empty answer, so the three early exits below cannot drift apart. */
function ipnAnswer(partial: Partial<IpnState> & Pick<IpnState, "state" | "code">): IpnState {
  return {
    lastEventAt: null,
    sells: false,
    ordersRecent: -1,
    logRetentionDays: IPN_LOG_RETENTION_DAYS,
    silentDays: null,
    ...partial,
  };
}

/**
 * When did the last payment notification arrive — and does that even mean
 * anything for this app?
 *
 * Three questions in order, and each one that answers "no" stops the next being
 * asked. That ordering is the whole design: an app with nothing to sell and an
 * app whose IPN broke this morning both have an empty log, and only one of them
 * is a problem.
 */
async function probeIpn(probes: OpsProbes, now: Date): Promise<IpnState> {
  try {
    const selling = probes.sellingProducts();
    if (selling < 1) return ipnAnswer({ state: "ok", code: "noProducts" });

    const activeSince = new Date(now.getTime() - IPN_ACTIVE_DAYS * DAY_MS);
    const ordersRecent = await probes.recentOrderCount(activeSince);
    if (ordersRecent < 1) {
      return ipnAnswer({ state: "ok", code: "noRecentSales", sells: true, ordersRecent: 0 });
    }

    const latest = await probes.latestIpnAt();
    if (!latest) {
      // 🚨 Not "never". The prune job deletes past IPN_LOG_RETENTION_DAYS, so an
      // empty table under recent orders means at LEAST that long without one.
      return ipnAnswer({ state: "finding", code: "emptyLog", sells: true, ordersRecent });
    }

    const silentDays = Math.floor((now.getTime() - latest.getTime()) / DAY_MS);
    return ipnAnswer({
      state: silentDays > IPN_SILENCE_DAYS ? "finding" : "ok",
      code: silentDays > IPN_SILENCE_DAYS ? "silent" : "recent",
      lastEventAt: latest.toISOString(),
      sells: true,
      ordersRecent,
      silentDays,
    });
  } catch (error) {
    // 🚨 Never `ok`. "I could not look" and "there is nothing there" are the two
    // answers this whole epic exists to keep apart.
    console.error("[ops] the IPN log could not be read:", error);
    return ipnAnswer({ state: "unchecked", code: "dbUnreachable" });
  }
}

/**
 * The two facts, measured.
 *
 * Each probe is in its own `try` and neither can throw out of here: a database
 * that is down must not take the media answer with it, and vice versa. The
 * caller gets a 200 with one component `unchecked`, which is a far more useful
 * answer than a 500.
 *
 * ⚠️ **Written for Story 32.4's watchdog to import unchanged.** No printing, no
 * sentences, no severity — this file returns facts, and the words belong to
 * whoever is speaking.
 */
export async function operationalState(
  { now }: { now: Date },
  probes: OpsProbes = defaultProbes,
): Promise<OperationalState> {
  const [media, ipn] = await Promise.all([probeMedia(probes), probeIpn(probes, now)]);
  return { checkedAt: now.toISOString(), media, ipn };
}
