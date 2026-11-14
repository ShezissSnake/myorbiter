// A sale a trade logged without marking its listing sold ("still listed", or no sure listing):
// a Sold click on that listing soon after asks whether it is that sale, and "that sale" marks the
// copies the trade could not, logging nothing more. The Sales page says so before a sale typed
// there is added a second time.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { salesCoveredByTrades } from "../src/lib/core/market";
import { claimTradeSale, markedForTrade, secondPress, SECOND_PRESS_MS, soldAfterTrade, soldAfterUnmarked, soldAnswers, tradeLineSale, tradeSaleNear, type SoldListing } from "../src/lib/core/soldMarks";
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
const o1: SoldListing = { id: "o1", name: "Serration", rank: 10, subtype: null };
const o2: SoldListing = { ...o1, id: "o2" };
/** The same sale with no sure listing ("not listed" on the notification, a listing of it up all the same). */
const noListing: Sale = { ...stillListed, unmarked: { listing: null, count: 2, at: at + 5_000 } };
/** What a Sold click on Orders logs when it goes the usual way (sendSale). */
const clicked = (quantity: number, t = at + 60_000): Sale => ({ at: t, item: "Serration", rank: 10, quantity, platinum: 20 });
const now = at + 60_000;

test("before: a Sold click after 'still listed' logs the sale again, and Stats counts it twice with marking on", () => {
  // Marking on: the trade's sale names the trade, so the hand-logged one pairs with nothing.
  assert.equal(revenue([clicked(2), stillListed], [trade]), 80);
  // Marking off: no sale from the trade; Stats pairs the click with the trade itself.
  assert.equal(revenue([clicked(2)], [trade]), 40);
  // The question the last change added is not asked: no trade lowered that listing.
  assert.equal(soldAfterTrade("o1", [stillListed], [trade], now), null);
});

test("the trade's line logs its sale with what the marking did: lowered, and the copies not marked", () => {
  const line = { at, name: "Serration", rank: 10, subtype: null, left: 2, platinumEach: 20, key: "s|1", now: at + 5_000 };
  // warframe.market refused the listing's mark: the listing it tried.
  assert.deepEqual(tradeLineSale({ ...line, order: { id: "o1" }, marked: 0 }), stillListed);
  // No sure listing: none named.
  assert.deepEqual(tradeLineSale({ ...line, order: null, marked: 0 }), noListing);
  // Marked whole: lowered, nothing unmarked.
  assert.deepEqual(tradeLineSale({ ...line, order: { id: "o1" }, marked: 2 }), { at, item: "Serration", rank: 10, quantity: 2, platinum: 20, trade: "s|1", lowered: { listing: "o1", count: 2, at: at + 5_000 } });
  // The listing held 1: it is closed, so the copy left names no listing; a refinement the line names is kept.
  const relic = tradeLineSale({ ...line, name: "Axi A1 Relic", rank: null, subtype: "radiant", order: { id: "r1" }, marked: 1 });
  assert.deepEqual([relic.lowered, relic.unmarked], [{ listing: "r1", count: 1, at: at + 5_000 }, { listing: null, count: 1, at: at + 5_000, subtype: "radiant" }]);
});

test("a Sold click soon after asks on the listing the trade tried, with the trade's copies and partner", () => {
  assert.deepEqual(soldAfterUnmarked(o1, [stillListed], [trade], now), { count: 2, partner: "Buyer1", trades: 1, guess: false, busy: false });
  // Another listing of the same item and rank did not sell: no question.
  assert.equal(soldAfterUnmarked(o2, [stillListed], [trade], now), null);
  // Another rank, another item, a sale logged by hand, or ten minutes on: no question.
  assert.equal(soldAfterUnmarked({ ...o1, rank: 0 }, [noListing], [trade], now), null);
  assert.equal(soldAfterUnmarked({ ...o1, name: "Arcane Energize" }, [noListing], [trade], now), null);
  assert.equal(soldAfterUnmarked(o1, [{ ...stillListed, trade: undefined }], [trade], now), null);
  assert.equal(soldAfterUnmarked(o1, [stillListed], [trade], at + 5_000 + 10 * 60_000), null);
  // A sale the trade logged and marked sold: this question is not asked (soldAfterTrade's is).
  const { unmarked: _, ...marked } = stillListed;
  assert.equal(soldAfterUnmarked(o1, [{ ...marked, lowered: { listing: "o1", count: 2, at: at + 5_000 } }], [trade], now), null);
  // An older record, without the field: as before, no question.
  assert.equal(soldAfterUnmarked(o1, [marked], [trade], now), null);
  // No sure listing, and the line names no refinement: any listing of it, and the question says which it lowers.
  assert.deepEqual(soldAfterUnmarked(o2, [noListing], [trade], now), { count: 2, partner: "Buyer1", trades: 1, guess: true, busy: false });
  // A name the log and the market spell differently ("… Blueprint") is the same item.
  const bp: Sale = { ...noListing, item: "Nekros Prime Blueprint", rank: null };
  assert.ok(soldAfterUnmarked({ id: "b1", name: "Nekros Prime Blueprint", rank: null, subtype: null }, [bp], [trade], now));
});

test("a refusal on one refinement's listing does not ask, or lower, on the other refinement's", () => {
  const relicTrade: TradeLogEntry = { ...trade, offered: [{ name: "Axi A1 Relic [Radiant]", rank: null, count: 1 }] };
  const radiant: SoldListing = { id: "rad", name: "Axi A1 Relic", rank: null, subtype: "radiant" };
  const intact: SoldListing = { id: "int", name: "Axi A1 Relic", rank: null, subtype: "intact" };
  const plain: SoldListing = { ...intact, id: "plain", subtype: null };
  // Refused on the Intact listing: only that listing asks.
  const refused: Sale = { at, item: "Axi A1 Relic", rank: null, quantity: 1, platinum: 9, trade: "s|1", unmarked: { listing: "int", count: 1, at } };
  assert.ok(soldAfterUnmarked(intact, [refused], [relicTrade], now));
  assert.equal(soldAfterUnmarked(radiant, [refused], [relicTrade], now), null);
  assert.deepEqual(markedForTrade([refused], radiant, 1, now), [refused], "'that sale' on Radiant records nothing");
  // No sure listing, the line named Radiant: the Radiant listing asks, the Intact ones (with or without a subtype) don't.
  const named: Sale = { ...refused, unmarked: { listing: null, count: 1, at, subtype: "radiant" } };
  assert.deepEqual(soldAfterUnmarked(radiant, [named], [relicTrade], now)?.guess, false);
  assert.equal(soldAfterUnmarked(intact, [named], [relicTrade], now), null);
  assert.equal(soldAfterUnmarked(plain, [named], [relicTrade], now), null);
  // Named intact: a listing with no subtype is intact.
  assert.ok(soldAfterUnmarked(plain, [{ ...named, unmarked: { ...named.unmarked!, subtype: "intact" } }], [relicTrade], now));
});

test("two listings answered one after the other: one 'that sale' at a time for a trade's copies", () => {
  const out = new Set<string>();
  // No sure listing: both listings of it ask.
  assert.deepEqual(claimTradeSale(o1, [noListing], now, out), ["s|1"]);
  assert.equal(claimTradeSale(o2, [noListing], now, out), null, "the second answer sends nothing while the first is out");
  assert.equal(soldAfterUnmarked(o2, [noListing], [trade], now, out)?.busy, true);
  // The first is back and recorded: the copies are marked, nothing is left for the second.
  out.delete("s|1");
  const after = markedForTrade([noListing], o1, 2, now);
  assert.equal(claimTradeSale(o2, after, now, out), null);
  assert.equal(soldAfterUnmarked(o2, after, [trade], now), null);
  // Refused: the record unchanged and the claim given back, the next click may claim again.
  assert.deepEqual(claimTradeSale(o2, [noListing], now, out), ["s|1"]);
  // Nothing waiting: nothing to claim.
  assert.equal(claimTradeSale(o1, [], now, new Set()), null);
});

test("the answers: 'that sale' sends the trade's copies, 'another sale' the click's; the focus starts on the one that sends least", () => {
  assert.deepEqual(soldAnswers(1, 2), { that: 2, another: 1, focus: "another" });
  assert.deepEqual(soldAnswers(2, 2), { that: 2, another: 2, focus: "that" }, "the same copies: that sale logs nothing more");
  assert.deepEqual(soldAnswers(3, 2), { that: 2, another: 3, focus: "that" });
});

test("'that sale': the trade's sale records what was lowered and logs nothing; a further click asks the last change's question", () => {
  const others: Sale = { at, item: "Serration", rank: 10, quantity: 1, platinum: 20 };
  const after = markedForTrade([stillListed, others], o1, 2, now);
  assert.equal(after.length, 2, "no sale added");
  assert.deepEqual(after[0], { at, item: "Serration", rank: 10, quantity: 2, platinum: 20, trade: "s|1", lowered: { listing: "o1", count: 2, at: now } });
  assert.equal(after[1], others, "another sale is untouched");
  assert.equal(soldAfterUnmarked(o1, after, [trade], now), null, "no longer asked as unmarked");
  assert.deepEqual(soldAfterTrade("o1", after, [trade], now + 1_000), { count: 2, partner: "Buyer1" }, "asked as marked");
  // Marking on, 'that sale': Stats counts the trade once, as with marking off.
  const alone = markedForTrade([stillListed], o1, 2, now);
  assert.equal(revenue(alone, [trade]), 40);
  assert.equal(revenue(alone, [trade]), revenue([clicked(2)], [trade]));
  // 'Another sale' goes the usual way: a sale of its own, as the player says.
  assert.equal(revenue([clicked(1), stillListed], [trade]), 60);
});

test("'that sale' marked fewer copies than the trade could not (the listing had fewer): the rest stay unmarked", () => {
  const after = markedForTrade([stillListed], o1, 1, now);
  assert.deepEqual([after[0].lowered, after[0].unmarked], [{ listing: "o1", count: 1, at: now }, { listing: "o1", count: 1, at: at + 5_000 }]);
  assert.deepEqual(soldAfterUnmarked(o1, after, [trade], now)?.count, 1);
  // A second 'that sale' on the same listing adds to what the first lowered there.
  const again = markedForTrade(after, o1, 1, now + 1_000);
  assert.deepEqual([again[0].lowered, again[0].unmarked], [{ listing: "o1", count: 2, at: now + 1_000 }, undefined]);
  // A `lowered` on another listing (closed by the marking) is replaced, not added to.
  const closed: Sale = { ...noListing, lowered: { listing: "gone", count: 3, at } };
  assert.deepEqual(markedForTrade([closed], o1, 2, now)[0].lowered, { listing: "o1", count: 2, at: now });
});

test("two trades of the item in ten minutes, neither marked: counted together, the newest first, each recording its own copies", () => {
  const later = at + 3 * 60_000;
  const t2: TradeLogEntry = { ...trade, key: "s|2", at: at + 60_000, partner: "Buyer2", offered: [{ name: "Serration", rank: 10, count: 1 }], platIn: 20 };
  const second: Sale = { ...noListing, at: t2.at, quantity: 1, trade: "s|2", unmarked: { listing: null, count: 1, at: t2.at + 5_000 } };
  const sales = [second, noListing];
  assert.deepEqual(soldAfterUnmarked(o1, sales, [trade, t2], later), { count: 3, partner: "Buyer2", trades: 2, guess: true, busy: false });
  const after = markedForTrade(sales, o1, 3, later);
  assert.deepEqual(after.map((s) => [s.trade, s.lowered?.count, s.unmarked]), [["s|2", 1, undefined], ["s|1", 2, undefined]]);
  assert.equal(revenue(after, [trade, t2]), 60);
  // Only 1 went through: the newest trade's copy; the older is left as it was, with no `lowered` of 0.
  const part = markedForTrade(sales, o1, 1, later);
  assert.deepEqual(part.map((s) => [s.lowered?.count, s.unmarked?.count]), [[1, undefined], [undefined, 2]]);
  assert.equal(part[1], noListing);
  // Both trades are claimed by one answer.
  assert.deepEqual(claimTradeSale(o1, sales, later, new Set()), ["s|2", "s|1"]);
});

test("saved sales: the new field loads; an older record loads as before; a damaged value drops the field and keeps the sale", () => {
  assert.deepEqual(salesOf([stillListed]), [stillListed]);
  const none = { ...stillListed, unmarked: { listing: null, count: 1, at, subtype: "radiant" } };
  assert.deepEqual(salesOf([none]), [none]);
  const { unmarked: _, ...old } = stillListed;
  assert.deepEqual(salesOf([old]), [old]);
  for (const bad of [{ listing: 5, count: 1, at }, { listing: "o1", count: 0, at }, { listing: "o1", count: 1.5, at }, { listing: "o1", count: 1, at: "x" }, { listing: null, count: 1, at, subtype: 3 }, "o1", null, [1]]) assert.deepEqual(salesOf([{ ...stillListed, unmarked: bad }]), [old], JSON.stringify(bad));
});

test("Sales page: a sale typed in ten minutes after a trade logged that item and rank would count twice with marking on, and is named first", () => {
  const serration = { name: "Serration", rank: 10 };
  const typed = clicked(2, at + 4 * 60_000);
  // The proof: Stats counts it twice with marking on, once with marking off.
  assert.equal(revenue([typed, stillListed], [trade]), 80);
  assert.equal(revenue([typed], [trade]), 40);
  // So the page names the trade before it adds the sale.
  assert.deepEqual(tradeSaleNear([stillListed], [trade], serration, typed.at), { count: 2, partner: "Buyer1", trades: 1 });
  // A trade that marked its listing sold is the same: the trade's sale names the trade.
  const { unmarked: _, ...marked } = stillListed;
  assert.deepEqual(tradeSaleNear([marked, { ...marked, trade: "s|2", at: at + 60_000 }], [trade], serration, typed.at), { count: 4, partner: null, trades: 2 });
  // Not for another rank, a sale logged by hand, a trade ten minutes or more before, or one after.
  assert.equal(tradeSaleNear([stillListed], [trade], { name: "Serration", rank: 0 }, typed.at), null);
  assert.equal(tradeSaleNear([{ ...marked, trade: undefined }], [trade], serration, typed.at), null);
  assert.equal(tradeSaleNear([stillListed], [trade], serration, at + 10 * 60_000), null);
  assert.equal(tradeSaleNear([stillListed], [trade], serration, at - 60_000), null);
});

test("Sales page: the second press is a separate press of Add with the same fields; a double press is one", () => {
  const asked = { key: "Serration|10|2|20", at: now };
  assert.equal(secondPress(asked, asked.key, now + SECOND_PRESS_MS), true);
  assert.equal(secondPress(asked, asked.key, now + 200), false, "a double-click");
  assert.equal(secondPress(asked, "Serration|10|3|20", now + 5_000), false, "the fields changed: asked again");
  assert.equal(secondPress(null, asked.key, now), false);
});

test("the Guide's Sales entry and docs/features.md say what happens to a sale logged by hand after its trade", () => {
  const guide = readFileSync(new URL("../src/lib/tabs/Guide.svelte", import.meta.url), "utf8");
  const features = readFileSync(new URL("../docs/features.md", import.meta.url), "utf8");
  const sales = guide.split("\n").find((l) => l.includes('["sales", "Sales", "a sale in game'))!;
  const orders = guide.split("\n").find((l) => l.includes("Sold marks one sold (Sold several"))!;
  assert.match(sales, /once the trade has been read is not matched to it/);
  assert.match(sales, /Sold on Orders asks first whether it's that sale, on that listing/);
  assert.match(sales, /added only on a second, separate press of Add/);
  assert.match(orders, /the question says which listing it would lower/);
  assert.match(features, /once its trade has been read isn't matched to it/);
  assert.match(features, /\*Yes, that sale\* marks those copies sold with the same call and logs nothing more/);
  // A space after every full stop in the new sentences: no "twice.With".
  const added = features.slice(features.indexOf("A sale logged by hand once its trade"), features.indexOf("Turn it off in Settings → Trades.", features.indexOf("A sale logged by hand once its trade")) + 1);
  assert.ok(added.length > 100);
  for (const [name, text] of [["Guide, Sales", sales], ["Guide, Orders", orders], ["docs/features.md, Sales", added]] as const) assert.doesNotMatch(text, /[a-z)]\.[A-Z]/, name);
});
