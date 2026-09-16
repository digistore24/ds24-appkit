// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import {
  HOOK_PATH,
  codeFromName,
  detectLanguage,
  languageFor,
  postLine,
  promptLine,
  stopReason,
} from "./language-guard.mjs";

// The lines are the measured ones (2026-09-15, three build turns).
const ENGLISH_PROGRESS = "Good, `Input` and `Checkbox` already exist. Let me find `requireActiveUser` and see what the page needs before I write it.";
const GERMAN_PROGRESS = "Jetzt baue ich die Quiz-Komponente und binde sie in die Lektionsseite ein, damit du sie gleich sehen kannst.";
const GERMAN_PROMPT = "Baue meine App. Ich bin Coach für Selbständige, die App heißt Wochenfokus und meine Kunden tragen jeden Montag drei Ziele ein.";
const GERMAN_HANDBACK =
  "**Wochenfokus ist da.** Öffne http://localhost:3000 und melde dich mit deiner Adresse an — du bist die Betreiberin. " +
  "Ich habe alles committet, und die App läuft.\n\n---\nGeänderte Dateien: `app/dashboard/wochenfokus/page.tsx`, `docs/app.md`";

describe("detectLanguage", () => {
  it("recognises the measured English progress line and the German ones", () => {
    expect(detectLanguage(ENGLISH_PROGRESS)?.code).toBe("en");
    expect(detectLanguage(GERMAN_PROGRESS)?.code).toBe("de");
    expect(detectLanguage(GERMAN_PROMPT)?.code).toBe("de");
    expect(detectLanguage(GERMAN_HANDBACK)?.code).toBe("de");
  });

  it("recognises Spanish and French", () => {
    expect(detectLanguage("Quiero una app para mis clientes, pero solo con los cursos que tengo ahora.")?.code).toBe("es");
    expect(detectLanguage("Je veux une app pour mes clients, mais seulement avec les cours que nous avons maintenant.")?.code).toBe("fr");
  });

  it("says nothing about a short answer, a command or a block of code", () => {
    expect(detectLanguage("ok")).toBeNull();
    expect(detectLanguage("go")).toBeNull();
    expect(detectLanguage("```\nnpm run test\nnode run.mjs smoke\n```")).toBeNull();
    expect(detectLanguage("`app/dashboard/page.tsx`, `lib/users/bootstrap.ts`")).toBeNull();
  });
});

describe("languageFor", () => {
  it("takes the language of a clear prompt", () => {
    expect(languageFor({ prompt: GERMAN_PROMPT })).toBe("de");
  });

  it("keeps the remembered language on a short answer", () => {
    expect(languageFor({ prompt: "ok, weiter", stored: "de" })).toBe("de");
    expect(languageFor({ prompt: "go", stored: "de" })).toBe("de");
  });

  it("🚨 a German customer pasting an English error message stays German", () => {
    const pasted = "Error: Cannot find module '@/lib/x' from the page — it says this is not there.";
    expect(languageFor({ prompt: pasted, stored: "de" })).toBe("de");
  });

  it("falls back to docs/app.md → Language, in whatever language the label is", () => {
    expect(languageFor({ appMd: "- **Sprache:** Deutsch" })).toBe("de");
    expect(languageFor({ appMd: "- **Language:** German — every line" })).toBe("de");
    expect(languageFor({})).toBeNull();
  });

  it("maps names in every shipped language", () => {
    expect(codeFromName("Deutsch")).toBe("de");
    expect(codeFromName("français")).toBe("fr");
    expect(codeFromName("Spanisch")).toBe("es");
    expect(codeFromName("Klingon")).toBeNull();
  });
});

describe("what the hooks say", () => {
  it("says the language for a German customer, and nothing for an English one", () => {
    expect(promptLine("de")).toMatch(/German \(Deutsch\).*left out/);
    expect(postLine("de")).toMatch(/German, or it is not written/);
    expect(promptLine("en")).toBeNull();
    expect(postLine(null)).toBeNull();
  });

  it("🚨 refuses to end a German customer's turn on an English message — once", () => {
    const english = "Stage 1 is done. You can now open the page and see your weekly goals, and I have committed all of it.";
    expect(stopReason({ code: "de", message: english })).toMatch(/Write that message again, completely, in German/);
    // `stop_hook_active`: the second ending passes whatever it says.
    expect(stopReason({ code: "de", message: english, active: true })).toBeNull();
  });

  it("lets a German hand-back, a file list and an English customer through", () => {
    expect(stopReason({ code: "de", message: GERMAN_HANDBACK })).toBeNull();
    expect(stopReason({ code: "de", message: "`docs/app.md`, `app/page.tsx`" })).toBeNull();
    expect(stopReason({ code: "en", message: GERMAN_HANDBACK })).toBeNull();
  });
});

describe("the hook, run the way Claude Code runs it", () => {
  const dir = mkdtempSync(join(tmpdir(), "language-guard-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const run = (mode: string, input: object) =>
    spawnSync(process.execPath, [HOOK_PATH, mode], { input: JSON.stringify({ cwd: dir, ...input }), encoding: "utf8" });

  it("--prompt remembers the language and says it; --post and --stop read it back", () => {
    const prompt = run("--prompt", { prompt: GERMAN_PROMPT });
    expect(prompt.status).toBe(0);
    expect(prompt.stdout).toMatch(/Customer language: German/);
    expect(readFileSync(join(dir, ".dev", "customer-language"), "utf8").trim()).toBe("de");

    const post = run("--post", { tool_name: "Bash" });
    expect(JSON.parse(post.stdout).hookSpecificOutput.additionalContext).toMatch(/German/);

    const stop = run("--stop", { last_assistant_message: "Stage 1 is done. You can now open the page and see your goals, and it is all committed.", stop_hook_active: false });
    expect(JSON.parse(stop.stdout).decision).toBe("block");
  });

  it("never fails a session: bad input exits 0 and says nothing", () => {
    const bad = spawnSync(process.execPath, [HOOK_PATH, "--stop"], { input: "{not json", encoding: "utf8" });
    expect(bad.status).toBe(0);
    expect(bad.stdout).toBe("");
  });

  it("reads docs/app.md when no prompt has been seen yet", () => {
    const other = mkdtempSync(join(tmpdir(), "language-guard-app-"));
    try {
      mkdirSync(join(other, "docs"), { recursive: true });
      writeFileSync(join(other, "docs", "app.md"), "- **Sprache:** Deutsch\n");
      const post = spawnSync(process.execPath, [HOOK_PATH, "--post"], { input: JSON.stringify({ cwd: other }), encoding: "utf8" });
      expect(JSON.parse(post.stdout).hookSpecificOutput.additionalContext).toMatch(/German/);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });
});
