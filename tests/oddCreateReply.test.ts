// A listing made from an odd reply to `create`, that the next read of the player's listings can't
// read whole. Rust takes the listing as sent when warframe.market's success reply names its id
// but doesn't parse (market.rs › made_order); the same field fails in the list of the player's
// orders, and a list with a row that can't be read is an error, not a shorter list (market.rs ›
// order_rows). The page is then where a failed read leaves it: nothing settled, no approval
// ended, nothing dropped, and Sell spares sends nothing. Every market call is replaced; nothing
// reaches the network.
import "./support/runes";
import { test } from "node:test";
import assert from "node:assert/strict";
import { market, defaultMarketSettings, defaultAdvice, type MarketSettings } from "../src/lib/backend";
import type { MarketItem, MyOrder } from "../src/lib/core/market";
import { buildModel, type Model } from "../src/lib/core/model";
import type { Draft } from "../src/lib/marketStore.svelte";

globalThis.fetch = (() => {
  throw new Error("no network in tests");
}) as never;
const { mkt } = await import("../src/lib/marketStore.svelte");

const me = { id: "me", ingameName: "ExamplePlayer", platform: "pc", crossplay: true } as never;
const MODS = ["Alpha", "Bravo"] as const;
const items: MarketItem[] = MODS.map((n) => ({ id: n.toLowerCase(), slug: `example_${n.toLowerCase()}`, gameRef: `/Example/Mods/${n}`, name: `Example ${n}`, maxRank: 5, subtypes: null, tags: ["mod"] }));

/** An inventory read a minute ago: `held` copies of each mod (unranked), and a mastered weapon. */
function model(held: Record<(typeof MODS)[number], number>): Model {
  const row = (item_id: string, name: string, category: string, quantity: number, mastered = false) => ({ item_id, name, category, quantity, mastered, image_name: null, rank: null, max_rank: null });
  return buildModel({
    observed_at: Math.floor(Date.now() / 1000) - 60,
    inventory: [...MODS.map((n) => row(`/Example/Mods/${n}`, `Example ${n}`, "mod", held[n])), row("/Example/Weapon", "Example Rifle", "weapon", 1, true)],
    catalog: [...MODS.map((n) => ({ uniqueName: `/Example/Mods/${n}`, name: `Example ${n}`, category: "Mods", maxRank: 5 })), { uniqueName: "/Example/Weapon", name: "Example Rifle", category: "Primary", masterable: true }],
    relics: [],
    prices: { prices: Object.fromEntries(MODS.map((n) => [`Example ${n}`, 20])), trade_rate: Object.fromEntries(MODS.map((n) => [`Example ${n}`, [5, 0, ""]])) },
  } as never);
}
const sellers = (platinum: number) => [0, 1, 2].map((i) => ({ id: `b${i}`, type: "sell", platinum, quantity: 1, rank: 0, subtype: null, visible: true, user: { id: `u${i}`, ingameName: `Tenno_${i}`, status: "ingame", platform: "pc", crossplay: true } }));
const listed = (id: string, itemId: string, quantity: number, platinum: number): MyOrder => ({ id, itemId, type: "sell", platinum, quantity, rank: 0, subtype: null, visible: true, updatedAt: null });

/** What Rust gives the page for a list of the player's orders with one row it can't read (market.rs › order_rows). */
const ROW_UNREAD = "warframe.market answered with something MyOrbiter couldn't read: 1 of the 2 rows of your orders couldn't be read";

/** The listing form, opened on one Example Bravo at 20p. */
const bravoDraft = (): Draft => ({ itemId: "bravo", name: "Example Bravo", slug: "example_bravo", platinum: 20, quantity: 1, rank: 0, subtype: null, maxRank: 5, subtypes: null, available: 2, priced: true, inGame: 3, ladder: [20], addToExisting: true, held: [{ rank: 0, subtype: null, count: 4 }], asked: { rank: 0, subtype: null, available: 2 } });

test("a listing taken from an odd reply that the next read can't read: nothing is ended or dropped, and Sell spares sends no create", async () => {
  // The stand-in warframe.market: the player's listings as it holds them, and every write.
  const state = { listings: [listed("a", "alpha", 2, 40)], odd: false, writes: [] as string[] };
  let made = 0;
  market.items = async () => items;
  market.myOrders = async () => {
    // Once the odd listing is up, every read of the player's orders has its row.
    if (state.odd) throw new Error(ROW_UNREAD);
    return state.listings.map((o) => ({ ...o }));
  };
  market.book = (async () => sellers(20)) as never;
  market.create = (async (c: { itemId: string; platinum: number; quantity: number; rank: number | null }) => {
    state.writes.push(`create ${c.itemId} ${c.quantity}x${c.platinum}`);
    // Made, and its reply read as sent (made_order): its row in later reads is the odd one.
    const o = listed(`made${made++}`, c.itemId, c.quantity, c.platinum);
    state.listings.push(o);
    state.odd = true;
    return o;
  }) as never;
  market.update = (async (id: string, c: { quantity?: number; platinum?: number }) => {
    state.writes.push(`update ${id} ${c.quantity}x${c.platinum}`);
    return {} as never;
  }) as never;
  market.remove = (async (id: string) => {
    state.writes.push(`remove ${id}`);
  }) as never;

  mkt.account = { linked: true, backing: "keyring", profile: me, error: null };
  mkt.items = [];
  mkt.orders = [];
  mkt.books = {};
  mkt.log = [];
  mkt.error = null;
  mkt.madeHere.clear();
  const m = model({ Alpha: 2, Bravo: 4 });
  const s: MarketSettings = { ...defaultMarketSettings(), minPrice: 1, minShare: 0 };
  const advice = { ...defaultAdvice(), platPerDucat: 0 };
  mkt.rules = s;
  mkt.model = m;
  await mkt.ensureItems();

  // The player's Alpha listing, approved at 40p by a read that succeeded.
  s.approved = { [mkt.approvalKey({ itemId: "alpha", rank: 0, subtype: null })]: 40 };
  await mkt.refresh(s);
  const owned = JSON.stringify((s as { approvedFor?: unknown }).approvedFor);
  assert.match(owned, /"a":/, "listing a holds its approval");

  // A Sell spares plan shown while the reads still worked: it would list Bravo.
  assert.equal(await mkt.planBulk(m, s, advice), true, mkt.error ?? "");
  assert.ok(mkt.bulk?.actions.some((a) => a.type === "create" && a.item.id === "bravo"), "the plan lists Bravo");
  const orders = mkt.orders;

  // The listing form lists one Bravo; the reply is odd, the listing taken as sent.
  mkt.draft = bravoDraft();
  await mkt.submitDraft();
  assert.deepEqual(state.writes, ["create bravo 1x20"]);
  assert.match(mkt.log[0]?.text ?? "", /^Listed 1× Example Bravo/, "told as listed");
  assert.equal(mkt.draft, null, "the form closed");
  // The read after it fails whole, as a failed read does on main.
  assert.match(mkt.error ?? "", /1 of the 2 rows of your orders couldn't be read/);

  // Nothing ended, nothing dropped: listing a keeps its approval, nothing was moved to the ended
  // list, the last list read stays, and the new listing's approval waits for a read that has it.
  assert.equal(JSON.stringify((s as { approvedFor?: unknown }).approvedFor), owned, "no approval ended or moved");
  assert.equal((s as { approvedGone?: unknown }).approvedGone, undefined, "nothing saved as gone");
  assert.equal(s.approved?.[mkt.approvalKey({ itemId: "alpha", rank: 0, subtype: null })], 40);
  assert.equal(mkt.orders, orders, "the last list read is kept as it was");
  assert.deepEqual(mkt.orders.map((o) => o.id), ["a"]);
  assert.equal(mkt.madeHere.get("me|pc")?.get(mkt.approvalKey({ itemId: "bravo", rank: 0, subtype: null })), 20, "the made listing waits for the read that finds it");

  // Sell spares: its fresh read fails, so nothing is sent; no second Bravo.
  const r = await mkt.applyBulk(m, s, advice);
  assert.deepEqual(r, { sent: 0, failed: 0, outcome: "stopped" });
  assert.deepEqual(state.writes, ["create bravo 1x20"], "Sell spares sent nothing");
  assert.match(mkt.error ?? "", /^Nothing changed: your listings couldn't be read first/);
  assert.equal(JSON.stringify((s as { approvedFor?: unknown }).approvedFor), owned);

  // A second click: the form closed with "Listed", so the same click sends nothing ...
  await mkt.submitDraft();
  assert.deepEqual(state.writes, ["create bravo 1x20"]);
  // ... but the form opened again on Bravo works from the last list read, which hasn't the new
  // listing: it sends a second create. Known (no page code for it in this task). On main the odd
  // reply was an error: the form stayed open on it, and the same click sent the create again.
  mkt.draft = bravoDraft();
  await mkt.submitDraft();
  assert.deepEqual(state.writes, ["create bravo 1x20", "create bravo 1x20"]);
});
