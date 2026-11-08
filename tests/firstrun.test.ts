import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadSettings, nothingYet, NO_INVENTORY_YET, tennoscope, type TennoscopeAccess } from "../src/lib/backend";
import { settle } from "./support/runes";

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


void settle;
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

test("nothing of TennoScope starts before the answer, and the answer is what it starts in", () => {
  const app = src("App.svelte");
  const ask = app.indexOf("(answer) => (firstRun = answer)");
  const startIn = app.indexOf("await ts.startIn(access)");
  const firstStart = app.indexOf("await ts.check(true)");
  const poll = app.indexOf("tsPoll = setInterval(");
  assert.ok(ask > 0 && startIn > ask, "asked, then started in the chosen mode");
  assert.ok(firstStart > startIn && poll > firstStart, "TennoScope's first start and its 15 s check come after the question");
  // Before the question, only a look at whether TennoScope runs here (no start).
  assert.equal(app.slice(0, ask).match(/ts\.check\(true\)|ts\.startIn\(|tennoscope\.start\(/g), null);
  assert.match(app.slice(app.lastIndexOf("if (ts.launch && !settings.fullModeAsked", ask), ask), /await ts\.check\(\);/);
});

test("the question shows Full mode's warning, word for word, and can't be closed without an answer", () => {
  const dialog = src("lib/FirstRun.svelte");
  assert.match(dialog, /import \{ FULL_MODE_WARNING \} from "\.\/FullMode\.svelte"/);
  assert.match(dialog, /\{FULL_MODE_WARNING\}/);
  assert.doesNotMatch(dialog, /onescape|onclick=\{close|\$effect/, "no Esc, no click outside, no closing counted as an answer");
  assert.deepEqual([...dialog.matchAll(/onanswer\("(--access=[a-z]+)"\)/g)].map((m) => m[1]).sort(), ["--access=full", "--access=overlay"]);
});

test("the answer goes to TennoScope's start: Overlay never asks for Full", async () => {
  const { ts } = await import("../src/lib/tennoscopeStore.svelte");
  const real = tennoscope.start;
  const asked: (TennoscopeAccess | undefined)[] = [];
  tennoscope.start = async (access?: TennoscopeAccess) => {
    asked.push(access);
    return null;
  };
  try {
    await ts.startIn("--access=overlay");
    await ts.startIn("--access=full");
  } finally {
    tennoscope.start = real;
  }
  assert.deepEqual(asked, ["--access=overlay", "--access=full"]);
});
