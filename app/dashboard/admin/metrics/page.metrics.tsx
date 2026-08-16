// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The declaration that makes the module's page a route.
//
// The `.metrics.` in the filename is the switch: `next.config.ts` builds its
// `pageExtensions` from the installed modules, so without the module Next sees
// no route here at all — a real 404 rather than a handler that refuses.
// `modules/boundary.test.ts` requires this file to do nothing but delegate.
export { default, generateMetadata } from "@/modules/metrics/admin/page";
