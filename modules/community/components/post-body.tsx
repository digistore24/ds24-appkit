// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 **The one place this app renders text another member wrote.**
//
// Everything else the community shows is either the operator's own copy (a
// group name, a description) or a name that went through
// `checkCommunityDisplayName()`. A post is different: it is prose, from a
// stranger, stored and shown to everybody in the room — the template's first
// stored-XSS surface, and the reason this file exists at all rather than
// `{post.content}` being written inline on two pages.
//
// ── What it renders, exactly ──────────────────────────────────────────────
// Plain text with line breaks, plus links for `http(s)` URLs. Nothing else.
// No HTML, no markdown, no images, no mentions, no embeds. `postSegments()`
// in `lib/community/rules.ts` decides the split and is unit-tested against
// hostile input; this file only turns its answer into elements.
//
// ── Three layers, and each one is doing different work ────────────────────
//  1. React escapes text children by construction, so `{value}` cannot become
//     markup. That is the layer people think is the whole answer.
//  2. The scheme whitelist in `postSegments()` is the one XSS React does NOT
//     stop: `javascript:alert(1)` in an `href` executes on click. Only
//     `http://` and `https://` ever become a link, and the link's text is the
//     URL itself — never a label from elsewhere in the post, because a link
//     that says one thing and goes somewhere else is a phishing message this
//     app would be rendering on a member's behalf.
//  3. `lib/community/render-safety.test.ts` reads the tree and fails the build
//     if `dangerouslySetInnerHTML` ever appears under `components/community/`
//     or `app/dashboard/community/`. That is the layer aimed at the future:
//     the realistic risk is not this file, it is the next person adding "just
//     bold" in six months.
//
// ⚠️ Whoever wants rich text here changes the CORE and its tests first, and
// reads the third layer's header before touching it. "It is only bold" is how
// an HTML parser gets into a community.

import { postSegments } from "@/modules/community/lib/rules";

export function PostBody({ content }: { content: string }) {
  return (
    // `whitespace-pre-wrap` is what makes the line breaks a member typed
    // survive without any parsing: the text stays text and CSS does the
    // rendering. `break-words` because a member can paste a 400-character URL
    // and a card that scrolls sideways is a broken card.
    <div className="text-sm break-words whitespace-pre-wrap">
      {postSegments(content).map((segment, index) =>
        segment.kind === "link" ? (
          <a
            key={index}
            href={segment.value}
            // `noopener` (the new tab must not reach back into this one) and
            // `noreferrer` (a member's room is not something to announce to a
            // stranger's server). `nofollow` because a community is a place
            // somebody could otherwise drop links into for the ranking.
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="text-primary underline underline-offset-2"
          >
            {segment.value}
          </a>
        ) : (
          // A plain string child. React escapes it; no attribute is built
          // from it; nothing here can become an element.
          <span key={index}>{segment.value}</span>
        ),
      )}
    </div>
  );
}
