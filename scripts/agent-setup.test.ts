// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The wiring for the four programs this app is built with.
//
// Everything here guards a failure that is INVISIBLE from the inside: a config
// that no longer parses, a plugin that registers a hook nobody calls, a prune
// list that quietly takes the skills with it. None of them produce an error —
// they produce an app that is subtly less than it was, in a program the person
// who released it does not use.
//
// Each test below exists because the thing it checks went wrong once.
import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  AGENTS,
  GREETER,
  NODE_PROBE,
  PROFILE_FILE,
  STUB_TREE,
  allConfigFiles,
  gateNotice,
  gateSummary,
  isPrunedPath,
  prunedPathsFor,
  readAgentProfile,
} from "./dev/agent-configs.mjs";
import { notChecked } from "@/lib/test-not-checked";

const ROOT = path.join(import.meta.dirname, "..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");
const here = (file: string) => existsSync(path.join(ROOT, file));
type Agent = keyof typeof AGENTS;
const names = Object.keys(AGENTS) as Agent[];

// 🚨 **This app does not necessarily still have all four.**
// `node run.mjs agent-setup --apply` is a shipped command whose documented
// purpose is to take three of them away — "Tidiness afterwards, never a
// precondition" — and it records what it did in `.agent-profile.json`. A test
// that assumes four therefore turns red on an app whose operator did exactly
// what the guidance told them to; measured in the field test of 2026-08-11, ten
// failures about files this app had itself been told were gone.
//
// So the questions below are asked against the RECORD rather than against an
// assumption, and that is a sharper claim rather than a weaker one: a file is
// expected to be gone exactly when the profile says it was pruned. A genuinely
// missing config for the program this app IS set up for still fails, and so
// does a file still lying around that the profile claims to have removed.
const PROFILE = readAgentProfile(ROOT);

/** Is this program's wiring supposed to be on disk in THIS app? */
const wiredUp = (agent: Agent) => !PROFILE.found || agent === PROFILE.agent;

describe("the record of what this app was reduced to", () => {
  it(`${PROFILE_FILE} is either absent or usable — never there and unreadable`, () => {
    // The third state. A profile that exists but cannot be parsed, or names a
    // program this template does not know, would otherwise be indistinguishable
    // from "nobody ever ran agent-setup" — and every assertion below would then
    // be checking the wrong app while passing.
    expect(PROFILE.problem, `${PROFILE.problem}`).toBeNull();
  });

  it("this app is wired up for at least one program, whole", () => {
    // The non-vacuity anchor for everything below: whatever the profile says,
    // ONE program's files are on disk in full. Without it a tree with no config
    // files at all would satisfy every "gone because it was pruned" branch.
    const expected = PROFILE.found ? [PROFILE.agent as Agent] : names;
    expect(expected.length).toBeGreaterThan(0);
    for (const agent of expected) {
      for (const file of Object.keys(AGENTS[agent].files)) {
        expect(here(file), `${file} is missing — this app is set up for ${agent}`).toBe(true);
      }
    }
  });
});

describe("every program's config ships and is intact", () => {
  it.each(names)("%s has its files on disk, or the profile says where they went", (agent) => {
    for (const file of Object.keys(AGENTS[agent].files)) {
      if (wiredUp(agent)) {
        expect(here(file), `${file} is missing`).toBe(true);
        continue;
      }
      // Set up for another program: gone exactly when the record says pruned.
      // A file the profile does NOT list is one the customer changed —
      // agent-setup leaves those alone and keeps them out of `pruned` — so it
      // must still be there.
      const pruned = isPrunedPath(PROFILE, file);
      expect(
        here(file),
        pruned
          ? `${file} is still here, though ${PROFILE_FILE} says it was pruned`
          : `${file} is gone, and ${PROFILE_FILE} does not say it was pruned`,
      ).toBe(!pruned);
    }
  });

  // A `for` loop rather than `it.each`, because this one needs the test context
  // to skip with a reason and `it.each` hands the case value in its place.
  for (const agent of names)
    it(`${agent} gets exactly what agent-configs.mjs says`, (ctx) => {
      // The shipped file is generated from that module (scripts/agent-configs-stamp.mjs
      // in the factory), and agent-setup restores from the same module. If the two
      // ever differ, "put it back" puts back something else.
      const present = Object.entries(AGENTS[agent].files).filter(([file]) => here(file));
      if (present.length === 0) {
        // Not a pass: this app was reduced to another program and there is
        // nothing of this one left to compare. The test above is what proved
        // the absence was accounted for.
        return notChecked(
          ctx,
          `this app is set up for ${PROFILE.label} (${PROFILE_FILE}), so none of ` +
            `${agent}'s config files are on disk to compare against agent-configs.mjs`,
        );
      }
      for (const [file, content] of present) {
        expect(read(file), `${file} has drifted from agent-configs.mjs`).toBe(content);
      }
    });

  it("the JSON configs parse", (ctx) => {
    // Derived, never a hand-kept list: `opencode.json` was missing from the one
    // that stood here, and a config nobody parses is a config that can rot.
    const json = allConfigFiles()
      .map(({ file }) => file)
      .filter((file) => file.endsWith(".json") && here(file));

    if (json.length === 0) {
      // ⚠️ Not a hole: Codex's only config is a `.toml`, so an app reduced to
      // it genuinely has no JSON left to parse. Saying so beats a `0` that
      // reads like a clean pass.
      return notChecked(
        ctx,
        `this app is set up for ${PROFILE.label} (${PROFILE_FILE}), and none of ` +
          `its config files are JSON — there is nothing here to parse`,
      );
    }

    for (const file of json) {
      expect(() => JSON.parse(read(file)), `${file} is not valid JSON`).not.toThrow();
    }
  });

  // The one program that cannot be told apart from the outside. Detection is a
  // convenience everywhere here; for this one it is deliberately absent, and a
  // variable somebody invents later would be worse than nothing — it would prune
  // the wiring of whoever exported it.
  const NO_GREETING = "antigravity";

  it("every config runs the same greeting — except the one program that cannot", () => {
    // Reads agent-configs.mjs, not the disk: what a pruned program WOULD get
    // is still this template's promise, and `--undo` puts exactly this back.
    // One script, several mechanisms. A typo in any of them is a program that
    // starts silently — and silence reads as "nothing is wrong". Most name the
    // whole command; OpenCode spawns the script itself, so the path is what
    // they have in common.
    const script = GREETER.replace(/^node\s+/, "");
    for (const agent of names.filter((name) => name !== NO_GREETING)) {
      const mentions = Object.values(AGENTS[agent].files).some((content) =>
        (content as string).includes(script),
      );
      expect(mentions, `${agent} does not start ${script}`).toBe(true);
    }
    // The greeter itself is shared by all four and is never pruned.
    expect(here(script), `${script} is missing`).toBe(true);
  });

  it(`${NO_GREETING} ships no greeting hook, because the program has no event for one`, () => {
    // Antigravity CLI's five hook events (PreToolUse, PostToolUse,
    // PreInvocation, PostInvocation, Stop) contain nothing that fires at
    // session start. Shipping a hook file anyway would look wired and do
    // nothing — the worst of the three options, because it reads as covered.
    //
    // This asserts the absence on purpose: somebody adding a hook here later
    // has to come past this test and say what event they found.
    const script = GREETER.replace(/^node\s+/, "");
    for (const [file, content] of Object.entries(AGENTS[NO_GREETING].files)) {
      expect(content, `${file} wires a greeting — has ${NO_GREETING} gained a session-start event?`)
        .not.toContain(script);
      expect(content, `${file} carries the shell probe, which only makes sense beside a greeting`)
        .not.toContain(NODE_PROBE);
    }
  });

  it(`the guidance carries what ${NO_GREETING} has no hook for`, () => {
    // 🚨 This is the OTHER half of the exemption above, and the reason the gap
    // is a decision rather than a hole. With no session-start hook, the only
    // thing standing between this program and a machine with no Node is the
    // sentence in the guidance — which that program reads by itself, AGENTS.md
    // needing no configuration there.
    //
    // ⚠️ And it has to be the UNCONDITIONAL sentence, which is the part that is
    // easy to get wrong. The general rule is worded as a fallback — "if no
    // greeting appeared, run it" — and that wording quietly stops working here:
    // no greeting EVER appears in this program, so the condition is constant
    // rather than diagnostic, and an agent reading it as a diagnosis concludes
    // nothing is wrong. What carries the precondition is the paragraph that
    // names this program and tells it to run the command outright.
    //
    // Delete either and every gate stays green while one of four programs
    // silently loses the precondition CLAUDE.md calls mandatory. Both are
    // asserted, in both files, because they are two names for one text.
    for (const file of ["CLAUDE.md", "AGENTS.md"]) {
      const text = read(file);

      expect(text, `${file} no longer tells the agent to run the greeting by hand`).toContain(
        "node run.mjs greet",
      );
      expect(
        /absence of a signal is never a signal/i.test(text),
        `${file} lost the rule that a missing greeting is not a pass`,
      ).toBe(true);

      // The unconditional half: one paragraph that names the program AND the
      // command. Paragraph-scoped on purpose — the two words existing in the
      // same 2,300-line file proves nothing about whether they were said
      // together.
      const paragraphs = text.split(/\n\s*\n/);
      const carries = paragraphs.some(
        (block) => /antigravity/i.test(block) && block.includes("node run.mjs greet"),
      );
      expect(
        carries,
        `${file} has no paragraph telling ${NO_GREETING} to run the greeting itself. ` +
          `The general "if no greeting appeared" rule does NOT cover it — none ever ` +
          `appears there, so that phrasing reads as a diagnosis that comes back clean.`,
      ).toBe(true);
    }
  });

  it("the shell probe runs before the greeting, wherever both appear", () => {
    // The probe is the only thing that can report a machine with no Node, so it
    // has to come first. It is the one shell exception named in
    // CLAUDE.md → *Three systems*, and that is why it is shell at all.
    for (const { files } of Object.values(AGENTS)) {
      for (const content of Object.values(files) as string[]) {
        if (!content.includes(NODE_PROBE)) continue;
        expect(content.indexOf(NODE_PROBE)).toBeLessThan(content.indexOf(GREETER));
      }
    }
  });
});

describe("the OpenCode plugin", () => {
  // It is the only greeting that is CODE rather than config, so it is the only
  // one that can be syntactically broken or silently register nothing.
  const file = ".opencode/plugins/session-start.js";

  /**
   * This one is a real IMPORT, so it needs the file on disk — and an app set up
   * for one of the other three does not have it. That absence is checked above,
   * against the profile; here it is a reason to skip, printed, never a pass.
   */
  const gone = () =>
    `this app is set up for ${PROFILE.label} (${PROFILE_FILE}), so ${file} is not ` +
    `on disk — run \`node run.mjs agent-setup --undo --apply\` to get it back`;

  it("parses and exports a plugin function", async (ctx) => {
    if (!here(file)) return notChecked(ctx, gone());
    const plugin = await import(path.join(ROOT, file));
    expect(typeof plugin.SessionGreeting).toBe("function");
  });

  it("registers the session hook under both known shapes", async (ctx) => {
    if (!here(file)) return notChecked(ctx, gone());
    // OpenCode documents hooks keyed by event name; a generic `event` hook is
    // also described in the wild. Registering one and guessing wrong is a
    // greeting that never appears, with nothing in any log to say so.
    const { SessionGreeting } = await import(path.join(ROOT, file));
    const hooks = await SessionGreeting({ directory: ROOT });
    expect(Object.keys(hooks).sort()).toEqual(["event", "session.created"]);
  });

  it("survives a greeting that cannot run", async (ctx) => {
    if (!here(file)) return notChecked(ctx, gone());
    // A plugin that throws in session.created stops somebody from starting
    // work — over a banner.
    const { SessionGreeting } = await import(path.join(ROOT, file));
    const hooks = await SessionGreeting({ directory: path.join(ROOT, "does-not-exist") });
    await expect(hooks["session.created"]()).resolves.not.toThrow();
  });
});

describe("what agent-setup removes", () => {
  it.each(names)("%s never prunes a path that carries the skills", (agent) => {
    // `.claude` instead of `.claude/settings.json` would swallow
    // `.claude/skills/**`. Those are in the knowledge stamp, `node run.mjs
    // update` skips anything the profile calls pruned — and every skill would
    // stop being updated, in every app, with no message anywhere.
    const shared = [
      ".claude/skills/build-app/SKILL.md",
      "CLAUDE.md",
      "AGENTS.md",
      "README.md",
      "docs/updates.md",
      GREETER.replace(/^node\s+/, ""),
    ];
    for (const file of prunedPathsFor(agent)) {
      for (const keep of shared) {
        expect(
          keep === file || keep.startsWith(`${file}/`),
          `setting up for ${agent} would prune ${keep} (via "${file}")`,
        ).toBe(false);
      }
    }
  });

  it.each(names)("%s keeps its own files and drops the others'", (agent) => {
    const pruned = prunedPathsFor(agent);
    for (const own of Object.keys(AGENTS[agent].files)) {
      expect(pruned, `${agent} would prune its own ${own}`).not.toContain(own);
    }
    for (const other of names.filter((name) => name !== agent)) {
      for (const file of Object.keys(AGENTS[other].files)) {
        expect(pruned, `${agent} should not keep ${other}'s ${file}`).toContain(file);
      }
    }
  });

  it("keeps the stub tree exactly for the programs that read it", () => {
    // Codex and Antigravity find skills under .agents/skills; Claude Code and
    // OpenCode read .claude/skills directly. Pruning the tree for a program
    // that needs it is a session with no skills at all.
    for (const agent of names) {
      expect(prunedPathsFor(agent).includes(STUB_TREE)).toBe(!AGENTS[agent].stubs);
    }
  });
});

// ── What the operator still has to do, once the wiring is written ───────────
//
// 🚨 Three of the four gate the MCP server on trust or approval, and until that
// is cleared the server is simply absent: no error, no warning, no tools. So
// "I wrote the config and nothing happened" is the ORDINARY first experience in
// three programs out of four, and a command that ends on the files it wrote has
// left its operator exactly there.
//
// Two questions, and neither answers the other: does the command SAY it (a
// sentence living in a module nobody prints is the same silence), and does it
// say the same thing the document says (two copies of one fact are one fact
// until somebody edits one of them).
describe("the gate each program still puts in front of the server", () => {
  /** Markup and line breaks are formatting; the sentence is the claim. */
  const flat = (text: string) => text.replace(/[*`]/g, "").replace(/\s+/g, " ").trim();
  const DOC = "docs/setup-mcp.md";
  const doc = flat(read(DOC));

  it.each(names)("%s says the same thing here and in the document", (agent) => {
    const { label, gate } = AGENTS[agent];

    // `null` is an answer — "this program has no gate" — and it has to be one
    // the document agrees with. Without this branch, blanking a real gate would
    // silently downgrade the program to "nothing to clear" and every assertion
    // below would still pass.
    if (gate === null) {
      expect(
        doc,
        `agent-configs.mjs says ${label} has no gate, and ${DOC} does not say so`,
      ).toContain(flat(`${label} has no gate`));
      return;
    }

    expect(
      doc,
      `${DOC} no longer carries ${label}'s gate sentence — the command and the ` +
        `document have drifted, and one of them is now wrong about what an ` +
        `operator has to do next`,
    ).toContain(flat(gate));
  });

  it("names every program, so a fifth cannot arrive without its own line", () => {
    // gateSummary() is what `--undo` prints, and `--undo` wires all four back
    // up — a program missing from it is one whose operator is told nothing.
    const summary = flat(gateSummary().join(" "));
    for (const agent of names) {
      expect(summary, `${AGENTS[agent].label} is missing from the summary`).toContain(
        flat(AGENTS[agent].label),
      );
    }
  });

  // ── the needle ────────────────────────────────────────────────────────────
  //
  // The above proves the sentences EXIST and agree with the document. It proves
  // nothing about the command, and that is the whole action point: the sentence
  // was in `docs/setup-mcp.md` all along and the command still ended on a file
  // list. So this runs the real thing, in a throwaway folder, and reads what an
  // operator reads. Delete the printing loop in agent-setup.mjs and all four of
  // these go red; drop one program's line and that one does.
  describe("the command really prints it", () => {
    const script = path.join(ROOT, "scripts", "dev", "agent-setup.mjs");
    const folders: string[] = [];

    afterAll(() => {
      for (const dir of folders) rmSync(dir, { recursive: true, force: true });
    });

    it.each(names)("%s --apply ends on what is still to do", (agent) => {
      // An empty folder rather than a copy of this app: agent-setup only ever
      // writes the files it can regenerate, so a bare directory exercises the
      // whole apply path and can never damage the tree the suite is running in.
      const dir = mkdtempSync(path.join(tmpdir(), `ds24-agent-setup-${agent}-`));
      folders.push(dir);

      const run = spawnSync(process.execPath, [script, "--agent", agent, "--apply"], {
        cwd: dir,
        encoding: "utf8",
      });

      expect(run.status, `agent-setup exited ${run.status}: ${run.stderr}`).toBe(0);
      expect(
        flat(run.stdout),
        `\`node run.mjs agent-setup --agent ${agent} --apply\` wrote the wiring and ` +
          `said nothing about ${AGENTS[agent].label}'s gate — which is where ` +
          `"I wrote the config and nothing happened" comes from`,
      ).toContain(flat(gateNotice(agent).join(" ")));
    });
  });
});
