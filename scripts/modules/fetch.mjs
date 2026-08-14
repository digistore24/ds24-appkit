// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Getting a module from somewhere that is not this tree, into a throwaway
// folder where it can be looked at before anything is decided.
//
// ── The channel is a download URL, and the module becomes a COPY ────────────
//
// Not npm, not git: a vendor puts a `.tar.gz` wherever it is reachable over
// HTTPS — their own site, a release asset, a bucket — and nobody needs an
// account anywhere. A tarball because `tar` is the archiver that is actually
// present everywhere a vendor might build one: Linux, macOS, Windows 10 and
// later (`tar.exe`), and Git Bash. A `zip` COMMAND is missing on a plain
// Windows and on lean Linux images, so it would be the format that is easy to
// click and awkward to script.
//
// 🚨 **What arrives is COPIED into `modules/<id>/`, never linked or depended
// on.** A real `node_modules` package would break four things at once: the
// tracing globs (which must be prefixed `modules/<id>/`), `availableModules()`
// (a `readdirSync` of `modules/`), the `pageExtensions` mechanism, and the
// eight test files that walk the tree. As a copy, nothing about the
// composition model changes — and the module's code lands in the customer's own
// repository, where it is readable, diffable and deletable. That is the only
// recourse anybody has against code that cannot be sandboxed, and it is worth
// more than any check in front of it.
//
// `fetch()` is the only way out to the network here: `curl` and `wget` are on
// `scripts/portability.test.ts`'s forbidden list, in as many words — *"fetch()
// — Node has it built in"*. Temp folders come from `mkdtempSync`, never
// `mktemp`, off the same list.
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { sniff, untar } from "./archive.mjs";

/** How large a module archive may be before this refuses to hold it in memory. */
const MAX_BYTES = 64 * 1024 * 1024;

/**
 * Where `module.json` really is, given a folder somebody unpacked.
 *
 * Almost every archiver wraps its contents in one top-level folder — the name
 * of the project, or the tag. So `module.json` at the root is the tidy case and
 * one directory down is the normal one. Anything deeper is not guessed at:
 * silently walking a tree looking for a manifest is how the wrong module gets
 * installed out of an archive that happened to contain two.
 *
 * @param {string} dir
 * @returns {string|null}
 */
export function moduleRootIn(dir) {
  if (existsSync(join(dir, "module.json"))) return dir;
  const inside = readdirSync(dir).filter((entry) => !entry.startsWith("."));
  if (inside.length === 1) {
    const nested = join(dir, inside[0]);
    if (statSync(nested).isDirectory() && existsSync(join(nested, "module.json"))) return nested;
  }
  return null;
}

/**
 * Fetch and unpack a source into a throwaway folder.
 *
 * @param {string} source an `https://…` URL, a local `.tar.gz`, or a local folder
 * @param {{ expectSha256?: string }} [options]
 * @returns {Promise<{ dir: string, origin: string, sha256: string|null, discard: () => void }>}
 */
export async function materialise(source, { expectSha256 } = {}) {
  const scratch = mkdtempSync(join(tmpdir(), "ds24-module-"));
  const discard = () => rmSync(scratch, { recursive: true, force: true });

  try {
    const isUrl = /^https?:\/\//i.test(source);
    let bytes = null;

    if (isUrl) {
      // ⚠️ Plain http is refused rather than warned about. The whole of this
      // command's honesty rests on the customer knowing WHERE the code came
      // from, and over http they do not know that — anybody on the path can
      // answer instead.
      if (!/^https:\/\//i.test(source)) {
        throw new Error("only https:// — over plain http anybody on the path can answer instead");
      }
      const response = await fetch(source, { redirect: "follow" });
      if (!response.ok) {
        throw new Error(`${source} answered ${response.status} ${response.statusText}`);
      }
      bytes = Buffer.from(await response.arrayBuffer());
    } else if (existsSync(source) && statSync(source).isDirectory()) {
      // A folder, which is what a vendor points at while writing the thing.
      cpSync(source, join(scratch, "unpacked"), { recursive: true });
      const root = moduleRootIn(join(scratch, "unpacked"));
      if (!root) throw new Error(`no module.json in ${source} or one folder below it`);
      return { dir: root, origin: resolve(source), sha256: null, discard };
    } else if (existsSync(source)) {
      bytes = readFileSync(source);
    } else {
      throw new Error(`${source} is neither an https:// URL nor a path that exists`);
    }

    if (bytes.length > MAX_BYTES) {
      throw new Error(`${bytes.length} bytes is more than a module — refusing to unpack it`);
    }

    // 🚨 The hash is of what ARRIVED, taken before anything is unpacked. It is
    // not a trust claim and this file never treats it as one — there is no
    // signature here and no key to check one against. What it is good for is
    // that the customer can compare it with what the vendor published, and that
    // it lands in the install record and therefore in their git diff.
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (expectSha256 && expectSha256.toLowerCase() !== sha256) {
      throw new Error(
        `the download hashes ${sha256}, and --sha256 said ${expectSha256.toLowerCase()}. ` +
          `Either the file changed or this is not the file that was meant.`,
      );
    }

    // 🚨 Read off the BYTES, so `.tgz`, `.tar.gz` and a URL with no extension
    // at all are the same question — and a proxy's HTML error page is caught
    // here rather than three steps later as "no module.json in the archive".
    const kind = sniff(bytes);
    if (kind === "zip") {
      throw new Error(
        "these bytes are a ZIP, and this command unpacks a tarball. Publish a .tar.gz — " +
          "`tar czf` on any of the three systems, including a Windows 10 or later and a " +
          "Git Bash.",
      );
    }
    if (kind === "bzip2" || kind === "xz") {
      // Named rather than lumped in with "not a tar", because the fix is one
      // flag on the vendor's side and an unhelpful message would send them
      // looking for something else entirely.
      throw new Error(
        `these bytes are ${kind}-compressed, and this unpacks gzip or a bare tar. Node has ` +
          `zlib built in and nothing for ${kind}, and supporting it would mean either a native ` +
          `dependency in every app or shelling out to tar — which is exactly the control over ` +
          `path traversal this reader exists to keep. Publish it as .tar.gz (\`tar czf\`).`,
      );
    }
    if (kind !== "gzip" && kind !== "tar") {
      throw new Error(
        "these bytes are not a tar archive. A URL that ends in .tar.gz is not a promise; " +
          "this reads the bytes themselves.",
      );
    }

    const unpacked = join(scratch, "unpacked");
    untar(bytes, unpacked);
    const root = moduleRootIn(unpacked);
    if (!root) {
      throw new Error("the archive holds no module.json, at its root or one folder below it");
    }
    return { dir: root, origin: source, sha256, discard };
  } catch (error) {
    discard();
    throw error;
  }
}
