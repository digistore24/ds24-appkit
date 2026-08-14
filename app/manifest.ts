// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Next's file convention: this becomes `/manifest.webmanifest`, and Next puts
// `<link rel="manifest">` on every page by itself — there is nothing to
// register in `app/layout.tsx`, which is also why no <head> is written there
// (`app/darkreader-lock.test.ts` pins that rule).
//
// It is PUBLIC and has to stay public: a browser fetches it before anybody is
// signed in, and on iOS while the user is standing in the share sheet. Nothing
// guards it and nothing should — it holds the app's name, its colours and three
// icon paths. `proxy.ts`'s matcher does not reach it, and
// `app/route-protection.test.ts` scans `page.*` / `route.*` only, so this file
// needs no PUBLIC entry.
//
// What it SAYS lives in `lib/pwa/manifest.ts` and is asserted there — see that
// file's header for why the split exists.
import { headers } from "next/headers";
import type { MetadataRoute } from "next";

import { buildManifest, originFrom } from "@/lib/pwa/manifest";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  // Reading a header opts this route out of static generation, deliberately:
  // `related_applications[].url` has to name THIS origin, and the app has no
  // build-time knowledge of its own address. One small response per install
  // check. ⚠️ NOT the stance the sign-in link takes — that one comes from
  // `APP_URL` (lib/auth/auth-url.mjs), because it is read by somebody holding a
  // mail rather than by a browser standing on this page.
  const requestHeaders = await headers();
  return buildManifest(
    originFrom({
      host: requestHeaders.get("host"),
      forwardedHost: requestHeaders.get("x-forwarded-host"),
      forwardedProto: requestHeaders.get("x-forwarded-proto"),
    }),
  );
}
