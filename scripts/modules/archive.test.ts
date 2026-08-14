// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The tar reader, and every way an archive from the network can lie.
//
// 🚨 The archives here are built BYTE BY BYTE rather than by shelling out to
// `tar`, and that is the point: the interesting cases — an entry called
// `../../.env`, a symlink, a size that runs off the end of the file — are ones
// no ordinary archiver will produce for you. An attacker writes those bytes by
// hand, so the test does too. One case at the end goes the other way and uses
// a real `tar`, because a reader that only understands its own writer has
// measured nothing.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";

import { sniff, untar } from "./archive.mjs";

const dirs: string[] = [];
const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), "ds24-archive-"));
  dirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface Entry {
  name: string;
  body?: string;
  /** "0" file, "5" directory, "2" symlink, "x" pax header, "L" GNU long name. */
  type?: string;
  /** Overrides the size written into the header. */
  claimSize?: number;
  /** Written into the checksum field instead of the real one. */
  breakChecksum?: boolean;
}

/** A tar built to order, including ones no real archiver would make. */
function tar(entries: Entry[]): Buffer {
  const blocks: Buffer[] = [];

  for (const entry of entries) {
    const body = Buffer.from(entry.body ?? "", "utf8");
    const header = Buffer.alloc(512);
    header.write(entry.name, 0, 100, "utf8");
    header.write("000644 \0", 100, 8, "latin1");
    header.write("000000 \0", 108, 8, "latin1");
    header.write("000000 \0", 116, 8, "latin1");
    // Size and mtime are octal, NUL-terminated, in fields of 12.
    header.write((entry.claimSize ?? body.length).toString(8).padStart(11, "0") + "\0", 124, 12, "latin1");
    header.write("00000000000\0", 136, 12, "latin1");
    header.write(entry.type ?? "0", 156, 1, "latin1");
    header.write("ustar\0", 257, 6, "latin1");
    header.write("00", 263, 2, "latin1");

    // The checksum is computed with its own field read as spaces.
    header.write("        ", 148, 8, "latin1");
    let sum = 0;
    for (const byte of header) sum += byte;
    const checksum = entry.breakChecksum ? 1 : sum;
    header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "latin1");

    blocks.push(header);
    if (body.length > 0) {
      const padded = Buffer.alloc(Math.ceil(body.length / 512) * 512);
      body.copy(padded);
      blocks.push(padded);
    }
  }

  // Two zero blocks end an archive.
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

describe("sniff reads the bytes, never the name", () => {
  it("knows a gzip, a bare tar and a zip apart", () => {
    expect(sniff(gzipSync(tar([{ name: "a.txt", body: "a" }])))).toBe("gzip");
    expect(sniff(tar([{ name: "a.txt", body: "a" }]))).toBe("tar");
    expect(sniff(Buffer.from([0x50, 0x4b, 0x03, 0x04]))).toBe("zip");
  });

  it("names bzip2 and xz rather than calling them rubbish", () => {
    // Recognised and not supported is a different answer from unrecognised: the
    // vendor's fix is one flag, and "this is not a tar archive" would send them
    // looking for something else entirely. Node has zlib and nothing for
    // either of these.
    expect(sniff(Buffer.from("BZh91AY&SY", "latin1"))).toBe("bzip2");
    expect(sniff(Buffer.from("\xfd7zXZ\0\0", "latin1"))).toBe("xz");
  });

  it("answers null for anything else", () => {
    // A URL ending in `.tar.gz` is not a promise. This is why the caller sniffs
    // rather than trusting the extension — and why `.tgz` needs no special
    // case: it is the same bytes under another name.
    expect(sniff(Buffer.from("<!doctype html>", "utf8"))).toBeNull();
    expect(sniff(Buffer.alloc(0))).toBeNull();
  });
});

describe("unpacking an honest archive", () => {
  it("writes the files, gzipped and bare alike", () => {
    for (const bytes of [
      tar([{ name: "module.json", body: '{"id":"acme-crm"}' }]),
      gzipSync(tar([{ name: "module.json", body: '{"id":"acme-crm"}' }])),
    ]) {
      const dir = scratch();
      untar(bytes, dir);
      expect(readFileSync(join(dir, "module.json"), "utf8")).toBe('{"id":"acme-crm"}');
    }
  });

  it("creates the directories an entry names, and the ones it implies", () => {
    const dir = scratch();
    untar(tar([{ name: "a/", type: "5" }, { name: "a/b/c.txt", body: "c" }]), dir);
    expect(readFileSync(join(dir, "a/b/c.txt"), "utf8")).toBe("c");
  });

  it("skips a pax header and reads a GNU long name", () => {
    // Both are what a real `tar` emits for perfectly ordinary files — a pax
    // header for extended attributes, a long-name entry for a path over 100
    // bytes. Refusing them would refuse legitimate archives.
    const long = `${"deep/".repeat(25)}thing.ts`;
    const dir = scratch();
    untar(
      tar([
        { name: "PaxHeaders/x", body: "30 mtime=1700000000.0\n", type: "x" },
        { name: "././@LongLink", body: `${long}\0`, type: "L" },
        { name: "ignored-short-name", body: "deep\n" },
      ]),
      dir,
    );
    expect(readFileSync(join(dir, long), "utf8")).toBe("deep\n");
  });
});

describe("🚨 an archive that tries to write outside its folder", () => {
  // Each of these is the reason this reader exists instead of a spawned `tar`:
  // GNU tar and bsdtar answer them differently and have changed their answers
  // between versions. Here the refusal is ours and written down.
  const refuses = (entry: Entry, matching: RegExp) => {
    const dir = scratch();
    expect(() => untar(tar([entry]), dir)).toThrow(matching);
    expect(existsSync(join(dir, "module.json")), "nothing was written").toBe(false);
  };

  it("refuses a climbing path", () => {
    refuses({ name: "../../.env", body: "STOLEN=1" }, /climbs out of the archive/);
    refuses({ name: "a/../../b", body: "x" }, /climbs out of the archive/);
  });

  it("refuses an absolute path", () => {
    refuses({ name: "/etc/passwd", body: "x" }, /absolute path/);
  });

  it("refuses a drive letter and a backslash", () => {
    // Both are how the same trick is spelled on Windows, and neither is a legal
    // separator in a tar entry name anyway.
    refuses({ name: "C:/windows/x", body: "x" }, /names a drive/);
    refuses({ name: "a\\..\\..\\b", body: "x" }, /contains a backslash/);
  });

  it("refuses a symlink and a hard link — the escape that happens later", () => {
    // No name check can see this one: the entry itself is harmless, and the
    // escape happens when a LATER entry is written through the link.
    refuses({ name: "link", body: "/", type: "2" }, /not a plain file or directory/);
    refuses({ name: "link", body: "/etc/passwd", type: "1" }, /not a plain file or directory/);
  });

  it("refuses a device node", () => {
    refuses({ name: "dev/null", type: "3" }, /not a plain file or directory/);
  });
});

describe("🚨 an archive whose own numbers disagree", () => {
  it("refuses a damaged header", () => {
    const dir = scratch();
    expect(() => untar(tar([{ name: "a.txt", body: "x", breakChecksum: true }]), dir)).toThrow(
      /a header checksum does not match/,
    );
  });

  it("refuses a size that runs off the end of the archive", () => {
    const dir = scratch();
    // Built by hand: a header claiming far more than follows it, which is what
    // a truncated download looks like from the inside.
    const bytes = tar([{ name: "a.txt", body: "hello", claimSize: 5 }]);
    const header = bytes.subarray(0, 512);
    header.write((99999).toString(8).padStart(11, "0") + "\0", 124, 12, "latin1");
    header.write("        ", 148, 8, "latin1");
    let sum = 0;
    for (const byte of header) sum += byte;
    header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "latin1");
    expect(() => untar(bytes.subarray(0, 1024), dir)).toThrow(/the archive ends before that/);
  });

  it("refuses bytes that are not an archive at all", () => {
    const dir = scratch();
    expect(() => untar(Buffer.from("not a tar at all, not even close", "utf8"), dir)).toThrow();
  });
});

describe("⚠️ a tarball a real tar made", () => {
  // A reader that only understands its own writer has measured nothing. This
  // one case builds a tree, hands it to the `tar` on this machine, and reads
  // back what comes out. It is skipped where there is no tar rather than
  // failing — an absent tool is not a finding about this code.
  const hasTar = (() => {
    try {
      execFileSync("tar", ["--version"], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  })();

  it.skipIf(!hasTar)("round-trips through the system tar", () => {
    const source = scratch();
    mkdirSync(join(source, "acme-demo/lib"), { recursive: true });
    writeFileSync(join(source, "acme-demo/module.json"), '{"id":"acme-demo"}');
    writeFileSync(join(source, "acme-demo/lib/thing.ts"), "export default 1;\n");
    const archive = join(source, "acme-demo.tar.gz");
    execFileSync("tar", ["-czf", archive, "-C", source, "acme-demo"]);

    const dir = scratch();
    const written = untar(readFileSync(archive), dir);
    expect(readFileSync(join(dir, "acme-demo/module.json"), "utf8")).toBe('{"id":"acme-demo"}');
    expect(written).toContain("acme-demo/lib/thing.ts");
  });
});
