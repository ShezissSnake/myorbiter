// Riven auctions: a reprice sends back what it read (only the price changes), and Sell sends once.
import "./support/runes";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { market } from "../src/lib/backend";
import { auctionOf, parseMyAuctions, type AuctionItem, type Riven, type RivenMeta } from "../src/lib/core/rivens";

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
  Object.assign(rivens as unknown as object, { unchecked: false, sending: [], notFound: [] });
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

test("a create that worked, then a failed read: Sell again within half a minute reads first and sends nothing", async () => {
  let creates = 0;
  let readable = true;
  market.myAuctions = async () => {
    if (!readable) throw new Error(TIMED_OUT);
    return [];
  };
  market.createAuction = (async () => {
    creates++;
    readable = false; // made, and the read after it fails
  }) as never;
  await rivens.sell(item, 100, 100);
  assert.equal(creates, 1);
  await assert.rejects(rivens.sell(item, 100, 100), /could not check the auctions already up/);
  assert.equal(creates, 1);
});

// ------------------------------------------------------------------ one riven, one auction

/** Creates that stay out until `answer` is called (made or not), as on a slow site. */
function slowCreate() {
  const sent: AuctionItem[] = [];
  const out: ((made: boolean) => void)[] = [];
  market.createAuction = ((body: { item: AuctionItem }) => {
    sent.push(body.item);
    return new Promise<void>((ok, fail) => out.push((made) => (made ? ok() : fail(new Error("warframe.market rejected the request: 400 bad request")))));
  }) as never;
  /** Answers every create still out. */
  const answer = (made: boolean) => out.splice(0).forEach((f) => f(made));
  return { sent, answer };
}
const settle = () => new Promise((r) => setTimeout(r, 0));
const twin: AuctionItem = { ...item, attributes: [{ ...attrs[0], value: 132.1 }, { ...attrs[1], value: -51.7 }], re_rolls: 5 };

test("a second Sell for the same riven while the first create has no answer yet sends nothing; once it has ended, Sell works as before", async () => {
  market.myAuctions = async () => [];
  const create = slowCreate();
  const first = rivens.sell(item, 100, 100);
  await settle();
  assert.equal(create.sent.length, 1);
  // The form was cancelled and a new one opened: the store refuses, with no read and no create.
  let reads = 0;
  market.myAuctions = async () => (reads++, []);
  const again = assert.rejects(rivens.sell(item, 100, 100), /still being put up/);
  const reordered = assert.rejects(rivens.sell({ ...item, attributes: [...attrs].reverse() }, 100, 100), /still being put up/, "the same riven, its stats in another order");
  await settle();
  assert.equal(create.sent.length, 1, "one create, not two");
  assert.equal(reads, 0);
  await again;
  await reordered;
  // The first ends (not made: the site said so); a new Sell sends again.
  create.answer(false);
  await assert.rejects(first, /rejected/);
  const second = rivens.sell(item, 100, 100);
  await settle();
  assert.equal(create.sent.length, 2);
  create.answer(true);
  await second;
});

test("a second Sell is refused during the look after a failed create too, until that look has ended", async () => {
  let creates = 0;
  const looks: ((v: unknown[]) => void)[] = [];
  let reads = 0;
  market.myAuctions = (() => (reads++ === 0 ? Promise.resolve([]) : new Promise((ok) => looks.push(ok)))) as never;
  market.createAuction = (async () => {
    creates++;
    throw new Error(TIMED_OUT);
  }) as never;
  const first = assert.rejects(rivens.sell(item, 100, 100), /timed out/);
  await settle();
  assert.equal(reads, 2, "the look after the failed create is out");
  const second = assert.rejects(rivens.sell(item, 100, 100), /still being put up/);
  await settle();
  assert.equal(creates, 1, "one create, not two");
  looks.splice(0).forEach((f) => f([]));
  await first;
  await second;
});

test("while one riven is being put up, another of the same weapon and name can be", async () => {
  market.myAuctions = async () => [];
  const create = slowCreate();
  const first = rivens.sell(item, 100, 100, "", 0, [twin]);
  await settle();
  const second = rivens.sell(twin, 100, 100, "", 0, [item]);
  await settle();
  assert.equal(create.sent.length, 2);
  create.answer(true);
  await Promise.all([first, second]);
});

test("after a create that got no answer and was not found, the next Sell reads first, however fresh the list, and sends nothing if that read fails", async () => {
  let creates = 0;
  let reads = 0;
  let readable = true;
  market.myAuctions = async () => {
    reads++;
    if (!readable) throw new Error(TIMED_OUT);
    return [];
  };
  market.createAuction = (async () => {
    creates++;
    throw new Error(TIMED_OUT);
  }) as never;
  await assert.rejects(rivens.sell(item, 100, 100), /timed out/);
  assert.equal(creates, 1);
  // The look after it worked and did not show the riven; the list is seconds old.
  readable = false;
  await assert.rejects(rivens.sell(item, 100, 100), /could not check the auctions already up/);
  assert.equal(creates, 1, "nothing sent without a read");
  // That read works and doesn't show it: it is sent again (what the site makes after this read can't be seen from here).
  readable = true;
  reads = 0;
  await assert.rejects(rivens.sell(item, 100, 100), /timed out/);
  assert.equal(reads, 2, "a read before the create, and the look after it");
  assert.equal(creates, 2);
});

test("after a create that got no answer and was not found, the next Sell reads first and finds it if it was made later", async () => {
  let creates = 0;
  let made = false;
  market.myAuctions = async () => (made ? [raw("late")] : []) as never;
  market.createAuction = (async () => {
    creates++;
    throw new Error(TIMED_OUT);
  }) as never;
  await assert.rejects(rivens.sell(item, 100, 100), /timed out/);
  made = true; // the site made it after the look
  await assert.rejects(rivens.sell(item, 100, 100), /already up/);
  assert.equal(creates, 1);
});

test("two rivens of one weapon with one name can both be put up, and neither twice", async () => {
  let creates = 0;
  let up: ReturnType<typeof raw>[] = [raw("first")];
  market.myAuctions = async () => up as never;
  market.createAuction = (async (body: { item: AuctionItem }) => {
    creates++;
    up = [...up, raw(`n${creates}`, body.item)];
  }) as never;
  await rivens.sell(twin, 100, 100, "", 0, [item]);
  assert.equal(creates, 1, "the twin goes up beside the first");
  rivens.mineAt = null;
  await assert.rejects(rivens.sell(item, 100, 100, "", 0, [twin]), /already up/);
  rivens.mineAt = null;
  await assert.rejects(rivens.sell(twin, 100, 100, "", 0, [item]), /already up/);
  assert.equal(creates, 1);
});

test("an auction the site gives back with values rounded another way still counts as this riven being up, for it and for its twin", async () => {
  let creates = 0;
  const rounded = raw("first", { attributes: [{ ...attrs[0], value: 151 }, { ...attrs[1], value: -40 }] });
  market.myAuctions = async () => [rounded] as never;
  market.createAuction = (async () => void creates++) as never;
  await assert.rejects(rivens.sell(item, 100, 100, "", 0, [twin]), /already up/);
  rivens.mineAt = null;
  await assert.rejects(rivens.sell(twin, 100, 100, "", 0, [item]), /already up/, "it can't be told from the twin: neither goes");
  // An auction that carries no stats at all can't be told apart either.
  market.myAuctions = async () => [{ id: "bare", closed: false, item: { type: "riven", weapon_url_name: "braton", name: "visi-critatis" } }] as never;
  rivens.mineAt = null;
  await assert.rejects(rivens.sell(twin, 100, 100, "", 0, [item]), /already up/);
  assert.equal(creates, 0);
});

test("the card's up-for-sale mark tells two rivens of one name apart the same way", () => {
  const meta: RivenMeta = {
    weapons: [{ slug: "braton", gameRef: "/W/Braton", name: "Braton", group: "primary", rivenType: "rifle" }],
    attributes: [
      { slug: "critical_chance", gameRef: "WeaponCritChanceMod", name: "Critical Chance", unit: "percent" },
      { slug: "damage_vs_grineer", gameRef: "WeaponFactionDamageGrineer", name: "Damage to Grineer", unit: "percent" },
    ],
  };
  const stat = (tag: string, value: number, buff: boolean) => ({ tag, label: tag, display: "", value, buff, quality: 0.5, grade: "B", spliced: false });
  const card = (id: string, cc: number, rerolls: number): Riven => ({
    id, type: "LotusRifleRandomModRare", kind: "Rifle", weapon: "Braton", weaponUnique: "/W/Braton", image: null, name: "Visi-Critatis", rank: 0, rerolls, mastery: 8, polarity: "madurai",
    stats: [stat("WeaponCritChanceMod", cc, true), stat("WeaponFactionDamageGrineer", -0.402, false)], quality: 0.5, grade: "B", spliced: false, companion: false,
  });
  const a = card("a", 1.505, 2);
  const b = card("b", 1.321, 5);
  const listed = parseMyAuctions([raw("up")]);
  assert.equal(auctionOf(meta, a, listed, [a, b])?.id, "up");
  assert.equal(auctionOf(meta, b, listed, [a, b]), undefined, "the twin isn't marked as up");
  const rounded = parseMyAuctions([raw("up", { attributes: [{ ...attrs[0], value: 151 }, attrs[1]] })]);
  assert.equal(auctionOf(meta, a, rounded, [a, b])?.id, "up");
  assert.equal(auctionOf(meta, b, rounded, [a, b])?.id, "up", "one that can't be told apart marks both");
  assert.equal(auctionOf(meta, b, listed)?.id, "up", "without the other rivens, weapon and name as before");
});

test("when the read before a Sell fails, the message gives its reason", async () => {
  let creates = 0;
  market.createAuction = (async () => void creates++) as never;
  const at = Date.UTC(2026, 0, 1, 14, 5);
  market.myAuctions = async () => {
    throw new Error(`warframe.market asked us to wait until ${at}`);
  };
  await assert.rejects(rivens.sell(item, 100, 100), (e: Error) => /could not check the auctions already up on warframe\.market, so nothing was sent/.test(e.message) && /asked us to wait until \d\d:\d\d/.test(e.message) && !e.message.includes(String(at)));
  market.myAuctions = async () => {
    throw new Error("Not signed in to warframe.market");
  };
  await assert.rejects(rivens.sell(item, 100, 100), /nothing was sent.*not signed in to warframe\.market/i);
  assert.equal(creates, 0);
});
