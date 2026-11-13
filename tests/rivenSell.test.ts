// Riven auctions: a reprice sends back what it read (only the price changes), and Sell sends once.
import "./support/runes";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { market } from "../src/lib/backend";
import { parseMyAuctions, type AuctionItem } from "../src/lib/core/rivens";

globalThis.fetch = (() => {
  throw new Error("no network in tests");
}) as never;
const { rivens } = await import("../src/lib/rivenStore.svelte");
const real = { ...market };
beforeEach(() => {
  Object.assign(market, real);
  rivens.mine = [];
  rivens.mineAt = null;
  rivens.mineError = null;
  (rivens as unknown as { unchecked: boolean }).unchecked = false;
});

const TIMED_OUT = "Couldn't reach warframe.market (timed out)";
const attrs = [
  { url_name: "critical_chance", value: 150.5, positive: true },
  { url_name: "damage_vs_grineer", value: -40.2, positive: false },
];
const item: AuctionItem = { type: "riven", weapon_url_name: "braton", name: "visi-critatis", attributes: attrs, re_rolls: 2, mastery_level: 8, mod_rank: 0, polarity: "madurai" };
const raw = (id: string, over: Partial<AuctionItem> = {}, extra: Record<string, unknown> = {}) => ({
  id, starting_price: 100, buyout_price: 100, visible: true, closed: false, note_raw: "", minimal_reputation: 0,
  item: { ...item, ...over }, ...extra,
});

test("a reprice changes the price and sends every other field back as it was read (private from the answer)", async () => {
  for (const [priv, visible] of [[true, true], [false, false], [true, false], [false, true]] as const) {
    const [a] = parseMyAuctions([raw("x", {}, { private: priv, visible, note_raw: "gg", minimal_reputation: 7, starting_price: 60, buyout_price: 100 })]);
    const sent: unknown[] = [];
    market.updateAuction = (async (_id: string, c: unknown) => void sent.push(c)) as never;
    market.myAuctions = async () => [];
    await rivens.reprice(a, 90);
    assert.deepEqual(sent, [{ starting_price: 60, buyout_price: 90, minimal_reputation: 7, private: priv, note: "gg" }]);
  }
});

test("an answer with no private field keeps what was always sent: private when hidden", () => {
  assert.equal(parseMyAuctions([raw("x")])[0].private, false);
  assert.equal(parseMyAuctions([raw("x", {}, { visible: false })])[0].private, true);
  assert.equal(parseMyAuctions([raw("x", {}, { visible: false, private: false })])[0].private, false);
});

test("Sell sends nothing when the read of your auctions fails, and says so", async () => {
  let creates = 0;
  market.myAuctions = async () => {
    throw new Error(TIMED_OUT);
  };
  market.createAuction = (async () => void creates++) as never;
  await assert.rejects(rivens.sell(item, 100, 100), /could not check the auctions already up/);
  await assert.rejects(rivens.sell(item, 100, 100), /could not check the auctions already up/);
  assert.equal(creates, 0);
});

test("a create that timed out, then a failed look: Sell again reads first and sends nothing until it can", async () => {
  let creates = 0;
  let readable = true;
  let made = false;
  market.myAuctions = async () => {
    if (!readable) throw new Error(TIMED_OUT);
    return made ? [raw("new")] : [];
  };
  market.createAuction = (async () => {
    creates++;
    made = true;
    readable = false; // the site made it, then stopped answering
    throw new Error(TIMED_OUT);
  }) as never;
  await assert.rejects(rivens.sell(item, 100, 100), /timed out/);
  // The list from before the create is under half a minute old, yet it isn't trusted.
  await assert.rejects(rivens.sell(item, 100, 100), /could not check the auctions already up/);
  assert.equal(creates, 1);
  readable = true;
  await assert.rejects(rivens.sell(item, 100, 100), /already up/);
  assert.equal(creates, 1);
});

test("a create that failed isn't reported as listed because another riven for the weapon is up", async () => {
  let reads = 0;
  market.createAuction = (async () => {
    throw new Error(TIMED_OUT);
  }) as never;
  const others: Partial<AuctionItem>[] = [{ name: "other-riven-name" }, { attributes: [attrs[0]] }, { attributes: [{ ...attrs[0], value: 120 }, attrs[1]] }, { re_rolls: 3 }, { polarity: "naramon" }, { mod_rank: 8 }, { mastery_level: 11 }];
  for (const over of others) {
    reads = 0;
    rivens.mineAt = null;
    market.myAuctions = async () => (reads++ === 0 ? [] : [raw("other", over)]) as never;
    await assert.rejects(rivens.sell(item, 100, 100), /timed out/, JSON.stringify(over));
  }
});

test("a create that timed out but was made is not reported as failed, whatever the order of its stats", async () => {
  let reads = 0;
  market.myAuctions = async () => (reads++ === 0 ? [] : [raw("new", { attributes: [...attrs].reverse() })]) as never;
  market.createAuction = (async () => {
    throw new Error(TIMED_OUT);
  }) as never;
  await rivens.sell(item, 100, 100);
  assert.deepEqual(rivens.mine.map((a) => a.id), ["new"]);
});
