// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// "Is there anything newer for this app?" — asked once a day, by the greeting.
//
// This is the half of the update mechanism that works without anybody knowing it
// exists. `node run.mjs update` only helps somebody who has heard of it, and the
// people building on this template are told as little as possible on purpose. So
// the session greeting mentions it — once, in one line, and only when there is
// actually something to fetch.
//
// Four properties, all deliberate:
//
//   **Never fatal.** It sits in front of every session. A hook that throws
//   greets somebody with a stack trace, and being offline is a normal state.
//   Everything here resolves to "say nothing".
//   **Once a day.** The answer is cached in .dev/, so 20 sessions cost one
//   request.
//   **It sends nothing.** One GET of a static file, no query string, no body,
//   no identifier. What the server learns is that some IP fetched a public URL.
//   **It can be switched off** — `TEMPLATE_UPDATE_CHECK=off` in the `.env`. See
//   docs/updates.md.
//
// It answers with the SAME logic `node run.mjs update` uses (planUpdate), so the
// number in the greeting is the number of files that command would write. A
// second, looser notion of "new" would eventually contradict the first.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { guidanceWritable, normalizeText, planUpdate } from "./update-plan.mjs";

const CACHE = ".dev/update-check.json";
const DAY = 24 * 60 * 60 * 1000;

/** Time to ask again? An unreadable or malformed cache counts as yes. */
export function isDue(cache, now, ttl = DAY) {
  const checkedAt = Number(cache?.checkedAt);
  if (!Number.isFinite(checkedAt)) return true;
  // A clock that moved backwards (a restored machine, a different timezone
  // written into the file) would otherwise park the check in the future for ever.
  if (checkedAt > now) return true;
  return now - checkedAt >= ttl;
}

/**
 * The greeting's line, or null when there is nothing worth saying.
 *
 * Takes `null` as readily as an object: that is what `updateAvailable()` answers
 * in every case it cannot decide, and a default parameter does NOT cover it —
 * defaults apply to `undefined` only. Destructuring in the signature threw here
 * on the first real run, in the hook, which is the one place in this project
 * where an exception is printed instead of a greeting.
 */
export function describe(result) {
  const { available, version } = result ?? {};
  if (!available) return null;
  return (
    `[Template: ${version} is newer than this app — ${available} guidance file(s) ` +
    `(CLAUDE.md, docs, skills) have been improved since. ` +
    `Offer it: node run.mjs update]`
  );
}

// normalizeText: the hash describes the CONTENT, not the line endings this
// machine happens to store it with — see update-plan.mjs.
const sha256 = (text) => createHash("sha256").update(normalizeText(text), "utf8").digest("hex");

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

/** Park the answer in .dev/ for the day. A failure here is not worth a word. */
function remember(result) {
  try {
    mkdirSync(".dev", { recursive: true });
    writeFileSync(CACHE, `${JSON.stringify(result)}\n`);
  } catch {
    /* then it asks again next session */
  }
}

/**
 * How many guidance files an update would write, plus the template version they
 * come from. `null` whenever the question cannot be answered — no stamp, no
 * network, switched off, malformed anything.
 */
export async function updateAvailable(now = Date.now()) {
  try {
    if (String(process.env.TEMPLATE_UPDATE_CHECK ?? "").toLowerCase() === "off") return null;

    let cache = null;
    try {
      cache = readJson(CACHE);
    } catch {
      /* first run, or somebody deleted .dev/ */
    }
    if (!isDue(cache, now)) return cache.available > 0 ? cache : null;

    const stamp = readJson(".template-version");
    const codeVersion = readJson("package.json").version;

    // A "no" is remembered for the same day as a "yes". Without that, every
    // session start of an offline machine — or one whose manifest is not
    // published yet — pays for a request that already failed today.
    const quiet = () => {
      remember({ checkedAt: now, version: stamp.version, available: 0 });
      return null;
    };

    let response;
    try {
      response = await fetch(stamp.source, { signal: AbortSignal.timeout(2500) });
    } catch {
      return quiet();
    }
    if (!response.ok) return quiet();
    const remote = await response.json();

    const local = {};
    for (const file of new Set([
      ...Object.keys(remote.files ?? {}),
      ...Object.keys(stamp.files ?? {}),
    ])) {
      let current = null;
      try {
        current = sha256(readFileSync(file, "utf8"));
      } catch {
        /* not in this copy */
      }
      local[file] = { current, shipped: stamp.files?.[file] ?? null };
    }

    // A skill's `requires:` can only be read from its own text, and the greeting
    // gets one request and no more — so a skill that needs newer code is counted
    // here and turned away by `update` itself. Being one too optimistic in the
    // count is much the cheaper error.
    const result = {
      checkedAt: now,
      version: remote.version ?? "?",
      // guidanceWritable, the same rule `update` writes by: a manifest offering
      // a path outside the guidance tree is one `update` refuses whole, so
      // counting its files here would advertise an update that cannot happen.
      // It throws, the catch below turns that into `null`, and the greeting says
      // nothing — which is this function's answer to everything it cannot
      // decide, and the right one in front of every session.
      available: guidanceWritable(planUpdate({ local, remote: remote.files ?? {}, codeVersion }))
        .length,
    };
    remember(result);
    return result.available > 0 ? result : null;
  } catch {
    return null;
  }
}
