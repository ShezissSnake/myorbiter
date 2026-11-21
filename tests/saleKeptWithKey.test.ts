// A sale read from the game's log is never lost between two steps: its trade's key goes into
// `tradesSeen` in the same step as its sales go into the log, so settings saved at any moment (a
// quit while warframe.market is still answering) hold both or neither. The page's trade effect is
// played here as App.svelte runs it: tradesToMark over the keys seen and those being handled,
// seenAtOnce for the keys recorded at once, then markTrades. Nothing reaches warframe.market: the
// store's `sold` is a stand-in that answers only when told to.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { markTrades, seenAtOnce, tradeKey, tradesToMark, type TradeMarking, type TradeSale } from "../src/lib/core/trades";
import { keepSeen } from "../src/lib/core/upkeep";
import { soldQuestion } from "../src/lib/core/soldMarks";
import type { MyOrder } from "../src/lib/core/market";
import type { Trade } from "../src/lib/core/types";
import type { Sale } from "../src/lib/backend";
import type { SoldLine } from "../src/lib/core/saleNotice";

const SESSION = 1_792_500_000;
const now = () => (SESSION + 600) * 1000;
const listing = (id: string, itemId: string, platinum: number, quantity = 3): MyOrder => ({ id, itemId, type: "sell", platinum, quantity, rank: null, subtype: null, visible: true, updatedAt: null });
const trade = (uptime: number, names: string[], plat: number): Trade => ({ uptime, at: SESSION + uptime, partner: "ExampleBuyer", offered: names.map((name) => ({ name, rank: null, count: 1 })), received: [], platinum_offered: 0, platinum_received: plat });

/** The page as the trade effect sees it: saved settings, listings, what's being handled, and a `sold` that waits. */
function page(orders: MyOrder[], byName: Record<string, MyOrder>) {
  const saved = { sales: [] as Sale[], tradesSeen: [] as string[] };
  const handling = new Set<string>();
  const calls: { order: string; n: number; answer: (ok: boolean | Error) => void }[] = [];
  const outcomes = new Map<string, SoldLine[] | null>();
  const failures: string[] = [];
  const plain = (t: Trade): TradeSale[] | null => t.offered.map((x) => ({ name: x.name, rank: null, count: x.count, subtype: null, platinumEach: Math.round(t.platinum_received / t.offered.length), order: byName[x.name] ?? null }));
  let salesOf = plain;
  const io: TradeMarking = {
    sales: () => saved.sales,
    setSales: (s) => (saved.sales = s),
    seen: (key) => {
      handling.delete(key);
      saved.tradesSeen = keepSeen([key], saved.tradesSeen, 300, String(SESSION));
    },
    salesOf: (t) => salesOf(t),
    orders: () => orders,
    sold: (o, n) =>
      new Promise((done, fail) =>
        calls.push({ order: o.id, n, answer: (ok) => (ok instanceof Error ? fail(ok) : done(ok ? { quantity: n } : null)) }),
      ),
    outcome: (key, lines) => void outcomes.set(key, lines),
    failed: (key) => void failures.push(key),
    now,
  };
  /** One read of the game log by the trade effect, marking on: what App.svelte does with it. */
  const read = (trades: Trade[]) => {
    const { fresh, recent } = tradesToMark(trades, SESSION, [...saved.tradesSeen, ...handling], now(), false);
    if (!fresh.length) return null;
    const atOnce = seenAtOnce(fresh, recent, SESSION);
    if (atOnce.length) saved.tradesSeen = keepSeen(atOnce, saved.tradesSeen, 300, String(SESSION));
    for (const t of recent) if (!atOnce.includes(tradeKey(SESSION, t))) handling.add(tradeKey(SESSION, t));
    return recent.length ? markTrades(recent, SESSION, io) : null;
  };
  /** Settings as flushSettings would save them now. */
  const snapshot = () => JSON.parse(JSON.stringify(saved)) as typeof saved;
  return { saved, calls, outcomes, failures, read, snapshot, plain, setSalesOf: (f: typeof salesOf) => (salesOf = f) };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

/** Every trade's key is saved with its sales, or neither is. */
function bothOrNeither(s: { sales: Sale[]; tradesSeen: string[] }, trades: Trade[], when: string) {
  for (const t of trades) {
    const key = tradeKey(SESSION, t);
    const seen = s.tradesSeen.includes(key);
    const lines = s.sales.filter((x) => x.trade === key).length;
    assert.equal(seen, lines === t.offered.length, `${when}: trade ${t.uptime} has its key ${seen ? "saved" : "not saved"} and ${lines} of its ${t.offered.length} sales`);
  }
}

test("two trades of two items each, warframe.market slow to answer: settings saved at any moment hold a trade's key and its sales, or neither", async () => {
  const orders = [listing("la", "a", 20), listing("lb", "b", 20), listing("lc", "c", 30), listing("ld", "d", 30)];
  const p = page(orders, { "Example Alpha": orders[0], "Example Bravo": orders[1], "Example Charlie": orders[2], "Example Delta": orders[3] });
  const trades = [trade(100, ["Example Alpha", "Example Bravo"], 40), trade(200, ["Example Charlie", "Example Delta"], 60)];
  const run = p.read(trades);
  assert.ok(run);
  bothOrNeither(p.snapshot(), trades, "the first request out");
  assert.equal(p.calls.length, 1, "one request at a time");
  // The log is read again every two seconds while that waits: nothing is handled twice.
  assert.equal(p.read(trades), null);
  assert.equal(p.calls.length, 1);
  for (let step = 1; p.calls.length >= step; step++) {
    p.calls[step - 1].answer(true);
    await flush();
    bothOrNeither(p.snapshot(), trades, `after answer ${step}`);
    assert.equal(p.read(trades), null, "read again meanwhile: nothing more is handled");
  }
  assert.equal(await run, 4);
  assert.deepEqual(p.calls.map((c) => c.order), ["la", "lb", "lc", "ld"], "each listing marked once");
  const s = p.snapshot();
  assert.equal(s.sales.length, 4, "a sale recorded once");
  assert.ok(s.sales.every((x) => x.lowered?.count === 1 && !x.unmarked), "each says what its marking did");
  assert.deepEqual([...p.outcomes.values()].map((l) => l?.map((x) => x.outcome)), [["marked", "marked"], ["marked", "marked"]]);
});

test("while a trade's marking is out, a Sold click on that listing asks nothing it didn't ask before", async () => {
  const orders = [listing("la", "a", 20)];
  const p = page(orders, { "Example Alpha": orders[0] });
  const trades = [trade(100, ["Example Alpha"], 20)];
  const run = p.read(trades)!;
  assert.equal(p.saved.sales.length, 1, "the sale is in the log already");
  // Neither "one more sold since?" nor "is this that sale?": a "that sale" would close the copy a second time.
  assert.equal(soldQuestion({ id: "la", name: "Example Alpha", rank: null, subtype: null }, p.saved.sales, [], now()), null);
  p.calls[0].answer(false);
  assert.equal(await run, 1);
  // Once it's back, the sale says it couldn't mark it: now the click asks.
  assert.equal(p.saved.sales[0].unmarked?.listing, "la");
  assert.ok(soldQuestion({ id: "la", name: "Example Alpha", rank: null, subtype: null }, p.saved.sales, [], now())?.unmarked);
  assert.deepEqual(p.outcomes.get(tradeKey(SESSION, trades[0]))?.map((x) => x.outcome), ["still listed"]);
});

test("an exception part way through a batch drops nothing after it", async () => {
  const orders = [listing("la", "a", 20), listing("lb", "b", 20), listing("lc", "c", 30)];
  const p = page(orders, { "Example Alpha": orders[0], "Example Bravo": orders[1], "Example Charlie": orders[2] });
  const trades = [trade(100, ["Example Alpha"], 20), trade(200, ["Example Bravo", "Example Charlie"], 50), trade(300, ["Example Charlie"], 30)];
  // The first trade can't be read; in the second, warframe.market's answer for the first item throws.
  const plain = p.plain;
  p.setSalesOf((t) => {
    if (t.uptime === 100) throw new Error("an odd trade");
    return plain(t);
  });
  const run = p.read(trades)!;
  for (let i = 0; i < 3; i++) {
    await flush();
    p.calls[i]?.answer(i === 0 ? new Error("dropped") : true);
  }
  assert.equal(await run, 3);
  assert.deepEqual(p.failures, [tradeKey(SESSION, trades[0]), tradeKey(SESSION, trades[1])]);
  assert.equal(p.outcomes.get(tradeKey(SESSION, trades[0])), null, "its notification goes without a second line");
  assert.deepEqual(p.outcomes.get(tradeKey(SESSION, trades[1]))?.map((x) => x.outcome), ["still listed", "marked"]);
  assert.deepEqual(p.outcomes.get(tradeKey(SESSION, trades[2]))?.map((x) => x.outcome), ["marked"]);
  // Every key is saved; the trade that couldn't be read logged nothing, the others all their lines.
  assert.equal(p.saved.tradesSeen.length, 3);
  assert.deepEqual(p.saved.sales.map((x) => x.item).sort(), ["Example Bravo", "Example Charlie", "Example Charlie"]);
  assert.equal(p.saved.sales.find((x) => x.item === "Example Bravo")?.unmarked?.listing, "lb");
});

test("a trade handled again after a quit (its key not saved, its sales saved) logs and marks nothing more", async () => {
  const orders = [listing("la", "a", 20), listing("lb", "b", 20)];
  const p = page(orders, { "Example Alpha": orders[0], "Example Bravo": orders[1] });
  const trades = [trade(100, ["Example Alpha", "Example Bravo"], 40)];
  const first = p.read(trades)!;
  p.calls[0].answer(true);
  await flush();
  p.calls[1].answer(true);
  await first;
  const sales = p.saved.sales;
  // The key is lost (an older copy of the settings): the trade comes back as fresh.
  p.saved.tradesSeen = [];
  const again = p.read(trades)!;
  assert.equal(await again, 0);
  assert.equal(p.calls.length, 2, "no second request");
  assert.equal(p.saved.sales.length, sales.length, "no second sale");
});

test("the trade effect records at once only the keys it doesn't act on, and hands the rest to markTrades", () => {
  const app = readFileSync(new URL("../src/App.svelte", import.meta.url), "utf8");
  assert.match(app, /tradesToMark\(trades, session, \[\.\.\.settings\.market\.tradesSeen, \.\.\.tradesHandling\]/);
  assert.match(app, /seenAtOnce\(fresh, acting, session\)/);
  assert.match(app, /await markTrades\(trades, session, \{/);
  // Not acted on (marking off, or older than half an hour): recorded at once, as before.
  const t = trade(100, ["Example Alpha"], 20);
  assert.deepEqual(seenAtOnce([tradeKey(SESSION, t), "x|1"], [t], SESSION), ["x|1"]);
  assert.deepEqual(seenAtOnce([tradeKey(SESSION, t)], [], SESSION), [tradeKey(SESSION, t)]);
});
