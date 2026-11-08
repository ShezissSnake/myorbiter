// A day of Apply automatically on the demo account's sell list: how many price changes it sends
// to warframe.market while the market around it moves. The market is simulated (seeded, so every
// run is the same day): sellers come and go between in game, online and offline, change their
// prices now and then, and a bait listing at 1p turns up for a pass from time to time. Nothing
// is sent anywhere: warframe.market's calls are stand-ins that count.
import { settle } from "./support/runes";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { market, defaultAdvice, defaultMarketSettings } from "../src/lib/backend";
import { buildModel } from "../src/lib/core/model";
import type { BookOrder, MyOrder } from "../src/lib/core/market";
import { DRIFT } from "../src/lib/core/drift";

void settle;
const { mkt } = await import("../src/lib/marketStore.svelte");
const read = (f: string) => JSON.parse(readFileSync(new URL(`../demo/${f}`, import.meta.url), "utf8"));

/** A small seeded random source (mulberry32). */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STATUSES = ["ingame", "online", "offline"];
/** Every 5 minutes (the default interval) for a day. */
export const PASS_MINUTES = 5;
export const PASSES = (24 * 60) / PASS_MINUTES;

/** One simulated day: the number of price changes sent, and the most any one listing got. */
export async function simulateDay(seed: number) {
  const rnd = seeded(seed);
  const bundle = read("dev-bundle.json");
  const model = buildModel(bundle, undefined, null, null, [], read("dev-recipe-data.json"));
  const items = read("dev-market-items.json");
  const account = read("dev-market.json");
  const allBooks: Record<string, BookOrder[]> = read("dev-books.json");
  let mine: MyOrder[] = account.orders.map((o: MyOrder) => ({ ...o }));
  const slugs = new Set(mine.map((o) => items.find((i: { id: string }) => i.id === o.itemId)?.slug).filter(Boolean));
  const books: Record<string, BookOrder[]> = Object.fromEntries([...slugs].map((s) => [s, structuredClone(allBooks[s as string] ?? [])]));
  const bait = new Set<string>();

  const real = { ...market };
  const realNow = Date.now;
  let now = Date.parse("2026-11-08T00:00:00Z");
  Date.now = () => now;
  const perListing = new Map<string, number>();
  let writes = 0;
  // Each price sent under the cheapest real seller (no bait) who was online or in game then.
  const under: string[] = [];
  const slugOf = (itemId: string) => items.find((i: { id: string }) => i.id === itemId)?.slug as string | undefined;
  try {
    market.items = async () => items;
    market.myOrders = async () => mine.map((o) => ({ ...o }));
    market.book = async (slug: string) => structuredClone(books[slug] ?? []) as never;
    market.update = (async (id: string, c: { platinum?: number }) => {
      writes++;
      perListing.set(id, (perListing.get(id) ?? 0) + 1);
      const o = mine.find((x) => x.id === id);
      const slug = o && slugOf(o.itemId);
      if (o && slug && c.platinum != null) {
        const real = (books[slug] ?? []).filter((b) => b.type === "sell" && !bait.has(b.id) && b.user.status !== "offline" && (b.rank ?? null) === (o.rank ?? null) && (b.subtype ?? null) === (o.subtype ?? null) && b.user.id !== account.account?.profile?.id);
        const cheapest = Math.min(...real.map((b) => b.platinum));
        if (c.platinum < cheapest) under.push(`${slug} ${o.platinum}p → ${c.platinum}p (cheapest real seller ${cheapest}p)`);
      }
      mine = mine.map((o) => (o.id === id && c.platinum != null ? { ...o, platinum: c.platinum } : o));
      return {} as never;
    }) as never;
    mkt.account = account.account;
    mkt.orders = [];
    mkt.ordersAt = null;
    mkt.passFailures = 0;
    mkt.lastPass = null;
    mkt.log = [];
    mkt.op = null;
    mkt.pass = null;
    mkt.advice = { ...defaultAdvice() };
    const s = { ...defaultMarketSettings(), auto: true, autoCheck: true };
    for (let pass = 0; pass < PASSES; pass++) {
      // The market moves between passes.
      for (const slug of Object.keys(books)) {
        books[slug] = books[slug].filter((o) => !bait.has(o.id));
        for (const o of books[slug]) {
          if (o.type !== "sell") continue;
          if (rnd() < 0.08) o.user = { ...o.user, status: STATUSES[Math.floor(rnd() * 3)] };
          if (rnd() < 0.04) o.platinum = Math.max(1, o.platinum + [-3, -2, -1, 1, 2, 3][Math.floor(rnd() * 6)]);
        }
        if (rnd() < 0.02) {
          const id = `bait-${pass}-${slug}`;
          bait.add(id);
          const like = books[slug].find((o) => o.type === "sell");
          books[slug].push({ id, type: "sell", platinum: 1, quantity: 1, rank: like?.rank ?? null, subtype: like?.subtype ?? null, visible: true, user: { id: `baiter-${pass}`, ingameName: "Bait", status: "ingame", platform: "pc", crossplay: true } });
        }
      }
      mkt.books = {};
      await mkt.reprice(model, s, true, true);
      now += PASS_MINUTES * 60_000;
    }
  } finally {
    Object.assign(market, real);
    Date.now = realNow;
    mkt.advice = null;
  }
  return { writes, listings: mine.length, most: Math.max(0, ...perListing.values()), under };
}

// Measured on these three days (seeds 1–3): before the drift rules, 214, 237 and 197 changes,
// up to 44 on one listing; with them, 32, 32 and 31, never more than 6 on one.
test("a day of Apply automatically on the demo sell list: never more than six changes a listing, never following bait", async () => {
  const days = [];
  for (const seed of [1, 2, 3]) days.push(await simulateDay(seed));
  for (const d of days) console.log(`# ${d.writes} changes in a day across ${d.listings} listings (most on one listing: ${d.most})`);
  for (const d of days) {
    assert.equal(d.listings, 12);
    assert.ok(d.most <= DRIFT.perDay, `${d.most} changes to one listing`);
    assert.ok(d.writes <= d.listings * DRIFT.perDay);
    // A bait listing never sets the price: nothing goes under the cheapest real seller online or in game.
    assert.deepEqual(d.under, []);
    // The measured days were 31 and 32 (214, 237 and 197 before the drift rules); room for a
    // little change in the demo's books, not for the rules to stop holding.
    assert.ok(d.writes <= 40, `${d.writes} changes in a day`);
  }
});
