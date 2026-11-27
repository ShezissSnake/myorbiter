// A saved drops log read back from the settings file, then the next inventory read taken in as the
// window does it (App.svelte: recordRead with dropCounts, dropBuilding, the parts traded away and
// dropRecounted), then the totals the pages and Save for sets read. A log whose counts cannot be
// read whole is a new baseline: no copy already held counts as a drop.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel } from "../src/lib/core/model";
import { dropBuilding, dropCounts, dropRecounted, emptyDropLog, recentDrops, recordRead, type DropLog } from "../src/lib/core/drops";
import { saveSource } from "../src/lib/core/views";
import { defaultSettings, flushSettings, loadSettings, saveSettings } from "../src/lib/backend";
import type { Bundle, CatalogItem, InventoryRow } from "../src/lib/core/types";

const BARREL = "/Lotus/Types/Recipes/Weapons/WeaponParts/LatoVandalBarrel";
const RECEIVER = "/Lotus/Types/Recipes/Weapons/WeaponParts/LatoVandalReceiver";
const LATO: CatalogItem = {
  uniqueName: "/Lotus/Weapons/Tenno/Pistol/LatoVandal", name: "Lato Vandal", category: "Secondary", type: "Pistol", masterable: true,
  components: [
    { uniqueName: BARREL, name: "Barrel", itemCount: 1 },
    { uniqueName: "/Lotus/Types/Recipes/Weapons/LatoVandalBlueprint", name: "Blueprint", itemCount: 1 },
    { uniqueName: RECEIVER, name: "Receiver", itemCount: 1 },
  ],
} as CatalogItem;
const inv = (item_id: string, name: string, quantity: number): InventoryRow => ({ item_id, name, category: "blueprint", quantity, mastered: false, image_name: null, rank: null, max_rank: null });
/** The collection with `barrels` Lato Vandal Barrels and `receivers` Receivers held. */
const model = (barrels: number, receivers: number) =>
  buildModel({ observed_at: 1_700_000_000, inventory: [inv(BARREL, "Lato Vandal Barrel", barrels), inv(RECEIVER, "Lato Vandal Receiver", receivers)], catalog: [LATO], relics: [], prices: { prices: {}, max_rank_prices: {} } } as Bundle);

const DAY = 86_400_000;
const T = 1_800_000_000_000;
/** A drop logged a day before the saved log's last read. */
const EARLIER = { from: T - 2 * DAY, at: T - DAY, gains: { "Lato Vandal Barrel": 1 } };

/** The window's next read of `m` at `at`, as App.svelte takes it in. */
const nextRead = (log: DropLog, m: ReturnType<typeof model>, at: number) => recordRead(log, dropCounts(m), at, at, dropBuilding(m), [], dropRecounted(m)) ?? log;

async function loadDrops(drops: unknown): Promise<DropLog> {
  const stored = new Map<string, string>([["orbiter-settings", JSON.stringify({ ...defaultSettings(), game: { ...defaultSettings().game, drops } })]]);
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => void stored.set(k, v), removeItem: (k: string) => void stored.delete(k) };
  return (await loadSettings()).game.drops;
}

/** Loads `drops`, takes in a read of what is held (2 Barrels, 1 Receiver), then one with a Barrel more. */
async function throughTwoReads(drops: unknown) {
  const loaded = await loadDrops(drops);
  const first = nextRead(loaded, model(2, 1), T + DAY);
  const second = nextRead(first, model(3, 1), T + 2 * DAY);
  const gainsAt = (log: DropLog, at: number) => log.windows.find((w) => w.at === at)?.gains ?? null;
  return { loaded, first, second, firstGains: gainsAt(first, T + DAY), secondGains: gainsAt(second, T + 2 * DAY) };
}

const unreadable: [string, unknown][] = [
  ["counts missing", { at: T, windows: [EARLIER] }],
  ["counts null", { at: T, counts: null, windows: [EARLIER] }],
  ["counts a string", { at: T, counts: "x", windows: [EARLIER] }],
  ["counts a list", { at: T, counts: [2, 1], windows: [EARLIER] }],
  ["one count a string", { at: T, counts: { "Lato Vandal Barrel": 2, "Lato Vandal Receiver": "1" }, windows: [EARLIER] }],
  ["one count null", { at: T, counts: { "Lato Vandal Barrel": 2, "Lato Vandal Receiver": null }, windows: [EARLIER] }],
  ["one count below zero", { at: T, counts: { "Lato Vandal Barrel": 2, "Lato Vandal Receiver": -5 }, windows: [EARLIER] }],
  ["one count a fraction", { at: T, counts: { "Lato Vandal Barrel": 2, "Lato Vandal Receiver": 0.5 }, windows: [EARLIER] }],
  ["one foundry count odd", { at: T, counts: { "Lato Vandal Barrel": 1, "Lato Vandal Receiver": 1 }, windows: [EARLIER], building: { "Lato Vandal Barrel": 1, "Lato Vandal Receiver": "x" } }],
  ["the foundry counts not an object", { at: T, counts: { "Lato Vandal Barrel": 2, "Lato Vandal Receiver": 1 }, windows: [EARLIER], building: 5 }],
];
for (const [what, drops] of unreadable) {
  test(`drops log read back with ${what}: a new baseline, no held copy logged as a drop, the drops already logged kept`, async () => {
    const r = await throughTwoReads(drops);
    assert.equal(r.loaded.at, 0, "the log starts again");
    assert.deepEqual(r.loaded.windows, [EARLIER], "the drops logged before stay");
    assert.equal(r.firstGains, null, "the read after loading logs no drop");
    assert.deepEqual(r.first.counts, { "Lato Vandal Barrel": 2, "Lato Vandal Receiver": 1 }, "it is the baseline");
    assert.deepEqual(r.secondGains, { "Lato Vandal Barrel": 1 }, "the read after that counts as usual");
    // What the pages and Save for sets read: the earlier drop and the new one, no held Receiver.
    const totals = recentDrops(r.first, [], T + DAY);
    assert.deepEqual([...totals], [["Lato Vandal Barrel", 1]]);
    assert.equal(saveSource(model(2, 1), "Lato Vandal Receiver", totals), null, "a held Receiver is no reason to save for the set");
  });
}

test("drops log read back with no drops logged and counts unreadable: the next read is the first, nothing counted", async () => {
  const r = await throughTwoReads({ at: T, counts: { "Lato Vandal Receiver": "x" }, windows: [] });
  assert.deepEqual({ loaded: r.loaded, first: r.firstGains }, { loaded: emptyDropLog(), first: null });
  assert.deepEqual([...recentDrops(r.first, [], T + DAY)], []);
});

test("drops log read back with its windows not a list: the history is lost, the counts kept, no false drop", async () => {
  const r = await throughTwoReads({ at: T, counts: { "Lato Vandal Barrel": 2, "Lato Vandal Receiver": 1 }, windows: "x" });
  assert.deepEqual(r.loaded, { at: T, counts: { "Lato Vandal Barrel": 2, "Lato Vandal Receiver": 1 }, windows: [] });
  assert.equal(r.firstGains, null);
  assert.deepEqual(r.secondGains, { "Lato Vandal Barrel": 1 });
});

test("a drops log the app wrote itself reads back exactly as saved, and the next read counts from it as before", async () => {
  // Built by the app's own steps: a baseline, a drop, a read missing the Receiver (gone), a low read
  // (lowAt), with a Barrel in the foundry (building), saved, loaded and saved again.
  let log = nextRead(emptyDropLog(), model(1, 1), T - 3 * DAY);
  log = nextRead(log, model(2, 1), T - 2 * DAY);
  log = recordRead(log, { "Lato Vandal Barrel": 2 }, T - DAY, T - DAY, { "Lato Vandal Barrel": 1 }, [], dropRecounted(model(0, 0)))!;
  const own = { ...recordRead(log, {}, T, T)!, lowAt: T };
  assert.ok(own.gone?.length && own.building && own.tracks && own.windows.length, `every part of the log is there: ${JSON.stringify(own)}`);
  const stored = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => void stored.set(k, v), removeItem: (k: string) => void stored.delete(k) };
  const file = defaultSettings();
  file.game.drops = own;
  stored.set("orbiter-settings", JSON.stringify(file));
  const loaded = await loadSettings();
  assert.deepEqual(loaded.game.drops, own);
  saveSettings(loaded);
  await flushSettings();
  const again = (await loadSettings()).game.drops;
  assert.deepEqual(again, own);
  assert.deepEqual(nextRead(again, model(3, 1), T + DAY), nextRead(own, model(3, 1), T + DAY), "the next read reads it as the log in memory");
  // Empty counts with a time are the app's own too (everything sold, the low read believed).
  const empty = await loadDrops({ at: T, counts: {}, windows: [EARLIER] });
  assert.deepEqual(empty, { at: T, counts: {}, windows: [EARLIER] });
  assert.deepEqual(nextRead(empty, model(1, 0), T + DAY).windows.at(-1)?.gains, { "Lato Vandal Barrel": 1 }, "a part come in since counts, as on main");
});
