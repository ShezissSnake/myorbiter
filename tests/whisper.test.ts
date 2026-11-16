// The whisper to another player found on warframe.market: the site's copy/paste message word for
// word (its template, app.order.clipboard.template), then the application's name, as the site's
// terms ask; built in one place (core/whisper.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { APP_NAME, NO_WHISPER, tradeWhisper } from "../src/lib/core/whisper";
import { buildModel } from "../src/lib/core/model";
import { dealFromOrder, findDeals, type Watch } from "../src/lib/core/deals";
import { cheapestSeller } from "../src/lib/core/buildsPage";
import { indexItems, type BookOrder } from "../src/lib/core/market";
import type { Bundle } from "../src/lib/core/types";

/**
 * The site's English template, filled in as its message format does: each optional part is left
 * out when it isn't given. Written out from the template, apart from the code under test.
 */
function site(v: { name: string; action: "buy" | "sell"; perTrade?: number; subtype?: string; item: string; rank?: number; ayatan?: string; price: number }) {
  return `/w ${v.name} Hi! I want to ${v.action}: ${v.perTrade != null ? `x${v.perTrade} ` : ""}"${v.subtype != null ? `${v.subtype} ` : ""}${v.item}${v.rank != null ? ` (rank ${v.rank})` : ""}${v.ayatan != null ? ` ${v.ayatan}` : ""}" for ${v.price} platinum. (warframe.market)`;
}
const withName = (s: string) => `${s} (${APP_NAME})`;

test("the message is the site's, part for part, with the application's name after it", () => {
  assert.equal(APP_NAME, "MyOrbiter");
  assert.equal(tradeWhisper({ player: "Seller1", action: "buy", item: "Mesa Prime Neuroptics", platinum: 22 }), withName(site({ name: "Seller1", action: "buy", item: "Mesa Prime Neuroptics", price: 22 })));
  assert.equal(
    tradeWhisper({ player: "Seller1", action: "buy", item: "Mesa Prime Neuroptics", platinum: 22 }),
    '/w Seller1 Hi! I want to buy: "Mesa Prime Neuroptics" for 22 platinum. (warframe.market) (MyOrbiter)',
  );
  // A rank, a variant (before the name, as the site writes it), a quantity per trade, stars.
  assert.equal(tradeWhisper({ player: "S", action: "buy", item: "Serration", platinum: 9, rank: 0 }), withName(site({ name: "S", action: "buy", item: "Serration", rank: 0, price: 9 })));
  assert.equal(tradeWhisper({ player: "S", action: "buy", item: "Axi A1 Relic", platinum: 4, subtype: "radiant" }), withName(site({ name: "S", action: "buy", subtype: "radiant", item: "Axi A1 Relic", price: 4 })));
  assert.equal(tradeWhisper({ player: "S", action: "buy", item: "Nitain Extract", platinum: 3, perTrade: 10 }), withName(site({ name: "S", action: "buy", perTrade: 10, item: "Nitain Extract", price: 3 })));
  assert.equal(
    tradeWhisper({ player: "S", action: "buy", item: "Ayatan Anasa Sculpture", platinum: 12, cyanStars: 2, amberStars: 2 }),
    withName(site({ name: "S", action: "buy", item: "Ayatan Anasa Sculpture", ayatan: "(2 cyan, 2 amber)", price: 12 })),
  );
  assert.equal(tradeWhisper({ player: "B", action: "sell", item: "Arcane Energize", platinum: 40, rank: 5 }), withName(site({ name: "B", action: "sell", item: "Arcane Energize", rank: 5, price: 40 })));
  // Nothing of the site's part is changed: it's a prefix of the message, the name only after it.
  const m = tradeWhisper({ player: "S", action: "buy", item: "Serration", platinum: 9, rank: 10 })!;
  assert.ok(m.startsWith(site({ name: "S", action: "buy", item: "Serration", rank: 10, price: 9 })));
  assert.equal(m.slice(site({ name: "S", action: "buy", item: "Serration", rank: 10, price: 9 }).length), " (MyOrbiter)");
});

// ---- Each builder, against the site's format.

const me = { id: "me", platform: "pc", crossplay: true };
const user = (n: string) => ({ id: n, ingameName: n, status: "ingame", platform: "pc", crossplay: true }) as BookOrder["user"];
const sell = (who: string, platinum: number, x: Partial<BookOrder> = {}): BookOrder => ({ id: who, type: "sell", platinum, quantity: 1, rank: null, subtype: null, visible: true, user: user(who), ...x });
const bundle: Bundle = { observed_at: 1, inventory: [], catalog: [], relics: [], prices: { prices: { "Mesa Prime Neuroptics": 40, "Axi A1 Relic": 30 }, max_rank_prices: {} } };
const index = indexItems([
  { id: "a", slug: "mesa_prime_neuroptics", gameRef: null, name: "Mesa Prime Neuroptics", maxRank: null, subtypes: null, tags: null },
  { id: "r", slug: "axi_a1_relic", gameRef: null, name: "Axi A1 Relic", maxRank: null, subtypes: ["intact", "exceptional", "flawless", "radiant"], tags: ["relic"] },
]);

test("Home's cheap buys (findDeals): the site's message for the cheapest seller in game", () => {
  const m = buildModel(bundle);
  const watch: Watch[] = [
    { name: "Mesa Prime Neuroptics", kind: "part", rank: null, why: "x" },
    { name: "Axi A1 Relic", kind: "alert", rank: null, subtype: "radiant", why: "y", maxPrice: 10 },
  ];
  const deals = findDeals(m, index, { mesa_prime_neuroptics: [sell("Cheap", 22), sell("Dear", 35)], axi_a1_relic: [sell("Rad", 6, { subtype: "radiant" }), sell("Int", 3, { subtype: "intact" })] }, watch, me);
  const mesa = deals.find((d) => d.slug === "mesa_prime_neuroptics")!;
  assert.equal(mesa.whisper, withName(site({ name: "Cheap", action: "buy", item: "Mesa Prime Neuroptics", price: 22 })));
  const relic = deals.find((d) => d.slug === "axi_a1_relic");
  assert.ok(relic, "the radiant relic at 6p is under its 10p alert");
  assert.equal(relic!.whisper, withName(site({ name: "Rad", action: "buy", subtype: "radiant", item: "Axi A1 Relic", price: 6 })));
});

test("a deal from the live feed (dealFromOrder): the site's message for that order", () => {
  const m = buildModel(bundle);
  const watch = new Map<string, Watch>([["mesa_prime_neuroptics", { name: "Mesa Prime Neuroptics", kind: "part", rank: null, why: "x" }]]);
  const d = dealFromOrder(m, index, { id: "f", type: "sell", platinum: 21, itemId: "a", user: { ingameName: "Feed1", id: "f1", status: "ingame", platform: "pc", crossplay: true } }, watch, me)!;
  assert.equal(d.whisper, withName(site({ name: "Feed1", action: "buy", item: "Mesa Prime Neuroptics", price: 21 })));
  const bulk = dealFromOrder(m, index, { id: "g", type: "sell", platinum: 20, perTrade: 3, itemId: "a", user: { ingameName: "Feed2", id: "f2", status: "ingame", platform: "pc", crossplay: true } }, watch, me)!;
  assert.equal(bulk.whisper, withName(site({ name: "Feed2", action: "buy", perTrade: 3, item: "Mesa Prime Neuroptics", price: 20 })));
});

test("a build's missing mod or arcane (cheapestSeller on Builds): the site's message for the cheapest seller", () => {
  const s = cheapestSeller([sell("First", 9, { rank: 0 }), sell("Second", 12, { rank: 0 })], "Serration", 0, null)!;
  assert.equal(s.whisper, withName(site({ name: "First", action: "buy", item: "Serration", rank: 0, price: 9 })));
  const plain = cheapestSeller([sell("P", 7)], "Mesa Prime Neuroptics", null, null)!;
  assert.equal(plain.whisper, withName(site({ name: "P", action: "buy", item: "Mesa Prime Neuroptics", price: 7 })));
});

// ---- Only to the player shown, and one line.

test("where no whisper is built, the player reads that MyOrbiter builds none, not what a name can be", () => {
  assert.match(NO_WHISPER, /MyOrbiter/);
  assert.doesNotMatch(NO_WHISPER, /in-game name|can't be|cannot be|start/i);
});

test("a name that can't be an in-game name gives no whisper: never to someone else, never two lines", () => {
  const o = { action: "buy" as const, item: "Serration", platinum: 9 };
  // A space would send it to "Other", with the rest as the message.
  const spaced = tradeWhisper({ ...o, player: "Other Hi" });
  assert.ok(!spaced?.startsWith("/w Other Hi"), String(spaced));
  assert.equal(spaced, null);
  // A line break would make a paste of several lines, the second a command of its own.
  assert.equal(tradeWhisper({ ...o, player: "Seller1\n/w Other" }), null);
  assert.equal(tradeWhisper({ ...o, player: "Seller1\r" }), null);
  const rlo = String.fromCodePoint(0x202e);
  for (const player of ["", " ", "?", "Seller1 ", "a/b", `Sel${rlo}ler`, "x".repeat(41)]) {
    assert.equal(tradeWhisper({ ...o, player }), null, JSON.stringify(player));
  }
  // Names of letters, digits, "_", "-" and ".", up to 40, whatever the first character (the app's own rule).
  for (const player of ["Seller1", "Alpha_1", "Beta-2", "Gamma.3", "x", "x".repeat(40), "-Name-", "_Name_", ".dot", "-"]) {
    const m = tradeWhisper({ ...o, player });
    assert.ok(m?.startsWith(`/w ${player} Hi! I want to buy: `), String(m));
    assert.ok(!/[\r\n]/.test(m!), m!);
  }
  // Each builder: no whisper for such a seller, the seller still named.
  const s = cheapestSeller([sell("Other Hi", 5)], "Mesa Prime Neuroptics", null, null)!;
  assert.equal(s.name, "Other Hi");
  assert.equal(s.whisper, null);
  const m = buildModel(bundle);
  const watch = new Map<string, Watch>([["mesa_prime_neuroptics", { name: "Mesa Prime Neuroptics", kind: "part", rank: null, why: "x" }]]);
  const d = dealFromOrder(m, index, { id: "f", type: "sell", platinum: 21, itemId: "a", user: { ingameName: "Two Words", id: "f1", status: "ingame", platform: "pc", crossplay: true } }, watch, me);
  assert.ok(d, "the deal is still shown");
  assert.equal(d!.seller, "Two Words");
  assert.equal(d!.whisper, null);
});

test("a whisper is one line whatever the site sends in any field, not only the name", () => {
  const rlo = String.fromCodePoint(0x202e);
  const m = tradeWhisper({
    player: "Seller1",
    action: "buy",
    item: `Ash Prime\r\n/w Other ${rlo}hi`,
    platinum: "9\n/w Third" as unknown as number,
    subtype: "intact\n/w Other hi",
  });
  assert.ok(m, "still a whisper: the name is one an in-game name can be");
  assert.ok(!/[\r\n\u2028\u2029]/.test(m!), JSON.stringify(m));
  assert.ok(!m!.includes(rlo), JSON.stringify(m));
  assert.equal(m, `/w Seller1 Hi! I want to buy: "intact /w Other hi Ash Prime /w Other hi" for 9 /w Third platinum. (warframe.market) (${APP_NAME})`);
  assert.equal(tradeWhisper({ player: "Seller1", action: "buy", item: "Ash Prime", platinum: 9, subtype: "x\u2028y" }), `/w Seller1 Hi! I want to buy: "x y Ash Prime" for 9 platinum. (warframe.market) (${APP_NAME})`);
});

// ---- No message built anywhere else.

test("no whisper to a warframe.market player is built outside core/whisper.ts", () => {
  const root = fileURLToPath(new URL("../src", import.meta.url));
  const files = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? files(join(d, f)) : /\.(ts|svelte)$/.test(f) ? [join(d, f)] : []));
  // The shape of the site's message: a whisper command in a string or template, its greeting, its tag.
  const shapes = [/["'`]\/w\s/, /Hi! I want to/, /\(warframe\.market\)["'`]/, /I want to (?:buy|sell): /];
  const outside = files(root)
    .filter((f) => !f.endsWith(join("core", "whisper.ts")))
    .flatMap((f) => {
      // Code only: a comment may name the command (redact.ts says what it hides from a log).
      const text = readFileSync(f, "utf8")
        .split("\n")
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join("\n");
      return shapes.filter((s) => s.test(text)).map((s) => `${relative(root, f)}: ${s}`);
    });
  assert.deepEqual(outside, []);
});
