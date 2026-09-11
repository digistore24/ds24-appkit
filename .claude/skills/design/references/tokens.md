<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# The dials, and how each one is turned

What every token does, and what is deliberately not configurable, is
[`docs/design-system.md`](../../../../docs/design-system.md). This file is the
mechanics: the exact edits, so the skill's steps stay short.

## The accent

Three values, in **both** blocks of `app/globals.css` — `:root` and `.dark`:

```css
--primary: hsl(190 90% 26%);
--primary-foreground: hsl(0 0% 100%);
--ring: hsl(190 90% 26%);
```

Written `hsl(H S% L%)`, space-separated. That is not a preference: it is the
only form `parseHsl()` in `scripts/ux/rules.mjs` reads, so a comma form or a
hex is a token `ux-check` reports as unreadable rather than checks.

**Two values, not one.** The accent is dark in light mode (light text on it) and
light in dark mode (dark text on it) — `app/globals.css` says why in its own
header. Using one value in both is the mistake that makes an app look fine in
whichever mode you had open.

`node run.mjs brand colors` does all of this, contrast-checked. Doing it by hand
is fine too; then `node run.mjs ux-check` is not optional.

## The radius

`--radius` in `:root` only — `rounded-sm/md/lg/xl` are all derived from it.
`0.5rem` is shipped. Below `0.25rem` the kit reads as severe, above `0.75rem` as
soft; both are legitimate, neither is a small change.

## Typography

The shipped sans is **Figtree**, loaded with `next/font/local` from
`@fontsource-variable/figtree` — the files ship inside the npm package, so
`npm run build` needs no network. **`GeistMono` stays for monospace** — it is
wired as the fallback behind the empty `--font-app-mono` slot, so a pairing
change never touches it and `font-mono` renders the shipped face rather than
whatever the machine happens to have.

🚨 **Every pairing below arrives the same way: as an npm package whose files
are already on disk.** `npm i @fontsource…`, then `next/font/local` points at
one file inside it. The loader that downloads a face from a font CDN at **build**
time is deliberately never used here — `npm run build` runs on the customer's own
deploy host, and putting a new outbound request into somebody else's release
chain is a failure mode this template does not have and must not acquire. It is
also the one property that stays invisible until it fails, on a machine nobody
here can see. (Runtime is unaffected either way: the file is served from the
app's own origin, so the no-consent stance in `docs/compliance.md` holds.)

**Every row below is the BODY face.** The heading face is a second
`localFont()` call holding Source Serif 4, and it stays as it is unless the row
says otherwise — which is why each row costs exactly one package.

**Five rows, and what the list claims about them is only what is checked.**
Five because a menu somebody reads in one breath is a menu they answer; that is
the whole reason for the number. What each row asserts is that a package of that
name exists and that the file named is the one to point at —
`scripts/design-pairings.test.ts` holds every row to its own namespace and file
claim on each `npm run test`, and before a release the factory asks the public
registry whether the name resolves at all. Nothing here claims a pairing has
been looked at on a screen; a table that promises what npm cannot deliver is
worse than no table.

🚨 **A menu, not a fence — and say which one you mean.** Nothing in the app
holds a page to these five: `app/globals.heading.test.ts` accepts any installed
package, and `scripts/design-pairings.test.ts` checks THIS TABLE, not
`app/layout.tsx`. The condition a face has to meet is the paragraph above and
nothing more: an npm package whose files are already on disk, and
`next/font/local` pointing at one of them. A brand's own face that Fontsource
carries meets it exactly like the five do — `npm view @fontsource/<family>
version` (or `@fontsource-variable/`) says whether it exists; then install it,
read its `files/` directory, point the `localFont()` call at the right cut. So
when somebody arrives with a face of their own, there are three different
"no"s and only one of them is this template's: *not on npm as files* (a
licensed face, a CDN-only face — that is the rule, and the answer is the
nearest of the five); *the list is five* (a menu size, never a reason to refuse
a sixth); and *I would not put a script face there* (your taste — say so as
taste, and remember the heading face reaches `h1` alone, see below, so
"unreadable in a table" is not a thing that can happen). A session once sold
the second and third as the first, to a customer with a brand.

### The greys

The same customer's next sentence is *"and my brand's grey is `#434343`"*, and
the honest answer has two halves that must not be fused. **There is no dial for
the neutrals** — `scripts/design/dials.test.ts` holds the four and refuses a
fifth, so that half is the template's rule with a test behind it. **Nothing
holds the neutral tokens' VALUES** — `--background`, `--foreground`, `--card`,
`--muted`, `--muted-foreground`, `--border`, `--input`, `--secondary`,
`--accent` and their `-foreground` partners are plain CSS in `:root` and
`.dark`, and `ux-check` measures whether they read, not whether they are the
shipped ones. So *"the grey is a fixed boundary"* is a (c) in (b)'s clothes:
a session said exactly that, named no test, and only on the customer's second
ask admitted that no test locks it (2026-09-08). Say it the other way round:
**no command derives it, and here is what doing it by hand costs.**

The hand path, when they want it: every neutral token in **both** blocks, the
dark set derived (their site has no dark mode — keep the shipped structure of
which surface is how much lighter than which, move only the hue and the
saturation); then `OG_FOREGROUND` and `PWA_THEME_COLOR_DARK` in
`lib/pwa/manifest.ts`, because `lib/pwa/manifest.test.ts` pins both to the
tokens and stays red until they match; then `node run.mjs ux-check`, whose 36
pairs are the floor; then the values and the reason in `docs/design.md`. It
is some twenty values against the accent's three, and it is theirs to keep.
Say the count and the cost,
then let them decide; a brand owner who hears a number decides in one turn.

| Pairing | Carries | Elevation | The one package it adds | The file `next/font/local` points at |
|---|---|---|---|---|
| **Figtree** (shipped) | warm, geometric-humanist — the default | `flat` | `@fontsource-variable/figtree` — already a dependency | one variable file, `files/figtree-latin-wght-normal.woff2`, `weight: "300 900"`. Nothing to do |
| **Hanken Grotesk** | the same shape, cooler and more neutral | `flat` | `@fontsource-variable/hanken-grotesk` | one variable file, `files/hanken-grotesk-latin-wght-normal.woff2`, `weight: "100 900"` |
| **Inter** (headings stay Source Serif 4) | editorial, trustworthy — coaching, courses, content | `flat` | `@fontsource-variable/inter` | one variable file, `files/inter-latin-wght-normal.woff2`, `weight: "100 900"` |
| **Manrope** | friendly, rounded — consumer, community | `lifted` | `@fontsource-variable/manrope` | one variable file, `files/manrope-latin-wght-normal.woff2`, `weight: "200 800"` |
| **IBM Plex Sans** | tool-like, precise — dashboards, calculators | `lifted` | `@fontsource-variable/ibm-plex-sans` | one variable file, `files/ibm-plex-sans-latin-wght-normal.woff2`, `weight: "100 700"` |

**Two namespaces, and a row may not straddle them.**
`@fontsource-variable/<family>` holds ONE file with the weights on an axis;
`@fontsource/<family>` holds **fixed weights**, one file per weight and style.
A row on the plain namespace says *fixed weights* instead of *one variable file*
and points at the static file — it stays on the list and says so rather than
being quietly dropped, and the test holds the two claims together so they can
never disagree. All five above are variable: measured against the registry when
this table was written, not assumed.

🚨 **Read the directory before writing the `src` line.** A family with two
variable axes ships three latin cuts — `-standard-`, `-wght-`, and one named
after its second axis — and the one to take is `-wght-`; a one-axis family ships
`-wght-` alone. Two of the five pairings below are two-axis families
(`opsz` on Inter, `wdth` on IBM Plex Sans) — the shipped Source Serif 4 is
two-axis as well, but it is the heading face and not one of the five — and the
axis the app does not need
costs bytes on every page. `ls node_modules/<package>/files/` is the answer; the
names differ per family and a wrong one is a build error at best.

Keep the variable names. They are named after the ROLE, not the font, which is
exactly so a swap touches one file:

```tsx
// app/layout.tsx — replace the `localFont({...})` call, keep the variable.
// The package comes first: npm i @fontsource-variable/manrope
const appSans = localFont({
  src: "../node_modules/@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2",
  variable: "--font-app-sans",
  display: "swap",
  weight: "200 800",
  fallback: ["system-ui", "-apple-system", "sans-serif"],
});
// <html className={`${appSans.variable} ${appHeading.variable} ${GeistMono.variable}`}>
```

**The heading family is already there** — `--font-app-heading`, a second
`localFont()` call in `app/layout.tsx` holding Source Serif 4, reaching the page
through one rule in `@layer base`. Swapping it is the same edit as the sans
above: replace the call, keep the variable. The two lines it hangs on:

```css
/* app/globals.css — in @theme inline */
--font-heading: var(--font-app-heading, var(--font-app-sans));

/* app/globals.css — in @layer base, next to the `text-wrap: balance` rule */
h1 {
  font-family: var(--font-heading);
}
```

🚨 **`h1` alone, and widening it is not a free choice.** `CardTitle` takes a
`level` prop, so an `h2` rule's reach would depend on a prop rather than on the
page; and two of the app's own `h2`s are 14 px and muted (the mobile breadcrumb,
and a label on the home page) — a display face there is a defect, not a look.
The nested `var(--a, var(--b))` is load-bearing too: with the comma form,
deleting the `localFont()` call drops the declaration and headings inherit,
rather than falling back onto the body sans.

**And that reach is what makes a display or script face USABLE**, which is the
sentence a brand owner needs before anything else: the heading face never
arrives in `h2`–`h4`, in a `CardTitle`, in a table, a price or a button. A
face that would be unreadable at 14 px in a pricing table is never asked to
be — it sets one title per page, at 2xl or larger. Two things to know when the
face is theirs:

- **One weight? Then the rule already has the line for it.** Every `h1` in the
  tree carries `font-semibold`, and a face with a single cut (most script
  faces — Kaushan Script, for one) has no 600 to answer with; the browser
  would invent one and the title looks smeared. The shipped `h1` rule carries
  `font-synthesis-weight: none` for exactly this, and
  `app/globals.heading.test.ts` holds it there — do not take it out when you
  replace the face, and if you write the rule anew, keep it.
- **Check it at 375 px on the longest title the app has** — a legal page's
  (`Datenschutzerklärung`) is a fair worst case — in both modes.

Never a `font-[…]` class on a page.

## The elevation

Two values, in **both** blocks of `app/globals.css` — `:root` and `.dark` —
exactly as the accent is. There are two packages and only two, and the word for
each is what a menu row carries: **`flat`** is what ships, **`lifted`** is for an
app that should feel raised rather than calm.

**`flat`** — the shipped values. Nothing to do.

**`lifted`** — these values, and they are **copied out of the commented block in
`app/globals.css`** that sits between the `.dark` block and `@theme inline`.
That comment is where the two sets live side by side; this file quotes it and is
not a second source for the same numbers.

```css
/* :root */
--elevation-raised: 0 1px 3px 0 hsl(30 15% 12% / 0.10), 0 2px 8px -2px hsl(30 15% 12% / 0.08);
--elevation-overlay: 0 20px 48px -12px hsl(30 15% 12% / 0.28), 0 8px 16px -8px hsl(30 15% 12% / 0.18);

/* .dark */
--elevation-raised: 0 2px 4px 0 hsl(0 0% 0% / 0.7), 0 4px 12px -2px hsl(0 0% 0% / 0.55);
--elevation-overlay: 0 24px 56px -12px hsl(0 0% 0% / 0.85), 0 8px 20px -6px hsl(0 0% 0% / 0.7), 0 0 0 1px hsl(36 12% 96% / 0.3);
```

**Both blocks, and the dark value is its OWN value rather than the light one at
a higher opacity** — near-black on near-black stays invisible however far the
alpha is pushed, so the dark answer is a different construction (a deeper drop,
plus a hairline light rim on `overlay` only). The arithmetic is written out
beside the tokens in `app/globals.css`; the argument is
[`docs/design-system.md`](../../../../docs/design-system.md) §8.

**Never a `shadow-…` class on a page** — not `shadow-[0_2px_8px_…]`, not a bare
`shadow-lg`. Both write a value where this dial already turns, and
`node run.mjs ux-check` counts them and names the dial each one went past.
`shadow-(--elevation-raised)` and `shadow-(--elevation-overlay)` compile to the
identical declaration and say WHICH of the two steps they mean; turning a bare
size word into one of them is how such a finding is answered without taking the
shadow off.

🚨 **Those two names, and no third.** The same syntax will take any variable, and
a shadow class naming one this app invented is the fifth elevation step §8 says
an app does not get to open — it looks exactly like the sanctioned form to a
reader, and only the name tells them apart. `ux-check` reports every other
variable on that utility and names the elevation dial when it does, so the
recommendation above has a floor under it rather than a convention.

**Write it plain — never with a `!`, wherever it goes.** On something that
already has a shadow — a `<Card>`, a variant that ships one — it wins by itself:
`cn()` (`lib/utils.ts`) resolves the conflict and drops the base step, exactly
as it does for `shadow-lg`.

⚠️ That holds because `cn()` is an `extendTailwindMerge` here. Stock
tailwind-merge 2.6.1 does not know this shorthand — it kept both classes and the
base shadow won, so the line changed nothing at all while compiling, answering
200 and going red nowhere. 🚨 Do not add a trailing `!` to
it: `!important` beats every later override too, and the marker takes the class
out of the merge — a marked class and a plain one deliberately never conflict,
in either spelling — so it leaves the dead base class in the DOM.

## What the contrast check actually demands

`node run.mjs ux-check` measures every pair in **both** modes. The ones an
accent has to clear:

| Pair | Floor | What it is on the screen |
|---|---|---|
| `primary-foreground` on `primary` | 4.5:1 | the label on a button |
| `primary` on `background` | 4.5:1 | a link, the active menu item |
| `primary` on `card` | 4.5:1 | the same, inside a Card |
| `ring` on `background` / `card` | 3:1 | the focus outline, which is all a keyboard user has |

**A red pair is fixed by moving the lightness, never by accepting the finding.**
Move it down in light mode, up in dark. If no lightness works, the colour cannot
be this app's accent — keep it for surfaces and pick a deeper or lighter
relative. `node run.mjs brand colors` does that search and prints what it did.
