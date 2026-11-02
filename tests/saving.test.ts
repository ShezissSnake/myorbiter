// Loose prime parts waiting for a set worth more whole (Settings → Selling, Save prime parts for
// sets), and the drop log that says which parts you keep getting.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel } from "../src/lib/core/model";
import { partRows, saveForSets, setSaves } from "../src/lib/core/views";
import { defaultBulkRules, sellTargets } from "../src/lib/core/bulk";
import { defaultAdvice } from "../src/lib/backend";
import { dropTotals, emptyDropLog, recentDrops, recordRead } from "../src/lib/core/drops";
import type { Bundle, InventoryRow } from "../src/lib/core/types";

const inv = (item_id: string, name: string, category: string, quantity: number, extra: Partial<InventoryRow> = {}): InventoryRow => ({
  item_id, name, category, quantity, mastered: false, image_name: null, rank: null, max_rank: null, ...extra,
});
const RHINO = "/Lotus/Powersuits/Rhino/RhinoPrime";
const BP = "Rhino Prime Blueprint";
const CHASSIS = "Rhino Prime Chassis Blueprint";
const NEURO = "Rhino Prime Neuroptics Blueprint";
const SYS = "Rhino Prime Systems Blueprint";

/** Rhino Prime mastered; its parts sell for 65p one by one; Systems drops from Lith K1. */
const bundle = (inventory: InventoryRow[], o: { set?: number; vaulted?: boolean } = {}): Bundle => ({
  observed_at: 1_700_000_000,
  inventory: [inv(RHINO, "Rhino Prime", "frame", 0, { mastered: true }), ...inventory],
  catalog: [
    {
      uniqueName: RHINO, name: "Rhino Prime", category: "Warframes", masterable: true, isPrime: true,
      components: [
        { uniqueName: "/R/Bp", name: "Blueprint", ducats: 100, itemCount: 1 },
        { uniqueName: "/R/Chassis", name: "Chassis", ducats: 15, itemCount: 1 },
        { uniqueName: "/R/Helmet", name: "Neuroptics", ducats: 45, itemCount: 1 },
        { uniqueName: "/R/Systems", name: "Systems", ducats: 45, itemCount: 1 },
      ],
    },
  ],
  relics: [
    { uniqueName: "/Relic/K1Bronze", name: "Lith K1 Intact", vaulted: o.vaulted ?? false, rewards: [{ name: SYS, rarity: "Rare", chance: 2 }, { name: "1200X Kuva", rarity: "Common", chance: 98 }] },
  ],
  prices: { prices: { "Rhino Prime Set": o.set ?? 80, [BP]: 20, [CHASSIS]: 5, [NEURO]: 10, [SYS]: 30 }, max_rank_prices: {} },
});
const three = (n = 1) => [inv("/R/Bp", BP, "prime_part", n), inv("/R/Chassis", CHASSIS, "prime_part", 1), inv("/R/Helmet", NEURO, "prime_part", 1)];
const on = (drops: Map<string, number> = new Map(), rate = 0) => saveForSets({ saveForSets: true }, rate, drops)!;
const row = (rows: ReturnType<typeof partRows>, name: string) => rows.find((r) => r.name === name)!;

test("loose parts of a set worth more whole wait for it while the missing part still drops", () => {
  const m = buildModel(bundle(three(2)));
  const rows = partRows(m, on());
  assert.equal(row(rows, BP).forSet, 1);
  assert.equal(row(rows, BP).spare, 1, "only one set's worth waits: the second blueprint can go");
  assert.equal(row(rows, CHASSIS).forSet, 1);
  assert.equal(row(rows, CHASSIS).spare, 0);
  const s = setSaves(m, on()).get(RHINO)!;
  assert.deepEqual(s.missing, [{ name: SYS, count: 1, from: "farmable", got: 0 }]);
  assert.equal(s.partsPrice, 65);
  assert.equal(row(rows, CHASSIS).saving?.set, "Rhino Prime");
});

test("nothing waits when the set isn't worth more, the setting is off, or a part can't be had", () => {
  assert.equal(row(partRows(buildModel(bundle(three(), { set: 60 })), on()), BP).forSet, 0, "parts sell for more one by one");
  assert.equal(saveForSets({ saveForSets: false }, 0), null);
  assert.equal(row(partRows(buildModel(bundle(three()))), BP).forSet, 0, "off: partRows without the setting");
  // Only a vaulted relic you don't own drops the Systems.
  assert.equal(row(partRows(buildModel(bundle(three(), { vaulted: true })), on()), BP).forSet, 0);
  // At 1p a ducat the blueprint alone is worth 100p at Baro: the 80p set doesn't beat the parts.
  assert.equal(row(partRows(buildModel(bundle(three())), on(new Map(), 1)), BP).forSet, 0);
});

test("a vaulted part waits on a relic you own, or on copies you've been getting", () => {
  const owned = buildModel(bundle([...three(), inv("/Relic/K1Bronze", "Lith K1 Intact", "relic", 1)], { vaulted: true }));
  assert.equal(setSaves(owned, on()).get(RHINO)?.missing[0].from, "relic");
  const vaulted = buildModel(bundle(three(), { vaulted: true }));
  const s = setSaves(vaulted, on(new Map([[SYS, 2]]))).get(RHINO)!;
  assert.deepEqual(s.missing[0], { name: SYS, count: 1, from: "dropped", got: 2 });
  // With only the blueprint, the Chassis and Neuroptics come from no relic: not waited for unless you get them.
  const bpOnly = buildModel(bundle([inv("/R/Bp", BP, "prime_part", 1)]));
  assert.equal(setSaves(bpOnly, on()).size, 0);
  assert.equal(setSaves(bpOnly, on(new Map([[CHASSIS, 1], [NEURO, 1]]))).size, 1);
});

test("the bulk sale doesn't list a waiting part, and takes its listing down", () => {
  const m = buildModel(bundle(three(2)));
  const rules = { ...defaultBulkRules(), parts: true, sets: true, arcanes: false, mods: false, imprints: false };
  const t = sellTargets(m, rules, { ...defaultAdvice(), platPerDucat: 0, minPlat: 1 }, null, { veiledRivens: false, relicsWorthSelling: false, saveForSets: true });
  const chassis = t.find((x) => x.name === CHASSIS)!;
  assert.equal(chassis.hold?.takeDown, true);
  assert.match(chassis.hold!.why, /saved for a Rhino Prime Set/);
  const bp = t.find((x) => x.name === BP)!;
  assert.equal(bp.quantity, 1, "the spare blueprint is still listed");
  assert.equal(bp.hold, undefined);
  const off = sellTargets(m, rules, { ...defaultAdvice(), platPerDucat: 0, minPlat: 1 }, null, { veiledRivens: false, relicsWorthSelling: false, saveForSets: false });
  assert.equal(off.find((x) => x.name === CHASSIS)?.hold, undefined);
});

test("the drop log: the first read is the baseline, later gains are drops, trades aren't", () => {
  const t0 = 1_800_000_000_000;
  let log = recordRead(emptyDropLog(), { [SYS]: 1 }, t0)!;
  assert.deepEqual(log.windows, []);
  assert.equal(recordRead(log, { [SYS]: 1 }, t0), null, "the same read again");
  log = recordRead(log, { [SYS]: 3, [BP]: 1 }, t0 + 60_000)!;
  assert.deepEqual(log.windows[0].gains, { [SYS]: 2, [BP]: 1 });
  // One of the Systems came in a trade between the two reads (the game names it without "Blueprint").
  const traded = dropTotals(log, [{ at: t0 + 30_000, received: [{ name: "Rhino Prime Systems", count: 1 }] }], 0);
  assert.equal(traded.get(SYS), 1);
  assert.equal(traded.get(BP), 1);
  // A trade outside the window doesn't count against it.
  assert.equal(dropTotals(log, [{ at: t0 + 120_000, received: [{ name: SYS, count: 5 }] }], 0).get(SYS), 2);
  // Selling or using a part isn't a negative drop.
  log = recordRead(log, { [SYS]: 2, [BP]: 1 }, t0 + 120_000)!;
  assert.equal(log.windows.length, 1);
});

test("the drop log skips a partial read and forgets gains after 90 days", () => {
  const t0 = 1_800_000_000_000;
  const full = { [SYS]: 4, [BP]: 4, [CHASSIS]: 4 };
  let log = recordRead(emptyDropLog(), full, t0)!;
  log = recordRead(log, { [SYS]: 1 }, t0 + 1000)!;
  assert.deepEqual([log.at, log.low, log.counts], [t0, true, full], "a read with most of it missing is set aside");
  log = recordRead(log, { ...full, [SYS]: 5 }, t0 + 2000)!;
  assert.equal(log.low, undefined);
  assert.deepEqual(log.windows.map((w) => w.gains), [{ [SYS]: 1 }]);
  const later = t0 + 91 * 86_400_000;
  log = recordRead(log, { ...full, [SYS]: 5, [BP]: 5 }, later)!;
  assert.deepEqual(log.windows.map((w) => w.gains), [{ [BP]: 1 }]);
  assert.equal(recentDrops(log, [], later).get(BP), 1);
  assert.equal(recentDrops(log, [], later + 31 * 86_400_000).size, 0, "only the last 30 days count");
});

test("a set only a little dearer than its parts isn't waited for", async () => {
  const { worthSaving } = await import("../src/lib/core/views");
  assert.equal(worthSaving(44, 40), false, "10% more, but only 4p");
  assert.equal(worthSaving(50, 45), true, "5p and 11% more");
  assert.equal(worthSaving(70, 65), false, "5p, but under 10% more");
  assert.equal(worthSaving(105, 100), false, "5p but only 5% more");
  assert.equal(worthSaving(110, 100), true);
  assert.equal(row(partRows(buildModel(bundle(three(), { set: 68 })), on()), BP).forSet, 0);
});

test("the drop log after a big sale, an empty first read, and a read missing a whole category", () => {
  const t0 = 1_800_000_000_000;
  // Nothing held yet (or nothing read): no baseline, so the first real read isn't all drops.
  assert.equal(recordRead(emptyDropLog(), {}, t0), null);
  // Most of it traded in at Baro: the first low read is set aside, the second one believed, with nothing counted.
  let log = recordRead(emptyDropLog(), { a: 100, b: 100 }, t0)!;
  log = recordRead(log, { a: 20, b: 30 }, t0 + 1000)!;
  log = recordRead(log, { a: 21, b: 30 }, t0 + 2000)!;
  assert.deepEqual([log.counts, log.windows.length, log.low], [{ a: 21, b: 30 }, 0, undefined]);
  log = recordRead(log, { a: 22, b: 30 }, t0 + 3000)!;
  assert.deepEqual(log.windows.map((w) => w.gains), [{ a: 1 }], "and drops count again after");
  // One read missing the gear parts: they keep their count, and coming back isn't a drop.
  log = recordRead(emptyDropLog(), { a: 10, b: 10, c: 3 }, t0)!;
  log = recordRead(log, { a: 10, b: 10 }, t0 + 1000)!;
  assert.deepEqual([log.counts.c, log.gone], [3, ["c"]]);
  log = recordRead(log, { a: 10, b: 10, c: 3 }, t0 + 2000)!;
  assert.deepEqual([log.windows.length, log.gone], [0, undefined]);
  // Gone two reads running: sold, and forgotten.
  log = recordRead(log, { a: 10, b: 10 }, t0 + 3000)!;
  log = recordRead(log, { a: 10, b: 10 }, t0 + 4000)!;
  assert.equal("c" in log.counts, false);
  // Nothing changed: the log isn't rewritten.
  assert.equal(recordRead(log, { a: 10, b: 10 }, t0 + 5000), null);
});

test("a waiting part's listing comes down only when nothing else keeps a copy", () => {
  const rules = { ...defaultBulkRules(), parts: true, sets: true, arcanes: false, mods: false, imprints: false };
  const advice = { ...defaultAdvice(), platPerDucat: 0, minPlat: 1 };
  const sell = { veiledRivens: false, relicsWorthSelling: false, saveForSets: true };
  // Not mastered: one of each is kept to build, the second chassis waits for a set to sell.
  const unbuilt = buildModel({ ...bundle([...three(), inv("/R/Chassis", CHASSIS, "prime_part", 1)]), inventory: [...three(), inv("/R/Chassis", CHASSIS, "prime_part", 1)] });
  // The Blueprint and Neuroptics come from no relic here: ones you've been getting.
  const c = sellTargets(unbuilt, rules, advice, null, sell, new Map([[BP, 1], [NEURO, 1]])).find((x) => x.name === CHASSIS);
  assert.equal(c?.hold?.takeDown, false, "copies kept to build: a listing you made stays as listed");
});
