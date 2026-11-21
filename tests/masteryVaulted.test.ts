// Mastery's default list: what the player has, can build, or can farm. A prime is farmable when
// every missing part comes from a relic still in the drop tables, from Varzia, or from a relic the
// player holds. A vaulted prime with a missing part none of those give can only be traded for: it
// is held back behind the Vaulted checkbox (tradeOnly), apart from what can't be got at all.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildModel } from "../src/lib/core/model";
import { masteryRows, partRows, setRows } from "../src/lib/core/views";
import type { Bundle, CatalogItem, InventoryRow, Live, RelicEntry } from "../src/lib/core/types";

const inv = (item_id: string, name: string, category: string, quantity: number, extra: Partial<InventoryRow> = {}): InventoryRow => ({
  item_id, name, category, quantity, mastered: false, image_name: null, rank: null, max_rank: null, ...extra,
});

// Example Prime: Blueprint, two Blades, a Handle. Each part drops from its own relic.
const EX = "/W/ExamplePrime";
const comp = (part: string, n = 1) => ({ uniqueName: `/W/ExamplePrime${part}`, name: part, itemCount: n, ducats: 45 });
const example = { uniqueName: EX, name: "Example Prime", category: "Melee", masterable: true, isPrime: true, vaulted: true, components: [comp("Blueprint"), comp("Blade", 2), comp("Handle")] } as CatalogItem;
const relic = (code: string, part: string, vaulted: boolean): RelicEntry => ({ uniqueName: `/R/${code.replace(" ", "")}`, name: `${code} Intact`, vaulted, rewards: [{ name: `Example Prime ${part}`, rarity: "Common", chance: 25.33 }] } as RelicEntry);
type Vault = { Blueprint: boolean; Blade: boolean; Handle: boolean };
const relics = (v: Vault) => [relic("Axi E1", "Blueprint", v.Blueprint), relic("Axi E2", "Blade", v.Blade), relic("Axi E3", "Handle", v.Handle)];
const ALL_VAULTED: Vault = { Blueprint: true, Blade: true, Handle: true };
const part = (p: string, n = 1) => inv(`/W/ExamplePrime${p}`, p === "Blueprint" ? "Example Prime Blueprint" : `Example Prime ${p}`, "prime_part", n);
const heldRelic = (code: string) => inv(`/R/${code.replace(" ", "")}`, `${code} Intact`, "relic", 1);
const noLive: Live = { fissures: null, resurgence: null, resurgenceExpiry: null };

function rowOf(inventory: InventoryRow[], vault: Vault = ALL_VAULTED, live: Live = noLive, catalog: CatalogItem[] = [example], foundry: Record<string, number> | null = null) {
  const m = buildModel({ observed_at: 1, inventory, catalog, relics: relics(vault), prices: { prices: { "Example Prime Blueprint": 20, "Example Prime Blade": 10, "Example Prime Handle": 15 } } } as unknown as Bundle, live, foundry);
  return { m, row: masteryRows(m).find((r) => r.unique === EX)! };
}
const listed = (r: { acq: { available: boolean; tradeOnly?: boolean } }) => r.acq.available && !r.acq.tradeOnly;
const traded = (r: { acq: { available: boolean; tradeOnly?: boolean } }) => !r.acq.available && r.acq.tradeOnly === true;

test("relics still in the drop tables: listed", () => {
  const { row } = rowOf([], { Blueprint: false, Blade: false, Handle: false });
  assert.ok(listed(row), row.acq.how);
});

test("a vaulted part Varzia has: listed, with the rest from the drop tables", () => {
  const live: Live = { ...noLive, resurgence: [{ uniqueName: "/R/AxiE2", item: "Axi E2 Relic" }] as Live["resurgence"] };
  const { row } = rowOf([part("Blueprint")], { Blueprint: true, Blade: true, Handle: false }, live);
  assert.ok(listed(row), row.acq.how);
});

test("Varzia has one vaulted part but another vaulted part comes from no relic of yours: trade only", () => {
  const live: Live = { ...noLive, resurgence: [{ uniqueName: "/R/AxiE2", item: "Axi E2 Relic" }] as Live["resurgence"] };
  const { row } = rowOf([part("Blueprint")], ALL_VAULTED, live);
  assert.ok(traded(row), row.acq.how);
});

test("a relic held for every missing vaulted part: listed", () => {
  const { row } = rowOf([part("Blueprint"), heldRelic("Axi E2"), heldRelic("Axi E3")]);
  assert.ok(listed(row), row.acq.how);
  assert.match(row.acq.how, /your relics cover 2 of 2/);
});

test("a relic held for some of the missing vaulted parts only: trade only, and the card still says what the relics cover", () => {
  const { row } = rowOf([part("Blueprint"), heldRelic("Axi E2")]);
  assert.ok(traded(row), row.acq.how);
  assert.match(row.acq.how, /your relics cover 1 of 2/);
  assert.equal(row.acq.difficulty, 4);
});

test("vaulted, no relic, some or no parts held: trade only, at the hard effort, saying how to get it", () => {
  for (const inventory of [[], [part("Blueprint")], [part("Blueprint"), part("Blade", 1), part("Handle")]]) {
    const { row } = rowOf(inventory);
    assert.ok(traded(row), `${inventory.length} rows: ${row.acq.how}`);
    assert.equal(row.acq.difficulty, 4);
    assert.match(row.acq.how, /relics you'd have to trade for\. Or buy the/);
  }
});

test("every part held (Venka Prime in the report), built and waiting, or owned: listed", () => {
  const every = rowOf([part("Blueprint"), part("Blade", 2), part("Handle")]).row;
  assert.equal(every.status, "build");
  assert.ok(listed(every));
  const waiting = rowOf([], ALL_VAULTED, noLive, [example], { "/W/ExamplePrimeBlueprint": 1 }).row;
  assert.equal(waiting.acq.difficulty, 0);
  assert.ok(listed(waiting));
  const owned = rowOf([inv(EX, "Example Prime", "weapon", 1)]).row;
  assert.equal(owned.acq.difficulty, 0);
  assert.ok(listed(owned));
});

test("what can't be got at all stays apart from the trade-only primes", () => {
  const founders = { uniqueName: "/W/ExcaliburPrime", name: "Excalibur Prime", category: "Warframes", masterable: true, isPrime: true } as CatalogItem;
  const m = buildModel({ observed_at: 1, inventory: [], catalog: [founders], relics: [], prices: {} } as unknown as Bundle);
  const r = masteryRows(m).find((x) => x.name === "Excalibur Prime")!;
  assert.equal(r.acq.available, false);
  assert.notEqual(r.acq.tradeOnly, true);
});

// A prime companion's weapon comes with its companion: it is listed when the companion is.
const SENTINEL = "/Lotus/Types/Sentinels/SentinelPowersuits/PrimeDethCubePowerSuit";
const RIFLE = "/Lotus/Types/Sentinels/SentinelWeapons/PrimeDethMachineRifle";
const scomp = (p: string) => ({ uniqueName: `/S/DethcubePrime${p}`, name: p, itemCount: 1, ducats: 45 });
const sentinel = { uniqueName: SENTINEL, name: "Dethcube Prime", category: "Sentinels", masterable: true, isPrime: true, vaulted: true, components: [scomp("Blueprint"), scomp("Cerebrum")] } as CatalogItem;
const rifle = { uniqueName: RIFLE, name: "Deth Machine Rifle Prime", category: "Primary", type: "Companion Weapon", productCategory: "SentinelWeapons", masterable: true, isPrime: true } as CatalogItem;
function companion(inventory: InventoryRow[], vaulted: boolean) {
  const rs = ["Blueprint", "Cerebrum"].map((p, i) => ({ uniqueName: `/R/AxiD${i}`, name: `Axi D${i} Intact`, vaulted, rewards: [{ name: `Dethcube Prime ${p}`, rarity: "Common", chance: 25.33 }] }));
  const rows = masteryRows(buildModel({ observed_at: 1, inventory, catalog: [sentinel, rifle], relics: rs, prices: {} } as unknown as Bundle));
  return { dog: rows.find((r) => r.unique === SENTINEL)!, gun: rows.find((r) => r.unique === RIFLE)! };
}

test("a companion's weapon follows its companion: trade only with it, listed with it", () => {
  const vaulted = companion([], true);
  assert.ok(traded(vaulted.dog), vaulted.dog.acq.how);
  assert.ok(traded(vaulted.gun), vaulted.gun.acq.how);
  const farmable = companion([], false);
  assert.ok(listed(farmable.dog));
  assert.ok(listed(farmable.gun), farmable.gun.acq.how);
  const parts = companion([inv("/S/DethcubePrimeBlueprint", "Dethcube Prime Blueprint", "prime_part", 1), inv("/S/DethcubePrimeCerebrum", "Dethcube Prime Cerebrum", "prime_part", 1)], true);
  assert.ok(listed(parts.dog));
  assert.ok(listed(parts.gun), parts.gun.acq.how);
});

test("a trade-only prime's held parts still count where selling is decided", () => {
  // The Blueprint held twice, the rest missing and vaulted with no relic: one copy kept to build, one spare.
  const { m, row } = rowOf([part("Blueprint", 2)]);
  assert.ok(traded(row));
  const bp = partRows(m).find((p) => p.name === "Example Prime Blueprint")!;
  assert.deepEqual([bp.quantity, bp.keep, bp.spare], [2, 1, 1]);
  assert.deepEqual(setRows(m).find((s) => s.unique === EX)!.parts.map((p) => p.owned), [2, 0, 0]);
});

test("the demo account: every row held back is trade only or can't be got, and no prime the player can build is", () => {
  const demo = JSON.parse(readFileSync(new URL("../demo/dev-bundle.json", import.meta.url), "utf8")) as Bundle;
  const rows = masteryRows(buildModel(demo));
  for (const r of rows.filter((x) => !x.acq.available)) {
    if (r.acq.tradeOnly) {
      assert.ok(r.isPrime, r.name);
      assert.notEqual(r.status, "build", r.name);
    } else assert.ok(r.unobtainable || r.acq.researched, `${r.name}: ${r.acq.how}`);
  }
  assert.ok(rows.some((r) => r.acq.tradeOnly), "the demo has vaulted primes it can only trade for");
});
