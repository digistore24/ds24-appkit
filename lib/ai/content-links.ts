// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Which links THIS answer is allowed to carry.
//
// ── Why the truth is per request ────────────────────────────────────────────
// The Media Marker's whitelist is static: it is `markersIn()` over the loaded
// handbook, the same set for every member and every question, resolved once on
// the server and handed down as a prop. A content link cannot work that way.
// Whether `/dashboard/kurs/knoten` is a real page with a real lesson on it,
// and whether THIS member may open it, is a question only the source can
// answer, and it answers it per viewer, per query. So the set is built while
// the answer is being written: every marker in it was composed
// (`contentLinkMarker()`) from a hit a registered source really returned for
// this viewer during this request.
//
// That is what makes an invented link impossible rather than merely
// discouraged. The grammar in `lib/content-source/link-marker.ts` already makes
// a FOREIGN destination unspeakable; this file makes an INVENTED one untrue.
// A model that writes `[link:/dashboard/kurs/lektion-42|Lektion 42]` — a
// perfectly well-formed path to a lesson nobody wrote — produces a string that
// is not in this ledger, and the parser renders it as visible bracket text.
//
// ── Where it is used ────────────────────────────────────────────────────────
// `lib/ai/chat-endpoint.ts` creates one per request, seeded from the links
// stored on the turns it loaded, and binds `offer` into the tool context
// (`lib/ai/run-tool.ts`). The delivery layer in `lib/ai/tools.ts` calls it for
// every hit. What it collected goes to the browser as `{"type":"link"}` lines
// and, for the turns that used it, into `chat_messages.links`.
//
// Pure on purpose: no database, no environment, no request objects — the whole
// file is string arithmetic over a list.
import {
  contentLinkMarker,
  parseContentLinkMarker,
} from "@/lib/content-source/link-marker";

/**
 * How many links one answer may be offered.
 *
 * A `content_search` returns up to 25 hits and the tool loop allows 5 rounds,
 * so an unbounded ledger is 125 markers on the wire for one question. Past the
 * ceiling `offer()` answers `null` and the affected hits simply carry no link —
 * the model can still answer from them, it just cannot point at them.
 *
 * A REFUSAL rather than a truncation, deliberately: dropping older markers to
 * make room would invalidate one the model may already have copied into the
 * sentence it is halfway through writing.
 */
export const MAX_OFFERED_LINKS = 40;

export interface LinkLedger {
  /**
   * Records a hit's page as linkable and returns the complete marker to put in
   * the tool result — or `null` when the hit has no page, when the grammar
   * refuses it, or when this answer has had its share.
   *
   * The url MUST be the app-relative one, before the delivery layer
   * absolutizes it with `APP_URL`.
   */
  offer(url: string | null, anchor: string | null, label: string): string | null;
  /** Every marker this answer may carry, in the order it became available. */
  markers(): readonly string[];
  /** The subset that actually occurs in the finished answer. */
  used(answer: string): string[];
}

/**
 * One ledger, for one request.
 *
 * `seed` is the markers stored on the conversation turns this request loaded.
 * It exists because the model SEES its own earlier answers in the history and
 * will legitimately repeat a marker two turns later without calling a tool
 * again — without the seed that repeat would render as bracket text, which
 * looks like the feature breaking at random. Every seeded marker was itself
 * once offered by a source, so nothing untrue enters this way; malformed
 * entries are dropped rather than trusted.
 *
 * The seed and the fresh offers have SEPARATE ceilings. A long conversation
 * must not be able to crowd out this turn's own lookups — that would switch the
 * feature off silently for exactly the people using it most.
 */
export function createLinkLedger(seed: readonly string[] = []): LinkLedger {
  const order: string[] = [];
  const known = new Set<string>();
  let offered = 0;

  const remember = (marker: string) => {
    if (known.has(marker)) return;
    known.add(marker);
    order.push(marker);
  };

  // The LAST ones: a marker from the turn just before this one is far likelier
  // to be repeated than one from twenty questions ago.
  //
  // Validated BEFORE the window is taken, not after. Slicing first meant a
  // single unparseable row — a truncated string, a hand-repaired record, any
  // future writer of the column — occupied one of the window's places and then
  // dropped out of it, so a legitimate marker fell off the far end and its
  // repeat rendered as bracket text. Filter, then take: the window is
  // MAX_OFFERED_LINKS usable markers rather than MAX_OFFERED_LINKS rows.
  for (const marker of seed.filter((entry) => parseContentLinkMarker(entry) !== null).slice(-MAX_OFFERED_LINKS)) {
    remember(marker);
  }

  return {
    offer(url, anchor, label) {
      const marker = contentLinkMarker(url, anchor, label);
      if (marker === null) return null;
      // A repeat costs nothing — the same lesson turning up in two searches is
      // the normal case, and it must not eat the budget twice.
      if (known.has(marker)) return marker;
      if (offered >= MAX_OFFERED_LINKS) return null;
      offered += 1;
      remember(marker);
      return marker;
    },

    markers: () => order,

    // Whole-string containment, the same question the parser asks. An offered
    // marker the model never used is not stored: the transcript records what
    // the answer says, not what it was shown.
    used: (answer) =>
      typeof answer === "string" ? order.filter((marker) => answer.includes(marker)) : [],
  };
}
