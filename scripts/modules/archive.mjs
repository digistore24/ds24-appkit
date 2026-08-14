// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Unpacking a `.tar.gz` somebody else made, without trusting a single field in it.
//
// ── Why this is written here rather than shelled out to `tar` ───────────────
//
// 🚨 **An archive from the network is hostile input, and the interesting field
// is the file NAME.** An entry called `../../.env` or `/etc/passwd` writes
// outside the folder it was unpacked into; a symlink entry pointing at `/`
// followed by an entry that writes "through" it does the same thing in two
// steps. GNU tar and bsdtar answer those differently and have changed their
// answers between versions — so the refusal is ours, written down, and it is
// the same one `manifest.mjs` already makes about a module's tracing globs:
// nothing may point out of the folder it belongs to.
//
// The second reason is smaller and still real: shelling out means a tool whose
// version nobody here knows, and `node run.mjs doctor` does not ask for one.
//
// `zlib` is built in and the tar format is 512-byte headers, so there is
// nothing to install and nothing to parse that needs a library. What this
// reader does NOT do is as important as what it does, and each omission is a
// refusal rather than a silent skip: no symlinks, no hard links, no device
// nodes, no absolute paths, no base-256 sizes.
import { gunzipSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

/** One tar block. Everything in the format is a whole number of these. */
const BLOCK = 512;

/** Type flags this reader accepts, and what they mean. */
const FILE_TYPES = new Set(["0", "\0"]);
const DIRECTORY_TYPE = "5";
/** Extended headers: metadata about the NEXT entry, not an entry of its own. */
const PAX_TYPES = new Set(["x", "g"]);
/** GNU's answer to a name longer than 100 bytes: the name is the entry's body. */
const GNU_LONGNAME = "L";

class ArchiveError extends Error {}

/**
 * What kind of archive these bytes are, by their magic — never by the URL.
 *
 * 🚨 **The extension is not consulted, and that is the point.** `.tgz` and
 * `.tar.gz` are the same bytes under two names; a URL ending in `.tar.gz` may
 * hand back an HTML error page from a proxy. So the name decides nothing here
 * and the caller never has to keep a list of spellings.
 *
 * `bzip2` and `xz` are RECOGNISED and not supported, which is a different thing
 * from unrecognised: they get named, so the answer is "publish a .tar.gz"
 * rather than "this is not a tar archive".
 */
export function sniff(bytes) {
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) return "gzip";
  if (bytes.length >= 3 && bytes.toString("latin1", 0, 3) === "BZh") return "bzip2";
  // xz: FD 37 7A 58 5A 00
  if (bytes.length >= 6 && bytes.toString("latin1", 0, 6) === "\xfd7zXZ\0") return "xz";
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
    if ((bytes[2] === 0x03 && bytes[3] === 0x04) || (bytes[2] === 0x05 && bytes[3] === 0x06)) {
      return "zip";
    }
  }
  // An uncompressed tar has `ustar` at offset 257 of its first header.
  if (bytes.length >= 262 && bytes.toString("latin1", 257, 262) === "ustar") return "tar";
  return null;
}

/**
 * Is `name` safe to write under a target directory?
 *
 * Returns the reason it is not, or `null`. Checked on the STRING first and on
 * the resolved path second: the string test is what a reader can argue with,
 * and the resolve is what catches the case nobody thought of.
 */
function unsafeEntry(name) {
  if (name.length === 0) return "an entry with no name";
  if (name.startsWith("/") || name.startsWith("\\")) return `"${name}" is an absolute path`;
  if (/^[a-zA-Z]:/.test(name)) return `"${name}" names a drive`;
  // A backslash is not a path separator in a tar entry — the format says
  // forward slashes — so one here is either a tool being sloppy or somebody
  // hoping this code splits on `/` and the filesystem does not.
  if (name.includes("\\")) return `"${name}" contains a backslash`;
  if (name.split("/").includes("..")) return `"${name}" climbs out of the archive`;
  if (name.includes("\0")) return `"${name}" contains a null byte`;
  return null;
}

/** An octal field, as tar writes them: digits, then a NUL or a space. */
function octal(block, from, length, what) {
  const raw = block.subarray(from, from + length);
  // 🚨 The high bit means GNU's base-256 encoding, used for sizes and ids that
  // do not fit in octal. Reading it as octal would produce a number with no
  // relation to the truth, so it is refused — a module is kilobytes.
  if ((raw[0] & 0x80) !== 0) throw new ArchiveError(`${what} is base-256 encoded — too large for a module`);
  const text = raw.toString("latin1").replace(/[\0 ]+$/, "").trim();
  if (text === "") return 0;
  if (!/^[0-7]+$/.test(text)) throw new ArchiveError(`${what} is not an octal number`);
  return Number.parseInt(text, 8);
}

/**
 * The header's own checksum, which is what tells a truncated download from a
 * short file. Cheap, and the only integrity the format offers.
 */
function checksumMatches(block) {
  const stored = octal(block, 148, 8, "the header checksum");
  let signed = 0;
  let unsigned = 0;
  for (let at = 0; at < BLOCK; at++) {
    // The checksum field itself counts as spaces while it is being computed.
    const byte = at >= 148 && at < 156 ? 0x20 : block[at];
    unsigned += byte;
    signed += byte > 127 ? byte - 256 : byte;
  }
  return stored === unsigned || stored === signed;
}

/**
 * Unpack a `.tar` (or `.tar.gz`) into `target`, refusing anything that would
 * write outside it.
 *
 * @param {Buffer} bytes the archive, gzipped or not
 * @param {string} target absolute path of a directory to write into
 * @returns {string[]} the relative paths written, sorted
 */
export function untar(bytes, target) {
  // 🚨 Asked BEFORE the loop, because the loop's answer to rubbish is silence.
  // The walk is `while (at + 512 <= length)`, so anything shorter than one
  // block — a 404 page, a truncated download, an HTML error from a proxy —
  // simply never enters it and `untar` returns an empty list as if the archive
  // had been empty. Measured: 32 bytes of prose unpacked "successfully".
  const kind = sniff(bytes);
  if (kind !== "gzip" && kind !== "tar") {
    throw new ArchiveError("these bytes are not a tar archive");
  }

  const tar = kind === "gzip" ? gunzipSync(bytes) : bytes;
  // A gzip that unpacked to something that is not a tar is the same question
  // one layer down, and the same silence if nobody asks it.
  if (tar.length < BLOCK) {
    throw new ArchiveError("the archive is shorter than a single tar block");
  }
  const root = resolve(target);
  const written = [];
  let longName = null;

  let at = 0;
  while (at + BLOCK <= tar.length) {
    const header = tar.subarray(at, at + BLOCK);
    // Two zero blocks end the archive; one is enough to stop reading.
    if (header.every((byte) => byte === 0)) break;
    if (!checksumMatches(header)) {
      throw new ArchiveError("the archive is damaged — a header checksum does not match");
    }

    const type = header.toString("latin1", 156, 157);
    const size = octal(header, 124, 12, "an entry size");
    const dataAt = at + BLOCK;
    // Entries are padded out to whole blocks.
    at = dataAt + Math.ceil(size / BLOCK) * BLOCK;

    if (PAX_TYPES.has(type)) continue; // metadata about the next entry
    if (type === GNU_LONGNAME) {
      longName = tar.toString("utf8", dataAt, dataAt + size).replace(/\0+$/, "");
      continue;
    }

    // `prefix` + `/` + `name` is how ustar spells a path over 100 bytes.
    const name = header.toString("utf8", 0, 100).replace(/\0.*$/, "");
    const prefix = header.toString("utf8", 345, 500).replace(/\0.*$/, "");
    const path = longName ?? (prefix ? `${prefix}/${name}` : name);
    longName = null;

    if (type !== DIRECTORY_TYPE && !FILE_TYPES.has(type)) {
      // 🚨 Type 1 is a hard link and type 2 a symlink; both are a door out of
      // the folder that no name check can see, because the escape happens when
      // a LATER entry is written through them. 3, 4, 6 are device nodes and
      // FIFOs, which a module has no business shipping.
      throw new ArchiveError(
        `"${path}" is not a plain file or directory (type "${type}") — a module is files, ` +
          `not links or devices`,
      );
    }

    const unsafe = unsafeEntry(path);
    if (unsafe) throw new ArchiveError(`refusing ${unsafe}`);

    // The belt to the string test's braces: whatever the name turned out to
    // mean on THIS platform, it has to land under the target.
    const to = resolve(root, path);
    if (to !== root && !to.startsWith(root + sep)) {
      throw new ArchiveError(`refusing "${path}" — it resolves outside the folder`);
    }

    if (type === DIRECTORY_TYPE) {
      mkdirSync(to, { recursive: true });
      continue;
    }
    if (dataAt + size > tar.length) {
      throw new ArchiveError(`"${path}" says it is ${size} bytes and the archive ends before that`);
    }
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, tar.subarray(dataAt, dataAt + size));
    written.push(path);
  }

  return written.sort();
}
