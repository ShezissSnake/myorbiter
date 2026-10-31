import { test } from "node:test";
import assert from "node:assert/strict";
import { imprintBreed, imprintCounts } from "../src/lib/core/imprints";
import { buildModel } from "../src/lib/core/model";
import { inventoryRows } from "../src/lib/core/views";
import { holdings } from "../src/lib/core/market";
import { spareRows } from "../src/lib/core/spares";
import type { Bundle } from "../src/lib/core/types";

const SUNIKA = "/Lotus/Types/Game/KubrowPet/HunterKubrowPetPowerSuit";
const RAKSA = "/Lotus/Types/Game/KubrowPet/GuardKubrowPetPowerSuit";
const known = (p: string) => p === SUNIKA || p === RAKSA;

test("imprints: the breed comes from the dominant traits before the recessive ones", () => {
  const raw = { ItemType: "/Lotus/Types/Game/KubrowPet/ImprintedTraitPrint", RecessiveTraits: { Personality: RAKSA }, DominantTraits: { Personality: SUNIKA } };
  assert.equal(imprintBreed(raw, known), SUNIKA);
  assert.equal(imprintBreed({ DominantTraits: { BodyType: "/x/Body", Extra: [{ Type: RAKSA }] } }, known), RAKSA, "wherever the row keeps it");
  assert.equal(imprintBreed({ DominantTraits: { Personality: "/Lotus/Types/Game/KubrowPet/NewKubrowPetPowerSuit" } }, known), null, "a breed it doesn't know stays unread");
  const counts = imprintCounts([{ DominantTraits: { Personality: SUNIKA } }, { DominantTraits: { Personality: SUNIKA } }, { Name: "?" }], known);
  assert.equal(counts.get(SUNIKA), 2);
  assert.equal(counts.get(""), 1);
});

const bundle: Bundle = {
  observed_at: 1_700_000_000,
  // Your own Sunika is a companion, not an imprint.
  inventory: [{ item_id: SUNIKA, name: "Sunika Kubrow", category: "companion", quantity: 1, mastered: true, image_name: null, rank: null, max_rank: null }],
  catalog: [{ uniqueName: SUNIKA, name: "Sunika Kubrow", category: "Pets", masterable: true }, { uniqueName: RAKSA, name: "Raksa Kubrow", category: "Pets", masterable: true }],
  relics: [],
  prices: { prices: { "Raksa Kubrow Imprint": 12 }, max_rank_prices: {} },
};
const raksa = { name: "Raksa Kubrow Imprint", slug: "raksa_kubrow_imprint", gameRef: RAKSA, tags: ["kubrow", "pet", "imprint"] } as never;
const sunika = { name: "Sunika Kubrow Imprint", slug: "sunika_kubrow_imprint", gameRef: SUNIKA, tags: ["kubrow", "pet", "imprint"] } as never;

test("imprints: listed for sale by breed, counted apart from your companions", () => {
  const m = buildModel(bundle, undefined, null, null, [{ DominantTraits: { Personality: RAKSA } }, { DominantTraits: { Personality: RAKSA } }]);
  const row = inventoryRows(m).find((r) => r.kind === "imprint")!;
  assert.equal(row.name, "Raksa Kubrow Imprint");
  assert.equal(row.quantity, 2);
  assert.equal(row.price, 12);
  assert.equal(row.marketName, "Raksa Kubrow Imprint");
  assert.deepEqual(holdings(m, raksa), [{ rank: null, subtype: null, count: 2 }]);
  assert.deepEqual(holdings(m, sunika), [], "owning a Sunika isn't holding its imprint");
  const spare = spareRows(m).find((r) => r.name === "Raksa Kubrow Imprint")!;
  assert.equal(spare.spare, 2);
  assert.equal(spare.type, "Imprint");
  // Before TennoScope has passed any imprints, what you hold is unknown, so no listing is touched.
  assert.equal(holdings(buildModel(bundle), raksa), null);
});
