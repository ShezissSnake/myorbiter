// Getting in (App.svelte's setup page and the "Can't read" pages): what leaving the setup page does
// to the automatic actions.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { leaveSetup } from "../src/lib/core/gettingIn";

const app = readFileSync(new URL("../src/App.svelte", import.meta.url), "utf8");
const on = { auto: true, autoTrades: true, autoRep: true };
const off = { auto: false, autoTrades: false, autoRep: false };

test("Finish later (and Esc) switches the automatic actions off, first start or not", () => {
  for (const first of [true, false]) {
    const x = leaveSetup("later", on, first);
    assert.deepEqual(x.next, off, `first start: ${first}`);
    assert.deepEqual(x.off, ["Apply automatically", "automatic trades", "automatic +rep"]);
  }
  // Only those that were on are named; none on, none named. Nothing is ever switched on.
  assert.deepEqual(leaveSetup("later", { auto: false, autoTrades: true, autoRep: false }, false).off, ["automatic trades"]);
  assert.deepEqual(leaveSetup("later", off, false), { next: off, off: [] });
  assert.deepEqual(leaveSetup("later", off, true).next, off);
});

test("\"Not now: overlay only\" is as it was: the automatic actions off on a first start only", () => {
  assert.deepEqual(leaveSetup("overlay", on, true).next, off);
  assert.deepEqual(leaveSetup("overlay", on, false), { next: on, off: [] });
  assert.deepEqual(leaveSetup("overlay", off, false).next, off);
});

test("Finish later, Esc and the overlay step go through leaveSetup, and the log says what was switched off", () => {
  const body = app.slice(app.indexOf("function finishLater("), app.indexOf("function finishLater(") + 1200);
  assert.match(body, /leaveSetup\(how, settings\.market, !settings\.fullModeAsked \|\| firstStartRun\)/);
  assert.match(body, /switched off/);
  assert.match(body, /withoutInventory\(\)/);
  // Esc is Finish later; the overlay step is its own way out.
  assert.match(app, /setupOpen && e\.key === "Escape"\) \{\s*e\.preventDefault\(\);\s*finishLater\(\);/);
  assert.match(app, /else if \(a === "overlay"\) \{\s*void ts\.ask\("--access=overlay"\);\s*finishLater\("overlay"\);/);
  // The button's words are then true.
  assert.match(app, /data-field="setup\.later" title="[^"]*Automatic actions stay off\. \(Esc\)"/);
});
