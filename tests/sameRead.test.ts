// A read that holds what the one held holds keeps the model built from it (core/sameRead.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readKey, sameRead } from "../src/lib/core/sameRead";
import type { Bundle } from "../src/lib/core/types";

const catalog = [{ uniqueName: "/M/Serration", name: "Serration", category: "Mods" }] as unknown as Bundle["catalog"];
const relics = [] as Bundle["relics"];
const read = (over: Partial<Bundle> = {}): Bundle =>
  ({
    observed_at: 1_700_000_000,
    inventory: [{ item_id: "/M/Serration", name: "Serration", category: "mod", quantity: 4, mastered: false, image_name: null, rank: 0, max_rank: 10 }],
    catalog,
    relics,
    prices: { prices: { Serration: 3 }, max_rank_prices: {} },
    ...over,
  }) as unknown as Bundle;

test("the same read, a new object: kept", () => {
  const held = read();
  const next = read();
  assert.notEqual(next, held);
  assert.equal(sameRead(held, readKey(held), next, readKey(next)), true);
});

test("anything new in it: not kept", () => {
  const held = read();
  const key = readKey(held);
  const differs = (next: Bundle, why: string) => assert.equal(sameRead(held, key, next, readKey(next)), false, why);
  differs(read({ observed_at: 1_700_000_060 }), "a newer read of the same inventory");
  differs(read({ inventory: [{ ...held.inventory[0], quantity: 5 }] }), "a count changed");
  differs(read({ prices: { prices: { Serration: 4 }, max_rank_prices: {} } } as unknown as Partial<Bundle>), "a price changed");
  differs(read({ catalog: [...catalog] }), "new catalogs (another revision), the same inventory");
  differs(read({ relics: [] }), "a new relic list");
});

test("nothing held yet: not kept", () => {
  const next = read();
  assert.equal(sameRead(null, null, next, readKey(next)), false);
  assert.equal(sameRead(read(), null, next, readKey(next)), false);
});
