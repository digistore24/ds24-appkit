// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What a pasted link to this app looks like in WhatsApp, Slack, LinkedIn or X.
//
// Next picks this file up by NAME — like `app/icon.png`, there is nothing to
// register. `app/twitter-image.tsx` re-exports it, so both cards are one file.
//
// ── Why it is generated rather than a shipped PNG ──────────────────────────
// A static placeholder would say "Your App" on every customer's link preview
// for ever, and it would say it in the one place they never look at their own
// app. That is exactly the failure `docs/design-system.md` §4 names for the
// five app icons — a rebranded app whose home-screen icon still shows the
// template's placeholder is the usual way somebody notices the job was half
// done — except a share card has no home screen to notice it on. Rendering from
// `APP_NAME` and the tokens means it is never stale.
//
// ── The mark comes from `app/icon.png`, deliberately ───────────────────────
// Not from `config/brand.json`. The brand mark there may be an SVG, and satori
// (what `ImageResponse` renders with) has its own idea of SVG; `app/icon.png`
// is a square raster that this template always ships and that
// `node run.mjs brand icons` regenerates from the operator's logo along with
// the other four. So the card follows a rebrand with no second asset to keep in
// step, and it works in a fresh app on the first request.
//
// ⚠️ No custom font. satori needs TTF/OTF and both of the app's own faces ship
// as woff2 (`@fontsource-variable/figtree` for the body, `…/source-serif-4` for
// the headings), so passing one would mean shipping a second copy of a typeface
// for one image — and passing the heading face would mean two. The card uses
// ImageResponse's built-in face; the app's own typography is unaffected, and
// nothing about this card changed when the heading family arrived. Worth
// knowing before somebody "fixes" the mismatch.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ImageResponse } from "next/og";

import { APP_NAME } from "@/lib/app";
import { OG_ACCENT, OG_BACKGROUND, OG_FOREGROUND } from "@/lib/pwa/manifest";

// The size every platform crops from. 630, not 628 — the number that gets
// "tidied" wrong.
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = APP_NAME;

/** Static: nothing here varies per request, so it is rendered once at build. */
export const dynamic = "force-static";

function markDataUri(): string | null {
  try {
    const bytes = readFileSync(join(process.cwd(), "app", "icon.png"));
    return `data:image/png;base64,${bytes.toString("base64")}`;
  } catch {
    // A missing icon is not a reason to have no share card at all.
    return null;
  }
}

export default async function OpengraphImage() {
  const mark = markDataUri();

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: OG_BACKGROUND,
          padding: 80,
        }}
      >
        {mark ? (
          // eslint-disable-next-line @next/next/no-img-element -- satori renders
          // to a PNG; there is no Next image pipeline inside an ImageResponse.
          <img src={mark} width={112} height={112} alt="" style={{ borderRadius: 24 }} />
        ) : (
          <div />
        )}

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              fontSize: 76,
              fontWeight: 600,
              color: OG_FOREGROUND,
              letterSpacing: "-0.02em",
            }}
          >
            {APP_NAME}
          </div>
          {/* The accent as a rule under the name — the one place the brand
              colour appears, and enough to make the card this app's rather
              than any app's. */}
          <div
            style={{
              marginTop: 32,
              width: 160,
              height: 10,
              borderRadius: 5,
              background: OG_ACCENT,
            }}
          />
        </div>
      </div>
    ),
    size,
  );
}
