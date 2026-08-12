// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The whole surface, in one place: the core's tools plus whatever the installed
// modules contribute.
//
// `MODULE_SETUP_TOOLS` is GENERATED from the manifests (`node run.mjs module
// sync`) and checked in, like the other module registries — the deploy contract
// is `npm ci && npm run build` and nothing in it runs a generator. With no
// module installed it is empty, which is the shipped state.

import { CORE_SETUP_TOOLS } from "./tools";
import { MODULE_SETUP_TOOLS } from "@/lib/modules/setup-registry";
import type { SetupTool } from "./types";

/** Core first, then modules in installation order. Deterministic on purpose. */
export const ALL_SETUP_TOOLS: readonly SetupTool[] = [
  ...CORE_SETUP_TOOLS,
  ...MODULE_SETUP_TOOLS.flatMap((entry) => entry.TOOLS),
];

/**
 * The lookup the guard uses.
 *
 * 🚨 Built fresh per call rather than at module scope. A name collision between
 * the core and a module, or between two modules, is refused at `module sync`
 * (`loadModules()` clashes on tool names) — but a map frozen at import time
 * would also freeze a stale registry across a hot reload in development, and
 * the cost of rebuilding a map of a dozen entries is nothing.
 */
export function toolsByName(): ReadonlyMap<string, SetupTool> {
  return new Map(ALL_SETUP_TOOLS.map((tool) => [tool.name, tool]));
}

/**
 * The surface, described without running anything.
 *
 * This is what `scripts/mcp/server.mjs` turns into an MCP `tools/list`, so the
 * SCHEMA travels too — the server holds no domain knowledge and must not carry
 * a second copy of what the tools take. A module installed only in production
 * contributes tools a laptop's tree knows nothing about, and this is how the
 * agent learns about them: by asking the environment.
 */
export function describeTools(): {
  name: string;
  description: string;
  mutates: boolean;
  destructive: boolean;
  inputSchema: SetupTool["inputSchema"];
}[] {
  return ALL_SETUP_TOOLS.map(({ name, description, mutates, destructive, inputSchema }) => ({
    name,
    description,
    mutates,
    destructive: destructive === true,
    inputSchema,
  }));
}
