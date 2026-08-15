// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What a developer's coding agent may ask an environment to do on the
// community's behalf (docs/setup-mcp.md).
//
// ── Why this module needs any of it ────────────────────────────────────────
// `CLAUDE.md` states the problem in one line: **"Rooms are rows, and rows do
// not travel with a deploy — a group made on a laptop does not exist in PROD
// until somebody creates it there."** Before this, "somebody" meant a human
// clicking through the admin pages of every environment, or a shell holding a
// production connection string.
//
// ── What is deliberately NOT here ──────────────────────────────────────────
// 🚨 Nothing that reads a private conversation. `community_conversations` and
// `community_messages` have no unscoped reader anywhere in this application,
// and `dm-guard.test.ts` fails the build on any file outside a short allowlist
// that so much as NAMES them. This file is not on that allowlist and must never
// be added to it — a setup surface is exactly the kind of "just for support"
// door that argument exists to refuse.
//
// No member roster either, for the reason `docs/compliance.md` §1 gives:
// participation in a plan-gated room IS purchase information, and these
// products are routinely health-adjacent.
//
// No deletion. Rooms archive; that is the module's own design and this surface
// does not get a second opinion about it.

import { createGroup, listGroups, updateGroup } from "../lib/manage";
import { GROUP_ACCESS_LEVELS, type GroupAccessLevel } from "../lib/rules";
import type { ModuleSetupTools, SetupResult, SetupTool } from "@/lib/setup/types";

/**
 * The natural key is the room's NAME (AD-83).
 *
 * Groups carry no slug — `name` is what an operator states and what they see in
 * the admin list, so it is the only key a caller can hold. Matched
 * case-insensitively after trimming, because "Einsteiger" typed twice with
 * different spacing is one room to everybody except a database.
 */
const sameName = (a: string, b: string) =>
  a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();

const groupUpsert: SetupTool = {
  name: "community_group_upsert",
  description:
    "Create a community room, or update one with the same name. Repeating it is safe — the room's name is the key.",
  // 🚨 The room's NAME, because for this module that IS the natural key (AD-83)
  // — the same value `subjects` carries when the act gets that far, so a refused
  // upsert names the room a successful one would have named. Never
  // `description`: that is prose, and `target` is an identifier column.
  targetField: "name",
  // A room, not a person.
  subjectEmailField: null,
  mutates: true,
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", minLength: 1, maxLength: 120 },
      description: { type: "string", maxLength: 1000 },
      accessLevel: {
        type: "string",
        enum: [...GROUP_ACCESS_LEVELS],
        default: "open",
        description:
          "open = every member · plan = only holders of planKeys · moderators · operator",
      },
      planKeys: {
        type: "array",
        items: { type: "string", maxLength: 120 },
        description: 'Product Keys, for accessLevel "plan". Ignored otherwise.',
      },
    },
    required: ["name"],
    additionalProperties: false,
  },
  async run(context, input): Promise<SetupResult> {
    const name = String(input.name).trim();
    const existing = (await listGroups()).find((group) => sameName(group.name, name));

    // 🚨 **An UPSERT patches; it does not overwrite what the caller left out.**
    // `accessLevel` is optional and the schema carries `default: "open"`, so a
    // second call that only corrects the NAME used to send `accessLevel: "open"`
    // and `description: undefined` — and `updateGroup()` writes both
    // unconditionally. A room the agent had created as `plan` was therefore
    // opened to every member, and its description deleted, by a call that meant
    // to fix a typo. `checkedGroup()` then discards `planKeys` too, because they
    // only survive while the level is `plan`.
    //
    // ⚠️ The absent value and the empty one are different: `undefined` means
    // "leave it", `""`/`[]` mean "clear it". So the check is `=== undefined`,
    // never a falsy test.
    //
    // On CREATE the schema default is right and stays: a new room with no level
    // named is open.
    const accessLevel = (
      input.accessLevel === undefined && existing
        ? existing.accessLevel
        : String(input.accessLevel ?? "open")
    ) as GroupAccessLevel;
    const planKeys = Array.isArray(input.planKeys)
      ? (input.planKeys as string[])
      : input.planKeys === undefined && existing
        ? existing.planKeys
        : [];
    const description =
      input.description === undefined && existing ? existing.description : input.description;

    if (context.mode === "plan") {
      return {
        mode: "plan",
        created: existing ? 0 : 1,
        found: existing ? 1 : 0,
        changed: existing ? 1 : 0,
        subjects: [name],
        detail: existing
          ? `the room "${name}" exists and would be updated to ${accessLevel}` +
            // An archived room is invisible to every member. `listGroups()`
            // returns archived rooms on purpose, so an upsert can land on one —
            // and the answer used to say `updated` with nothing to tell the
            // agent why nobody can see it.
            (existing.archivedAt ? " — ⚠️ it is ARCHIVED, so no member sees it" : "")
          : `a room "${name}" would be created as ${accessLevel}`,
      };
    }

    // Both paths go through the module's own writers, which run `checkedGroup()`
    // — and that is where `groupPlanProblems()` validates the keys. It has to:
    // `hasPlan()` THROWS on a Product Key it does not know, so a room saved with
    // a typo would take the page down rather than mean "no access".
    const row = existing
      ? await updateGroup(existing.id, { name, description, accessLevel, planKeys })
      : await createGroup({ name, description, accessLevel, planKeys });

    return {
      mode: "apply",
      created: existing ? 0 : 1,
      found: existing ? 1 : 0,
      changed: existing ? 1 : 0,
      subjects: [name],
      detail:
        (existing ? `room "${name}" updated` : `room "${name}" created`) +
        (row.archivedAt ? " — ⚠️ it is ARCHIVED, so no member sees it" : ""),
      // `archived` travels because the read tool has it and this one did not:
      // an agent that upserts a room and is told `updated` has no way to learn
      // that nobody can see it. Whether an upsert should UN-archive is a
      // question about the module's design and is deliberately left alone here.
      data: {
        id: row.id,
        name: row.name,
        accessLevel: row.accessLevel,
        archived: row.archivedAt !== null,
      },
    };
  },
};

const groupList: SetupTool = {
  name: "community_group_list",
  description: "The community rooms this environment has, and how each is gated.",
  // A read of every room; there is no one room to name.
  targetField: null,
  subjectEmailField: null,
  mutates: false,
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  async run(context): Promise<SetupResult> {
    const groups = await listGroups();
    return {
      mode: context.mode,
      created: 0,
      found: groups.length,
      changed: 0,
      subjects: [],
      detail: `${groups.length} room(s) in ${context.appEnv}`,
      data: {
        groups: groups.map((group) => ({
          id: group.id,
          name: group.name,
          accessLevel: group.accessLevel,
          planKeys: group.planKeys,
          archived: group.archivedAt !== null,
          // ⚠️ Deliberately no member count and no roster. Presence in a
          // plan-gated room is purchase information; the module has no roster
          // by design, and this is not the back door to one.
          moderators: group.moderators.length,
        })),
      },
    };
  },
};

const tools: ModuleSetupTools = {
  id: "community",
  TOOLS: [groupUpsert, groupList],
};

export default tools;
