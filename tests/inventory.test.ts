import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel } from "../src/lib/core/model";
import { inventoryRows, spareOf, unknownRelics } from "../src/lib/core/views";
import { referencePrice } from "../src/lib/core/market";
import type { Bundle, InventoryRow } from "../src/lib/core/types";

const inv = (item_id: string, name: string, category: string, quantity: number, extra: Partial<InventoryRow> = {}): InventoryRow => ({
  item_id, name, category, quantity, mastered: false, image_name: null, rank: null, max_rank: null, ...extra,
});
const RHINO = "/Lotus/Powersuits/Rhino/RhinoPrime";
const bundle = (inventory: InventoryRow[]): Bundle => ({
  observed_at: 1_700_000_000,
  inventory,
  catalog: [
    { uniqueName: RHINO, name: "Rhino Prime", category: "Warframes", masterable: true, isPrime: true, components: [{ uniqueName: "/R/Systems", name: "Systems", ducats: 45, itemCount: 1 }] },
    { uniqueName: "/M/Serration", name: "Serration", category: "Mods", maxRank: 10, tradable: true },
  ],
  relics: [{ uniqueName: "/Relic/A1Bronze", name: "Axi A1 Intact", vaulted: true, rewards: [{ name: "Rhino Prime Systems Blueprint", rarity: "Rare", chance: 2 }] }],
  prices: { prices: { "Serration": 3, "Rhino Prime Systems Blueprint": 30, "Axi A1 Relic": 5 }, max_rank_prices: { "Serration": 40 } },
});

test("inventory: one row per item, mods split by rank, priced at their rank", () => {
  const rows = inventoryRows(buildModel(bundle([
    inv("/M/Serration", "Serration", "mod", 3),
    inv("/M/Serration", "Serration", "mod", 1, { rank: 10 }),
    inv("/M/Serration", "Serration", "mod", 2),
    inv(RHINO, "Rhino Prime", "frame", 1, { mastered: true }),
    inv("/Relic/A1Bronze", "Axi A1 Intact", "relic", 4),
    inv("/R/Systems", "Rhino Prime Systems Blueprint", "prime_part", 2),
    inv("/Res/Ferrite", "Ferrite", "resource", 0),
  ])));
  const by = (k: string) => rows.filter((r) => r.key.startsWith(k));
  const [r0, r10] = by("mod:Serration").sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
  assert.equal(r0.quantity, 5);
  assert.equal(r0.price, 3);
  assert.equal(r10.price, 40, "a maxed mod is priced as maxed");
  assert.equal(by("gear:Rhino Prime")[0].mastered, true);
  assert.equal(by("gear:Rhino Prime")[0].marketName, null, "a built frame doesn't trade");
  const relic = by("relic:")[0];
  assert.equal(relic.marketName, "Axi A1 Relic");
  assert.equal(relic.subtype, "intact");
  assert.equal(relic.worth, 20);
  const part = by("part:")[0];
  assert.equal(part.ducats, 45);
  assert.equal(part.worth, 60);
  assert.equal(rows.some((r) => r.name === "Ferrite"), false, "nothing you hold none of");
});

test("inventory: a part TennoScope names differently takes the market's name", () => {
  const rows = inventoryRows(buildModel(bundle([inv("/R/Systems", "Rhino Prime Systems", "prime_part", 1)])));
  const part = rows.find((r) => r.kind === "part")!;
  assert.equal(part.name, "Rhino Prime Systems Blueprint");
  assert.equal(part.marketName, "Rhino Prime Systems Blueprint");
  assert.equal(part.price, 30);
});

test("inventory: the inventory's max rank wins over the catalog's", () => {
  const rows = inventoryRows(buildModel(bundle([inv("/M/Serration", "Serration", "mod", 1, { rank: 5, max_rank: 5 })])));
  assert.equal(rows[0].maxRank, 5);
  assert.equal(rows[0].price, 40, "rank 5 of 5 is maxed, so it's priced as maxed");
});

test("relics TennoScope's relic data doesn't list are counted, not dropped", () => {
  const m = buildModel(bundle([
    inv("/Relic/A1Bronze", "Axi A1 Intact", "relic", 4),
    inv("/Relic/C9Platinum", "Axi C9 Radiant", "relic", 2),
    inv("/Relic/C9Bronze", "Axi C9 Intact", "relic", 1),
  ]));
  assert.deepEqual(unknownRelics(m), [{ base: "Axi C9", era: "Axi", owned: { Radiant: 2, Intact: 1 }, total: 3 }]);
});

test("spareOf: what each kind of thing can spare, and a set is complete sets", () => {
  const m = buildModel(bundle([
    inv("/M/Serration", "Serration", "mod", 3),
    inv("/M/Serration", "Serration", "mod", 1, { rank: 10 }),
    inv(RHINO, "Rhino Prime", "frame", 1, { mastered: true }),
    inv("/R/Systems", "Rhino Prime Systems Blueprint", "prime_part", 2),
  ]));
  assert.deepEqual(spareOf(m, "Serration", ["mod"]), { rank: 0, quantity: 2 }, "the maxed one and an unranked one to give away are kept, the other unranked go");
  assert.deepEqual(spareOf(m, "Rhino Prime Systems Blueprint", ["prime", "component"]), { rank: null, quantity: 2 }, "mastered: every copy");
  assert.equal(spareOf(m, "Something Else", null), null);
});

test("referencePrice: a relic is priced by its refinement", () => {
  const m = buildModel({ ...bundle([]), prices: { prices: { "Axi A1 Relic": 5, "Axi A1 Relic (Radiant)": 12 }, max_rank_prices: {} } });
  const item = { id: "x", slug: "axi_a1_relic", gameRef: "/Relic/A1", name: "Axi A1 Relic", maxRank: null, subtypes: ["intact", "radiant"], tags: ["relic"] };
  assert.equal(referencePrice(m, item, null, "intact"), 5);
  assert.equal(referencePrice(m, item, null, "radiant"), 12);
  assert.equal(referencePrice(m, item, null), 5);
});
