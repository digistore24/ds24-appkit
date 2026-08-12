<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# The shape of `docs/design.md`

40–60 lines. It is written BEFORE the tokens are touched, and it is the file
every later page follows.

```markdown
# <App name> — how it looks

_Chosen on <date>, direction "<package name>", via the skill `design`. Every
page built since is expected to match this file rather than invent its own
look. Change it here first, then apply it — never page by page. Nothing in
here overrides CLAUDE.md § UI or docs/ux.md._

## Identity
- **Mood:** <2–4 words>
- **Taken from:** <BRANCH A — which file the colours came from
  (brand.css / the logo / https://…), THE ORIGINAL HEX, and each contrast
  adjustment with its number. This is the one fact that cannot be read back
  out of app/globals.css: that file holds the ADJUSTED value, and the brand's
  own value would otherwise be gone.>
- **Looked at:** <BRANCH B — the 1–3 references, and what was taken: mood and
  patterns, nothing else.>

## Tokens — delta from the shipped defaults
(only what changed; everything unlisted keeps the shipped value)
- `--primary`: hsl(…) light / hsl(…) dark — "<colour name>"
- `--primary-foreground`, `--ring`: <the values that went with it>
- `--radius`: <only if changed>
- **Elevation:** `flat` | `lifted` — <only if `lifted`. No line here means
  `flat`, which is the shipped value: absence is an ANSWER, exactly as the
  bracket above says of everything unlisted. `lifted` means
  `--elevation-raised` and `--elevation-overlay` carry the second value set
  from the skill's `references/tokens.md`, in BOTH blocks.>

## Typography
- **Body:** <the sans, and its npm package — app/layout.tsx>
- **Headings:** <the heading family, or "Source Serif 4 — shipped, unchanged".
  It is its own `localFont()` call on `--font-app-heading`, so a look that
  changed only the body sans says so here rather than leaving it blank.>

## The mark
- **Logo:** <public/brand/logo.svg, or "none — the letter tile">
- **Dark variant:** <public/brand/logo-dark.svg, or "not needed">
- **Icons generated:** <date>, from <the file>. Regenerate with
  `node run.mjs brand icons --logo … --apply` whenever the logo changes —
  all five together.

## Page composition
(one line per page type this app has — which components, in which order;
docs/ux.md §0 is the base, this is the delta)
- **Dashboard home:** <e.g. the week's result as a big figure in a Card,
  checklist below, never the other way round>
- **Result pages:** <…>
- **The salespage (`/`):** <mood and composition only — the sections
  themselves are the skill `salespage`>
- **Settings/account:** unchanged — the same on every app, on purpose

## Signature element
<the ONE deliberate flourish, and the pages it appears on. One, not three.>

## Do / Don't
- <2–4 app-specific rules, e.g. "numbers are the hero — never bury a result
  under its explanation">
```

**The two branch-specific fields are additive.** An existing `docs/design.md`
without `## The mark` is still valid; Step 0's "this app already chose" path
reads whatever is there.

🚨 **The token-delta block and the typography block are a CONTRACT, not a
suggested layout.** They are what a later UI pass reads back to find out what
this app chose — `ux-gateway`'s `kit` check audits pages against exactly these
lines, and it can only compare against what this block is able to hold. So a
dial that gets no place here is a dial no pass can ever check, and anything
added to what an app may turn is added here in the same change. Whoever writes
that comparison writes it from THIS file rather than from memory.
