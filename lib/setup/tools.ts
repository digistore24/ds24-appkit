// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The core setup tools — deliberately few, each a thin caller of something that
// already exists. A tool that reimplements a rule is a tool that will disagree
// with the page doing the same thing.
//
// 🚨 What is NOT here is as much of the design as what is: there is no SQL tool,
// no schema tool, no member deletion and no reader of private messages. Each
// refusal is argued in the architecture spine's SECURITY.md §8, and adding one
// is a decision somebody takes deliberately rather than a gap somebody fills.

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { MODULE_GATES } from "@/lib/modules/gate-registry";
import { installedModules } from "@/lib/modules/installed";
import { grantByHand, revokeGrantByHand } from "@/lib/entitlements/manage";
import { createUser, listUsers } from "@/lib/users/manage";
import { acceptUpload } from "@/lib/media/manage";
import { guardUploadEntry } from "@/lib/media/upload-endpoint";
import { mediaStore } from "@/lib/media/store";
import { SNIFF_BYTES, agreedMime } from "@/lib/media/sniff";
import { CONTENT_MEDIA_MANIFEST } from "@/lib/content-media/rules.mjs";
// 🚨 **The one spelling of the content key**, and a STATIC import for the same
// reason `lib/content/publish.ts` takes it statically: `keyFor()` is
// `CONTENT_MEDIA_BUCKET_PREFIX + path`, it is what the CLI's own `mediaIdFor()`
// uses, and it is never `storageKey()` — which THROWS on the reserved `content`
// namespace, because the upload route's key space is the other half of that
// partition (`lib/media/rules.ts` → `RESERVED_MEDIA_NAMESPACES`).
// `lib/content/writers.test.ts` holds both ends.
import { keyFor, loadManifest } from "@/scripts/content/_manifest.mjs";
import type { MediaVisibility } from "@/lib/media/rules";
import { isRole } from "@/lib/roles";
import { mayAssignOwner } from "./rules";
import { describeTools } from "./registry";
import type { SetupContext, SetupResult, SetupTool } from "./types";

/** Everything a read tool answers with — nothing created, nothing changed. */
function read(context: SetupContext, detail: string, data: unknown): SetupResult {
  return { mode: context.mode, created: 0, found: 0, changed: 0, subjects: [], detail, data };
}

const listModules: SetupTool = {
  name: "list_modules",
  description:
    "What THIS environment is made of: which modules are installed, how each switch stands, and which setup tools they contribute.",
  // Nothing to name: the act is about this environment, not about a thing in
  // it. Declared rather than left out — see `SetupTool.targetField`.
  targetField: null,
  mutates: false,
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  async run(context) {
    // 🚨 Computed inside the running app, never read off a local tree. What is
    // installed on somebody's laptop is not what is deployed here, and the
    // whole reason this tool exists is to stop the two being confused.
    const installed = installedModules();
    const gates = new Map(MODULE_GATES.map((gate) => [gate.id, gate]));

    const modules = installed.map((id) => {
      const gate = gates.get(id);
      return {
        id,
        // The module's OWN reader answers this, so unlike `node run.mjs module
        // list` — which reads the switch file weakly and can only be certain
        // about "off" — both directions are certain here.
        //
        // Three states rather than a boolean, and reporting all three is the
        // point: "broken" is a config the operator is in the middle of getting
        // wrong, and it behaves as off. Collapsing it into `false` would hide
        // the one state somebody can fix.
        state: gate ? gate.state() : null,
        switchNote: gate ? null : "this module has no switch — installed is all there is",
      };
    });

    return read(
      context,
      `${modules.length} module(s) installed in ${context.appEnv}`,
      { appEnv: context.appEnv, modules },
    );
  },
};

const listEnvironment: SetupTool = {
  name: "list_environment",
  description: "Which environment this is, and what it is running.",
  // The environment is the subject, and `app_env` is already its own column.
  targetField: null,
  mutates: false,
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  async run(context) {
    return read(context, `this app is ${context.appEnv}`, {
      appEnv: context.appEnv,
      appName: process.env.NEXT_PUBLIC_APP_NAME ?? null,
      modules: installedModules(),
      // The MCP server builds its `tools/list` from this. It deliberately
      // carries no list of its own: what this environment offers is this
      // environment's answer, modules included.
      tools: describeTools(),
    });
  },
};

const userList: SetupTool = {
  name: "user_list",
  description: "Who exists in this environment, optionally filtered by role.",
  // ⚠️ Deliberately null although the schema HAS a field: `role` is a filter
  // over everybody, not the thing the act is about — and it already has its own
  // audit column. A target here would name a set as if it were a subject.
  targetField: null,
  mutates: false,
  inputSchema: {
    type: "object",
    properties: { role: { type: "string", enum: ["owner", "moderator", "member"] } },
    additionalProperties: false,
  },
  async run(context, input) {
    const role = typeof input.role === "string" ? input.role : null;
    const rows = (await listUsers()).filter((user) => !role || user.role === role);
    return read(context, `${rows.length} user(s)`, {
      users: rows.map((user) => ({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        blocked: user.blockedAt !== null,
        createdAt: user.createdAt.toISOString(),
      })),
    });
  },
};

const userUpsert: SetupTool = {
  name: "user_upsert",
  description:
    "Create a user, or set the role of an existing one, keyed by email. Repeating it is safe.",
  // The natural key this tool is keyed by, and what `subjects` carries when it
  // gets that far.
  targetField: "email",
  mutates: true,
  inputSchema: {
    type: "object",
    properties: {
      email: { type: "string", minLength: 3, maxLength: 320 },
      role: { type: "string", enum: ["owner", "moderator", "member"], default: "member" },
      name: { type: "string", maxLength: 200 },
    },
    required: ["email"],
    additionalProperties: false,
  },
  async run(context, input) {
    const email = String(input.email).trim().toLowerCase();
    const role = String(input.role ?? "member");
    if (!isRole(role)) throw new Error("role is not one of the canonical roles");

    // 🚨 AD-92. The shortest path from prompt-injected text to an account
    // takeover: the agent driving this reads what other people wrote, and a
    // tool that can write role='owner' turns any of it into an admin account.
    // The two-act protocol does NOT close this — an autonomous agent calls plan
    // and apply back to back — so the capability is removed instead.
    if (role === "owner" && !mayAssignOwner(context.appEnv)) {
      return {
        mode: context.mode,
        created: 0,
        found: 0,
        changed: 0,
        subjects: [email],
        detail:
          `refused: an operator is not made through this surface in ${context.appEnv}. ` +
          "Do it on /dashboard/admin/users, signed in as an owner.",
        data: { refused: "ownerPromotionRefused" },
      };
    }

    const [existing] = await db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (context.mode === "plan") {
      return {
        mode: "plan",
        created: existing ? 0 : 1,
        found: existing ? 1 : 0,
        changed: existing && existing.role !== role ? 1 : 0,
        subjects: [email],
        detail: existing
          ? `${email} exists as ${existing.role}${existing.role === role ? " — nothing would change" : ` and would become ${role}`}`
          : `${email} would be created as ${role}`,
      };
    }

    const row = await createUser(
      { id: context.ownerId, role: "owner" },
      { email, role, name: typeof input.name === "string" ? input.name : null },
    );

    return {
      mode: "apply",
      created: existing ? 0 : 1,
      found: existing ? 1 : 0,
      changed: existing && existing.role !== role ? 1 : 0,
      subjects: [email],
      detail: existing
        ? existing.role === role
          ? `${email} was already ${role} — nothing changed`
          : `${email} changed from ${existing.role} to ${role}`
        : `${email} created as ${role}`,
      data: { id: row.id, email: row.email, role: row.role },
    };
  },
};

const grantPlan: SetupTool = {
  name: "grant_by_hand",
  description:
    "Give a member a plan by hand, without a purchase. Needs a written reason — it goes on the record.",
  // The member, not the Product Key: a refused grant is a question about whose
  // access did not happen. (`productKey` travels in `detail` on the paths that
  // produce one.)
  targetField: "email",
  mutates: true,
  inputSchema: {
    type: "object",
    properties: {
      email: { type: "string", minLength: 3, maxLength: 320 },
      productKey: { type: "string", minLength: 1, maxLength: 120 },
      reason: { type: "string", minLength: 3, maxLength: 500 },
      accessUntil: { type: "string", maxLength: 10, description: "YYYY-MM-DD, or omit for no end" },
    },
    required: ["email", "productKey", "reason"],
    additionalProperties: false,
  },
  async run(context, input) {
    const email = String(input.email).trim().toLowerCase();
    const productKey = String(input.productKey);
    const [member] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (!member) {
      return {
        mode: context.mode,
        created: 0,
        found: 0,
        changed: 0,
        subjects: [email],
        detail: `refused: no member with the address ${email} in ${context.appEnv}`,
        data: { refused: "notFound" },
      };
    }

    if (context.mode === "plan") {
      return {
        mode: "plan",
        created: 1,
        found: 0,
        changed: 0,
        subjects: [email],
        detail: `${email} would be granted ${productKey}`,
      };
    }

    // The domain function already validates the reason and refuses a token
    // package — a balance is not an entitlement, and `hasPlan()` would answer
    // false for such a row for ever.
    await grantByHand({
      actor: { id: context.ownerId, role: "owner" },
      memberId: member.id,
      productKey,
      reason: input.reason,
      accessUntil: parseDay(input.accessUntil),
    });

    return {
      mode: "apply",
      created: 1,
      found: 0,
      changed: 0,
      subjects: [email],
      detail: `${email} granted ${productKey}`,
    };
  },
};

const grantRevoke: SetupTool = {
  name: "grant_revoke",
  description:
    "End a grant that was given by hand. IRREVERSIBLE. Needs a written reason. Purchased access cannot be ended here.",
  mutates: true,
  // Not `destructive`: it ends access rather than destroying rows, and the
  // grant row survives with an end date. The irreversibility is in the
  // description because that is what the agent reads before choosing.
  inputSchema: {
    type: "object",
    properties: {
      grantId: { type: "string", minLength: 1, maxLength: 64 },
      reason: { type: "string", minLength: 3, maxLength: 500 },
    },
    required: ["grantId", "reason"],
    additionalProperties: false,
  },
  // 🚨 The grant, never the `reason` — that is prose an operator wrote, it has
  // its own column and its own named exception in docs/data-protection.md, and
  // a sentence in `target` would put payload content in the identifier column.
  targetField: "grantId",
  async run(context, input) {
    const grantId = String(input.grantId);

    if (context.mode === "plan") {
      return {
        mode: "plan",
        created: 0,
        found: 1,
        changed: 1,
        subjects: [grantId],
        detail: `grant ${grantId} would be ended — this cannot be undone`,
      };
    }

    // ⚠️ `revokeGrantByHand()` takes only { actor, grantId } and writes the
    // constant REVOKED — it does NOT ask for a reason. So the TOOL asks, and
    // the answer lands in `setup_audit.reason`. Do not "simplify" the reason
    // away on the grounds that the domain function does not want it.
    await revokeGrantByHand({
      actor: { id: context.ownerId, role: "owner" },
      grantId,
    });

    return {
      mode: "apply",
      created: 0,
      found: 1,
      changed: 1,
      subjects: [grantId],
      detail: `grant ${grantId} ended`,
    };
  },
};

/** A bounded grant ends at the END of the chosen day, UTC — as the pages do. */
function parseDay(value: unknown): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return new Date(`${value}T23:59:59.999Z`);
}

const listActs: SetupTool = {
  name: "list_acts",
  description:
    "What the setup surface has done in this environment lately — who, which tool, which target, and how it ended.",
  // A read of the trail itself. `limit` is a page size, not a subject.
  targetField: null,
  mutates: false,
  inputSchema: {
    type: "object",
    properties: {
      limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
    },
    additionalProperties: false,
  },
  async run(context, input): Promise<SetupResult> {
    const { listActs: readActs } = await import("./manage");
    const rows = await readActs(Number(input.limit ?? 20));

    return {
      mode: context.mode,
      created: 0,
      found: rows.length,
      changed: 0,
      subjects: [],
      detail: `${rows.length} act(s) in ${context.appEnv}`,
      data: {
        // 🚨 The columns that travel are the columns the table holds —
        // identifiers and numbers. `reason` is deliberately NOT among them: it
        // is prose an operator wrote ABOUT a member, it belongs to that member
        // (it is in their Art. 15 export), and a convenience listing on a
        // terminal is not where it should turn up. Whoever needs it opens the
        // page, where the act it belongs to is in front of them.
        acts: rows.map((row) => ({
          at: row.createdAt.toISOString(),
          environment: row.appEnv,
          tool: row.tool,
          target: row.target,
          role: row.role,
          outcome: row.outcome,
          code: row.code,
          rows: row.rows,
          key: row.keyName,
        })),
      },
    };
  },
};

const contentPresence: SetupTool = {
  name: "content_presence",
  description:
    "Does this environment hold what it should? Each owner answers for its own rows — the core for product media and the appliers, every module for what it brought.",
  // The whole environment is the subject; there is no input and no one thing to
  // name. Its `subjects` are empty on the success path for the same reason.
  targetField: null,
  mutates: false,
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  async run(context): Promise<SetupResult> {
    const { collectPresence, presenceProblems } = await import("@/lib/content/presence");
    const reports = await collectPresence({ appEnv: context.appEnv });
    const problems = presenceProblems(reports);
    const unchecked = reports.reduce(
      (sum, report) => sum + report.items.filter((item) => item.notChecked).length,
      0,
    );

    return {
      mode: context.mode,
      created: 0,
      // What IS here, across every owner. The number an operator reads first.
      found: reports.reduce(
        (sum, report) => sum + report.items.reduce((n, item) => n + item.found, 0),
        0,
      ),
      changed: 0,
      subjects: [],
      // ⚠️ An item whose question was only half asked is named in this ONE
      // line too, not just in the reports below it. This detail is what the
      // audit row and an MCP client show, and "nothing missing" over a store
      // that never answered is the same false green `content-check` used to
      // print. It is not a problem and does not become one — it is a smaller
      // claim, said out loud.
      detail:
        (problems.length === 0
          ? `${reports.length} owner(s) answered, nothing missing`
          : `${problems.length} problem(s) across ${reports.length} owner(s)`) +
        (unchecked > 0 ? `; ${unchecked} thing(s) NOT checked` : ""),
      // 🚨 The reports travel whole, problems and all. An owner that could not
      // answer is in here with `unanswered` set, and the caller is expected to
      // treat that as a failure — "nothing to report" and "I could not look"
      // must never render the same.
      data: { appEnv: context.appEnv, reports, problems },
    };
  },
};

/**
 * What a finished publish answers with — numbers, labels and a next step.
 *
 * Kept beside the tool rather than inside `lib/content/publish.ts` because it is
 * the SURFACE's shape (`SetupResult`) and not the domain's: the writer reports
 * what it did, and this turns that into the one line and the four numbers every
 * tool on this surface answers with.
 */
function publishResult(
  context: SetupContext,
  report: Awaited<ReturnType<typeof import("@/lib/content/publish").publishContent>>,
): SetupResult {
  const ran = report.appliers.filter((applier) => applier.ran).length;
  const media = report.media;

  return {
    mode: "apply",
    created: report.created,
    changed: report.changed,
    // What already existed and was written over. `created + changed` is what
    // committed, and it is the number `dispatch.ts` puts in the audit row.
    found: report.changed,
    // 🚨 The applier LABELS, not the slugs — `dispatch.ts` takes `subjects[0]`
    // as the audit row's `target`, and one label is a useful target where one
    // slug out of forty is noise. The slugs never leave `lib/content/`.
    subjects: report.appliers.map((applier) => applier.label),
    // One line of numbers, the `cron_runs.lastDetail` idiom: how much of what,
    // never what was in it. No path anybody typed, no lesson title, no member.
    detail:
      `${ran} of ${report.appliers.length + report.unreached.length} applier(s) ran; ` +
      `${report.rows} row(s)` +
      (media
        ? `; ${media.rowsCreated + media.rowsChanged} media row(s) asserted; ` +
          `${media.copied} file(s) copied, ${media.present} already there`
        : "; no product media declared here") +
      // ⚠️ Never a bare "Done". A run that gave up after three of forty and said
      // "3 applied" is a true number in a sentence that is a lie.
      (report.unreached.length > 0
        ? `; STOPPED — ${report.unreached.length} applier(s) never reached: ` +
          report.unreached.join(", ")
        : "") +
      (report.partial ? "; PARTIAL — what is above is committed, the rest is not" : "") +
      (report.problems.length > 0 ? `; ${report.problems.length} problem(s)` : ""),
    // The fourth audit state, from the one column that can carry it without a
    // migration. `applied` with a plausible number is how a half publish comes
    // to read as a whole one.
    ...(report.partial ? { code: "contentPublishPartial" } : {}),
    data: {
      ...report,
      // 🚨 Named with the environment filled in, not left as a placeholder — and
      // with its limit in the same breath, the sentence `docs/content.md` and
      // `scripts/content/check.mjs` already carry.
      nextStep: `node run.mjs content-check --env ${context.appEnv}`,
      nextStepMeans:
        "green there means the rows and the files are PRESENT in this environment — " +
        "not that the page renders. That is your eyes, on one real content page with a real slug.",
    },
  };
}

const contentPublish: SetupTool = {
  name: "content_publish",
  description:
    "Publish this repo's content into this environment through the appliers. In mode plan it reports exactly what each applier would create and change and what the media store is missing, and writes nothing; in mode apply it asserts the media rows, copies the files the image carries and runs every applier, each in its own transaction.",
  // 🚨 `mutates: true`, and the reason is mechanical rather than aspirational.
  // `guard.ts` asks `needsConfirmation(appEnv, tool.mutates)` and `rules.ts`
  // answers `mutates && !isDev(env)` — so a READ tool (`mutates: false`) issues
  // no confirmation token and demands none. A separate read-only "content_plan"
  // could therefore never hand the apply half anything, and the apply half would
  // have to plan for itself: the second enumeration this whole area exists to
  // prevent. One tool, two modes.
  //
  // Not `destructive`: it creates and re-asserts rows the repo declares, and it
  // deletes nothing. A plan writes nothing at all, so it is not destructive in
  // `config/setup.json`'s sense either — this story adds no key and no switch.
  mutates: true,
  // Empty on purpose, like `content_presence`. What gets published is what the
  // repo declares; nothing about it is a tool argument. It also keeps this tool
  // clear of `registry.test.ts`'s field-name sweep, which reads the schema's
  // PROPERTY names and never the tool's own name — so `content_publish` is fine
  // and a field called `content` would not be.
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  // 🚨 Null, and this tool is the reason the declaration is required rather than
  // guessed at. It takes no input at all — what gets published is what the repo
  // declares — so there is nothing an input could name, and a refusal before the
  // first applier ran is honestly about the whole publish. Its `subjects` are
  // the applier LABELS, which exist only once something has run: that is why an
  // empty target here is an answer and not a loss.
  targetField: null,
  async run(context): Promise<SetupResult> {
    // 🚨 The apply branch is a THIN CALLER of `lib/content/publish.ts`, and it
    // lives there rather than here for a mechanical reason: this file is the
    // first entry on `lib/content/writers.test.ts`'s list of upload doors, and
    // every door on that list is held to `not.toMatch(/storageKey\s*:/)`. A
    // media row insert spells exactly that, and the failure would arrive as a
    // message about path traversal. The writer is also the applier ROUTE's, not
    // an upload door — the other half of a partitioned table.
    if (context.mode === "apply") {
      const { publishContent } = await import("@/lib/content/publish");
      return publishResult(context, await publishContent({ appEnv: context.appEnv }));
    }

    const { applierPlans } = await import("@/lib/content/applier-plan");
    const { productMediaPresence } = await import("@/lib/content/presence");

    // 🚨 Only the ENUMERATION is caught here, and it becomes a refusal carrying
    // the enumerator's own sentence. `applierSources()` throws on a directory it
    // cannot read (`ENOENT` included — that is the not-in-the-built-output case)
    // and on a module declaring `appliers` with no `.mjs` in it. Answering
    // "0 applier(s) would run" for either would be this tool's worst available
    // bug: "I could not look" and "there is nothing there" stay different
    // answers. Everything a single applier does wrong is that applier's own
    // entry and never reaches here.
    let appliers;
    try {
      appliers = await applierPlans();
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      const detail = `refused: could not enumerate this app's appliers — ${why}`;
      return {
        mode: "plan",
        created: 0,
        found: 0,
        changed: 0,
        subjects: [],
        detail,
        data: { refused: "appliersUnreadable", detail, appEnv: context.appEnv },
      };
    }

    // The media half is `productMediaPresence()` and nothing else — one reader
    // of `content/media-manifest.json`, in `lib/content/presence.ts`. It selects
    // and never writes, and its three states travel unchanged: a manifest naming
    // seven files and holding five names the two missing paths, no manifest at
    // all is `expected: null` with a note, and a manifest that cannot be read
    // THROWS — which is a problem here, never an item.
    const problems: string[] = [];
    let media = null;
    try {
      media = await productMediaPresence();
      if (media.missing && media.missing.length > 0) {
        problems.push(`product media — missing ${media.missing.join(", ")}`);
      }
    } catch (error) {
      problems.push(
        `product media: could not look — ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    for (const applier of appliers) {
      for (const problem of applier.problems ?? []) problems.push(problem);
    }

    const answered = appliers.filter((applier) => applier.answered);
    const silent = appliers.length - answered.length;
    const created = answered.reduce((sum, applier) => sum + (applier.created ?? 0), 0);
    const changed = answered.reduce((sum, applier) => sum + (applier.reasserted ?? 0), 0);

    return {
      mode: "plan",
      created,
      changed,
      // What already exists: for an applier exactly the rows it would RE-ASSERT,
      // plus whatever the media store already holds. `content_presence` is the
      // tool that answers "what is in this environment" in full, and asking its
      // question a second time here would be a second number for one fact.
      found: changed + (media?.found ?? 0),
      // 🚨 The applier LABELS, not the slugs. `dispatch.ts` takes `subjects[0]`
      // as the audit row's `target`, and one label is a useful target where one
      // slug out of forty is noise. The slugs are in `data`, per applier.
      subjects: appliers.map((applier) => applier.label),
      detail:
        `${answered.length} of ${appliers.length} applier(s) answered` +
        (silent > 0 ? `, ${silent} could not say` : "") +
        `; ${created} row(s) would be created, ${changed} re-asserted` +
        // ⚠️ `expected: null` gets a SENTENCE, never "0 of null" or "0 of ?".
        // It is the legitimate "no manifest here" state, and a formatting
        // artefact in the one line an operator reads is how a state becomes a
        // question about the tool.
        (media
          ? media.expected === null
            ? "; no product media declared here"
            : `; product media ${media.found} of ${media.expected}` +
              // The same refusal to tick for an unasked question. `media.found`
              // counts a declared file whose object the store never answered
              // for, so the count on its own would read as a plan that has
              // looked at the bytes when it has not.
              (media.notChecked ? ` (${media.notChecked})` : "")
          : "") +
        (problems.length > 0 ? `; ${problems.length} problem(s)` : ""),
      data: { appEnv: context.appEnv, appliers, media, problems },
    };
  },
};

const mediaUpload: SetupTool = {
  name: "media_upload",
  description:
    "Put a local file into this environment's media store. Give the path on your machine; the file is read here and never travels through the model.",
  // The path the operator named. It is an identifier of the act, never opened as
  // a filesystem path here (`SetupContext.file` carries the bytes) — and it is
  // exactly what a refused upload has to say: WHICH file did not land.
  targetField: "path",
  mutates: true,
  inputSchema: {
    type: "object",
    properties: {
      // 🚨 A PATH, and never the bytes. The MCP server reads the file and posts
      // it; a base64 field would put a video through the model's context, the
      // transcript and the bill — and `registry.test.ts` fails the build on any
      // field name that invites one.
      path: { type: "string", minLength: 1, maxLength: 1024 },
      visibility: {
        type: "string",
        enum: ["public", "owner", "entitled", "members"],
        default: "public",
      },
      // Required by `acceptUpload()` when the visibility is `entitled` — this is
      // a file somebody paid for, and the key is validated there because
      // `hasPlan()` throws on one it does not know.
      requiresPlan: { type: "string", maxLength: 120 },
      // Not derived from anything, and required for a picture: alternative text
      // is a sentence for a person, and a filename is not one.
      alt: { type: "string", maxLength: 500 },
    },
    required: ["path"],
    additionalProperties: false,
  },
  async run(context, input) {
    const path = String(input.path);

    // Reached through the JSON-RPC door, which carries no bytes. Not an error
    // in the tool — the agent asked the right thing at the wrong window.
    if (!context.file) {
      return {
        mode: context.mode,
        created: 0,
        found: 0,
        changed: 0,
        subjects: [path],
        detail:
          "refused: a file has to be uploaded to /api/setup/media, not /api/setup. " +
          "The MCP server does this for you — call the tool through it.",
        data: { refused: "badRequest" },
      };
    }

    const { bytes, filename, claimedMime } = context.file;

    if (context.mode === "plan") {
      return {
        mode: "plan",
        created: 1,
        found: 0,
        changed: 0,
        subjects: [path],
        detail: `${filename ?? path} (${bytes.length} bytes) would be stored as ${String(input.visibility ?? "public")}`,
      };
    }

    // Both halves of the door, in this order. `guardUploadEntry()` is the outer
    // one — is media on, is the store usable, has this account had its share —
    // and a door that calls only `acceptUpload()` is an upload path with no
    // rate limit and a kill switch that does nothing. This template has shipped
    // that bug once already.
    guardUploadEntry(context.ownerId);

    const row = await acceptUpload({
      ownerId: context.ownerId,
      role: "owner",
      // The setup surface's own slot. `core` because this is the core's third
      // delivery layer and not a module's, `setup` because "an operator's agent
      // put this here over the setup API" is exactly what somebody reading the
      // bucket wants to know — it is the one door with no human at it.
      namespace: "core",
      category: "setup",
      bytes,
      claimedMime,
      filename,
      visibility: input.visibility as MediaVisibility | undefined,
      requiresPlan: typeof input.requiresPlan === "string" ? input.requiresPlan : null,
      alt: typeof input.alt === "string" ? input.alt : null,
    });

    return {
      mode: "apply",
      created: 1,
      found: 0,
      changed: 0,
      subjects: [path],
      detail: `stored ${bytes.length} bytes as ${row.kind}`,
      data: { id: row.id, kind: row.kind, visibility: row.visibility },
    };
  },
};

// ── The staged leg: bytes straight from the operator's machine to the bucket ─
//
// 🚨 **Why this is not `media_upload` with a key parameter**, which is what the
// obvious reading of the epic asks for. Four mechanical facts, each of which
// settles it on its own:
//
//   · `media_upload` calls `acceptUpload()`, whose key is DERIVED by
//     `storageKey()` — `core/setup/<YYYY>/<MM>/<uuid>.<ext>`. It is not a
//     parameter and cannot become one.
//   · `content` is a RESERVED namespace: `storageKey()` throws on it
//     (`lib/media/rules.ts` → `RESERVED_MEDIA_NAMESPACES`). An upload cannot
//     land on the applier route's prefix at all, by construction.
//   · an applier resolves media through `mediaIdFor(path)` → `keyFor(path)` →
//     `content/<path>`. A file at `core/setup/…` is invisible to every lesson
//     that references it.
//   · `lib/content/writers.test.ts` fails the build on any upload door that
//     matches `/storageKey\s*:/` — widening `media_upload` with a key parameter
//     is refused by an assertion rather than by an opinion.
//
// And a fifth, about size, which is this pair's own subject: `/api/setup/media`
// reads the whole part into memory (`new Uint8Array(await part.arrayBuffer())`)
// and a route handler of this app buffers at most `routeCeilingBytes()` — 50 MB.
// The file these two exist for is a lesson recording. It does not fit through a
// door that buffers.
//
// So the bytes take the path Story 8.1 already built for exactly this ceiling:
// the store mints a short-lived address, the operator's machine writes to the
// bucket, and the app reads back what landed. What the epic's criterion MEANT is
// kept whole — no `MEDIA_S3_*_PROD` on the operator's laptop, and not one byte
// through the model's context, the transcript or the bill.
//
// ⚠️ **No `pending/` staging copy here, and that is a decision rather than an
// omission.** The member-facing direct path writes to a staging key and copies
// server-side, because a presigned PUT is bounded by time and not by uses — so
// somebody could confirm a small file and then push a gigabyte onto the same
// address. Here the caller is an OWNER holding that environment's `SETUP_KEY`,
// writing the deterministic key of a file they declared in their own manifest:
// the capability a replay would buy is one they already hold outright. A staging
// copy would double the transfer of a nine-hundred-megabyte video to defend
// against its own operator. What replaces it is narrower and cheaper — a short
// window, `head()` verifying the length at confirm time, and the object REMOVED
// when it disagrees. `pending` stays a reserved namespace and nothing here goes
// near it.

/**
 * How long a content-media upload address stays valid, in seconds.
 *
 * An hour, and both halves of that are deliberate. Long enough: the file this
 * exists for is a lesson recording on somebody's domestic uplink, where a
 * few hundred megabytes is genuinely a long upload and an address that expires
 * mid-transfer costs the whole transfer. Short enough: an address is bounded by
 * TIME and not by uses — nothing in a presigned PUT limits how often or how much
 * is written — so the window is the only thing that ends the capability, and one
 * that lives for a day is one that can be handed on.
 *
 * The same hour `UPLOAD_TICKET_SECONDS` gives the member-facing path, for the
 * same measurement; it is spelled separately because the two paths' reasons for
 * it are not identical (that one also has a sweep behind it, this one does not).
 */
export const CONTENT_UPLOAD_URL_TTL = 60 * 60;

/** Throw a refusal `dispatch.ts` records as `refused` with the code and no rows. */
type Refuse = (code: string, message: string) => never;

interface DeclaredEntry {
  path: string;
  key: string;
  kind: string;
  contentType: string;
  visibility: string;
  requiresPlan: string | null;
  alt: string | null;
  filename: string;
  bytes: number;
  sha256: string;
}

/**
 * The manifest entry this act is about — or a refusal naming why it is not one.
 *
 * 🚨 **A path the manifest does not declare is refused.** These two tools mint
 * an address for, and assert a row about, DECLARED product media and nothing
 * else. Without this the first argument is a key space: `path` reaches
 * `keyFor()`, and a caller who could name any path could write anywhere under
 * the applier route's own prefix. The manifest is the closed set, judged by the
 * one reader of it (`scripts/content/_manifest.mjs`), which also means the
 * grammar refusal (`../`, a second folder level, an extension nothing serves)
 * is the same one every content command already makes.
 */
function declaredEntry(path: string, refuse: Refuse): DeclaredEntry {
  const manifest = loadManifest(process.cwd()) as
    | { missing: true }
    | { entries: DeclaredEntry[]; problems: string[] };

  if ("missing" in manifest) {
    refuse(
      "contentManifestMissing",
      `this app declares no ${CONTENT_MEDIA_MANIFEST}, so there is no product media to ` +
        `place. Declare the file there first (docs/content.md)`,
    );
  }
  if (manifest.problems.length > 0) {
    refuse(
      "contentManifestInvalid",
      `${CONTENT_MEDIA_MANIFEST} does not judge, so nothing was placed — ` +
        `${manifest.problems.join("; ")}`,
    );
  }

  const entry = manifest.entries.find((candidate) => candidate.path === path);
  if (!entry) {
    refuse(
      "contentMediaUndeclared",
      `"${path}" is not declared in ${CONTENT_MEDIA_MANIFEST}. This tool places declared ` +
        `product media and nothing else — an undeclared path would be an object under the ` +
        `applier route's own key prefix that no manifest names, and content-check would then ` +
        `report a file as present that nothing declares`,
    );
  }

  // ⚠️ Both numbers, or nothing. `content-media-sync --apply` records them into
  // the manifest for exactly this: the app never holds the staged file, so the
  // length it checks and the hash it writes are the operator's own recorded
  // claim about their own file. An entry without them can only be an honest row
  // where the IMAGE carries the bytes, which is `content_publish`'s step B.
  if (!Number.isInteger(entry.bytes) || entry.bytes <= 0 || typeof entry.sha256 !== "string") {
    refuse(
      "contentMediaUnrecorded",
      `${CONTENT_MEDIA_MANIFEST} records no sha256/bytes for "${path}". Stage the file under ` +
        `.data/content-media/ and run node run.mjs content-media-sync --apply first — that is ` +
        `what records both, and without them nothing here can check what landed`,
    );
  }

  return entry;
}

const contentMediaUrl: SetupTool = {
  name: "content_media_url",
  description:
    "Mint a short-lived address for writing one file declared in content/media-manifest.json straight into this environment's media store, at its deterministic content key. Answers found instead when the object is already there with the declared length, and says so by name when this environment's media driver cannot mint one.",
  // The manifest path — the same identifier `docs/setup-mcp.md` promises this
  // pair's rows carry, now on the refusal paths too. Every one of
  // `declaredEntry()`'s four refusals is about this one file.
  targetField: "path",
  // One hand-out of a writable capability is a mutation, whatever it writes
  // itself: outside DEV it therefore takes a plan and a confirmation, like
  // every other act that changes what an environment holds.
  mutates: true,
  // Not `destructive`: it creates nothing and removes nothing. The object it
  // makes room for is a file the manifest already declares.
  inputSchema: {
    type: "object",
    // 🚨 One field, and it is a PATH out of the manifest — never bytes.
    // `registry.test.ts` fails the build on a field named `content`, `data`,
    // `bytes`, `blob` or `base64`, and the reason is AD-85: a payload field is
    // how a lesson video ends up in the model's context and on the operator's
    // bill.
    properties: { path: { type: "string", minLength: 1, maxLength: 1024 } },
    required: ["path"],
    additionalProperties: false,
  },
  async run(context, input): Promise<SetupResult> {
    const path = String(input.path);
    const { PublishError } = await import("@/lib/content/publish");
    const refuse: Refuse = (code, message) => {
      throw new PublishError(code, message);
    };

    const entry = declaredEntry(path, refuse);
    const key = keyFor(path);
    const store = mediaStore();

    // ── ① it is already there, with the length the manifest declares ────────
    // The `store-sync.mjs` property, and the epic's third criterion: what is
    // already there is skipped, so running the flow twice is the same as
    // running it once. HEAD first, always — a re-run of a course with nine
    // hundred megabytes of video must cost nine hundred megabytes once.
    const head = await store.head(key);
    if (head && head.bytes === entry.bytes) {
      return {
        mode: context.mode,
        created: 0,
        found: 1,
        changed: 0,
        subjects: [path],
        detail: `${path} is already in this environment's store (${head.bytes} bytes); nothing minted`,
        data: { path, key, found: true, upload: null, bytes: head.bytes },
      };
    }

    const disagreement =
      head === null
        ? null
        : `it is there with ${head.bytes} byte(s) and ${CONTENT_MEDIA_MANIFEST} declares ` +
          `${entry.bytes} — the address overwrites it`;

    if (context.mode === "plan") {
      return {
        mode: "plan",
        created: 0,
        found: 0,
        changed: 0,
        subjects: [path],
        detail:
          `${path} would be given an upload address` + (disagreement ? `; ${disagreement}` : ""),
        data: { path, key, found: false, upload: null, bytes: entry.bytes, disagreement },
      };
    }

    // ── ② the store can mint ────────────────────────────────────────────────
    const url = store.createUploadUrl(key, CONTENT_UPLOAD_URL_TTL);

    // ── ③ it cannot, and that is an ANSWER rather than a failure ────────────
    // `createLocalStore().createUploadUrl()` returns null deliberately: on that
    // driver there IS no address anything but the app can reach, and DEV
    // routinely runs it. 🚨 Never an empty answer that reads like "nothing to
    // do" — the caller is told which two ways out there are, by name.
    if (!url) {
      const reason =
        `this environment's media driver cannot mint an upload address (MEDIA_DRIVER is ` +
        `local, and on that driver there is no address a client can reach that is not the ` +
        `app). Two ways on: if this app is DEV on your own machine, fill its store with ` +
        `node run.mjs content-media-sync --apply; otherwise give it an S3 driver ` +
        `(docs/visuals.md)`;
      return {
        mode: "apply",
        created: 0,
        found: 0,
        changed: 0,
        subjects: [path],
        detail: `no address for ${path}: ${reason}`,
        data: { path, key, found: false, upload: null, reason },
      };
    }

    const expiresAt = new Date(Date.now() + CONTENT_UPLOAD_URL_TTL * 1000);
    return {
      mode: "apply",
      // Nothing was created — a capability was handed out. `rows` in the audit
      // is `created + changed`, and this act writes no row at all.
      created: 0,
      found: 0,
      changed: 0,
      subjects: [path],
      // ⚠️ One line of numbers, and never the address: this is what an operator
      // reads back, and a signed URL in a transcript is a writable capability in
      // a transcript.
      detail:
        `an address for ${path} (${entry.bytes} bytes, ${CONTENT_UPLOAD_URL_TTL}s)` +
        (disagreement ? `; ${disagreement}` : ""),
      data: {
        path,
        key,
        found: false,
        upload: { url, expiresAt: expiresAt.toISOString(), bytes: entry.bytes },
      },
    };
  },
};

const contentMediaConfirm: SetupTool = {
  name: "content_media_confirm",
  description:
    "Read back what landed at one declared file's content key — is it there, is it the length the manifest declares, and are its first bytes the kind its extension implies — then assert that file's media row. Removes the object and asserts nothing when any of the three disagrees.",
  // 🚨 The tool A53 was found on: `contentMediaLengthMismatch` said the length
  // disagreed and not which of forty files it was, because a thrown refusal
  // reaches `dispatch.ts` without a result. This is where that row gets its
  // name back.
  targetField: "path",
  mutates: true,
  inputSchema: {
    type: "object",
    properties: { path: { type: "string", minLength: 1, maxLength: 1024 } },
    required: ["path"],
    additionalProperties: false,
  },
  async run(context, input): Promise<SetupResult> {
    const path = String(input.path);
    const { PublishError, assertContentMediaRow } = await import("@/lib/content/publish");
    const refuse: Refuse = (code, message) => {
      throw new PublishError(code, message);
    };

    const entry = declaredEntry(path, refuse);
    const key = keyFor(path);
    const store = mediaStore();

    /**
     * Undo a bad landing.
     *
     * 🚨 **An object of the wrong length or the wrong kind under a
     * DETERMINISTIC key is worse than no object at all**: the next
     * `content-check` HEADs that key, finds something, and reports the file as
     * present. So it goes, and the refusal says so.
     *
     * ⚠️ It runs in `plan` mode too, and that is deliberate. A plan of this tool
     * is not a report about the future — it is the first half of a two-act
     * confirm, and by the time it has looked, the bad object already exists. A
     * plan that noticed and left it would be the one path in this pair that
     * makes `content-check` lie. (`content_publish`'s "a plan writes nothing" is
     * that tool's claim about ITS appliers, in a read-only transaction; this is
     * a different act.)
     */
    const discard = async (): Promise<void> => {
      try {
        await store.remove(key);
      } catch (error) {
        console.error("[setup] could not remove a refused content upload:", error);
      }
    };

    // ── 1. is it there, and is it the length the manifest declares ──────────
    const head = await store.head(key);
    if (!head) {
      // Never a row for bytes that do not exist. Nothing is removed here —
      // there is nothing to remove, and a PUT may still be in flight.
      refuse(
        "contentMediaMissing",
        `nothing landed at ${key}. Mint an address with content_media_url and write the file ` +
          `to it before confirming; no row was asserted`,
      );
    }
    if (head.bytes !== entry.bytes) {
      await discard();
      refuse(
        "contentMediaLengthMismatch",
        `${key} holds ${head.bytes} byte(s); ${CONTENT_MEDIA_MANIFEST} declares ` +
          `${entry.bytes}. The object was REMOVED — an object of the wrong length under a ` +
          `deterministic key would be reported as present by content-check — and no row was ` +
          `asserted. Upload it again`,
      );
    }

    // ── 2. are its first bytes the kind its extension implies ───────────────
    // `firstBytes()` and never `getBytes()`: what a file IS comes from sixteen
    // bytes, and reading two gigabytes back into the process to learn it would
    // give away everything the direct address just bought.
    const first = await store.firstBytes(key, SNIFF_BYTES);
    if (!first || first.length === 0) {
      refuse(
        "contentMediaMissing",
        `${key} answered its length but no bytes. Nothing was removed and no row was ` +
          `asserted; try the upload again`,
      );
    }
    const mime = agreedMime(first, entry.contentType);
    if (!mime) {
      await discard();
      refuse(
        "contentMediaTypeMismatch",
        `the bytes at ${key} are not ${entry.contentType}, which is what the extension in ` +
          `"${path}" implies. The object was REMOVED and no row was asserted — the same footing ` +
          `the member-facing confirm step keeps, because a name is not evidence`,
      );
    }

    // ⚠️ **The sha256 of what landed is NOT verified, and nothing here may
    // imply it was.** That would mean reading the object back — the whole cost
    // this path exists to avoid. The recorded hash is the operator's own claim
    // about their own file, computed by `content-media-sync` on their machine,
    // and it is the same claim `content-apply` already writes for exactly these
    // entries. What IS checked is above: the length, and the kind.
    if (context.mode === "plan") {
      return {
        mode: "plan",
        created: 1,
        found: 0,
        changed: 0,
        subjects: [path],
        detail: `${key} holds ${head.bytes} byte(s) of ${mime}; a media row would be asserted`,
        data: { path, key, bytes: head.bytes, mime, verified: ["bytes", "kind"] },
      };
    }

    // ── 3. the row ──────────────────────────────────────────────────────────
    // 🚨 Written by `lib/content/publish.ts` and not here: this file is the
    // first entry on `lib/content/writers.test.ts`'s list of upload DOORS, and
    // every door on it is held to `not.toMatch(/storageKey\s*:/)` — which a
    // media row insert spells exactly. It is also the applier ROUTE's row, not
    // an upload door's: the other half of a partitioned table.
    const { created } = await assertContentMediaRow(entry);

    return {
      mode: "apply",
      created: created ? 1 : 0,
      found: 0,
      changed: created ? 0 : 1,
      subjects: [path],
      detail:
        `${path} — ${head.bytes} byte(s) of ${mime}; media row ` +
        `${created ? "created" : "re-asserted"} (${entry.visibility}` +
        `${entry.requiresPlan ? `, plan ${entry.requiresPlan}` : ""})`,
      data: {
        path,
        key,
        bytes: head.bytes,
        mime,
        created,
        // Said as a list rather than as a word, so nobody reads "confirmed" as
        // "the hash was checked". It was not — see above.
        verified: ["bytes", "kind"],
        trusted: ["sha256"],
      },
    };
  },
};

export const CORE_SETUP_TOOLS: readonly SetupTool[] = [
  listModules,
  listEnvironment,
  userList,
  userUpsert,
  grantPlan,
  grantRevoke,
  mediaUpload,
  contentPresence,
  listActs,
  // Last, so the order stays additive.
  contentPublish,
  contentMediaUrl,
  contentMediaConfirm,
];
