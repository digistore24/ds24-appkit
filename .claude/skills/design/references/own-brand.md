<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# Branch A — the user already has a brand

They have a logo, house colours, a website, maybe a style guide a designer sent
them two years ago. The job is to get that INTO the app, not to invent
something next to it.

## What they might hand over, and what to do with each

| They have | What you do | What comes back |
|---|---|---|
| **a logo file** (svg, png, webp) | `node run.mjs brand icons --logo <path>` — it renders the five icon files, copies the mark to `public/brand/` and fills in `config/brand.json` | the mark in the header and on `/login`, and the app's icons |
| **a CSS or SCSS file** | **read it first** and name the candidates back to them, then `node run.mjs brand colors --css <path>` | the accent, contrast-checked for both modes |
| **a Tailwind config or a style guide** | the same — look for `theme.extend.colors`, `$brand`, a hex on a button rule | the same |
| **their website's address** | `node run.mjs brand colors --url https://…` | the same — **colours only**. Nothing in `scripts/brand/` looks at type, so their font is something YOU ask about and match from the five pairings, never something the command reports |
| **just a hex code** | `node run.mjs brand colors --hex "#1F6F4A"` | the derivation and nothing else |
| **a logo that vanishes on dark** | ask for a second file and pass it: `node run.mjs brand icons --logo <hell> --logo-dark <dunkel> --apply` | both modes covered |
| **only a screenshot** | that is Branch B with a strong reference. Say so in one sentence and go to Step 1B | — |

**Read a stylesheet yourself before running anything.** The command ranks well
and says how it ranked, but a person knows which of two blues is the brand and
which is the link colour. Name the three to six candidates back to them and let
them point.

## Where to look, in order

1. **Custom properties whose name says it** — `--brand`, `--primary`,
   `--accent`, `--cta`, `--color-main`. This is the strongest signal a
   stylesheet ever gives, and the one that survives minification.
2. **`<meta name="theme-color">`** on their site — a site telling a browser what
   colour it is.
3. **What sits on things you click** — `background` on `.btn`, `a:hover`,
   `[type=submit]`.
4. **A dark block.** `@media (prefers-color-scheme: dark)`, `.dark`,
   `[data-theme="dark"]` — if their designer already solved "what does this
   colour look like on black", take that answer rather than deriving one.

**Where it will fail, and say so rather than guessing:** a brand that lives only
in a background image, an SVG or a gradient is invisible to any of this. A
compiled Tailwind or Bootstrap sheet contains every palette colour exactly once,
so frequency means nothing — the command detects that and says so. When nothing
usable comes back, ask for the hex.

## The three refusals

- **The URL has to be theirs.** Somebody else's site is a Branch B *reference*,
  and then the Take / Never take table applies and the exact hex is off limits.
- **Colour, geometry and the logo file — not their font files, not their copy,
  not their images.** A licensed webfont is licensed to them for their site.
  The command reports where their site keeps its own mark and deliberately does
  not download it: whose image that is, is not visible from here.

  🚨 **"Their site uses Söhne" has one answer, and it is a name from the five.**
  Say what they have, then offer the **nearest pairing by name** out of
  [`tokens.md`](tokens.md) — *"the closest of the five here is Hanken Grotesk;
  it is the same kind of shape, cooler"* — and let them take it or keep the
  shipped face. Never a download, never a sixth family added to that list, and
  never a `@font-face` pointing at their CDN. A face this app does not ship is a
  face `npm run build` would have to fetch on their deploy host, which is the
  property [`tokens.md`](tokens.md) exists to protect. **Nothing here detects a
  font**: you are matching what the user TELLS you, and if they do not know,
  that is a fine answer too — the shipped pairing is a decision.
- **One command run, one proposal, one confirmation.** No second round. Same
  budget as Branch B, and for the same reason: a design conversation that keeps
  going is this skill's failure mode.

## How to put the result to them

This shape, because it can be shortened away otherwise. Quote their original
back FIRST — a derivation that never repeats its input reads like a guess.

```
Read from brand.css — your green is #1F6F4A.

  what it becomes                          why
  ──────────────────────────────────────────────────────────────────────
  --primary       light  hsl(152 56% 28%)   your green, unchanged
                  dark   hsl(152 56% 42%)   lightened for dark mode — the
                                            same value on black was 2.8:1
  --primary-foreground   near-white / near-black, both tinted with your hue
  --ring                 follows --primary

  One adjustment worth knowing about: your green as a WORD on white — a link,
  the active menu item — came out at 4.1:1, just under the 4.5:1 somebody with
  weak eyesight needs. So text in your green uses three points darker. The
  button itself is untouched.

  The mark goes in the header at 24 px and on the sign-in page at 36 px, and
  the five app icons come from the same file.

Take it, or tell me what should be different.
```

Four rules about that block:

- **Every adjustment is named, with its number and its reason.** Never a silent
  correction, and never something they have to run `ux-check` to discover.
- **If nothing needed adjusting, say that in one line.** Silence is not
  distinguishable from not having looked.
- **When the command reports a LARGE move** — it says so itself, in points of
  lightness — repeat that honestly. A brand pastel that has to travel thirty
  points is not "your colour, made readable"; it is a relative of it, and the
  user gets to decide whether they want that or would rather keep their tone for
  surfaces and choose an accent beside it.
- **Do not negotiate the contrast.** If they insist on the raw value, the colour
  stays theirs and only the TEXT role takes the darker shade. That is the one
  lever. A red `ux-check` is not an option (rule 2).

## What Branch A writes

- `public/brand/logo.*` (+ `logo-dark.*` if there is one) and
  `config/brand.json` — both by `brand icons`, together, because a config naming
  a file nobody put there fails `components/brand-mark.test.ts`
- `app/icon.png`, `app/apple-icon.png`, `public/icons/icon-{192,512,maskable-512}.png`
- `--primary`, `--primary-foreground`, `--ring` in **both** blocks of
  `app/globals.css` — by `brand colors --apply`
- `docs/design.md`, which is written FIRST (Step 3)
