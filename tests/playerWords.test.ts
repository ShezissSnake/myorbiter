// What the app tells the player: advice that can work, and one word for one thing. Each part
// holds a sentence to the code it describes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { emptyText, fullModeOff, FULL_MODE_OFF, SYNC_FULL_MODE_OFF } from "../src/lib/core/fullModeOff";
import * as fullModeWords from "../src/lib/core/fullModeOff";
import { syncIdleWord } from "../src/lib/core/syncWord";
import { plan, type BookOrder, type FloorRule, type MyOrder } from "../src/lib/core/market";
import { unchangedWhy } from "../src/lib/core/willSet";
import * as saleWords from "../src/lib/core/saleLog";
import { notListedYet } from "../src/lib/core/readyToList";
import * as firstStartWords from "../src/lib/core/firstStart";
import * as traceWords from "../src/lib/core/traces";
import * as buildWords from "../src/lib/core/buildsPage";
import type { Build } from "../src/lib/core/builds";
import * as guardWords from "../src/lib/core/listGuard";
import * as tradeWords from "../src/lib/core/tradeLimit";

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
  assert.match(home, /\{:else if nothingRead\}\s*<p class="dim">\{offFull \? FULL_MODE_OFF : NO_READ_YET\}<\/p>\s*\{:else if worthy\.length && !byKind\.length\}/);
});

// What Reprice does to a price: it follows the second-cheapest seller down, a raise stops at the
// cheapest seller, and a change inside the dead band isn't sent. "matched" is said only when the
// price is the market price.

const me = { id: "me", ingameName: "ExamplePlayer", platform: "pc", crossplay: true };
let sellerN = 0;
const seller = (platinum: number): BookOrder => ({ id: `s${++sellerN}`, type: "sell", platinum, quantity: 1, rank: null, subtype: null, visible: true, user: { id: `u${sellerN}`, ingameName: `Seller${sellerN}`, status: "ingame", platform: "pc", crossplay: true } });
const listing = (platinum: number): MyOrder => ({ id: "o", itemId: "it", type: "sell", platinum, quantity: 1, rank: null, subtype: null, visible: true, updatedAt: null });
const drift: FloorRule = { floor: null, minShare: 0, reference: null, min: 1, drift: true };
const why = (price: number, book: BookOrder[], rule: Partial<FloorRule> = {}) => {
  const p = plan(listing(price), book, me, { ...drift, ...rule });
  assert.equal(p.change, false, "Reprice leaves it");
  return { reason: p.reason, ...unchangedWhy(p, price) };
};

test("Will set names why Reprice leaves a price: one text per reason plan returns", () => {
  // The audit's Arcane Energize: 139p, sellers at 139p and 196p: the market price is 196p, but a
  // raise stops at the cheapest seller.
  const held = why(139, [seller(139), seller(196), seller(200)]);
  assert.deepEqual([held.reason, held.word], ["already", "held at cheapest"]);
  assert.match(held.title, /196p.*no higher than the cheapest seller online or in game \(139p\)/);
  // The audit's Boltor Prime Set: 100p against a market of 96p: inside the dead band.
  const band = why(100, [seller(95), seller(96), seller(130)]);
  assert.deepEqual([band.reason, band.word], ["steady", "within 2p/5%"]);
  // At the market price already.
  const at = why(50, [seller(45), seller(50), seller(60)]);
  assert.deepEqual([at.reason, at.word], ["already", "matched"]);
  // On its floor, under the market.
  const floor = why(80, [seller(40), seller(50), seller(60)], { floor: 80 });
  assert.deepEqual([floor.reason, floor.word], ["floor", "on its floor"]);
  // One seller: no market price.
  const none = why(80, [seller(40)]);
  assert.deepEqual([none.reason, none.word], ["no-sellers", "no market price"]);
  // Every reason has its own words (the record in unchangedWhy is keyed on Plan["reason"]).
  for (const reason of ["match", "median"] as const) assert.ok(unchangedWhy({ reason, competitor: plan(listing(50), [seller(45), seller(50)], me, drift).competitor, floor: 1 }, 50).word);
});

test("Orders' Will set takes its word from unchangedWhy, never a bare \"matched\"", () => {
  const orders = src("src/lib/tabs/Orders.svelte");
  assert.doesNotMatch(orders, /<span class="register ok">matched<\/span>/);
  assert.match(orders, /\{:else if p\}\{@const u = unchangedWhy\(p, o\.platinum\)\}<span class="register ok" title=\{u\.title\}>\{u\.word\}<\/span>/);
});

test("Orders, the Guide and the Sell dialog say a raise stops at the cheapest seller", () => {
  const orders = src("src/lib/tabs/Orders.svelte");
  const guide = src("src/lib/tabs/Guide.svelte");
  const dialog = src("src/lib/ui/ListDialog.svelte");
  // Nothing says a listing is kept at the second-cheapest seller.
  for (const [f, s] of [["Orders", orders], ["Guide", guide], ["ListDialog", dialog]]) {
    assert.doesNotMatch(s, /kept at the market price[,:] (the )?second-cheapest/, f);
    assert.doesNotMatch(s, /keeps it at the market price/, f);
  }
  const RAISE = /a raise (goes|stops) no higher than the cheapest/;
  // Orders' Details sentence, the Market price column's help and the row switch's tooltip.
  assert.match(orders.slice(orders.indexOf("<PageHead"), orders.indexOf("/>", orders.indexOf("<PageHead"))), RAISE);
  assert.match(orders.slice(orders.indexOf('sh("cheapest"'), orders.indexOf("Sort by it\")", orders.indexOf('sh("cheapest"'))), RAISE);
  assert.match(orders.slice(orders.indexOf('<td class="center c-auto"'), orders.indexOf("</td>", orders.indexOf('<td class="center c-auto"'))), RAISE);
  // The Guide's Orders sentence and its line in the page list.
  assert.match(guide.slice(guide.indexOf('"Your listings,'), guide.indexOf("New listing finds what you hold")), RAISE);
  assert.doesNotMatch(guide, /Reprice moves it there/);
  // The Sell dialog.
  assert.match(dialog.slice(dialog.indexOf("It joins your Orders"), dialog.indexOf("</p>", dialog.indexOf("It joins your Orders"))), RAISE);
});

test("the Undercut tile says how many of its listings Reprice leaves, and why", () => {
  const orders = src("src/lib/tabs/Orders.svelte");
  const tile = orders.slice(orders.indexOf("Undercut: ${undercut}"), orders.indexOf('<span class="register">Undercut</span>'));
  assert.match(tile, /\$\{undercutLeft\}/);
  assert.match(tile, /follows the second-cheapest seller down/);
  assert.match(orders, /const undercutLeft = \$derived\(/);
});

// "Auto" names one thing: the row switch that decides whether Reprice touches a listing is not
// called Auto-price, and automatic repricing is "Apply automatically" wherever Orders and Settings
// name it.

test("the row switch has a name without \"auto\", and its tooltip says who changes the price", () => {
  const orders = src("src/lib/tabs/Orders.svelte");
  const cell = orders.slice(orders.indexOf('<td class="center c-auto"'), orders.indexOf("</td>", orders.indexOf('<td class="center c-auto"')));
  assert.doesNotMatch(cell, /Auto-price|auto-price/i);
  assert.match(cell, /data-label="Reprice"/);
  assert.match(cell, /label="Reprice this listing"/);
  // Who changes it: the player with Reprice, MyOrbiter by itself only while Apply automatically is on.
  assert.match(cell, /you change its price with Reprice/);
  assert.match(cell, /MyOrbiter changes it by itself only while Apply automatically is on/);
  assert.match(cell, /settings\.auto \?/, "the tooltip follows Apply automatically's switch");
  const head = orders.slice(orders.indexOf('<th class="right floorcol"'), orders.indexOf('<th class="center" title="Whether buyers see'));
  assert.match(head, />Reprice<\/th>/);
  assert.doesNotMatch(head, /Auto-price/);
  assert.doesNotMatch(orders, /Auto-price/, "Orders says Auto-price nowhere");
  for (const f of ["src/lib/help/trade.ts", "src/lib/tabs/Guide.svelte"]) assert.doesNotMatch(src(f), /Auto-price|auto-priced/, f);
});

test("automatic repricing has one name, Apply automatically, on Orders and in Settings", () => {
  const settings = src("src/lib/SettingsSheet.svelte");
  assert.match(settings, /name="settings\.auto-reprice"[^\n]*?label="Change my prices on warframe\.market by itself \(Apply automatically\)"/);
  const words = (s: string) => s.replace(/<!--[\s\S]*?-->|\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(words(settings), /automatic repricing/i, "no other name in Settings' words");
  const help = src("src/lib/help/settings.ts");
  assert.doesNotMatch(help, /title: "Automatic repricing"/);
  assert.match(help, /title: "Apply automatically"/);
  assert.doesNotMatch(words(src("src/lib/tabs/Orders.svelte")), /automatic repricing/i);
});

// Sales: deleting a sale takes it out of the log only; warframe.market keeps what Sold changed.

test("Sales' Delete question says warframe.market keeps its change", () => {
  const sales = src("src/lib/tabs/Sales.svelte");
  const ask = sales.slice(sales.indexOf("{#if removing === keyOf(s)}"), sales.indexOf("{/if}", sales.indexOf("{#if removing === keyOf(s)}")));
  assert.doesNotMatch(ask, />Delete\?</, "not a bare Delete?");
  assert.match(ask, />Delete from the log only\?</);
  assert.match(ask, /title=\{SALE_DELETE_KEEPS\}/);
  assert.match(sales, /title=\{`Delete: take this sale out of the log\. \$\{SALE_DELETE_KEEPS\}`\}/);
  const { SALE_DELETE_KEEPS } = saleWords;
  assert.match(SALE_DELETE_KEEPS, /warframe\.market keeps/);
  assert.match(SALE_DELETE_KEEPS, /stays closed or lowered/);
  assert.match(SALE_DELETE_KEEPS, /sale stays on your profile/);
});

// "Market" is Orders' word for the second-cheapest seller now; Sales compares with the daily
// median when the thing sold, and names it.

test("Sales names the median, never \"Vs market\"", () => {
  const sales = src("src/lib/tabs/Sales.svelte");
  assert.doesNotMatch(sales, /Vs market/);
  assert.match(sales, /<Stat label="Vs median, 30 days"/);
  assert.match(sales, />Vs median<\/th>/);
  assert.match(sales, /title="[^"]*daily median[^"]*not Orders' Market price[^"]*">Vs median<\/th>/);
  const help = src("src/lib/help/trade.ts");
  assert.doesNotMatch(help, /against the market price that day/);
  assert.match(help, /Lists each sale against the daily median when it sold/);
  const guide = src("src/lib/tabs/Guide.svelte");
  assert.doesNotMatch(guide, /each sale against the market/);
});

// Home's Ready to list: its figure counted copies already listed, which the listings' total above
// it counts too; each count now says what it counts.

test("Ready to list leaves out copies already listed, each listing's copies once", () => {
  const rows = [
    { kind: "set", name: "Example Prime Set", rank: null, quantity: 3, each: 50, plat: 150 },
    { kind: "arcane", name: "Arcane Example", rank: 5, quantity: 2, each: 100, plat: 200 },
    { kind: "arcane", name: "Arcane Example", rank: 0, quantity: 4, each: 5, plat: 20 },
    // A month sells two of these: four held, two counted.
    { kind: "mod", name: "Slow Mod", rank: 0, quantity: 4, each: 10, plat: 20 },
    { kind: "mod", name: "Unlisted Mod", rank: 0, quantity: 1, each: 30, plat: 30 },
  ];
  const out = notListedYet(rows, [
    { name: "Example Prime Set", rank: null, quantity: 2 },
    { name: "Arcane Example", rank: 5, quantity: 2 },
    { name: "Slow Mod", rank: 0, quantity: 1 },
    { name: undefined, rank: null, quantity: 9 },
  ]);
  assert.deepEqual(out.map((r) => [r.name, r.rank, r.quantity, r.plat]), [
    ["Example Prime Set", null, 1, 50],
    ["Arcane Example", 0, 4, 20],
    ["Slow Mod", 0, 3, 20],
    ["Unlisted Mod", 0, 1, 30],
  ]);
  // Nothing listed: the rows as they were.
  assert.deepEqual(notListedYet(rows, []), rows);
});

test("Home's Ready to list counts what isn't listed yet, and names its units", () => {
  const home = src("src/lib/tabs/Home.svelte");
  // The figure and the kinds come from the copies not listed yet.
  assert.match(home, /const ready = \$derived\(notListedYet\(worthy, orders\.map\(/);
  assert.match(home, /const xs = ready\.filter\(\(t\) => t\.kind === k\)/);
  // Units: copies on each kind, items not listed at all.
  assert.match(home, /<span class="dim">\{k\.count\} \{k\.count === 1 \? "copy" : "copies"\}<\/span>/);
  assert.match(home, /\$\{unlisted\} item\$\{unlisted === 1 \? "" : "s"\} not listed yet/);
  assert.match(home, /Copies already on your listings, shown or hidden, are left out/);
  // Everything listed already is not "Nothing spare".
  assert.match(home, /\{:else if worthy\.length && !byKind\.length\}\s*<p class="dim">Every spare worth your minimum or more is listed already/);
});

// TennoScope is "TennoScope" in the player's words; there is no other one to tell it from.

test("the player's words never say \"the patched TennoScope\"", () => {
  const places = ["src/lib/tabs/Home.svelte", "src/lib/tabs/Builds.svelte", "src/lib/ui/RelicRuns.svelte", "src/lib/tabs/Stats.svelte", "src/lib/tabs/InMission.svelte", "src/lib/tabs/Spares.svelte", "src/lib/tabs/Guide.svelte"];
  for (const f of places) {
    // Comments may say how TennoScope came to read it; what the page shows may not.
    const shown = src(f).replace(/<!--[\s\S]*?-->|\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(shown, /patched TennoScope/i, f);
  }
});

test("Home's Foundry card, with TennoScope off, links to where it is set up", () => {
  const home = src("src/lib/tabs/Home.svelte");
  assert.match(home, /setUpTennoscope = null/);
  assert.match(home, /\{#if setUpTennoscope\} <button class="link" onclick=\{setUpTennoscope\}>Set up TennoScope<\/button>\{\/if\}/);
  const app = src("src/App.svelte");
  assert.match(app, /<Home [^\n]*setUpTennoscope=\{!noTennoScope && !ts\.running \? \(\) => \(showTennoscope = true\) : null\}/);
});

// The setup page's third step: its title follows the stage under it, Report a bug sits beside
// Try again, and the page says that the sidebar waits.

test("the setup page's third step never asks for what its stage says is done", () => {
  const { gameStepTitle } = firstStartWords;
  const at = (step: "game" | "inventory", waitingFor: string | null) => gameStepTitle({ step, waitingFor });
  assert.equal(at("game", "Warframe to start"), "Start Warframe and sign in");
  assert.equal(at("game", "you to sign in"), "Sign in to Warframe");
  // Signed in: reading the inventory, or loading it.
  for (const w of ["TennoScope to read your inventory", "MyOrbiter to load what TennoScope read", null]) {
    const t = at("inventory", w);
    assert.doesNotMatch(t, /Start Warframe|sign in/i, String(w));
    assert.equal(t, "TennoScope reads your inventory");
  }
  const app = src("src/App.svelte");
  assert.match(app, /\{ id: "game", title: gameStepTitle\(setup\) \}/);
  assert.doesNotMatch(app, /title: "Start Warframe and sign in"/);
});

test("the setup page has Report a bug beside Try again, and says the sidebar waits", () => {
  const app = src("src/App.svelte");
  const row = app.slice(app.indexOf("{#each setup.actions.filter("), app.indexOf("{/each}", app.indexOf("{#each setup.actions.filter(")) + 200);
  assert.match(row, /\{#if setup\.actions\.includes\("retry"\)\}<button data-field="setup\.bug" onclick=\{\(\) => bugReport\.show\(\)\}>Report a bug<\/button>\{\/if\}/);
  assert.match(app, /Three steps, once; you can finish later at any of them\. Meanwhile the sidebar waits: its pages open once you're set up, or after Finish later\./);
});

// Void Traces near, at or over the cap: one note for Current fissure and the Planner, "over" when
// over, and the "!" amber always carries.

test("Void Traces near, at or over the cap read the same on both pages, with the amber note's !", () => {
  const { traceCapWord } = traceWords;
  assert.equal(traceCapWord(500, 1000), null, "far under: no note");
  assert.equal(traceCapWord(950, 1000), "! near the cap: refine some");
  assert.equal(traceCapWord(1000, 1000), "! at the cap: refine some");
  assert.equal(traceCapWord(1080, 1000), "! over the cap: refine some");
  assert.equal(traceCapWord(1080, null), null, "no rank: no cap");
  const fissure = src("src/lib/tabs/InMission.svelte");
  const plate = src("src/lib/ui/RelicPlate.svelte");
  for (const [f, s] of [["InMission", fissure], ["RelicPlate", plate]] as const) {
    assert.match(s, /traceCapWord\(traces, cap\)/, f);
    assert.doesNotMatch(s, /"(near|at) the cap: refine some"/, f);
  }
});

// Builds: "You have everything it takes" never stands alone over empty slots.

test("a build with empty slots says how many beside You have everything it takes", () => {
  const { emptySlots, haveAllWord } = buildWords;
  const mod = { path: "/Lotus/Upgrades/Mods/Example" };
  const b = (x: Partial<Build>): Build => ({ id: "b", item: "/Lotus/Example/Gun", kind: "primary", mods: [], arcanes: [], shards: [], source: "pasted", importedAt: 0, ...x });
  // A rifle: 8 mod slots, an exilus, one arcane.
  const full = b({ mods: Array(8).fill(mod), exilus: mod, arcanes: [mod] });
  assert.equal(emptySlots(full), 0);
  assert.equal(haveAllWord(0), "You have everything it takes");
  const sparse = b({ mods: [mod, null, mod, mod, mod, mod], arcanes: [mod] });
  assert.equal(emptySlots(sparse), 4, "slot 2, slots 7 and 8, and the exilus");
  assert.equal(haveAllWord(4), "You have everything it takes · 4 slots empty");
  assert.equal(haveAllWord(1), "You have everything it takes · 1 slot empty");
  const card = src("src/lib/ui/builds/BuildCard.svelte");
  assert.match(card, /haveAllWord\(emptySlots\(b\)\)/);
  assert.doesNotMatch(card, /<span class="good">You have everything it takes<\/span>/);
});

// The listing form: no number the last check (guardListing: never more than spareNow's free) would
// refuse, and "the rest" said truly.

test("the listing form's figures never pass what the last check lets go, and say what the rest are", () => {
  const { formRoom, spareLine, tooManyLine } = guardWords;
  // 5 can be spared: 3 on a listing already, 2 free.
  const now = { free: 2, same: 3, across: null };
  assert.equal(formRoom(5, false, null, now), 2, "a second listing: the free copies only");
  assert.equal(formRoom(5, true, 3, now), 2, "added to the listing: the same");
  assert.equal(formRoom(5, true, 1, now), 2, "another listing of it holds copies too: still the free ones");
  assert.equal(formRoom(5, false, null, null), 5, "nothing counted: the page's count");
  assert.equal(spareLine(5, null, false, now), "You can spare 5, 3 on your listings already");
  assert.equal(spareLine(5, null, true, now), "You can spare 5");
  assert.equal(spareLine(4, ", less 2 inside your Example Prime Set listing", false, { free: 4, same: 0, across: "2 inside your Example Prime Set listing" }), "You can spare 4, less 2 inside your Example Prime Set listing");
  assert.equal(tooManyLine({ available: 5, room: 2, quantity: 4, merging: false, existingQty: 3, now }), "That's more than the 2 that can go up: 3 of the 5 you can spare are on your listings already.");
  assert.equal(tooManyLine({ available: 5, room: 2, quantity: 7, merging: false, existingQty: 3, now }), "That's more than the 2 that can go up: 3 of the 5 you can spare are on your listings already; the rest are copies MyOrbiter keeps back for you.");
  assert.equal(tooManyLine({ available: 3, room: 3, quantity: 5, merging: false, existingQty: null, now: { free: 3, same: 0, across: null } }), "That's more than the 3 you can spare; the rest are copies MyOrbiter keeps back for you.");
  const across = { free: 3, same: 0, across: "2 inside your Example Prime Set listing" };
  const cut = tooManyLine({ available: 3, room: 3, quantity: 5, merging: false, existingQty: null, now: across });
  assert.equal(cut, "That's more than the 3 you can spare; the rest are kept back for you or offered already (2 inside your Example Prime Set listing).");
  assert.doesNotMatch(cut, /the rest are copies MyOrbiter keeps back/);
  assert.equal(tooManyLine({ available: 5, room: 2, quantity: 4, merging: true, existingQty: 3, now }), "You can spare 5 and 3 are listed already, so 2 more at most.");
  const form = src("src/lib/ui/ListDialog.svelte");
  assert.match(form, /mkt\.spareNow\(model, item, d\.rank, d\.subtype\)/);
  assert.match(form, /const room = \$derived\(d\?\.available == null \? null : formRoom\(/);
  assert.match(form, /\{spareLine\(d\.available, d\.spareWhy \?\? null, merging, now\)\}/);
  assert.doesNotMatch(form, /`That's more than the \$\{d\.available\} you can spare; the rest are copies MyOrbiter keeps back for you\.`/);
});

// Trades a day: none at Mastery Rank 0 and 1 (tradeAllowance), so no sentence says "as many as
// your Mastery Rank" alone.

test("trades a day read against tradeAllowance: none before Mastery Rank 2", () => {
  const { tradeAllowance, tradesADay } = tradeWords;
  for (const rank of [0, 1]) {
    const limit = tradeAllowance([], rank, 0).limit!;
    assert.equal(limit, 0);
    assert.match(tradesADay(limit), /^No trades before Mastery Rank 2/);
  }
  const at8 = tradeAllowance([], 8, 0).limit!;
  assert.equal(tradesADay(at8), "Trades a day are your Mastery Rank (8; extra trades from Founder status are not added)");
  for (const f of ["src/lib/tabs/Orders.svelte", "src/lib/tabs/Home.svelte"]) {
    const s = src(f);
    assert.match(s, /tradesADay\(trades\.limit\)/, f);
    assert.doesNotMatch(s, /Trades a day are your Mastery Rank \(/, f);
  }
  const guide = src("src/lib/tabs/Guide.svelte");
  assert.doesNotMatch(guide, /Trades left today \(as many as your Mastery Rank,/);
  assert.match(guide, /Trades left today \(as many as your Mastery Rank from rank 2, none at 0 or 1;/);
});

// Full mode has one name wherever the player reads it: the last-copy notification, the line
// Settings and Orders show for Hide last copies, and the tooltip of Orders' still-hidden line.

test("the last-copy words name Full mode, never Full access, in one sentence", () => {
  const { SYNC_READS_NOW } = fullModeWords;
  assert.equal(SYNC_READS_NOW, "In Full mode, while Warframe runs, Sync asks TennoScope for a read now");
  const automation = src("src/lib/core/automation.ts");
  assert.match(automation, /\$\{SYNC_READS_NOW\}, and a listing's Shown switch on Orders shows it at any time/);
  const app = src("src/App.svelte");
  const still = app.slice(app.indexOf("mkt.note(`Still hidden:"), app.indexOf("\n", app.indexOf("mkt.note(`Still hidden:")));
  assert.match(still, /\$\{SYNC_READS_NOW\}\./);
  const orders = src("src/lib/tabs/Orders.svelte");
  const tip = orders.slice(orders.indexOf("The last-copy rule (Settings, Trades)"), orders.indexOf("hidden for now</span>"));
  assert.match(tip, /\$\{SYNC_READS_NOW\}\./);
  const words = (s: string) => s.replace(/<!--[\s\S]*?-->|\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, "");
  for (const [f, s] of [["App", app], ["automation", automation], ["Orders", orders]]) assert.doesNotMatch(words(s), /Full access/, f);
});

test("Arcanes, Mods and Parts take the one Full-mode-off case, as Inventory does", () => {
  for (const f of ["Arcanes", "Mods", "Parts"]) {
    const s = src(`src/lib/tabs/${f}.svelte`);
    assert.match(s, /const offFull = \$derived\(fullModeOff\(mkt\.fullMode, noInventoryRead\(model\)\)\)/, f);
    const empties = [...s.matchAll(/empty=(\{emptyText\([^\n]*?, offFull\)\}|"[^"]*")/g)].map((m) => m[1]).filter((e) => /press Sync/.test(e));
    assert.ok(empties.length, `${f}: an empty text that says press Sync`);
    for (const e of empties) assert.match(e, /^\{emptyText\("[^"]*press Sync[^"]*", offFull\)\}$/, f);
  }
});
