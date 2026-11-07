import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { variants } from "../scripts/icons.mjs";

// The app icon set is rendered from src-tauri/icons/icon.svg by `npm run icons`. These checks read
// the files only, so they don't need rsvg-convert.
const TAURI = join(dirname(fileURLToPath(import.meta.url)), "../src-tauri");
const conf = JSON.parse(readFileSync(join(TAURI, "tauri.conf.json"), "utf8"));
const listed: string[] = conf.bundle.icon;

/** Width and height of a PNG, from its IHDR chunk. */
function pngSize(b: Buffer): [number, number] {
  assert.equal(b.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "PNG signature");
  assert.equal(b.subarray(12, 16).toString("latin1"), "IHDR");
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

/** Each image in an .ico: the size its directory states and the size of the PNG it holds. */
function icoImages(b: Buffer) {
  assert.equal(b.readUInt16LE(2), 1, ".ico type");
  return Array.from({ length: b.readUInt16LE(4) }, (_, i) => {
    const e = 6 + 16 * i;
    const stated: [number, number] = [b.readUInt8(e) || 256, b.readUInt8(e + 1) || 256];
    const data = b.subarray(b.readUInt32LE(e + 12), b.readUInt32LE(e + 12) + b.readUInt32LE(e + 8));
    return { stated, actual: pngSize(data) };
  });
}

/** The pixel size each .icns PNG entry type stands for. */
const ICNS_SIZES: Record<string, number> = { icp4: 16, icp5: 32, ic11: 32, icp6: 64, ic12: 64, ic07: 128, ic08: 256, ic13: 256, ic09: 512, ic14: 512, ic10: 1024 };

/** Each entry in an .icns: its type and the size of the PNG it holds. */
function icnsImages(b: Buffer) {
  assert.equal(b.subarray(0, 4).toString("latin1"), "icns");
  assert.equal(b.readUInt32BE(4), b.length, ".icns length");
  const out: { type: string; actual: [number, number] }[] = [];
  for (let at = 8; at < b.length; ) {
    const len = b.readUInt32BE(at + 4);
    assert.ok(len >= 8 && at + len <= b.length, `.icns entry at ${at} has length ${len}`);
    out.push({ type: b.subarray(at, at + 4).toString("latin1"), actual: pngSize(b.subarray(at + 8, at + len)) });
    at += len;
  }
  return out;
}

test("every icon tauri.conf.json lists, plus icon.png and icon.ico, exists and is square", () => {
  const files = [...new Set([...listed, "icons/icon.png", "icons/icon.ico"])];
  for (const rel of files) {
    const file = join(TAURI, rel);
    assert.ok(existsSync(file), `${rel} is missing (run npm run icons)`);
    const b = readFileSync(file);
    if (rel.endsWith(".png")) {
      const [w, h] = pngSize(b);
      assert.equal(w, h, `${rel} is ${w}x${h}`);
      const named = rel.match(/(\d+)x(\d+)(@2x)?\.png$/);
      if (named) assert.equal(w, Number(named[1]) * (named[3] ? 2 : 1), `${rel} is ${w} px`);
    } else if (rel.endsWith(".ico")) {
      const images = icoImages(b);
      assert.ok(images.length > 0, `${rel} is empty`);
      for (const { stated, actual } of images) {
        assert.equal(stated[0], stated[1], `${rel}: a ${stated.join("x")} entry`);
        assert.deepEqual(actual, stated, `${rel}: entry says ${stated.join("x")}, image is ${actual.join("x")}`);
      }
    } else if (rel.endsWith(".icns")) {
      const images = icnsImages(b);
      assert.ok(images.length > 0, `${rel} is empty`);
      for (const { type, actual } of images) {
        assert.equal(actual[0], actual[1], `${rel}: ${type} is ${actual.join("x")}`);
        if (type in ICNS_SIZES) assert.equal(actual[0], ICNS_SIZES[type], `${rel}: ${type} holds a ${actual[0]} px image`);
      }
    } else assert.fail(`${rel}: unexpected icon type`);
  }
});

test("the master icon keeps to what the render script expects", () => {
  const svg = readFileSync(join(TAURI, "icons/icon.svg"), "utf8");
  assert.match(svg, /<svg[^>]*viewBox="0 0 100 100"/);
  assert.deepEqual([...svg.matchAll(/<g\b[^>]*\bid="([^"]+)"/g)].map((m) => m[1]), ["plate", "hull-detailed", "hull-simple"]);
  assert.equal((svg.match(/<g\b/g) ?? []).length, 3, "no nested groups");
  assert.match(svg, /<g id="hull-simple" display="none">/);
  assert.doesNotMatch(svg, /<(text|filter|linearGradient|radialGradient|mask|clipPath|image|style|metadata|defs|use|foreignObject|symbol)\b|transform=|opacity=|href=|xmlns:/);
  for (const [, attr, value] of svg.matchAll(/\b(fill|stroke)="([^"]*)"/g))
    assert.match(value, /^(#[0-9a-f]{6}|none)$/, `${attr}="${value}" is not a plain hex colour`);
});

test("the monochrome icon is one colour", () => {
  const svg = readFileSync(join(TAURI, "icons/icon-mono.svg"), "utf8");
  assert.match(svg, /<svg[^>]*viewBox="0 0 100 100"/);
  const colours = new Set([...svg.matchAll(/\b(?:fill|stroke)="(#[0-9a-f]{6})"/g)].map((m) => m[1]));
  assert.equal(colours.size, 1, `colours: ${[...colours].join(", ")}`);
});

test("icon-small.svg is the master's plate and small hull, as npm run icons writes it", () => {
  const master = readFileSync(join(TAURI, "icons/icon.svg"), "utf8");
  assert.equal(readFileSync(join(TAURI, "icons/icon-small.svg"), "utf8"), variants(master).smallFile, "run npm run icons");
});
