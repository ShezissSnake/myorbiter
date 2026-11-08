// The warframe.market and riven stores over a long session: reads that race a sale, outages,
// and caches that would otherwise grow for hours.
import { settle } from "./support/runes";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { market, presence, defaultMarketSettings } from "../src/lib/backend";
import type { MyOrder } from "../src/lib/core/market";
import type { Model } from "../src/lib/core/model";

const { mkt } = await import("../src/lib/marketStore.svelte");
const { rivens } = await import("../src/lib/rivenStore.svelte");

const order = (id: string, quantity = 1, platinum = 20): MyOrder => ({ id, itemId: "it", type: "sell", platinum, quantity, rank: null, subtype: null, visible: true, updatedAt: null });
const me = { id: "me", ingameName: "Me", platform: "pc", crossplay: true } as never;
const real = { ...market };
const model = {} as Model;

beforeEach(() => {
  Object.assign(market, real);
  mkt.account = { linked: true, backing: "keyring", profile: me, error: null };
  mkt.orders = [];
  mkt.ordersAt = null;
  mkt.passFailures = 0;
  mkt.lastPass = null;
  mkt.log = [];
  mkt.op = null;
  mkt.pass = null;
});

test("a read of your listings that started before a sale doesn't bring the sold listing back", async () => {
  mkt.orders = [order("a"), order("b")];
  let answer!: (o: MyOrder[]) => void;
  market.myOrders = () => new Promise((r) => (answer = r));
  market.close = async () => {};
  const reading = mkt.refresh();
  // The trade closes listing "a" while the read is on its way, with the old list.
  await mkt.sold(mkt.orders[0], 1);
  answer([order("a"), order("b")]);
  await reading;
  assert.deepEqual(mkt.orders.map((o) => o.id), ["b"], "still sold");
  // The next read is taken as it comes.
  market.myOrders = async () => [order("b"), order("c")];
  await mkt.refresh();
  assert.deepEqual(mkt.orders.map((o) => o.id), ["b", "c"]);
});

test("listings count as read only once warframe.market answered; signing out forgets that", async () => {
  assert.equal(mkt.ordersAt, null);
  market.myOrders = async () => {
    throw new Error("Couldn't reach warframe.market");
  };
  await assert.rejects(mkt.refresh());
  assert.equal(mkt.ordersAt, null, "a failed read isn't a read");
  market.myOrders = async () => [order("a")];
  await mkt.refresh();
  assert.ok(mkt.ordersAt);
  market.signOut = async () => {};
  market.account = async () => ({ linked: false, backing: "keyring", profile: null, error: null });
  await mkt.signOut();
  assert.equal(mkt.ordersAt, null);
});

test("Auto-match backs off while warframe.market doesn't answer, and says so once", async () => {
  const s = defaultMarketSettings();
  market.items = async () => [{ id: "it", slug: "it", gameRef: "/it", name: "It", maxRank: null, subtypes: null, tags: [] }];
  market.myOrders = async () => {
    throw new Error("Couldn't reach warframe.market (timed out)");
  };
  for (let i = 0; i < 3; i++) await mkt.reprice(model, s, true);
  assert.equal(mkt.passFailures, 3);
  assert.deepEqual(mkt.log.map((l) => l.tone).reverse(), ["warn", "info", "info"], "one warning (one notification), not one per pass");
  assert.equal(mkt.passDelay(5 * 60_000), 40 * 60_000, "5 minutes, doubled three times");
  assert.equal(mkt.passDelay(5 * 60_000) <= 60 * 60_000, true);
  market.myOrders = async () => [];
  await mkt.reprice(model, s, true);
  assert.equal(mkt.passFailures, 0);
  assert.ok(mkt.log.some((l) => /answering again/.test(l.text)));
  assert.equal(mkt.passDelay(5 * 60_000), 5 * 60_000);
});

test("a refused sign-in stops the passes and forgets the listings read", async () => {
  mkt.ordersAt = 1;
  market.items = async () => [{ id: "it", slug: "it", gameRef: "/it", name: "It", maxRank: null, subtypes: null, tags: [] }];
  market.myOrders = async () => {
    throw new Error("warframe.market refused the sign-in");
  };
  await mkt.reprice(model, defaultMarketSettings(), true);
  assert.equal(mkt.linked, false);
  assert.equal(mkt.ordersAt, null);
  assert.equal(mkt.passFailures, 0, "not an outage: no back-off");
});

test("after an outage the account is tried again after 1, 2, 4… minutes, not every minute", async () => {
  let tries = 0;
  market.account = async () => {
    tries++;
    return { linked: true, backing: "keyring", profile: null, error: "Couldn't reach warframe.market" };
  };
  market.items = async () => [];
  mkt.account = { linked: true, backing: "keyring", profile: null, error: "offline" };
  const t0 = 10_000_000;
  for (let m = 0; m <= 8; m++) await mkt.retryIfDisconnected(t0 + m * 60_000);
  // Minutes 0, 2, 6: one, then two and four minutes apart.
  assert.equal(tries, 3);
  market.account = async () => ({ linked: true, backing: "keyring", profile: me, error: null });
  market.myOrders = async () => [];
  await mkt.retryIfDisconnected(t0 + 30 * 60_000);
  assert.equal(mkt.linked, true);
});

test("a deals scan stops asking once warframe.market stops answering", async () => {
  let asked = 0;
  market.items = async () => Array.from({ length: 10 }, (_, i) => ({ id: `i${i}`, slug: `s${i}`, gameRef: `/g${i}`, name: `Thing ${i}`, maxRank: null, subtypes: null, tags: [] }));
  mkt.items = [];
  market.book = async () => {
    asked++;
    throw new Error("timed out");
  };
  const watch = Array.from({ length: 10 }, (_, i) => ({ name: `Thing ${i}` })) as never;
  await mkt.scanDeals({} as Model, watch).catch(() => {});
  assert.equal(asked, 3, "three failures in a row, then it waits for the next scan");
});

test("riven searches older than half an hour are dropped from the cache", async () => {
  let now = 1_000_000;
  const realNow = Date.now;
  Date.now = () => now;
  try {
    market.rivenAuctions = async () => [];
    await rivens.search("braton", ["a"], null);
    now += 31 * 60_000;
    await rivens.search("lato", ["b"], null);
    assert.deepEqual(Object.keys(rivens.results), ["lato|b|"]);
  } finally {
    Date.now = realNow;
  }
  await settle();
});

test("the same warning notifies once an hour; the Activity log still has every one", () => {
  mkt.note("Thing: couldn't update (timed out)", "warn");
  mkt.note("Thing: couldn't update (timed out)", "warn");
  mkt.note("Other: couldn't update (timed out)", "warn");
  assert.deepEqual(mkt.log.map((l) => [l.tone, !!l.quiet]).reverse(), [["warn", false], ["warn", true], ["warn", false]]);
});

test("a Sold that fails can leave telling you to the caller", async () => {
  mkt.orders = [order("q", 2)];
  market.close = async () => {
    throw new Error("timed out");
  };
  assert.equal(await mkt.sold(mkt.orders[0], 1, { quiet: true }), null);
  assert.equal(mkt.log[0].tone, "warn");
  assert.equal(mkt.log[0].quiet, true, "logged, not notified: the trade's own notification says it");
  assert.deepEqual(mkt.orders.map((o) => o.quantity), [2], "put back");
});

test("stepping through the status switch sends only where you stop", async () => {
  const sent: string[] = [];
  const realSet = presence.set;
  presence.set = async (st) => {
    sent.push(st);
    return { wanted: st === "offline" ? null : st, committed: st === "offline" ? null : st, connected: true, error: null } as never;
  };
  try {
    void mkt.setStatus("invisible");
    void mkt.setStatus("online");
    assert.equal(mkt.statusAsked, "online", "the switch shows the choice at once");
    await mkt.setStatus("ingame");
    assert.deepEqual(sent, ["ingame"]);
    assert.equal(mkt.status?.committed, "ingame");
  } finally {
    presence.set = realSet;
  }
});

test("Reload says how it went: listings counted, or the error on screen", async () => {
  market.myOrders = async () => [order("a"), order("b")];
  await mkt.reload();
  assert.match(mkt.log[0].text, /reloaded from warframe.market: 2/);
  market.myOrders = async () => {
    throw new Error("Couldn't reach warframe.market (timed out)");
  };
  await mkt.reload();
  assert.match(mkt.error ?? "", /Couldn't reach/);
  assert.equal(mkt.op, null);
});

test("the listing form drops the old price when you pick another rank", async () => {
  mkt.items = [{ id: "ser", slug: "serration", gameRef: "/M/Serration", name: "Serration", maxRank: 10, subtypes: null, tags: ["mod"] }];
  market.book = async () => [{ id: "b", type: "sell", platinum: 20, quantity: 1, rank: 0, subtype: null, visible: true, user: { id: "u", ingameName: "U", status: "ingame", platform: "pc", crossplay: true } }];
  const held = { inventoryByBase: new Map([["/M/Serration", [{ rank: 0, quantity: 3 }]]]), partByName: new Map(), inventoryByName: new Map(), catalogByUnique: new Map(), catalogNames: new Set() } as unknown as Model;
  await mkt.startListing(held, "Serration");
  assert.equal(mkt.draft?.platinum, 20);
  mkt.draft!.rank = 10;
  await mkt.retarget();
  assert.equal(mkt.draft?.platinum, null, "nobody sells R10 in game: the price is yours to set");
  assert.equal(mkt.draft?.available, 0);
  mkt.closeDraft();
});


test("a pass counts its progress through the listings, read or not, and says how it went", async () => {
  const s = defaultMarketSettings();
  const items = ["a", "b", "c", "d"].map((id) => ({ id, slug: id, gameRef: `/${id}`, name: id.toUpperCase(), maxRank: null, subtypes: null, tags: [] }));
  market.items = async () => items;
  mkt.items = items;
  const mine = [order("a"), order("b"), { ...order("c"), itemId: "c" }, { ...order("d"), itemId: "d", visible: false }].map((o) => ({ ...o, itemId: o.id }));
  market.myOrders = async () => mine;
  const seen: (string | null)[] = [];
  market.book = async (slug: string) => {
    seen.push(mkt.passProgress ? `${mkt.passProgress.done}/${mkt.passProgress.total}` : null);
    if (slug === "b") throw new Error("timed out");
    return [];
  };
  const planFor = mkt.planFor;
  mkt.planFor = () => null;
  try {
    mkt.books = {};
    const r = await mkt.reprice(model, s, false);
    assert.deepEqual(seen, ["0/3", "1/3", "2/3"], "the hidden listing isn't counted");
    assert.equal(mkt.passProgress, null, "cleared once over");
    assert.equal(mkt.passManual, false);
    assert.equal(r?.failed, 1);
    assert.equal(r?.off, 0);
    assert.equal(r?.error, null);
  } finally {
    mkt.planFor = planFor;
  }
});

test("a pass by hand is marked as one, so its notification needn't pop up while it runs", async () => {
  market.items = async () => [{ id: "it", slug: "it", gameRef: "/it", name: "It", maxRank: null, subtypes: null, tags: [] }];
  let during: boolean | null = null;
  market.myOrders = async () => {
    during = mkt.passManual;
    return [];
  };
  await mkt.reprice(model, defaultMarketSettings(), false);
  assert.equal(during, true);
  await mkt.reprice(model, defaultMarketSettings(), false, true);
  assert.equal(during, false, "the timer's own pass");
});

test("a sale warframe.market refuses comes back, and the reason is handed to whoever asked", async () => {
  mkt.orders = [order("a", 2)];
  market.close = async () => {
    throw new Error("503 Service Unavailable");
  };
  let why: string | null = null;
  const sale = await mkt.sold(mkt.orders[0], 2, { failed: (r) => (why = r) });
  assert.equal(sale, null);
  assert.equal(why, "503 Service Unavailable");
  assert.deepEqual(mkt.orders.map((o) => o.quantity), [2], "the listing is back as it was");
});

/** A recent read holding five unranked Serration (three spare) and a Requiem mod with a Kuva weapon left. */
async function spareModel(serrations = 5): Promise<Model> {
  const { buildModel } = await import("../src/lib/core/model");
  const row = (item_id: string, name: string, category: string, quantity: number, mastered = false) => ({ item_id, name, category, quantity, mastered, image_name: null, rank: null, max_rank: null });
  return buildModel({
    observed_at: Math.floor(Date.now() / 1000) - 60,
    inventory: [row("/M/Serration", "Serration", "mod", serrations), row("/Lotus/Upgrades/Mods/Immortal/ImmortalEightMod", "Khra", "mod", 4), row("/W/Braton", "Braton", "weapon", 1, true)],
    catalog: [
      { uniqueName: "/M/Serration", name: "Serration", category: "Mods", maxRank: 10 },
      { uniqueName: "/Lotus/Upgrades/Mods/Immortal/ImmortalEightMod", name: "Khra", category: "Mods", maxRank: 3 },
      { uniqueName: "/W/Braton", name: "Braton", category: "Primary", masterable: true },
      { uniqueName: "/W/KuvaBramma", name: "Kuva Bramma", category: "Primary", masterable: true },
    ],
    relics: [],
    prices: { prices: { Serration: 12, Khra: 9 }, trade_rate: { Serration: [5, 0, ""], Khra: [40, 0, ""] } },
  } as never);
}
const spareItems = [
  { id: "it", slug: "serration", gameRef: "/M/Serration", name: "Serration", maxRank: 10, subtypes: null, tags: ["mod"] },
  { id: "khra", slug: "khra", gameRef: "/Lotus/Upgrades/Mods/Immortal/ImmortalEightMod", name: "Khra", maxRank: 3, subtypes: null, tags: ["mod"] },
];

test("Show all hidden goes one by one, says how far it got, and returns how many were shown", async () => {
  mkt.items = spareItems;
  mkt.model = await spareModel();
  mkt.orders = [{ ...order("a"), rank: 0, visible: false }, { ...order("b"), rank: 0, visible: false }];
  market.update = async (id: string) => {
    if (id === "b") throw new Error("refused");
  };
  market.myOrders = async () => mkt.orders;
  const steps: string[] = [];
  const n = await mkt.showHidden(mkt.orders, (d, t) => steps.push(`${d}/${t}`));
  assert.equal(n, 1);
  assert.deepEqual(steps, ["1/2", "2/2"]);
  assert.equal(mkt.op, null);
  mkt.model = null;
});

test("a hidden listing of copies the keep rules hold back isn't shown again, and says why", async () => {
  mkt.items = spareItems;
  mkt.model = await spareModel();
  mkt.orders = [{ ...order("k", 2), itemId: "khra", rank: 0, visible: false }];
  const sent: string[] = [];
  market.update = async (id: string) => {
    sent.push(id);
  };
  market.myOrders = async () => mkt.orders;
  assert.equal(await mkt.showHidden(mkt.orders), 0);
  assert.deepEqual(sent, [], "nothing sent to warframe.market");
  assert.match(mkt.log.find((l) => l.tone === "warn")?.text ?? "", /^Didn't list Khra R0: Requiem mods are kept while Kuva and Tenet weapons are left to master/);
  // Without a collection loaded nothing is shown either.
  mkt.model = null;
  mkt.orders = [{ ...order("s"), rank: 0, visible: false }];
  assert.equal(await mkt.showHidden(mkt.orders), 0);
  assert.deepEqual(sent, []);
});

test("raising a listing past what's spare is refused before it's sent", async () => {
  mkt.items = spareItems;
  mkt.model = await spareModel();
  mkt.orders = [{ ...order("s", 2), rank: 0 }];
  const sent: unknown[] = [];
  market.update = async (_id: string, change: unknown) => {
    sent.push(change);
  };
  market.myOrders = async () => mkt.orders;
  assert.equal(await mkt.update(mkt.orders[0], { quantity: 4 }), false);
  assert.match(mkt.error ?? "", /^Didn't list Serration R0: Only 3 can go/);
  assert.equal(await mkt.update(mkt.orders[0], { quantity: 3 }), true);
  assert.deepEqual(sent, [{ quantity: 3 }]);
  mkt.model = null;
});

test("Sell spares: nothing is sent when your listings can't be read first, so the cap isn't counted from an old list", async () => {
  const s = defaultMarketSettings();
  const it = { id: "it", slug: "it", gameRef: "/it", name: "It", maxRank: null, subtypes: null, tags: [] };
  mkt.bulk = {
    actions: [{ type: "create", kind: "other", item: it, rank: null, subtype: null, quantity: 1, platinum: 20, why: "spare", priceWhy: "median" }],
    at: Date.now(),
    books: {},
    skipped: new Set(),
  } as never;
  let sent = 0;
  market.create = async () => {
    sent++;
    return order("new");
  };
  market.myOrders = async () => {
    throw new Error("Couldn't reach warframe.market (timed out)");
  };
  const { defaultAdvice } = await import("../src/lib/backend");
  await mkt.applyBulk(model, s, defaultAdvice());
  assert.equal(sent, 0);
  assert.match(mkt.errorOf("Updating your listings") ?? "", /^Nothing changed: your listings couldn't be read first/);
  mkt.bulk = null;
});

test("Sold twice from the same copy of a listing closes no more than is listed", async () => {
  mkt.orders = [order("a", 2)];
  const closes: number[] = [];
  market.close = async (_id: string, n: number) => {
    closes.push(n);
  };
  const stale = mkt.orders[0];
  assert.ok(await mkt.sold(stale, 1));
  // The second sale is clamped to the one copy still listed, from the listing as it is now.
  const second = await mkt.sold(stale, 2);
  assert.equal(second?.quantity, 1);
  assert.deepEqual(closes, [1, 1]);
  assert.deepEqual(mkt.orders, []);
  // A third finds nothing listed and sends nothing.
  let why = "";
  assert.equal(await mkt.sold(stale, 1, { failed: (r) => (why = r) }), null);
  assert.deepEqual(closes, [1, 1]);
  assert.match(why, /no longer listed/);
});

test("a sale that fails puts back only its own copies, not a listing another sale closed meanwhile", async () => {
  mkt.orders = [order("a", 3), order("b")];
  let failA!: (e: Error) => void;
  market.close = ((id: string) => (id === "a" ? new Promise((_, rej) => (failA = rej)) : Promise.resolve())) as never;
  const pending = mkt.sold(mkt.orders[0], 2);
  assert.ok(await mkt.sold(mkt.orders.find((x) => x.id === "b")!, 1));
  failA(new Error("timed out"));
  assert.equal(await pending, null);
  assert.deepEqual(mkt.orders.map((o) => [o.id, o.quantity]), [["a", 3]], "b stays sold, a has its 3 again");
  // A whole listing that failed to close comes back where it was.
  mkt.orders = [order("x"), order("y"), order("z")];
  market.close = async () => {
    throw new Error("timed out");
  };
  await mkt.sold(mkt.orders[1], 1);
  assert.deepEqual(mkt.orders.map((o) => o.id), ["x", "y", "z"]);
});

test("+rep: a second request for the same player waits for the first and sends nothing more", async () => {
  let posts = 0;
  let reviewed = false;
  market.myReview = async () => (reviewed ? 1 : 0);
  let release!: () => void;
  market.giveRep = (() =>
    new Promise<void>((r) => {
      posts++;
      release = () => {
        reviewed = true;
        r();
      };
    })) as never;
  const first = mkt.giveRep("Tenno_Alpha", "Thanks");
  await new Promise((r) => setTimeout(r, 0));
  const second = mkt.giveRep("tenno_alpha", "Thanks");
  release();
  assert.equal(await first, "given");
  assert.equal(await second, "already");
  assert.equal(posts, 1);
});

// ------------------------------------------------------------------ the 70% floor

const it = { id: "it", slug: "it", gameRef: "/it", name: "It", maxRank: null, subtypes: null, tags: [] };
const noPrices = { price: () => null, priceMax: () => null, relicPrice: () => null } as unknown as Model;
const undercut = (platinum: number) => [{ id: `r${platinum}`, type: "sell", platinum, quantity: 1, rank: null, subtype: null, visible: true, user: { id: "x", ingameName: "Undercutter", status: "ingame", platform: "pc", crossplay: true } }];

/** A listing at `start`, a seller who always asks a little over half of it, and timed passes. */
async function walk(start: number, passes: number, s = { ...defaultMarketSettings(), auto: true, minShare: 0.5, minPrice: 10 }) {
  market.items = async () => [it];
  let mine = order("a", 1, start);
  market.myOrders = async () => [mine];
  let rival = start;
  market.book = async () => undercut(rival) as never;
  market.update = (async (_id: string, c: { platinum?: number }) => {
    mine = { ...mine, platinum: c.platinum! };
    return {} as never;
  }) as never;
  const path = [mine.platinum];
  for (let i = 0; i < passes; i++) {
    rival = Math.floor(mine.platinum / 2) + 1;
    mkt.books = {};
    await mkt.reprice(noPrices, s, true, true);
    path.push(mine.platinum);
  }
  return { path, s, mine: () => mine };
}

test("Apply automatically: an undercutter walks a listing down to 70% of the price you set, and no further", async () => {
  const s = { ...defaultMarketSettings(), auto: true, minShare: 0.5, minPrice: 10, approved: { "it||": 100 } };
  const { path } = await walk(100, 5, s);
  assert.deepEqual(path, [100, 70, 70, 70, 70, 70], "51p was asked for: 70p, then it stays");
  const told = mkt.log.filter((l) => /70% of the 100p you last set/.test(l.text));
  assert.equal(told.length, 1, "told once, not on every pass");
  assert.equal(told[0].tone, "warn");
  assert.equal(s.approved["it||"], 100, "a timed pass approves nothing");
});

test("Apply automatically: a listing MyOrbiter hasn't seen priced starts from its current price", async () => {
  const { path, s } = await walk(40, 3);
  assert.equal(s.approved["it||"], 40);
  assert.deepEqual(path, [40, 28, 28, 28]);
});

test("Apply automatically: the minimum price still holds under the 70% floor", async () => {
  const { path } = await walk(12, 3, { ...defaultMarketSettings(), auto: true, minShare: 0.5, minPrice: 10, approved: { "it||": 12 } });
  assert.ok(path.every((p) => p >= 10), path.join(" → "));
});

test("Reprice pressed by hand goes under the floor, and its price becomes the one you approved", async () => {
  const s = { ...defaultMarketSettings(), auto: true, minShare: 0.5, minPrice: 10, approved: { "it||": 100 } };
  await walk(100, 1, s);
  // You look (Check prices), then press Reprice: 36p is what you saw.
  market.book = async () => undercut(36) as never;
  mkt.books = {};
  await mkt.reprice(noPrices, s, false);
  await mkt.reprice(noPrices, s, true);
  assert.equal(s.approved["it||"], 36);
});

test("A price typed on Orders is the price you approved", async () => {
  const s = { ...defaultMarketSettings(), approved: {} as Record<string, number> };
  mkt.rules = s;
  market.items = async () => [it];
  await mkt.ensureItems();
  market.update = (async () => ({}) as never) as never;
  market.myOrders = async () => [order("a", 1, 55)];
  assert.ok(await mkt.update(order("a", 1, 40), { platinum: 55 }));
  assert.equal(s.approved["it||"], 55);
  mkt.rules = null;
});

// ------------------------------------------------------------------ the listing form

const serrationBook = async () => [{ id: "b", type: "sell", platinum: 20, quantity: 1, rank: 0, subtype: null, visible: true, user: { id: "u", ingameName: "U", status: "ingame", platform: "pc", crossplay: true } }] as never;

/** The listing form open on unranked Serration, with what was sent to warframe.market. */
async function serrationForm(quantity: number, held = 5) {
  mkt.items = spareItems;
  mkt.model = await spareModel(held);
  mkt.rules = { ...defaultMarketSettings(), approved: {} };
  market.book = serrationBook;
  const sent: { create: unknown[]; update: unknown[] } = { create: [], update: [] };
  market.create = (async (o: unknown) => {
    sent.create.push(o);
    mkt.orders = [...mkt.orders, { ...order(`n${sent.create.length}`, quantity), rank: 0 }];
    return {} as never;
  }) as never;
  market.update = (async (id: string, c: unknown) => {
    sent.update.push([id, c]);
  }) as never;
  market.myOrders = async () => mkt.orders;
  mkt.books = {};
  await mkt.startListing(mkt.model, "Serration", { rank: 0, quantity });
  return sent;
}
const formDone = () => {
  mkt.closeDraft();
  mkt.model = null;
  mkt.rules = null;
};

test("the listing form lists what's spare, at the price shown, and approves that price", async () => {
  const sent = await serrationForm(3);
  assert.equal(mkt.draft?.platinum, 20);
  await mkt.submitDraft();
  assert.deepEqual(sent.create, [{ itemId: "it", platinum: 20, quantity: 3, rank: 0, subtype: null, visible: true }]);
  assert.equal(mkt.draft, null);
  assert.match(mkt.draftDone ?? "", /^Listed 3× Serration R0 at 20p/);
  assert.equal(mkt.rules?.approved?.["it|0|"], 20);
  formDone();
});

test("the listing form refuses more than is spare, and a price or quantity warframe.market wouldn't take", async () => {
  const sent = await serrationForm(4);
  await mkt.submitDraft();
  assert.deepEqual(sent.create, []);
  assert.match(mkt.draftError ?? "", /^Didn't list Serration R0: Only 3 can go/);
  for (const [platinum, quantity] of [[0, 1], [1.5, 1], [NaN, 1], [20, 0], [20, 2.5], [1_000_000, 1]]) {
    mkt.draft!.platinum = platinum;
    mkt.draft!.quantity = quantity;
    await mkt.submitDraft();
  }
  assert.deepEqual(sent.create, [], "nothing sent");
  formDone();
});

test("the listing form checks against the newest inventory read, not the one it opened with", async () => {
  const sent = await serrationForm(3);
  // Two copies traded away in game while the form was open: none spare now.
  mkt.model = await spareModel(2);
  await mkt.submitDraft();
  assert.deepEqual(sent.create, [], "the copies aren't there any more");
  assert.match(mkt.draftError ?? "", /^Didn't list Serration R0/);
  formDone();
});

test("adding to a listing counts the copies already listed, hidden ones too, and shows it", async () => {
  mkt.orders = [{ ...order("old", 2, 25), rank: 0, visible: false }];
  const sent = await serrationForm(2);
  await mkt.submitDraft();
  assert.deepEqual(sent.update, [], "2 listed and 2 more is past the 3 spare");
  mkt.draft!.quantity = 1;
  await mkt.submitDraft();
  assert.deepEqual(sent.update, [["old", { platinum: 20, quantity: 3, visible: true }]]);
  assert.deepEqual(sent.create, []);
  assert.match(mkt.draftDone ?? "", /^Added 1× Serration R0 to your listing: now 3 at 20p/);
  formDone();
  mkt.orders = [];
});

test("a new listing past warframe.market's limit isn't sent", async () => {
  const sent = await serrationForm(1);
  mkt.orders = Array.from({ length: 100 }, (_, i) => ({ ...order(`o${i}`), itemId: `x${i}` }));
  await mkt.submitDraft();
  assert.deepEqual(sent.create, []);
  assert.match(mkt.draftError ?? "", /allows 100 listings/);
  formDone();
  mkt.orders = [];
});

test("a listing that timed out but was made isn't an error; one that wasn't made is", async () => {
  await serrationForm(1);
  await mkt.refresh();
  let made = true;
  market.create = (async () => {
    if (made) mkt.orders = [...mkt.orders, { ...order("late"), rank: 0 }];
    throw new Error("Couldn't reach warframe.market (timed out)");
  }) as never;
  await mkt.submitDraft();
  assert.equal(mkt.draft, null, "it went up: the form closes");
  assert.match(mkt.draftDone ?? "", /^Listed 1× Serration R0/);
  mkt.orders = [];
  await mkt.startListing(mkt.model!, "Serration", { rank: 0, quantity: 1 });
  made = false;
  await mkt.submitDraft();
  assert.ok(mkt.draft, "the form stays open to send again");
  assert.match(mkt.draftError ?? "", /timed out/);
  formDone();
});

// ------------------------------------------------------------------ riven auctions

test("a riven put up that timed out but was made isn't reported as failed, even before your auctions were read", async () => {
  const auction = (id: string) => ({ id, item: { type: "riven", weapon_url_name: "braton", name: "visi-critatox" }, buyout_price: 50, starting_price: 50 });
  rivens.mine = [];
  rivens.mineAt = null;
  let made = false;
  market.myAuctions = async () => (made ? [auction("new")] : []) as never;
  market.createAuction = async () => {
    made = true;
    throw new Error("Couldn't reach warframe.market (timed out)");
  };
  await rivens.sell({ type: "riven", weapon_url_name: "braton", name: "visi-critatox" } as never, 50, 50);
  assert.deepEqual(rivens.mine.map((a) => a.id), ["new"]);
  // One that wasn't made is an error, to send again.
  made = false;
  market.myAuctions = async () => [auction("new")] as never;
  market.createAuction = async () => {
    throw new Error("Couldn't reach warframe.market (timed out)");
  };
  await assert.rejects(rivens.sell({ type: "riven", weapon_url_name: "braton", name: "visi-critatox" } as never, 50, 50), /timed out/);
  rivens.mine = [];
  rivens.mineAt = null;
});
