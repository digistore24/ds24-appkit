// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { isDevLoginAllowed, isLocalUrl, type DevLoginEnv } from "./dev-login";

// Der Entwicklungs-Login ist ein Auth-Bypass. Diese Tests sind die Wache davor:
// Each individual condition must be able to switch it off on its own.
const erlaubt: DevLoginEnv = {
  NODE_ENV: "development",
  APP_ENV: "development",
  APP_URL: "http://localhost:3000",
  emailConfigured: false,
};

describe("isDevLoginAllowed", () => {
  it("erlaubt ihn nur im lokalen Entwicklungsfall ohne Mailversand", () => {
    expect(isDevLoginAllowed(erlaubt)).toBe(true);
  });

  it("sperrt bei NODE_ENV=production", () => {
    expect(isDevLoginAllowed({ ...erlaubt, NODE_ENV: "production" })).toBe(false);
  });

  it("sperrt bei APP_ENV=production", () => {
    expect(isDevLoginAllowed({ ...erlaubt, APP_ENV: "production" })).toBe(false);
  });

  it("sperrt bei APP_ENV=staging", () => {
    expect(isDevLoginAllowed({ ...erlaubt, APP_ENV: "staging" })).toBe(false);
  });

  it("sperrt bei unbekanntem oder vertipptem APP_ENV (Allowlist)", () => {
    // appEnv() stuft alles Unbekannte als "production" ein — ein Tippfehler
    // must never open the bypass.
    for (const value of ["prod", "produktion", "developmnt", "DEV ", "live", "x"]) {
      const ergebnis = isDevLoginAllowed({ ...erlaubt, APP_ENV: value });
      // "DEV " (mit Leerzeichen) wird normalisiert und ist erlaubt.
      expect(ergebnis).toBe(value.trim().toLowerCase() === "dev");
    }
  });

  it("sperrt, sobald ein Mailversand konfiguriert ist", () => {
    expect(isDevLoginAllowed({ ...erlaubt, emailConfigured: true })).toBe(false);
  });

  it("sperrt bei nicht-lokaler APP_URL", () => {
    for (const url of [
      "https://meine-app.de",
      "http://192.168.1.10:3000",
      "https://staging.meine-app.de",
    ]) {
      expect(isDevLoginAllowed({ ...erlaubt, APP_URL: url })).toBe(false);
    }
  });

  it("can be switched off hard with DEV_LOGIN=off", () => {
    expect(isDevLoginAllowed({ ...erlaubt, DEV_LOGIN: "off" })).toBe(false);
  });

  it("bleibt gesperrt, wenn mehrere Bedingungen zugleich verletzt sind", () => {
    expect(
      isDevLoginAllowed({
        ...erlaubt,
        NODE_ENV: "production",
        APP_URL: "https://meine-app.de",
        emailConfigured: true,
      }),
    ).toBe(false);
  });
});

describe("isLocalUrl", () => {
  it("erkennt lokale Adressen", () => {
    expect(isLocalUrl("http://localhost:3000")).toBe(true);
    expect(isLocalUrl("http://127.0.0.1:3001")).toBe(true);
  });

  it("behandelt ein fehlendes APP_URL als NICHT lokal", () => {
    // Umgedreht am 2026-09-10 (Befund H-3). Vorher galt "nicht gesetzt = lokal",
    // und damit öffnete eine verlorene Umgebungsvariable auf einem Host den
    // DEV-Login, den Testkauf und die Vorschau. Ungesetzt ist ein dritter
    // Zustand, und er ist der gefährliche.
    expect(isLocalUrl(undefined)).toBe(false);
    expect(isLocalUrl("")).toBe(false);
  });

  it("erkennt fremde Adressen", () => {
    expect(isLocalUrl("https://meine-app.de")).toBe(false);
    expect(isLocalUrl("http://app.internal:3000")).toBe(false);
  });

  it("sperrt bei unparsebarer URL", () => {
    expect(isLocalUrl("kaputt")).toBe(false);
  });
});
