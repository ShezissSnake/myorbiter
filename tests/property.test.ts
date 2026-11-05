// Property tests for the money logic: thousands of random accounts, listings and settings, from a
// seeded generator, against the rules that must always hold. A failure prints its seed and case;
// PROPERTY_SEED=<n> replays one, PROPERTY_RUNS=<n> runs more.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel } from "../src/lib/core/model";
import { aboveDucats, ducatsBeat, ducatWorth, kindOfItem, platToBeat, provenSpare } from "../src/lib/core/bulk";
import { guardListing, inventoryTrust, MAX_CLOCK_AHEAD_MS, MAX_INVENTORY_AGE_MS } from "../src/lib/core/listGuard";
import { indexItems, type MarketItem } from "../src/lib/core/market";
import { LICH_MOD_KEEP, MOD_KEEP, modSpares } from "../src/lib/core/views";
import { autoFloor, unattendedMove } from "../src/lib/core/approved";
import { defaultSellChoices } from "../src/lib/core/spares";
import { defaultSparesRules, withNeverSell } from "../src/lib/core/sparesRules";
import type { Bundle, CatalogItem, InventoryRow } from "../src/lib/core/types";
import { forAll, type Rng } from "./support/prop";
import { defaultAdvice } from "../src/lib/backend";

// ------------------------------------------------------------------ random accounts

const NOW = Date.UTC(2026, 10, 4, 8, 0, 0);
const KHRA = "/Lotus/Upgrades/Mods/Immortal/ImmortalEightMod";
const WILLOW = "/Lotus/Weapons/Tenno/Melee/MeleeTrees/PolearmCmbTwoMeleeTree";
const SERRATION = "/Lotus/Upgrades/Mods/Rifle/WeaponDamageAmountMod";
const BRONCO = "/Lotus/Weapons/Tenno/Pistol/BroncoPrime";
const B_BARREL = "/Lotus/Types/Recipes/Weapons/WeaponParts/BroncoPrimeBarrel";
const B_BP = "/Lotus/Types/Recipes/Weapons/BroncoPrimeBlueprint";
const B_RECEIVER = "/Lotus/Types/Recipes/Weapons/WeaponParts/BroncoPrimeReceiver";
const LATO = "/Lotus/Weapons/Tenno/Pistol/LatoPrime";
const KUVA = ["Kuva Bramma", "Kuva Brakk", "Kuva Nukor", "Kuva Ogris", "Kuva Zarr", "Tenet Livia"];
const kuvaPath = (n: string) => `/Lotus/Weapons/Lich/${n.replace(/ /g, "")}`;

const inv = (item_id: string, name: string, category: string, quantity: number, extra: Partial<InventoryRow> = {}): InventoryRow => ({
  item_id, name, category, quantity, mastered: false, image_name: null, rank: null, max_rank: null, ...extra,
});
const cat = (uniqueName: string, name: string, category: string, extra: Partial<CatalogItem> = {}) => ({ uniqueName, name, category, ...extra }) as CatalogItem;
const catalog: CatalogItem[] = [
  ...KUVA.map((n) => cat(kuvaPath(n), n, /Brakk|Nukor/.test(n) ? "Secondary" : n === "Tenet Livia" ? "Melee" : "Primary", { masterable: true })),
  cat(KHRA, "Khra", "Mods", { maxRank: 3, tradable: false, rarity: "Rare" }),
  cat(WILLOW, "Bleeding Willow", "Mods", { maxRank: 3, tradable: true, rarity: "Rare" }),
  cat(SERRATION, "Serration", "Mods", { maxRank: 10, tradable: true, rarity: "Common" }),
  cat(BRONCO, "Bronco Prime", "Secondary", {
    masterable: true, isPrime: true,
    components: [
      { uniqueName: B_BARREL, name: "Barrel", ducats: 45, itemCount: 1 },
      { uniqueName: B_BP, name: "Blueprint", ducats: 15, itemCount: 1 },
      { uniqueName: B_RECEIVER, name: "Receiver", ducats: 15, itemCount: 1 },
    ],
  } as Partial<CatalogItem>),
  cat(LATO, "Lato Prime", "Secondary", { masterable: true }),
];
const prices: NonNullable<Bundle["prices"]> = {
  prices: { Khra: 9, "Bleeding Willow": 4, Serration: 6, "Bronco Prime Set": 8, "Bronco Prime Barrel": 3, "Bronco Prime Blueprint": 3, "Bronco Prime Receiver": 3 },
  max_rank_prices: { Khra: 9, "Bleeding Willow": 10, Serration: 12 },
  trade_rate: { Khra: [39.8, 22, ""], "Bleeding Willow": [7.4, 22, ""], Serration: [9, 22, ""], "Bronco Prime Set": [40.1, 22, ""], "Bronco Prime Barrel": [30.3, 22, ""] },
};
const items: MarketItem[] = [
  { id: "khra", slug: "khra", gameRef: KHRA, name: "Khra", maxRank: 3, subtypes: null, tags: ["mod", "rare", "parazon"] },
  { id: "willow", slug: "bleeding_willow", gameRef: WILLOW, name: "Bleeding Willow", maxRank: 3, subtypes: null, tags: ["mod", "rare", "stance", "polearms"] },
  { id: "serration", slug: "serration", gameRef: SERRATION, name: "Serration", maxRank: 10, subtypes: null, tags: ["mod", "common", "primary"] },
  { id: "bronco", slug: "bronco_prime_set", gameRef: BRONCO, name: "Bronco Prime Set", maxRank: null, subtypes: null, tags: ["weapon", "prime", "set", "secondary"] },
  { id: "barrel", slug: "bronco_prime_barrel", gameRef: B_BARREL, name: "Bronco Prime Barrel", maxRank: null, subtypes: null, tags: ["prime", "component", "secondary"] },
];
const index = indexItems(items);

/** A random account: mods by rank (some installed), Bronco Prime sets and loose parts, lich mastery, a read time. */
function randomAccount(r: Rng): { bundle: Bundle; ageMs: number } {
  const held: InventoryRow[] = [];
  for (const [path, name, max] of [[KHRA, "Khra", 3], [WILLOW, "Bleeding Willow", 3], [SERRATION, "Serration", 10]] as const) {
    for (const rank of [0, r.int(1, max)]) {
      const n = r.int(0, 9);
      if (!n) continue;
      const extra: Partial<InventoryRow> = rank ? { rank, max_rank: max } : {};
      if (r.bool(0.3)) extra.equipped = r.int(0, n);
      held.push(inv(rank ? `${path}#${rank}` : path, name, "mod", n, extra));
    }
  }
  for (const [path, name] of [[B_BARREL, "Bronco Prime Barrel"], [B_BP, "Bronco Prime Blueprint"], [B_RECEIVER, "Bronco Prime Receiver"]] as const) {
    const n = r.int(0, 5);
    if (n) held.push(inv(path, name, "prime_part", n));
  }
  if (r.bool(0.6)) held.push(inv(BRONCO, "Bronco Prime", "weapon", 1, { mastered: r.bool(0.7) }));
  for (const n of KUVA) if (r.bool(0.4)) held.push(inv(kuvaPath(n), n, "weapon", 0, { mastered: true }));
  if (r.bool(0.95)) held.push(inv(LATO, "Lato Prime", "weapon", 1, { mastered: true }));
  // The read's age: mostly fresh, sometimes old, sometimes ahead of the clock, sometimes unknown.
  const ageMs = r.bool(0.7) ? r.pick([60_000, 30 * 60_000, 2.9 * 3_600_000, -5 * 60_000]) : r.pick([3.2 * 3_600_000, 26 * 3_600_000, -40 * 60_000, NaN]);
  const observed = Number.isNaN(ageMs) ? null : Math.floor((NOW - ageMs) / 1000);
  return { bundle: { observed_at: observed, inventory: held, catalog, relics: [], prices }, ageMs };
}

// ------------------------------------------------------------------ the last check before listing

test("listGuard: whatever is asked, nothing goes up beyond what the keep rules prove spare, never a never-sell item, never under its ducats, never on an old read", () => {
  let allowedAuto = 0;
  let allowedManual = 0;
  forAll("listGuard", (r) => {
    const { bundle } = randomAccount(r);
    const m = buildModel(bundle);
    let rules = defaultSparesRules();
    if (r.bool(0.25)) rules = withNeverSell(rules, { id: r.pick(items).id, name: "x", cat: null });
    const advice = { ...defaultAdvice(), platPerDucat: r.pick([0, 0.05, 0.1, 0.3, 0.55, 1.1, 2]) };
    const it = r.pick(items);
    const req = {
      item: it,
      rank: it.maxRank != null ? r.int(0, it.maxRank) : null,
      subtype: null,
      // Mostly what a plan or the form would send; a fifth of the time, anything at all.
      quantity: r.bool(0.8) ? r.int(1, 3) : r.pick([r.int(-1, 9), 0.5, 1.5, NaN, Infinity]),
      platinum: (r.bool(0.8) ? r.int(1, 150) : r.pick([null, NaN, 0, -3, 10.5])) as number | null,
      listedElsewhere: (r.bool(0.8) ? r.pick([0, 0, 1]) : r.pick([r.int(0, 6), NaN, undefined])) as number | undefined,
      manual: r.bool(0.3),
    };
    const c = { model: m, index, sell: defaultSellChoices(), advice, rules, now: NOW };
    const g = guardListing(c, req);
    if (!g.ok) return;
    const ctx = JSON.stringify({ item: it.id, req: { ...req, item: undefined } });
    // Never a never-sell item, whoever asks.
    assert.ok(!rules.neverSell.some((n) => n.id === it.id), `never-sell listed: ${ctx}`);
    // Whole copies only.
    assert.ok(Number.isInteger(req.quantity) && req.quantity > 0, `quantity ${req.quantity}: ${ctx}`);
    const elsewhere = Math.max(0, req.listedElsewhere ?? 0);
    const kind = kindOfItem(m, it);
    const proven = kind ? provenSpare(c, kind, it, req.rank, null) : null;
    const noInventory = !m.observedAt && m.inventoryByBase.size === 0;
    if (!req.manual) {
      allowedAuto++;
      // An automatic listing: a whole price, a trusted recent read, a keep rule, within what it proves.
      assert.ok(Number.isInteger(req.platinum) && req.platinum! >= 1, `price ${req.platinum}: ${ctx}`);
      assert.ok(inventoryTrust(m, NOW).ok, `untrusted read listed: ${ctx}`);
      assert.ok(proven, `no keep rule: ${ctx}`);
      assert.ok(req.quantity + elsewhere <= proven!.spare, `${req.quantity}+${elsewhere} > ${proven!.spare} spare: ${ctx}`);
      const worth = ducatWorth(m, it, advice.platPerDucat);
      if ((kind === "part" || kind === "set") && worth != null) assert.ok(!ducatsBeat(req.platinum!, worth), `under its ducats: ${ctx}`);
    } else {
      allowedManual++;
      // Asked by hand: still never more than the keep rules prove, when there's an inventory to prove it from.
      if (!noInventory && proven) assert.ok(req.quantity + elsewhere <= proven.spare, `manual ${req.quantity}+${elsewhere} > ${proven.spare}: ${ctx}`);
    }
  });
  // The generator reaches the allowed side too, or the test proves nothing.
  assert.ok(allowedAuto > 50 && allowedManual > 50, `allowed: ${allowedAuto} automatic, ${allowedManual} by hand`);
});

test("inventory trust: fresh only within 3 hours, never ahead of the clock beyond a few minutes", () => {
  forAll("trust", (r) => {
    const { bundle } = randomAccount(r);
    const m = buildModel(bundle);
    const now = NOW + r.int(-3_600_000, 3_600_000);
    const t = inventoryTrust(m, now);
    if (!t.ok || !m.observedAt) return;
    const age = now - +m.observedAt;
    assert.ok(age <= MAX_INVENTORY_AGE_MS && age >= -MAX_CLOCK_AHEAD_MS, `trusted at age ${age} ms`);
    assert.ok(m.inventoryByBase.size > 0 && m.mastered.size > 0);
  });
});

// ------------------------------------------------------------------ duplicate mods

test("modSpares: installed copies are never spare, the keep is honoured, and one loose copy is always kept outside the lich rule", () => {
  forAll("modSpares", (r) => {
    const ranks = Array.from({ length: r.int(1, 4) }, (_, i) => {
      const count = r.int(0, 12);
      return { rank: 10 - i * 3, count, installed: r.bool(0.4) ? r.int(0, count + 2) : undefined };
    });
    const lich = r.bool(0.3);
    const keep = r.pick([undefined, 0, 1, 2, 3, 5, 8]);
    const out = modSpares({ ranks, keptFor: lich ? "5 kept: lich weapons left" : null, keep });
    const total = ranks.reduce((n, x) => n + x.count, 0);
    const installed = ranks.reduce((n, x) => n + Math.min(x.count, Math.max(0, x.installed ?? 0)), 0);
    const loose = ranks.reduce((n, x) => n + Math.max(0, x.count - Math.max(0, x.installed ?? 0)), 0);
    const spare = out.reduce((n, x) => n + x.count, 0);
    const ctx = JSON.stringify({ ranks, lich, keep, out });
    // Every spare copy is a loose copy of its own rank.
    for (const o of out) {
      const src = ranks.find((x) => x.rank === o.rank)!;
      assert.ok(Number.isInteger(o.count) && o.count > 0 && o.count <= Math.max(0, src.count - Math.max(0, src.installed ?? 0)), ctx);
    }
    const kept = lich ? Math.max(0, (keep ?? LICH_MOD_KEEP) - installed) : Math.max(1, Math.max(1, keep ?? MOD_KEEP) - installed);
    assert.equal(spare, Math.max(0, loose - kept), ctx);
    assert.ok(spare <= total - installed, ctx);
    if (!lich && loose > 0) assert.ok(spare < loose, `the last loose copy went: ${ctx}`);
    // Your best copy stays: with none installed, a copy of the best rank held loose is kept.
    if (!lich && !installed && loose > 0) {
      const best = ranks.find((x) => x.count - Math.max(0, x.installed ?? 0) > 0)!;
      const goes = out.find((o) => o.rank === best.rank)?.count ?? 0;
      assert.ok(goes < best.count - Math.max(0, best.installed ?? 0), `the best copy (R${best.rank}) went: ${ctx}`);
    }
  });
});

// ------------------------------------------------------------------ the ducat edge

test("ducats: the floor is the first whole price that beats them; every price under it is refused", () => {
  forAll("ducats", (r) => {
    const ducats = r.pick([15, 25, 45, 65, 75, 100, r.int(1, 300)]);
    // The rate in hundredths of a platinum, so the exact answer can be worked out in whole numbers.
    const k = r.pick([1, 5, 10, 25, 30, 55, 110, 130, r.int(1, 300)]);
    const rate = k / 100;
    const worth = ducats * rate;
    const floor = aboveDucats(worth)!;
    const ctx = `${ducats} ducats at ${rate}p (worth ${worth}): floor ${floor}`;
    // Exactly: worth is ducats·k/100; the edge is a fifth more, or 2p more when that's larger
    // (worth under 10p). The floor is the least whole number at or above it.
    const exact = ducats * k >= 1000 ? Math.ceil((ducats * k * 12) / 1000) : Math.ceil((ducats * k + 200) / 100);
    assert.equal(floor, exact, ctx);
    assert.ok(Number.isInteger(floor) && floor >= 1, ctx);
    assert.ok(floor >= platToBeat(worth) - 1e-6, ctx);
    assert.equal(ducatsBeat(floor, worth), false, ctx);
    assert.equal(ducatsBeat(floor - 1, worth), true, ctx);
    const p = r.int(1, 400);
    assert.equal(ducatsBeat(p, worth), p < floor, `${ctx}, at ${p}p`);
  });
});

// ------------------------------------------------------------------ the repricing floor

test("repricing floor: unattended, never under 70% of the approved price, never raised to it, never held when raising", () => {
  forAll("unattended", (r) => {
    const approved = r.int(1, 2000);
    const current = r.int(1, 2500);
    const target = r.int(1, 2500);
    const floor = autoFloor(approved);
    const mv = unattendedMove(target, current, approved);
    const ctx = JSON.stringify({ approved, current, target, floor, mv });
    assert.ok(floor >= approved * 0.7 - 1e-9 && floor < approved * 0.7 + 1, ctx);
    if (mv.go) {
      assert.ok(mv.target >= floor, `under the floor: ${ctx}`);
      assert.ok(mv.target === target || mv.target === floor, ctx);
      if (target >= floor) assert.equal(mv.target, target, ctx);
      // Lowered to the floor only from above it: a listing under the floor is never raised to it.
      if (mv.target === floor && target < floor) assert.ok(current > floor, ctx);
    } else {
      assert.ok(target < floor && current <= floor, ctx);
    }
  });
});

