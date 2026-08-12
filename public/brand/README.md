# Your logo goes here

This folder holds the app's **brand mark** — the logo shown in the sidebar, in
the public header, and above the heading on the sign-in page. It ships empty,
and an empty folder is a perfectly good answer: the app then draws a small tile
with its **monogram** — one letter per word of the app's name, at most two, so
"Kraft Werk" becomes KW and "Kraftwerk" becomes K. That is what a fresh app
looks like, and it is a decision rather than a gap.

Put your logo here and name it in `config/brand.json`:

```json
{ "logo": "/brand/logo.svg", "logoWidth": 512, "logoHeight": 128 }
```

Or let the command do both, along with the five app icons:

```bash
node run.mjs brand icons --logo public/brand/logo.svg --apply
```

**Formats: `.svg`, `.png`, `.webp`.** The width and height are not optional —
without them the image has no intrinsic ratio and the header row jumps as the
page loads.

Add `logoDark` only if the light mark disappears on the dark background. One
file is the normal case.

## Why an SVG is allowed here, and nowhere else in this app

This app refuses SVG uploads at every door, for every role, because an SVG is a
document that can carry a script. Your own logo is the one exception, and it is
bounded rather than waved through:

- it is a **build-time file in your own repository**, put here by you — it never
  travels through the upload pipeline and is never a row in the `media` table;
- the app renders it **only through `<img>`**, where a browser runs an SVG in
  secure static mode: its script does not run and it fetches nothing;
- `next.config.ts` serves everything under `/brand/` with a
  `Content-Security-Policy` that forbids scripting outright — which covers the
  case `<img>` cannot, somebody opening `/brand/logo.svg` directly.

`components/brand-mark.test.ts` fails the build if any of that stops being true.
The full reasoning is in [`docs/design-system.md`](../../docs/design-system.md).

Files in this folder are **served publicly**, like everything under `public/`.
Do not put anything here that is not meant to be seen.
