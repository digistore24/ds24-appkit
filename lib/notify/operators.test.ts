// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The whole channel, and the five ways it stays quiet.
//
// ── What is replaced, and what is not ─────────────────────────────────────
// Two edges of the process: the DATABASE (`@/db`, a real Drizzle instance over
// `drizzle-orm/pg-proxy`, so the statements are real and only the driver is
// ours) and the NETWORK (`fetch`, with Postmark configured — so
// `sendOperatorMail`, `renderMailHtml`, `renderMailText`, the real
// `messages/*.json`, the real `createTranslator` and the real footer all run).
// The preference file is swapped as DATA where a case needs a different one.
//
// 🚨 And `next/headers` is mocked to THROW on every access. That is the
// opposite of a stub: it is the assertion that nothing on this path is
// request-bound. If any link in the chain went back to `getTranslations()` or
// `cookies()`, these tests would not fail on a wrong string — they would fail
// on that throw, by name.
//
// Mocking `deliver` instead of `fetch` was the other option and is weaker: the
// address leak this channel exists to contain (AC 11) is produced BY the
// transport, in Postmark's own response body, so a test that stops above it
// asserts against a failure it invented rather than the one that happens.
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

interface Captured {
  sql: string;
  params: unknown[];
}

interface Probe {
  captured: Captured[];
  /** What the owner query gets back, Drizzle's array-of-values shape. */
  owners: unknown[][];
  /** What the claim's `returning` gets back. One row = claimed. */
  claim: unknown[][];
}

/** Survives `vi.resetModules()`, which every case does to reload the config. */
function probe(): Probe {
  const g = globalThis as unknown as { __notifyProbe?: Probe };
  g.__notifyProbe ??= { captured: [], owners: [], claim: [] };
  return g.__notifyProbe;
}

vi.mock("@/db", async () => {
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  const g = globalThis as unknown as { __notifyProbe?: Probe };
  g.__notifyProbe ??= { captured: [], owners: [], claim: [] };
  const state = g.__notifyProbe;
  const db = drizzle(async (sql: string, params: unknown[]) => {
    state.captured.push({ sql, params });
    if (sql.includes('insert into "notification_sends"')) return { rows: state.claim };
    return { rows: state.owners };
  });
  return { db };
});

const REQUEST_ONLY = () => {
  throw new Error("next/headers was reached from a path that has no request");
};

vi.mock("next/headers", () => ({
  cookies: REQUEST_ONLY,
  headers: REQUEST_ONLY,
  draftMode: REQUEST_ONLY,
}));

/** Set to a message for the SMTP case, so `sendViaSmtp` refuses with it. */
let smtpRefusal: string | null = null;
/** Every address nodemailer was handed, so a green SMTP case is not a skipped one. */
let smtpSent: string[] = [];

vi.mock("nodemailer", () => {
  const createTransport = () => ({
    sendMail: async ({ to }: { to: string }) => {
      smtpSent.push(to);
      if (smtpRefusal) {
        // 🚨 What nodemailer really rejects with, address and all: the SMTP
        // server's own reply plus the `rejected` array. A different library
        // from Postmark, the same class of leak.
        const error = new Error(smtpRefusal.replace("{to}", to)) as Error & {
          rejected?: string[];
        };
        error.rejected = [to];
        throw error;
      }
    },
  });
  return { default: { createTransport }, createTransport };
});

/** Load the channel fresh, optionally against a preference file of our own. */
async function channel(config?: Record<string, unknown>) {
  vi.resetModules();
  if (config) {
    vi.doMock("@/config/notifications.json", () => ({ default: config }));
  } else {
    vi.doUnmock("@/config/notifications.json");
  }
  return import("./operators");
}

/** One recipient row in the shape the driver hands back: id, email, name. */
const owner = (n: number): unknown[] => [`u-${n}`, `owner${n}@example.com`, `Owner ${n}`];

const NOW = new Date("2026-08-09T04:00:00.000Z");

/** The message a caller composes. Deliberately not this file's business. */
const DIGEST = {
  key: "courses-digest:2026-08-09",
  now: NOW,
  compose: () => ({
    subject: "3 hand-ins waiting",
    heading: "3 hand-ins waiting",
    paragraphs: ["The oldest has been waiting 4 days."],
    cta: { label: "Open the queue", url: "https://app.example/dashboard/admin/course" },
  }),
};

/** Every Postmark request the run made. */
let posted: { to: string; subject: string; html: string; text: string }[] = [];
/** Which delivery attempt (1-based) the provider refuses. */
let failOn: number | null = null;

beforeEach(() => {
  const p = probe();
  p.captured = [];
  p.owners = [];
  p.claim = [[DIGEST.key]];
  posted = [];
  failOn = null;
  smtpRefusal = null;
  smtpSent = [];

  process.env.POSTMARK_SERVER_TOKEN = "test-token";
  process.env.POSTMARK_SENDER = "post@app.example";
  process.env.APP_NAME = "Fangfertig";
  process.env.APP_URL = "https://app.example";
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASSWORD;

  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as {
        To: string;
        Subject: string;
        HtmlBody: string;
        TextBody: string;
      };
      posted.push({
        to: body.To,
        subject: body.Subject,
        html: body.HtmlBody,
        text: body.TextBody,
      });
      if (failOn !== null && posted.length === failOn) {
        return {
          ok: false,
          status: 422,
          // 🚨 What Postmark really answers, address and all. This string is the
          // finding: `sendViaPostmark` puts it into its error message, and
          // `lib/cron/run.ts` writes an error message into `cron_runs`.
          text: async () =>
            `{"ErrorCode":406,"Message":"You tried to send to recipient ${body.To} that has been marked as inactive."}`,
        };
      }
      return { ok: true, status: 200, text: async () => "{}" };
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock("@/config/notifications.json");
  delete process.env.POSTMARK_SERVER_TOKEN;
  delete process.env.POSTMARK_SENDER;
  delete process.env.APP_NAME;
  delete process.env.APP_URL;
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASSWORD;
});

/** Did any statement at all leave the process? */
const statements = () => probe().captured.map((c) => c.sql);
const inserts = () => statements().filter((sql) => sql.includes("insert into"));

describe("the off states — quiet, and each one measured", () => {
  it("🚨 the off state answers BEFORE it asks the database", async () => {
    const { notifyOperators } = await channel({ enabled: false, locale: "de" });
    const result = await notifyOperators(DIGEST);

    expect(result).toEqual({ sent: 0, recipients: 0, reason: "disabledInConfig" });
    // Not "no owner query" — no query at all. A switch read after the lookup is
    // a switch that costs what it was meant to save.
    expect(statements(), "the channel queried the database while switched off").toEqual([]);
    expect(posted).toEqual([]);
  });

  it("a broken preference file is off, and says which of the two it is", async () => {
    // 🚨 `xx`, and not a real language code. This said `locale: "fr"`, which was
    // a broken file for as long as the app spoke two languages — and became a
    // perfectly valid one the day it spoke four, at which point the test
    // measured the HAPPY path while still asserting a refusal. A code ISO 639-1
    // does not assign cannot be overtaken that way. Same fixture in
    // `lib/notify/config.test.ts`.
    const { notifyOperators } = await channel({ enabled: true, locale: "xx" });
    const result = await notifyOperators(DIGEST);

    expect(result.reason).toBe("brokenConfig");
    expect(statements()).toEqual([]);
    expect(posted).toEqual([]);
  });

  it("broken AND switched off reports brokenConfig — the case the deviation is about", async () => {
    // Deviation 3 says a file that is both malformed and `"enabled": false`
    // answers `brokenConfig` rather than AC 7's `disabledInConfig`, because a
    // malformed file falls back to the default as a WHOLE and the default is
    // off — "off, because broken" is the more useful of the two answers. The
    // two separate cases above measured the two separate causes; this is the
    // one where they meet, and it was the only one nobody had run.
    const { notifyOperators } = await channel({ enabled: false, locale: "xx" });

    expect((await notifyOperators(DIGEST)).reason).toBe("brokenConfig");
    expect(statements()).toEqual([]);
    expect(posted).toEqual([]);
  });

  it("no transport, no noise — and no query either", async () => {
    // The DEV normal state. An app with no mail set up must not turn a job red
    // for something that is not the job's fault; `lib/env-guard.ts` is what
    // makes this impossible in STAGING and PROD, and this changes nothing there.
    delete process.env.POSTMARK_SERVER_TOKEN;
    delete process.env.POSTMARK_SENDER;
    const { notifyOperators } = await channel();

    expect(await notifyOperators(DIGEST)).toEqual({
      sent: 0,
      recipients: 0,
      reason: "noTransport",
    });
    expect(statements()).toEqual([]);
    expect(posted).toEqual([]);
  });

  it("an app with no reachable owner claims nothing", async () => {
    probe().owners = [];
    const { notifyOperators } = await channel();

    expect(await notifyOperators(DIGEST)).toEqual({
      sent: 0,
      recipients: 0,
      reason: "noRecipients",
    });
    // The owner query ran; the marker was NOT spent. A key burnt on a run that
    // could never have sent is a message the next run will not send either.
    expect(statements()).toHaveLength(1);
    expect(inserts()).toEqual([]);
    expect(posted).toEqual([]);
  });

  it("a key that was already claimed sends nothing and counts the recipients", async () => {
    probe().owners = [owner(1), owner(2)];
    probe().claim = []; // `on conflict do nothing` returned no row.
    const { notifyOperators } = await channel();

    expect(await notifyOperators(DIGEST)).toEqual({
      sent: 0,
      recipients: 2,
      reason: "alreadySent",
    });
    expect(posted).toEqual([]);
  });
});

describe("a delivery that fails", () => {
  // Every test in here PROVOKES a failed delivery, and `notifyOperators()` logs
  // the original on its way past — deliberately (see line 42 of operators.ts).
  // Silenced so an UNEXPECTED error stays visible in the run's output.
  beforeEach(() => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    onTestFinished(() => quiet.mockRestore());
  });
  it("🚨 reports numbers, not an address", async () => {
    probe().owners = [owner(1), owner(2), owner(3)];
    failOn = 2;
    const { notifyOperators, NotifyError } = await channel();

    const thrown = await notifyOperators(DIGEST).then(
      () => null,
      (error: unknown) => error,
    );

    // It throws — cron rule 3. A swallowed transport failure makes a broken
    // mail setup look like a healthy job.
    expect(thrown).toBeInstanceOf(NotifyError);
    const message = (thrown as Error).message;
    expect(message).toContain("2 of 3");
    // The finding this whole catch exists for: Postmark named the recipient in
    // its response body, `sendViaPostmark` put that body in its message, and
    // `lib/cron/run.ts` would have written it into `cron_runs.lastDetail`.
    expect(message, "an address reached a message bound for cron_runs").not.toContain("@");
    expect(message).not.toContain("owner2");
  });

  it("🚨 reports numbers over SMTP too — a second library, the same leak", async () => {
    // The `catch` sits around `sendOperatorMail` as a whole and is therefore
    // transport-independent. That was read and not run: every other case in
    // this file deletes the SMTP variables, and `deliver()` picks Postmark
    // first, so `sendViaSmtp` had never executed once. nodemailer's rejection
    // carries the SMTP server's own reply — which names the recipient — and an
    // `err.rejected` array of addresses beside it.
    delete process.env.POSTMARK_SERVER_TOKEN;
    delete process.env.POSTMARK_SENDER;
    process.env.SMTP_HOST = "smtp.example";
    process.env.SMTP_USER = "user";
    process.env.SMTP_PASSWORD = "secret";
    process.env.EMAIL_FROM = "post@app.example";
    smtpRefusal = "550 5.1.1 <{to}>: Recipient address rejected: User unknown";

    probe().owners = [owner(1), owner(2)];
    const { notifyOperators, NotifyError } = await channel();

    const thrown = await notifyOperators(DIGEST).then(
      () => null,
      (error: unknown) => error,
    );

    // The SMTP leg really ran — a green case here must not be a skipped one.
    expect(smtpSent).toEqual(["owner1@example.com", "owner2@example.com"]);
    expect(posted, "the Postmark leg ran instead of the SMTP one").toEqual([]);

    expect(thrown).toBeInstanceOf(NotifyError);
    const message = (thrown as Error).message;
    expect(message).toContain("0 of 2");
    expect(message, "an address reached a message bound for cron_runs").not.toContain("@");
    expect(message).not.toContain("owner1");

    delete process.env.EMAIL_FROM;
  });

  it("one unreachable address does not silence the others", async () => {
    probe().owners = [owner(1), owner(2), owner(3)];
    failOn = 2;
    const { notifyOperators } = await channel();

    await expect(notifyOperators(DIGEST)).rejects.toThrow();
    expect(posted.map((mail) => mail.to)).toEqual([
      "owner1@example.com",
      "owner2@example.com",
      "owner3@example.com",
    ]);
  });
});

describe("a caller whose own code throws", () => {
  // Every test in here PROVOKES a failed delivery, and `notifyOperators()` logs
  // the original on its way past — deliberately (see line 42 of operators.ts).
  // Silenced so an UNEXPECTED error stays visible in the run's output.
  beforeEach(() => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    onTestFinished(() => quiet.mockRestore());
  });
  /** A `compose` that fails the way 8.6's will: a date that is not one. */
  const BROKEN = {
    ...DIGEST,
    compose: () => {
      throw new Error(
        // Deliberately the shape `Intl` produces, with something personal in
        // it — that is the whole reason this must not travel.
        "Invalid time value while formatting for owner2@example.com",
      );
    },
  };

  it("🚨 does not burn the key — the window survives its own caller", async () => {
    // The finding: `compose()` is the CALLER's code and used to run after the
    // claim. A throw there spent the key for ever (the message of this window
    // lost, and `alreadySent` on every later run) while the raw error walked
    // past the catch below into `cron_runs.lastDetail`. `sent-once.ts` argues
    // the losing trade for a TRANSPORT failure only, and this is not one.
    probe().owners = [owner(1), owner(2)];
    const { notifyOperators, NotifyError } = await channel();

    const thrown = await notifyOperators(BROKEN).then(
      () => null,
      (error: unknown) => error,
    );

    expect(thrown).toBeInstanceOf(NotifyError);
    expect((thrown as { code: string }).code).toBe("composeFailed");
    const message = (thrown as Error).message;
    // Same rule as the transport case: a count travels, the caller's own words
    // do not. The original is on the console, where a human is reading.
    expect(message).toContain("2 operator(s)");
    expect(message, "a caller's error text reached a message bound for cron_runs")
      .not.toContain("@");
    expect(message).not.toContain("Invalid time value");

    // 🚨 And the key is still free. This is the half that is invisible in the
    // exception: nothing was inserted into `notification_sends`.
    expect(inserts(), "the send key was claimed before the message existed").toEqual([]);
    expect(posted).toEqual([]);
  });

  it("so the next run of the SAME key still delivers", async () => {
    // The consequence of the assertion above, stated as behaviour rather than
    // as a missing statement: a caller that throws once has not silenced the
    // window. Without it, "no insert" would be an assertion about a driver.
    probe().owners = [owner(1)];
    const first = await channel();
    await expect(first.notifyOperators(BROKEN)).rejects.toThrow();

    posted = [];
    probe().captured = [];
    probe().owners = [owner(1)];
    probe().claim = [[DIGEST.key]]; // the row is still free, so the claim wins
    const second = await channel();

    expect(await second.notifyOperators(DIGEST)).toEqual({
      sent: 1,
      recipients: 1,
      reason: null,
    });
    expect(posted.map((mail) => mail.to)).toEqual(["owner1@example.com"]);
  });
});

describe("a key the grammar refuses", () => {
  it("🚨 is refused before the config is read and before any query", async () => {
    // AC 7 counts five reasons and says the channel does not throw when it
    // cannot send. A malformed key is a sixth exit and it DOES throw — that is
    // right (a programming error is not an operating state), and it now happens
    // in front of everything, so the refusal costs no owner query.
    const { notifyOperators, NotifyError } = await channel();

    const thrown = await notifyOperators({ ...DIGEST, key: "a@b.de" }).then(
      () => null,
      (error: unknown) => error,
    );

    expect(thrown).toBeInstanceOf(NotifyError);
    expect((thrown as { code: string }).code).toBe("badSendKey");
    // The message names the RULE, never the key: an unvalidated key is exactly
    // the string nobody has checked for an address.
    expect((thrown as Error).message, "the refused key reached the message").not.toContain(
      "a@b.de",
    );
    expect(statements(), "a malformed key still cost a database round trip").toEqual([]);
    expect(posted).toEqual([]);
  });
});

describe("🚨 the whole channel, and no request anywhere", () => {
  it("two owners, two mails, the operator's language, and never twice", async () => {
    probe().owners = [owner(1), owner(2)];
    const de = await channel({ enabled: true, locale: "de" });

    const first = await de.notifyOperators(DIGEST);
    expect(first).toEqual({ sent: 2, recipients: 2, reason: null });

    // ── one recipient per delivery ────────────────────────────────────────
    expect(posted).toHaveLength(2);
    expect(posted.map((mail) => mail.to)).toEqual([
      "owner1@example.com",
      "owner2@example.com",
    ]);
    for (const mail of posted) {
      // Not a list, not a `bcc`. Two operators are third parties to each other.
      expect(mail.to.split("@")).toHaveLength(2);
      expect(mail.to).not.toContain(",");
    }

    // ── the words are real, and so is the layout ──────────────────────────
    for (const mail of posted) {
      expect(mail.html).toContain("3 hand-ins waiting");
      expect(mail.html).toContain("The oldest has been waiting 4 days.");
      // The one thing the caller did NOT provide: the greeting comes from the
      // catalogue, resolved without a request.
      expect(mail.html).toContain("Hallo,");
      // A link is allowed here — this is not the credential notice.
      expect(mail.html).toContain(
        'href="https://app.example/dashboard/admin/course"',
      );
      // The text version keeps the body as well as the button. `renderMailText`
      // renders one or the other, and a digest whose numbers vanished in the
      // plain-text part would be half a message.
      expect(mail.text).toContain("The oldest has been waiting 4 days.");
      expect(mail.text).toContain("https://app.example/dashboard/admin/course");
      // The footer, which used to need a request of its own.
      expect(mail.html).toContain("Diese E-Mail wurde von Fangfertig gesendet.");
      expect(mail.html).toContain("Datenschutzerklärung");
    }

    const german = posted[0].html;

    // ── the same run in the other language ────────────────────────────────
    posted = [];
    probe().captured = [];
    probe().owners = [owner(1), owner(2)];
    probe().claim = [["courses-digest:2026-08-10"]];
    const en = await channel({ enabled: true, locale: "en" });
    await en.notifyOperators({ ...DIGEST, key: "courses-digest:2026-08-10" });

    expect(posted).toHaveLength(2);
    const english = posted[0].html;
    // Both bodies, both recipients — AC 14 asks for "in BOTH bodies" for BOTH
    // languages, and the English half used to check one field of one mail.
    for (const mail of posted) {
      expect(mail.html).toContain("Hi,");
      expect(mail.html).toContain("This email was sent by Fangfertig.");
      expect(mail.html).toContain("Privacy policy");
      expect(mail.text).toContain("The oldest has been waiting 4 days.");
      expect(mail.text).toContain("https://app.example/dashboard/admin/course");
    }
    // The point of the pair: the locale really travelled. Were it read from a
    // request that is not there, both runs would render the same string.
    expect(english).not.toEqual(german);

    // ── and the second run of the SAME key sends nothing ──────────────────
    posted = [];
    probe().captured = [];
    probe().owners = [owner(1), owner(2)];
    probe().claim = []; // the row is already there
    const again = await channel({ enabled: true, locale: "de" });

    expect(await again.notifyOperators(DIGEST)).toEqual({
      sent: 0,
      recipients: 2,
      reason: "alreadySent",
    });
    expect(posted, "a second run of the same key delivered again").toEqual([]);
  });
});
