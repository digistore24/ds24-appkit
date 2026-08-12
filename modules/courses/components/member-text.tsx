// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 The one renderer of text somebody typed into this course.
//
// Three texts go through it and one of them was written by a stranger: the
// lesson's prompt, the member's hand-in, and the operator's reply. React escapes
// text children by construction, and that is the whole defence — nothing in this
// module reaches for the raw-HTML escape hatch, and `../lib/render-safety.test.ts`
// fails the build if anything ever does.
//
// **Paragraphs and line breaks. Nothing else, and the "nothing else" is a
// decision.** `modules/community/components/post-body.tsx` is the right model
// and is deliberately NOT imported, for two reasons of different hardness:
//
//   1. `modules/boundary.test.ts` §3 forbids the string `@/modules/community`
//      in this tree unless `courses` declares it in `requires` — and declaring
//      it would make every course app a community app, destroying exactly the
//      independence that lets `scripts/modules/profiles.test.ts` check k+2
//      profiles instead of 2^k. **No `requires`.**
//   2. That component can do MORE than a course wants: it turns `http(s)` runs
//      into anchors. A clickable foreign link, written by a member, on the
//      screen of the one account that may do everything, is a phishing surface.
//      A course renders paragraphs.
//
// ⚠️ **`\r?\n`, and the `\r` is not defensive tidiness — it was measured.** A
// browser submits a `<textarea>` with CRLF line endings (the HTML form spec says
// so), so a blank line in a hand-in arrives as `\r\n\r\n` and contains no two
// consecutive `\n` at all. With `\n{2,}` every hand-in rendered as a single
// paragraph: a clean 200 with the paragraphing quietly gone.
//
// `whitespace-pre-line` on top of the blank-line split, because all three texts
// come out of a textarea and a single newline is a line somebody meant.

/** Prose as paragraphs — never markup. */
export function MemberText({ text, className }: { text: string; className?: string }) {
  return (
    <>
      {text.split(/(?:\r?\n){2,}/).map((paragraph, index) => (
        <p
          key={index}
          className={className ?? "text-sm leading-relaxed whitespace-pre-line"}
        >
          {paragraph}
        </p>
      ))}
    </>
  );
}
