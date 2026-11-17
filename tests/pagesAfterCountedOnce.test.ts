// After copies are counted once, the pages say it: Orders asks before a change that goes unchecked
// in Full mode before the first inventory read; the listing form's "You can spare N" and Orders'
// "N spare" are never more than the last check lets go; Sell again names what it takes off the
// never-sell list; Item details and Find anything say "Never sold" across a set; and a plan line
// Apply never sends says it's left as listed. What the last check lets through doesn't change.
// Every market call is replaced; nothing reaches the network. The core functions are imported in
// each test, so each one fails on its own where the code is missing.
import "./support/runes";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildModel, type Model } from "../src/lib/core/model";
import { indexItems, type BookOrder, type MarketItem, type MyOrder } from "../src/lib/core/market";
import { defaultAdvice, defaultMarketSettings, market } from "../src/lib/backend";
import { defaultSellChoices } from "../src/lib/core/spares";
import { defaultSparesRules, withNeverSell, type SparesRules } from "../src/lib/core/sparesRules";
import type { Bundle, CatalogItem, InventoryRow } from "../src/lib/core/types";

globalThis.fetch = (() => {
  throw new Error("test: no network");
}) as never;
const { mkt } = await import("../src/lib/marketStore.svelte");
const guard = () => import("../src/lib/core/listGuard");
const bulk = () => import("../src/lib/core/bulk");
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const NOW = Date.now();
const inv = (item_id: string, name: string, category: string, quantity: number, extra: Partial<InventoryRow> = {}): InventoryRow => ({
  item_id, name, category, quantity, mastered: false, image_name: null, rank: null, max_rank: null, ...extra,
});
const cat = (uniqueName: string, name: string, category: string, extra: Partial<CatalogItem> = {}) => ({ uniqueName, name, category, ...extra }) as CatalogItem;
const order = (id: string, itemId: string, quantity: number, platinum: number, rank: number | null = null, visible = true, subtype: string | null = null): MyOrder => ({
  id, itemId, type: "sell", platinum, quantity, rank, subtype, visible, updatedAt: null,
});
const real = { ...market };

beforeEach(() => {
  Object.assign(market, real);
  mkt.account = { linked: true, backing: "keyring", profile: { id: "me", ingameName: "ExamplePlayer", platform: "pc", crossplay: true }, error: null } as never;
  mkt.orders = [];
  mkt.log = [];
  mkt.op = null;
  mkt.error = null;
  mkt.draft = null;
  mkt.draftError = null;
  mkt.advice = defaultAdvice();
  mkt.fullMode = null;
  mkt.model = null;
});

// ------------------------------------------------------------------ the fixtures

const LATO = "/Lotus/Weapons/Tenno/Pistol/LatoPrime";
const BRONCO = "/Lotus/Weapons/Tenno/Pistol/BroncoPrime";
const B_BARREL = "/Lotus/Types/Recipes/Weapons/WeaponParts/BroncoPrimeBarrel";
const B_BP = "/Lotus/Types/Recipes/Weapons/BroncoPrimeBlueprint";
const B_RECEIVER = "/Lotus/Types/Recipes/Weapons/WeaponParts/BroncoPrimeReceiver";
const PARTS = [
  [B_BARREL, "Bronco Prime Barrel", "barrel"],
  [B_BP, "Bronco Prime Blueprint", "blueprint"],
  [B_RECEIVER, "Bronco Prime Receiver", "receiver"],
] as const;
/** The Bronco Prime built and mastered, and `n` of each part (`barrels` of the barrel). */
const broncoModel = (n = 2, barrels = n): Model =>
  buildModel({
    observed_at: Math.floor(NOW / 1000) - 600,
    inventory: [
      ...PARTS.map(([u, name]) => inv(u, name, "prime_part", u === B_BARREL ? barrels : n)),
      inv(BRONCO, "Bronco Prime", "weapon", 1, { mastered: true }),
      inv(LATO, "Lato Prime", "weapon", 1, { mastered: true }),
    ],
    catalog: [
      cat(BRONCO, "Bronco Prime", "Secondary", {
        masterable: true, isPrime: true,
        components: [
          { uniqueName: B_BARREL, name: "Barrel", ducats: 45, itemCount: 1 },
          { uniqueName: B_BP, name: "Blueprint", ducats: 15, itemCount: 1 },
          { uniqueName: "/Lotus/Types/Items/MiscItems/OrokinCell", name: "Orokin Cell", itemCount: 10 },
          { uniqueName: B_RECEIVER, name: "Receiver", ducats: 15, itemCount: 1 },
        ],
      } as Partial<CatalogItem>),
      cat(LATO, "Lato Prime", "Secondary", { masterable: true }),
    ],
    relics: [],
    prices: {
      prices: { "Bronco Prime Set": 30, ...Object.fromEntries(PARTS.map(([, name]) => [name, 20])) },
      max_rank_prices: {},
      trade_rate: { "Bronco Prime Set": [5, 0, ""], ...Object.fromEntries(PARTS.map(([, name]) => [name, [5, 0, ""]])) },
    },
  } as unknown as Bundle);
const set: MarketItem = { id: "bronco", slug: "bronco_prime_set", gameRef: BRONCO, name: "Bronco Prime Set", maxRank: null, subtypes: null, tags: ["weapon", "prime", "set", "secondary"] };
const parts: MarketItem[] = PARTS.map(([u, name, id]) => ({ id, slug: name.toLowerCase().replace(/ /g, "_"), gameRef: u, name, maxRank: null, subtypes: null, tags: ["weapon", "prime", "component", "secondary"] }));
const barrel = parts[0];
const broncoIndex = indexItems([set, ...parts]);
const broncoCtx = (m = broncoModel(), rules?: SparesRules) => ({ model: m, index: broncoIndex, sell: defaultSellChoices(), advice: defaultAdvice(), now: NOW, rules });
const neverBarrel = { id: "barrel", name: "Bronco Prime Barrel", cat: "prime" as const };
const neverSet = { id: "bronco", name: "Bronco Prime Set", cat: "prime" as const };

// A relic Sell spares keeps: it drops the barrel a second Lex Prime (for Aklex Prime) still needs.
const LEX = { uniqueName: "/W/LexPrime", name: "Lex Prime", category: "Secondary", masterable: true, isPrime: true, components: [
  { uniqueName: "/W/LexPrimeBlueprint", name: "Blueprint", ducats: 15, itemCount: 1 },
  { uniqueName: "/W/LexPrimeBarrel", name: "Barrel", ducats: 45, itemCount: 1 },
  { uniqueName: "/W/LexPrimeReceiver", name: "Receiver", ducats: 15, itemCount: 1 },
] } as CatalogItem;
const AKLEX = { uniqueName: "/W/AklexPrime", name: "Aklex Prime", category: "Secondary", masterable: true, isPrime: true, components: [
  { uniqueName: "/W/AklexPrimeBlueprint", name: "Blueprint", ducats: 15, itemCount: 1 },
  { uniqueName: "/W/AklexPrimeLink", name: "Link", ducats: 15, itemCount: 1 },
  { uniqueName: "/W/LexPrime", name: "Lex Prime", itemCount: 2 },
] } as CatalogItem;
const relicModel = () =>
  buildModel({
    observed_at: Math.floor(NOW / 1000) - 600,
    inventory: [inv("/W/LexPrime", "Lex Prime", "weapon", 1, { mastered: true }), inv("/Relic/L1Bronze", "Lith L1 Intact", "relic", 4)],
    catalog: [LEX, AKLEX],
    relics: [{ uniqueName: "/Relic/L1Bronze", name: "Lith L1 Intact", vaulted: false, rewards: [{ name: "Lex Prime Barrel", rarity: "Rare", chance: 2 }, { name: "Forma Blueprint", rarity: "Common", chance: 98 }] }],
    prices: { prices: { "Lex Prime Barrel": 10, "Lith L1 Relic": 5 }, max_rank_prices: {} },
  } as unknown as Bundle);
const relic: MarketItem = { id: "l1", slug: "lith_l1_relic", name: "Lith L1 Relic", gameRef: "/Relic/L1", maxRank: null, subtypes: ["intact", "exceptional", "flawless", "radiant"], tags: ["relic"] } as MarketItem;
const relicSell = { ...defaultSellChoices(), relicsWorthSelling: true };

const seller = (platinum: number): BookOrder => ({
  id: `b${platinum}`, type: "sell", platinum, quantity: 1, rank: null, subtype: null, visible: true,
  user: { id: `u${platinum}`, ingameName: `Seller${platinum}`, status: "ingame", platform: "pc", crossplay: true },
});
/** The store set up for the listing form: the items, the rules, the model and your listings. */
function store(m: Model, items: MarketItem[], orders: MyOrder[], spares = defaultSparesRules(), sell = defaultSellChoices()) {
  mkt.items = items;
  mkt.rules = { ...defaultMarketSettings(), minPrice: 1, minShare: 0, spares, sellable: sell };
  mkt.model = m;
  mkt.orders = orders;
  mkt.books = {};
  market.book = (async () => [seller(25)]) as never;
}

// ------------------------------------------------------------------ the warning on Orders

test("Orders: a change that offers more copies is told from one that doesn't", async () => {
  const { offersMore } = await guard();
  const o = { quantity: 2, visible: false };
  assert.equal(offersMore(o, { visible: true }), true, "shown again");
  assert.equal(offersMore({ ...o, visible: true }, { quantity: 3 }), true, "a quantity raised");
  assert.equal(offersMore(o, { quantity: 2, platinum: 9 } as never), false, "the same quantity at a new price");
  assert.equal(offersMore({ ...o, visible: true }, { quantity: 1 }), false, "lowered");
  assert.equal(offersMore({ ...o, visible: true }, { visible: false }), false, "hidden");
  // The store's last check holds the same changes (one rule for both).
  assert.match(read("src/lib/marketStore.svelte.ts"), /const raising = offersMore\(o, change\);/);
});

test("Orders: in Full mode before the first read, the show switch and a raise ask first with the form's warning, and send nothing until the answer", () => {
  const page = read("src/lib/tabs/Orders.svelte");
  assert.match(page, /import \{ KEEP_UNCHECKED_WARNING, keepUnchecked, offersMore \} from "\.\.\/core\/listGuard";/);
  assert.match(page, /const unchecked = \$derived\(keepUnchecked\(model, mkt\.fullMode\)\);/);
  // Each path checks before its first send, and goes on only with `sure` (the row's answer).
  const save = /async function save\(o: MyOrder, sure = false\) \{([\s\S]*?)\n {2}\}/.exec(page)?.[1] ?? "";
  assert.ok(save.indexOf("offersMore(o, change)") > 0 && save.indexOf("offersMore(o, change)") < save.indexOf("mkt.update"), "Save asks before it sends");
  assert.match(save, /if \(!sure && unchecked && offersMore\(o, change\)\) \{\s*askUnchecked = \{ id: o\.id, show: false \};\s*return;/);
  const show = /function setVisible\(o: MyOrder, v: boolean, sure = false\) \{([\s\S]*?)\n {2}\}/.exec(page)?.[1] ?? "";
  assert.ok(show.indexOf("offersMore(o, { visible: v })") > 0 && show.indexOf("offersMore(o, { visible: v })") < show.indexOf("mkt.update"), "the switch asks before it sends");
  assert.match(show, /if \(!sure && unchecked && offersMore\(o, \{ visible: v \}\)\) \{\s*askUnchecked = \{ id: o\.id, show: true \};\s*return;/);
  // The row's question: the same line Orders has for "Sold?", the form's sentence word for word,
  // the answer that sends, and the one that doesn't (where the focus starts).
  const row = /\{#if askUnchecked\?\.id === o\.id\}([\s\S]*?)\{\/if\}\s*\{#if held != null/.exec(page)?.[1] ?? "";
  assert.match(row, /<tr class="fixrow unchecked"><td colspan="10">/);
  assert.match(row, /<b class="held">! \{KEEP_UNCHECKED_WARNING\}<\/b>/);
  assert.match(row, /onclick=\{\(\) => setVisible\(o, true, true\)\}[^>]*>Show it anyway<\/button>/);
  assert.match(row, /use:focusIt onclick=\{\(\) => \(askUnchecked = null\)\}[^\n]*>Keep it hidden<\/button>/);
  assert.match(row, /onclick=\{\(\) => save\(o, true\)\}[^>]*>List \{q\} anyway<\/button>/);
  assert.match(row, /use:focusIt onclick=\{\(\) => revert\(o\)\}[^\n]*>Keep \{o\.quantity\}<\/button>/);
  // Enter in the quantity box opens the question, which takes the focus on "Keep": the same key
  // press must stop at the box, or it presses "Keep" and the raise is dropped unasked.
  const key = /function editKey\(o: MyOrder, e: KeyboardEvent\) \{([\s\S]*?)\n {2}\}/.exec(page)?.[1] ?? "";
  const enter = /if \(e\.key === "Enter"\) \{([\s\S]*?)\}/.exec(key)?.[1] ?? "";
  assert.ok(enter.includes("e.preventDefault();") && enter.indexOf("e.preventDefault();") < enter.indexOf("save(o)"), "Enter's key press stops before Save opens the question");
});

test("Orders: the state it asks in is the form's: Full mode on, no inventory read", async () => {
  const { keepUnchecked } = await guard();
  const none = buildModel({ observed_at: null, inventory: [], catalog: [], relics: [], prices: null } as unknown as Bundle);
  assert.equal(keepUnchecked(none, true), true);
  assert.equal(keepUnchecked(none, false), false, "Full mode off: nothing to warn about, the check refuses nothing it could count");
  assert.equal(keepUnchecked(broncoModel(), true), false, "once an inventory is read the keep rules are checked");
});

// ------------------------------------------------------------------ the spare counts

test("spare now: the count the last check makes, with what your other listings took", async () => {
  const { spareNow, guardListing } = await guard();
  const c = broncoCtx();
  // Both sets listed: the barrels inside them aren't free, and the check refuses one.
  const listed = [order("s", "bronco", 2, 30)];
  const now = spareNow(c, barrel, null, null, listed);
  assert.deepEqual(now, { free: 0, same: 0, spare: 0, across: "2 inside your Bronco Prime Set listing", kept: null });
  assert.equal(guardListing(c, { item: barrel, rank: null, subtype: null, quantity: 1, platinum: 20, listed, manual: true }).ok, false);
  // A barrel listed on its own leaves one set to make.
  assert.deepEqual(spareNow(c, set, null, null, [order("b", "barrel", 1, 20)]), { free: 1, same: 0, spare: 1, across: "1 Bronco Prime Barrel listed on its own", kept: null });
  // Its own listing is `same`: the form adds it back for "You can spare N".
  assert.deepEqual(spareNow(c, set, null, null, [order("s", "bronco", 1, 30)]), { free: 1, same: 1, spare: 2, across: null, kept: null });
  // No inventory read: nothing to count, what's typed goes (the form warns in Full mode).
  const none = buildModel({ observed_at: null, inventory: [], catalog: [], relics: [], prices: null } as unknown as Bundle);
  assert.equal(spareNow({ ...c, model: none }, barrel, null, null, []), null);
});

test("spare now: a relic Sell spares keeps is 0, with what's kept", async () => {
  const { spareNow, guardListing } = await guard();
  const c = { model: relicModel(), index: null, sell: relicSell, advice: defaultAdvice() };
  const now = spareNow(c, relic, null, "intact", []);
  assert.equal(now?.free, 0);
  assert.match(now?.kept ?? "", /^4 kept: drops Lex Prime Barrel, which you still need$/);
  assert.equal(guardListing(c, { item: relic, rank: null, subtype: "intact", quantity: 1, platinum: 5, manual: true }).ok, false, "and the last check refuses one");
  // Two already listed: still none to spare, not the two listed.
  const listed = spareNow(c, relic, null, "intact", [order("r", "l1", 2, 5, null, true, "intact")]);
  assert.deepEqual([listed?.free, listed?.same, listed?.spare], [0, 2, 0]);
});

test("the listing form: You can spare N takes off copies your other listings offer, and says what", async () => {
  store(broncoModel(), [set, ...parts], [order("s", "bronco", 2, 30)]);
  await mkt.startListing(broncoModel(), "Bronco Prime Barrel", { unique: B_BARREL, quantity: 2 });
  const d = mkt.draft!;
  assert.equal(d.available, 0, "both barrels are inside the listed sets");
  assert.equal(d.spareWhy, ", less 2 inside your Bronco Prime Set listing");
  // With a hidden set listing too: hidden listings count.
  store(broncoModel(2, 3), [set, ...parts], [order("s", "bronco", 2, 30, null, false)]);
  await mkt.startListing(broncoModel(2, 3), "Bronco Prime Barrel", { unique: B_BARREL, quantity: 3 });
  assert.equal(mkt.draft!.available, 1, "the barrel beyond the two sets");
  assert.equal(mkt.draft!.quantity, 1, "and the form starts there");
  // Never more than the page said.
  store(broncoModel(), [set, ...parts], []);
  await mkt.startListing(broncoModel(), "Bronco Prime Barrel", { unique: B_BARREL, quantity: 1 });
  assert.equal(mkt.draft!.available, 1);
  assert.equal(mkt.draft!.spareWhy ?? null, null);
  // The form prints the words after the number.
  assert.match(read("src/lib/ui/ListDialog.svelte"), /<span class="dim spare">You can spare \{d\.available\}\{d\.spareWhy \?\? ""\}<\/span>/);
});

test("the listing form: a relic Sell spares keeps opens at 0, saying it's kept", async () => {
  const m = relicModel();
  store(m, [relic], [], defaultSparesRules(), relicSell);
  await mkt.startListing(m, "Lith L1 Relic");
  assert.equal(mkt.draft!.subtype, "intact");
  assert.equal(mkt.draft!.available, 0, "it opened with what's held");
  assert.equal(mkt.draft!.spareWhy, " (4 kept: drops Lex Prime Barrel, which you still need)");
});

test("the listing form: another rank or variant is counted the same way", async () => {
  store(broncoModel(), [set, ...parts], [order("s", "bronco", 2, 30)]);
  await mkt.startListing(broncoModel(), "Bronco Prime Barrel", { unique: B_BARREL, quantity: 2 });
  await mkt.retarget();
  assert.equal(mkt.draft!.available, 0);
  assert.equal(mkt.draft!.spareWhy, ", less 2 inside your Bronco Prime Set listing");
});

test("Orders' search: N spare is never more than the last check lets go, a relic it keeps at 0", () => {
  store(broncoModel(), [set, ...parts], [order("s", "bronco", 2, 30)]);
  assert.deepEqual(mkt.spareShown(broncoModel(), barrel, { rank: null, quantity: 2 }), { rank: null, quantity: 0 });
  mkt.orders = [];
  assert.deepEqual(mkt.spareShown(broncoModel(), barrel, { rank: null, quantity: 1 }), { rank: null, quantity: 1 }, "never more than the page's own count");
  const m = relicModel();
  store(m, [relic], [], defaultSparesRules(), relicSell);
  // A relic had no spare count there ("you hold 4"); now it has the last check's.
  assert.deepEqual(mkt.spareShown(m, relic, null), { rank: null, quantity: 0 });
  const page = read("src/lib/tabs/Orders.svelte");
  assert.match(page, /\.slice\(0, 10\)\s*\/\/[^\n]*\n\s*\.map\(\(x\) => \(\{ \.\.\.x, spareShown: mkt\.spareShown\(model, x\.it, x\.spare\) \}\)\);/);
  assert.match(page, /\{x\.spareShown \? `\$\{x\.spareShown\.quantity\} spare of \$\{x\.held\}` : `you hold \$\{x\.held\}`\}/);
});

test("Orders' search to the form: the figure shown is the one the form opens with, and the form says why", async () => {
  const { spareOf } = await import("../src/lib/core/views");
  const m = broncoModel();
  store(m, [set, ...parts], [order("s", "bronco", 2, 30)]);
  // As Orders' search counts the barrel, and as its pick opens the form (the page's own count).
  const page = read("src/lib/tabs/Orders.svelte");
  assert.match(page, /mkt\.startListing\(model, x\.it\.name, sp \? \{ unique: x\.it\.gameRef, rank: sp\.rank, quantity: sp\.quantity \} : \{ unique: x\.it\.gameRef \}\);/);
  assert.match(page, /const sp = x\.spare;/);
  const own = spareOf(m, barrel.name, barrel.tags);
  assert.deepEqual(own, { rank: null, quantity: 2 }, "the page's own count: both barrels");
  const shown = mkt.spareShown(m, barrel, own);
  await mkt.startListing(m, barrel.name, { unique: barrel.gameRef, rank: own!.rank, quantity: own!.quantity });
  assert.equal(mkt.draft!.available, shown!.quantity, "the form opens with the figure the search showed");
  assert.equal(mkt.draft!.spareWhy, ", less 2 inside your Bronco Prime Set listing", "and says what was taken off");
  // A relic: the search had no spare count; the form opens on what's held and cuts it to 0, kept.
  const r = relicModel();
  store(r, [relic], [], defaultSparesRules(), relicSell);
  assert.equal(spareOf(r, relic.name, relic.tags), null);
  await mkt.startListing(r, relic.name, { unique: relic.gameRef });
  assert.equal(mkt.draft!.available, mkt.spareShown(r, relic, null)!.quantity);
  assert.match(mkt.draft!.spareWhy ?? "", /kept: drops Lex Prime Barrel/);
});

test("the Guide says which spare counts take listings off and which don't, that Orders asks first, and Never sold across a set", () => {
  const guide = read("src/lib/tabs/Guide.svelte").replace(/\s+/g, " ");
  assert.ok(!guide.includes("The spare counts on Inventory, the listing form and Orders don't take off copies listed elsewhere."), "the old sentence");
  assert.match(guide, /The listing form's You can spare and the spare count in Orders' New listing take them off too, hidden listings included, and say 0 for a relic Sell spares keeps; Inventory's can spare doesn't: it's what you hold beyond what you keep\./);
  // Orders' question before the first read, and Never sold across a set.
  assert.match(guide, /a reward listed from Current fissure then goes as typed, the form saying it can't check what you keep yet, and showing a hidden listing or raising one's quantity asks first with the same words\)/);
  assert.match(guide, /an item's details and Find anything say Never sold · Sell again too, also for a part of a set you never sell and a set with a part you never sell, naming the entry that holds it\./);
});

// ------------------------------------------------------------------ Sell again names what comes off

test("Sell again across a set: the refusal, the form's line and its button name the entry it takes off", async () => {
  const { guardListing } = await guard();
  const { neverHeld, sellAgainTakes } = await bulk();
  const m = broncoModel();
  const s = guardListing(broncoCtx(m, withNeverSell(defaultSparesRules(), neverBarrel)), { item: set, rank: null, subtype: null, quantity: 1, platinum: 30, manual: true });
  assert.match(!s.ok ? s.why : "", /a set with it inside isn't sold either\. Sell again takes Bronco Prime Barrel off the list$/);
  const b = guardListing(broncoCtx(m, withNeverSell(defaultSparesRules(), neverSet)), { item: barrel, rank: null, subtype: null, quantity: 1, platinum: 20, manual: true });
  assert.match(!b.ok ? b.why : "", /its parts aren't sold on their own either\. Sell again takes Bronco Prime Set off the list$/);
  const two = withNeverSell(withNeverSell(defaultSparesRules(), neverBarrel), { id: "receiver", name: "Bronco Prime Receiver", cat: "prime" });
  const h = neverHeld(two, m, broncoIndex, set)!;
  assert.equal(sellAgainTakes(h, "Bronco Prime Set"), "Take Bronco Prime Barrel and Bronco Prime Receiver off the never-sell list, so Bronco Prime Set can be sold too");
  assert.equal(sellAgainTakes(neverHeld(two, m, broncoIndex, barrel)!, "Bronco Prime Barrel"), "Take Bronco Prime Barrel off the never-sell list");
  // The plan's own Sell again names them too, in its menu.
  assert.match(read("src/lib/tabs/Spares.svelte"), /neverBy: mine \? neverNames\(neverOfId\(id\)!\) : undefined,/);
  assert.match(read("src/lib/ui/spares/PlanReview.svelte"), /note: r\.neverBy \? `Takes \$\{r\.neverBy\} off the never-sell list: in the next plan when it's spare`/);
  const form = read("src/lib/ui/ListDialog.svelte");
  assert.match(form, /\{neverWhy\(never\)\}, so MyOrbiter won't list it\. <button type="button" class="link" title="\{sellAgainTakes\(never, d\.name\)\}: then it can be listed here"[^\n]*?>Sell again<\/button> takes \{neverNames\(never\)\} off the list\.<\/p>/);
  assert.match(form, /onsellagain\(never\.by\.map\(\(b\) => b\.id\)\)/, "and takes those off");
});

// ------------------------------------------------------------------ Never sold across a set

test("Item details and Find anything say Never sold across a set, with what holds it, and Sell again takes that off", () => {
  const tag = read("src/lib/ui/spares/NeverSoldTag.svelte");
  assert.match(tag, /let \{ name, held, onsellagain \}: \{ name: string; held: NeverHeld; onsellagain: \(\) => void \} = \$props\(\);/);
  assert.match(tag, /\{#if !held\.self\}<span class="by small dim">by \{neverNames\(held\)\}<\/span>\{\/if\}/);
  assert.match(tag, /: neverWhy\(held\)\}>/);
  assert.match(tag, /title="\{sellAgainTakes\(held, name\)\}: the next spares plan lists it when it's spare"/);
  const details = read("src/lib/ItemDetails.svelte");
  assert.match(details, /const held = it \? neverHeld\(settings\.market\.spares, model, mkt\.index, it\) : null;/);
  assert.match(details, /<NeverSoldTag name=\{neverItem\.name\} held=\{neverItem\.held\} onsellagain=\{\(\) => \(settings\.market\.spares\.neverSell = withoutNeverSell\(settings\.market\.spares, neverItem!\.held\.by\.map\(\(b\) => b\.id\)\)\.neverSell\)\} \/>/);
  const lookup = read("src/lib/ui/Lookup.svelte");
  assert.match(lookup, /const never = \$derived\(neverTest\(spares, model, mkt\.index\)\);/);
  assert.match(lookup, /<NeverSoldTag name=\{ns\.name\} held=\{ns\.held\} onsellagain=\{\(\) => onsellagain\(ns\.held\.by\.map\(\(b\) => b\.id\)\)\} \/>/);
});

test("Never sold across a set: a part of a never-sell set and a set with a never-sell part are held, by name", async () => {
  const { neverHeld, neverNames, neverWhy } = await bulk();
  const m = broncoModel();
  const h = neverHeld(withNeverSell(defaultSparesRules(), neverSet), m, broncoIndex, barrel)!;
  assert.equal(h.self, false);
  assert.equal(neverNames(h), "Bronco Prime Set");
  assert.equal(neverWhy(h), "Bronco Prime Set is on your never-sell list (Sell spares): its parts aren't sold on their own either");
  const s = neverHeld(withNeverSell(defaultSparesRules(), neverBarrel), m, broncoIndex, set)!;
  assert.equal(neverNames(s), "Bronco Prime Barrel");
});

// ------------------------------------------------------------------ a line Apply never sends

test("Sell spares: a held-back listing's lowering that Apply never sends says it's left as listed, and isn't sent", async () => {
  const { bulkPlan, neverTest, sellTargets, toApply, unsentWhy, AS_LISTED } = await bulk();
  const m = broncoModel(2);
  const rules: SparesRules = { ...defaultSparesRules(), neverSell: [neverBarrel] };
  rules.prime = { ...rules.prime, on: true, sellAs: "sets" };
  const advice = { ...defaultAdvice(), platPerDucat: 0.1 };
  const books = Object.fromEntries([set, ...parts].map((it) => [it.slug, [seller(it === set ? 30 : 20)]]));
  // Three sets listed by hand, two held: the plan lowers it to what you hold, and the barrel on the list holds it back.
  const orders = [order("s", "bronco", 3, 30)];
  const actions = bulkPlan(
    { model: m, index: broncoIndex, orders, me: { id: "me", platform: "pc", crossplay: true }, books, minPrice: 1, minShare: 0, floors: {}, paused: {}, sell: defaultSellChoices(), advice },
    rules,
    sellTargets(m, rules, advice, broncoIndex, defaultSellChoices()),
  );
  const line = actions.find((a) => a.type === "update")!;
  assert.equal(line?.why, "You hold 2 now");
  const never = neverTest(rules, m, broncoIndex);
  assert.equal(toApply(actions, new Set(), never).some((a) => a.type === "update"), false, "Apply doesn't send it");
  assert.equal(unsentWhy(line, true), `You hold 2 now; never sold, so Apply doesn't change it: ${AS_LISTED}`);
  assert.equal(unsentWhy(line, false), null, "a line that goes keeps its words");
  // The page shows that line as left out, with the listing as it is.
  const page = read("src/lib/tabs/Spares.svelte");
  assert.match(page, /const unsent = unsentWhy\(a, mine\);/);
  assert.match(page, /quantity: a\.order\.quantity, each: a\.order\.platinum, why: unsent \}, skipped\), key, out: skipped\.has\(key\) \? "skipped" : "never", neverBy: neverNames\(neverOfId\(id\)!\) \};/);
  // What the page counts as going is what Apply sends.
  assert.match(page, /const sendable = \$derived\(mkt\.bulk \? toApply\(mkt\.bulk\.actions, mkt\.bulk\.skipped, never\) : \[\]\);/);
  assert.match(page, /const changes = \$derived\(sendable\.filter\(\(a\) => a\.type !== "skip"\)\);/);
});
