// A proxy set that MyOrbiter can't use: the window's own read (last week's riven trades, by
// `fetch`, through neither the agent nor the sockets) isn't made either.
import "./support/runes";
import { test } from "node:test";
import assert from "node:assert/strict";
import { saved } from "../src/lib/backend";

let asked = 0;
globalThis.fetch = (async () => {
  asked++;
  return new Response("", { status: 503 });
}) as never;
const { windowMayAsk } = await import("../src/lib/proxy.svelte");
const { rivens } = await import("../src/lib/rivenStore.svelte");

test("the window asks only once the answer is in, and only when no proxy set stops the route", async () => {
  assert.equal(await windowMayAsk(Promise.resolve(null)), true, "no proxy, or a usable one");
  assert.equal(await windowMayAsk(Promise.resolve("HTTPS_PROXY is set to an https:// proxy, …")), false);
  assert.equal(await windowMayAsk(Promise.reject(new Error("no answer"))), false, "an answer that fails is a stop");
  // An answer still on its way: nothing is decided, so an early read can't slip out.
  let answer!: (p: string | null) => void;
  let decided = false;
  const may = windowMayAsk(new Promise((r) => (answer = r))).then((m) => ((decided = true), m));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(decided, false);
  answer("ALL_PROXY is set to a SOCKS proxy, …");
  assert.equal(await may, false);
});

test("last week's riven trades aren't read while the proxy stops: what was read stays, nothing is said, the next visit asks again", async () => {
  const kept = [{ weapon: "Example", compatibility: null, rerolled: false, avg: 10, stddev: 1, min: 5, max: 20, pop: 1, median: 10 }] as never;
  saved.read = async () => ({ platform: "pc", at: Date.now(), week: "1–7 Nov", trades: kept });
  saved.write = async () => {};
  let checks = 0;
  rivens.tradesMayAsk = async () => (checks++, false);
  asked = 0;
  await rivens.loadTrades("pc");
  assert.equal(asked, 0, "nothing asked of www-static.warframe.com");
  assert.equal(rivens.trades, kept, "the kept read still shows");
  assert.equal(rivens.tradesError, null, "no words of its own");
  await rivens.loadTrades("pc");
  assert.equal(checks, 2, "asked again at the next visit, not six hours later");
  assert.equal(asked, 0);
  // Once the route lets it (another start, the proxy changed): read as before.
  rivens.tradesMayAsk = async () => true;
  await rivens.loadTrades("pc");
  assert.equal(asked, 1);
});
