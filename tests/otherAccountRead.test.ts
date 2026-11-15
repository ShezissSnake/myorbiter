// A read under another account or platform doesn't have this account's listings, yet none of them
// is gone. Such a read leaves this account's saved approvals, and the per-item prices an older
// build reads, as they were: back on its own account, a pass stops where today's build stops (70%
// of the 100p approved: 70p), never at 70% of a price a pass lowered it to. Every market call is
// replaced; a restart is the settings through JSON and nothing kept in memory.
import { test } from "node:test";
import assert from "node:assert/strict";
import { h, me, mkt, order, seller, settings, timedPass, logText, asAccount, ME } from "./support/pass";
import { market, type MarketSettings } from "../src/lib/backend";

type Owned = Record<string, { key: string; platinum: number; by?: string }>;
const owned = (s: MarketSettings) => (s as MarketSettings & { approvedFor?: Owned }).approvedFor ?? {};
const x = { ...h.it, id: "x", slug: "x", gameRef: "/x", name: "X" };

/** Approved at 100p on the first account (a pass has since lowered it to 75p). */
const start = () => settings({ "it||": 100 }, { approvedFor: { a: { key: "it||", platinum: 100 } } });
/** MyOrbiter closed and started again: the settings as saved, nothing the store held in memory. */
function restart(s: MarketSettings): MarketSettings {
  mkt.endedApprovals.clear();
  (mkt as unknown as { floorTold: Set<string> }).floorTold.clear();
  mkt.orders = [];
  mkt.ordersAt = null;
  return JSON.parse(JSON.stringify(s));
}
/** A read that succeeded, signed in as `account` (the first is "me"): `mine` are its listings. */
async function read(s: MarketSettings, mine: ReturnType<typeof order>[], account = "me") {
  asAccount(account);
  mkt.items = [h.it, x];
  h.mine = mine;
  await mkt.refresh(s);
  asAccount("me");
}
/** A timed pass a day later, signed in as `account`, with the market at 40p and 41p. */
async function pass(s: MarketSettings, mine: ReturnType<typeof order>[], account = "me") {
  asAccount(account);
  h.now += 25 * 3600e3;
  mkt.items = [h.it, x];
  h.mine = mine;
  h.book = [seller(40), seller(41)];
  h.sent = [];
  await timedPass(s);
  asAccount("me");
  return h.sent.map(([id, p]) => `${id}->${p}`).join(",") || "none";
}

// The orders of the other account's read and restarts. O: the other account's read, nothing of
// it listed; Ob: the other account's read, its own listing b at 50p; A: the first account's read,
// a at 75p; R: a restart; P: the first account's pass, a at 75p; Pb: the other account's pass, b
// at 50p; SOLD: the first account's read with a gone (sold); N: the first account's pass with a new
// listing n at 60p. What every pass sends is what today's build sends, except where rule A asks
// a new listing to start from its own price (b and n: today's build gives them the 100p of a's).
const scenarios: [string, string[], string[]][] = [
  ["other read, restart, back", ["O", "R", "P"], ["a->70"]],
  ["restart, other read, back", ["R", "O", "P"], ["a->70"]],
  ["other read, back, no restart", ["O", "P"], ["a->70"]],
  ["twice over with restarts", ["O", "R", "A", "O", "R", "O", "R", "P"], ["a->70"]],
  ["back and forth with passes", ["O", "R", "P", "O", "R", "P", "R", "O", "P"], ["a->70", "a->70", "a->70"]],
  ["both accounts list the same item", ["Ob", "R", "P", "Ob", "R", "Pb", "R", "P", "Ob", "P"], ["a->70", "b->41", "a->70", "a->70"]],
  ["both accounts list the same item, no restart", ["Ob", "P", "Pb", "P"], ["a->70", "b->41", "a->70"]],
  ["many restarts", ["R", "R", "O", "R", "R", "R", "P", "R", "P"], ["a->70", "a->70"]],
  ["back, then the other account again", ["O", "P", "O", "R", "P"], ["a->70", "a->70"]],
  ["a pass on the other account between", ["O", "Pb", "R", "P"], ["b->41", "a->70"]],
  ["sold, then a new listing", ["P", "SOLD", "R", "N"], ["a->70", "n->42"]],
  ["sold after the other account's read, then a new listing", ["O", "R", "SOLD", "N"], ["n->42"]],
];

for (const [name, ops, expected] of scenarios) {
  test(`another account's read, ${name}: the first account's passes stop where today's build stops`, async () => {
    let s = start();
    const sent: string[] = [];
    for (const op of ops) {
      const before = structuredClone({ approved: s.approved, a: owned(s).a });
      if (op === "O" || op === "Ob") {
        await read(s, op === "Ob" ? [order(50, "b")] : [], "other");
        // The first account's saved approvals and the per-item prices are the same as before.
        assert.deepEqual({ approved: s.approved, a: owned(s).a }, before, `${op}: nothing of the first account's moved`);
      } else if (op === "A") await read(s, [order(75, "a")]);
      else if (op === "R") s = restart(s);
      else if (op === "P") sent.push(await pass(s, [order(75, "a")]));
      else if (op === "Pb") sent.push(await pass(s, [order(50, "b")], "other"));
      else if (op === "SOLD") await read(s, []);
      else if (op === "N") sent.push(await pass(s, [order(60, "n")]));
    }
    assert.deepEqual(sent, expected, logText());
    const sold = ops.includes("SOLD");
    // What an older build reads after a step back: the first account's 100p while a is up; once a
    // sold, the new listing's own 60p.
    assert.deepEqual(s.approved, sold ? { "it||": 60 } : { "it||": 100 });
  });
}

test("another platform's read leaves the first one's approvals and per-item prices as they were", async () => {
  const s = start();
  mkt.platform = "xbox";
  try {
    await read(s, [order(50, "b")]);
  } finally {
    mkt.platform = "pc";
  }
  assert.deepEqual(owned(s).a, { key: "it||", platinum: 100, by: ME });
  assert.deepEqual(s.approved, { "it||": 100 });
  assert.equal(await pass(s, [order(75, "a")]), "a->70", logText());
});

test("a read while the account isn't known settles nothing: no approval ends, moves or is recorded", async () => {
  const s = start();
  mkt.account = { linked: true, backing: "keyring", profile: null, error: null } as never;
  mkt.items = [h.it];
  h.mine = [order(50, "b")];
  await mkt.refresh(s);
  assert.deepEqual({ approved: s.approved, owned: owned(s) }, { approved: { "it||": 100 }, owned: { a: { key: "it||", platinum: 100, by: ME } } });
  assert.equal(mkt.orders.length, 1, "the listings read are shown");
});

test("a read during which the account changed settles nothing", async () => {
  const s = start();
  const read0 = market.myOrders;
  market.myOrders = async () => {
    const r = await read0();
    asAccount("other");
    return r;
  };
  mkt.items = [h.it];
  h.mine = [];
  await mkt.refresh(s);
  asAccount("me");
  assert.deepEqual({ approved: s.approved, owned: owned(s) }, { approved: { "it||": 100 }, owned: { a: { key: "it||", platinum: 100, by: ME } } });
});

test("the other account ends 500 listings while the first is away: the first one's approval is kept", async () => {
  let s = start();
  await read(s, [], "other");
  for (let batch = 0; batch < 5; batch++) {
    h.now += 3600e3;
    await read(s, Array.from({ length: 100 }, (_, i) => order(30, `x${batch}_${i}`, { itemId: "x" })), "other");
    h.now += 3600e3;
    await read(s, [], "other");
  }
  assert.equal(s.approved["it||"], 100);
  s = restart(s);
  assert.equal(await pass(s, [order(75, "a")]), "a->70", logText());
});

test("both accounts list the same item, then a step back: the older build reads the first account's price, not the other's", async () => {
  const s = start();
  await read(s, [order(50, "b")], "other");
  assert.deepEqual(owned(s).b, { key: "it||", platinum: 50, by: "other|pc" });
  const saved = JSON.parse(JSON.stringify(s)) as MarketSettings;
  assert.deepEqual(saved.approved, { "it||": 100 });
  // The older build reads only the per-item prices: on the first account, a stops at 70p.
  const older = restart(settings(saved.approved));
  assert.equal(await pass(older, [order(75, "a")]), "a->70", logText());
});

test("a step back after a sale and forward again: a listing the older build lowered keeps the price it was listed at", async () => {
  // This build: a, approved at 100p, sells. Its approval ends, and the per-item price with it.
  let s = start();
  await read(s, [order(100, "a")]);
  await read(s, []);
  assert.deepEqual({ approved: s.approved, owned: owned(s) }, { approved: {}, owned: {} });
  // The older build: a new listing c at 100p records 100p per item; its timer takes c to 70p.
  s = restart(s);
  s.approved = { ...s.approved, "it||": 100 };
  // Forward again: c, read at 70p, takes the per-item 100p; a pass with the market at 41p leaves it
  // at 70p, as the older build does.
  s = restart(s);
  h.now += 72 * 3600e3;
  assert.equal(await pass(s, [order(70, "c")]), "none", logText());
  assert.deepEqual(owned(s).c, { key: "it||", platinum: 100, by: ME, legacy: true });
  assert.deepEqual(s.approved, { "it||": 100 });
});

test("a listing really sold on its own account ends; the next one takes its own price", async () => {
  let s = start();
  await read(s, [], "other");
  s = restart(s);
  await read(s, []);
  assert.deepEqual({ approved: s.approved, owned: owned(s) }, { approved: {}, owned: {} });
  await read(s, [order(60, "n")]);
  assert.deepEqual(owned(s), { n: { key: "it||", platinum: 60, by: ME } });
  assert.equal(me.id, "me");
});
