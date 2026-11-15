// A deals scan that couldn't read an item's order book this time finds no deal for it: the copy
// read hours before is not a seller there now. market.items and market.book are stubbed; nothing
// here reaches warframe.market.
import "./support/runes";
import { test } from "node:test";
import assert from "node:assert/strict";
import { market } from "../src/lib/backend";
import type { Model } from "../src/lib/core/model";

const { mkt } = await import("../src/lib/marketStore.svelte");

test("a deals scan whose book request fails does not announce a deal from a book read hours ago", async () => {
  const me = { id: "me", ingameName: "Me", platform: "pc", crossplay: true } as never;
  mkt.account = { linked: true, backing: "keyring", profile: me, error: null };
  market.items = async () => [{ id: "i1", slug: "thing_prime_barrel", gameRef: "/g1", name: "Thing Prime Barrel", maxRank: null, subtypes: null, tags: [] }];
  mkt.items = [];
  const old = [{ id: "o1", type: "sell", platinum: 10, quantity: 1, rank: null, subtype: null, visible: true, user: { id: "u1", ingameName: "ExampleSeller", status: "ingame", platform: "pc", crossplay: true, reputation: 0 } }];
  mkt.books = { thing_prime_barrel: { at: Date.now() - 5 * 3_600_000, orders: old as never } };
  market.book = async () => {
    throw new Error("Couldn't reach warframe.market (timed out)");
  };
  const model = { price: () => 50, priceMax: () => null, relicPrice: () => null } as unknown as Model;
  await mkt.scanDeals(model, [{ name: "Thing Prime Barrel", kind: "part", rank: null, why: "the last part of Thing Prime" }]);
  assert.deepEqual(mkt.deals.map((d) => `${d.name} ${d.price}p from ${d.seller}`), [], "no deal from a five-hour-old book");
  assert.equal(mkt.dealsChecked, 0, "no book was read this scan");
  assert.deepEqual(mkt.dealsUnread, ["thing_prime_barrel"], "and it counts as not read");
});
