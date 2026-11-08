// The demo account at about ten times its size, with warframe.market's 100 listings up: the
// collection and the Sell spares plan stay correct (never past the cap, never two listings of one
// thing), and the time each takes is printed (not asserted: CI machines vary).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { scaleDemo } from "../scripts/demo-scale.mjs";
import { buildModel } from "../src/lib/core/model";
import { bulkPlan, LISTING_LIMIT, sellTargets, toApply } from "../src/lib/core/bulk";
import { indexItems } from "../src/lib/core/market";
import { defaultAdvice, defaultMarketSettings } from "../src/lib/backend";

const read = (f: string) => JSON.parse(readFileSync(new URL(`../demo/${f}`, import.meta.url), "utf8"));

test("ten times the demo, 100 listings: the plan stays under the cap and lists nothing twice", () => {
  const files = scaleDemo(read);
  const timed = <T,>(label: string, f: () => T): T => {
    const a = performance.now();
    const r = f();
    console.log(`# ${label}: ${(performance.now() - a).toFixed(0)} ms`);
    return r;
  };
  const m = timed("collection", () => buildModel(files["dev-bundle.json"], undefined, null, null, [], read("dev-recipe-data.json")));
  assert.ok(files["dev-bundle.json"].inventory.length > 6000 && m.inventoryByBase.size > 2000);
  const index = indexItems(read("dev-market-items.json"));
  const s = defaultMarketSettings();
  const advice = defaultAdvice();
  const orders = files["dev-market.json"].orders;
  assert.equal(orders.length, LISTING_LIMIT);
  const targets = timed("what can be sold", () => sellTargets(m, s.spares, advice, index, s.sellable));
  for (const other of [0, 7]) {
    const plan = timed(`the plan (${other} buy orders)`, () =>
      bulkPlan({ model: m, index, orders, me: { id: "me", ingameName: "ExamplePlayer", platform: "pc", crossplay: true }, books: files["dev-books.json"], minPrice: s.minPrice, minByCategory: s.minByCategory, minShare: s.minShare, floors: {}, paused: {}, otherOrders: other, sell: s.sellable, advice }, s.spares, targets),
    );
    const go = toApply(plan, new Set(), new Set());
    const creates = go.filter((a) => a.type === "create");
    const removes = go.filter((a) => a.type === "remove").length;
    assert.ok(orders.length - removes + creates.length + other <= LISTING_LIMIT, `${orders.length} - ${removes} + ${creates.length} + ${other} buy orders`);
    const keys = creates.map((a) => (a.type === "create" ? `${a.item.id}|${a.rank}|${a.subtype}` : ""));
    assert.equal(new Set(keys).size, keys.length, "one thing listed twice");
  }
});
