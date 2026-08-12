// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

import { installedModules } from "./scripts/modules/installed.mjs";
import { modulePageExtensions } from "./scripts/modules/page-extensions.mjs";
import {
  SETUP_TRACING_ROUTE,
  mergeTracingIncludes,
  moduleTracingIncludes,
} from "./scripts/modules/inventory.mjs";

// Security headers, applied to every response.
//
// The one that does real work here is **Referrer-Policy**. This app puts
// single-use tokens in URLs — the Auth.js magic link, and the address-change
// confirmation link (app/account/confirm-email). A full `Referer` sent to
// another origin would carry that token out of the app, and the default a
// browser applies is not something to leave to the browser.
//
// Deliberately NOT here: a Content-Security-Policy for the app's own PAGES.
// Next.js emits inline scripts and styles, so a useful CSP needs per-request
// nonces threaded through the app rather than a static header, and a
// `unsafe-inline` policy pasted in to make it "green" would only look like
// protection. That is its own piece of work — do it properly or not at all.
// (`brandAssetHeaders` below is not that work and does not contradict it: a
// static file needs no nonce, so there its policy can be the strict one.)
const securityHeaders = [
  // No Referer to other origins beyond the bare origin — keeps link tokens in.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // No MIME sniffing: an uploaded or echoed file cannot talk a browser into
  // treating it as script.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // The app is never framed (no iframe anywhere in it), so clickjacking against
  // the money-adjacent admin pages and the account page is simply refused.
  { key: "X-Frame-Options", value: "DENY" },
  // Browsers ignore this over plain HTTP, so it costs local development
  // nothing and protects a real deployment from the first request on.
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
];

// The operator's own logo, under `public/brand/` — the ONE place this app
// accepts an SVG (`CLAUDE.md` § Media; the long form is docs/design-system.md).
//
// 🚨 These three lines are half of what makes that exception safe, and it is
// the half that is easy to miss. `components/brand-mark.tsx` renders the mark
// only through `<img src>`, where a browser runs an SVG in secure static mode —
// no script, no external fetches. But `public/` is served, so
// `https://<app>/brand/logo.svg` is also a URL somebody can NAVIGATE to, and
// there the same file arrives as a DOCUMENT with `image/svg+xml` and its script
// runs on this app's own origin. `<img>` cannot cover that; this header can.
//
// `default-src 'none'` forbids every subresource and `sandbox` (with no
// allow-list) drops the document into a unique opaque origin with scripting
// off. An `<img>` render is unaffected by either — the image is decoded, not
// executed. Costs nothing, and the file it protects is a file somebody else's
// designer may have exported.
//
// ⚠️ It is a response header, so it holds wherever this app answers the
// request — `next start`, which is every host in docs/DEPLOY.md. A CDN put in
// front of `public/` and serving those bytes itself would not send it; then the
// rule has to be repeated in the CDN, or the logo has to be a PNG.
const brandAssetHeaders = [
  {
    key: "Content-Security-Policy",
    value: "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  },
];

// The assistant reads her handbook from `content/knowledge/` at runtime, and
// Next.js only copies what it can SEE being imported. A `readdirSync` is
// invisible to that analysis, so with `output: "standalone"` the folder would
// simply be absent from the image — and the symptom is not a build error but
// an assistant who answers "I have no handbook" in production while working
// perfectly on the machine that built her. Harmless without standalone.
//
// Exported because a test has to read these keys as DATA: the proof that a
// module's entries ADD to them rather than replace them has to compose the
// real map, not match this file's source. Next reads only the default export,
// so a named one beside it changes nothing about the build.
export const CORE_TRACING_INCLUDES: Record<string, string[]> = {
  "/api/chat": ["./content/knowledge/**/*"],
  "/dashboard/chat": ["./content/knowledge/**/*"],
  // Same mechanism for the knowledge-media route's disk leg. The keys are
  // picomatch route globs, so the dynamic segment's brackets and dots are
  // escaped to match the route path literally (the form the Next docs show
  // for dynamic routes).
  "/api/knowledge-media/\\[\\.\\.\\.path\\]": [
    "./content/knowledge-media/**/*",
  ],
  // ── the content machinery, which the setup surface runs INSIDE the app ────
  //
  // `content_presence` (`lib/setup/tools.ts`) is served from `/api/setup`, and
  // getting to an answer walks four things Next cannot see: the module list
  // (`scripts/modules/installed.mjs` reads `config/modules.json` with
  // `readFileSync`), each installed module's manifest, the applier `.mjs` files
  // themselves — `lib/content/applier-presence.ts` imports them by path with
  // `webpackIgnore`, which is exactly a promise that the bundler will NOT carry
  // them — and the content tree those appliers read.
  //
  // 🚨 **What a real standalone build says today, because a claim about a build
  // that nobody built is worth nothing.** Measured on next 16.2.11: every path
  // below was ALREADY in `.next/standalone/` with this entry absent —
  // `config/modules.json`, `scripts/content/appliers/`, every
  // `modules/*/module.json`, and `content/media-manifest.json` too.
  // `@vercel/nft` partially evaluates our path arithmetic — an
  // `import.meta.url`-derived root, a `join(process.cwd(), …)` — and emits the
  // directory it inferred. So this entry is not repairing a hole that is open
  // right now, and saying otherwise would be inventing a symptom.
  //
  // ⚠️ **It is here because an inference is not a declaration.** What nft
  // recovers is the SHAPE of today's code: rewrite `_appliers.mjs` to take its
  // root from an argument, move a `join()` behind a helper, or let a bundler
  // release narrow that analysis, and the files leave the image with no build
  // error, no failing test and no line in any log. The failure mode is the one
  // `docs/content.md` is written against — `filesIn()` refuses, `safely()` turns
  // that into `unanswered`, and `content-check` goes red in production only.
  // Nothing else in this tree states the requirement, so nothing else would
  // notice. Written down, it holds whatever the tracer can work out.
  //
  // ⚠️ `./content/**/*` is the whole tree on purpose. The courses applier reads
  // `content/course/*.json` — the app root, not the module — and a module may
  // not trace a path outside `modules/<id>/` (`scripts/modules/manifest.mjs`),
  // so the core is the only one that CAN declare it. An installed module's own
  // applier directory arrives through its manifest instead; see
  // `applierTracing()` in `scripts/modules/inventory.mjs`.
  [SETUP_TRACING_ROUTE]: [
    "./config/modules.json",
    "./modules/*/module.json",
    "./scripts/content/**",
    "./content/**/*",
  ],
  // ── the security ladder, which the `check-advisories` JOB runs inside the app ─
  //
  // `lib/cron/security-record.ts` imports `scripts/security/check.mjs` and
  // `scripts/security/verdict.mjs` by absolute file URL with `webpackIgnore` —
  // which is exactly a promise that the bundler will NOT carry them — and the
  // rungs it then runs read `package-lock.json` off the disk. `verdict.mjs`
  // must be the real file for a second reason: `VERDICT_PATH` is derived from
  // its own `import.meta.url`, so a bundled copy would write the record into the
  // bundle's folder and there would be two writers of one record.
  //
  // 🚨 **What a real standalone build says today, measured rather than claimed.**
  // Built once on next 16.2.11 with this entry ABSENT: `package-lock.json`, the
  // whole `scripts/` tree (test files included), `lib/diagnostics/parse.mjs` and
  // `config/` were all already in `.next/standalone/`. So this entry is not
  // repairing a hole that is open right now — the same finding the setup entry
  // above records, and for the same reason: `@vercel/nft` partially evaluates
  // the path arithmetic in these files and emits the directory it inferred.
  //
  // ⚠️ **It is here because an inference is not a declaration.** What nft
  // recovers is the SHAPE of today's code. The failure mode if it stops
  // recovering it is silent in a way the others are not: the job throws, the
  // runner writes `failed` into `cron_runs`, and nothing looks at `cron_runs`
  // until somebody asks — which is the very silence this job exists to end.
  //
  // The measured closure of `check.mjs` is 31 files across six directories under
  // `scripts/` (`security/`, `lib/`, `db/`, `dev/`, `ds24/`, `modules/`) plus
  // `lib/diagnostics/parse.mjs`, and it MOVES whenever a rung is added — the
  // ladder grew from seven rungs to ten in one release. A per-file list would be
  // a list that rots silently, which is the failure this entry exists to
  // prevent, so the whole tree is declared: 2.5 MB, in an image whose
  // `node_modules` is two orders of magnitude larger.
  //
  // ⚠️ **The in-app scheduler reaches this same code from `instrumentation.ts`,
  // and that is NOT a route** — no key here can name it. What makes it work
  // anyway is that `outputFileTracingIncludes` is collected per route but the
  // standalone OUTPUT is one directory: files pulled in for `/api/cron` are in
  // the image, and `instrumentation.ts` reads them off the same disk. Verified
  // on the build above. Said plainly rather than implied, because a reader who
  // assumed the key covered the scheduler would delete it the day `/api/cron`
  // goes away.
  "/api/cron": [
    "./package-lock.json",
    "./config/modules.json",
    "./scripts/**",
    "./lib/diagnostics/parse.mjs",
  ],
};

const nextConfig: NextConfig = {
  // ── Which route files exist at all — see scripts/modules/page-extensions.mjs
  // A module's routes are named `page.<id>.tsx` / `route.<id>.ts` and become
  // routes only while that module is installed. With no module installed this
  // is exactly Next's default (`tsx`, `ts`), so an app without modules is
  // unaffected — which is the shipped state.
  //
  // Read from the disk rather than through `@/`: this file is evaluated before
  // any bundler exists, which is the same reason `scripts/modules/installed.mjs`
  // is a second reader beside `lib/modules/installed.ts`.
  //
  // 🚨 A malformed `config/modules.json` stops the build here, loudly, instead
  // of resolving to "no modules" — the argument is in `lib/modules/installed.ts`
  // and it is about an app quietly forgetting tables it still holds.
  pageExtensions: modulePageExtensions(installedModules()),

  // ── Server actions may carry a file, so the body cap has to allow one ─────
  // Next's default is 1 MB, which is below `config/media.json` → `kinds.image
  // .maxBytes` (10 MB) and below almost every photo a phone takes. The refusal
  // happens while Next decodes the payload — BEFORE the action runs — so it
  // cannot be caught, translated, or explained to the member: they get an
  // unhandled rejection and no number to work with.
  //
  // ⚠️ This is a GLOBAL ceiling: it applies to every server action in the app,
  // not only the one that takes a picture. That is the cost of the setting, and
  // it is accepted deliberately rather than overlooked — the alternative is a
  // per-action limit Next does not offer. It does NOT widen what may be
  // STORED: `config/media.json` still decides the per-kind ceiling, and
  // `acceptUpload()` still refuses anything above it. This only moves the point
  // of refusal to somewhere that can say why.
  experimental: {
    serverActions: { bodySizeLimit: "10mb" },
  },

  // Runs directly with `npm run start` (next start) on all four hosts in
  // docs/DEPLOY.md — Railway, Render, Fly.io and DigitalOcean.
  // For minimal Docker images, optionally set `output: "standalone"` and then
  // mit `node .next/standalone/server.js` starten.

  // The core's own entries are `CORE_TRACING_INCLUDES` above; on top of them
  // comes whatever an installed module reads at runtime. Its globs are refused
  // at the manifest unless they point inside the module itself — the paths
  // resolve from the APP root, so an unchecked one could quietly claim the
  // core's files.
  //
  // 🚨 **Merged into the core's map, never spread over it.** This was
  // `{ …core, ...moduleTracingIncludes() }`, and an object spread assigns per
  // KEY: a module contributing `/api/chat` replaced the core's
  // `./content/knowledge/**/*` instead of adding to it, so the handbook fell
  // out of a standalone image with no build error, no failing test and no line
  // in any log — the assistant simply answers "I have no handbook" in
  // production. `mergeTracingIncludes()` folds per key, and it is the same fold
  // `moduleTracingIncludes()` already performed module against module: it was
  // only the core's own entries that were merged with nothing.
  outputFileTracingIncludes: mergeTracingIncludes(
    CORE_TRACING_INCLUDES,
    moduleTracingIncludes(),
  ),

  // ── No `images.remotePatterns`, deliberately ─────────────────────────────
  // Media is served from the bucket rather than from this app, so the obvious
  // move is to allow the bucket's host here and let `next/image` resize. Two
  // things make that wrong, and a code review found both:
  //
  //  1. **This file is evaluated at BUILD time.** `MEDIA_S3_*` are secrets set
  //     in the hosting dashboard — at RUN time. On every host in
  //     `docs/DEPLOY.md` the pattern would bake as an empty list, and every
  //     bucket image would answer 400 in production while working perfectly in
  //     development, where the local driver serves from this origin.
  //  2. **A bucket endpoint is a SHARED host.** A pattern for
  //     `fra1.digitaloceanspaces.com` with no `pathname` matches `/**`, which
  //     turns `/_next/image` into an open resizing proxy for every bucket in
  //     that region — on the operator's CPU and egress.
  //
  // So bucket media goes to the browser unoptimised (`components/ui/figure.tsx`
  // decides that from the URL) and the limit lives in code rather than in an
  // environment variable somebody has to get right.
  //
  // **The cost, stated plainly and with no safety net behind it:** a large
  // picture reaches a phone at full size. Nothing in this repository catches
  // that. An earlier version of this comment said it was "exactly the finding
  // `ux-gateway` check 8 reports", and that was wrong in a way worth naming —
  // check 8 looks for an image NOT going through `next/image`, and `Figure`
  // does go through it, merely with `unoptimized`. The check cannot fire here.
  // Asserting a guard that does not exist is worse than admitting there is
  // none, because the next reader stops looking.
  //
  // The fix is to store a sensible size, not to resize on every request — the
  // upload ceilings in `config/media.json` are the closest thing to a brake,
  // and they bound the file rather than what a phone downloads.

  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // After the blanket rule, so the brand folder gets both sets.
      { source: "/brand/:path*", headers: brandAssetHeaders },
    ];
  },
};

// Wires next-intl into the app: i18n/request.ts supplies the locale + texts per
// request. Without this line `useTranslations()` finds no translations.
export default createNextIntlPlugin("./i18n/request.ts")(nextConfig);
