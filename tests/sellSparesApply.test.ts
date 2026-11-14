// Sell spares' sending loop (marketStore.svelte.ts › planBulk, applyBulk), held by what it sends
// to a stand-in warframe.market: an old or changed plan sends nothing and the new plan is shown, a
// fresh one sends each line once, a line under its minimum is held back while the others go,
// refusals in a row stop the run, and after a stop nothing is listed twice.
// Every market call is replaced; nothing reaches the network.
import "./support/runes";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { market, defaultMarketSettings, defaultAdvice, type MarketSettings } from "../src/lib/backend";
import type { MarketItem, MyOrder } from "../src/lib/core/market";
import { buildModel, type Model } from "../src/lib/core/model";

const { mkt } = await import("../src/lib/marketStore.svelte");

const me = { id: "me", ingameName: "ExamplePlayer", platform: "pc", crossplay: true } as never;
const real = { ...market };
const MODS = ["Alpha", "Bravo", "Charlie", "Delta", "Echo"] as const;
const items: MarketItem[] = MODS.map((n) => ({ id: n.toLowerCase(), slug: `example_${n.toLowerCase()}`, gameRef: `/Example/Mods/${n}`, name: `Example ${n}`, maxRank: 5, subtypes: null, tags: ["mod"] }));

/** An inventory read a minute ago: `held` copies of each mod (unranked), and a mastered weapon. */
function model(held: Partial<Record<(typeof MODS)[number], number>>): Model {
  const row = (item_id: string, name: string, category: string, quantity: number, mastered = false) => ({ item_id, name, category, quantity, mastered, image_name: null, rank: null, max_rank: null });
  return buildModel({
    observed_at: Math.floor(Date.now() / 1000) - 60,
    inventory: [...MODS.filter((n) => held[n]).map((n) => row(`/Example/Mods/${n}`, `Example ${n}`, "mod", held[n]!)), row("/Example/Weapon", "Example Rifle", "weapon", 1, true)],
    catalog: [...MODS.map((n) => ({ uniqueName: `/Example/Mods/${n}`, name: `Example ${n}`, category: "Mods", maxRank: 5 })), { uniqueName: "/Example/Weapon", name: "Example Rifle", category: "Primary", masterable: true }],
    relics: [],
    prices: { prices: Object.fromEntries(MODS.map((n) => [`Example ${n}`, 20])), trade_rate: Object.fromEntries(MODS.map((n) => [`Example ${n}`, [5, 0, ""]])) },
  } as never);
}

const sellers = (platinum: number) => [0, 1, 2].map((i) => ({ id: `b${i}`, type: "sell", platinum, quantity: 1, rank: 0, subtype: null, visible: true, user: { id: `u${i}`, ingameName: `Tenno_${i}`, status: "ingame", platform: "pc", crossplay: true } }));

/** The stand-in warframe.market: your listings as it holds them (each change applied), and every write, in order. */
function standIn(books: Record<string, number>, listings: MyOrder[] = []) {
  const state = {
    listings: listings.map((o) => ({ ...o })),
    writes: [] as string[],
    reads: 0,
    /** Called before each write; throw to refuse it. */
    before: null as ((what: string, n: number) => void) | null,
  };
  let next = 0;
  const write = (what: string) => {
    state.before?.(what, state.writes.length);
    state.writes.push(what);
  };
  market.items = async () => items;
  market.myOrders = async () => state.listings.map((o) => ({ ...o }));
  market.book = (async (slug: string) => {
    state.reads++;
    return sellers(books[slug] ?? 20);
  }) as never;
  market.create = (async (c: { itemId: string; platinum: number; quantity: number; rank: number | null }) => {
    write(`create ${c.itemId} ${c.quantity}x${c.platinum}`);
    const o: MyOrder = { id: `new${next++}`, itemId: c.itemId, type: "sell", platinum: c.platinum, quantity: c.quantity, rank: c.rank, subtype: null, visible: true, updatedAt: null };
    state.listings.push(o);
    return o;
  }) as never;
  market.update = (async (id: string, c: { quantity?: number; platinum?: number }) => {
    write(`update ${id} ${c.quantity}x${c.platinum}`);
    state.listings = state.listings.map((o) => (o.id === id ? { ...o, quantity: c.quantity ?? o.quantity, platinum: c.platinum ?? o.platinum } : o));
    return {} as never;
  }) as never;
  market.remove = (async (id: string) => {
    write(`remove ${id}`);
    state.listings = state.listings.filter((o) => o.id !== id);
  }) as never;
  return state;
}

const settings = (extra: Partial<MarketSettings> = {}): MarketSettings => ({ ...defaultMarketSettings(), minPrice: 1, minShare: 0, ...extra });
const advice = { ...defaultAdvice(), platPerDucat: 0 };
/** What a plan would send, as the stand-in writes it down. */
const lines = () =>
  (mkt.bulk?.actions ?? [])
    .map((a) => (a.type === "create" ? `create ${a.item.id} ${a.quantity}x${a.platinum}` : a.type === "update" ? `update ${a.order.id} ${a.quantity}x${a.platinum}` : a.type === "remove" ? `remove ${a.order.id}` : null))
    .filter((x): x is string => !!x);

beforeEach(() => {
  Object.assign(market, real);
  mkt.account = { linked: true, backing: "keyring", profile: me, error: null };
  mkt.items = [];
  mkt.orders = [];
  mkt.books = {};
  mkt.log = [];
  mkt.op = null;
  mkt.pass = null;
  mkt.error = null;
  mkt.bulk = null;
  mkt.applying = null;
  mkt.advice = null;
  mkt.rules = null;
  mkt.model = null;
  mkt.fullMode = null;
});

/** The plan's books and the plan itself made `minutes` older, as if it had been shown that long ago. */
function age(minutes: number) {
  const ms = minutes * 60_000;
  mkt.books = Object.fromEntries(Object.entries(mkt.books).map(([k, v]) => [k, { ...v, at: v.at - ms }]));
  mkt.bulk = { ...mkt.bulk!, at: mkt.bulk!.at - ms };
}
const listed = (id: string, itemId: string, quantity: number, platinum = 40): MyOrder => ({ id, itemId, type: "sell", platinum, quantity, rank: 0, subtype: null, visible: true, updatedAt: null });

test("a plan over 10 minutes old sends nothing: its prices are read again and the new plan is shown", async () => {
  const m = model({ Alpha: 5, Bravo: 4 });
  const s = settings();
  const books: Record<string, number> = {};
  const st = standIn(books);
  assert.equal(await mkt.planBulk(m, s, advice), true);
  assert.deepEqual(lines(), ["create alpha 3x20", "create bravo 2x20"]);
  age(11);
  const oldAt = mkt.bulk!.at;
  const reads = st.reads;
  books.example_alpha = 24;
  books.example_bravo = 24;
  const r = await mkt.applyBulk(m, s, advice);
  assert.equal(r?.outcome, "replanned");
  assert.deepEqual(st.writes, [], "nothing sent");
  assert.ok(st.reads > reads, "the prices were read again");
  assert.ok(mkt.bulk && mkt.bulk.at > oldAt, "a new plan is shown");
  assert.deepEqual(lines(), ["create alpha 3x24", "create bravo 2x24"], "priced from the books read now");
});

test("a plan whose inventory changed since (one spare fewer) sends nothing and the new plan is shown", async () => {
  const s = settings();
  const st = standIn({});
  assert.equal(await mkt.planBulk(model({ Alpha: 5, Bravo: 4 }), s, advice), true);
  assert.deepEqual(lines(), ["create alpha 3x20", "create bravo 2x20"]);
  // One Alpha traded away since the plan was shown.
  const r = await mkt.applyBulk(model({ Alpha: 4, Bravo: 4 }), s, advice);
  assert.equal(r?.outcome, "changed");
  assert.deepEqual(st.writes, [], "nothing sent");
  assert.deepEqual(lines(), ["create alpha 2x20", "create bravo 2x20"], "the new plan is shown");
});

test("a fresh, unchanged plan sends every line once", async () => {
  const m = model({ Alpha: 5, Bravo: 4, Charlie: 4 });
  const s = settings();
  const st = standIn({ example_charlie: 30 }, [listed("la", "alpha", 3)]);
  assert.equal(await mkt.planBulk(m, s, advice), true);
  const planned = lines();
  assert.deepEqual(planned, ["update la 3x20", "create bravo 2x20", "create charlie 2x30"]);
  const r = await mkt.applyBulk(m, s, advice);
  assert.equal(r?.outcome, "done");
  assert.deepEqual(st.writes, planned, "each line once, in the plan's order");
  assert.equal(mkt.bulk, null, "the plan is done with");
});

test("a line under its minimum is not sent and the others are", async () => {
  const m = model({ Alpha: 5, Bravo: 4, Charlie: 4 });
  const s = settings();
  const st = standIn({ example_charlie: 30 }, [listed("la", "alpha", 3), listed("lb", "bravo", 2)]);
  assert.equal(await mkt.planBulk(m, s, advice), true);
  assert.deepEqual(lines(), ["update la 3x20", "update lb 2x20", "create charlie 2x30"]);
  // The minimum is raised to 25p in Settings while the plan is being applied, after the first change.
  st.before = () => {
    s.minPrice = 25;
  };
  const r = await mkt.applyBulk(m, s, advice);
  assert.equal(r?.outcome, "done");
  assert.deepEqual(st.writes, ["update la 3x20", "create charlie 2x30"], "the 20p one under the new minimum isn't sent; the 30p one is");
  assert.deepEqual([r?.sent, r?.failed], [2, 1]);
});

test("a line under its ducats is not sent and the others are", async () => {
  // Two prime parts of 45 ducats each, spare (the frame is mastered), and a spare mod: each listed
  // at 40p, each repriced to the market's 20p.
  const parts = ["Systems", "Neuroptics"].map((p) => ({ id: p.toLowerCase(), slug: `example_prime_${p.toLowerCase()}_blueprint`, gameRef: `/Example/Prime/${p}`, name: `Example Prime ${p} Blueprint`, maxRank: null, subtypes: null, tags: ["prime", "component", "blueprint"] }));
  items.push(...parts);
  try {
    const row = (item_id: string, name: string, category: string, quantity: number, mastered = false) => ({ item_id, name, category, quantity, mastered, image_name: null, rank: null, max_rank: null });
    const m = buildModel({
      observed_at: Math.floor(Date.now() / 1000) - 60,
      inventory: [row("/Example/Mods/Alpha", "Example Alpha", "mod", 5), ...parts.map((p) => row(p.gameRef, p.name, "prime_part", 3)), row("/Example/Prime", "Example Prime", "warframe", 1, true)],
      catalog: [
        { uniqueName: "/Example/Mods/Alpha", name: "Example Alpha", category: "Mods", maxRank: 5 },
        { uniqueName: "/Example/Prime", name: "Example Prime", category: "Warframes", masterable: true, isPrime: true, components: [{ uniqueName: "/Example/Prime/Systems", name: "Systems", ducats: 45, itemCount: 1 }, { uniqueName: "/Example/Prime/Neuroptics", name: "Neuroptics", ducats: 45, itemCount: 1 }] },
      ],
      relics: [],
      prices: { prices: { "Example Alpha": 20, ...Object.fromEntries(parts.map((p) => [p.name, 20])) }, trade_rate: { "Example Alpha": [5, 0, ""], ...Object.fromEntries(parts.map((p) => [p.name, [5, 0, ""]])) } },
    } as never);
    const s = settings();
    s.spares = { ...s.spares, prime: { ...s.spares.prime, sellAs: "parts" } };
    const adv = { ...advice };
    const st = standIn({}, [listed("la", "alpha", 3), { ...listed("ls", "systems", 3), rank: null }, { ...listed("ln", "neuroptics", 3), rank: null }]);
    assert.equal(await mkt.planBulk(m, s, adv), true);
    const planned = lines();
    assert.deepEqual(planned, ["update ls 3x20", "update ln 3x20", "update la 3x20"]);
    // After the first change, a ducat counts for 0.5p (45 ducats: 22.5p, so a part needs 27p or more).
    st.before = () => {
      adv.platPerDucat = 0.5;
    };
    const r = await mkt.applyBulk(m, s, adv);
    assert.equal(r?.outcome, "done");
    assert.deepEqual(st.writes, ["update ls 3x20", "update la 3x20"], "the second part, under its ducats now, isn't sent; the mod is");
    assert.deepEqual([r?.sent, r?.failed], [2, 1]);
  } finally {
    items.splice(-parts.length);
  }
});

test("refusals in a row stop the run: three tries, no fourth", async () => {
  const m = model({ Alpha: 5, Bravo: 4, Charlie: 4, Delta: 4, Echo: 4 });
  const s = settings();
  const st = standIn({});
  assert.equal(await mkt.planBulk(m, s, advice), true);
  assert.equal(lines().length, 5);
  let tried = 0;
  st.before = () => {
    tried++;
    throw new Error("warframe.market answered 503");
  };
  const r = await mkt.applyBulk(m, s, advice);
  assert.equal(tried, 3, "stopped after three refusals in a row");
  assert.deepEqual(st.writes, []);
  assert.equal(r?.sent, 0);
});

test("after a stop part way, the plan left holds only the lines not sent, and a second Apply lists nothing twice", async () => {
  const m = model({ Alpha: 5, Bravo: 4, Charlie: 4 });
  const s = settings();
  const st = standIn({});
  assert.equal(await mkt.planBulk(m, s, advice), true);
  assert.deepEqual(lines(), ["create alpha 3x20", "create bravo 2x20", "create charlie 2x20"]);
  // The sign-in runs out after the first listing went up.
  st.before = (_what, n) => {
    if (n === 1) throw new Error("Not signed in to warframe.market");
  };
  const r = await mkt.applyBulk(m, s, advice);
  assert.equal(r?.outcome, "stopped");
  assert.deepEqual(st.writes, ["create alpha 3x20"]);
  assert.deepEqual(lines(), ["create bravo 2x20", "create charlie 2x20"], "only what wasn't sent is left");
  st.before = null;
  const again = await mkt.applyBulk(m, s, advice);
  assert.equal(again?.outcome, "done");
  assert.deepEqual(st.writes, ["create alpha 3x20", "create bravo 2x20", "create charlie 2x20"], "each listed once");
});

test("after refusals in a row stop the run, the plan left holds the lines not sent, refused ones included, and a second Apply lists nothing twice", async () => {
  const m = model({ Alpha: 5, Bravo: 4, Charlie: 4, Delta: 4, Echo: 4 });
  const s = settings();
  const st = standIn({});
  assert.equal(await mkt.planBulk(m, s, advice), true);
  assert.deepEqual(lines(), ["create alpha 3x20", "create bravo 2x20", "create charlie 2x20", "create delta 2x20", "create echo 2x20"]);
  // The first listing goes up, then warframe.market refuses three in a row.
  let tried = 0;
  st.before = () => {
    if (++tried > 1) throw new Error("warframe.market answered 503");
  };
  const r = await mkt.applyBulk(m, s, advice);
  assert.equal(r?.outcome, "stopped");
  assert.equal(tried, 4, "the first sent, then three refusals, and no fifth try");
  assert.deepEqual(st.writes, ["create alpha 3x20"]);
  assert.deepEqual(lines(), ["create bravo 2x20", "create charlie 2x20", "create delta 2x20", "create echo 2x20"], "the refused lines and the one never tried are left");
  assert.deepEqual(mkt.orders.map((o) => o.itemId), ["alpha"], "the listings are read again after the stop: what went up is counted");
  st.before = null;
  const again = await mkt.applyBulk(m, s, advice);
  assert.equal(again?.outcome, "done");
  assert.deepEqual(st.writes, ["create alpha 3x20", "create bravo 2x20", "create charlie 2x20", "create delta 2x20", "create echo 2x20"], "each listed once");
});
