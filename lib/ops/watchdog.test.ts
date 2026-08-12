// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The watchdog's rules, in both directions, with nothing real behind them.
//
// Everything this file asserts is a decision the job makes about numbers, and
// every one of those decisions has a way of being wrong that no page and no
// smoke run could see: a condition that never fires, a key that never changes,
// a "nothing open" line written over three checks that failed.
//
// Three needles, each with its negative control — a test that only plants the
// far side passes against a function that reports everything, and one that only
// plants the near side passes against a function that reports nothing:
//
//   1. the ONE-REPORTER needle lives in `lib/notify/reporter-guard.test.ts`;
//   2. the WINDOW needle is here — a changing COUNT keeps the key, a changing
//      CONDITION SET changes it;
//   3. the SILENCE needle is here — three of four sources unreadable produces
//      `3 could not be checked` and calls the channel NOT AT ALL, and with one
//      real finding present it IS called and the unchecked count is still in
//      the message.
//
// The four impure sources are mocked rather than reached: `vitest.config.ts`
// puts every `.test.ts` under `template/` inside `make check`, so a test here
// may not touch a database, a bucket, a transport or the network.
import { describe, expect, it, vi } from "vitest";

import { SEND_KEY_MAX, SEND_KEY_PATTERN } from "@/lib/notify/sent-once";
import { SEVERITIES } from "@/scripts/security/rules.mjs";
import de from "@/messages/de.json";
import en from "@/messages/en.json";

import {
  OPS_CHECKS,
  OPS_CONDITIONS,
  WATCHDOG_JOB_ID,
  adminUrl,
  collectFindings,
  composeReport,
  detailLine,
  readFacts,
  runWatchdog,
  sendKey,
  type NotifyOutcome,
  type OpsAssessment,
  type OpsFacts,
  type OpsFinding,
} from "./watchdog";

/**
 * The four impure sources, as values a test can set.
 *
 * `vi.hoisted` because `vi.mock`'s factories are lifted above every import —
 * the mocks below have to be able to see this object without importing it.
 * A source set to a FUNCTION that throws is how "this source was unreadable"
 * is reached, which is the state three quarters of this file is about.
 */
const sources = vi.hoisted(() => ({
  security: null as unknown,
  jobs: null as unknown,
  ops: null as unknown,
  /** Every call the channel received. The silence needle reads its length. */
  sent: [] as unknown[],
  /** What the channel answers — or an `Error` it throws. */
  result: { sent: 2, recipients: 2, reason: null } as unknown,
}));

/** Call it if it is callable, so a source can throw on demand. */
const answer = (source: unknown) =>
  typeof source === "function" ? (source as () => unknown)() : source;

vi.mock("@/lib/cron/security-record", () => ({
  readSecurityRecord: async () => answer(sources.security),
}));

vi.mock("@/lib/cron/run", () => ({
  jobStatuses: async () => answer(sources.jobs),
}));

vi.mock("./health", () => ({
  operationalState: async () => answer(sources.ops),
}));

vi.mock("@/lib/notify/operators", () => ({
  notifyOperators: async (notification: unknown) => {
    sources.sent.push(notification);
    if (sources.result instanceof Error) throw sources.result;
    return sources.result;
  },
}));

const NOW = new Date("2026-08-10T06:00:00.000Z");
const MINUTE = 60_000;

/** A `cron_runs` row as `jobStatuses()` hands it over — healthy by default. */
const jobRow = (over: Record<string, unknown> = {}) => ({
  job: "prune-ai-usage",
  enabled: true,
  everyMinutes: 1440,
  lastFinishedAt: new Date(NOW.getTime() - 60 * MINUTE),
  lastOutcome: "ok",
  ...over,
});

/** Story 32.3's answer with everything in order. */
const healthyOps = (over: Record<string, unknown> = {}) => ({
  checkedAt: NOW.toISOString(),
  media: { state: "ok", driver: "s3", code: "answered", ms: 4 },
  ipn: {
    state: "ok",
    code: "recent",
    lastEventAt: NOW.toISOString(),
    sells: true,
    ordersRecent: 3,
    logRetentionDays: 60,
    silentDays: 0,
  },
  ...over,
});

/** Every source answering, nothing wrong anywhere. */
const healthy = (over: Partial<OpsFacts> = {}): OpsFacts => ({
  now: NOW,
  security: { state: "ok", counts: { critical: 0, high: 0 }, checkedAt: NOW.toISOString() },
  jobs: { state: "ok", jobs: [jobRow()] },
  ops: { state: "ok", ops: healthyOps() as never },
  ...over,
});

const ids = (assessment: OpsAssessment) => assessment.findings.map((finding) => finding.id);

describe("collectFindings — the vocabulary it speaks", () => {
  it("🚨 uses the shipped severity ladder and invents no fifth word", () => {
    // CLAUDE.md: one ladder, one shape for a finding. A severity spelled
    // "warning" here would sort last by accident and put this job outside the
    // vocabulary `security-check`, `cron --list` and the gateways all share.
    const everything = collectFindings({
      now: NOW,
      security: { state: "ok", counts: { critical: 1, high: 4 } },
      jobs: {
        state: "ok",
        jobs: [
          jobRow({ lastOutcome: "failed" }),
          jobRow({
            job: "b",
            lastFinishedAt: new Date(NOW.getTime() - 5 * 1440 * MINUTE),
          }),
        ],
      },
      ops: {
        state: "ok",
        ops: healthyOps({
          media: { state: "finding", driver: "s3", code: "unreachable", ms: 8000 },
          ipn: {
            state: "finding",
            code: "silent",
            lastEventAt: "2026-07-01T00:00:00.000Z",
            sells: true,
            ordersRecent: 2,
            logRetentionDays: 60,
            silentDays: 40,
          },
        }) as never,
      },
    });

    expect(everything.findings.length).toBe(5);
    for (const finding of everything.findings) {
      expect(SEVERITIES).toContain(finding.severity);
      expect(OPS_CONDITIONS).toContain(finding.id);
    }
  });

  it("orders worst first, on SEVERITIES' own order", () => {
    const everything = collectFindings({
      now: NOW,
      security: { state: "ok", counts: { critical: 2, high: 0 } },
      jobs: { state: "ok", jobs: [jobRow({ lastOutcome: "failed" })] },
      ops: {
        state: "ok",
        ops: healthyOps({
          ipn: {
            state: "finding",
            code: "silent",
            lastEventAt: null,
            sells: true,
            ordersRecent: 1,
            logRetentionDays: 60,
            silentDays: 30,
          },
        }) as never,
      },
    });
    expect(ids(everything)).toEqual(["security-open", "jobs-failing", "ipn-silent"]);
  });

  it("a healthy app has nothing open and four checks that ran", () => {
    const assessment = collectFindings(healthy());
    expect(assessment.findings).toEqual([]);
    expect(assessment.unchecked).toEqual([]);
    expect(assessment.checksRan).toBe(OPS_CHECKS.length);
  });
});

describe("collectFindings — security (AC2)", () => {
  it("fires on a critical, and takes the severity from the record's own counts", () => {
    const critical = collectFindings(
      healthy({ security: { state: "ok", counts: { critical: 1, high: 2 } } }),
    );
    expect(critical.findings).toEqual([
      { id: "security-open", severity: "critical", count: 3 },
    ]);

    const high = collectFindings(
      healthy({ security: { state: "ok", counts: { critical: 0, high: 2 } } }),
    );
    expect(high.findings).toEqual([{ id: "security-open", severity: "high", count: 2 }]);
  });

  it("does not fire on MEDIUM or LOW, because the record does not carry them here", () => {
    // The threshold is the command's own: `failsVerdict()` is HIGH and above.
    // A MEDIUM met in an inbox every six hours is how people learn to filter.
    expect(collectFindings(healthy()).findings).toEqual([]);
  });

  it("🚨 an absent record is `unchecked` with its reason, never clean", () => {
    const assessment = collectFindings(
      healthy({ security: { state: "unchecked", reason: "noUsableRecord" } }),
    );
    expect(assessment.findings).toEqual([]);
    expect(assessment.unchecked).toEqual([{ id: "security", reason: "noUsableRecord" }]);
    expect(assessment.checksRan).toBe(3);
  });
});

describe("collectFindings — the two job rules (AC2)", () => {
  it("counts ENABLED jobs whose LAST run failed, and only those", () => {
    const assessment = collectFindings(
      healthy({
        jobs: {
          state: "ok",
          jobs: [
            jobRow({ job: "a", lastOutcome: "failed" }),
            jobRow({ job: "b", lastOutcome: "failed" }),
            jobRow({ job: "c", lastOutcome: "ok" }),
          ],
        },
      }),
    );
    expect(assessment.findings).toEqual([{ id: "jobs-failing", severity: "high", count: 2 }]);
  });

  it("🚨 a job that is OFF is never a finding, however badly it ended", () => {
    // The same rule Story 32.2 fixed: it is not supposed to be running, so "it
    // has not run" is the right answer rather than a mail.
    const assessment = collectFindings(
      healthy({
        jobs: {
          state: "ok",
          jobs: [
            jobRow({ enabled: false, lastOutcome: "failed" }),
            jobRow({
              job: "b",
              enabled: false,
              lastFinishedAt: new Date(NOW.getTime() - 90 * 1440 * MINUTE),
            }),
          ],
        },
      }),
    );
    expect(assessment.findings).toEqual([]);
  });

  it("🚨 the stall needle: inside 3× the interval is nothing, past it is a finding", () => {
    const threshold = 1440 * 3;
    const inside = collectFindings(
      healthy({
        jobs: {
          state: "ok",
          jobs: [jobRow({ lastFinishedAt: new Date(NOW.getTime() - threshold * MINUTE) })],
        },
      }),
    );
    expect(inside.findings).toEqual([]);

    const past = collectFindings(
      healthy({
        jobs: {
          state: "ok",
          jobs: [jobRow({ lastFinishedAt: new Date(NOW.getTime() - (threshold + 1) * MINUTE) })],
        },
      }),
    );
    expect(past.findings).toEqual([{ id: "jobs-stalled", severity: "medium", count: 1 }]);
  });

  it("🚨 a job that has NEVER finished is deliberately not a stalled job", () => {
    // `lastFinishedAt` is null and nothing in `cron_runs` says when this app was
    // deployed, so a freshly deployed app would otherwise mail its owner about
    // every job on its first night. `cron --list` and the health verdict are
    // where a HUMAN reads never-run.
    const assessment = collectFindings(
      healthy({
        jobs: {
          state: "ok",
          jobs: [jobRow({ lastFinishedAt: null, lastOutcome: null })],
        },
      }),
    );
    expect(assessment.findings).toEqual([]);
    expect(assessment.unchecked).toEqual([]);
  });

  it("a database that did not answer is one unchecked CHECK, not two conditions", () => {
    const assessment = collectFindings(
      healthy({ jobs: { state: "unchecked", reason: "dbUnreachable" } }),
    );
    expect(assessment.findings).toEqual([]);
    expect(assessment.unchecked).toEqual([{ id: "jobs", reason: "dbUnreachable" }]);
  });
});

describe("collectFindings — media and ipn (AC2, AC3)", () => {
  it("a media store that did not answer is a HIGH finding", () => {
    const assessment = collectFindings(
      healthy({
        ops: {
          state: "ok",
          ops: healthyOps({
            media: { state: "finding", driver: "s3", code: "timedOut", ms: 8000 },
          }) as never,
        },
      }),
    );
    expect(assessment.findings).toEqual([{ id: "media-unreachable", severity: "high" }]);
  });

  it("🚨 an app that sells nothing contributes no finding and IS counted as checked", () => {
    // AC3: "checked and nothing to report", never "not checked". `noProducts`
    // and `noRecentSales` are both `state: "ok"` in Story 32.3's evaluator.
    for (const code of ["noProducts", "noRecentSales"]) {
      const assessment = collectFindings(
        healthy({
          ops: {
            state: "ok",
            ops: healthyOps({
              ipn: {
                state: "ok",
                code,
                lastEventAt: null,
                sells: code === "noRecentSales",
                ordersRecent: 0,
                logRetentionDays: 60,
                silentDays: null,
              },
            }) as never,
          },
        }),
      );
      expect(assessment.findings, code).toEqual([]);
      expect(assessment.unchecked, code).toEqual([]);
      expect(assessment.checksRan, code).toBe(4);
    }
  });

  it("a database the IPN log could not be read from is `unchecked`, and media still ran", () => {
    const assessment = collectFindings(
      healthy({
        ops: {
          state: "ok",
          ops: healthyOps({
            ipn: {
              state: "unchecked",
              code: "dbUnreachable",
              lastEventAt: null,
              sells: false,
              ordersRecent: -1,
              logRetentionDays: 60,
              silentDays: null,
            },
          }) as never,
        },
      }),
    );
    expect(assessment.unchecked).toEqual([{ id: "ipn", reason: "dbUnreachable" }]);
    expect(assessment.checksRan).toBe(3);
  });

  it("one probe call that could not run at all is TWO unchecked checks", () => {
    const assessment = collectFindings(
      healthy({ ops: { state: "unchecked", reason: "probesUnavailable" } }),
    );
    expect(assessment.unchecked.map((entry) => entry.id)).toEqual(["media", "ipn"]);
    expect(assessment.checksRan).toBe(2);
  });
});

describe("sendKey — the window AND the digest (AC5)", () => {
  const finding = (id: OpsFinding["id"], count?: number): OpsFinding => ({
    id,
    severity: "high",
    ...(count === undefined ? {} : { count }),
  });

  it("carries the UTC day and eight hex characters", () => {
    const key = sendKey(NOW, [finding("jobs-failing")]);
    expect(key).toMatch(/^ops-watchdog:2026-08-10:[0-9a-f]{8}$/);
    expect(key.startsWith(`${WATCHDOG_JOB_ID}:`)).toBe(true);
  });

  it("crosses the window boundary on UTC, not on a local zone", () => {
    // 23:30Z on the 9th is already the 10th in Europe/Berlin. The key says the
    // 9th, so two instances in two zones claim ONE key.
    const late = sendKey(new Date("2026-08-09T23:30:00Z"), [finding("jobs-failing")]);
    expect(late).toContain(":2026-08-09:");
  });

  it("🚨 the window needle, near side: a changing COUNT keeps the key", () => {
    // A job whose failure tally ticks from 2 to 5 must not mint a new key —
    // otherwise every tick mints one, every tick mails, and the operator learns
    // to filter. That is the whole reason this job exists.
    expect(sendKey(NOW, [finding("jobs-failing", 2)])).toBe(
      sendKey(NOW, [finding("jobs-failing", 5)]),
    );
  });

  it("🚨 the window needle, far side: a changing CONDITION SET changes the key", () => {
    // Without this, a second problem appearing after the day's first mail would
    // be swallowed by that mail's spent window and never reported at all.
    const one = sendKey(NOW, [finding("jobs-failing")]);
    const two = sendKey(NOW, [finding("jobs-failing"), finding("media-unreachable")]);
    expect(two).not.toBe(one);
    // And it is stable under ORDER: the same set is the same key however the
    // findings were sorted, or a re-ordering would mail twice about one state.
    expect(sendKey(NOW, [finding("media-unreachable"), finding("jobs-failing")])).toBe(two);
  });

  it("a new UTC day is a new key for the same set", () => {
    const set = [finding("jobs-failing"), finding("media-unreachable")];
    expect(sendKey(new Date("2026-08-11T00:00:00Z"), set)).not.toBe(sendKey(NOW, set));
  });

  it("🚨 every reachable key matches the real grammar, and names nobody", () => {
    // Against `SEND_KEY_PATTERN` itself rather than a copy of it: a key the
    // grammar refuses is a `badSendKey` throw at three in the morning.
    // The set is bounded — five ids — so every subset can really be tried.
    const all = OPS_CONDITIONS.map((id) => finding(id));
    for (let mask = 1; mask < 1 << all.length; mask += 1) {
      const subset = all.filter((_, index) => (mask >> index) & 1);
      const key = sendKey(NOW, subset);
      expect(key, key).toMatch(SEND_KEY_PATTERN);
      expect(key.length).toBeLessThanOrEqual(SEND_KEY_MAX);
      expect(key).not.toContain("@");
    }
  });

  it("distinct sets get distinct keys — all 31 of them", () => {
    const all = OPS_CONDITIONS.map((id) => finding(id));
    const keys = new Set<string>();
    for (let mask = 1; mask < 1 << all.length; mask += 1) {
      keys.add(sendKey(NOW, all.filter((_, index) => (mask >> index) & 1)));
    }
    expect(keys.size).toBe((1 << all.length) - 1);
  });
});

describe("detailLine — the shapes that must never be confusable (AC6)", () => {
  const assessment = (findings: number, unchecked: number): OpsAssessment => ({
    findings: Array.from({ length: findings }, (_, index) => ({
      id: OPS_CONDITIONS[index],
      severity: "high",
    })),
    unchecked: Array.from({ length: unchecked }, (_, index) => ({
      id: OPS_CHECKS[index],
      reason: "x",
    })),
    checksRan: OPS_CHECKS.length - unchecked,
  });

  it("nothing to report", () => {
    expect(detailLine(assessment(0, 0))).toBe(
      "nothing open — 4 check(s) ran, 0 could not be checked",
    );
    expect(detailLine(assessment(0, 1))).toBe(
      "nothing open — 3 check(s) ran, 1 could not be checked",
    );
  });

  it("reported", () => {
    expect(detailLine(assessment(3, 0), { sent: 2, recipients: 2, reason: null })).toBe(
      "3 finding(s), 2/2 mailed",
    );
  });

  it("NOT reported — the channel's own code, and never a sentence", () => {
    expect(detailLine(assessment(3, 0), { sent: 0, recipients: 0, reason: "noTransport" })).toBe(
      "3 finding(s), no mail sent (noTransport)",
    );
    expect(detailLine(assessment(3, 0), { sent: 0, recipients: 2, reason: "alreadySent" })).toBe(
      "3 finding(s), already notified this window",
    );
  });

  it("🚨 'it could not be sent' and 'there was nothing to send' are different lines", () => {
    // The story in one assertion. Both runs are `ok` in `cron_runs`, and the
    // only thing telling them apart is this string.
    const nothing = detailLine(assessment(0, 0));
    const notSent = detailLine(assessment(3, 0), {
      sent: 0,
      recipients: 0,
      reason: "noTransport",
    });
    expect(nothing).not.toBe(notSent);
    expect(nothing).toContain("nothing open");
    expect(notSent).toContain("no mail sent");
  });

  it("🚨 a check that could not be made is never dropped from the line (NFR-60)", () => {
    // "nothing open" over three failed checks is the exact defect this epic is
    // about, and so is a green "2/2 mailed" that hides them.
    expect(detailLine(assessment(0, 3))).toContain("3 could not be checked");
    expect(detailLine(assessment(1, 3), { sent: 1, recipients: 1, reason: null })).toBe(
      "1 finding(s), 1/1 mailed, 3 could not be checked",
    );
    expect(detailLine(assessment(1, 2), { sent: 0, recipients: 1, reason: "alreadySent" })).toBe(
      "1 finding(s), already notified this window, 2 could not be checked",
    );
  });

  it("stays far inside the 500 characters `lib/cron/run.ts` truncates at", () => {
    expect(detailLine(assessment(5, 4), { sent: 9, recipients: 9, reason: null }).length)
      .toBeLessThan(120);
  });
});

describe("composeReport — counts and subjects only (AC4)", () => {
  /** A translator that records the keys and hands the key back as the text. */
  const spy = () => {
    const keys: string[] = [];
    const values: Record<string, unknown>[] = [];
    return {
      keys,
      values,
      t: (key: string, given?: Record<string, string | number | Date>) => {
        keys.push(key);
        values.push(given ?? {});
        return key;
      },
    };
  };

  const twoOpen: OpsAssessment = {
    findings: [
      { id: "security-open", severity: "critical", count: 3 },
      { id: "jobs-failing", severity: "high", count: 2 },
    ],
    unchecked: [{ id: "media", reason: "probesUnavailable" }],
    checksRan: 3,
  };

  it("names every open finding in ONE message, and the unchecked ones in one line", () => {
    const { t, keys } = spy();
    const mail = composeReport(twoOpen, "https://app.example.com/dashboard/admin")(t);

    expect(mail.paragraphs).toHaveLength(3);
    expect(keys).toContain("opsWatchdog.condition.security-open");
    expect(keys).toContain("opsWatchdog.condition.jobs-failing");
    expect(keys).toContain("opsWatchdog.unchecked");
    expect(mail.cta).toEqual({
      label: "opsWatchdog.cta",
      url: "https://app.example.com/dashboard/admin",
    });
  });

  it("the subject names the WORST severity and the count", () => {
    const { t, values, keys } = spy();
    composeReport(twoOpen, null)(t);
    expect(keys).toContain("opsWatchdog.severity.critical");
    expect(values[keys.indexOf("opsWatchdog.subject")]).toMatchObject({ count: 2 });
  });

  it("leaves the button off entirely when there is no usable absolute base", () => {
    // A relative path in a mail body is a dead string. The counts are the
    // message and they survive the missing link.
    const { t } = spy();
    expect(composeReport(twoOpen, null)(t).cta).toBeUndefined();
  });

  it("says nothing about the unchecked ones when there are none", () => {
    const { t, keys } = spy();
    composeReport({ ...twoOpen, unchecked: [], checksRan: 4 }, null)(t);
    expect(keys).not.toContain("opsWatchdog.unchecked");
  });

  it("🚨 every key it can compute exists in BOTH language files", () => {
    // A COMPUTED key is invisible to `i18n/messages.test.ts`'s parity check:
    // de.json and en.json can agree perfectly while a condition has no wording
    // in either, and the operator then gets the literal key in an alert mail.
    const at = (messages: unknown, path: string) =>
      path
        .split(".")
        .reduce<unknown>(
          (node, part) =>
            typeof node === "object" && node !== null
              ? (node as Record<string, unknown>)[part]
              : undefined,
          messages,
        );

    const expected = [
      "opsWatchdog.subject",
      "opsWatchdog.heading",
      "opsWatchdog.unchecked",
      "opsWatchdog.cta",
      ...OPS_CONDITIONS.map((id) => `opsWatchdog.condition.${id}`),
      ...SEVERITIES.map((severity) => `opsWatchdog.severity.${severity}`),
    ];

    for (const path of expected) {
      for (const [locale, messages] of [["de", de], ["en", en]] as const) {
        expect(at(messages, path), `${locale}: ${path}`).toBeTypeOf("string");
      }
    }
  });

  it("🚨 puts no job id, no path and no address into the mail", () => {
    // Counts and subjects only. The one exception a reader might mistake for a
    // leak is the CTA, and it is composed from APP_URL rather than from data.
    const { t } = spy();
    const mail = composeReport(twoOpen, null)(t);
    const whole = JSON.stringify(mail);
    for (const forbidden of ["prune-ai-usage", "@", "lib/", ".dev/", "probesUnavailable"]) {
      expect(whole, forbidden).not.toContain(forbidden);
    }
  });
});

describe("adminUrl", () => {
  it("is absolute or absent, never relative", () => {
    expect(adminUrl({ APP_URL: "https://app.example.com" })).toBe(
      "https://app.example.com/dashboard/admin",
    );
    for (const base of [undefined, "", "   ", "app.example.com", "/dashboard"]) {
      expect(adminUrl({ APP_URL: base }), String(base)).toBeNull();
    }
  });
});

describe("readFacts — one unreadable source cannot take the other three", () => {
  it("🚨 a throwing source becomes `unchecked`, and the rest still answer", async () => {
    sources.security = () => {
      throw new Error("no .dev/ here");
    };
    sources.jobs = () => [jobRow()];
    sources.ops = () => healthyOps();

    const facts = await readFacts({ now: NOW });
    expect(facts.security.state).toBe("unchecked");
    expect(facts.jobs.state).toBe("ok");
    expect(facts.ops.state).toBe("ok");
  });

  it("hands the security record's counts on, and its reason when there is none", async () => {
    sources.security = { state: "ok", record: { counts: { critical: 0, high: 2 }, checkedAt: "x" } };
    sources.jobs = () => [jobRow()];
    sources.ops = () => healthyOps();
    const ok = await readFacts({ now: NOW });
    expect(ok.security).toEqual({
      state: "ok",
      counts: { critical: 0, high: 2 },
      checkedAt: "x",
    });

    sources.security = { state: "unchecked", reason: "noUsableRecord" };
    const absent = await readFacts({ now: NOW });
    expect(absent.security).toEqual({ state: "unchecked", reason: "noUsableRecord" });
  });
});

describe("runWatchdog — the silence needle", () => {
  const reset = () => {
    sources.sent = [];
    sources.result = { sent: 2, recipients: 2, reason: null } as NotifyOutcome;
    sources.security = { state: "ok", record: { counts: { critical: 0, high: 0 } } };
    sources.jobs = () => [jobRow()];
    sources.ops = () => healthyOps();
  };

  it("🚨 nothing open: it does not touch the channel at all", async () => {
    // Step 2 returns BEFORE the key is claimed, the owners are queried or
    // anything is sent — so a healthy app writes no row into
    // `notification_sends` and the day's window stays available.
    reset();
    expect(await runWatchdog({ now: NOW })).toBe(
      "nothing open — 4 check(s) ran, 0 could not be checked",
    );
    expect(sources.sent).toHaveLength(0);
  });

  it("🚨 three of four sources unreadable and nothing open: still no mail", async () => {
    // The near side of the needle. A watchdog that mails about its own
    // incompleteness is a watchdog people filter (AC7) — the state is reported
    // in the line, in the health verdict and in the greeting instead.
    reset();
    sources.security = () => {
      throw new Error("no record");
    };
    sources.jobs = () => {
      throw new Error("no database");
    };
    sources.ops = () =>
      healthyOps({
        ipn: {
          state: "unchecked",
          code: "dbUnreachable",
          lastEventAt: null,
          sells: false,
          ordersRecent: -1,
          logRetentionDays: 60,
          silentDays: null,
        },
      });

    const line = await runWatchdog({ now: NOW });
    expect(line).toBe("nothing open — 1 check(s) ran, 3 could not be checked");
    expect(sources.sent).toHaveLength(0);
  });

  it("🚨 the far side: one real finding beside them DOES mail, and says so", async () => {
    // A test that only checks the first half passes against a job that never
    // mails at all.
    reset();
    sources.security = () => {
      throw new Error("no record");
    };
    sources.jobs = () => [jobRow({ lastOutcome: "failed" })];
    sources.ops = () => healthyOps();

    const line = await runWatchdog({ now: NOW });
    expect(sources.sent).toHaveLength(1);
    expect(line).toBe("1 finding(s), 2/2 mailed, 1 could not be checked");

    // And the unchecked count is in the MESSAGE too, not only in the line.
    const notification = sources.sent[0] as {
      key: string;
      compose: (t: (k: string) => string) => { paragraphs: string[] };
    };
    expect(notification.key).toMatch(SEND_KEY_PATTERN);
    expect(notification.compose((key) => key).paragraphs).toContain("opsWatchdog.unchecked");
  });

  it("hands the channel's own reason straight through, and mails once", async () => {
    reset();
    sources.jobs = () => [jobRow({ lastOutcome: "failed" })];
    sources.result = { sent: 0, recipients: 0, reason: "noTransport" };
    expect(await runWatchdog({ now: NOW })).toBe("1 finding(s), no mail sent (noTransport)");
    expect(sources.sent).toHaveLength(1);
  });

  it("🚨 lets a NotifyError through, so the alarm's own failure becomes an alarm", async () => {
    // Cron rule 3. Swallowing it would record `ok` for a run in which nothing
    // reached anybody, and `cron --list` and the health verdict would both show
    // a healthy job.
    reset();
    sources.jobs = () => [jobRow({ lastOutcome: "failed" })];
    // The shape the channel really throws: a COUNT, never a caller's string —
    // `lib/cron/run.ts` writes `error.message` into `cron_runs.lastDetail`.
    sources.result = new Error("1 of 2 operator mail(s) sent");
    await expect(runWatchdog({ now: NOW })).rejects.toThrow("1 of 2 operator mail(s) sent");
  });
});
