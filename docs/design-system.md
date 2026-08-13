# The design system — what is already decided, and which dials are yours

This app ships with a finished look: a colour system that works in light and
dark, a set of components, two typefaces on named roles, one spacing rhythm, two
steps of elevation. **There is nothing to design here — there is something to
use**, and this file says where each dial is and which of them are yours to
turn. There are **four** of them, they are listed in §8, and that list is
closed.

It has four neighbours, and they do not overlap:

| | |
|---|---|
| **this file** | where the look LIVES, and which files are replaceable |
| [`ux.md`](ux.md) | what the app has to DO for the person in front of it |
| [`visuals.md`](visuals.md) | pictures a customer uploads, or the app serves them |
| [`salespage.md`](salespage.md) | the argument the home page makes |
| `docs/design.md` | what THIS app chose — written by the skill `design`, and absent until it did |

## 1. Where the colours live

**`app/globals.css`, two blocks.** `:root` is light, `.dark` is dark, and every
colour in the app comes from one of them. `@theme inline` below maps each token
to a Tailwind class — a token with no entry there has no `bg-…`/`text-…` class,
which is the only thing to remember when adding one.

| Token | What it is |
|---|---|
| `--background` / `--foreground` | the page, and the text on it |
| `--card` / `--card-foreground` | a `<Card>`. In dark it sits a shade ABOVE the background, or every edge vanishes |
| `--popover` / `--popover-foreground` | menus, dropdowns, dialogs |
| **`--primary` / `--primary-foreground`** | **the accent.** Buttons, active menu items, links, badges |
| `--secondary` / `--secondary-foreground` | secondary buttons, quiet badges |
| `--muted` / `--muted-foreground` | table headers, placeholders, and the app's quiet text |
| `--accent` / `--accent-foreground` | hover and focus inside menus and lists (not the brand accent — an unfortunate shadcn name this app keeps rather than renames) |
| `--destructive` / `--destructive-foreground` | delete, cancel, revoke. Never the brand colour |
| `--border` / `--input` / `--ring` | edges, field edges, and the focus ring |
| `--radius` | one number; `rounded-sm/md/lg/xl` are all derived from it |
| `--info` / `--success` / `--warning` / `--danger` (+ `-border`, `-foreground`) | the four `<Callout>` intents, each checked at **7:1** on its own surface |

Two things are easy to get wrong, and the file says both at the top:

1. **`--primary` is a surface AND a text colour** — a button, and the active
   menu item. Both roles have to be readable, which is why the accent is dark in
   light mode and light in dark mode rather than one value in both.
2. **Look at both modes.** A tone that looks good on white is routinely washed
   out or glaring on black.

## 2. Recolouring

Three values, in **both** blocks:

```css
--primary: hsl(190 90% 26%);          /* :root  */
--primary-foreground: hsl(0 0% 100%);
--ring: hsl(190 90% 26%);
```

Everything else hangs off them. Then `node run.mjs ux-check`, which computes the
contrast of every token pair in **both** modes — a red pair is fixed by moving
the lightness, never by accepting the finding.

The values must be written `hsl(H S% L%)`, space-separated. That is not a style
preference: it is the only form the checker's parser reads, and a token nothing
can parse is a token nothing checks.

- **Guided** — the skill `design`. It asks whether you already have a brand,
  proposes or derives an identity, writes it into `docs/design.md`, and applies
  it. Fifteen minutes.
- **Mechanical** — `node run.mjs brand`, which is what that skill runs.

**The shipped colours are a deliberate starting point.** A deep petrol accent on
a warm grey: the accent is far from `--destructive` so "the brand" and "delete"
can never be confused, and the warm neutral is the half of the pairing that does
the quiet work — a cool accent on a cool grey is a swatch, on a warm grey it is
a decision somebody made.

## 3. Typography

**Two families on two role variables**, filled in `app/layout.tsx` and consumed
through `--font-sans` and `--font-heading` in `app/globals.css`:

| Variable | The shipped face | Where it reaches |
|---|---|---|
| `--font-app-sans` | Figtree | `body`, and everything that inherits from it |
| `--font-app-heading` | Source Serif 4 | `h1`–`h4`, through one rule in `@layer base` |

**Both are loaded with `next/font/local` from an npm package rather than
`next/font/google`.** That is worth knowing before you change either:
`next/font/google` downloads the files at **build** time, and `npm run build`
runs on your host during a deploy. The shipped setup needs no network at build
at all, and a font swap that reaches for Google Fonts gives that property up.
Either way the file is served from your own origin, so the no-cookie-banner
position in [`compliance.md`](compliance.md) is untouched.

The CSS variables are named after their ROLE (`--font-app-sans`,
`--font-app-heading`), not after the fonts currently sitting on them — the faces
are the swappable part, which is what makes the two of them **one dial** rather
than two decisions taken separately (§8). Swapping the heading face is the
second `localFont()` call and nothing else; delete that call and headings fall
back to the body sans rather than to a browser default, which is what the nested
`var(--font-app-heading, var(--font-app-sans))` form in `app/globals.css` buys.

**Never a `font-[…]` class on a page — and never `font-heading` either.** Both
write a value where the dial already turns: the heading face reaches an `h1`
through the rule in `@layer base`, never through a class somebody remembered.
`node run.mjs ux-check` counts both and names the dial each one bypasses (§7).

⚠️ **There is a third role variable in this file and it resolves to nothing
today.** `--font-mono` is mapped to `--font-app-mono`, which the tree defines
nowhere, so `font-mono` quietly inherits the body face; the note sits beside it
in `app/globals.css`. It is **not** a fifth dial and not a third arm of the type
one — a monospace face has never been something an app here turns,
`node run.mjs brand` never writes one and `design` never asks about one. Saying so
is what keeps §8's closed list honest: an empty slot and a missing slot are
different things, and this one is empty on purpose until somebody decides a
second face is worth the download.

## 4. The brand assets — which files are yours to replace

| File | Size | What it is | Written by |
|---|---|---|---|
| `public/brand/logo.svg` \| `.png` \| `.webp` | any; rendered 24 px in the shell, 36 px on `/login` | the mark in the header and above the sign-in heading | you, or `node run.mjs brand icons` |
| `public/brand/logo-dark.*` | same | **optional** — only when the light mark disappears on the dark background | you |
| `app/icon.png` | ~256×256 | the browser tab; picked up by file name, nothing to register | `brand icons` |
| `app/apple-icon.png` | 180×180 | the iOS home screen | `brand icons` |
| `public/icons/icon-192.png` | **exactly** 192×192 | Chrome refuses to install the app without it | `brand icons` |
| `public/icons/icon-512.png` | **exactly** 512×512 | the splash screen | `brand icons` |
| `public/icons/icon-maskable-512.png` | **exactly** 512×512, ~20 % padding — **a separate picture** | Android crops it to the launcher's shape | `brand icons` |
| `public/share/chat.png` | 256×256, square | the in-app assistant's face (`config/ai-chat.json` → `avatar`) | by hand; the skill `ai-chat-knowledge` |
| `app/opengraph-image.tsx` | 1200×630 | **the share card** — what a pasted link shows in WhatsApp, Slack, LinkedIn and X | nothing: it is rendered, see below |

**The share card is generated, not a file you replace.** It draws `APP_NAME`,
the accent and `app/icon.png` — so it follows a rename and a rebrand by itself,
which a shipped PNG could not: a static placeholder would say *Your App* on
every customer's link preview for ever, in the one surface of their app they
never look at. Replace it only if you want art there; then delete the route and
drop a 1200×630 `app/opengraph-image.png` in its place, and Next picks that up
by the same file-name convention.

Four things that are not preferences:

- **The letter tile is a MONOGRAM, and that is the shipped state rather than a
  defect.** With `"logo"` empty, `<BrandMark>` (`components/brand-mark.tsx`) draws
  a small tile carrying the initials of the name's WORDS, one letter each, at most
  two — so *Kraft Werk* is `KW` and *Kraftwerk* is `K`. The letters come from
  `initialsFrom()` (`lib/initials.ts`), which the shell's user avatar shares; a
  second copy of that rule fails the build. The tile is deliberately
  `bg-foreground`, not the accent: a filled accent square with a letter in it is
  the look every generated app wears, and spending the brand colour on a
  placeholder is what makes `--primary` read as decoration rather than as *this is
  interactive*. It is deliberately a SQUARE too — the user avatar beside it is a
  round badge of initials, and two round badges of initials in one header row is
  one object twice. ⚠️ If this app's mark shows only the first letter of a two-word
  name, this copy of the template predates the monogram: `node run.mjs update`
  carries text and never code, so this paragraph reached you without the component
  it describes. Nothing is broken, and [`updates.md`](updates.md) says what
  retrofitting takes.
- **`config/brand.json` is the only thing that says a logo exists.** Empty means
  the letter tile, which is the shipped state and a perfectly good answer. A
  path there must live under `public/brand/`, carry its `logoWidth` and
  `logoHeight`, and point at a file that is really on disk — all three are
  checked by `components/brand-mark.test.ts`, because a logo that 404s is a
  broken-image icon in the header of every page.
- **The five icons are replaced together.** A rebranded app whose home-screen
  icon still shows the template's placeholder is the usual way somebody notices
  the job was half done.
- **`lib/pwa/manifest.test.ts` reads the PNG headers** and fails the build on a
  size that disagrees with its declaration. You cannot ship a 256 px file named
  `icon-512.png`.

⚠️ The logo slot and `node run.mjs brand` arrived in template 0.20.0. If
`config/brand.json` is not in this app, this copy predates them — everything
else on this page still holds, the letter tile is what you have, and
[`updates.md`](updates.md) says what retrofitting takes.

## 5. The one SVG, and the boundary that keeps it safe

This app **refuses SVG uploads** — at every door, for every kind, for every
role. An SVG is not a picture, it is a document, and a document can carry a
script; `lib/media/sniff.ts` decides what a file is from its first bytes and
never recognises one.

Your own logo is the single exception, and it is bounded rather than waved
through:

- **It is a build-time file in your own repository**, put there by you. It never
  travels through `lib/media/`, it is never a row in the `media` table, and
  nothing a member can reach knows the folder exists.
- **It is rendered only through `<img src>`.** A browser renders an SVG
  referenced by `<img>` in *secure static mode*: its script does not run and its
  external references are not fetched. `<object>`, `<embed>`, `<iframe>`,
  `dangerouslySetInnerHTML` and importing the file into JSX all render it as a
  **document** — and all five execute it. That is also why the mark does not go
  through `next/image`: Next refuses to optimise an SVG unless
  `dangerouslyAllowSVG` is set, and that switch is precisely what the `<img>`
  rule exists not to need.
- **It is served with scripting switched off.** `next.config.ts` puts
  `Content-Security-Policy: default-src 'none'; sandbox` on `/brand/:path*`.
  That covers what `<img>` cannot: `public/` is served, so `/brand/logo.svg` is
  also an address somebody can navigate to, and there the file arrives as a
  document on your own origin.

`components/brand-mark.test.ts` fails the build on any of it slipping — a second
renderer, one of the five executing elements, `dangerouslyAllowSVG`, a missing
CSP entry, or `image/svg+xml` reappearing in an upload allowlist.

⚠️ The header is sent by the app. Every host in [`DEPLOY.md`](DEPLOY.md) runs
`next start`, so it holds there. A CDN placed in front of `public/` and serving
those bytes itself would not send it — then either repeat the rule in the CDN,
or use a PNG.

**The boundary is the exception.** A customer's SVG is still refused, always.

## 6. How a new page or a module inherits all of this

Nothing to wire, and that is the design rather than a convenience.

A page built from `components/ui/` gets the colours through classes
(`bg-card`, `text-muted-foreground`, `bg-primary`), the fonts from `<html>` and
the corner radius from `--radius`. A **module** is no different: its components
import `components/ui/` like anything else, and core pages render them through
`lib/modules/component-registry.ts`. The design system reaches them because it
is CSS on the document — not a prop anybody has to thread, and not a theme
object anybody has to pass.

There is exactly one way to fall out of it: writing a colour by hand — a
Tailwind palette class (`bg-blue-600`, `text-gray-500`) or a hex. Those do not
follow into dark mode and are missed by every recolour, and
`node run.mjs ux-check` counts them.

## 7. What `ux-check` settles, and what it cannot

It reads the tokens and computes real contrast ratios in both modes, checks that
every token is defined in **both** blocks and not only one, finds hard-coded
colours, values written past a dial (an arbitrary `font-[…]` or `shadow-[…]`, a
bare `shadow-lg`, a hex inside an arbitrary value, the generated `font-heading`
class, and a shadow naming any custom property other than the two elevation
roles), hand-built controls, icon buttons with no name, images with no `alt`,
and pages nothing leads to. **Green means counted, not good** — the half a
machine cannot settle is [`ux.md`](ux.md), and the skill that walks it is
`ux-gateway`.

Both of those two are failures rather than warnings, and neither is a free
choice: writing a value past a dial is the boundary §8 declares closed, and the
skill `design` declares this command's green its own floor. A token in one block
only is mechanical — the missing one inherits instead of erroring, so it breaks
in the mode nobody was looking at. A token that legitimately has no dark answer
goes on `MODE_SINGLE_TOKENS` in `scripts/ux/rules.mjs` with its reason beside it;
`--radius` is the one entry, because a corner does not change with the mode.

Each green line names what it counted — `121 file(s) scanned`, `34 token(s)
compared` — so that *nothing found* and *nothing looked at* are different
sentences.

## 8. The four dials, and what is deliberately NOT configurable

**Half of this section is a correction rather than a loosening, and it is worth
saying which half.** It used to close on *"the spacing rhythm, and the absence of
shadows — this kit separates things with edges and space, not elevation"*. The
first half is still true. The second was already untrue of the kit it described:
**thirteen** files under `components/ui/` render a Tailwind shadow today —
`alert-dialog`, `button`, `card`, `checkbox`, `dialog`, `dropdown-menu`,
`input`, `radio-group`, `select`, `sheet`, `switch`, `tabs`, `textarea`. What
this kit was missing was never the elevation; it was a named slot for it and a
dark mode in which it was visible at all. Since 0.25.0 there is one, so the
sentence goes and the shadows stay.

### What a dial IS

> A **dial** is a named slot whose value is set once in `app/globals.css` or
> `app/layout.tsx`, is recorded in `docs/design.md` when an app turns it, and
> never appears as a class on a page.

The last clause is the operative one, and everything a machine can check hangs
off it. `font-[…]`, `shadow-[…]` and a bare `shadow-lg` are **the same mistake
as a hex class**: each writes a VALUE where there is a slot, so it survives no
recolour, follows into no mode and is invisible to anybody reading
`docs/design.md` to find out what this app chose. `node run.mjs ux-check`
counts every one of them and names the dial it bypasses (§7).

Two shapes are worth naming because they look like the mistake and are not.
`shadow-(--elevation-raised)` and `shadow-(--elevation-overlay)` NAME the role
instead of picking a size out of Tailwind's vocabulary. They compile to exactly
what `shadow-sm` and `shadow-lg` compile to, they say which of the two steps
they mean, and turning a bare size word into one of them is how you answer a
`ux-check` finding without taking the shadow off.

**Write it plain — no `!`, wherever it goes.** On a component that already
carries a shadow it beats the base step by itself, because `cn()`
(`lib/utils.ts`) resolves the conflict: `cn("shadow-sm", "shadow-(--elevation-overlay)")`
returns `shadow-(--elevation-overlay)` alone, exactly as
`cn("shadow-sm", "shadow-lg")` returns `shadow-lg`.

⚠️ **That is newer than it looks, and an app whose `lib/utils.ts` is three
lines long does not have it.** Stock tailwind-merge 2.6.1 predates Tailwind v4
and does not know the `(--var)` shorthand at all: it kept BOTH classes, and
`.shadow-sm` — emitted last — won. The line was a silent no-op; it compiled, it
type-checked, the page answered 200, and the shadow was simply the one that was
already there. `cn()` is now an `extendTailwindMerge` with three clauses: it
rewrites the shorthand into the arbitrary form it is defined to mean, files an
un-hinted `var()` under box-shadow rather than box-shadow colour, and reads
Tailwind v4's TRAILING important marker (`shadow-lg!`) as the same thing as the
v3 leading one (`!shadow-lg`), which is the only spelling 2.6.1 knows.
`lib/utils.test.ts` is the needle that keeps all three.
🚨 `node run.mjs update` carries text and never code
([`updates.md`](updates.md)), so if `lib/utils.ts` in YOUR app is still the
three-line shadcn helper, this paragraph arrived ahead of the fix — there the
old rule holds and the class needs a trailing `!`.

🚨 **Do not add the `!` "to be safe" once `cn()` is fixed, and the third clause
is not a licence to.** It makes a trailing `!` MERGEABLE against another
trailing `!`; it does not make it advisable, because the marker is
`!important` and that beats every later override — a `hover:` variant, a
`shadow-none` a caller passes in. It also takes the class OUT of the merge
against anything written plainly: a marked class and an unmarked one
deliberately never conflict, in either spelling, because tailwind-merge puts the
marker into the class id and dropping an `!important` class because a plain one
came later would be wrong. So the class list keeps a dead `shadow-sm` beside it.
Measured: `cn("shadow-sm", "shadow-(--elevation-overlay)!")` still returns both,
where the plain form returns `shadow-(--elevation-overlay)` alone — and
`cn("shadow-(--elevation-overlay)!", "shadow-none")` keeps both, so the caller's
`shadow-none` survives the merge and then loses in the browser, which is the
override this rule exists to protect.

🚨 **Those two names are the whole of it, and the syntax is closed to everything
else.** The same shorthand can name any variable at all, so a page inventing its
own — a shadow variable of its own naming, in place of one of the two role names
— reads to a human exactly like the sanctioned form and is a fifth elevation step
arriving as a tweak. `ux-check` reports every variable on the shadow utility
except `--elevation-raised` and `--elevation-overlay`, and names the elevation
dial when it does (`shadowVariable` in `scripts/ux/rules.mjs`; §7).

**That is a decision taken rather than an omission noticed**, and it is worth
saying why, because this paragraph used to say the opposite. The form stood
here named-but-uncaught while `cn()` was still stock — and there it was harmless
in the way a broken thing is harmless: tailwind-merge did not know the shorthand,
so such a class lost to whatever shadow was already on the element and changed
nothing. The `extendTailwindMerge` above **made it work**. Measured on this tree
after that repair: a class list carrying a base step plus an invented shadow
variable now returns the invented one alone, exactly as it does for the two
sanctioned names. The fix that made the recommended form real made the
unsanctioned one real in the same line, which is what turned a documented
opening into a live way past the dial.

Two neighbours are deliberately NOT reported, each for its own reason. An
**inset, drop or text shadow** in the same shorthand is a different CSS property
that `app/globals.css` maps nowhere, so it is not this dial (the same reason
`inset-shadow-sm` is not). And **`shadow-none`** sets no value, so it turns no
dial — a page taking an elevation back off something the kit raised is
composition, not a fifth slot.

### The four

- **accent** — `--primary`, `--primary-foreground` and `--ring`, in **both**
  blocks of `app/globals.css`. Not a choice from a fixed set:
  `node run.mjs brand colors` DERIVES it from any colour the operator already
  owns and moves the lightness only as far as readability needs
  (`scripts/brand/contrast.mjs`).
- **radius** — `--radius` in `app/globals.css`, one free number rather than an
  enumeration; every `rounded-*` in the app is calculated from it.
- **type** — `--font-app-sans` and `--font-app-heading`, filled in
  `app/layout.tsx` and consumed in `app/globals.css` (§3). The one dial that
  lives in two files, which is why the definition above names both.
- **elevation** — `--elevation-raised` and `--elevation-overlay`, in **both**
  blocks of `app/globals.css`. Two steps and only two, named after the role they
  play; §1 and the comment above the tokens say what each is for.

**The list is closed. Opening a fifth slot is a change made in the TEMPLATE,
once for every app — never a decision an app makes about itself.** An app that
needs a look the four cannot express is telling you something about the template,
and the answer is a story here rather than a variable there; anything past them
is composition — which components, in which order, with how much space.

⚠️ **The elevation tokens and the heading variable arrived in template 0.25.0.**
If `--elevation-raised` and `--font-app-heading` are not in this app's
`app/globals.css`, this copy predates them: `node run.mjs update` carries text
and never code, so this section can reach an app whose slots are still missing,
and [`updates.md`](updates.md) says what retrofitting takes. That paragraph is a
**convention rather than a gate** — a document has no `requires:` and nothing
compares its prose against a version, so only a reader can catch it.

### What stays refused

Each of these is a decision somebody made once so that every page in every app
built on this template agrees with every other:

- **The component set.** A hand-built button is not more individual, only
  inconsistent: no focus ring, no dark mode, different spacing two pages later.
  Missing something? `npx shadcn@latest add <component>`.
- **The four `<Callout>` intents.** Their triples are checked at 7:1 in both
  modes; a hand-picked pair tips over in the mode you were not looking at.
- **The three feedback mechanisms** — `Callout`, `useActionToast`, `FlashToast`
  — and never a fourth. Which to use is decided by *where the result has to
  appear*.
- **Destructive is `variant="destructive"`**, never the accent, however well the
  accent happens to suit it.
- **Dark mode is a class on `<html>`**, set by next-themes, not
  `prefers-color-scheme`. The `@custom-variant` line at the top of
  `app/globals.css` is what makes `dark:` follow it.
- **The shell geometry** — the 14-unit header, the 60-unit sidebar, the content
  measure. A page that renegotiates them stops looking like the same product.
- **The spacing rhythm.** Tailwind's scale, used as it comes. A page that
  invents its own vertical rhythm stops lining up with the one beside it, and
  nothing about that is visible until the two are open in the same session.

## 9. Where things are

| | |
|---|---|
| `app/globals.css` | the tokens — colours, `--radius`, and the two elevation steps — in both modes, plus the Tailwind mapping |
| `app/layout.tsx` | the two type role variables (`--font-app-sans`, `--font-app-heading`), and the browser-bar colour |
| `components/ui/` | the components — 30-odd, all shadcn/ui |
| `components/brand-mark.tsx` | the mark, and the `<img>`-only rule |
| `config/brand.json` · `lib/brand.ts` | whether there is a logo, and where |
| `lib/pwa/manifest.ts` | the icon list and the PWA colours, pinned to the tokens by a test |
| `next.config.ts` | the security headers, including the brand folder's |
| `scripts/ux/rules.mjs` | what `ux-check` measures, and the six ways past a dial it counts |
| `scripts/design/dials.mjs` | the four dials as DATA, held against §8 from both sides by `dials.test.ts` — a fifth one fails the build here |
| `docs/design.md` | this app's own choice — written by the skill `design` |

## 10. The construction kit — which component for what

`components/ui/`, all shadcn/ui. This table is the whole answer to "what do I reach
for": the right-hand column is what a hand-built version would have looked like, and
each row is a case where somebody built it by hand at least once.

| For what | Use | Instead of |
|---|---|---|
| Button, link-as-button | `<Button>` (`asChild` for `<Link>`) | `<button className="…">` |
| Input field, label | `<Input>`, `<Label>`, `<Textarea>` | raw `<input>` |
| Somebody picking a file to upload | `<MediaUpload>` — label, composed `accept`, the reset after a save, the size refusal, and with `direct` the three-step upload straight to the bucket. Text-free: every sentence and every formatted number is a prop | raw `<input type="file">`. It is the app's ONLY one, and `components/ui/media-upload.test.ts` fails the build on a second |
| Selection | `<Select>` (with `name` for the form) | raw `<select>` |
| Yes/no, one-of-several, on/off | `<Checkbox>`, `<RadioGroup>`, `<Switch>` | raw `<input type="checkbox">` — with one exception: a plain-POST form that must work without JavaScript keeps the native input, styled from tokens (`app/plans/page.tsx` shows why, above its checkbox) |
| Box with content | `<Card>` + `CardHeader/Content/Title` | `<div className="rounded-lg border">` |
| List of records | `<Table>` + `TableHeader/Row/Cell` | raw `<table>` |
| Form in a window | `<Dialog>` | your own overlay logic |
| Confirmation before something destructive | `<AlertDialog>` | `confirm()` |
| Actions per row | `<DropdownMenu>` | a row of small buttons |
| Status, role, marker | `<Badge>`, `<RoleBadge>` | a coloured `<span>` |
| Empty list | `<EmptyState>` | a blank area |
| Page header | `<PageHeader>` | your own `<h1>` |
| What a new customer should do first | `<OnboardingChecklist>` | an overview that explains nothing |

Missing something? `npx shadcn@latest add <component>` — the kit is meant to grow
that way, and never by a component of your own beside it.

**Feedback has three mechanisms and never a fourth**, picked by *where the result
has to appear*: `<Callout>` (`components/ui/callout.tsx`) for what has to stay on
screen, `useActionToast(state)` (`hooks/use-action-toast.ts`) for a server action on
the same page, and `<FlashToast>` (`components/flash-toast.tsx`) for something that
ended in a `redirect()`. Server Actions return `{ error, ok }`; `<FlashToast>` fires
once and then strips its query parameter, so a reload does not repeat the message —
and **the message never travels in the URL**: the parameter carries a *reference*
(an id) the receiving page looks up, because a URL carrying the sentence itself lets
anybody make your app say whatever they typed. The worked example is
[`ux.md`](ux.md) → *Every action reports back*.

**Blueprint page: `app/dashboard/admin/users/`** — table, create dialog, row menu,
delete confirmation, toasts and translation in one piece. Whoever builds an admin
page looks there first.

**The home screen is built in.** `app/manifest.ts` serves
`/manifest.webmanifest`, and the app offers the icon once in the dashboard and
permanently in the user menu, only where it can actually happen. There is no service
worker and adding one is a decision, not a chore. What to say to somebody who asks
for "an app for my phone", and the iOS sign-in trap that comes with it, is
[`mobile.md`](mobile.md) → *First: an icon, or an app?*
