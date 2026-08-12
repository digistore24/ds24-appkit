// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The community — is it there at all.
//
// The same shape as `lib/api/config.ts`, for the same reason: one switch, a
// property of the PRODUCT. The community calls nothing outward, so there is no
// machine half and no environment variable — the only question is whether this
// app gives its members a place to meet. See `docs/community.md` (once Epic 24
// ships it) and the community skill.
//
// ── It ships OFF ───────────────────────────────────────────────────────────
// A community nobody decided to have is member data flowing where nobody
// decided it should. Turning it on is a decision the operator makes once, in
// this file, and the next deploy carries it — there is no runtime toggle, no
// admin setting and no environment override, by decision (FR-178): the off
// state is the module's security kill-switch, and a kill-switch with three
// owners is none. An unreadable config resolves to OFF: every parse problem
// falls towards "closed".
//
// ── The contract every community surface signs ─────────────────────────────
// EVERY community page, server action and route handler opens with this
// check, per request — never cached in a session, a JWT or a client. Hiding
// (the nav flag) is never guarding; the check here is the guard, and later
// stories are held to it. Disabled answers the framework's not-found for
// everyone, operator and admin surfaces included (AD-67 — groups are
// configured after switching on, and that is a decision, not a gap). Broken
// keeps exactly one door: the operator's diagnosis on
// `/dashboard/community`.
//
// ── Where it may be read ───────────────────────────────────────────────────
// Server components, Server Actions, route handlers — **and `proxy.ts`**, which
// is where the off-state is actually enforced: a `notFound()` thrown inside the
// page renders the dashboard-wrapped not-found, so the rewrite has to happen
// before the route is reached (the proxy's own comment carries the reasoning).
// Naming it here is not bookkeeping — a later story reading this list would
// otherwise get a contract that does not describe the code.
// NOT a client component: later stories add plan-carrying fields, and prices
// and Digistore24 product ids have no business in a browser bundle — the same
// rule `lib/api/config.ts` and `lib/ai/chat-config.ts` follow.
//
// ── The problem strings are English, deliberately ──────────────────────────
// `communityConfigProblems()` returns English sentences, and the diagnosis
// page renders them as-is rather than translating them. That is a decision
// (code review, 2026-08-05), not an oversight of AD-10: they are a technical
// diagnosis of a file the operator edits by hand, read by the one person who
// edited it, and the field names inside them are English because the JSON keys
// are. AD-10's rule — codes below the delivery layer, sentences only in it —
// governs text shown to MEMBERS. `chatConfigProblems()`, `apiConfigProblems()`
// and `mediaConfigProblems()` produce the same English and the same ruling
// applies to them the day one of them gets a surface; this module was simply
// the first to render one.
import raw from "@/config/community.json";

export interface CommunityConfig {
  enabled: boolean;
  /**
   * The room's write brake, and how many pictures one post may carry.
   *
   * Two numbers about writing a post rather than two blocks, because
   * `brakeProblems()` reads a block's unknown keys against these defaults —
   * splitting them would mean a second block for one number and a second
   * paragraph in `config/community.json` saying the same thing.
   */
  posting: { maxPer10Min: number; imagesMax: number };
  messaging: { maxPer10Min: number };
  report: { maxPer10Min: number; attachmentMax: number };
  /** The automatic send-block. See the block comment at the default. */
  sendBlock: {
    threshold: number;
    windowHours: number;
    /** `null` = never expires — OQ-4's shipped answer. */
    expiryDays: number | null;
  };
  /** How long private messages are kept. `0` means: until the account goes. */
  dmRetentionMonths: number;
  live: { visibleSeconds: number; hiddenSeconds: number };
}

export const DEFAULT_COMMUNITY_CONFIG: CommunityConfig = {
  // Off. See the note at the top of this file — an unreadable config must not
  // resolve to an open community.
  enabled: false,
  // Twenty posts per ten minutes. Deliberately generous: this brake exists to
  // stop a script, not to ration a conversation, and a limit that catches a
  // member answering five people in a row would be a bug that reads as a
  // policy.
  //
  // `imagesMax` is the other half of writing a post: how many of their own
  // pictures a member may attach to one. **Three**, and it is a product decision
  // rather than a technical one — a before-and-after plus one detail is a post,
  // a dozen is an album in a place built for a conversation. The hard ceiling is
  // ten, and every unreadable value falls back to three: a picture is bytes in
  // the operator's bucket and a rendering cost on every reader's phone, so the
  // safe direction here is the smaller one.
  //
  // ⚠️ It also decides how many upload fields the composer OFFERS — one per
  // picture, each with its own alternative text (`pages/ui.tsx`) — so raising it
  // changes a form, not only a server-side bound.
  posting: { maxPer10Min: 20, imagesMax: 3 },
  // Ten direct messages per ten minutes — its own bucket and its own number,
  // tighter than the room's twenty. A member answering five people in a
  // discussion is a conversation; a member opening five private conversations
  // in as many minutes is the shape unwanted contact takes, and the brake is
  // the one thing between it and an inbox. Still a noise brake rather than a
  // security control: the block (Story 21.2) is what actually stops somebody.
  messaging: { maxPer10Min: 10 },
  // Reporting: the module's THIRD rate-limit bucket, and the one meant to
  // stay generous. A member reporting six pieces of spam in ten minutes is a
  // member doing exactly what the feature is for, so the brake is only against
  // a script — a limit that caught somebody clearing up would be a bug
  // wearing a policy's clothes.
  //
  // `attachmentMax` bounds Story 23.3's window: how many messages of their own
  // conversation a reporter may attach to a DM report. Five, because that is
  // enough to show a pattern and few enough that "the moderator saw my whole
  // correspondence" is never true. A larger number is a wider window into a
  // private conversation, which is why it is bounded here rather than left to
  // the form.
  report: { maxPer10Min: 20, attachmentMax: 5 },
  // ── The automatic send-block, and OQ-4 decided ──────────────────────────
  // Five DISTINCT reporters inside twenty-four hours silences a member's
  // writing — they can still read everything. Five because one annoyed person
  // must not be able to silence anybody, and twenty-four hours because a slow
  // trickle of complaints over a year is a moderation question rather than a
  // spam wave.
  //
  // ⚠️ **`expiryDays: null` is OQ-4's answer: the block stands until somebody
  // lifts it.** The alternative — expiring on its own after n days — was
  // rejected for one reason: v1 has no notification channel, so a silent
  // expiry un-silences a spammer with nobody told. The lift is one audited
  // tap in the report queue, and if that turns out not to be enough, the
  // measurement that says so is a field test rather than a timer.
  //
  // 🚨 **There is no send-block TABLE and there must not be one** (AD-64).
  // The block is derived from unconsumed report rows, which is what makes it
  // lift itself when they age out and what makes one tap enough to clear it.
  sendBlock: { threshold: 5, windowHours: 24, expiryDays: null },
  // ── OQ-3, decided here (2026-08-06): retention ships OFF ─────────────────
  // `0` means private messages are kept until the account that wrote them is
  // deleted, and nothing prunes them by age out of the box.
  //
  // ⚠️ **Zero is the OFF sentinel, which INVERTS the usual reading, and the
  // inversion is the trap worth naming.** `lib/cron/rules.mjs` warns that
  // "zero months of retention means delete everything" — `Number(null)` is 0,
  // and a config coerced that way would wipe a table. Here zero means the
  // opposite, so the coercion has to fall towards zero rather than away from
  // it: every unreadable value resolves to this default, which KEEPS data. A
  // reader that copied `configuredNumber()`'s direction would delete on a
  // typo.
  //
  // The three options and why this one:
  //
  //  - **Forever** is what a member reasonably expects of their own
  //    correspondence while their account exists. Private messages are not
  //    `ipn_events`: nobody writes to a friend expecting the app to bin it in
  //    ninety days. So time-based deletion is an OPERATOR policy, not a
  //    template default.
  //  - **Bulk-by-age pruning** is the control an operator gets, through
  //    `node run.mjs community-prune`. Age is the one selector that needs no
  //    look inside — which is why the PRD rules out selective deletion in the
  //    same breath: choosing WHICH conversation to delete means knowing what
  //    is in it, and that is read access by another name.
  //  - **A member-facing per-message delete** is deferred. Art. 17 is already
  //    guaranteed by the account-deletion path, and a per-message delete adds
  //    a second deletion arithmetic to AD-72 that no v1 journey asks for —
  //    what a member wanting quiet actually needs is the block, and that
  //    shipped in 21.2.
  //
  // The command half ships NOW even though the shipped default never prunes,
  // because of the `ai_usage` lesson NFR-41 records: the documented half rots
  // and the command half works.
  dmRetentionMonths: 0,
  // How often an open discussion asks what is new.
  //
  // Five seconds while somebody is looking, thirty while the tab is in the
  // background. The first number is bounded ABOVE by NFR-38's ten seconds —
  // past that a conversation stops feeling like one — and the second exists
  // because a tab left open overnight would otherwise cost a host twelve
  // requests a minute for a room nobody is reading (SM-16's counter-metric).
  live: { visibleSeconds: 5, hiddenSeconds: 30 },
};

/**
 * The visible interval may not exceed NFR-38's bound, whatever the file says.
 *
 * ⚠️ This is a ceiling on a DELAY, so it is the one bound in this file where
 * "too big" is the harmful direction. The floor (`count()`'s `< 1`) is the
 * other half and matters more: a fraction of a second typed in here would be a
 * denial of service an operator wrote by hand while trying to make their
 * community feel faster.
 */
const MAX_VISIBLE_SECONDS = 10;

/** And the hidden one has a ceiling too — past this it is not an update. */
const MAX_HIDDEN_SECONDS = 300;

/**
 * A positive whole number, or the fallback — the `count()` coercer from
 * `lib/ai/chat-config.ts`, for the same reason it exists there.
 *
 * Bounded at the top as well, and that bound is not decoration: a
 * `maxPer10Min` of 100000 is not a configuration, it is the brake switched off
 * by somebody who thought they were relaxing it. Out-of-range values fall back
 * rather than clamping, so `communityConfigProblems()` can name them.
 */
function count(value: unknown, fallback: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value)) return fallback;
  if (value < 1 || value > max) return fallback;
  return value;
}

/**
 * The retention window, in months — or 0 for "keep until account deletion".
 *
 * ⚠️ **The floor is a MONTH, not a fraction.** `0.1` is a fat-fingered "off"
 * that would delete everything older than three days, and there is no honest
 * reading of a sub-month private-message retention. Anything that is not 0 or
 * a whole number of months between 1 and the ceiling falls back to the
 * default, and the default is off — this is the one config field in the module
 * where falling back means KEEPING data, which is the safe direction for a
 * deletion setting.
 */
function retentionMonths(value: unknown): number {
  const fallback = DEFAULT_COMMUNITY_CONFIG.dmRetentionMonths;
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value)) return fallback;
  if (value === 0) return 0;
  if (value < 1 || value > MAX_DM_RETENTION_MONTHS) return fallback;
  return value;
}

/**
 * The ceiling: ten years. Past that the number is not a retention policy, it
 * is somebody typing until the field stopped complaining.
 */
const MAX_DM_RETENTION_MONTHS = 120;

/**
 * How many pictures a post may carry — or 0 for "this community is text".
 *
 * ⚠️ **Zero is a real value here and cannot go through `count()`**, which
 * refuses anything below one. An operator who does not want member-uploaded
 * pictures in their rooms needs a way to say so that is not "switch the whole
 * community off": every picture is bytes in their bucket, a face they may have
 * to moderate and a rendering cost on every reader's phone, and a community
 * built for text is a legitimate product rather than a misconfiguration.
 *
 * Unlike `dmRetentionMonths` next door, zero and the fallback point the SAME
 * way — both towards less — so there is no inversion to be careful about: an
 * unreadable value resolves to the shipped three, and a deliberate `0` is
 * obeyed.
 */
function postImagesMax(value: unknown): number {
  const fallback = DEFAULT_COMMUNITY_CONFIG.posting.imagesMax;
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value)) return fallback;
  if (value === 0) return 0;
  if (value < 1 || value > MAX_POST_IMAGES) return fallback;
  return value;
}

/** The upper bound on the posting limit — see `count()`. */
const MAX_POSTS_PER_10_MIN = 1000;

/**
 * And on the pictures one post may carry — ten, hard.
 *
 * ⚠️ **This ceiling is a cost bound and a reading bound, not a privacy one**
 * (that is what makes it different from `MAX_REPORT_ATTACHMENTS` next door,
 * which looks like the same kind of number). Every picture is stored bytes, a
 * `srcset` per reader and a scroll a phone has to paint; past a handful a post
 * stops being a contribution to a conversation and becomes something the rest of
 * the room has to page past. An operator who wants a gallery wants a different
 * feature.
 */
const MAX_POST_IMAGES = 10;

/**
 * And on the direct-message limit. Lower than the posting one on purpose: a
 * thousand private messages per member per ten minutes is not a relaxed brake,
 * it is no brake at all in the one place where "no brake" means an inbox
 * nobody can use.
 */
const MAX_MESSAGES_PER_10_MIN = 200;

/** The upper bound on the reporting brake. */
const MAX_REPORTS_PER_10_MIN = 200;

/**
 * And on the attachment window — ten messages, hard.
 *
 * ⚠️ **This ceiling is a privacy bound, not a performance one.** Every message
 * attached to a report is a message a moderator gets to read out of somebody's
 * private conversation; past a handful the "bounded window" of AD-71 stops
 * being bounded in any sense a member would recognise. An operator who wants
 * more is asking for a different feature.
 */
const MAX_REPORT_ATTACHMENTS = 10;

/** Twenty distinct reporters is not a threshold, it is a disabled feature. */
const MAX_SEND_BLOCK_THRESHOLD = 20;

/** Thirty days. Past that the window stops describing a wave. */
const MAX_SEND_BLOCK_WINDOW_HOURS = 30 * 24;

/** And a year on the expiry term, for the same reason. */
const MAX_SEND_BLOCK_EXPIRY_DAYS = 365;

/**
 * One named block as an object, whatever the file actually holds.
 *
 * `posting` and `messaging` are the same shape — one bounded number apiece —
 * so they share this and the problems helper below rather than being two
 * copies of one paragraph that drift. `live` keeps its own code: it has a
 * cross-field rule, and generalising that would cost more than it saves.
 */
function blockObject(
  file: Record<string, unknown>,
  name: string,
): Record<string, unknown> {
  const block = file[name];
  return block !== null && typeof block === "object" && !Array.isArray(block)
    ? (block as Record<string, unknown>)
    : {};
}

/**
 * The shipped file as an object, whatever it actually contains.
 *
 * JSON's top level is not necessarily an object: `null`, `[]` and `"x"` are all
 * valid JSON documents, and `raw.enabled` on the first of them throws — inside
 * `proxy.ts`, which runs in front of every matched request. "Fail toward off"
 * would become "fail toward a 500 on every page". A prod build refuses most of
 * those shapes at typecheck, but `next dev` does not typecheck, so this is the
 * difference between a puzzling dev-time crash and an off community.
 *
 * An array is the quiet one and the reason this is not just a `??`: it has no
 * `enabled`, so it resolves to off — and `Object.keys([])` is empty, so the
 * problems list would be empty too, leaving the diagnosis page saying nothing
 * is wrong about a community that is not running.
 */
function fileObject(): Record<string, unknown> {
  return raw !== null && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

/** True when the shipped file is not a JSON object at all. */
function fileIsNotAnObject(): boolean {
  return raw === null || typeof raw !== "object" || Array.isArray(raw);
}

/** The configured community, with every unreadable field replaced by its default. */
export function communityConfig(): CommunityConfig {
  const file = fileObject();
  const live = blockObject(file, "live");

  const visibleSeconds = count(
    live.visibleSeconds,
    DEFAULT_COMMUNITY_CONFIG.live.visibleSeconds,
    MAX_VISIBLE_SECONDS,
  );

  return {
    enabled: file.enabled === true,
    posting: {
      maxPer10Min: count(
        blockObject(file, "posting").maxPer10Min,
        DEFAULT_COMMUNITY_CONFIG.posting.maxPer10Min,
        MAX_POSTS_PER_10_MIN,
      ),
      // ⚠️ Its own coercer, because `count()` refuses zero and zero is this
      // field's whole "this community is text" state. Everything unreadable
      // falls back to the shipped three, which is the same direction — towards
      // fewer pictures — so there is no inversion here of the kind
      // `dmRetentionMonths` has to warn about.
      imagesMax: postImagesMax(blockObject(file, "posting").imagesMax),
    },
    messaging: {
      maxPer10Min: count(
        blockObject(file, "messaging").maxPer10Min,
        DEFAULT_COMMUNITY_CONFIG.messaging.maxPer10Min,
        MAX_MESSAGES_PER_10_MIN,
      ),
    },
    report: {
      maxPer10Min: count(
        blockObject(file, "report").maxPer10Min,
        DEFAULT_COMMUNITY_CONFIG.report.maxPer10Min,
        MAX_REPORTS_PER_10_MIN,
      ),
      // ⚠️ Falls back to the shipped FIVE on nonsense, never to "unlimited".
      // This number is a bound on how much of a private conversation a
      // moderator may see; every doubt about it falls towards the narrower
      // window.
      attachmentMax: count(
        blockObject(file, "report").attachmentMax,
        DEFAULT_COMMUNITY_CONFIG.report.attachmentMax,
        MAX_REPORT_ATTACHMENTS,
      ),
    },
    sendBlock: {
      // ⚠️ Floor of TWO, not one. A threshold of one would arm a one-tap
      // silencer, which is the failure this whole feature is shaped to avoid
      // — so a `1` in the file falls back to the shipped five rather than
      // being obeyed.
      threshold: (() => {
        const value = blockObject(file, "sendBlock").threshold;
        return typeof value === "number" &&
          Number.isInteger(value) &&
          value >= 2 &&
          value <= MAX_SEND_BLOCK_THRESHOLD
          ? value
          : DEFAULT_COMMUNITY_CONFIG.sendBlock.threshold;
      })(),
      windowHours: count(
        blockObject(file, "sendBlock").windowHours,
        DEFAULT_COMMUNITY_CONFIG.sendBlock.windowHours,
        MAX_SEND_BLOCK_WINDOW_HOURS,
      ),
      // `null` is a legitimate value here and the shipped one, so this cannot
      // use `count()`: anything that is not a whole number of days ≥ 1 means
      // "never expires", which is the safe direction (a block that stands is
      // visible in the queue; one that vanished is not).
      expiryDays: (() => {
        const value = blockObject(file, "sendBlock").expiryDays;
        return typeof value === "number" &&
          Number.isInteger(value) &&
          value >= 1 &&
          value <= MAX_SEND_BLOCK_EXPIRY_DAYS
          ? value
          : DEFAULT_COMMUNITY_CONFIG.sendBlock.expiryDays;
      })(),
    },
    // ⚠️ Its own coercion, because `count()` refuses zero and zero is this
    // field's whole OFF state. Everything else falls to the default — which
    // is off — so a typo keeps data rather than deleting it.
    dmRetentionMonths: retentionMonths(file.dmRetentionMonths),
    live: {
      visibleSeconds,
      // ⚠️ **`Math.max`, and the direction is the whole point.** Every fallback
      // in this file resolves toward the SHIPPED default; this one additionally
      // refuses to resolve toward a TIGHTER loop. A hidden interval below the
      // visible one would mean a backgrounded tab polling harder than a watched
      // one — the exact inversion of SM-16 — so an operator who writes
      // `{ visibleSeconds: 8, hiddenSeconds: 2 }` gets 8, not 2, and reads why
      // on the diagnosis page.
      hiddenSeconds: Math.max(
        count(
          live.hiddenSeconds,
          DEFAULT_COMMUNITY_CONFIG.live.hiddenSeconds,
          MAX_HIDDEN_SECONDS,
        ),
        visibleSeconds,
      ),
    },
  };
}

/**
 * The poll schedule in milliseconds — what the client is handed as props.
 *
 * The conversion lives here rather than in the component so that the bounds
 * and the unit are decided in one place: the file speaks seconds because a
 * person edits it, the timers want milliseconds, and nothing in between should
 * be free to do that arithmetic differently.
 */
export function livePollSchedule(): { visibleMs: number; hiddenMs: number } {
  const { live } = communityConfig();
  return {
    visibleMs: live.visibleSeconds * 1000,
    hiddenMs: live.hiddenSeconds * 1000,
  };
}

/**
 * Everything wrong with one `{ maxPer10Min: n }` block — empty when it is fine.
 *
 * `posting` and `messaging` are the same shape and get the same ruling, so
 * they get the same code: absent is fine (an app that predates the block gets
 * the default and hears nothing), written-and-not-read is reported — and
 * reporting switches the module OFF until the next deploy. Harsh for a rate
 * limit, and deliberate: the failure mode of this file is member data flowing
 * where nobody decided it should, so every doubt falls towards closed and the
 * operator reads the reason on `/dashboard/community`.
 */
function brakeProblems(
  file: Record<string, unknown>,
  name: string,
  defaults: Record<string, number>,
  max: number,
): string[] {
  const problems: string[] = [];
  const block = file[name];
  if (block === undefined) return problems;

  if (block === null || typeof block !== "object" || Array.isArray(block)) {
    problems.push(
      `"${name}" must be an object, e.g. { "maxPer10Min": ${defaults.maxPer10Min} }`,
    );
    return problems;
  }

  const fields = blockObject(file, name);
  const value = fields.maxPer10Min;
  if (
    value !== undefined &&
    (typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < 1 ||
      value > max)
  ) {
    problems.push(
      `"${name}.maxPer10Min" must be a whole number between 1 and ${max}`,
    );
  }

  for (const key of Object.keys(fields)) {
    if (key.startsWith("_")) continue;
    if (!Object.hasOwn(defaults, key)) {
      problems.push(
        `unknown field "${name}.${key}" — this block only reads: ` +
          Object.keys(defaults).join(", "),
      );
    }
  }

  return problems;
}

/**
 * Everything wrong with the shipped config — empty when it is coherent.
 *
 * A problem here switches the community OFF (`isCommunityEnabled()` demands an
 * empty list), and the operator reads the list on `/dashboard/community` — the
 * one surface where an off-reason becomes a sentence.
 */
export function communityConfigProblems(): string[] {
  const problems: string[] = [];
  const file = fileObject();

  if (fileIsNotAnObject()) {
    problems.push(
      "config/community.json must contain a JSON object — it holds " +
        (raw === null ? "null" : Array.isArray(raw) ? "an array" : typeof raw),
    );
  }

  if (file.enabled !== undefined && typeof file.enabled !== "boolean") {
    problems.push('"enabled" must be true or false');
  }

  // ── The posting brake ────────────────────────────────────────────────────
  // An app that predates this block has no `posting` at all, and that is not a
  // problem: the field is absent, the default applies, and nothing is
  // reported. What IS reported is a `posting` that was written and is not read
  // — a number out of range, a value of the wrong type, a misspelled key —
  // because the alternative is an operator who believes they relaxed the brake
  // and did not.
  //
  // ⚠️ Reporting it switches the community OFF (`isCommunityEnabled()` demands
  // an empty list). That is harsh for a rate limit and it is the direction
  // this module chose deliberately in its first story: the failure mode of
  // this config is member data flowing where nobody decided it should, so
  // every doubt falls towards closed, and the operator gets the reason as a
  // sentence on `/dashboard/community`. Note that this is the OPPOSITE ruling
  // from `lib/media/config.ts`, where a lint switching delivery off broke
  // files that were already stored — there the failure mode is a customer
  // losing what they paid for, here it is disclosure.
  problems.push(
    ...brakeProblems(file, "posting", DEFAULT_COMMUNITY_CONFIG.posting, MAX_POSTS_PER_10_MIN),
  );

  // `brakeProblems()` checks the block's shape, its unknown keys and its
  // `maxPer10Min`. `imagesMax` is this block's second number and needs its own
  // line — exactly as `report.attachmentMax` does below, and for the same
  // structural reason: a field this file coerces but never LINTS is a value an
  // operator believes they set and nothing acts on, which is the one state this
  // whole function exists to make impossible.
  if (
    file.posting !== undefined &&
    typeof file.posting === "object" &&
    file.posting !== null
  ) {
    const value = blockObject(file, "posting").imagesMax;
    if (
      value !== undefined &&
      (typeof value !== "number" ||
        !Number.isInteger(value) ||
        value < 0 ||
        value > MAX_POST_IMAGES)
    ) {
      problems.push(
        `"posting.imagesMax" must be 0 (no pictures in posts) or a whole number ` +
          `between 1 and ${MAX_POST_IMAGES} — it bounds how many pictures one post may carry`,
      );
    }
  }

  // ── The direct-message brake ─────────────────────────────────────────────
  // The same block, the same ruling, its own number. Sharing `brakeProblems()`
  // rather than a third copy of the paragraph above is what keeps the two from
  // drifting into different strictness — the drift nobody notices, because
  // each one reads correct on its own.
  problems.push(
    ...brakeProblems(
      file,
      "messaging",
      DEFAULT_COMMUNITY_CONFIG.messaging,
      MAX_MESSAGES_PER_10_MIN,
    ),
  );

  // ── The live intervals ───────────────────────────────────────────────────
  // Same shape and same ruling as `posting` above: absent is fine (an app that
  // predates this block simply gets the defaults), written-and-not-read is
  // reported — and reporting switches the module OFF until the next deploy.
  // Harsh for a poll interval, and deliberate for the same reason: an operator
  // who believes they slowed the polling down and did not is running a host
  // cost they did not agree to.
  if (file.live !== undefined) {
    if (file.live === null || typeof file.live !== "object" || Array.isArray(file.live)) {
      problems.push(
        '"live" must be an object, e.g. { "visibleSeconds": 5, "hiddenSeconds": 30 }',
      );
    } else {
      const live = blockObject(file, "live");
      const bounds: Array<[string, unknown, number]> = [
        ["visibleSeconds", live.visibleSeconds, MAX_VISIBLE_SECONDS],
        ["hiddenSeconds", live.hiddenSeconds, MAX_HIDDEN_SECONDS],
      ];
      for (const [field, value, max] of bounds) {
        if (
          value !== undefined &&
          (typeof value !== "number" ||
            !Number.isInteger(value) ||
            value < 1 ||
            value > max)
        ) {
          problems.push(
            `"live.${field}" must be a whole number of seconds between 1 and ${max}`,
          );
        }
      }
      // The cross-field rule. `communityConfig()` already refuses to honour it
      // (it raises the hidden interval to the visible one), but silence would
      // leave an operator believing a background tab polls every two seconds.
      //
      // ⚠️ **Each field falls back to the shipped default when it is absent**,
      // and this used to require BOTH to be numbers — so the one configuration
      // it was written for said nothing. An operator who writes only
      // `"hiddenSeconds": 3` gets an effective 5 (the visible default), which
      // is exactly the "believing a background tab polls every three seconds"
      // the paragraph above names, and the config page stayed clean.
      const visibleSeconds =
        typeof live.visibleSeconds === "number"
          ? live.visibleSeconds
          : DEFAULT_COMMUNITY_CONFIG.live.visibleSeconds;
      const hiddenSeconds =
        typeof live.hiddenSeconds === "number"
          ? live.hiddenSeconds
          : DEFAULT_COMMUNITY_CONFIG.live.hiddenSeconds;
      if (hiddenSeconds < visibleSeconds) {
        problems.push(
          '"live.hiddenSeconds" must not be shorter than "live.visibleSeconds" — ' +
            "a hidden tab polling harder than a watched one is the wrong way round",
        );
      }
      for (const key of Object.keys(live)) {
        if (key.startsWith("_")) continue;
        if (!Object.hasOwn(DEFAULT_COMMUNITY_CONFIG.live, key)) {
          problems.push(
            `unknown field "live.${key}" — this block only reads: ` +
              Object.keys(DEFAULT_COMMUNITY_CONFIG.live).join(", "),
          );
        }
      }
    }
  }

  problems.push(
    ...brakeProblems(
      file,
      "report",
      DEFAULT_COMMUNITY_CONFIG.report,
      MAX_REPORTS_PER_10_MIN,
    ),
  );

  // `brakeProblems()` checks the block's shape, its unknown keys and its
  // `maxPer10Min`. The attachment bound is this block's second number and
  // needs its own line — and it matters more than the brake: it is how much
  // of a private conversation a moderator may be shown.
  if (file.report !== undefined && typeof file.report === "object" && file.report !== null) {
    const value = blockObject(file, "report").attachmentMax;
    if (
      value !== undefined &&
      (typeof value !== "number" ||
        !Number.isInteger(value) ||
        value < 1 ||
        value > MAX_REPORT_ATTACHMENTS)
    ) {
      problems.push(
        `"report.attachmentMax" must be a whole number between 1 and ${MAX_REPORT_ATTACHMENTS} — ` +
          "it bounds how many messages of a private conversation a report may carry",
      );
    }
  }

  // ── The automatic send-block ──────────────────────────────────────────────
  // Every field reported when it is written and not read. This block decides
  // whether a member can write at all, so an operator who believes they
  // raised the threshold and did not is running a community with a brake they
  // do not have.
  if (
    file.sendBlock !== undefined &&
    typeof file.sendBlock === "object" &&
    file.sendBlock !== null &&
    !Array.isArray(file.sendBlock)
  ) {
    const block = blockObject(file, "sendBlock");
    const threshold = block.threshold;
    if (
      threshold !== undefined &&
      (typeof threshold !== "number" ||
        !Number.isInteger(threshold) ||
        threshold < 2 ||
        threshold > MAX_SEND_BLOCK_THRESHOLD)
    ) {
      problems.push(
        `"sendBlock.threshold" must be a whole number between 2 and ${MAX_SEND_BLOCK_THRESHOLD} — ` +
          "one would arm a one-tap silencer",
      );
    }
    const hours = block.windowHours;
    if (
      hours !== undefined &&
      (typeof hours !== "number" ||
        !Number.isInteger(hours) ||
        hours < 1 ||
        hours > MAX_SEND_BLOCK_WINDOW_HOURS)
    ) {
      problems.push(
        `"sendBlock.windowHours" must be a whole number of hours between 1 and ${MAX_SEND_BLOCK_WINDOW_HOURS}`,
      );
    }
    const expiry = block.expiryDays;
    if (
      expiry !== undefined &&
      expiry !== null &&
      (typeof expiry !== "number" ||
        !Number.isInteger(expiry) ||
        expiry < 1 ||
        expiry > MAX_SEND_BLOCK_EXPIRY_DAYS)
    ) {
      problems.push(
        `"sendBlock.expiryDays" must be null (never expires) or a whole number ` +
          `of days between 1 and ${MAX_SEND_BLOCK_EXPIRY_DAYS}`,
      );
    }
    for (const key of Object.keys(block)) {
      if (key.startsWith("_")) continue;
      if (!Object.hasOwn(DEFAULT_COMMUNITY_CONFIG.sendBlock, key)) {
        problems.push(
          `unknown field "sendBlock.${key}" — this block only reads: ` +
            Object.keys(DEFAULT_COMMUNITY_CONFIG.sendBlock).join(", "),
        );
      }
    }
  } else if (file.sendBlock !== undefined) {
    problems.push(
      '"sendBlock" must be an object, e.g. { "threshold": 5, "windowHours": 24, "expiryDays": null }',
    );
  }

  // ── The DM retention window ──────────────────────────────────────────────
  // Same ruling as the brakes: written and not read is reported, and reporting
  // switches the module off until the next deploy. It matters more here than
  // anywhere else in this file — an operator who believes they set a
  // three-month window and did not is holding data they told their customers
  // they would delete.
  if (file.dmRetentionMonths !== undefined) {
    const value = file.dmRetentionMonths;
    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < 0 ||
      value > MAX_DM_RETENTION_MONTHS
    ) {
      problems.push(
        `"dmRetentionMonths" must be 0 (keep until the account is deleted) or ` +
          `a whole number of months between 1 and ${MAX_DM_RETENTION_MONTHS}`,
      );
    }
  }

  // A field this file does not read is a belief the operator holds about
  // their community that nothing acts on — name it rather than ignore it
  // (the chat-config "leftover field" courtesy, and here it covers the worse
  // case too: `{"enable": true}` must not be a silently-off community with an
  // empty problems list, because this list is the diagnosis page's whole
  // content).
  for (const key of Object.keys(file)) {
    // `_comment` and anything else underscored is documentation, not a
    // setting — the house convention six of the shipped config files already
    // use, and `lib/media/config.ts` skips them by the same rule. Without this
    // line, an operator who documents their own switch the way `media.json`
    // shows gets a silently-off community AND a red `node run.mjs test` on a
    // file they filled in correctly.
    if (key.startsWith("_")) continue;

    // `Object.hasOwn`, never `in`: `in` walks the prototype chain, so a field
    // called `toString`, `constructor`, `valueOf`, `hasOwnProperty` or
    // `__proto__` would be silently accepted — the community would run ON
    // carrying a field nothing reads, which is precisely the "belief the
    // operator holds that nothing acts on" this block exists to name.
    if (!Object.hasOwn(DEFAULT_COMMUNITY_CONFIG, key)) {
      problems.push(
        `unknown field "${key}" — this file only reads: ` +
          Object.keys(DEFAULT_COMMUNITY_CONFIG).join(", "),
      );
    }
  }

  return problems;
}

/**
 * Is the community live on this installation?
 *
 * This answers "is the feature there", NOT "may this person enter a given
 * room". The second question is the access level of each group or embed,
 * answered from `grants` at read time — per member, per request (AD-60).
 */
export function isCommunityEnabled(): boolean {
  return communityConfig().enabled && communityConfigProblems().length === 0;
}

/**
 * Why it is off — `null` when it is on.
 *
 * `disabledInConfig` wins over `brokenConfig`: an operator who switched off
 * gets "off", not a lint about a file they deliberately parked. `brokenConfig`
 * is the switched-on-but-linted state: `enabled: true` beside a field this
 * file does not read (a typo, a leftover experiment, a field from a newer
 * story's schema) lands here, and the diagnosis page on
 * `/dashboard/community` renders the list. A mistyped `enabled` itself
 * coerces to "disabled" and is caught louder by the coherence test in
 * `config.test.ts`.
 */
export type CommunityOffReason = "disabledInConfig" | "brokenConfig";

export function communityOffReason(): CommunityOffReason | null {
  if (!communityConfig().enabled) return "disabledInConfig";
  if (communityConfigProblems().length > 0) return "brokenConfig";
  return null;
}
