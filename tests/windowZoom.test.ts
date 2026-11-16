// The zoom keys and the smallest window: the main window zooms with Ctrl and plus, minus, 0 or the
// wheel, and fits a 1920×1080 screen at 200 % (540 logical pixels high, before any panel). Outside
// Windows, Tauri's zoom keys are a script in the page that calls set_webview_zoom, so the page's
// capability carries that one webview permission. The command takes any web view of the app by
// label, so "the page's own zoom" holds only while the app has one web view. The tests below read
// the files: they hold the list and who holds it, and fail on the ways of adding a capability, a
// window or a web view that they name (a second file in the capabilities folder, a key that widens
// who holds the list, a second window in the configuration, Tauri's builders, add_capability and
// capabilities_path_pattern in the workspace's Rust). They are a guard on those, not proof that
// no other way exists.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const at = (p: string) => new URL(`../${p}`, import.meta.url);
const json = (p: string) => JSON.parse(readFileSync(at(p), "utf8"));

/** Every Rust file of the top workspace (src-tauri, build.rs with it, and crates/), target/ and gen/ left out. */
function rustFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(at(dir), { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) {
        if (e.name !== "target" && e.name !== "gen" && e.name !== "node_modules") walk(p);
      } else if (e.name.endsWith(".rs")) out.push(p);
    }
  };
  walk("src-tauri");
  walk("crates");
  return out;
}

test("the page may call exactly these: MyOrbiter's events, its web view's zoom, the window's state and restart", () => {
  // Tauri takes every file in the capabilities folder (tauri.conf.json names none instead).
  assert.deepEqual(readdirSync(at("src-tauri/capabilities")), ["default.json"]);
  assert.equal(json("src-tauri/tauri.conf.json").app.security.capabilities, undefined);
  // Nor is a capability added at run time (AppHandle::add_capability) or read from elsewhere by the build (capabilities_path_pattern).
  const adds = rustFiles().filter((f) => /\b(add_capability|capabilities_path_pattern)\b/.test(readFileSync(at(f), "utf8")));
  assert.deepEqual(adds, [], "no capability from Rust");
  const cap = json("src-tauri/capabilities/default.json");
  // No remote, local, webviews or platforms key: the list is held by MyOrbiter's own page in the main window only.
  assert.deepEqual(Object.keys(cap).sort(), ["$schema", "description", "identifier", "permissions", "windows"]);
  assert.deepEqual(cap.windows, ["main"]);
  assert.deepEqual(cap.permissions, [
    "core:event:allow-listen",
    "core:event:allow-unlisten",
    "core:webview:allow-set-webview-zoom",
    "window-state:default",
    "process:allow-restart",
  ]);
});

test("one window in the configuration, and no window or web view made from Rust by Tauri's builders", () => {
  const conf = json("src-tauri/tauri.conf.json");
  assert.equal(conf.app.windows.length, 1, "one window in the configuration");
  assert.ok(conf.app.windows[0].label === undefined || conf.app.windows[0].label === "main");
  const files = rustFiles();
  assert.ok(files.some((f) => f.endsWith("src-tauri/src/lib.rs")), "the Rust files were found");
  // Tauri's builders by type name, by their associated functions (WebviewWindow::builder and the
  // like, where the type name never appears), and a web view added to a window.
  const builds = files.filter((f) => /\b(WebviewWindowBuilder|WebviewBuilder|WindowBuilder|add_child|create_webview)\b|\b(WebviewWindow|Webview|Window)::builder\b/.test(readFileSync(at(f), "utf8")));
  assert.deepEqual(builds, [], "no Rust code makes a window or a web view by these names");
});

test("the main window has the zoom keys on and is 900 by 500 at the smallest", () => {
  const conf = json("src-tauri/tauri.conf.json");
  const [main] = conf.app.windows;
  assert.equal(main.zoomHotkeysEnabled, true);
  assert.equal(main.minWidth, 900);
  assert.equal(main.minHeight, 500);
  assert.ok(main.minHeight <= 1080 / 2, "fits a 1920×1080 screen at 200 %");
});

test("the sweep's smallest size is the window's smallest", () => {
  const conf = json("src-tauri/tauri.conf.json");
  const sweep = readFileSync(at("scripts/ui-sweep.mjs"), "utf8");
  const first = /const SIZES = \[\s*\{ w: (\d+), h: (\d+) \}/.exec(sweep);
  assert.ok(first, "the sweep's sizes are found");
  assert.deepEqual([Number(first[1]), Number(first[2])], [conf.app.windows[0].minWidth, conf.app.windows[0].minHeight]);
});
