// What the app tells the player: advice that can work, and one word for one thing. Each part
// holds a sentence to the code it describes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { emptyText, fullModeOff, FULL_MODE_OFF, SYNC_FULL_MODE_OFF } from "../src/lib/core/fullModeOff";
import { syncIdleWord } from "../src/lib/core/syncWord";
import { plan, type BookOrder, type FloorRule, type MyOrder } from "../src/lib/core/market";
import { unchangedWhy } from "../src/lib/core/willSet";
import * as saleWords from "../src/lib/core/saleLog";

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
