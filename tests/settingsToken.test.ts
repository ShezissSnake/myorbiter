// The settings page token (load_settings in src-tauri/src/lib.rs, SaveGate) is one per process:
// each load hands out a new one, and saves from an older one are refused. That holds only while a
// single page loads the settings, once. These tests fail if a second caller appears.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|svelte)$/.test(f) ? [p] : [];
  });
const sources = files("src").map((p) => ({ p, text: readFileSync(p, "utf8") }));
const count = (re: RegExp) => sources.flatMap(({ p, text }) => (text.match(re) ?? []).map(() => p));

test("only loadSettings asks for the settings and their page token", () => {
  assert.deepEqual(count(/["'`]load_settings["'`]/g), ["src/lib/backend.ts"]);
});

test("loadSettings is called once, when the app starts", () => {
  assert.deepEqual(count(/\bloadSettings\(/g).filter((p) => p !== "src/lib/backend.ts"), ["src/App.svelte"]);
  assert.equal(count(/\bloadSettings\(/g).filter((p) => p === "src/App.svelte").length, 1);
  assert.equal(count(/\bexport async function loadSettings\(/g).length, 1);
});

test("only flushSettings saves, and every save sends the page token", () => {
  assert.deepEqual(count(/["'`]save_settings["'`]/g), ["src/lib/backend.ts"]);
  const backend = readFileSync("src/lib/backend.ts", "utf8");
  assert.match(backend, /invoke\("save_settings", \{ settings: s, page: savePage, rev: \+\+saveRev \}\)/);
});

test("only one window loads the page", () => {
  const conf = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
  assert.equal(conf.app.windows.length, 1);
  assert.deepEqual(count(/new WebviewWindow\(|new Webview\(/g), []);
});
