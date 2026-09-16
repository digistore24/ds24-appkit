// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import {
  appHost,
  emailDomain,
  isUnjudgeableHost,
  mailTransport,
  resolvedFrom,
  sameSite,
  senderDomainProblem,
  splitAddress,
} from "./email-from.mjs";

describe("mailTransport", () => {
  const postmark = { POSTMARK_SERVER_TOKEN: "t", POSTMARK_SENDER: "a@x.de" };
  const brevo = { BREVO_API_KEY: "k", BREVO_SENDER: "b@x.de" };
  const smtp = { SMTP_HOST: "smtp.x.de", SMTP_USER: "u", SMTP_PASSWORD: "p" };

  it("names each transport when its set is complete", () => {
    expect(mailTransport(postmark)).toBe("postmark");
    expect(mailTransport(brevo)).toBe("brevo");
    expect(mailTransport(smtp)).toBe("smtp");
    expect(mailTransport({})).toBe("none");
  });

  it("does not count half a setup as a transport", () => {
    expect(mailTransport({ POSTMARK_SERVER_TOKEN: "t" })).toBe("none");
    expect(mailTransport({ BREVO_API_KEY: "k" })).toBe("none");
    expect(mailTransport({ BREVO_SENDER: "b@x.de" })).toBe("none");
    expect(mailTransport({ SMTP_HOST: "smtp.x.de", SMTP_USER: "u" })).toBe("none");
  });

  it("keeps the order deliver() always had: Postmark, Brevo, SMTP", () => {
    expect(mailTransport({ ...smtp, ...brevo, ...postmark })).toBe("postmark");
    expect(mailTransport({ ...smtp, ...brevo })).toBe("brevo");
  });
});

describe("splitAddress", () => {
  it("leaves a bare address without a name", () => {
    expect(splitAddress("login@fangfertig.de")).toEqual({ email: "login@fangfertig.de", name: null });
  });

  it("splits the display-name form, quoted or not", () => {
    expect(splitAddress("Fangfertig <login@fangfertig.de>")).toEqual({
      email: "login@fangfertig.de",
      name: "Fangfertig",
    });
    expect(splitAddress('"Fang, fertig" <login@fangfertig.de>')).toEqual({
      email: "login@fangfertig.de",
      name: "Fang, fertig",
    });
    expect(splitAddress("<login@fangfertig.de>")).toEqual({ email: "login@fangfertig.de", name: null });
  });
});

describe("emailDomain", () => {
  it("extracts and normalizes the domain", () => {
    expect(emailDomain("login@fangfertig.de")).toBe("fangfertig.de");
    expect(emailDomain("  login@FANGFERTIG.DE  ")).toBe("fangfertig.de");
    expect(emailDomain("login@fangfertig.de.")).toBe("fangfertig.de");
  });

  it("handles the display-name form", () => {
    expect(emailDomain("Fangfertig <login@fangfertig.de>")).toBe("fangfertig.de");
  });

  it("returns null when there is nothing to judge", () => {
    expect(emailDomain("not-an-address")).toBeNull();
    expect(emailDomain("login@")).toBeNull();
    expect(emailDomain("")).toBeNull();
    expect(emailDomain(undefined)).toBeNull();
  });
});

describe("appHost", () => {
  it("returns the lowercased hostname", () => {
    expect(appHost("https://Fangfertig.DE")).toBe("fangfertig.de");
    expect(appHost("https://app.example.com:3000/path")).toBe("app.example.com");
  });

  it("returns null for missing or unparseable values", () => {
    expect(appHost("")).toBeNull();
    expect(appHost("not a url")).toBeNull();
    expect(appHost(undefined)).toBeNull();
  });
});

describe("isUnjudgeableHost", () => {
  it("skips localhost, loopback, IP literals and bare names", () => {
    for (const host of ["localhost", "app.localhost", "127.0.0.1", "::1", "192.168.1.5", "myapp", null]) {
      expect(isUnjudgeableHost(host), String(host)).toBe(true);
    }
  });

  it("judges real public hosts", () => {
    expect(isUnjudgeableHost("fangfertig.de")).toBe(false);
    expect(isUnjudgeableHost("app.example.co.uk")).toBe(false);
  });
});

describe("sameSite", () => {
  it("matches equal domains and dot-boundary ancestors, both directions", () => {
    expect(sameSite("fangfertig.de", "fangfertig.de")).toBe(true);
    // A sending subdomain (mail.) for the apex app domain.
    expect(sameSite("mail.fangfertig.de", "fangfertig.de")).toBe(true);
    // The apex as sender while the app runs on a subdomain.
    expect(sameSite("fangfertig.de", "app.fangfertig.de")).toBe(true);
  });

  it("refuses lookalikes and siblings", () => {
    // No partial-label match — the suffix has to sit on a dot boundary.
    expect(sameSite("notfangfertig.de", "fangfertig.de")).toBe(false);
    // Siblings under a multi-part TLD share the suffix but not the site.
    expect(sameSite("other.co.uk", "mysite.co.uk")).toBe(false);
    expect(sameSite("fangfertig.com", "fangfertig.de")).toBe(false);
  });
});

describe("resolvedFrom", () => {
  it("prefers the transport-specific sender, then EMAIL_FROM", () => {
    expect(
      resolvedFrom({ POSTMARK_SERVER_TOKEN: "t", POSTMARK_SENDER: "a@x.de", SMTP_FROM: "b@y.de", EMAIL_FROM: "c@z.de" }),
    ).toBe("a@x.de");
    expect(resolvedFrom({ SMTP_FROM: "b@y.de", EMAIL_FROM: "c@z.de" })).toBe("b@y.de");
    expect(resolvedFrom({ EMAIL_FROM: "c@z.de" })).toBe("c@z.de");
  });

  it("takes BREVO_SENDER when Brevo is the transport — and ignores SMTP_FROM then", () => {
    expect(
      resolvedFrom({ BREVO_API_KEY: "k", BREVO_SENDER: "d@x.de", SMTP_FROM: "b@y.de", EMAIL_FROM: "c@z.de" }),
    ).toBe("d@x.de");
    // Half a Brevo setup is no transport, so its sender is not the sender.
    expect(resolvedFrom({ BREVO_SENDER: "d@x.de", EMAIL_FROM: "c@z.de" })).toBe("c@z.de");
  });

  it("returns null instead of the localhost fallback", () => {
    // A missing sender must be visible as missing — the boot guard turns it
    // into a start condition; only lib/email.ts adds the DEV fallback.
    expect(resolvedFrom({})).toBeNull();
    expect(resolvedFrom({ SMTP_HOST: "smtp.x.de", SMTP_USER: "u", SMTP_PASSWORD: "p" })).toBeNull();
  });
});

describe("senderDomainProblem", () => {
  const appUrl = "https://fangfertig.de";

  it("passes a sender on the app's domain, subdomains included", () => {
    expect(senderDomainProblem({ from: "login@fangfertig.de", appUrl })).toBeNull();
    expect(senderDomainProblem({ from: "login@mail.fangfertig.de", appUrl })).toBeNull();
    expect(
      senderDomainProblem({ from: "login@fangfertig.de", appUrl: "https://app.fangfertig.de" }),
    ).toBeNull();
  });

  it("reports a missing sender regardless of APP_URL", () => {
    expect(senderDomainProblem({ from: null, appUrl })).toEqual({ code: "missingFrom" });
    expect(senderDomainProblem({ from: "  ", appUrl: "http://localhost:3000" })).toEqual({
      code: "missingFrom",
    });
  });

  it("reports a foreign sender — the fangfertig.de failure", () => {
    const verdict = senderDomainProblem({ from: "login@other-agency.com", appUrl });
    expect(verdict).toMatchObject({
      code: "foreignFrom",
      fromDomain: "other-agency.com",
      host: "fangfertig.de",
    });
  });

  it("treats an unparseable address as foreign, never as a pass", () => {
    expect(senderDomainProblem({ from: "not-an-address", appUrl })).toMatchObject({
      code: "foreignFrom",
      fromDomain: null,
    });
  });

  it("skips the domain comparison when APP_URL is not judgeable", () => {
    for (const url of ["http://localhost:3000", "http://127.0.0.1:3000", "", undefined]) {
      expect(senderDomainProblem({ from: "login@anywhere.com", appUrl: url }), String(url)).toBeNull();
    }
  });

  it("lets a matching override through — the deliberate, informed decision", () => {
    expect(
      senderDomainProblem({ from: "login@other-agency.com", appUrl, foreignDomainAck: "other-agency.com" }),
    ).toBeNull();
    // Case and trailing dots must not defeat the acknowledgment.
    expect(
      senderDomainProblem({ from: "login@other-agency.com", appUrl, foreignDomainAck: " Other-Agency.COM. " }),
    ).toBeNull();
  });

  it("refuses an override that names a different domain", () => {
    // The acknowledgment is specific: a sender that moved to yet another
    // foreign domain is caught again.
    expect(
      senderDomainProblem({ from: "login@third-domain.net", appUrl, foreignDomainAck: "other-agency.com" }),
    ).toMatchObject({ code: "foreignFrom" });
  });

  it("refuses a yes-flag override with its own code", () => {
    for (const ack of ["1", "true", "yes", "on", "Y"]) {
      expect(
        senderDomainProblem({ from: "login@other-agency.com", appUrl, foreignDomainAck: ack }),
        ack,
      ).toMatchObject({ code: "badOverride" });
    }
  });
});
