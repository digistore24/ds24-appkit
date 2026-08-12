// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

"use client";

// One answer from a model, rendered — the assistant's and the companion's alike.
//
// It lives in `components/` and not beside one of them because BOTH AI surfaces
// render model output, and a second copy is how the two drift: one gains a
// markdown block the other does not, and the difference is invisible until a
// customer sees a literal asterisk. `components/` importing out of
// `app/dashboard/chat/` would have been the layering inversion that reads as a
// mistake for ever.
//
// The parsing is `lib/ai/markdown.ts` — pure, unit-tested, and it hands back
// DATA. This file turns that data into React elements, which is the whole
// security story: there is no `dangerouslySetInnerHTML` here and therefore no
// sanitiser to keep current. Text a model wrote about a question a customer
// typed can only ever become a string inside an element.
//
// It runs on every streamed chunk, so it stays cheap: a few regexes over a
// couple of hundred characters, no memoisation to get stale.
//
// ── The Media Marker card ───────────────────────────────────────────────────
// `allowedMedia` is the whole-marker whitelist derived from the loaded
// handbook (AD-54) — `allowedMediaMarkers()` in `lib/ai/knowledge.ts`, handed
// down as an RSC prop by the chat page and the dashboard layout. Absent or
// empty it DENIES all markers, which is what makes a mount that forgot the
// set fail safe: the companion panel passes nothing on purpose, and its
// answers render no cards in v1. An accepted marker becomes a small labelled
// LINK-card for every kind, image included — inline rendering in answers is
// deliberately v2 (PRD §6.2) — pointing at the session-gated delivery route
// from Story 18.2. The label is rendered as ONE text node, never
// inline-parsed.
//
// ── The Content Link ────────────────────────────────────────────────────────
// `allowedLinks` is the same kind of whitelist for `[link:<path>|<label>]`,
// and the difference is worth stating because it decides where the prop comes
// from: the media set is STATIC (the handbook, read once on the server), the
// link set is PER MESSAGE — every marker in it was composed during the request
// that produced this particular answer, or stored with it. So it arrives on
// the message, never as a mount prop, and a message with none renders plain
// text. An accepted marker becomes an INLINE anchor, not a card: it belongs to
// the sentence around it. The target is grammar-guaranteed app-relative
// (`isLinkableAppPath`), so this is in-app navigation — `next/link`, no
// `target="_blank"`, no `rel`, and nothing that could leave the site.
import { Fragment, useMemo } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { FileText, Film, Image as ImageIcon, Music } from "lucide-react";

import { parseAnswer, type Inline } from "@/lib/ai/markdown";
import { KNOWLEDGE_MEDIA_TYPES } from "@/lib/knowledge-media/rules.mjs";

// The `.mjs` infers a closed object type; the index below is a grammar-valid
// path's extension, guaranteed to be a key — same boundary move as the media
// route makes (Story 18.2).
const MEDIA_TYPES: Record<string, { contentType: string; kind: string }> =
  KNOWLEDGE_MEDIA_TYPES;

const KIND_ICONS: Record<string, typeof Film> = {
  video: Film,
  audio: Music,
  image: ImageIcon,
  document: FileText,
};

export function AnswerText({
  text,
  allowedMedia,
  allowedLinks,
}: {
  text: string;
  /**
   * The complete Media Marker strings the handbook carries. Optional, and its
   * absence denies — that is AD-54's fail-safe, not a default to "allow".
   */
  allowedMedia?: readonly string[];
  /**
   * The complete Content Link markers THIS answer may carry. Optional, and its
   * absence denies for the same reason. It belongs to the message, not to the
   * mount — see the header.
   */
  allowedLinks?: readonly string[];
}) {
  const t = useTranslations("answerMedia");

  // The parser wants whole-string membership; the arrays crossed the RSC
  // boundary (or the wire) because a Set does not serialise. The media set's
  // reference is stable across client re-renders, so it builds once per
  // conversation; the link set's grows while an answer streams, and rebuilding
  // a Set of at most a few dozen strings per chunk is cheaper than any way of
  // avoiding it.
  const allowed = useMemo(
    () => (allowedMedia ? new Set(allowedMedia) : undefined),
    [allowedMedia],
  );
  const allowedLinkSet = useMemo(
    () => (allowedLinks ? new Set(allowedLinks) : undefined),
    [allowedLinks],
  );

  const blocks = parseAnswer(text, {
    allowedMedia: allowed,
    allowedLinks: allowedLinkSet,
  });

  function runs(parts: Inline[]) {
    return parts.map((part, index) => {
      switch (part.kind) {
        case "strong":
          return (
            <strong key={index} className="font-semibold">
              {part.text}
            </strong>
          );
        case "em":
          return <em key={index}>{part.text}</em>;
        case "code":
          return (
            <code
              key={index}
              className="bg-background/70 rounded px-1 py-0.5 font-mono text-[0.9em]"
            >
              {part.text}
            </code>
          );
        case "media": {
          // Only whitelisted markers reach this branch, so the extension is a
          // grammar-guaranteed allow-map key. A LINK-card for every kind —
          // the disk leg serves full-body with `no-store`, the bucket leg
          // 307s to a signed URL; both are exactly what an <a> wants (AD-53).
          const kind = MEDIA_TYPES[part.path.slice(part.path.lastIndexOf(".") + 1)].kind;
          const Icon = KIND_ICONS[kind] ?? FileText;
          return (
            <a
              key={index}
              href={`/api/knowledge-media/${part.path}`}
              target="_blank"
              rel="noreferrer"
              className="border-border bg-background/70 hover:bg-accent hover:text-accent-foreground my-1 inline-flex max-w-full items-center gap-2 rounded-md border px-3 py-2 align-middle no-underline"
            >
              <Icon aria-hidden className="text-muted-foreground size-4 shrink-0" />
              <span className="min-w-0">
                {/* The label as it stands in the handbook — one text node,
                    never inline-parsed. `truncate` can cut it, so the whole
                    label travels in `title`: without it a long label is a
                    card the customer cannot read to the end and has no way of
                    revealing. It is the developer's own text, never the
                    model's, so putting it in an attribute adds no surface. */}
                <span
                  title={part.label}
                  className="block truncate text-sm font-medium"
                >
                  {part.label}
                </span>
                <span className="text-muted-foreground block text-xs">{t(kind)}</span>
              </span>
            </a>
          );
        }
        case "link": {
          // Only whitelisted markers reach this branch, so `target` is a
          // grammar-valid app-relative path — no scheme, no host, no query,
          // no traversal (`lib/content-source/link-marker.ts`). That is what
          // makes `next/link` the right element and `rel="noreferrer"`
          // unnecessary: the navigation cannot leave this app. Inline, inside
          // the sentence — a card here would break the one thing this marker
          // exists for ("das Thema wird in Lektion 3 erklärt").
          //
          // The label is the hit's TITLE, composed on the server, rendered as
          // one text node and never inline-parsed — the same rule as the media
          // label, and the reason the whitelist can be a whole-string match.
          //
          // `prefetch={false}` is not a performance tweak. A transcript is a
          // LIST of links the person has not asked for yet — Next prefetches
          // them as they scroll into view, so a reloaded conversation with ten
          // linked lessons would fire ten background requests at gated pages
          // before anything was clicked. Where the source is more permissive
          // than its page (the failure `docs/content-source.md` warns about),
          // that turns every refusal into traffic the customer never caused
          // and cannot see. A chat answer is read, not navigated.
          return (
            <Link
              key={index}
              href={part.target}
              prefetch={false}
              className="underline decoration-from-font underline-offset-2"
            >
              {part.label}
            </Link>
          );
        }
        default:
          return <Fragment key={index}>{part.text}</Fragment>;
      }
    });
  }

  return (
    <div className="space-y-2">
      {blocks.map((block, index) => {
        if (block.kind === "list") {
          const items = block.items.map((item, itemIndex) => (
            <li key={itemIndex}>{runs(item)}</li>
          ));
          return block.ordered ? (
            <ol key={index} className="list-decimal space-y-1 pl-5" start={block.start}>
              {items}
            </ol>
          ) : (
            <ul key={index} className="list-disc space-y-1 pl-5">
              {items}
            </ul>
          );
        }
        return (
          <p key={index}>
            {block.lines.map((line, lineIndex) => (
              <Fragment key={lineIndex}>
                {lineIndex > 0 && <br />}
                {runs(line)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
