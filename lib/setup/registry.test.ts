// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { ALL_SETUP_TOOLS, describeTools, toolsByName } from "./registry";
import { isValidToolName, moduleToolNameProblem, validateInput } from "./rules";
import { CORE_SETUP_TOOLS } from "./tools";
import { MODULE_SETUP_TOOLS } from "@/lib/modules/setup-registry";

describe("the enumerated surface", () => {
  it("has tools, and every name is unique", () => {
    expect(ALL_SETUP_TOOLS.length).toBeGreaterThan(0);
    const names = ALL_SETUP_TOOLS.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("names them the way the grammar says", () => {
    for (const tool of ALL_SETUP_TOOLS) {
      expect(isValidToolName(tool.name), tool.name).toBe(true);
    }
  });

  it("gives every tool a description an agent can choose on", () => {
    for (const tool of ALL_SETUP_TOOLS) {
      expect(tool.description.length, tool.name).toBeGreaterThan(20);
    }
  });

  it("declares an object schema for every tool", () => {
    for (const tool of ALL_SETUP_TOOLS) {
      expect(tool.inputSchema.type, tool.name).toBe("object");
      // Required fields must actually be declared properties, or the tool asks
      // for something its own schema cannot carry.
      for (const key of tool.inputSchema.required ?? []) {
        expect(Object.hasOwn(tool.inputSchema.properties, key), `${tool.name}.${key}`).toBe(true);
      }
    }
  });

  // 🚨 AD-85. Bytes never travel through the model: a media tool takes a PATH
  // and the MCP server posts the file itself. This asserts the property at the
  // level where it is enforceable — no schema anywhere declares a field that
  // invites a payload — rather than trusting each tool author to remember.
  it("declares no field that invites a base64 payload", () => {
    for (const tool of ALL_SETUP_TOOLS) {
      for (const key of Object.keys(tool.inputSchema.properties)) {
        expect(/base64|bytes|content|blob|data/i.test(key), `${tool.name}.${key}`).toBe(false);
      }
    }
  });

  // 🚨 A53. A refused act used to lose its target: the refusal branches in
  // `dispatch.ts` hold an error and not a `SetupResult`, so the row said WHAT
  // happened and never to WHICH thing. `targetField` is how a tool answers that
  // off its own input — and the answer is required, so "this act is about
  // nothing nameable" (`null`, declared) can never be confused with "somebody
  // forgot". TypeScript refuses the tool that has not decided; this holds the
  // half a type cannot: that the declared field is one this tool will actually
  // be handed.
  it("makes every tool say what an act of it is ABOUT", () => {
    // ⚠️ Count guard, the A30 shape: an empty registry must be a failure and
    // not a vacuous pass.
    expect(ALL_SETUP_TOOLS.length).toBeGreaterThan(0);
    let declared = 0;

    for (const tool of ALL_SETUP_TOOLS) {
      const field = tool.targetField;
      expect(field === null || typeof field === "string", `${tool.name} declares no targetField`)
        .toBe(true);
      if (field === null) continue;
      declared++;

      // A typo is a silently empty column for ever, which is the defect again
      // wearing a declaration.
      const property = tool.inputSchema.properties[field];
      expect(property, `${tool.name}.targetField "${field}" is not a property of its schema`)
        .toBeDefined();
      // Only a string can be an identifier; a number or a boolean would be a
      // setting, and an array would be a set rather than a subject.
      expect(property?.type, `${tool.name}.${field}`).toBe("string");
      // 🚨 And REQUIRED — an optional field would make the target present or
      // absent depending on how the caller phrased the request, which is
      // exactly the ambiguity this whole mechanism exists to remove.
      expect(tool.inputSchema.required ?? [], `${tool.name}.${field} may be absent`).toContain(
        field,
      );
    }

    // The second count guard: if nothing declares one, the mechanism is off and
    // every assertion above passed by never running.
    expect(declared, "no tool names a target at all").toBeGreaterThan(0);
  });

  // The other direction, and the one that catches a hopeful declaration: a tool
  // with no input has nothing to name, whatever it says.
  it("lets no tool point at a field it does not have", () => {
    for (const tool of ALL_SETUP_TOOLS) {
      if (Object.keys(tool.inputSchema.properties).length > 0) continue;
      expect(tool.targetField, `${tool.name} takes no input and cannot name anything`).toBeNull();
    }
  });

  // The CORE mapping, written out. Not ceremony: each `null` here is a decision
  // about what an operator will read in the trail — `user_list` filters by role
  // and is about everybody, `content_publish` is about the whole repo — and a
  // change to any of it should be somebody's sentence in a diff rather than a
  // quiet edit. Deliberately CORE only: what a module declares is that module's
  // decision, and asserting it here would turn installing one into a red suite.
  it("is this mapping for the core surface, and a change to it is a decision", () => {
    const mapping = Object.fromEntries(
      CORE_SETUP_TOOLS.map((tool) => [tool.name, tool.targetField]),
    );
    expect(mapping).toEqual({
      content_media_confirm: "path",
      content_media_url: "path",
      content_presence: null,
      content_publish: null,
      grant_by_hand: "email",
      grant_revoke: "grantId",
      list_acts: null,
      list_environment: null,
      list_modules: null,
      media_upload: "path",
      user_list: null,
      user_upsert: "email",
    });
  });

  // 🚨 A70. `setup_audit.subject_member_id` is what makes the trail sliceable
  // per person — both Art. 15 exports cut the `setupActs` section with
  // `where subject_member_id = <memberId>` — and NOTHING wrote it: the section
  // was empty in every app while rows about the person sat in the table. The
  // fix is the same shape as `targetField` rather than a second one: the tool
  // declares, `null` is an answer, and a tool that has not decided does not
  // compile.
  it("makes every tool say whether an act of it is about a MEMBER", () => {
    expect(ALL_SETUP_TOOLS.length).toBeGreaterThan(0);
    let declared = 0;

    for (const tool of ALL_SETUP_TOOLS) {
      const field = tool.subjectEmailField;
      expect(field === null || typeof field === "string", `${tool.name} declares none`).toBe(true);
      if (field === null) continue;
      declared++;

      const property = tool.inputSchema.properties[field];
      expect(property, `${tool.name}.subjectEmailField "${field}" is not in its schema`)
        .toBeDefined();
      // 🚨 An EMAIL, so a string — and the trail's own reason for insisting:
      // `subject_member_id` is a foreign key on `users.id`, this field is an
      // address, and `dispatch.ts` is the one place that turns one into the
      // other. A field of any other type could not be looked up at all.
      expect(property?.type, `${tool.name}.${field}`).toBe("string");
      // Required, for `targetField`'s reason: a column that is present or
      // absent depending on how the caller phrased the request is the ambiguity
      // this mechanism exists to remove.
      expect(tool.inputSchema.required ?? [], `${tool.name}.${field} may be absent`).toContain(
        field,
      );
    }

    expect(declared, "no tool names a member at all").toBeGreaterThan(0);
  });

  // The core mapping, and every entry is a decision about whose Art. 15 export
  // an act turns up in. ⚠️ `grant_revoke` is null here and is NOT an act about
  // nobody: its input names a GRANT, and the member is read off that row into
  // `SetupResult.subjectMemberId` — the result-side half. `dispatch.test.ts`
  // holds that end.
  it("is this member mapping for the core surface", () => {
    const mapping = Object.fromEntries(
      CORE_SETUP_TOOLS.map((tool) => [tool.name, tool.subjectEmailField]),
    );
    expect(mapping).toEqual({
      content_media_confirm: null,
      content_media_url: null,
      content_presence: null,
      content_publish: null,
      grant_by_hand: "email",
      grant_revoke: null,
      list_acts: null,
      list_environment: null,
      list_modules: null,
      media_upload: null,
      user_list: null,
      user_upsert: "email",
    });
  });

  it("refuses an unknown field on every tool", () => {
    for (const tool of ALL_SETUP_TOOLS) {
      const result = validateInput(tool.inputSchema, { thisIsNotAField: 1 });
      expect(result.ok, tool.name).toBe(false);
    }
  });

  // 🚨 The guard resolves a call by NAME and nothing else, so two modules
  // claiming one name would be two answers to one request.
  //
  // This cannot be caught in `loadModules()` the way a table or a command
  // clash is: those are declared in the manifest, and a tool's name lives
  // inside its TypeScript. So the guarantee is the prefix, asserted here
  // against the registry that actually ships — which also catches a module
  // borrowing a CORE tool's name, the case a prefix rule alone would miss if
  // somebody ever named a core tool after a module.
  it("gives every module tool its module's id as a prefix", () => {
    for (const entry of MODULE_SETUP_TOOLS) {
      for (const tool of entry.TOOLS) {
        expect(
          moduleToolNameProblem(entry.id, tool.name),
          `${entry.id} contributes "${tool.name}"`,
        ).toBeNull();
      }
    }
  });

  it("lets no module tool shadow a core one", () => {
    const core = new Set(CORE_SETUP_TOOLS.map((tool) => tool.name));
    for (const entry of MODULE_SETUP_TOOLS) {
      for (const tool of entry.TOOLS) {
        expect(core.has(tool.name), `${tool.name} is a core tool name`).toBe(false);
      }
    }
  });

  it("resolves every tool by name", () => {
    const map = toolsByName();
    for (const tool of ALL_SETUP_TOOLS) expect(map.get(tool.name)).toBe(tool);
    expect(map.get("no_such_tool")).toBeUndefined();
  });

  // Every tool is described well enough for an agent to choose on, whichever
  // half of the app it came from. Note what this does NOT assert: which
  // modules are installed. Pinning the empty profile here is the bug
  // CLAUDE.md names — "installing a module does not make your test suite red,
  // and if it ever does that is a bug in the test" — and five assertions in
  // this repo already made a customer who followed the instructions look at a
  // red suite.
  it("describes every tool, core and module alike", () => {
    for (const tool of describeTools()) {
      expect(tool.description.length, tool.name).toBeGreaterThan(20);
      expect(tool.inputSchema.type, tool.name).toBe("object");
      // 🚨 It TRAVELS. An operator reading a blank `subject_member_id` can only
      // tell "found nobody" from "never about a person" if the surface says
      // which tools can name one — and this description is what the MCP server
      // and `list_environment` hand back.
      expect(
        tool.subjectEmailField === null || typeof tool.subjectEmailField === "string",
        `${tool.name} is described without its member declaration`,
      ).toBe(true);
    }
  });

  it("marks the read tools as reads and the writes as writes", () => {
    const byName = toolsByName();
    expect(byName.get("list_modules")?.mutates).toBe(false);
    expect(byName.get("list_environment")?.mutates).toBe(false);
    expect(byName.get("user_list")?.mutates).toBe(false);
    expect(byName.get("user_upsert")?.mutates).toBe(true);
    expect(byName.get("grant_by_hand")?.mutates).toBe(true);
    expect(byName.get("grant_revoke")?.mutates).toBe(true);
  });

  // The surface is small on purpose, and the list is the design. A tool added
  // without a thought about SECURITY.md §8 trips this and has to say so.
  // 🚨 The CORE surface is small on purpose, and this list is the design: a
  // tool added without a thought about SECURITY.md §8 trips it and has to say
  // so. Deliberately `CORE_SETUP_TOOLS` and not `ALL_SETUP_TOOLS` — what a
  // MODULE contributes is that module's decision, and asserting it here would
  // turn installing one into a red suite.
  // The ninth was a decision, and this is where it was stated: `list_acts`
  // exists because SECURITY.md §7 claims the trail has two readers — the page
  // and the terminal — and `setup-check --live` printed a heading with nothing
  // under it. A control that is claimed and not built is worse than one that is
  // absent, because somebody stops looking for it.
  //
  // The TENTH is `content_publish`, and the decision it took is this. Content
  // reaches an environment through `content-apply`, which needs that
  // environment's `DATABASE_URL` in somebody's shell — the one thing this whole
  // surface exists to remove. `content_presence` already answers "does this
  // environment hold what it should" without one; publishing is the other half
  // of the same question, and it is a TOOL rather than a shell with a production
  // connection string for the same reason every other one here is: the tool runs
  // where the rows are, through the app's own code, and leaves an audit row.
  //
  // 🚨 What it did NOT relax: SECURITY.md §8 still refuses a SQL tool and a
  // schema tool, and this is not one wearing a name. Its input schema is EMPTY —
  // it cannot be pointed at a table, a statement or a file. What gets published
  // is what the repo declares, read by the appliers the app already ships, and
  // the plan branch runs every one of them inside a Postgres read-only
  // transaction (`lib/content/applier-plan.ts`). A tool that took so much as a
  // slug would be the beginning of the general-purpose one that makes every
  // other control here decoration.
  // The ELEVENTH and TWELFTH are `content_media_url` and `content_media_confirm`,
  // and each took its own decision.
  //
  // What they are for: a lesson video is declared in `content/media-manifest.json`
  // and staged in `.data/content-media/`, which is on the operator's machine and
  // in no image. `content_publish` therefore cannot carry it — so without these
  // two, publishing a course with large media still ends with somebody holding
  // `MEDIA_S3_*_PROD` in their own `.env`, which is the one thing this whole
  // epic exists to remove.
  //
  // 🚨 Why NOT `media_upload` with a key, which is the obvious shape: it cannot
  // be built. `acceptUpload()` DERIVES the key through `storageKey()`, which
  // THROWS on the reserved `content` namespace; an applier resolves media
  // through `keyFor(path)`, so an object anywhere else is invisible to every
  // lesson referencing it; `lib/content/writers.test.ts` fails the build on any
  // upload door that hands a `storageKey:`; and the multipart door buffers the
  // whole part against a 50 MB route ceiling, which a lesson recording does not
  // fit through. Four measurements, not an opinion.
  //
  // Why MINTING is a tool of its own: it hands out a writable capability and
  // writes nothing. Its audit row is where a capability was handed out, and it
  // is the act an operator would want to see on its own — `rows: 0`, `target`
  // the manifest path.
  //
  // Why CONFIRMING is not folded into it: they are two acts by the caller,
  // minutes apart with a large upload between them, and the second one WRITES a
  // row. Folded together the trail would carry one row for two acts, and the
  // apply half could not be re-run after a failed upload without minting a
  // second address. NFR-58 says one row per ACT, not one per file — which is why
  // this pair is two rows where `content_publish` is deliberately one.
  //
  // 🚨 What neither relaxed: SECURITY.md §8 still refuses a general-purpose
  // tool. Their only field is a `path`, and a path the manifest does not declare
  // is refused — so the key space they can reach is the closed set the repo
  // declares, never one a caller names.
  it("is the twelve core tools this epic shipped — a thirteenth is a decision", () => {
    expect(CORE_SETUP_TOOLS.map((tool) => tool.name).sort()).toEqual([
      "content_media_confirm",
      "content_media_url",
      "content_presence",
      "content_publish",
      "grant_by_hand",
      "grant_revoke",
      "list_acts",
      "list_environment",
      "list_modules",
      "media_upload",
      "user_list",
      "user_upsert",
    ]);
  });

  // AD-85 from the third side, and the one that matters most for these two: the
  // bytes of a lesson video never come near the model, and here that is a
  // STRONGER property than `media_upload`'s rather than a weaker one — neither
  // tool reads a local file at all, so `scripts/mcp/server.mjs` needs no branch
  // for them. That absence is asserted rather than assumed, below.
  it("gives the two content-media tools a path and nothing else", () => {
    const byName = toolsByName();
    for (const name of ["content_media_url", "content_media_confirm"]) {
      const tool = byName.get(name);
      expect(tool, name).toBeDefined();
      // One hands out a writable capability, the other writes a row.
      expect(tool?.mutates, `${name} must take a plan and a confirmation outside DEV`).toBe(true);
      // Neither destroys: the removal of a bad landing is the undoing of a
      // failed act, not something a caller can ask for.
      expect(tool?.destructive, name).toBeUndefined();
      expect(Object.keys(tool?.inputSchema.properties ?? {})).toEqual(["path"]);
      expect(tool?.inputSchema.required).toEqual(["path"]);
      expect(tool?.inputSchema.properties.path?.type).toBe("string");
      expect(tool?.inputSchema.additionalProperties).toBe(false);
    }
  });

  // Stated rather than left to the field-name sweep above, which iterates the
  // schema's PROPERTIES and would pass vacuously on a schema that has none —
  // the same shape as the media tool's assertion below, from the other side.
  // An input on this tool is how it starts becoming the general-purpose tool
  // SECURITY.md §8 refuses.
  it("gives content_publish nothing to point at", () => {
    const publish = toolsByName().get("content_publish");
    expect(publish?.mutates, "a mutates:false tool issues no confirmation token").toBe(true);
    expect(publish?.destructive).toBeUndefined();
    expect(Object.keys(publish?.inputSchema.properties ?? {})).toEqual([]);
    expect(publish?.inputSchema.required).toBeUndefined();
    expect(publish?.inputSchema.additionalProperties).toBe(false);
  });

  // AD-85 again, from the other side: the media tool takes a PATH. This is the
  // assertion that the surface advertises a path and not a payload — the
  // field-name sweep above would pass on a well-named base64 field too.
  it("takes a path for the media tool, not bytes", () => {
    const media = toolsByName().get("media_upload");
    expect(media?.inputSchema.required).toEqual(["path"]);
    expect(media?.inputSchema.properties.path?.type).toBe("string");
  });
});
