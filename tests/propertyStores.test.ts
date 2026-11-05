// Property tests for the warframe.market store: random sequences of sales, +rep requests and timed
// repricing passes, with warframe.market answering (or failing) in any order. Nothing reaches the
// network: every market call is replaced. Seeds as in property.test.ts.
import "./support/runes";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { market, defaultMarketSettings } from "../src/lib/backend";
import type { MyOrder } from "../src/lib/core/market";
import type { Model } from "../src/lib/core/model";
import { autoFloor } from "../src/lib/core/approved";
import { forAll, rng } from "./support/prop";

const { mkt } = await import("../src/lib/marketStore.svelte");

const RUNS = Number(process.env.PROPERTY_RUNS ?? 400);
const me = { id: "me", ingameName: "ExamplePlayer", platform: "pc", crossplay: true } as never;
const real = { ...market };
const order = (id: string, quantity: number, platinum = 20, itemId = "it"): MyOrder => ({ id, itemId, type: "sell", platinum, quantity, rank: null, subtype: null, visible: true, updatedAt: null });
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

beforeEach(() => {
  Object.assign(market, real);
  mkt.account = { linked: true, backing: "keyring", profile: me, error: null };
  mkt.orders = [];
  mkt.log = [];
  mkt.op = null;
  mkt.pass = null;
  mkt.passFailures = 0;
  mkt.books = {};
});

// ------------------------------------------------------------------ marking sales sold

test("sales: however sales overlap, fail or repeat, no listing closes more copies than it had, and what's shown matches what went through", async () => {
  const seeds: number[] = [];
  forAll("sales seeds", (_r, seed) => void seeds.push(seed), RUNS);
  for (const seed of seeds) {
    const r = rng(seed);
    const start = Array.from({ length: r.int(1, 4) }, (_, i) => order(`o${i}`, r.int(1, 5)));
    mkt.orders = start.map((o) => ({ ...o }));
    // The copies the caller holds: sometimes the listing as it is, sometimes one read earlier.
    const stale = start.map((o) => ({ ...o }));
    const closed = new Map<string, number>();
    const pending: { id: string; n: number; ok: () => void; fail: () => void }[] = [];
    market.close = ((id: string, n: number) =>
      new Promise<void>((res, rej) => {
        pending.push({ id, n, ok: () => (closed.set(id, (closed.get(id) ?? 0) + n), res()), fail: () => rej(new Error("timed out")) });
      })) as never;
    const running: Promise<unknown>[] = [];
    const ctx = () => `PROPERTY_SEED=${seed} start=${JSON.stringify(start.map((o) => [o.id, o.quantity]))} closed=${JSON.stringify([...closed])} shown=${JSON.stringify(mkt.orders.map((o) => [o.id, o.quantity]))}`;
    for (let step = 0; step < 14; step++) {
      if (pending.length && r.bool(0.45)) {
        const p = pending.splice(r.int(0, pending.length - 1), 1)[0];
        r.bool(0.75) ? p.ok() : p.fail();
        await tick();
      } else {
        const i = r.int(0, start.length - 1);
        const o = r.bool(0.5) ? stale[i] : (mkt.orders.find((x) => x.id === start[i].id) ?? stale[i]);
        running.push(mkt.sold(o, r.pick([0, 1, 1, 2, 3, 7, 2.6]), { quiet: true }));
      }
      for (const o of mkt.orders) assert.ok(o.quantity >= 1 && Number.isInteger(o.quantity), ctx());
    }
    while (pending.length) {
      const p = pending.shift()!;
      r.bool(0.75) ? p.ok() : p.fail();
      await tick();
    }
    await Promise.all(running);
    for (const o of start) {
      const done = closed.get(o.id) ?? 0;
      assert.ok(done <= o.quantity, `closed ${done} of ${o.quantity} (${o.id}): ${ctx()}`);
      const shown = mkt.orders.find((x) => x.id === o.id)?.quantity ?? 0;
      assert.equal(shown, o.quantity - done, `${o.id} shown ${shown}, expected ${o.quantity - done}: ${ctx()}`);
    }
  }
});

// ------------------------------------------------------------------ +rep

test("+rep: however requests overlap, in whatever case, a player gets at most one", async () => {
  const seeds: number[] = [];
  forAll("rep seeds", (_r, seed) => void seeds.push(seed), RUNS);
  for (const seed of seeds) {
    const r = rng(seed);
    const given = new Map<string, number>();
    const pending: { name: string; ok: () => void; fail: () => void }[] = [];
    market.myReview = (async (name: string) => (given.get(name.toLowerCase()) ? 1 : 0)) as never;
    market.giveRep = ((name: string) =>
      new Promise<void>((res, rej) => {
        pending.push({ name, ok: () => (given.set(name.toLowerCase(), (given.get(name.toLowerCase()) ?? 0) + 1), res()), fail: () => rej(new Error("429")) });
      })) as never;
    const running: Promise<unknown>[] = [];
    for (let step = 0; step < 12; step++) {
      if (pending.length && r.bool(0.4)) {
        const p = pending.splice(r.int(0, pending.length - 1), 1)[0];
        r.bool(0.8) ? p.ok() : p.fail();
      } else {
        const base = r.pick(["Tenno_Alpha", "VoidTrader42", "Arbiter_Ann"]);
        const name = r.pick([base, base.toLowerCase(), base.toUpperCase()]);
        running.push(mkt.giveRep(name, "Thanks").catch(() => null));
      }
      await tick();
    }
    while (pending.length) {
      pending.shift()!.ok();
      await tick();
    }
    await Promise.all(running);
    for (const [name, n] of given) assert.ok(n <= 1, `PROPERTY_SEED=${seed}: ${name} got +rep ${n} times`);
  }
});

// ------------------------------------------------------------------ the repricing floor, end to end

test("Apply automatically: random markets never take a listing under 70% of its approved price or under the minimum, and approve nothing", async () => {
  const seeds: number[] = [];
  forAll("reprice seeds", (_r, seed) => void seeds.push(seed), Math.ceil(RUNS / 4));
  const it = { id: "it", slug: "it", gameRef: "/it", name: "It", maxRank: null, subtypes: null, tags: [] };
  const model = { price: () => null, priceMax: () => null, relicPrice: () => null } as unknown as Model;
  for (const seed of seeds) {
    const r = rng(seed);
    const minPrice = r.pick([1, 5, 10, 15]);
    const approved = r.int(minPrice, 300);
    const s = { ...defaultMarketSettings(), auto: true, minShare: 0, minPrice, approved: r.bool(0.85) ? { "it||": approved } : ({} as Record<string, number>) };
    let mine = order("a", 1, r.bool(0.8) ? approved : r.int(1, 400));
    const startPrice = mine.platinum;
    const floor = autoFloor(s.approved["it||"] ?? startPrice);
    market.items = async () => [it];
    market.myOrders = async () => [mine];
    let ask = 0;
    market.book = async () => [{ id: "r", type: "sell", platinum: ask, quantity: 1, rank: null, subtype: null, visible: true, user: { id: "x", ingameName: "Tenno_Bravo", status: "ingame", platform: "pc", crossplay: true } }] as never;
    market.update = (async (_id: string, c: { platinum?: number }) => {
      mine = { ...mine, platinum: c.platinum! };
      return {} as never;
    }) as never;
    const approvedBefore = s.approved["it||"] ?? startPrice;
    for (let pass = 0; pass < 6; pass++) {
      const before = mine.platinum;
      ask = r.pick([r.int(1, before), r.int(1, 3 * before), Math.floor(before / 2) + 1, 1]);
      mkt.books = {};
      await mkt.reprice(model, s, true, true);
      const ctx = `PROPERTY_SEED=${seed} approved=${approvedBefore} floor=${floor} min=${minPrice} pass=${pass} ${before}p → ${mine.platinum}p (ask ${ask})`;
      if (mine.platinum < before) {
        assert.ok(mine.platinum >= floor, `under the 70% floor: ${ctx}`);
        assert.ok(mine.platinum >= minPrice, `under the minimum: ${ctx}`);
        assert.ok(mine.platinum >= before / 2, `more than halved: ${ctx}`);
      }
      // Unknown before, it starts from the price the listing had (the first change records it).
      assert.equal(s.approved["it||"] ?? startPrice, approvedBefore, `a timed pass changed the approved price: ${ctx}`);
    }
  }
});
