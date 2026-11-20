// A Sell or Buy form closed while it loads stays closed when the load ends, and one opened after
// it isn't taken over by the older load. A riven scan doesn't start while one runs. market.* are
// stand-ins; nothing reaches the network.
import "./support/runes";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { market } from "../src/lib/backend";
import type { Model } from "../src/lib/core/model";

globalThis.fetch = (() => {
  throw new Error("no network in tests");
}) as never;
const { mkt } = await import("../src/lib/marketStore.svelte");

const later = <T>() => {
  let done!: (v: T) => void;
  let fail!: (e: unknown) => void;
  const p = new Promise<T>((ok, no) => ((done = ok), (fail = no)));
  return { p, done, fail };
};
const items = [
  { id: "ex1", slug: "example_mod", gameRef: "/Example/Mod", name: "Example Mod", maxRank: 5, subtypes: null, tags: ["mod"] },
  { id: "ex2", slug: "example_part", gameRef: "/Example/Part", name: "Example Part", maxRank: null, subtypes: null, tags: [] },
];
const held = { inventoryByBase: new Map(), partByName: new Map(), inventoryByName: new Map(), catalogByUnique: new Map(), catalogNames: new Set() } as unknown as Model;
const seller = (platinum: number, rank: number | null = 0) => ({ id: `s${platinum}`, type: "sell", platinum, quantity: 1, rank, subtype: null, visible: true, user: { id: "u", ingameName: "ExampleSeller", status: "ingame", platform: "pc", crossplay: true } });
// What the Buy form's Close does (BuyDialog.svelte › close).
const closeBuy = () => {
  mkt.buyDraft = null;
  mkt.buyError = null;
};

test("the Sell form closed while warframe.market's item list loads doesn't open when it arrives", async () => {
  mkt.items = [];
  const list = later<typeof items>();
  market.items = (() => list.p) as never;
  const going = mkt.startListing(held, "Example Mod");
  assert.equal(mkt.drafting, "Example Mod", "the form says it's finding the item");
  mkt.closeDraft();
  list.done(items);
  await going;
  assert.equal(mkt.draft, null, "closed: it stays closed");
  assert.equal(mkt.drafting, null);
  assert.equal(mkt.draftError, null);
  mkt.closeDraft();
});

test("the Sell form closed while the item list loads says nothing when that load fails", async () => {
  mkt.items = [];
  const list = later<typeof items>();
  market.items = (() => list.p) as never;
  const going = mkt.startListing(held, "Example Mod");
  mkt.closeDraft();
  list.fail(new Error("timed out"));
  await going;
  assert.equal(mkt.draftError, null, "no error opens the closed form");
  mkt.closeDraft();
});

test("a Sell form opened while an older one loads keeps its own item", async () => {
  mkt.items = [];
  const list = later<typeof items>();
  market.items = (() => list.p) as never;
  const first = mkt.startListing(held, "Example Mod");
  const second = mkt.startListing(held, "Example Part");
  list.done(items);
  await Promise.all([first, second]);
  assert.equal(mkt.draft?.name, "Example Part");
  mkt.closeDraft();
});

test("the Buy form closed while its order book loads stays closed, even when the read fails", async () => {
  mkt.items = items;
  mkt.books = {};
  market.history = (async () => []) as never;
  const book = later<never>();
  market.book = (() => book.p) as never;
  const going = mkt.startBuy("Example Part");
  await new Promise((ok) => setTimeout(ok, 0));
  assert.equal(mkt.buyDraft?.loading, true, "the form is open, reading the order book");
  closeBuy();
  book.fail(new Error("timed out"));
  await going;
  assert.equal(mkt.buyDraft, null);
  assert.equal(mkt.buyError, null, "the error doesn't open the closed form");
});

test("the Buy form at another rank isn't taken over by the older rank's read ending last", async () => {
  mkt.items = items;
  mkt.books = {};
  market.history = (async () => []) as never;
  const reads: ReturnType<typeof later<never>>[] = [];
  market.book = (() => {
    const r = later<never>();
    reads.push(r);
    return r.p;
  }) as never;
  const tick = () => new Promise((ok) => setTimeout(ok, 0));
  const r0 = mkt.startBuy("Example Mod", { rank: 0 });
  await tick();
  assert.equal(reads.length, 1, "rank 0's book is being read");
  const r5 = mkt.startBuy("Example Mod", { rank: 5 });
  await tick();
  assert.equal(reads.length, 2);
  reads[1].done([seller(90, 5)] as never);
  await r5;
  assert.equal(mkt.buyDraft?.rank, 5);
  assert.equal(mkt.buyDraft?.cheapestSell, 90);
  reads[0].done([seller(10, 0)] as never);
  await r0;
  assert.equal(mkt.buyDraft?.rank, 5, "the rank picked last stays");
  assert.equal(mkt.buyDraft?.cheapestSell, 90);
  closeBuy();
});

test("a riven scan doesn't start while one runs", async () => {
  const { oneAtATime } = await import("../src/lib/core/oneAtATime");
  let runs = 0;
  const gate = later<void>();
  const scan = oneAtATime(async () => {
    runs++;
    await gate.p;
    return "scanned";
  });
  const a = scan();
  const b = scan();
  assert.equal(runs, 1, "the second call does nothing while the first runs");
  gate.done();
  assert.equal(await a, "scanned");
  assert.equal(await b, undefined);
  assert.equal(await scan(), "scanned", "once it ended, the next one runs");
  assert.equal(runs, 2);
  const failing = oneAtATime(async () => {
    throw new Error("boom");
  });
  await assert.rejects(failing());
  await assert.rejects(failing(), "a scan that failed doesn't keep the next one out");
  const app = readFileSync(new URL("../src/App.svelte", import.meta.url), "utf8");
  assert.match(app, /const scanRivens = oneAtATime\(async \(\) => \{/);
});
