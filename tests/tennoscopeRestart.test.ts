// A TennoScope that keeps ending: MyOrbiter's Rust side holds the routine start back and gives up
// (companion.rs, `Relaunch`); the page passes Start as `force`, says so once when it has given up,
// and stops asking.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import "./support/runes";
import { tennoscope } from "../src/lib/backend";
import { gaveUpWords } from "../src/lib/core/upkeep";

type Restart = { tries: number; gave_up: boolean; retry_in_ms: number | null };

function stub(restart: Restart) {
  const calls: string[] = [];
  const status = () => ({ running: false, supported: true, binary: "/home/user/tennoscope", custom: null, bundled: true, started_by_myorbiter: false, report: null, restart }) as never;
  const real = { start: tennoscope.start, status: tennoscope.status, failure: tennoscope.failure };
  tennoscope.start = async (force = false) => {
    calls.push(`start${force ? " force" : ""}`);
    return status();
  };
  tennoscope.status = async () => status();
  tennoscope.failure = async () => null;
  return { calls, set: (r: Restart) => (restart = r), restore: () => Object.assign(tennoscope, real) };
}

test("once MyOrbiter has given up, the routine check only looks, says so once, and Start starts it again", async () => {
  const { ts } = await import("../src/lib/tennoscopeStore.svelte");
  const s = stub({ tries: 1, gave_up: false, retry_in_ms: 15_000 });
  try {
    ts.status = null;
    ts.error = null;
    // Waiting out a restart: the routine check asks; the Rust side holds the start back.
    await ts.check(true);
    assert.deepEqual(s.calls, ["start"]);
    assert.equal(ts.error, null, "one end is in the log, not a notice");
    // Given up.
    s.set({ tries: 4, gave_up: true, retry_in_ms: null });
    await ts.check(true);
    assert.equal(ts.error, gaveUpWords(4, null));
    const calls = s.calls.length;
    ts.error = "seen";
    for (let i = 0; i < 3; i++) await ts.check(true);
    assert.equal(s.calls.length, calls, "no start asked for while it has given up");
    assert.equal(ts.error, "seen", "said once, not at every check");
    // Start pressed: forced, so it starts whatever came before.
    await ts.check(true, true);
    assert.equal(s.calls.at(-1), "start force");
  } finally {
    s.restore();
    ts.status = null;
    ts.error = null;
  }
});

test("the words say what happened and what to do", () => {
  const w = gaveUpWords(4, "database schema version 5 is not supported");
  assert.match(w, /4 times in a row/);
  assert.match(w, /database schema version 5/);
  assert.match(w, /Press Start in Settings, TennoScope/);
  assert.doesNotMatch(gaveUpWords(4, null), /Its log says/);
});

test("TennoScope's main window is created hidden, so a background start never maps it over the game", () => {
  const conf = JSON.parse(readFileSync(new URL("../tennoscope/app/src-tauri/tauri.conf.json", import.meta.url), "utf8")) as { app: { windows: { label: string; visible?: boolean }[] } };
  const main = conf.app.windows.find((w) => w.label === "main");
  assert.equal(main?.visible, false);
  const lib = readFileSync(new URL("../tennoscope/app/src-tauri/src/lib.rs", import.meta.url), "utf8");
  assert.match(lib, /!orbiter_bridge::wants_background\(&std::env::args\(\)\.collect::<Vec<_>>\(\)\)\s*&& let Some\(window\) = app\.get_webview_window\("main"\)\s*\{\s*let _ = window\.show\(\);/);
});
