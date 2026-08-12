// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What an absent tool SAYS — the half of the two tier-2 rungs that can be tested.
//
// ⚠️ **This file is pure on purpose, and that is a rule rather than a taste.**
// `vitest.config.ts:15` includes `**/*.test.ts`, so anything placed beside the
// code runs inside every `npm run test` — and `security-check` must never become
// a gate (CLAUDE.md, and `check.mjs`'s own header). Nothing below spawns, fetches
// or starts a container. A test that started Docker would be exactly the brake
// that rule forbids.
//
// 🚨 The interesting path of this whole story is the one where the tool is
// MISSING. That is the normal state of a developer's machine, and it is what
// these assertions are about: the sentence an operator reads, its two halves, and
// the fact that the two Docker sentences are never the same sentence.
import { describe, expect, it } from "vitest";

import { MAX_REASON_LENGTH } from "./rules.mjs";
import {
  SCANNER_IMAGE_REPO,
  TIER2_TOOLS,
  capReason,
  dockerMissing,
  firstLine,
  gitleaksMissing,
  imageMissing,
  unanswered,
  unavailable,
} from "./tier2.mjs";

const TOOL_IDS = Object.keys(TIER2_TOOLS);

describe("the tool table", () => {
  it("has the three tools the two tier-2 rungs reach for", () => {
    // Not a count for its own sake: each of these is a separate SKIP SENTENCE,
    // and the story this file belongs to exists because two of them were about
    // to be written as one.
    expect(TOOL_IDS).toEqual(["gitleaks", "docker", "trivy-image"]);
  });

  it.each(TOOL_IDS)("%s says what is missing and how to get it, in one line each", (id) => {
    const tool = TIER2_TOOLS[id];
    expect(tool.id).toBe(id);
    expect(tool.label.trim()).not.toBe("");
    expect(tool.missing.trim()).not.toBe("");
    expect(tool.howToGet.trim()).not.toBe("");
    // ONE line. `formatSkip()` wraps it into the `Reason:` block, and a newline
    // in the middle of an install command is a command somebody cannot copy.
    expect(tool.howToGet).not.toMatch(/[\r\n]/);
    expect(tool.missing).not.toMatch(/[\r\n]/);
  });

  it("names the three systems where the way to get gitleaks differs", () => {
    // brew covers macOS and a Linux with brew; the release binary is the answer
    // in Git Bash on Windows and on a Linux without it.
    expect(TIER2_TOOLS.gitleaks.howToGet).toContain("brew install gitleaks");
    expect(TIER2_TOOLS.gitleaks.howToGet).toContain("github.com/gitleaks/gitleaks");
  });
});

describe("a rung whose tool is not here", () => {
  it.each(TOOL_IDS)("%s skips, with a reason and no findings", (id) => {
    const result = unavailable(id);
    expect(result.state).toBe("skipped");
    expect(result.findings).toEqual([]);
    // `aggregate()` throws on a skip with no reason — the one failure the whole
    // command exists to prevent. This is that contract, asserted from the side
    // that produces it.
    expect(String(result.reason).trim()).not.toBe("");
  });

  it.each(TOOL_IDS)("%s carries the way to get the tool INSIDE the reason", (id) => {
    // `formatSkip()` renders `Reason:` and `Blind to:` and nothing else
    // (`rules.mjs:219-225`). So the install line has to be in the reason; a third
    // field would be the renderer edited by a later rung, which is the thing the
    // rung interface was shaped to make unnecessary.
    expect(unavailable(id).reason).toContain(TIER2_TOOLS[id].howToGet);
  });

  it.each(TOOL_IDS)("%s fits the record's cap without being truncated", (id) => {
    const reason = String(unavailable(id).reason);
    expect(reason.length).toBeLessThanOrEqual(MAX_REASON_LENGTH);
    // 🚨 Sharper than the cap: the way to get the tool is at the END of the
    // sentence, so a reason that merely FITS after truncation would have lost
    // exactly the half an operator can act on.
    expect(reason.endsWith("…")).toBe(false);
  });

  it("refuses a tool it does not know, rather than skipping blankly", () => {
    // A blank skip is refused downstream by rung id, which names the wrong
    // problem. This names the right one.
    expect(() => unavailable("trivvy")).toThrow(/no such tier-2 tool/);
  });
});

describe("🚨 'Docker does not answer' and 'the image is not here' are two sentences", () => {
  const daemon = dockerMissing().reason;
  const image = imageMissing().reason;

  it("never produces the same sentence for the two", () => {
    // Measured on the maintainer's machine on 2026-08-10: `docker info` answers
    // 29.7.2 and `docker images` holds postgres:16, httpd:2.4 and
    // minio/minio:latest — no scanner image. So this is not a hypothetical
    // branch; it is the branch that machine takes.
    expect(daemon).not.toBe(image);
  });

  it("names the daemon test the app already makes elsewhere", () => {
    // `dockerUsable()` in scripts/db/driver.mjs asks the daemon, not the PATH.
    // Naming `docker info` is what tells the operator which test just failed.
    expect(daemon).toContain("docker info");
    expect(daemon).toContain("daemon");
  });

  it("🚨 never tells an operator to install a Docker that is already running", () => {
    // The whole point of keeping the two apart. An operator told to "install
    // Docker" while Docker is running learns that the check does not know what it
    // is talking about, and stops reading it.
    expect(image).toContain("Docker answered");
    expect(image).not.toMatch(/install Docker|start Docker/i);
    expect(image).toContain(SCANNER_IMAGE_REPO);
    // The one-line way to get it is the pull — as a sentence for a person.
    expect(image).toContain(`docker pull ${SCANNER_IMAGE_REPO}`);
  });

  it("says which image it looked for when it is not the shipped one", () => {
    const other = imageMissing("ghcr.io/aquasecurity/trivy").reason;
    expect(other).toContain("ghcr.io/aquasecurity/trivy");
    expect(other).not.toBe(image);
  });
});

describe("gitleaks, absent", () => {
  it("is the sentence the story's acceptance criterion spells out", () => {
    expect(gitleaksMissing().reason).toBe(
      "gitleaks is not on this machine's PATH — brew install gitleaks, or the release " +
        "binary from github.com/gitleaks/gitleaks",
    );
  });
});

describe("a tool that IS here and could not answer", () => {
  it("is not the same shape as an absent one — no install line", () => {
    const result = unanswered("gitleaks did not finish within 60s and was stopped");
    expect(result.state).toBe("skipped");
    expect(result.findings).toEqual([]);
    // Telling somebody to install what they already have is the same wrong
    // advice as the Docker case, wearing a different hat.
    expect(result.reason).not.toContain("brew install");
  });
});

describe("the cap", () => {
  it("collapses whitespace so a tool's wall of output stays one line", () => {
    expect(capReason("  a\n  b\tc  ")).toBe("a b c");
  });

  it("truncates only what is genuinely too long, and marks it", () => {
    const long = "x".repeat(MAX_REASON_LENGTH + 40);
    const capped = capReason(long);
    expect(capped.length).toBe(MAX_REASON_LENGTH);
    expect(capped.endsWith("…")).toBe(true);
  });

  it("leaves a sentence that fits exactly alone", () => {
    const exact = "y".repeat(MAX_REASON_LENGTH);
    expect(capReason(exact)).toBe(exact);
  });
});

describe("quoting a tool back", () => {
  const ESC = String.fromCharCode(27);

  it("takes the first non-empty line and nothing after it", () => {
    expect(firstLine("\n\n  FTL Failed to load config  \nstack frame\nanother")).toBe(
      "FTL Failed to load config",
    );
    expect(firstLine("")).toBe("");
    // A tool that said nothing at all — the reason then has to come from
    // somewhere else, and the rung's own sentence is what fills it.
    expect(firstLine(undefined as unknown as string)).toBe("");
  });

  it("🚨 strips the colour a tool wrote into its own stderr", () => {
    // Measured before `--no-color` was passed to gitleaks: the reason that landed
    // in `.dev/security-check.json` opened with a raw escape run instead of a
    // sentence. A record nothing can read back is a record.
    expect(firstLine(`${ESC}[90m11:46PM${ESC}[0m ${ESC}[31mFTL${ESC}[0m Failed to load config`)).toBe(
      "11:46PM FTL Failed to load config",
    );
  });

  it("splits on CRLF as well, because Windows", () => {
    expect(firstLine("first\r\nsecond")).toBe("first");
  });
});
