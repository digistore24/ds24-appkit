// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What the hand-in digest does, and — more to the point — what it does NOT do.
//
// No database. Every claim below is about something that happens BEFORE a query
// or INSTEAD of one, and a test that needed a database to prove "nothing was
// asked" would be proving it in the one place the bug would not be
// (`./admin/actions.test.ts` says the same thing in the same words).
//
// The two seams are the module's own count and the core's channel; everything
// between them is the real job. The sharpest assertions here measure an
// ABSENCE — `toHaveBeenCalledTimes(0)` on the counter when the course is off,
// and on the channel when nothing is waiting.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./lib/config", () => ({
  isCourseSwitchedOn: vi.fn(() => true),
}));

vi.mock("./lib/manage", () => ({
  waitingCount: vi.fn(async () => 0),
}));

vi.mock("@/lib/notify/operators", () => ({
  notifyOperators: vi.fn(async () => ({ sent: 1, recipients: 1, reason: null })),
}));

import jobs from "./cron";
import { isCourseSwitchedOn } from "./lib/config";
import { waitingCount } from "./lib/manage";
import { notifyOperators } from "@/lib/notify/operators";
import { NotifyError } from "@/lib/notify/errors";
import { DIGEST_JOB_ID, digestKey } from "./rules";

const switchedOn = vi.mocked(isCourseSwitchedOn);
const count = vi.mocked(waitingCount);
const notify = vi.mocked(notifyOperators);

/** A fixed tick, so the key is the same string every run of this file. */
const NOW = new Date("2026-08-09T04:00:00Z");
const ctx = { now: NOW, settings: {} };

const job = jobs[0];
const run = () => job.run(ctx);

beforeEach(() => {
  vi.clearAllMocks();
  switchedOn.mockReturnValue(true);
  count.mockResolvedValue(0);
  notify.mockResolvedValue({ sent: 1, recipients: 1, reason: null });
});

afterEach(() => {
  // `APP_URL` decides whether the mail carries a button, so three tests below
  // set it. Through `vi.stubEnv` and undone here rather than assigned: without
  // this the last of them left `APP_URL="not-a-url"` standing for every
  // `describe` after it, which is a state those tests never chose and would
  // inherit the moment one of them started reading the link.
  vi.unstubAllEnvs();
});

describe("the job's registration", () => {
  it("is exactly one job, named the way the manifest declares it", () => {
    expect(jobs).toHaveLength(1);
    expect(job.id).toBe(DIGEST_JOB_ID);
    expect(job.id).toBe("courses-digest");
  });

  it("🚨 ships DISABLED", () => {
    // Not a style question. No entry in `config/cron.json` inherits
    // enabled-and-daily, a module may not write that file, and this job MAILS.
    expect(job.enabledByDefault).toBe(false);
  });

  it("describes itself well enough for `cron --list`", () => {
    expect(job.describe.length).toBeGreaterThan(10);
    // The line an operator reads before deciding — it has to say it is off.
    expect(job.describe).toMatch(/config\/cron\.json/);
  });
});

describe("the switch is read first", () => {
  it("🚨 answers without asking the database when the course is off", async () => {
    switchedOn.mockReturnValue(false);

    await expect(run()).resolves.toBe("course is switched off — nothing checked");

    // The whole claim. A switched-off course costs nothing and says nothing.
    expect(count).toHaveBeenCalledTimes(0);
    expect(notify).toHaveBeenCalledTimes(0);
  });

  it("asks the narrow question, so a broken config still reports", async () => {
    // `isCourseSwitchedOn()` is true in the `brokenConfig` state — that is the
    // reason it is the one this job asks (`./lib/config.ts` names this caller).
    // The job must go on counting there: the hand-ins keep arriving, and the
    // page the mail points at is the one that diagnoses the fault.
    switchedOn.mockReturnValue(true);
    count.mockResolvedValue(3);

    await expect(run()).resolves.toBe("3 hand-in(s) waiting, 1 notification(s) sent");
  });
});

describe("nothing waiting", () => {
  it("sends nothing and says so", async () => {
    count.mockResolvedValue(0);

    await expect(run()).resolves.toBe("no hand-in is waiting");

    expect(count).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledTimes(0);
  });

  it("asks the count ONCE — the zero is the existence question", async () => {
    // `hasWaitingSubmission()` exists and is deliberately not used: two
    // round-trips for one answer.
    await run();
    expect(count).toHaveBeenCalledTimes(1);
    expect(count).toHaveBeenCalledWith();
  });
});

describe("something waiting", () => {
  beforeEach(() => count.mockResolvedValue(12));

  it("reports the number and the number sent", async () => {
    notify.mockResolvedValue({ sent: 1, recipients: 1, reason: null });
    await expect(run()).resolves.toBe("12 hand-in(s) waiting, 1 notification(s) sent");
  });

  it("🚨 hands the channel a key built from the TICK's clock", async () => {
    await run();

    expect(notify).toHaveBeenCalledTimes(1);
    const notification = notify.mock.calls[0][0];
    expect(notification.key).toBe(digestKey(NOW));
    expect(notification.key).toBe("courses-digest:2026-08-09");
    // The clock travels too, so the marker's row carries the tick rather than
    // the moment the insert happened.
    expect(notification.now).toBe(NOW);
  });

  it("🚨 composes a count and a link, and no person", async () => {
    vi.stubEnv("APP_URL", "https://kurs.example.com");
    await run();

    const { compose } = notify.mock.calls[0][0];
    const seen: { key: string; values?: Record<string, unknown> }[] = [];
    const mail = compose(
      (key, values) => {
        seen.push({ key, values });
        return `«${key}»`;
      },
      // The formatter is handed over and deliberately not used: a date would be
      // the age of one hand-in, which is a step towards naming its author.
      null as never,
    );

    expect(seen.map((entry) => entry.key)).toEqual([
      "coursesAdmin.digestSubject",
      "coursesAdmin.digestHeading",
      "coursesAdmin.digestBody",
      "coursesAdmin.digestCta",
    ]);
    // Every text that takes a value takes the COUNT, and takes nothing else.
    for (const entry of seen) {
      if (!entry.values) continue;
      expect(Object.keys(entry.values)).toEqual(["count"]);
      expect(entry.values.count).toBe(12);
    }
    expect(mail.paragraphs).toHaveLength(1);
    expect(mail.cta?.url).toBe("https://kurs.example.com/dashboard/admin/course/submissions");
  });

  it("leaves the button off when the app has no absolute address", async () => {
    // A relative path in a mail body is a dead string. The number survives it.
    vi.stubEnv("APP_URL", "");
    await run();
    const mail = notify.mock.calls[0][0].compose(((key: string) => key) as never, null as never);
    expect(mail.cta).toBeUndefined();

    notify.mockClear();
    vi.stubEnv("APP_URL", "not-a-url");
    await run();
    expect(
      notify.mock.calls[0][0].compose(((key: string) => key) as never, null as never).cta,
    ).toBeUndefined();
  });
});

describe("the line tells the states apart", () => {
  beforeEach(() => count.mockResolvedValue(12));

  it("🚨 says when the marker suppressed the mail", async () => {
    // "Green because it sent" and "green because it skipped" are the same
    // colour. Two runs of one window must be readable as such in `cron_runs`.
    notify.mockResolvedValue({ sent: 0, recipients: 2, reason: "alreadySent" });
    await expect(run()).resolves.toBe("12 hand-in(s) waiting, already notified today");
  });

  it("names the other four off-reasons rather than looking like a send", async () => {
    for (const reason of [
      "disabledInConfig",
      "brokenConfig",
      "noTransport",
      "noRecipients",
    ] as const) {
      notify.mockResolvedValue({ sent: 0, recipients: 0, reason });
      await expect(run()).resolves.toBe(
        `12 hand-in(s) waiting, no notification sent (${reason})`,
      );
    }
  });

  it("🚨 carries only numbers and closed codes into cron_runs", async () => {
    // Cron rule 2, mechanically. Whatever branch it takes, the line has no `@`
    // and nothing anybody typed.
    for (const result of [
      { sent: 1, recipients: 1, reason: null },
      { sent: 0, recipients: 3, reason: "alreadySent" as const },
      { sent: 0, recipients: 0, reason: "noTransport" as const },
    ]) {
      notify.mockResolvedValue(result);
      const line = await run();
      expect(line).not.toContain("@");
      expect(line.length).toBeLessThan(500);
    }
  });
});

describe("it swallows nothing", () => {
  it("🚨 lets a delivery failure through, so cron_runs records `failed`", async () => {
    // Rule 3. A try/catch that reported a failed mail as a success is exactly
    // the failure this whole mechanism exists to make visible.
    count.mockResolvedValue(4);
    notify.mockRejectedValue(new Error("2 of 3 operator mail(s) sent"));

    await expect(run()).rejects.toThrow("2 of 3 operator mail(s) sent");
  });

  it("🚨 lets a FAILED COMPOSITION through, and never turns it into a line", async () => {
    // `notifyOperators()` composes BEFORE it claims the key and wraps a throw
    // from `compose()` as `composeFailed`. This job's own composition is four
    // keys and one integer — it takes the formatter and does not use it, so the
    // classic cause (`format.dateTime()` on something that is not a Date) is out
    // of reach here and a `composeFailed` means the catalogue itself. Still a
    // fault, and rule 3 wants it loud: no catch, no green line, and because the
    // key was never claimed the next window says the same thing again.
    count.mockResolvedValue(4);
    notify.mockRejectedValue(
      new NotifyError("composeFailed", "the message for 2 operator(s) could not be composed"),
    );

    await expect(run()).rejects.toMatchObject({ code: "composeFailed" });
    // And what it carries is a count, never a caller's string.
    await expect(run()).rejects.toThrow(/^the message for 2 operator\(s\)/);
  });

  it("lets a counting failure through too", async () => {
    count.mockRejectedValue(new Error("connection refused"));
    await expect(run()).rejects.toThrow("connection refused");
    expect(notify).toHaveBeenCalledTimes(0);
  });
});
