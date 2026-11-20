// Last copies hidden on a whisper are written into the hidden list one by one, as warframe.market
// takes each, not once the whole run is over: a quit after the first request leaves nothing hidden
// there that MyOrbiter doesn't know of, so it is shown again in time (a hidden listing is never
// left hidden unasked). market.update and market.myOrders are stand-ins; nothing reaches the network.
import "./support/runes";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { market } from "../src/lib/backend";
import { hideNow, type HiddenForWhisper } from "../src/lib/core/lastCopy";
import type { MyOrder } from "../src/lib/core/market";

globalThis.fetch = (() => {
  throw new Error("no network in tests");
}) as never;
const { mkt } = await import("../src/lib/marketStore.svelte");

const listing = (id: string): MyOrder => ({ id, itemId: id, type: "sell", platinum: 20, quantity: 1, rank: null, subtype: null, visible: true, updatedAt: null });
const flush = () => new Promise((r) => setTimeout(r, 0));

test("hiding three last copies: each is in the hidden list once warframe.market took it, before the next is asked", async () => {
  const orders = [listing("a"), listing("b"), listing("c")];
  const answers: (() => void)[] = [];
  const asked: string[] = [];
  let reads = 0;
  market.update = ((id: string, c: { visible?: boolean }) => {
    asked.push(`${id} ${c.visible}`);
    return new Promise<void>((done) => answers.push(done));
  }) as never;
  market.myOrders = (async () => {
    reads++;
    return orders.map((o) => ({ ...o, visible: false }));
  }) as never;
  mkt.orders = orders;
  const saved = { hidden: [] as HiddenForWhisper[] };
  const run = mkt.setShown(orders, false, true, (o) => (saved.hidden = hideNow(saved.hidden, [o], 1_000)));
  await flush();
  assert.deepEqual(asked, ["a false"]);
  assert.equal(saved.hidden.length, 0, "nothing recorded before warframe.market answers");
  answers[0]();
  await flush();
  // Settings saved now (a quit before the second answer) know of the first.
  assert.deepEqual(saved.hidden.map((h) => h.id), ["a"]);
  assert.deepEqual(asked, ["a false", "b false"]);
  answers[1]();
  await flush();
  assert.deepEqual(saved.hidden.map((h) => h.id), ["a", "b"]);
  answers[2]();
  assert.deepEqual((await run).map((o) => o.id), ["a", "b", "c"]);
  assert.deepEqual(saved.hidden.map((h) => h.id), ["a", "b", "c"]);
  assert.equal(asked.length, 3, "one request each, as before");
  assert.equal(reads, 1, "and one read of the listings after them, as before");
});

test("a listing warframe.market refused to hide isn't recorded as hidden", async () => {
  const orders = [listing("a"), listing("b")];
  market.update = (async (id: string) => {
    if (id === "a") throw new Error("refused");
  }) as never;
  market.myOrders = (async () => orders) as never;
  mkt.orders = orders;
  const saved = { hidden: [] as HiddenForWhisper[] };
  await mkt.setShown(orders, false, true, (o) => (saved.hidden = hideNow(saved.hidden, [o], 1_000)));
  assert.deepEqual(saved.hidden.map((h) => h.id), ["b"]);
});

test("the whisper's hiding records each listing as it goes, and nothing after the run", () => {
  const app = readFileSync(new URL("../src/App.svelte", import.meta.url), "utf8");
  const body = app.slice(app.indexOf("async function hideLastCopies"), app.indexOf("const toldWaiting"));
  assert.match(body, /mkt\.setShown\(toHide, false, true, \(o\) => \(settings\.market\.lastCopy\.hidden = hideNow\(settings\.market\.lastCopy\.hidden, \[o\], Date\.now\(\)\)\)\)/);
  assert.equal(body.match(/settings\.market\.lastCopy\.hidden =/g)?.length, 1, "written in the loop only");
});
