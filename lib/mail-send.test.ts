// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** What nodemailer is made to do, per test. */
let smtpFailure: Error | null = null;
let smtpOptions: Record<string, unknown> | null = null;

vi.mock("nodemailer", () => {
  const createTransport = (options: Record<string, unknown>) => {
    smtpOptions = options;
    return {
      sendMail: async () => {
        if (smtpFailure) throw smtpFailure;
      },
    };
  };
  return { default: { createTransport }, createTransport };
});

const { sendMail, isSmtpConnectionFailure } = await import("./mail-send.mjs");

const MAIL = {
  from: "Fangfertig <login@fangfertig.de>",
  to: "buyer@example.com",
  subject: "Sign in",
  text: "Click the link",
  html: "<p>Click the link</p>",
};

let requests: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
let answer: { ok: boolean; status: number; body: string } = { ok: true, status: 201, body: '{"messageId":"<x>"}' };

beforeEach(() => {
  requests = [];
  answer = { ok: true, status: 201, body: '{"messageId":"<x>"}' };
  smtpFailure = null;
  smtpOptions = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: { headers: Record<string, string>; body: string }) => {
      requests.push({ url, headers: init.headers, body: JSON.parse(init.body) });
      return { ok: answer.ok, status: answer.status, text: async () => answer.body };
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

describe("Brevo", () => {
  const env = { BREVO_API_KEY: "xkeysib-test", BREVO_SENDER: "login@fangfertig.de" };

  it("posts to the transactional endpoint with the key in its own header", async () => {
    await sendMail(env, MAIL);

    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request.url).toBe("https://api.brevo.com/v3/smtp/email");
    expect(request.headers["api-key"]).toBe("xkeysib-test");
    expect(request.body).toEqual({
      sender: { email: "login@fangfertig.de", name: "Fangfertig" },
      to: [{ email: "buyer@example.com" }],
      subject: "Sign in",
      htmlContent: "<p>Click the link</p>",
      textContent: "Click the link",
    });
  });

  it("sends a bare sender without a name, and a text-only mail without html", async () => {
    await sendMail(env, { ...MAIL, from: "login@fangfertig.de", html: undefined });
    expect(requests[0].body.sender).toEqual({ email: "login@fangfertig.de" });
    expect(requests[0].body).not.toHaveProperty("htmlContent");
  });

  it("throws on a refusal, with the status — the shape the operator notices strip", async () => {
    answer = { ok: false, status: 400, body: '{"code":"invalid_parameter","message":"sender not valid"}' };
    await expect(sendMail(env, MAIL)).rejects.toThrow(/Brevo delivery failed \(HTTP 400\)/);
  });
});

describe("Postmark", () => {
  it("still sends what it always sent", async () => {
    answer = { ok: true, status: 200, body: "{}" };
    await sendMail({ POSTMARK_SERVER_TOKEN: "pm", POSTMARK_SENDER: "login@fangfertig.de" }, MAIL);
    expect(requests[0].url).toBe("https://api.postmarkapp.com/email");
    expect(requests[0].headers["X-Postmark-Server-Token"]).toBe("pm");
    expect(requests[0].body).toEqual({
      From: MAIL.from,
      To: MAIL.to,
      Subject: MAIL.subject,
      HtmlBody: MAIL.html,
      TextBody: MAIL.text,
      MessageStream: "outbound",
    });
  });
});

describe("SMTP", () => {
  const env = { SMTP_HOST: "smtp.strato.de", SMTP_PORT: "587", SMTP_USER: "u", SMTP_PASSWORD: "p" };

  it("connects the way it always did and posts nothing", async () => {
    await sendMail(env, MAIL);
    expect(smtpOptions).toMatchObject({ host: "smtp.strato.de", port: 587, secure: false, connectionTimeout: 10_000 });
    expect(requests).toEqual([]);
  });

  it("turns a connection timeout into a sentence that names the direction", async () => {
    // What nodemailer threw on every sign-in on a host that blocks SMTP.
    const original = Object.assign(new Error("Connection timeout"), { code: "ETIMEDOUT", command: "CONN" });
    smtpFailure = original;

    const thrown = await sendMail(env, MAIL).then(
      () => null,
      (error: unknown) => error as Error,
    );
    expect(thrown?.message).toContain("smtp.strato.de:587");
    expect(thrown?.message).toContain("not reachable from this server");
    expect(thrown?.message).toMatch(/Brevo or Postmark/);
    expect(thrown?.cause).toBe(original);
  });

  it("leaves a rejection FROM the server alone — that is not a blocked port", async () => {
    const rejection = Object.assign(new Error("550 5.1.1 <buyer@example.com>: Recipient address rejected"), {
      code: "EENVELOPE",
      responseCode: 550,
    });
    smtpFailure = rejection;
    await expect(sendMail(env, MAIL)).rejects.toBe(rejection);

    const auth = Object.assign(new Error("Invalid login: 535 Authentication failed"), { code: "EAUTH", responseCode: 535 });
    smtpFailure = auth;
    await expect(sendMail(env, MAIL)).rejects.toBe(auth);
  });

  it("recognises the connection failures nodemailer really throws", () => {
    expect(isSmtpConnectionFailure({ code: "ETIMEDOUT", message: "Connection timeout" })).toBe(true);
    expect(isSmtpConnectionFailure({ code: "ESOCKET", message: "connect ECONNREFUSED 1.2.3.4:587" })).toBe(true);
    expect(isSmtpConnectionFailure({ code: "ETIMEDOUT", message: "Greeting never received" })).toBe(true);
    expect(isSmtpConnectionFailure({ code: "EAUTH", responseCode: 535, message: "Invalid login" })).toBe(false);
    expect(isSmtpConnectionFailure(null)).toBe(false);
  });
});

describe("no transport", () => {
  it("names all three ways", async () => {
    await expect(sendMail({}, MAIL)).rejects.toThrow("No email transport configured (Brevo, Postmark or SMTP).");
  });
});

it("imports nothing through the app's alias — the wizard runs it under plain Node", () => {
  const source = readFileSync(path.join(__dirname, "mail-send.mjs"), "utf8");
  expect(source).not.toMatch(/from\s+["']@\//);
  expect(source).not.toMatch(/import\(["']@\//);
});
