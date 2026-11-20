// What the app tells the player: advice that can work, and one word for one thing. Each part
// holds a sentence to the code it describes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { emptyText, fullModeOff, FULL_MODE_OFF, SYNC_FULL_MODE_OFF } from "../src/lib/core/fullModeOff";
import { syncIdleWord } from "../src/lib/core/syncWord";

const root = join(import.meta.dirname, "..");
const src = (f: string) => readFileSync(join(root, f), "utf8");

// Full mode off, nothing read: Sync can never fill the inventory, so nothing says "press Sync".

test("Full mode off with nothing read is its own case; no report, or a read, keeps the old words", () => {
  assert.equal(fullModeOff(false, true), true);
  assert.equal(fullModeOff(false, false), false, "a read from before still shows");
  assert.equal(fullModeOff(null, true), false, "no report: TennoScope off, a console or macOS keep their own words");
  assert.equal(fullModeOff(true, true), false, "Full mode on: Sync can read it");
  assert.equal(emptyText("press Sync", true), FULL_MODE_OFF);
  assert.equal(emptyText("press Sync", false), "press Sync");
  assert.doesNotMatch(FULL_MODE_OFF, /Sync|safe/i);
  assert.match(FULL_MODE_OFF, /Full mode is off/);
  assert.match(FULL_MODE_OFF, /Settings, TennoScope/);
});

test("Sync with Full mode off and nothing read says so, never Up to date", () => {
  assert.equal(syncIdleWord(null, false, true, true), SYNC_FULL_MODE_OFF);
  assert.equal(syncIdleWord({ failed: false, note: "Up to date" }, false, true, true), SYNC_FULL_MODE_OFF);
  assert.equal(syncIdleWord({ failed: false, note: "Up to date" }, false, true, false), "Up to date");
  // A failure keeps its own word.
  assert.equal(syncIdleWord({ failed: true, short: "Not read" }, false, true, true), "Not read");
  const app = src("src/App.svelte");
  assert.match(app, /syncIdleWord\(syncEnd, !!error, !!bundle, syncFullModeOff\)/);
  assert.match(app, /sizer=\{\["Waiting…", "Up to date", "Not synced", SYNC_FULL_MODE_OFF\]\}/);
  assert.match(app, /return syncFullModeOff \? SYNC_FULL_MODE_OFF : "Up to date";/);
  assert.match(src("src/lib/tabs/Guide.svelte"), /Up to date, or Full mode off, Old read/);
});

test("Sync's tooltip names Full mode as everything else does", () => {
  const app = src("src/App.svelte");
  const title = app.slice(app.indexOf('label="Sync"'), app.indexOf("(Ctrl+R)"));
  assert.doesNotMatch(title, /Full access/);
  assert.match(title, /TennoScope in Full mode/);
});

test("the banner, the empty pages and Home's Ready to list take the one Full-mode-off case", () => {
  const app = src("src/App.svelte");
  assert.match(app, /tsUnsupported \? "No inventory: TennoScope, which reads it from the game, doesn't run on macOS\." : fullModeOff\(mkt\.fullMode, true\) \? FULL_MODE_OFF :/);
  for (const [file, n] of [["src/lib/tabs/Inventory.svelte", 2], ["src/lib/tabs/Relics.svelte", 1], ["src/lib/tabs/Planner.svelte", 1], ["src/lib/tabs/Stats.svelte", 1]] as const) {
    const s = src(file);
    assert.equal([...s.matchAll(/emptyText\(/g)].length, n, `${file}: ${n} empty text(s) through emptyText`);
    assert.match(s, /fullModeOff\(mkt\.fullMode, noInventoryRead\(model\)\)/, file);
  }
  const home = src("src/lib/tabs/Home.svelte");
  // No inventory read: never "Nothing spare".
  assert.match(home, /\{:else if nothingRead\}\s*<p class="dim">\{offFull \? FULL_MODE_OFF : NO_READ_YET\}<\/p>\s*\{:else if !byKind\.length\}/);
});
