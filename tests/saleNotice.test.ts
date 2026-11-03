import { test } from "node:test";
import assert from "node:assert/strict";
import { isSale, recentTrade, repOffered, saleNotice, salesToTell, TELL_WINDOW } from "../src/lib/core/saleNotice";
import { tradeKey } from "../src/lib/core/trades";
import { keepSeen } from "../src/lib/core/upkeep";
import type { Trade } from "../src/lib/core/types";

const NOW = 1_792_700_000_000;
const trade = (t: Partial<Trade>): Trade => ({ uptime: 3127.384, at: NOW / 1000 - 60, partner: "Bob", offered: [], received: [], platinum_offered: 0, platinum_received: 0, ...t });
const gauss = { name: "Gauss Prime Neuroptics Blueprint", rank: null, count: 1 };

test("one item: the title says what, to whom and for how much", () => {
  const n = saleNotice(trade({ offered: [gauss], platinum_received: 14 }));
  assert.equal(n.title, "You sold Gauss Prime Neuroptics Blueprint to Bob for 14 platinum");
  assert.equal(n.body, "", "nothing more to say when orbiter didn't mark it");
  const three = saleNotice(trade({ offered: [{ ...gauss, count: 3 }], platinum_received: 42 }));
  assert.equal(three.title, "You sold 3 × Gauss Prime Neuroptics Blueprint to Bob for 42 platinum");
  const ranked = saleNotice(trade({ offered: [{ name: "Arcane Energize", rank: 5, count: 1 }], platinum_received: 60 }));
  assert.equal(ranked.title, "You sold Arcane Energize (rank 5) to Bob for 60 platinum");
});

test("several kinds: the count and total in the title, one line each", () => {
  const t = trade({ offered: [{ ...gauss, count: 2 }, { name: "Vicious Bond", rank: 0, count: 1 }], platinum_received: 40 });
  const n = saleNotice(t);
  assert.equal(n.title, "You sold 3 items to Bob for 40 platinum");
  assert.equal(n.body, "2 × Gauss Prime Neuroptics Blueprint\nVicious Bond");
});

test("what became of the listings: one line when alike, beside each item when not", () => {
  const t = trade({ offered: [gauss], platinum_received: 14 });
  assert.equal(saleNotice(t, [{ ...gauss, outcome: "marked" }]).body, "Marked sold on warframe.market and logged.");
  assert.match(saleNotice(t, [{ ...gauss, outcome: "still listed" }]).body, /still listed on warframe\.market: it couldn't/);
  assert.equal(saleNotice(t, [{ ...gauss, outcome: "not listed" }]).body, "Logged; it wasn't listed on warframe.market.");
  // The lines orbiter logged (a whole set folded into one) stand for the trade's own items.
  const set = trade({ offered: [gauss, { name: "Gauss Prime Chassis Blueprint", rank: null, count: 1 }], platinum_received: 90 });
  assert.equal(saleNotice(set, [{ name: "Gauss Prime Set", rank: null, count: 1, outcome: "marked" }]).title, "You sold Gauss Prime Set to Bob for 90 platinum");
  const mixed = saleNotice(set, [
    { ...gauss, outcome: "marked" },
    { name: "Gauss Prime Chassis Blueprint", rank: null, count: 1, outcome: "not listed" },
  ]);
  assert.equal(mixed.title, "You sold 2 items to Bob for 90 platinum");
  assert.equal(mixed.body, "Gauss Prime Neuroptics Blueprint (marked sold)\nGauss Prime Chassis Blueprint (not listed)");
  assert.match(saleNotice(set, [{ ...gauss, outcome: "not listed" }, { name: "X", rank: null, count: 1, outcome: "not listed" }]).body, /they weren't listed/);
});

test("only sales: no platinum (a gift or a swap) and buying aren't", () => {
  assert.ok(isSale(trade({ offered: [gauss], platinum_received: 14 })));
  assert.ok(!isSale(trade({ offered: [gauss] })), "a gift");
  assert.ok(!isSale(trade({ offered: [gauss], received: [{ name: "Forma Blueprint", rank: null, count: 1 }] })), "a swap");
  assert.ok(!isSale(trade({ received: [gauss], platinum_offered: 14 })), "a buy");
  assert.ok(!isSale(trade({ platinum_received: 14 })), "platinum for nothing");
  assert.ok(!isSale(trade({ offered: [gauss], received: [gauss], platinum_received: 5 })), "items both ways");
});

test("each trade is looked at once, and only recent sales are told", () => {
  const key = (t: Trade) => tradeKey(100, t);
  const sale = trade({ uptime: 1, offered: [gauss], platinum_received: 14 });
  const buy = trade({ uptime: 2, received: [gauss], platinum_offered: 14 });
  const old = trade({ uptime: 3, offered: [gauss], platinum_received: 14, at: (NOW - TELL_WINDOW - 1000) / 1000 });
  const first = salesToTell([sale, buy, old], key, [], NOW, false);
  assert.deepEqual(first.tell, [sale]);
  assert.deepEqual(first.fresh, ["100|1", "100|2", "100|3"], "every trade is remembered, told or not");
  // The next read of the same log: nothing again, also after a restart (the keys are kept in settings).
  const seen = keepSeen(first.fresh, [], 300, "100");
  assert.deepEqual(salesToTell([sale, buy, old], key, seen, NOW + 5000, true), { tell: [], fresh: [] });
  // A new sale in the same log: just that one.
  const next = trade({ uptime: 4, offered: [gauss], platinum_received: 15, partner: "Ann" });
  assert.deepEqual(salesToTell([sale, buy, old, next], key, seen, NOW, false).tell, [next]);
});

test("a trade with no time is told only after the first read of its session", () => {
  const t = trade({ at: null, offered: [gauss], platinum_received: 14 });
  assert.equal(recentTrade(t, NOW, true), false, "the first read can be hours late");
  assert.equal(recentTrade(t, NOW, false), true);
  assert.equal(recentTrade(trade({ at: NOW / 1000 - 29 * 60 }), NOW, true), true);
  assert.equal(recentTrade(trade({ at: NOW / 1000 - 31 * 60 }), NOW, false), false);
});

test("+rep is offered when you give it by hand, signed in, to a buyer on warframe.market not yet given it", () => {
  const base = { key: "100|1", partner: "Bob", at: NOW - 60_000, now: NOW, autoRep: false, linked: true, onMarket: true, rep: {}, trades: [{ key: "100|1", partner: "Bob" }] };
  assert.ok(repOffered(base));
  assert.ok(!repOffered({ ...base, autoRep: true }), "automatic +rep gives it itself");
  assert.ok(!repOffered({ ...base, linked: false }), "signed out");
  assert.ok(!repOffered({ ...base, onMarket: false }), "not on warframe.market");
  assert.ok(!repOffered({ ...base, rep: { "100|1": "given" } }), "given");
  assert.ok(!repOffered({ ...base, rep: { "100|1": "skipped" } }), "Not now");
  // One +rep per player: given on an earlier trade, whatever the case of the name.
  assert.ok(!repOffered({ ...base, rep: { "99|7": "given" }, trades: [...base.trades, { key: "99|7", partner: "bob" }] }));
  assert.ok(repOffered({ ...base, rep: { "99|7": "skipped" }, trades: [...base.trades, { key: "99|7", partner: "Bob" }] }), "Not now on another trade doesn't count");
  assert.ok(!repOffered({ ...base, at: NOW - 25 * 3_600_000 }), "a day later it's gone from the notification");
});
