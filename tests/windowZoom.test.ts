// The zoom keys and the smallest window: the main window zooms with Ctrl and plus, minus, 0 or the
// wheel, and fits a 1920×1080 screen at 200 % (540 logical pixels high, before any panel). Outside
// Windows, Tauri's zoom keys are a script in the page that calls set_webview_zoom, so the page's
// capability carries that one webview permission; the list is held to exactly what it is.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const json = (p: string) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), "utf8"));

test("the page may call exactly these: MyOrbiter's events, the web view's zoom, the window's state and restart", () => {
  const cap = json("src-tauri/capabilities/default.json");
  assert.deepEqual(cap.windows, ["main"]);
  assert.deepEqual(cap.permissions, [
    "core:event:allow-listen",
    "core:event:allow-unlisten",
    "core:webview:allow-set-webview-zoom",
    "window-state:default",
    "process:allow-restart",
  ]);
});

test("the main window has the zoom keys on and is 900 by 500 at the smallest", () => {
  const conf = json("src-tauri/tauri.conf.json");
  const [main, ...others] = conf.app.windows;
  assert.equal(others.length, 0, "one window");
  assert.equal(main.zoomHotkeysEnabled, true);
  assert.equal(main.minWidth, 900);
  assert.equal(main.minHeight, 500);
  assert.ok(main.minHeight <= 1080 / 2, "fits a 1920×1080 screen at 200 %");
});

test("the sweep's smallest size is the window's smallest", () => {
  const conf = json("src-tauri/tauri.conf.json");
  const sweep = readFileSync(new URL("../scripts/ui-sweep.mjs", import.meta.url), "utf8");
  const first = /const SIZES = \[\s*\{ w: (\d+), h: (\d+) \}/.exec(sweep);
  assert.ok(first, "the sweep's sizes are found");
  assert.deepEqual([Number(first[1]), Number(first[2])], [conf.app.windows[0].minWidth, conf.app.windows[0].minHeight]);
});
