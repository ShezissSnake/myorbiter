// A sale a trade logged without marking its listing sold ("still listed", or no sure listing):
// a Sold click on a listing of that item and rank soon after asks whether it is that sale, and
// "that sale" marks the copies the trade could not, logging nothing more. The Sales page says so
// before a sale typed there is added a second time.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { salesCoveredByTrades } from "../src/lib/core/market";
import { markedForTrade, soldAfterTrade, soldAfterUnmarked, soldAnswers, tradeSaleNear } from "../src/lib/core/soldMarks";
import { salesOf } from "../src/lib/core/saleLog";
import type { Sale, TradeLogEntry } from "../src/lib/backend";

const at = 1_792_512_340_000;
/** Stats' revenue as Stats.svelte adds it: every sale trade's platinum, plus the copies no trade covers. */
function revenue(sales: Sale[], trades: TradeLogEntry[]) {
  const covered = salesCoveredByTrades(sales, trades);
  return trades.reduce((n, t) => n + t.platIn, 0) + sales.reduce((n, s) => n + (s.quantity - (covered.get(s) ?? 0)) * s.platinum, 0);
}
const trade: TradeLogEntry = { key: "s|1", at, partner: "Buyer1", offered: [{ name: "Serration", rank: 10, count: 2 }], received: [], platOut: 0, platIn: 40 };
/** The trade's sale as the marking logs it when warframe.market refused the listing's mark ("still listed"). */
const stillListed: Sale = { at, item: "Serration", rank: 10, quantity: 2, platinum: 20, trade: "s|1", unmarked: { listing: "o1", count: 2, at: at + 5_000 } };
const serration = { name: "Serration", rank: 10 };
/** What a Sold click on Orders logs when it goes the usual way (sendSale). */
const clicked = (quantity: number, t = at + 60_000): Sale => ({ at: t, item: "Serration", rank: 10, quantity, platinum: 20 });

test("before: a Sold click after 'still listed' logs the sale again, and Stats counts it twice with marking on", () => {
  // Marking on: the trade's sale names the trade, so the hand-logged one pairs with nothing.
  assert.equal(revenue([clicked(2), stillListed], [trade]), 80);
  // Marking off: no sale from the trade; Stats pairs the click with the trade itself.
  assert.equal(revenue([clicked(2)], [trade]), 40);
  // The question the last change added is not asked: no trade lowered that listing.
  assert.equal(soldAfterTrade("o1", [stillListed], [trade], at + 60_000), null);
});

test("a Sold click soon after asks, by item and rank, with the trade's copies and partner", () => {
  const now = at + 60_000;
  assert.deepEqual(soldAfterUnmarked(serration, [stillListed], [trade], now), { count: 2, partner: "Buyer1" });
  // Another rank, another item, a sale logged by hand, or ten minutes on: no question.
  assert.equal(soldAfterUnmarked({ name: "Serration", rank: 0 }, [stillListed], [trade], now), null);
  assert.equal(soldAfterUnmarked({ name: "Arcane Energize", rank: 10 }, [stillListed], [trade], now), null);
  assert.equal(soldAfterUnmarked(serration, [{ ...stillListed, trade: undefined }], [trade], now), null);
  assert.equal(soldAfterUnmarked(serration, [stillListed], [trade], at + 5_000 + 10 * 60_000), null);
  // A sale the trade logged and marked sold: this question is not asked (soldAfterTrade's is).
  const { unmarked: _, ...marked } = stillListed;
  assert.equal(soldAfterUnmarked(serration, [{ ...marked, lowered: { listing: "o1", count: 2, at: at + 5_000 } }], [trade], now), null);
  // An older record, without the field: as before, no question.
  assert.equal(soldAfterUnmarked(serration, [marked], [trade], now), null);
  // No sure listing ("not listed" on the notification, a listing of it up all the same): asked too.
  assert.deepEqual(soldAfterUnmarked(serration, [{ ...stillListed, unmarked: { listing: null, count: 2, at: at + 5_000 } }], [trade], now), { count: 2, partner: "Buyer1" });
  // A name the log and the market spell differently ("… Blueprint") is the same item.
  const bp: Sale = { ...stillListed, item: "Nekros Prime Blueprint", rank: null };
  assert.ok(soldAfterUnmarked({ name: "Nekros Prime Blueprint", rank: null }, [bp], [trade], now));
});

test("the answers: 'that sale' sends the trade's copies, 'another sale' the click's; the focus starts on the one that sends least", () => {
  assert.deepEqual(soldAnswers(1, 2), { that: 2, another: 1, focus: "another" });
  assert.deepEqual(soldAnswers(2, 2), { that: 2, another: 2, focus: "that" }, "the same copies: that sale logs nothing more");
  assert.deepEqual(soldAnswers(3, 2), { that: 2, another: 3, focus: "that" });
});

test("'that sale': the trade's sale records what was lowered and logs nothing; a further click asks the last change's question", () => {
  const now = at + 60_000;
  const others: Sale = { at, item: "Serration", rank: 10, quantity: 1, platinum: 20 };
  const after = markedForTrade([stillListed, others], serration, "o1", 2, now);
  assert.equal(after.length, 2, "no sale added");
  assert.deepEqual(after[0], { at, item: "Serration", rank: 10, quantity: 2, platinum: 20, trade: "s|1", lowered: { listing: "o1", count: 2, at: now } });
  assert.equal(after[1], others, "another sale is untouched");
  assert.equal(soldAfterUnmarked(serration, after, [trade], now), null, "no longer asked as unmarked");
  assert.deepEqual(soldAfterTrade("o1", after, [trade], now + 1_000), { count: 2, partner: "Buyer1" }, "asked as marked");
  // Marking on, 'that sale': Stats counts the trade once, as with marking off.
  const alone = markedForTrade([stillListed], serration, "o1", 2, now);
  assert.equal(revenue(alone, [trade]), 40);
  assert.equal(revenue(alone, [trade]), revenue([clicked(2)], [trade]));
  // 'Another sale' goes the usual way: a sale of its own, as the player says.
  assert.equal(revenue([clicked(1), stillListed], [trade]), 60);
});

test("'that sale' marked fewer copies than the trade could not (the listing had fewer): the rest stay unmarked", () => {
  const now = at + 60_000;
  const after = markedForTrade([stillListed], serration, "o1", 1, now);
  assert.deepEqual([after[0].lowered, after[0].unmarked], [{ listing: "o1", count: 1, at: now }, { listing: "o1", count: 1, at: at + 5_000 }]);
  assert.deepEqual(soldAfterUnmarked(serration, after, [trade], now), { count: 1, partner: "Buyer1" });
});

test("two trades of the item in ten minutes, neither marked: counted together, the newest first, each recording its own copies", () => {
  const now = at + 3 * 60_000;
  const t2: TradeLogEntry = { ...trade, key: "s|2", at: at + 60_000, partner: "Buyer2", offered: [{ name: "Serration", rank: 10, count: 1 }], platIn: 20 };
  const second: Sale = { ...stillListed, at: t2.at, quantity: 1, trade: "s|2", unmarked: { listing: null, count: 1, at: t2.at + 5_000 } };
  const sales = [second, stillListed];
  assert.deepEqual(soldAfterUnmarked(serration, sales, [trade, t2], now), { count: 3, partner: "Buyer2" });
  const after = markedForTrade(sales, serration, "o1", 3, now);
  assert.deepEqual(after.map((s) => [s.trade, s.lowered?.count, s.unmarked]), [["s|2", 1, undefined], ["s|1", 2, undefined]]);
  assert.equal(revenue(after, [trade, t2]), 60);
  // Only 2 went through: the newest trade's copy first, then one of the older's.
  const part = markedForTrade(sales, serration, "o1", 2, now);
  assert.deepEqual(part.map((s) => [s.lowered?.count, s.unmarked?.count]), [[1, undefined], [1, 1]]);
});

test("saved sales: the new field loads; an older record loads as before; a damaged value drops the field and keeps the sale", () => {
  assert.deepEqual(salesOf([stillListed]), [stillListed]);
  const none = { ...stillListed, unmarked: { listing: null, count: 1, at } };
  assert.deepEqual(salesOf([none]), [none]);
  const { unmarked: _, ...old } = stillListed;
  assert.deepEqual(salesOf([old]), [old]);
  for (const bad of [{ listing: 5, count: 1, at }, { listing: "o1", count: 0, at }, { listing: "o1", count: 1.5, at }, { listing: "o1", count: 1, at: "x" }, "o1", null, [1]]) assert.deepEqual(salesOf([{ ...stillListed, unmarked: bad }]), [old], JSON.stringify(bad));
});

test("Sales page: a sale typed in ten minutes after a trade logged that item and rank would count twice with marking on, and is named first", () => {
  const typed = clicked(2, at + 4 * 60_000);
  // The proof: Stats counts it twice with marking on, once with marking off.
  assert.equal(revenue([typed, stillListed], [trade]), 80);
  assert.equal(revenue([typed], [trade]), 40);
  // So the page names the trade before it adds the sale.
  assert.deepEqual(tradeSaleNear([stillListed], [trade], serration, typed.at), { count: 2, partner: "Buyer1" });
  // A trade that marked its listing sold is the same: the trade's sale names the trade.
  const { unmarked: _, ...marked } = stillListed;
  assert.deepEqual(tradeSaleNear([marked], [trade], serration, typed.at), { count: 2, partner: "Buyer1" });
  // Not for another rank, a sale logged by hand, a trade ten minutes or more before, or one after.
  assert.equal(tradeSaleNear([stillListed], [trade], { name: "Serration", rank: 0 }, typed.at), null);
  assert.equal(tradeSaleNear([{ ...marked, trade: undefined }], [trade], serration, typed.at), null);
  assert.equal(tradeSaleNear([stillListed], [trade], serration, at + 10 * 60_000), null);
  assert.equal(tradeSaleNear([stillListed], [trade], serration, at - 60_000), null);
});

test("the Guide's Sales entry and docs/features.md say what happens to a sale logged by hand after its trade", () => {
  const guide = readFileSync(new URL("../src/lib/tabs/Guide.svelte", import.meta.url), "utf8");
  const features = readFileSync(new URL("../docs/features.md", import.meta.url), "utf8");
  const sales = guide.split("\n").find((l) => l.includes('["sales", "Sales", "a sale in game'))!;
  assert.match(sales, /once the trade has been read is not matched to it/);
  assert.match(sales, /Sold on Orders asks first whether it's that sale/);
  assert.match(sales, /added only on a second press/);
  assert.match(features, /once its trade has been read isn't matched to it/);
  assert.match(features, /\*Yes, that sale\* marks those copies sold with the same call and logs nothing more/);
});
