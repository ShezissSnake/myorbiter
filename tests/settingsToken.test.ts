// The settings page token (load_settings in src-tauri/src/lib.rs, SaveGate) is one per process:
// each load hands out a new one, and saves from an older one are refused. That holds only while a
// single page loads the settings, once. These tests fail if a second caller or window appears.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** Files under `dir` matching `ext`, as forward-slash paths from the repository root. */
const files = (dir: string, ext: RegExp): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p, ext) : ext.test(f) ? [relative(".", p).split(sep).join("/")] : [];
  });
/** Without comments, so a mention in one isn't taken for a call. */
const code = (p: string) => readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const page = files("src", /\.(ts|svelte)$/).map((p) => ({ p, text: code(p) }));
const rust = files("src-tauri/src", /\.rs$/).map((p) => ({ p, text: code(p) }));
const where = (sources: { p: string; text: string }[], re: RegExp) => sources.flatMap(({ p, text }) => (text.match(re) ?? []).map(() => p));

test("only loadSettings asks for the settings and their page token", () => {
  assert.deepEqual(where(page, /["'`]load_settings["'`]/g), ["src/lib/backend.ts"]);
});

test("loadSettings is called once, when the app starts", () => {
  const calls = where(page, /\bloadSettings\(/g);
  // In backend.ts only its own definition; elsewhere the one call in App.svelte.
  assert.deepEqual(calls.filter((p) => p === "src/lib/backend.ts"), ["src/lib/backend.ts"]);
  assert.equal(where(page, /\bexport async function loadSettings\(/g).length, 1);
  assert.deepEqual(calls.filter((p) => p !== "src/lib/backend.ts"), ["src/App.svelte"]);
});

test("only flushSettings saves, and every save sends the page token", () => {
  assert.deepEqual(where(page, /["'`]save_settings["'`]/g), ["src/lib/backend.ts"]);
  assert.match(code("src/lib/backend.ts"), /invoke\("save_settings",\s*\{[^}]*\bpage:\s*savePage\b[^}]*\}/);
});

test("only one window loads the page", () => {
  const conf = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
  assert.equal(conf.app.windows.length, 1);
  assert.deepEqual(where(page, /\bnew (WebviewWindow|Webview|Window)\(/g), []);
  assert.deepEqual(where(rust, /\b(WebviewWindowBuilder|WebviewBuilder|WindowBuilder)\b/g), []);
});
