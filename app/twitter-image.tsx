// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The same card, for X. It is a re-export rather than a second design: X falls
// back to `og:image` when there is no `twitter:image`, and "falls back" is an
// assumption about somebody else's crawler — this makes it a fact.
export { default, size, contentType, alt } from "./opengraph-image";
