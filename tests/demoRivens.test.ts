// The demo account's rivens (scripts/demo-data.mjs): a few veiled, four unveiled on four kinds of
// weapon, one of them up for sale on warframe.market, so the Rivens page and its help pictures show
// rivens rather than the empty state.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildModel } from "../src/lib/core/model";
import { auctionItemFor, auctionOf, parseMyAuctions, parseRiven, rivenTables, type RivenRaw } from "../src/lib/core/rivens";
import { rivenMetaOf } from "../src/lib/core/shapes";
import { cheap60 } from "../src/lib/core/rivenModel";
import type { Bundle } from "../src/lib/core/types";

const read = (f: string) => JSON.parse(readFileSync(new URL(`../demo/${f}`, import.meta.url), "utf8"));
const model = buildModel(read("dev-bundle.json") as Bundle);
const tables = rivenTables(model.catalogByUnique.values());
const raws: RivenRaw[] = read("dev-tennoscope.json").report.rivens;
const meta = rivenMetaOf(read("dev-rivens.json"));
const rivens = raws.map((r) => parseRiven(model, tables, r)!);
const mine = parseMyAuctions(read("dev-market.json").auctions);

test("the demo's unveiled rivens read whole: weapon, name, every stat known and graded", () => {
  assert.deepEqual(rivens.map((r) => `${r.kind} ${r.weapon}`), ["Rifle Soma", "Pistol Lex", "Melee Nikana", "Shotgun Hek"]);
  for (const r of rivens) {
    assert.ok(r.name && r.polarity, `${r.weapon}: a name and a polarity`);
    assert.ok(r.stats.every((s) => s.display !== "?" && s.grade !== "?"), `${r.weapon}: ${r.stats.map((s) => s.display)}`);
  }
  assert.ok(rivens.some((r) => r.rerolls === 0) && rivens.some((r) => r.rerolls > 0), "unrolled and cycled");
  assert.ok(rivens.some((r) => !r.stats.some((s) => !s.buff)), "one without a curse");
});

test("veiled rivens are held too", () => {
  const veiled = [...model.inventoryByBase.entries()].filter(([u]) => /\/Randomized\/Raw/.test(u)).reduce((n, [, rows]) => n + rows.reduce((k, r) => k + r.quantity, 0), 0);
  assert.equal(veiled, 3);
});

test("one is listed on warframe.market at its own price; the others can be listed, at the Estimate", () => {
  const listed = rivens.filter((r) => auctionOf(meta, r, mine));
  assert.deepEqual(listed.map((r) => r.weapon), ["Soma"]);
  assert.equal(auctionOf(meta, listed[0], mine)!.buyout, 480);
  for (const r of rivens) {
    const made = auctionItemFor(meta, r);
    assert.ok(!("error" in made), `${r.weapon}: ${"error" in made ? made.error : ""}`);
  }
  // The listings every search answers in the browser: enough priced ones for an Estimate.
  assert.ok(cheap60((read("dev-auctions.json") as { price: number }[]).map((a) => a.price)) != null);
});
