// Which relics Sell spares keeps back: one that drops a part still needed by the rule Prime parts
// keeps copies by (partNeeded), the one Relics tags "need" and Planner's "Parts I need" count by,
// so a relic needed only for an Ak weapon's second copy is kept too.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildModel, type Model } from "../src/lib/core/model";
import { defaultSellChoices, relicsYouNeed, spareRows } from "../src/lib/core/spares";
import { provenSpare, sellTargets } from "../src/lib/core/bulk";
import { indexItems, type MarketItem } from "../src/lib/core/market";
import { defaultAdvice } from "../src/lib/backend";
import { defaultSparesRules, SPARE_CATEGORIES } from "../src/lib/core/sparesRules";
import { relicRows } from "../src/lib/core/views";
import type { Bundle, CatalogItem, InventoryRow } from "../src/lib/core/types";

const inv = (item_id: string, name: string, category: string, quantity: number, extra: Partial<InventoryRow> = {}): InventoryRow => ({
  item_id, name, category, quantity, mastered: false, image_name: null, rank: null, max_rank: null, ...extra,
});

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
const RELICS = [
  { uniqueName: "/Relic/L1Bronze", name: "Lith L1 Intact", vaulted: false, rewards: [{ name: "Lex Prime Barrel", rarity: "Rare", chance: 2 }, { name: "Forma Blueprint", rarity: "Common", chance: 98 }] },
  { uniqueName: "/Relic/L1Platinum", name: "Lith L1 Radiant", vaulted: false, rewards: [{ name: "Lex Prime Barrel", rarity: "Rare", chance: 10 }, { name: "Forma Blueprint", rarity: "Common", chance: 90 }] },
] as Bundle["relics"];

/** Lex Prime as held (built, mastered, or not), Aklex Prime never built, four Lith L1 relics that sell for more than a crack. */
function model(lex: InventoryRow[]): Model {
  const b = {
    observed_at: 1_700_000_000,
    inventory: [...lex, inv("/Relic/L1Bronze", "Lith L1 Intact", "relic", 4)],
    catalog: [LEX, AKLEX],
    relics: RELICS,
    // A crack: 2% of a 10p barrel = 0.2p, well under the 5p a relic sells for.
    prices: { prices: { "Lex Prime Barrel": 10, "Lith L1 Relic": 5 }, max_rank_prices: {} },
  } as unknown as Bundle;
  return buildModel(b);
}
const built = [inv("/W/LexPrime", "Lex Prime", "weapon", 1)];
const mastered = [inv("/W/LexPrime", "Lex Prime", "weapon", 1, { mastered: true })];
const sell = { ...defaultSellChoices(), relicsWorthSelling: true };
const relicRow = (m: Model) => spareRows(m, null, sell).find((r) => r.kind === "relic")!;
const RELIC_ITEM: MarketItem = { id: "l1", slug: "lith_l1_relic", name: "Lith L1 Relic", gameRef: null, maxRank: null, subtypes: ["intact", "exceptional", "flawless", "radiant"], tags: ["relic"] } as MarketItem;

for (const [how, lex] of [["built", built], ["mastered", mastered]] as const) {
  test(`relics: with Lex Prime ${how} and Aklex Prime not, a relic that drops the barrel the second Lex Prime needs is tagged need and kept`, () => {
    const m = model(lex);
    const reward = relicRows(m).find((r) => r.base === "Lith L1")!.rewards.find((r) => r.name === "Lex Prime Barrel")!;
    assert.equal(reward.needed, true, "Relics tags the barrel need: Aklex Prime takes a second Lex Prime");
    assert.deepEqual(relicsYouNeed(m).get("Lith L1"), ["Lex Prime Barrel"], "Sell spares keeps the relic by the same rule");
    const row = relicRow(m);
    assert.deepEqual([row.keep, row.spare, row.why], [4, 0, "Drops Lex Prime Barrel, which you still need"]);
    assert.deepEqual(row.needs, [{ item: "Lex Prime Barrel", count: 1 }]);
    // The plan Sell spares makes starts from the spare rows, and the listing guard counts by them.
    const rules = defaultSparesRules();
    for (const c of SPARE_CATEGORIES) rules[c].on = true;
    const targets = sellTargets(m, rules, defaultAdvice(), null, sell);
    assert.equal(targets.some((t) => t.name === "Lith L1 Relic"), false, "the plan offers none of them");
    assert.equal(provenSpare({ model: m, index: null, sell, advice: defaultAdvice(), rules }, "other", RELIC_ITEM, null, "intact")?.spare, 0, "the listing guard proves none spare");
  });
}

test("relics: once Aklex Prime is built too, nothing needs the barrel and the relic sells", () => {
  const m = model([...mastered, inv("/W/AklexPrime", "Aklex Prime", "weapon", 1)]);
  assert.equal(relicsYouNeed(m).has("Lith L1"), false);
  const row = relicRow(m);
  assert.deepEqual([row.keep, row.spare], [0, 4]);
});

test("relics: a loose barrel covers the second Lex Prime, so the relic isn't kept for it", () => {
  const m = model([...mastered, inv("/W/LexPrimeBarrel", "Lex Prime Barrel", "prime_part", 1)]);
  // The built Lex Prime is one of the two Aklex Prime takes; the loose barrel is the second one's.
  assert.equal(relicRows(m).find((r) => r.base === "Lith L1")!.rewards.find((r) => r.name === "Lex Prime Barrel")!.needed, false);
  assert.equal(relicsYouNeed(m).has("Lith L1"), false);
});

/**
 * The rule Sell spares kept relics by before: parts of a prime neither held nor mastered, short of
 * what one copy takes. Every relic it kept is still kept, with every part it named.
 */
function oldRule(m: Model): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [parent, parts] of m.partsByParent) {
    if (m.isMastered(parent) || m.owned(parent) > 0) continue;
    for (const p of parts) {
      if (m.partHave(p.fullName) >= p.required) continue;
      for (const s of m.sourcesByReward.get(p.fullName) ?? []) {
        const list = out.get(s.base) ?? [];
        if (!list.includes(p.fullName)) list.push(p.fullName);
        out.set(s.base, list);
      }
    }
  }
  return out;
}

const demo = (f: string) => JSON.parse(readFileSync(new URL(`../demo/${f}`, import.meta.url), "utf8"));

test("relics: every relic the old rule kept is still kept, on the demo account and the models above", () => {
  const demoModel = buildModel(demo("dev-bundle.json") as Bundle, undefined, null, null, null, demo("dev-recipe-data.json"));
  for (const m of [demoModel, model(built), model(mastered), model([]), model([...mastered, inv("/W/AklexPrime", "Aklex Prime", "weapon", 1)])]) {
    const now = relicsYouNeed(m);
    for (const [base, parts] of oldRule(m)) {
      const kept = now.get(base);
      assert.ok(kept, `${base} was kept and still is`);
      // Every part it named, in the order it named them (a part only the new rule names may come between).
      assert.deepEqual(kept.filter((p) => parts.includes(p)), parts, `${base} still names ${parts.join(", ")}, in that order`);
    }
  }
});

test("relics: on the demo account the tag on Relics and what Sell spares keeps name the same relics and parts", () => {
  const m = buildModel(demo("dev-bundle.json") as Bundle, undefined, null, null, null, demo("dev-recipe-data.json"));
  const tagged = new Map<string, string[]>();
  for (const r of relicRows(m, { includeUnowned: true })) {
    const needed = r.rewards.filter((x) => x.needed).map((x) => x.name);
    if (needed.length) tagged.set(r.base, needed.sort());
  }
  const kept = new Map([...relicsYouNeed(m)].map(([base, parts]) => [base, [...parts].sort()]));
  assert.ok(tagged.size > 0);
  assert.deepEqual(kept, tagged);
});

test("relics: on the demo account the plan offers no relic that drops a needed part, and the spare rows keep each one whole", () => {
  const m = buildModel(demo("dev-bundle.json") as Bundle, undefined, null, null, null, demo("dev-recipe-data.json"));
  const index = indexItems(demo("dev-market-items.json"));
  const rules = defaultSparesRules();
  for (const c of SPARE_CATEGORIES) rules[c].on = true;
  const kept = relicsYouNeed(m);
  const offered = sellTargets(m, rules, defaultAdvice(), index, sell).filter((t) => t.cat === "relics");
  for (const t of offered) assert.equal(kept.has(t.name.replace(/ Relic$/, "")), false, `${t.name} drops a needed part and isn't offered`);
  // The spare rows agree: every relic the rule keeps has no spare copy.
  for (const r of spareRows(m, index, sell).filter((x) => x.kind === "relic")) {
    if (kept.has(r.name.replace(/ Relic$/, ""))) assert.equal(r.spare, 0, `${r.name} (${r.subtype}) is kept whole`);
  }
});

test("texts: Sell spares' Relics row and the Guide's What you can spare say a relic is kept by the test that tags it need", () => {
  const plan = readFileSync(new URL("../src/lib/ui/SparesPlan.svelte", import.meta.url), "utf8");
  const guide = readFileSync(new URL("../src/lib/tabs/Guide.svelte", import.meta.url), "utf8");
  const always = plan.match(/always="Always kept: relics[^"]*"/)?.[0] ?? "";
  const spare = guide.split("\n").find((l) => l.includes("<li>What you can spare")) ?? "";
  for (const [where, text] of [["Sell spares, Relics", always], ["Guide, What you can spare", spare]]) {
    assert.ok(text, `${where} is found`);
    assert.doesNotMatch(text, /a part you lack for a prime you haven't built or mastered/, `${where}: not the old rule`);
    assert.match(text, /drops? a part you still need/, `${where}: a part still needed`);
    assert.match(text, /need on Relics|Relics tags need/, `${where}: by the test Relics tags need by`);
  }
  assert.match(always, /a weapon made from it/, "the Ak weapon's second copy is named");
});
