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
  // Before the hold, nothing looks at TennoScope at all; between hold and answer, only a look.
  assert.equal(app.slice(0, hold).match(/ts\.check\(|tennoscope\.start\(/g), null);
  assert.deepEqual(app.slice(hold, ask).match(/ts\.check\([^)]*\)/g), ["ts.check()"]);
});

test("the question shows Full mode's warning, word for word, and can't be closed without an answer", () => {
  const dialog = src("lib/FirstRun.svelte");
  assert.match(dialog, /import \{ FULL_MODE_WARNING \} from "\.\/FullMode\.svelte"/);
  assert.match(dialog, /\{FULL_MODE_WARNING\}/);
  assert.doesNotMatch(dialog, /onescape|onkeydown|onsubmit|onclick=\{close/, "no Esc, no key or click outside answers it");
  // The only calls of onanswer are the two buttons, each one mode.
  assert.deepEqual([...dialog.matchAll(/onanswer\(([^)]*)\)/g)].map((m) => m[1]).sort(), ['"--access=full"', '"--access=overlay"']);
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
  assert.match(src("App.svelte"), /ts\.ask\("--access=overlay"\); withoutInventory\(\);[^<]*>Not now: overlay only/);
});
