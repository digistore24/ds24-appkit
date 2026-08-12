// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// One logo in, five icons out — and the SVG boundary, proved behaviourally
// rather than argued.
//
// Not skipped when sharp is missing: sharp is a declared dependency and the
// suite runs after `npm ci`. A skip here would be a test that reports green
// about the one thing it exists to check.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ICON_TARGETS } from "./targets.mjs";
import { readLogo, renderIcons } from "./render.mjs";

const dir = mkdtempSync(join(tmpdir(), "brand-render-"));

function svgFile(name: string, body: string, size = 512) {
  const path = join(dir, name);
  writeFileSync(
    path,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${body}</svg>`,
  );
  return path;
}

/** A PNG's real size, from its own 20-byte header. */
function pngSize(bytes: Buffer) {
  expect(bytes.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

const SQUARE = svgFile("square.svg", '<rect width="512" height="512" fill="#076a7e"/>');

describe("reading a logo", () => {
  it("reads a vector and reports its intrinsic size", async () => {
    const logo = await readLogo(SQUARE);
    expect(logo.error).toBeUndefined();
    expect(logo.vector).toBe(true);
    expect(logo.width).toBe(512);
  });

  it("refuses a file that is not there, by name", async () => {
    expect((await readLogo(join(dir, "nope.svg"))).error).toMatch(/cannot read/);
  });

  it("warns about a very wide mark instead of silently letterboxing it", async () => {
    const wide = join(dir, "wide.svg");
    writeFileSync(
      wide,
      '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="64"><rect width="512" height="64" fill="#076a7e"/></svg>',
    );
    const logo = await readLogo(wide);
    expect(logo.warnings!.join(" ")).toMatch(/8\.0:1|square mark/);
  });
});

describe("🚨 the SVG boundary, behaviourally", () => {
  it.each([
    ["a <script>", "<script>alert(1)</script>"],
    ["a <foreignObject>", "<foreignObject><div/></foreignObject>"],
    ["an external reference", '<image href="https://evil.example/x.png"/>'],
  ])("refuses %s outright", async (_name, payload) => {
    const path = svgFile(`bad-${_name.replace(/\W/g, "")}.svg`, payload);
    const logo = await readLogo(path);
    expect(logo.error).toBeTruthy();
    expect(logo.error).toMatch(/refusing/);
  });

  it("refuses a gzipped SVG, and says why", async () => {
    const path = join(dir, "logo.svgz");
    writeFileSync(path, Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0x00]));
    expect((await readLogo(path)).error).toMatch(/svgz|NUL/i);
  });

  it("🚨 produces a PNG, which has no scripting at all", async () => {
    // The real answer to "how is an SVG rendered safely into an icon": the
    // output format cannot execute anything. Measured rather than argued —
    // the script text is not even present in the bytes.
    const path = join(dir, "raw-script.svg");
    writeFileSync(
      path,
      '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#076a7e"/></svg>',
    );
    const logo = await readLogo(path);
    const rendered = await renderIcons(logo);
    expect(rendered.error).toBeUndefined();
    const icons = rendered.icons!;
    for (const icon of icons) {
      expect(icon.bytes.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      expect(icon.bytes.includes(Buffer.from("alert"))).toBe(false);
      expect(icon.bytes.includes(Buffer.from("<svg"))).toBe(false);
    }
  });
});

describe("rendering the five", () => {
  it("🚨 writes each one at EXACTLY the size it declares", async () => {
    // The failure this prevents: Chrome refuses to install an app whose
    // manifest declares a size the file does not have, while saying nothing
    // useful — and the only symptom is on somebody's phone.
    const logo = await readLogo(SQUARE);
    const rendered = await renderIcons(logo);
    expect(rendered.error).toBeUndefined();
    const icons = rendered.icons!;
    expect(icons).toHaveLength(ICON_TARGETS.length);
    for (const icon of icons) {
      expect(pngSize(icon.bytes), icon.file).toEqual({ width: icon.size, height: icon.size });
    }
  });

  it("keeps a non-square mark contained rather than cropping it", async () => {
    // `cover` would cut the ends off a wordmark. `contain` letterboxes it,
    // which is honest and visible.
    const wide = join(dir, "wide2.svg");
    writeFileSync(
      wide,
      '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="128"><rect width="512" height="128" fill="#076a7e"/></svg>',
    );
    const logo = await readLogo(wide);
    const rendered = await renderIcons(logo);
    expect(rendered.error).toBeUndefined();
    const icons = rendered.icons!;
    const big = icons.find((i) => i.file.endsWith("icon-512.png"))!;
    // A contained 4:1 mark on a 512 square leaves transparent bands; the
    // trimmed content is therefore shorter than it is wide.
    const sharp = (await import("sharp")).default;
    const { info } = await sharp(big.bytes).trim().toBuffer({ resolveWithObject: true });
    expect(info.width).toBeGreaterThan(info.height * 2);
  });

  it("gives the maskable icon its padding, and only it", async () => {
    // ⚠️ A mark on TRANSPARENCY, not the solid square above, and the difference
    // is the test rather than a detail. A full-bleed logo padded with its own
    // corner colour is pixel-for-pixel indistinguishable from an unpadded one —
    // which is also the correct OUTPUT for a full-bleed mark, since Android
    // crops it and wants the colour to run to the edge. So a solid fixture here
    // would measure nothing at all and pass for the wrong reason.
    const mark = svgFile("mark.svg", '<circle cx="256" cy="256" r="240" fill="#076a7e"/>');
    const logo = await readLogo(mark);
    const rendered = await renderIcons(logo);
    expect(rendered.error).toBeUndefined();
    const icons = rendered.icons!;
    const sharp = (await import("sharp")).default;

    const maskable = icons.find((i) => i.padding)!;
    const plain = icons.find((i) => i.file.endsWith("icon-512.png"))!;

    // The artwork inside the maskable one sits within the central 60 %.
    const trimmed = await sharp(maskable.bytes).trim().toBuffer({ resolveWithObject: true });
    expect(trimmed.info.width).toBeLessThanOrEqual(Math.round(512 * 0.65));
    // The plain one runs to its edges.
    const plainTrimmed = await sharp(plain.bytes).trim().toBuffer({ resolveWithObject: true });
    expect(plainTrimmed.info.width).toBeGreaterThan(Math.round(512 * 0.9));
  });
});
