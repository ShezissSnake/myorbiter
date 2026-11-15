// Getting in (App.svelte's setup page and the "Can't read" pages): saving trouble said on every
// one of them, and what leaving the setup page does to the automatic actions.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { carryOnEmpty, leaveSetup, missingWords, notReadYet, saveTroubleWords, stillWithout } from "../src/lib/core/gettingIn";
import { inventoryLine } from "../src/lib/core/firstStart";

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

test("leaving the setup page touches the three switches only", () => {
  // App.svelte passes the whole market settings and writes `next` back: nothing else may be in it.
  const market = { ...on, floors: { x: 5 }, approved: { x: 9 }, sales: [], minPrice: 10 };
  for (const how of ["later", "overlay"] as const) for (const first of [true, false]) assert.deepEqual(Object.keys(leaveSetup(how, market, first).next).sort(), ["auto", "autoRep", "autoTrades"], `${how}, first start: ${first}`);
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

test("saving trouble: a write that failed is tried again; settings that couldn't be read are never saved over", () => {
  const write = saveTroubleWords({ unreadable: false, cause: "No space left on device (os error 28)" });
  assert.equal(write, "Couldn't save your settings (No space left on device (os error 28)): what you change now may not be kept. MyOrbiter keeps trying.");
  const unreadable = saveTroubleWords({ unreadable: true, cause: "Permission denied (os error 13)" });
  // Said as what it is, once, and without a promise the code doesn't keep.
  assert.match(unreadable, /^MyOrbiter couldn't read your saved settings \(Permission denied \(os error 13\)\)/);
  assert.doesNotMatch(unreadable, /keeps trying/);
  assert.doesNotMatch(unreadable, /Couldn't save your settings \(MyOrbiter/);
  assert.match(unreadable, /isn't kept/);
  assert.match(unreadable, /Restart MyOrbiter/);
});

test("the saving banner is above the setup page, the \"Can't read\" pages and the collection alike", () => {
  const banner = app.indexOf("{#if saveError}");
  const chain = app.indexOf("{#if !model && error && ");
  assert.ok(banner > 0 && chain > 0, "both found");
  assert.ok(banner < chain, "the banner comes before the pages' branches, so every one of them has it");
  assert.equal(app.split("{#if saveError}").length, 2, "one banner");
  assert.match(app.slice(banner, banner + 300), /saveTroubleWords\(saveError\)/);
  // Settings that couldn't be read are said from the start, not at the first change.
  assert.match(app, /const unreadable = settingsUnreadableWhy\(\);\s*if \(unreadable != null\) saveError = \{ unreadable: true, cause: unreadable \};/);
});

// ------------------------------------------------------------------ data missing after a first read

const FOLDER_GONE = "TennoScope data folder not found at ~/.local/share/io.github.deftera186.tennoscope. Open TennoScope once with Warframe running.";
const FILE_GONE = "not found at ~/.local/share/io.github.deftera186.tennoscope/tennoscope.sqlite3: TennoScope hasn't written it yet";
const OS_GONE = "No such file or directory (os error 2)";
const NOT_YET = "No inventory read yet";

test("before the first read, missing data is the setup page's \"not read yet\"; after it, never", () => {
  for (const e of [FOLDER_GONE, FILE_GONE, OS_GONE, NOT_YET]) assert.equal(notReadYet(e, false), true, `new install: ${e}`);
  for (const e of [FOLDER_GONE, FILE_GONE, OS_GONE]) assert.equal(notReadYet(e, true), false, `read before: ${e}`);
  // A TennoScope that runs and has read nothing yet (a new one, say) is still that, said as that.
  assert.equal(notReadYet(NOT_YET, true), true);
  assert.equal(notReadYet("database disk image is malformed", false), false);
});

test("\"Continue without inventory\" counts until the first read: then missing data is an error, not an empty collection", () => {
  const base = { withoutInventory: true, noTennoScope: false, readBefore: false, held: false };
  // Chosen, nothing read yet: an empty collection until TennoScope reads one.
  for (const e of [FOLDER_GONE, FILE_GONE, NOT_YET]) assert.equal(carryOnEmpty({ ...base, error: e }), true, e);
  // Read since: the data not where MyOrbiter looks is said, never an empty collection.
  for (const e of [FOLDER_GONE, FILE_GONE, OS_GONE]) assert.equal(carryOnEmpty({ ...base, readBefore: true, error: e }), false, e);
  // Without the choice: the error, as before.
  assert.equal(carryOnEmpty({ ...base, withoutInventory: false, error: FILE_GONE }), false);
  // A Mac or a console: an empty collection, as before, read or not.
  assert.equal(carryOnEmpty({ ...base, withoutInventory: false, noTennoScope: true, readBefore: true, error: FOLDER_GONE }), true);
  // A collection on screen stays, with a note.
  assert.equal(carryOnEmpty({ ...base, held: true, error: FILE_GONE }), false);
  // The choice itself ends with the first inventory read, and stands while none is.
  assert.equal(stillWithout(true, { inventory: true }), false);
  assert.equal(stillWithout(true, { inventory: false }), true);
  assert.equal(stillWithout(false, { inventory: false }), false);
});

test("missing data after a first read: said as not found, with the folder and the way to Settings", () => {
  const folder = "~/.local/share/io.github.deftera186.tennoscope";
  for (const e of [FOLDER_GONE, FILE_GONE, OS_GONE]) {
    const w = missingWords(e, folder, true) ?? "";
    assert.match(w, /can't find TennoScope's data/, e);
    assert.ok(w.includes(folder), `the folder: ${w}`);
    assert.match(w, /Settings/);
    assert.doesNotMatch(w, /\byet\b/, `not "yet": ${w}`);
  }
  // One file missing: named.
  assert.match(missingWords(FILE_GONE, folder, true) ?? "", /\(io\.github\.deftera186\.tennoscope\/tennoscope\.sqlite3 is missing\)/);
  // Before the first read, as before.
  assert.equal(missingWords(FILE_GONE, folder, false), `TennoScope's data in ${folder} is missing io.github.deftera186.tennoscope/tennoscope.sqlite3, so MyOrbiter can't load it yet.`);
  assert.equal(missingWords("database disk image is malformed", folder, true), null);
});

test("the sidebar's Inventory line says the data isn't found, not \"Reading…\"", () => {
  const s = {
    now: 0,
    status: { supported: true, running: true, binary: "x", report: { game_running: true, setup: { access_mode: "full" as const }, health: { game_reader: { state: "ready", message: "Warframe process connected" } }, last_error: null } },
    tsError: null,
    since: 0,
    runningSince: 0,
    asked: null,
    gameSince: 0,
    signedInSince: 0,
    log: { found: true, signedIn: true },
    pickup: { error: FOLDER_GONE, entries: 0, observedAt: null, missing: true },
    ptraceScope: null,
  };
  assert.equal(inventoryLine(s).value, "Data not found");
  assert.match(inventoryLine(s).title, /Settings/);
  assert.equal(inventoryLine({ ...s, pickup: { ...s.pickup, missing: false } }).value, "Reading…");
});

test("App picks the page, the empty collection and the choice through these", () => {
  assert.match(app, /const readBefore = \$derived\(settings\.game\.valueHistory\.length > 0\)/);
  assert.match(app, /const notYet = \$derived\(!!error && notReadYet\(error, readBefore\)\)/);
  assert.match(app, /const setupShown = \$derived\(!model && notYet && !noTennoScope\)/);
  assert.match(app, /\{#if !model && error && notYet\}/);
  assert.doesNotMatch(app, /\{#if !model && error && nothingYet\(error\)\}/);
  const reload = app.slice(app.indexOf("async function reloadNow("), app.indexOf("function withoutInventory()"));
  assert.match(reload, /carryOnEmpty\(\{ error: String\(e\), withoutInventory: settings\.withoutInventory, noTennoScope, readBefore, held: !!bundle && !noInventory \}\)/);
  assert.match(reload, /settings\.withoutInventory = stillWithout\(settings\.withoutInventory, \{ inventory: !empty \}\)/);
  assert.match(app, /function loadProblem\(e: string\) \{[\s\S]{0,400}missingWords\(e, /);
});
