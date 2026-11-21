// A read that failed is not "nothing there": the Buy form's price history, the trade partner's
// lookup for a sale's notification, the relic price read and the price history panel each end in a
// state the page tells apart, and the page says it couldn't read. An item warframe.market's list
// doesn't have is neither: the panel says it isn't listed there. Nothing is read again for it, and
// what +rep, a price or a plan decides stays.
// market.* are stand-ins; nothing reaches the network.
import "./support/runes";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { market } from "../src/lib/backend";
import { repOffered, saleNotice } from "../src/lib/core/saleNotice";
import type { Trade } from "../src/lib/core/types";

globalThis.fetch = (() => {
  throw new Error("no network in tests");
}) as never;
const { mkt } = await import("../src/lib/marketStore.svelte");
const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const part = { id: "ex2", slug: "example_part", gameRef: "/Example/Part", name: "Example Part", maxRank: null, subtypes: null, tags: [] };
const buyer = (platinum: number) => ({ id: `b${platinum}`, type: "buy", platinum, quantity: 1, rank: null, subtype: null, visible: true, user: { id: "u", ingameName: "ExampleBuyer", status: "ingame", platform: "pc", crossplay: true } });

test("the Buy form with a price history that couldn't be read says so, and prices from the book as before", async () => {
  mkt.items = [part];
  mkt.books = {};
  market.book = (async () => [buyer(30)]) as never;
  let reads = 0;
  market.history = (async () => {
    reads++;
    throw new Error("timed out");
  }) as never;
  await mkt.startBuy("Example Part");
  const d = mkt.buyDraft as unknown as { historyUnread?: boolean; median: number | null; platinum: number | null };
  assert.equal(d.historyUnread, true, "unread, not 'no sales'");
  assert.equal(d.median, null);
  assert.equal(d.platinum, 31, "the best buyer and one: the price is what it was");
  assert.equal(reads, 1, "read once: nothing tries again");
  mkt.buyDraft = null;
  market.history = (async () => []) as never;
  await mkt.startBuy("Example Part");
  assert.equal((mkt.buyDraft as unknown as { historyUnread?: boolean }).historyUnread, false, "read, and nothing sold: no sales");
  mkt.buyDraft = null;
  const dialog = source("src/lib/ui/BuyDialog.svelte");
  assert.match(dialog, /Couldn't read the price history/, "the form says it, in its own words for a failed read");
  assert.match(dialog, /d\.historyUnread/);
});

const NOW = 1_792_700_000_000;
const trade = (t: Partial<Trade> = {}): Trade => ({ uptime: 1, at: NOW / 1000 - 60, partner: "ExampleBuyer", offered: [{ name: "Example Part", rank: null, count: 1 }], received: [], platinum_offered: 0, platinum_received: 20, ...t });

test("a sale's notification says when the buyer couldn't be looked up, and +rep is decided as before", () => {
  assert.equal(saleNotice(trade()).body, "");
  assert.equal(saleNotice(trade(), null, true).body, "Couldn't check whether ExampleBuyer is on warframe.market, so no +rep here (see Stats).");
  const marked = saleNotice(trade(), [{ name: "Example Part", rank: null, count: 1, outcome: "marked" }], true).body.split("\n");
  assert.equal(marked.length, 2, "after what MyOrbiter did with the sale");
  assert.match(marked[1], /^Couldn't check whether ExampleBuyer/);
  // The decision itself is untouched: a lookup that failed offers no +rep, as one that found no one.
  const o = { key: "k", partner: "ExampleBuyer", at: NOW, now: NOW, autoRep: false, linked: true, rep: {}, trades: [] };
  assert.equal(repOffered({ ...o, onMarket: false }), false);
  const app = source("src/App.svelte");
  const tell = app.slice(app.indexOf("async function tellSale("), app.indexOf("function repShown("));
  assert.match(tell, /mkt\.user\(t\.partner\)\.catch\(\(\) => false as const\)/, "a failed lookup is false, not undefined (no lookup made)");
  assert.match(tell, /const offer = repOffered\(\{ \.\.\.asked, onMarket: !!u \}\);/, "+rep: on warframe.market only when found, as before");
  assert.match(tell, /const unread = u === false && repOffered\(\{ \.\.\.asked, onMarket: true \}\);/, "said only when the lookup is what held +rep back");
  assert.match(tell, /saleNotice\(t, lines, unread\)/);
});

test("the relic price read keeps which relics it couldn't read; the item list failing is every one", async () => {
  market.items = (async () => [
    { id: "r1", slug: "lith_x1_relic", gameRef: "/r1", name: "Lith X1 Relic", maxRank: null, subtypes: ["intact", "radiant"], tags: ["relic"] },
    { id: "r2", slug: "lith_x2_relic", gameRef: "/r2", name: "Lith X2 Relic", maxRank: null, subtypes: ["intact", "radiant"], tags: ["relic"] },
  ]) as never;
  mkt.items = [];
  const day = new Date(Date.now() - 86_400_000).toISOString();
  market.history = (async (slug: string) => {
    if (slug === "lith_x1_relic") throw new Error("timed out");
    return [{ at: day, median: 4, volume: 3, min: 3, max: 5, rank: null, subtype: "intact" }];
  }) as never;
  const store = mkt as unknown as { relicUnread: string[] };
  assert.deepEqual(store.relicUnread, [], "none before a read");
  const read = await mkt.readRelicPrices(["Lith X1", "Lith X2"], {});
  assert.ok(read?.["Lith X2"], "what was read is kept, as before");
  assert.equal(read?.["Lith X1"], undefined);
  assert.deepEqual(store.relicUnread, ["Lith X1"]);
  // The item list doesn't come: nothing could be read.
  mkt.items = [];
  market.items = (async () => {
    throw new Error("timed out");
  }) as never;
  assert.equal(await mkt.readRelicPrices(["Lith X1", "Lith X3"], {}), null, "what the read returns stays as it was");
  assert.deepEqual(store.relicUnread, ["Lith X1", "Lith X3"]);
  // Read fine: the list empties.
  market.items = (async () => [{ id: "r1", slug: "lith_x1_relic", gameRef: "/r1", name: "Lith X1 Relic", maxRank: null, subtypes: ["intact"], tags: ["relic"] }]) as never;
  market.history = (async () => []) as never;
  await mkt.readRelicPrices(["Lith X1"], {});
  assert.deepEqual(store.relicUnread, []);
  const spares = source("src/lib/tabs/Spares.svelte");
  assert.match(spares, /mkt\.relicUnread\.length/);
  assert.match(spares, /warframe\.market didn't answer for the prices of \{relicsUnread\} relic/, "Sell spares' own words for a failed read");
  assert.doesNotMatch(spares.slice(spares.indexOf("{relicsUnread} relic")).split("\n")[0], /retry/i, "nothing reads them again sooner");
});

test("the price history panel tells an item warframe.market doesn't list from a read that failed, each in true words", () => {
  const panel = source("src/lib/ui/PriceHistory.svelte");
  const line = (cond: string) => panel.match(new RegExp(`\\{(?:#if|:else if) ${cond}\\}\\s*<p[^>]*>([^<]*)</p>`))?.[1];
  // A read that failed: the item list or the history didn't come.
  const failedWords = line("failed");
  assert.match(failedWords ?? "", /^Couldn't read its price history/, "a failed read says it couldn't read");
  assert.match(panel, /\} catch \{\s*if \(current === want\) failed = true;/, "a list or history that didn't come is a failed read");
  // Not in warframe.market's list, which was read: nothing failed, so it doesn't say "couldn't read".
  const unlistedWords = line("unlisted");
  assert.ok(unlistedWords, "the panel has its own line for an item warframe.market doesn't list");
  assert.match(unlistedWords, /not listed on warframe\.market/i);
  assert.doesNotMatch(unlistedWords, /couldn't|didn't answer|nobody has sold/i, "nothing failed, and it isn't 'nobody sold one'");
  const missing = panel.slice(panel.indexOf("if (!it) {"), panel.indexOf("const points = await mkt.history"));
  assert.match(missing, /if \(mkt\.items\.length\) unlisted = true;\s*else failed = true;/, "not listed only when the list was read; an empty list wasn't");
  assert.doesNotMatch(missing, /days = \[\]/, "neither is 'nobody sold one'");
  // Each case starts clean when the panel is shown for another item.
  assert.match(panel, /days = null;\s*failed = false;\s*unlisted = false;/);
  // The failed line first, then the unlisted one, both before the reading line and the history.
  const at = (s: string) => panel.indexOf(s);
  assert.ok(at("{#if failed}") >= 0 && at("{#if failed}") < at("{:else if unlisted}") && at("{:else if unlisted}") < at("{:else if days == null}"));
});
