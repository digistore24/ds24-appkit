// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What the assistant can DO. The tools the chat's model may call are this one
// list — the four standard content tools over the content-source registry
// (lib/content-source/sources.ts). What varies per app is the OTHER side: the
// sources registered there. The guide is docs/content-source.md.
//
// ── The four rules a tool has to satisfy ───────────────────────────────────
//
// 1. **A tool never takes a member id.** The account it acts on is
//    `ctx.memberId`, which came from the caller's SESSION. Every argument in
//    `inputSchema` is written by a MODEL, which is reading text somebody else
//    may have authored — a `memberId` argument is an IDOR with a language
//    model holding the pen. This is the same reason `spendTokens` has no such
//    parameter (see lib/tokens/spend.ts).
//
// 2. **The price is yours, computed in code.** Never read a cost from the
//    arguments. `ctx.spend()` exists so a tool cannot name a different
//    account; what it cannot stop is a tool passing an amount the model chose.
//
// 3. **`readOnly` is a security boundary, not documentation.** A runner with
//    the `read` scope may run read-only tools and nothing else, and that
//    refusal lives in `lib/ai/run-tool.ts` — before the handler runs. Mark a
//    tool read-only only if it changes NOTHING: no writes, no charges, no
//    mail, no outbound calls that cost money. When in doubt it is not
//    read-only.
//
// 4. **Access comes from the entitlement API.** `requiresPlan` is answered by
//    `hasPlan()`, never by reading a billing table. A token package cannot
//    satisfy it — a balance is not an entitlement, so `hasPlan()` answers
//    false for one for ever. `tools.test.ts` fails the build on a tool naming
//    a product that does not exist or is a token package.
//
// ── What NOT to expose ─────────────────────────────────────────────────────
// Anything an Operator does to somebody else. There is no `block_user`, no
// `adjust_balance`, no `grant_plan` here and there must not be: those are
// `requireOwner()` operations, and what a tool returns is read — and acted
// on — by a model reading untrusted text. The blast radius of a member tool
// is that member; the blast radius of an operator tool is the business.
import {
  findMediaAcrossSources,
  getFromSource,
  listSources,
  searchAllSources,
} from "@/lib/content-source/query";
import type { ContentHit, ContentViewer } from "@/lib/content-source/types";
import { isLinkableAppPath } from "@/lib/content-source/link-marker";
import {
  toolData,
  toolFailure,
  type ToolCallResult,
} from "./tool-result";

/**
 * What a handler gets. Everything member-scoped is already bound to the
 * session's owner — there is no parameter through which a tool could reach
 * another account.
 */
export interface ToolContext {
  /** Proven by the caller's session. Never from arguments. */
  readonly memberId: string;
  /**
   * Charges this member. Bound to `memberId` by construction — the chat binds
   * `spendTokens`, which authenticates the session, so a charging tool gets
   * the same guarantee a Server Action has.
   *
   * Throws on a shortfall; the executor turns that into an `isError` RESULT
   * the model can read — see the note on `ToolCallResult.isError`.
   */
  spend(amount: number, note: string): Promise<number>;
  /**
   * Records a hit's PAGE as something this answer may link to, and returns the
   * complete `[link:…]` marker to put in the result — or `null` when the hit
   * has no page.
   *
   * Bound to the request's ledger (`lib/ai/content-links.ts`) by the surface,
   * exactly as `spend` is bound to the session: a tool cannot reach another
   * answer's allow-set any more than it can reach another member's balance.
   *
   * 🚨 **Pass the RELATIVE url, before absolutizing.** A marker built from an
   * absolute url would put this deployment's domain into an `href` and into the
   * stored transcript for ever, and a move to a new domain would freeze every
   * old link on the old one.
   */
  offerLink(url: string | null, anchor: string | null, label: string): string | null;
}

export interface ChatTool {
  name: string;
  /**
   * What it does, written FOR A MODEL.
   *
   * This is the single highest-leverage string in the file. The model decides
   * whether to call the tool from this text alone, so it has to say when the
   * tool applies, not just what it is. "Returns the plans and token balance of
   * the account this key belongs to. Use it before answering anything about
   * what the user has paid for." beats "Account info."
   */
  description: string;
  /** JSON Schema for the arguments. `{}` for a tool that takes none. */
  inputSchema: Record<string, unknown>;
  /** Changes NOTHING — no writes, no charges. See rule 3 above. */
  readOnly: boolean;
  /** Product key this tool belongs to, or null for every member. */
  requiresPlan: string | null;
  /** What it costs the member per call, in tokens. 0 for free. */
  costTokens: number;
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolCallResult>;
}

// ── The standard content tools ──────────────────────────────────────────────
//
// These four are the uniform way any app built on this template answers "what
// does this app contain" to the assistant. All four are readOnly and free:
// they change nothing and call nothing that costs money. They carry
// `requiresPlan: null` deliberately — WHICH content a viewer sees is the
// source's decision, made per viewer, not a gate in front of the whole search.
//
// The viewer carries `role: null`, deliberately: these tools serve members,
// and content only an Operator may see should never flow into a chat
// transcript by default. A source that wants role-aware visibility decides
// that inside the source, as a recorded decision.

function viewerFor(ctx: ToolContext): ContentViewer {
  return { memberId: ctx.memberId, role: null };
}

/**
 * The one sentence that turns a `link` field into a link the customer can
 * click. Module-level so `CHAT_TOOL_DEFINITIONS` stays byte-stable across
 * requests — that is the prompt-cache condition, not a tidiness preference.
 */
// One sentence, appended to all four descriptions from a module-level
// constant so `CHAT_TOOL_DEFINITIONS` stays byte-identical across requests —
// the prompt-cache condition (`lib/ai/chat-endpoint.ts`).
//
// ⚠️ It says what to do with a `link`, and — since the persona started
// forbidding addresses outright — what NOT to do with a `url`. The two used to
// disagree: three of these descriptions told the model to "open a hit as url +
// '#' + anchor" while the persona said never to write a path, which is a
// contradiction the model resolves differently on different days. The `url` is
// there for the SERVER to have composed the marker from; the model's copy of it
// has no use, and saying so is cheaper than hoping the persona wins.
const LINK_FIELD_NOTE =
  " A result may carry a `link` field — bracket text of the form " +
  "[link:path|label]. That is the ONE way to make something clickable: copy " +
  "the marker verbatim into your sentence and the window turns it into a link " +
  "the person can open. Never build one yourself and never change its label. " +
  "Never write a result's url or anchor into your answer — an address typed " +
  "out is shown to the person as plain text and helps nobody; a result with no " +
  "`link` is named in words instead.";

/**
 * Hits leave a source with app-relative urls; only HERE — the delivery layer —
 * do they become absolute, so a hit reads the same wherever the transcript is
 * read. The anchor stays a separate field and the description tells the model
 * to append `#anchor`.
 *
 * 🚨 **The marker is composed BEFORE the absolutizing, and the order is
 * load-bearing.** `offerLink` gets the relative url; `url` is absolutized
 * afterwards. An absolute marker would put `APP_URL` into an `href` and into
 * the stored transcript for ever — and would stop being in-app navigation.
 *
 * A hit with no page carries no `link` KEY at all rather than `link: null`:
 * with the shipped handbook that is every hit, and a null field on every
 * result is one more thing for the model to read and dismiss.
 */
function deliverHit(hit: ContentHit, ctx: ToolContext) {
  const link = ctx.offerLink(hit.url, hit.anchor, hit.title);
  return {
    ...hit,
    url: deliverUrl(hit.url),
    ...(link ? { link } : {}),
  };
}

/**
 * A hit's url as the model should see it — absolute where `APP_URL` is set.
 *
 * 🚨 **The grammar is asked BEFORE `new URL()`, and that order is the point.**
 * `new URL("//evil.com/x", "https://app.example.com")` is
 * `https://evil.com/x` — a protocol-relative path does not resolve against the
 * base, it REPLACES the host. So a source that concatenated one slash too many
 * used to have its accident promoted here into a fully-qualified foreign
 * address, handed to the model beside a description telling it to open the
 * hit. `offerLink` already refused to compose a marker for it, which is why
 * nothing was ever CLICKABLE — but the address still reached the answer as
 * text, which is enough to paste.
 *
 * `null` is the honest answer, the same one the handbook gives for every hit,
 * and it is what `sources.test.ts` already demands of every registered source:
 * this makes the runtime agree with the test instead of being one step more
 * permissive than it.
 */
function deliverUrl(url: string | null): string | null {
  if (!url || !isLinkableAppPath(url)) return null;
  const base = process.env.APP_URL;
  return base ? new URL(url, base).toString() : url;
}

const CONTENT_SEARCH_DEFAULT_LIMIT = 10;
const CONTENT_LIMIT_MAX = 25;

/**
 * How many links ONE tool result may offer beyond its own hits.
 *
 * `content_get`'s sections and `content_list`'s table-of-contents entries fan
 * out one-to-one from data the source owns, where `hits` are bounded by
 * `limitFrom`. Unbounded, a single document with sixty headings consumed the
 * ledger's whole `MAX_OFFERED_LINKS` budget, and every later search hit in the
 * same answer arrived with no `link` field — indistinguishable, to the model,
 * from content that has no page at all. Silent, and the customer sees the
 * links vanish from exactly the results they asked about.
 *
 * Sized so that a normal answer (a listing plus two or three lookups) cannot
 * reach the ledger's ceiling on structure alone.
 */
const MAX_LINKS_PER_RESULT = 12;

/**
 * A section's link label: the document, then the section within it.
 *
 * A section title may legitimately be empty — `title: string` does not forbid
 * `""` — and `${doc.title} — ${""}` trimmed to a dangling em dash, so the
 * customer was offered a link reading "Knoten-Basics —". With nothing to add,
 * the document's own title is the honest label.
 */
function sectionLabel(docTitle: string, sectionTitle: string): string {
  const section = typeof sectionTitle === "string" ? sectionTitle.trim() : "";
  return section === "" ? docTitle : `${docTitle} — ${section}`;
}

function limitFrom(raw: unknown, fallback: number): number {
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 1 && raw <= CONTENT_LIMIT_MAX
    ? raw
    : fallback;
}

const contentSearch: ChatTool = {
  name: "content_search",
  description:
    "Searches this app's own content — pages, lessons, handbook articles — by keyword " +
    "and returns matching passages, each with a title, a snippet and, where one exists, " +
    "a url plus anchor. Call it before answering any question about what this app " +
    "teaches or contains. A null url means the content has no page of its own — use " +
    "the returned text directly." +
    LINK_FIELD_NOTE,
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        minLength: 2,
        maxLength: 200,
        description: "Keywords, in the user's language.",
      },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: CONTENT_LIMIT_MAX,
        description: `Maximum hits. Defaults to ${CONTENT_SEARCH_DEFAULT_LIMIT}.`,
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
  readOnly: true,
  requiresPlan: null,
  costTokens: 0,

  async run(args, ctx) {
    // The schema is a hint to a model, not a check — re-validated here,
    // exactly as a Server Action re-validates a form.
    const query = typeof args.query === "string" ? args.query.trim() : "";
    if (query.length < 2) {
      return toolFailure("The 'query' argument is required: at least two characters.");
    }
    const limit = limitFrom(args.limit, CONTENT_SEARCH_DEFAULT_LIMIT);

    const hits = await searchAllSources(query.slice(0, 200), viewerFor(ctx), limit);
    return toolData({
      hits: hits.map((hit) => deliverHit(hit, ctx)),
      returned: hits.length,
      // Say so rather than presenting a slice as the whole story.
      truncated: hits.length === limit,
    });
  },
};

const contentGet: ChatTool = {
  name: "content_get",
  description:
    "Fetches one content page or section by the source and ref a content_search or " +
    "content_list result named. Returns the full text, its section anchors and the " +
    "media it embeds. Use it when a snippet is not enough to answer. Its sections " +
    "carry their own links, so you can point at the passage rather than the page." +
    LINK_FIELD_NOTE,
  inputSchema: {
    type: "object",
    properties: {
      source: {
        type: "string",
        maxLength: 40,
        description: "The sourceId a previous result named.",
      },
      ref: {
        type: "string",
        maxLength: 200,
        description: "The ref a previous result named.",
      },
    },
    required: ["source", "ref"],
    additionalProperties: false,
  },
  readOnly: true,
  requiresPlan: null,
  costTokens: 0,

  async run(args, ctx) {
    const source = typeof args.source === "string" ? args.source : "";
    const ref = typeof args.ref === "string" ? args.ref : "";
    if (source === "" || ref === "") {
      return toolFailure("Both 'source' and 'ref' are required — take them from a content_search or content_list result.");
    }

    const doc = await getFromSource(source, ref.slice(0, 200), viewerFor(ctx));
    if (doc === "unknownSource") {
      return toolFailure(`Unknown source "${source}". Call content_list to see what exists.`);
    }
    // One answer for "no such ref" and "not visible to this account" — an
    // existence oracle for somebody else's content would be a leak.
    if (doc === null) {
      return toolFailure(`Nothing found for "${ref}" in "${source}". Call content_list to see what exists.`);
    }
    // One marker for the document, and one per addressable section — the
    // difference between "in Lektion 3" and "in Lektion 3, ab der zweiten
    // Übung". Both composed from the relative url, before `deliverUrl`.
    const link = ctx.offerLink(doc.url, null, doc.title);
    const sections = doc.sections.map((section, index) => {
      // Past the fan-out ceiling a section simply carries no link. `hits` has
      // always been bounded by `limitFrom`; `sections` was not, so ONE document
      // with sixty headings could spend the whole per-answer budget on headings
      // the answer never mentions — and every `content_search` hit afterwards
      // came back with no `link`, which reads to the model exactly like "this
      // content has no page". Bounding the producer is what keeps the ledger's
      // ceiling a statement about the answer rather than about whichever tool
      // happened to run first.
      if (index >= MAX_LINKS_PER_RESULT) return section;
      const sectionLink = ctx.offerLink(doc.url, section.anchor, sectionLabel(doc.title, section.title));
      return { ...section, ...(sectionLink ? { link: sectionLink } : {}) };
    });
    return toolData({
      ...doc,
      url: deliverUrl(doc.url),
      sections,
      ...(link ? { link } : {}),
    });
  },
};

const contentList: ChatTool = {
  name: "content_list",
  description:
    "Lists this app's content sources and their tables of contents — what exists, " +
    "before searching. Call it when the user asks what the app, a course or the " +
    "documentation contains, or when a content_get ref came back unknown." +
    LINK_FIELD_NOTE,
  inputSchema: {
    type: "object",
    properties: {
      source: {
        type: "string",
        maxLength: 40,
        description: "Limit the listing to one source id. Omit for all.",
      },
    },
    additionalProperties: false,
  },
  readOnly: true,
  requiresPlan: null,
  costTokens: 0,

  async run(args, ctx) {
    const only = typeof args.source === "string" && args.source !== "" ? args.source : undefined;
    const tocs = await listSources(viewerFor(ctx), only);
    return toolData({
      sources: tocs.map((toc) => ({
        sourceId: toc.sourceId,
        label: toc.label,
        // Bounded for the same reason `content_get`'s sections are: a listing
        // is structure, and structure must not spend the answer's whole link
        // budget before the member's actual question has been looked up.
        entries: toc.entries.map((entry, index) => {
          const link =
            index < MAX_LINKS_PER_RESULT ? ctx.offerLink(entry.url, null, entry.title) : null;
          return {
            ...entry,
            url: deliverUrl(entry.url),
            ...(link ? { link } : {}),
          };
        }),
      })),
    });
  },
};

const contentMedia: ChatTool = {
  name: "content_media",
  description:
    "Finds pictures, videos, audio and downloadable files inside this app's content by " +
    "keyword; without a query it lists what there is. Each hit names the page that " +
    "shows the medium. It never returns a direct file link, because file links " +
    "expire: always send the user to the page." +
    LINK_FIELD_NOTE,
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        maxLength: 200,
        description: "Keywords matching the medium's description or name. Omit to list.",
      },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: CONTENT_LIMIT_MAX,
        description: `Maximum hits. Defaults to ${CONTENT_SEARCH_DEFAULT_LIMIT}.`,
      },
    },
    additionalProperties: false,
  },
  readOnly: true,
  requiresPlan: null,
  costTokens: 0,

  async run(args, ctx) {
    const query = typeof args.query === "string" ? args.query.slice(0, 200) : "";
    const limit = limitFrom(args.limit, CONTENT_SEARCH_DEFAULT_LIMIT);
    const hits = await findMediaAcrossSources(query, viewerFor(ctx), limit);
    return toolData({
      hits: hits.map((hit) => deliverHit(hit, ctx)),
      returned: hits.length,
      truncated: hits.length === limit,
    });
  },
};

// ── The registry ────────────────────────────────────────────────────────────

/**
 * Every tool the assistant may call. An app that wants her to DO something of
 * its own adds the entry here — and gets the executor's enforcement (scope,
 * plan gate, token charging) for free, because the chat reaches every tool
 * through `runTool`.
 *
 * Frozen so nothing can push a tool onto it at runtime: the chat derives its
 * tool DEFINITIONS from this list once at module load, and those staying
 * byte-stable across requests is the prompt-cache condition
 * (lib/ai/chat-endpoint.ts).
 */
export const TOOLS: readonly ChatTool[] = Object.freeze([
  contentSearch,
  contentGet,
  contentList,
  contentMedia,
]);

export function findTool(name: string): ChatTool | null {
  return TOOLS.find((tool) => tool.name === name) ?? null;
}
