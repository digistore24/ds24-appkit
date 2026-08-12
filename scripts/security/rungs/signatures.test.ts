// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The signature rung, minus npm.
//
// ⚠️ **This file is pure on purpose, and that is a rule rather than a taste.**
// `vitest.config.ts` includes `**/*.test.ts`, so anything placed beside the code
// runs inside every `npm run test` — and `security-check` must never become a
// gate (CLAUDE.md, and check.mjs's own header). Nothing below spawns a process,
// touches the network or reads a file. What the rung does against a real npm is
// proven by running the command; what lives here is the two decisions it makes
// about an answer it has already been handed:
//
//   1. is this an ANSWER at all (both arrays), or a reason it could not look,
//   2. and how is an entry of each list rated.
//
// 🚨 Both are filters, and a filter that has quietly started rejecting
// everything passes a suite written around emptiness without a word. So one
// planted `invalid` entry MUST come through as a ❌ HIGH finding — the needle
// below — and one planted `missing` entry as a ⚠️ MEDIUM one.
//
// Nothing here asserts how many packages this tree has or how many findings it
// produces. Those are facts about today; the shapes are the truth.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { blankComments } from "../../lib/source-text.mjs";

import {
  EVIDENCE,
  NPM_WITH_ROTATED_KEYS,
  ROTATED_KEY_CODE,
  findingsFrom,
  generalise,
  invalidFinding,
  missingFinding,
  readSignatures,
  signatures,
} from "./signatures.mjs";

// ── fixtures ────────────────────────────────────────────────────────────────

/** `capture()`'s shape. Everything the rung ever sees comes in like this. */
const answer = (
  code: number,
  stdout = "",
  stderr = "",
): { code: number; stdout: string; stderr: string } => ({ code, stdout, stderr });

/** An entry, as npm's `makeJSON` writes it (audit.js:323-333). */
const ENTRY = {
  name: "left-pad",
  version: "1.3.0",
  location: "node_modules/left-pad",
  resolved: "https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz",
  integrity: "sha512-XI5MPzVNApjAyhQzphX8BkmKsKUxD4LdyK24iZeQGinBN9yTQT3bFlCBy/aVx2HrNcqQGsdot8ghrjyrvMCoEA==",
  signature: "MEUCIQ…",
  keyid: "SHA256:jl3bwswu80PjjokCgh0o2w5c2U4LhQAE57gj9cz1kzA",
  registry: "https://registry.npmjs.org/",
};

/** The success shape, and it really is only these two keys (audit.js:65-71). */
const REPORT = { invalid: [ENTRY], missing: [{ ...ENTRY, name: "right-pad", signature: undefined }] };

/**
 * The two error bodies this tree really produced, days apart.
 *
 * They are both here because they are the argument for a STRUCTURAL
 * discriminator: two completely different sentences, one machine, one command —
 * so a rung that recognised npm's wording would have recognised the first and
 * been surprised by the second.
 */
const NOTHING_INSTALLED = JSON.stringify({
  error: {
    code: null,
    summary: "found no dependencies to audit that where installed from a supported registry",
    detail: "",
  },
});

const EXPIRED_KEY = JSON.stringify({
  error: {
    code: "EEXPIREDSIGNATUREKEY",
    summary:
      "class-variance-authority@0.7.1 has a registry signature with keyid: SHA256:jl3bwswu80PjjokCgh0o2w5c2U4LhQAE57gj9cz1kzA but the corresponding public key has expired 2025-01-29T00:00:00.000Z",
    detail: "",
  },
});

/**
 * The third body, produced for real on 2026-08-12 with
 * `npm audit signatures --json --registry http://127.0.0.1:1/`.
 *
 * It is here because it is the state the expired-key one is CONFUSED WITH. Both
 * are `⏭ NOT ASKED`, both are permanent while their cause lasts, and an operator
 * does something completely different about each: this one clears itself when the
 * network comes back, the other one never does until somebody updates npm.
 */
const REGISTRY_UNREACHABLE = JSON.stringify({
  error: {
    code: "ECONNREFUSED",
    summary:
      "FetchError: request to http://127.0.0.1:1/-/npm/v1/keys failed, reason: connect ECONNREFUSED 127.0.0.1:1",
    detail: "\nIf you are behind a proxy, please make sure that the\n'proxy' config is set properly.",
  },
});

// ── is this an answer at all ────────────────────────────────────────────────

describe("readSignatures takes both arrays as the discriminator, never the exit code", () => {
  it("reads a report as an answer even though npm exited 1 over it", () => {
    // Exit 1 is what npm returns when either list is non-empty (audit.js:60-63).
    // Treating that as a failure would turn every real finding into a skip.
    const read = readSignatures(answer(1, JSON.stringify(REPORT)));
    expect(read.report?.invalid).toHaveLength(1);
    expect(read.reason).toBe("");
  });

  it("reads an empty report — both arrays present and empty — as an answer", () => {
    const read = readSignatures(answer(0, JSON.stringify({ invalid: [], missing: [] })));
    expect(read.report).not.toBeNull();
    expect(read.reason).toBe("");
  });

  it("refuses a body carrying only one of the two arrays", () => {
    // Half a shape is not this command's shape, and guessing which half is
    // missing is how a rung reports clean because it misread something else.
    expect(readSignatures(answer(0, JSON.stringify({ invalid: [] }))).report).toBeNull();
    expect(readSignatures(answer(0, JSON.stringify({ missing: [] }))).report).toBeNull();
  });
});

describe("a skip carries the reason it could not look, and the four are kept apart", () => {
  it("names a missing npm rather than blaming the registry", () => {
    // capture()'s 127. One is fixed by installing something, the other by
    // waiting — the same split ../npm-audit.mjs makes.
    const read = readSignatures(answer(127, "", "spawn npm ENOENT"));
    expect(read.report).toBeNull();
    expect(read.reason).toContain("PATH");
  });

  it("uses npm's own summary verbatim — the empty tree, measured", () => {
    const read = readSignatures(answer(1, NOTHING_INSTALLED));
    expect(read.report).toBeNull();
    expect(read.reason).toBe(
      "found no dependencies to audit that where installed from a supported registry",
    );
  });

  it("says whose problem the expired key is, and names the act that clears it", () => {
    // npm 9 gives up on the WHOLE tree over one retired signing key
    // (pMap stopOnError). Nothing was verified, so nothing may be reported as
    // verified — and this must read as a skip, never as a clean pass.
    //
    // 🚨 The package name comes OUT, and so does npm's sentence. The package is
    // whichever of twenty parallel checks failed first — measured, the same tree
    // named `clsx@2.1.1` in one session and `class-variance-authority@0.7.1` in
    // another — so it is not a fact about that package. And npm's sentence
    // describes the wrong thing entirely: the registry rotated its key and is
    // serving a current one, so the fact here is about the npm running this.
    const read = readSignatures(answer(1, EXPIRED_KEY));
    expect(read.report).toBeNull();
    expect(read.reason).not.toContain("class-variance-authority");
    expect(read.reason).not.toContain("has expired");
    // The npm CODE is the part that IS a fact, and it is what somebody searches.
    expect(read.reason).toContain(ROTATED_KEY_CODE);
    // The act, and the npm that has it. Without these the operator reads a
    // permanent block with nothing to do about it — which is how a ⏭ block
    // becomes furniture and takes the real skips with it.
    expect(read.reason).toContain("Update npm");
    expect(read.reason).toContain(`npm ${NPM_WITH_ROTATED_KEYS}+`);
    expect(read.reason).toContain("waiting will not clear it");
  });

  it("names the running npm when it has been measured, and holds the sentence when it has not", () => {
    // The version is spawned only on this branch, and it must never be the
    // reason the branch falls over: no version means a sentence without a
    // number, not a blank reason and not a throw.
    const withVersion = readSignatures(answer(1, EXPIRED_KEY), { npmVersion: "9.2.0" });
    expect(withVersion.reason).toContain("this npm (9.2.0) is older");
    const without = readSignatures(answer(1, EXPIRED_KEY));
    expect(without.reason).toContain("this npm is older");
    expect(without.reason).not.toContain("this npm (");
    expect(without.reason).toContain("Update npm");
  });

  it("says the registry never answered when the registry never answered", () => {
    // Produced for real against `--registry http://127.0.0.1:1/`. npm hands the
    // code straight through from Node's network stack.
    const read = readSignatures(answer(1, REGISTRY_UNREACHABLE));
    expect(read.report).toBeNull();
    expect(read.reason).toContain("ECONNREFUSED");
    expect(read.reason).toContain("the registry did not answer");
    expect(read.reason).toContain("not this app");
    expect(read.reason).toContain("try again when you are back on it");
  });

  it("an unrecognised error code keeps npm's own sentence rather than inventing a diagnosis", () => {
    // The failure direction of the code lists is "less diagnosis", never a WRONG
    // one: anything not in them falls through to what shipped before.
    const read = readSignatures(
      answer(1, JSON.stringify({ error: { code: "ESOMETHINGNEW", summary: "left-pad@1.3.0 went sideways" } })),
    );
    expect(read.reason).toBe("ESOMETHINGNEW: a package went sideways");
  });

  it("leaves a summary that names no package exactly as npm wrote it", () => {
    // `generalise` must not chew on an ordinary sentence: this one is the
    // measured empty-tree answer, and every word of it is npm's.
    expect(generalise("found no dependencies to audit", null)).toBe("found no dependencies to audit");
    expect(generalise("@scope/pkg@1.2.3-beta.1 went wrong", "ECODE")).toBe("ECODE: a package went wrong");
    expect(generalise("", "ECODE")).toBe("");
  });

  it("says so when this npm is too old to know the subcommand", () => {
    const read = readSignatures(answer(1, "", 'npm ERR! Unknown command: "signatures"'));
    expect(read.report).toBeNull();
    expect(read.reason).toContain("8.13");
  });

  it("falls back to the first line of stderr for a body that does not parse", () => {
    const read = readSignatures(answer(1, "<html>502 Bad Gateway</html>", "npm ERR! network timeout\nmore"));
    expect(read.report).toBeNull();
    expect(read.reason).toBe("npm ERR! network timeout");
  });

  it("still says something when nothing said anything — a blank reason is a crash", () => {
    // `aggregate()` throws on a skip whose reason is blank, whitespace included.
    const read = readSignatures(answer(1));
    expect(read.report).toBeNull();
    expect(read.reason.trim().length).toBeGreaterThan(0);
  });
});

// ── how an entry is rated ───────────────────────────────────────────────────

describe("invalid is the strong claim, missing is a fact about signing keys", () => {
  it("rates an invalid signature ❌ HIGH and says the bytes differ", () => {
    const finding = invalidFinding(ENTRY);
    expect(finding.severity).toBe("high");
    expect(finding.where).toBe("left-pad@1.3.0");
    expect(finding.why).toContain("not the bytes the registry signed");
  });

  it("rates a missing signature ⚠️ MEDIUM and never calls it tampering", () => {
    const finding = missingFinding(ENTRY);
    expect(finding.severity).toBe("medium");
    // The registry publishes keys for it and this tarball has none. Plenty of
    // good releases predate the registry signing anything at all.
    expect(finding.why).toContain("not that anything is wrong with it");
    // The word appears exactly once and NEGATED, in the Fix. That is the whole
    // difference between this finding and the one above it — asserting the word
    // is simply absent would pass a version that had stopped saying so.
    expect(`${finding.title} ${finding.why}`.toLowerCase()).not.toContain("tamper");
    expect(finding.fix).toContain("not evidence of tampering");
  });

  it("names the keyid and the registry npm gave, and omits them where it did not", () => {
    expect(invalidFinding(ENTRY).evidence).toContain("SHA256:jl3bwswu80PjjokCgh0o2w5c2U4LhQAE57gj9cz1kzA");
    expect(invalidFinding({ name: "a", version: "1" }).evidence).toContain("npm audit signatures");
  });

  it("carries no advisory id, so nothing here can ever be accepted", () => {
    // `partitionAccepted()` keys on `id`, and there is no advisory database
    // behind this rung. An exemption for "the signature does not verify" is not
    // something anybody should be able to write down.
    expect(invalidFinding(ENTRY).id).toBeUndefined();
    expect(missingFinding(ENTRY).id).toBeUndefined();
  });

  it("fills every field the renderer prints", () => {
    // A finding missing one renders as a blank line under a label, which reads
    // like nothing being wrong.
    for (const finding of [invalidFinding(ENTRY), missingFinding(ENTRY)]) {
      for (const field of ["severity", "title", "where", "why", "fix", "evidence", "source"] as const) {
        expect(String(finding[field] ?? "")).not.toBe("");
      }
    }
  });
});

// ── the evidence line ───────────────────────────────────────────────────────

describe("the evidence names the command and claims no count", () => {
  it("names what was run", () => {
    expect(EVIDENCE).toContain("npm audit signatures --json");
  });

  it("carries no number at all — the verified count is not in the JSON", () => {
    // `verifiedCount` exists only in npm's HUMAN output (audit.js:81-88). A
    // number recalled rather than measured is how a report starts lying
    // quietly, and "N packages verified" is the number a reader trusts most.
    expect(EVIDENCE).not.toMatch(/\d/);
    expect(EVIDENCE).toContain("no count");
  });
});

// ── 🚨 the needle ───────────────────────────────────────────────────────────

describe("🚨 a planted entry really comes through as a finding", () => {
  // Both decisions above are filters: `readSignatures` can reject an answer and
  // `findingsFrom` can drop a list. Either one quietly rejecting EVERYTHING
  // makes a suite written around emptiness pass in full. So the planted needle:
  // one invalid and one missing entry, all the way from npm's bytes to a rated
  // finding.
  const read = readSignatures(answer(1, JSON.stringify(REPORT)));
  const findings = findingsFrom(read.report ?? { invalid: [], missing: [] });

  it("survives the parse and arrives rated, worst first", () => {
    expect(findings.map((finding) => finding.severity)).toEqual(["high", "medium"]);
    expect(findings[0].where).toBe("left-pad@1.3.0");
    expect(findings[1].where).toBe("right-pad@1.3.0");
    expect(findings[0].source).toBe("npm audit signatures");
  });

  it("finds nothing in an answer that really is empty", () => {
    // The other half of the needle: a `findingsFrom` that invented findings
    // would be just as broken as one that dropped them.
    expect(findingsFrom({ invalid: [], missing: [] })).toEqual([]);
    expect(findingsFrom(null as never)).toEqual([]);
  });
});

// ── 🚨 the second needle ────────────────────────────────────────────────────

describe("🚨 the reasons a rung could not look stay TOLD APART", () => {
  // The defect this replaces was not a wrong answer. It was four `⏭ NOT ASKED`
  // blocks that read identically, one of which was there on every run of every
  // day — and a block that is always there is a block nobody reads, which takes
  // the real skips down with it.
  //
  // 🚨 A test that only asserted "the reason mentions EEXPIREDSIGNATUREKEY"
  // would pass a version in which the classification had stopped matching
  // entirely: the generic fall-through puts npm's code in front of npm's
  // sentence, so it contains that string too. What cannot be faked by falling
  // through is the ACT. So the needle is the act, one per state, all distinct.

  const states = [
    { what: "the registry never answered", body: answer(1, REGISTRY_UNREACHABLE), act: "try again when you are back on it" },
    { what: "the registry answered and npm is too old", body: answer(1, EXPIRED_KEY), act: "Update npm" },
    { what: "there is nothing installed to verify", body: answer(1, NOTHING_INSTALLED), act: "" },
    { what: "npm is not on the PATH", body: answer(127, "", "spawn npm ENOENT"), act: "PATH" },
  ] as const;

  it("every one of them is a skip — none of them is ever an answer", () => {
    for (const state of states) {
      const read = readSignatures(state.body);
      expect(read.report, state.what).toBeNull();
      expect(read.reason.trim().length, state.what).toBeGreaterThan(0);
    }
  });

  it("each names its own act, and no two sentences are the same", () => {
    const reasons = states.map((state) => readSignatures(state.body).reason);
    expect(new Set(reasons).size).toBe(states.length);
    for (const [index, state] of states.entries()) {
      if (state.act) expect(reasons[index], state.what).toContain(state.act);
    }
  });

  it("🚨 the two that are confused with each other share NO act at all", () => {
    // The whole point. "I was offline" clears itself by waiting; "this npm is
    // too old" never does. A future edit that collapsed them into one sentence
    // — or that let the rotated key fall through to npm's own prose again —
    // breaks here rather than in six months in somebody's terminal.
    const offline = readSignatures(answer(1, REGISTRY_UNREACHABLE)).reason;
    const tooOld = readSignatures(answer(1, EXPIRED_KEY)).reason;

    expect(offline).toContain("try again when you are back on it");
    expect(offline).not.toContain("Update npm");

    expect(tooOld).toContain("Update npm");
    expect(tooOld).toContain("waiting will not clear it");
    expect(tooOld).not.toContain("try again when you are back on it");

    // And neither of them blames the app, because neither of them is about it.
    for (const reason of [offline, tooOld]) expect(reason).toContain("not this app");
  });

  it("🚨 the rotated-key sentence is not npm's sentence — the fall-through would be", () => {
    // `generalise()` is what the generic branch produces. If the classification
    // ever stops matching, THIS is what comes out instead, and it is the thing
    // that misdiagnosed the state for a year: npm's own prose about the registry
    // and an innocent package.
    const fellThrough = generalise(JSON.parse(EXPIRED_KEY).error.summary, ROTATED_KEY_CODE);
    expect(readSignatures(answer(1, EXPIRED_KEY)).reason).not.toBe(fellThrough);
    expect(fellThrough).toContain("has expired");
  });
});

// ── the rung's own declaration ──────────────────────────────────────────────

describe("the rung declares itself the way the aggregator reads it", () => {
  it("is tier 1 — npm is here because this is a Node app", () => {
    // `tier` separates "needs nothing installed" from "needs a TOOL that may be
    // absent". A missing node_modules is a skip with a reason, which is the
    // mechanism that already covers it.
    expect(signatures.tier).toBe(1);
    expect(signatures.id).toBe("signatures");
  });

  it("says what it would have covered, in words, not by repeating its name", () => {
    expect(signatures.covers.length).toBeGreaterThan(20);
    expect(signatures.covers).not.toBe(signatures.label);
  });
});

describe("🚨 the 'is anything installed' question has one owner", () => {
  // This rung once carried its own copy — written independently, on the same
  // afternoon, while another story extracted the same predicate two directories
  // away. The two agreed on the happy path and DISAGREED in the catch: an
  // unreadable node_modules meant "something is installed" over there and
  // "nothing is installed" here, so this rung would have told an operator to run
  // `npm install` over a folder nobody could read. One owner, one catch branch.
  const source = blankComments(
    readFileSync(join(import.meta.dirname, "signatures.mjs"), "utf8"),
  );

  it("asks the shared predicate", () => {
    expect(source).toContain('import { hasInstalledTree } from "../npm-audit.mjs"');
  });

  it("does not read node_modules itself", () => {
    // The needle is the LISTING, not the folder name: this rung names
    // `node_modules` legitimately in a fix instruction ("Delete node_modules and
    // the package's cache entry"), and a needle that catches prose is a needle
    // somebody deletes. A second copy of the predicate cannot avoid reading the
    // directory.
    expect(source).not.toContain("readdirSync");
  });
});
