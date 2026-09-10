// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The update decides what may be overwritten in somebody else's repo. Every one
// of these cases is a way to get that wrong, and the expensive direction is
// always the permissive one: a file wrongly left alone costs a manual copy, a
// file wrongly overwritten costs whatever the customer had written in it.
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  confirmsApply,
  guidanceWritable,
  isGuidancePath,
  normalizeText,
  planUpdate,
  requiresFrom,
  versionAtLeast,
  writable,
} from "./update-plan.mjs";

const action = (plan: ReturnType<typeof planUpdate>, path: string) =>
  plan.find((entry) => entry.path === path)?.action;

describe("normalizeText", () => {
  const sha = (text: string) => createHash("sha256").update(normalizeText(text), "utf8").digest("hex");

  it("hashes the content, not the line endings it is stored with", () => {
    // The whole point. Git for Windows checks out CRLF, and without this every
    // guidance file in such a clone looks "edited in this app" — the update
    // then refuses to write anything, for ever, to somebody who touched nothing.
    expect(sha("# Title\r\n\r\nBody\r\n")).toBe(sha("# Title\n\nBody\n"));
  });

  it("still tells two different texts apart", () => {
    expect(sha("Body\n")).not.toBe(sha("Body!\n"));
  });

  it("ignores the block `next dev` appends to AGENTS.md", () => {
    // Next 16 writes a managed section into AGENTS.md on the first start —
    // from the customer's own agent, on a file they never opened. Measured
    // 2026-09-10: `node run.mjs update` then said "edited in this app" and
    // never updated AGENTS.md again. The block is Next's, the hash is ours.
    const shipped = "# Guidance\n\nBody\n";
    const afterNextDev =
      shipped +
      "\n<!-- BEGIN:nextjs-agent-rules -->\n\n# This is NOT the Next.js you know\n\n" +
      "This block is written and re-added by `next dev`.\n\n<!-- END:nextjs-agent-rules -->\n";
    expect(sha(afterNextDev)).toBe(sha(shipped));
    // A real edit next to the block is still an edit.
    expect(sha(afterNextDev.replace("Body", "Body, changed"))).not.toBe(sha(shipped));
  });

  it("changes nothing about an LF file", () => {
    // Which is why re-stamping on Linux or macOS produces the same values.
    const text = "# Title\n\nBody\n";
    expect(normalizeText(text)).toBe(text);
  });
});

describe("versionAtLeast", () => {
  it("compares numerically, not as text", () => {
    // "1.10.0" < "1.9.3" as strings — the bug this exists to avoid.
    expect(versionAtLeast("1.10.0", "1.9.3")).toBe(true);
    expect(versionAtLeast("1.9.3", "1.10.0")).toBe(false);
  });

  it("treats an equal version as sufficient", () => {
    expect(versionAtLeast("0.5.0", "0.5.0")).toBe(true);
  });

  it("pads the shorter side", () => {
    expect(versionAtLeast("2", "2.0.0")).toBe(true);
    expect(versionAtLeast("2.0", "2.0.1")).toBe(false);
  });

  it("does not crash on nonsense", () => {
    expect(versionAtLeast(undefined, "1.0.0")).toBe(false);
  });
});

describe("requiresFrom", () => {
  it("reads the requires line out of the frontmatter", () => {
    expect(requiresFrom('---\nname: x\nrequires: "0.6.0"\n---\n# X')).toBe("0.6.0");
    expect(requiresFrom("---\nrequires: 0.6.0\n---\n")).toBe("0.6.0");
  });

  it("returns null when there is none", () => {
    expect(requiresFrom("---\nname: x\n---\n")).toBeNull();
    expect(requiresFrom("# no frontmatter at all")).toBeNull();
    expect(requiresFrom(undefined)).toBeNull();
  });

  it("does not read a requires line from the body", () => {
    // Prose about the field is not the field.
    expect(requiresFrom("---\nname: x\n---\nrequires: 9.9.9 is what it would say")).toBeNull();
  });
});

describe("planUpdate", () => {
  const codeVersion = "0.5.0";

  it("replaces a file nobody here has touched", () => {
    const plan = planUpdate({
      local: { "CLAUDE.md": { current: "aaa", shipped: "aaa" } },
      remote: { "CLAUDE.md": "bbb" },
      codeVersion,
    });
    expect(action(plan, "CLAUDE.md")).toBe("update");
  });

  it("leaves a file alone that was edited here", () => {
    // The one case that must never be got wrong: somebody wrote their own house
    // rules into CLAUDE.md, and an update would take them away silently.
    const plan = planUpdate({
      local: { "CLAUDE.md": { current: "mine", shipped: "aaa" } },
      remote: { "CLAUDE.md": "bbb" },
      codeVersion,
    });
    expect(action(plan, "CLAUDE.md")).toBe("local-change");
    expect(writable(plan)).toEqual([]);
  });

  it("leaves a file alone that .template-version does not know", () => {
    // No baseline means no way to tell an untouched file from an edited one, and
    // "no idea" has to resolve to "hands off".
    const plan = planUpdate({
      local: { "docs/own-notes.md": { current: "mine", shipped: null } },
      remote: { "docs/own-notes.md": "theirs" },
      codeVersion,
    });
    expect(action(plan, "docs/own-notes.md")).toBe("local-change");
  });

  it("says nothing needs doing when the hashes match", () => {
    const plan = planUpdate({
      local: { "CLAUDE.md": { current: "same", shipped: "same" } },
      remote: { "CLAUDE.md": "same" },
      codeVersion,
    });
    expect(action(plan, "CLAUDE.md")).toBe("unchanged");
    expect(writable(plan)).toEqual([]);
  });

  it("installs a file this copy does not have yet", () => {
    const plan = planUpdate({
      local: {},
      remote: { ".claude/skills/new-skill/SKILL.md": "aaa" },
      codeVersion,
    });
    expect(action(plan, ".claude/skills/new-skill/SKILL.md")).toBe("new");
  });

  it("refuses a skill that needs code this copy does not have", () => {
    // Knowledge without the code behind it is worse than no knowledge: the agent
    // describes the feature and then cannot find a line of it.
    const path = ".claude/skills/future/SKILL.md";
    const plan = planUpdate({
      local: {},
      remote: { [path]: "aaa" },
      content: { [path]: '---\nname: future\nrequires: "0.9.0"\n---\n' },
      codeVersion,
    });
    expect(action(plan, path)).toBe("needs-code");
    expect(plan[0].reason).toContain("0.9.0");
    expect(writable(plan)).toEqual([]);
  });

  it("installs a skill whose requirement this copy meets", () => {
    const path = ".claude/skills/fine/SKILL.md";
    const plan = planUpdate({
      local: {},
      remote: { [path]: "aaa" },
      content: { [path]: '---\nname: fine\nrequires: "0.4.0"\n---\n' },
      codeVersion,
    });
    expect(action(plan, path)).toBe("new");
  });

  it("reports a withdrawn file instead of deleting it", () => {
    const plan = planUpdate({
      local: { ".claude/skills/old/SKILL.md": { current: "aaa", shipped: "aaa" } },
      remote: {},
      codeVersion,
    });
    expect(action(plan, ".claude/skills/old/SKILL.md")).toBe("withdrawn");
    expect(writable(plan)).toEqual([]);
  });

  it("does not report a withdrawn file that is already gone", () => {
    const plan = planUpdate({
      local: { ".claude/skills/old/SKILL.md": { current: null, shipped: "aaa" } },
      remote: {},
      codeVersion,
    });
    expect(plan).toEqual([]);
  });
});

describe("confirmsApply", () => {
  it("takes an explicit yes", () => {
    expect(confirmsApply("y")).toBe(true);
    expect(confirmsApply("Y")).toBe(true);
    expect(confirmsApply("yes")).toBe(true);
    expect(confirmsApply(" Yes ")).toBe(true);
  });

  it("reads everything else as no", () => {
    // The question guards a write into somebody's repo, so an unclear answer —
    // an empty return, a stray character, a pasted command — must leave
    // everything alone.
    expect(confirmsApply("")).toBe(false);
    expect(confirmsApply("n")).toBe(false);
    expect(confirmsApply("yess")).toBe(false);
    expect(confirmsApply("node run.mjs update --apply")).toBe(false);
    expect(confirmsApply(null)).toBe(false);
    expect(confirmsApply(undefined)).toBe(false);
  });
});

describe("writable", () => {
  it("passes on exactly the new and updated files", () => {
    const plan = planUpdate({
      local: {
        "a.md": { current: "1", shipped: "1" },
        "b.md": { current: "mine", shipped: "1" },
        "c.md": { current: "2", shipped: "2" },
      },
      remote: { "a.md": "9", "b.md": "9", "c.md": "2", "d.md": "9" },
      codeVersion: "0.5.0",
    });
    expect(writable(plan).map((entry: { path: string }) => entry.path)).toEqual(["a.md", "d.md"]);
  });
});

describe("isGuidancePath", () => {
  // The allowlist decides where a REMOTE manifest may write on somebody's disk,
  // so every case here is read from the permissive side: what must it refuse?
  it("takes the six places the guidance really lives", () => {
    // Read off the shipped manifest: 151 entries, all of them .md, all of them
    // in one of these.
    expect(isGuidancePath("CLAUDE.md")).toBe(true);
    expect(isGuidancePath("AGENTS.md")).toBe(true);
    expect(isGuidancePath("README.md")).toBe(true);
    expect(isGuidancePath("docs/cron.md")).toBe(true);
    expect(isGuidancePath(".claude/skills/build-app/SKILL.md")).toBe(true);
    expect(isGuidancePath(".claude/skills/build-app/references/archetypes.md")).toBe(true);
    expect(isGuidancePath(".agents/skills/build-app/SKILL.md")).toBe(true);
  });

  it("🚨 refuses a path that walks out of the app", () => {
    // The needle: .git/hooks/pre-commit is code that runs at the next commit.
    expect(isGuidancePath("../../.git/hooks/pre-commit")).toBe(false);
    expect(isGuidancePath("../docs/cron.md")).toBe(false);
    expect(isGuidancePath("docs/../../evil.md")).toBe(false);
    expect(isGuidancePath("docs/./cron.md")).toBe(false);
  });

  it("🚨 refuses a Windows path, whichever machine is asking", () => {
    // A manifest is written with "/" on all three systems, so a backslash is
    // not a separator this check can reason about — and "..\\..\\x" reads as one
    // harmless filename on Linux while leaving the tree on Windows. Same for a
    // drive letter, absolute over there and unremarkable here.
    expect(isGuidancePath("..\\..\\.git\\hooks\\pre-commit.md")).toBe(false);
    expect(isGuidancePath("docs\\cron.md")).toBe(false);
    expect(isGuidancePath("C:/docs/cron.md")).toBe(false);
    expect(isGuidancePath("C:docs/cron.md")).toBe(false);
  });

  it("🚨 refuses an absolute path and an empty segment", () => {
    expect(isGuidancePath("/etc/motd.md")).toBe(false);
    expect(isGuidancePath("/docs/cron.md")).toBe(false);
    expect(isGuidancePath("docs//cron.md")).toBe(false);
    expect(isGuidancePath("docs/")).toBe(false);
    expect(isGuidancePath("")).toBe(false);
  });

  it("🚨 refuses a directory that merely starts like ours", () => {
    // The reason the roots carry a trailing slash: without it this is a yes.
    expect(isGuidancePath("docs-evil/cron.md")).toBe(false);
    expect(isGuidancePath(".claude/skills-evil/SKILL.md")).toBe(false);
    expect(isGuidancePath(".claudex/skills/SKILL.md")).toBe(false);
  });

  it("🚨 refuses everything that is not text", () => {
    // .env is inside the app and needs no traversal at all — which is why this
    // has to be an allowlist rather than a list of dangerous places.
    expect(isGuidancePath(".env")).toBe(false);
    expect(isGuidancePath("docs/cron.md.sh")).toBe(false);
    expect(isGuidancePath("lib/entitlements/manage.ts")).toBe(false);
    expect(isGuidancePath("package.json")).toBe(false);
    expect(isGuidancePath("scripts/dev/update.mjs")).toBe(false);
    expect(isGuidancePath("docs/cron.md\u0000.sh")).toBe(false);
  });

  it("refuses anything that is not a string", () => {
    expect(isGuidancePath(undefined)).toBe(false);
    expect(isGuidancePath(null)).toBe(false);
    expect(isGuidancePath(42)).toBe(false);
  });
});

describe("guidanceWritable", () => {
  const codeVersion = "0.5.0";

  it("passes an ordinary plan through unchanged", () => {
    const plan = planUpdate({
      local: {},
      remote: { "docs/cron.md": "9", "CLAUDE.md": "9" },
      codeVersion,
    });
    expect(guidanceWritable(plan).map((entry: { path: string }) => entry.path)).toEqual([
      "docs/cron.md",
      "CLAUDE.md",
    ]);
  });

  it("🚨 throws rather than dropping the entry", () => {
    // Skipping would mean applying the rest of a manifest that has just been
    // caught offering somewhere it may not write — half an update, from a
    // source nothing in can be believed from, looking like an ordinary run.
    const plan = planUpdate({
      local: {},
      remote: { "docs/cron.md": "9", "../../.git/hooks/pre-commit": "9" },
      codeVersion,
    });
    expect(() => guidanceWritable(plan)).toThrow("../../.git/hooks/pre-commit");
  });
});
