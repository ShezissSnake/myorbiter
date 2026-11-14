import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import "./support/runes";
import { loadSettings, nothingYet, NO_INVENTORY_YET, tennoscope } from "../src/lib/backend";

test("a fresh TennoScope reads as not set up yet, on Linux and Windows alike", () => {
  // What the desktop app says now, on every system.
  assert.ok(nothingYet("not found at C:\\Users\\a\\AppData\\Roaming\\io.github.deftera186.tennoscope\\catalog\\catalog-generation.json: TennoScope hasn't written it yet"));
  // What older builds passed through: Linux's missing file, Windows' missing folder.
  assert.ok(nothingYet("could not read /home/a/.local/share/x/catalog/catalog-generation.json: No such file or directory (os error 2)"));
  assert.ok(nothingYet("could not read C:\\x\\catalog\\catalog-generation.json: The system cannot find the path specified. (os error 3)"));
  assert.ok(nothingYet(NO_INVENTORY_YET));
  // A real failure still reads as one.
  assert.ok(!nothingYet("could not parse catalog-generation.json: expected value at line 1"));
  assert.ok(!nothingYet("could not read x: Access is denied. (os error 5)"));
  assert.ok(!nothingYet("could not read x: (os error 32)"), "os error 32 isn't os error 3");
});

// ------------------------------------------------------------------ the first start's question

const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");

async function loaded(saved: unknown) {
  const text = saved === undefined ? null : JSON.stringify(saved);
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => text, setItem: () => {} };
  return (await loadSettings()).fullModeAsked;
}

test("the Full mode question is asked on a first start only", async () => {
  assert.equal(await loaded(undefined), false, "no settings yet: a first start");
  assert.equal(await loaded({ tab: "home" }), true, "settings from before the question: chosen on the setup steps");
  assert.equal(await loaded({ fullModeAsked: true }), true);
  assert.equal(await loaded({ fullModeAsked: false }), false, "not answered yet: asked again");
  assert.equal(await loaded({ fullModeAsked: "junk" }), true);
});

test("nothing of TennoScope starts before the answer", () => {
  const app = src("App.svelte");
  const hold = app.indexOf("ts.asking = true;");
  const ask = app.indexOf("(answer) => (firstRun = answer)");
  const answered = app.indexOf("ts.answer(access)");
  const firstStart = app.indexOf("await ts.check(true)");
  const poll = app.indexOf("tsPoll = setInterval(");
  assert.ok(hold > 0 && ask > hold && answered > ask, "held, asked, then answered");
  assert.ok(firstStart > answered && poll > firstStart, "TennoScope's first start and its 15 s check come after the question");
  // Before the hold, nothing looks at TennoScope at all (the setup page's Try again is a click,
  // after it); between hold and answer, only a look.
  const act = app.indexOf("function setupAct(");
  const actEnd = app.indexOf("\n  }\n", act);
  assert.ok(act > 0 && actEnd > act);
  assert.equal((app.slice(0, act) + app.slice(actEnd, hold)).match(/ts\.check\(|tennoscope\.start\(/g), null);
  assert.deepEqual(app.slice(hold, ask).match(/ts\.check\([^)]*\)/g), ["ts.check()"]);
});

test("the question shows Full mode's warning, word for word; Esc is the safe answer, nothing else closes it", () => {
  const dialog = src("lib/FirstRun.svelte");
  // The warning word for word, its page's name a control that opens it (fullModeWarning.test.ts).
  assert.match(dialog, /import FullModeWarning from "\.\/FullModeWarning\.svelte"/);
  assert.match(dialog, /<FullModeWarning disabled=\{!ready\} \/>/);
  assert.doesNotMatch(dialog, /onescape|onsubmit|onclick=\{close/, "no click outside or submit answers it");
  // Esc answers overlay only (nothing read from the game's memory), and not in its first moment.
  assert.match(dialog, /if \(e\.key !== "Escape" \|\| !ready\) return;\s*e\.preventDefault\(\);\s*onanswer\("--access=overlay"\);/);
  // The only calls of onanswer: the two buttons, each one mode, and Esc's overlay.
  assert.deepEqual([...dialog.matchAll(/onanswer\(([^)]*)\)/g)].map((m) => m[1]).sort(), ['"--access=full"', '"--access=overlay"', '"--access=overlay"']);
  assert.match(dialog, /disabled=\{!ready\} onclick=\{\(\) => onanswer\("--access=overlay"\)\}/);
  assert.match(dialog, /disabled=\{!ready\} onclick=\{\(\) => onanswer\("--access=full"\)\}/);
});

// ------------------------------------------------------------------ the store's gate

function stubTennoscope(report: { mode: string | null } | null, running = false) {
  const calls: string[] = [];
  const status = () => ({ running, supported: true, binary: "/home/user/tennoscope", custom: null, bundled: true, started_by_myorbiter: false, report: report && { setup: { setup_complete: !!report.mode, access_mode: report.mode, desktop_capture_action_available: false } } }) as never;
  const real = { start: tennoscope.start, status: tennoscope.status, ask: tennoscope.ask };
  tennoscope.start = async () => {
    calls.push("start");
    running = true;
    return status();
  };
  tennoscope.status = async () => status();
  tennoscope.ask = async (a) => void calls.push(`ask ${a}`);
  return { calls, restore: () => Object.assign(tennoscope, real), set: (r: { mode: string | null } | null) => (report = r) };
}

test("while the question is open nothing starts or is asked; then the answer is asked for", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { ts } = await import("../src/lib/tennoscopeStore.svelte");
  const tsx = stubTennoscope(null);
  try {
    ts.status = null;
    ts.asking = true;
    await ts.check(true, true);
    await ts.ask("--sync");
    assert.deepEqual(tsx.calls, [], "held: no start, no sync");
    ts.answer("--access=overlay");
    // Started plainly (its own folder's mode), then asked once it reports another mode.
    tsx.set({ mode: "full" });
    await ts.check(true, true);
    assert.deepEqual(tsx.calls, ["start", "ask --access=overlay"], "Overlay is asked for, never Full");
    tsx.set({ mode: "overlay" });
    await ts.check();
    assert.equal(ts.wanted, null, "applied: nothing more to pass on");
    // A TennoScope that never switches is asked three times, then left to Settings.
    ts.answer("--access=full");
    for (let i = 0; i < 5; i++) {
      ts.pending = null;
      await ts.check();
    }
    assert.equal(tsx.calls.filter((c) => c === "ask --access=full").length, 3);
    assert.equal(ts.wanted, null);
    assert.match(ts.error ?? "", /didn't switch to Full mode/);
    // A newer choice wins: Full answered, then "Not now: overlay only" on the setup step before
    // TennoScope switched. Full is never asked for again.
    tsx.calls.length = 0;
    tsx.set({ mode: null });
    ts.answer("--access=full");
    ts.pending = null;
    await ts.check();
    assert.deepEqual(tsx.calls, ["ask --access=full"]);
    await ts.ask("--access=overlay");
    assert.equal(ts.wanted, null, "the answer is dropped");
    for (let i = 0; i < 5; i++) {
      ts.pending = null;
      await ts.check();
    }
    assert.deepEqual(tsx.calls, ["ask --access=full", "ask --access=overlay"], "Overlay stands");
    // A sync while the answer waits doesn't drop it.
    ts.answer("--access=overlay");
    await ts.ask("--sync");
    assert.equal(ts.wanted, "--access=overlay");
  } finally {
    tsx.restore();
    ts.asking = false;
    ts.wanted = null;
    ts.pending = null;
    ts.error = null;
    ts.status = null;
  }
});

test("every control that picks a mode goes through the store, so a newer choice replaces the waiting answer", () => {
  const sources = ["App.svelte", "lib/FullMode.svelte", "lib/TennoscopeSheet.svelte", "lib/SettingsSheet.svelte", "lib/FirstRun.svelte"].map((f) => [f, src(f)] as const);
  for (const [f, text] of sources) assert.ok(!/\btennoscope\.ask\(/.test(text), `${f} asks TennoScope directly`);
  assert.match(src("lib/FullMode.svelte"), /ts\.ask\(full \? "--access=full" : "--access=overlay"\)/);
  // The setup page's "Not now: overlay only" asks through the store, then carries on without an inventory.
  assert.match(src("App.svelte"), /else if \(a === "overlay"\) \{\s*void ts\.ask\("--access=overlay"\);\s*finishLater\(\);/);
  assert.match(src("App.svelte"), /a === "overlay" \? "Not now: overlay only"/);
});
