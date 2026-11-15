// Mods and the hover card show a sale pace as Browse market does: something that sells never
// reads "0" a day (under a tenth reads "<0.1"), and none lately (null) still shows nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { soldPerDay } from "../src/lib/ui/table";

const mods = readFileSync("src/lib/tabs/Mods.svelte", "utf8");
const card = readFileSync("src/lib/HoverCard.svelte", "utf8");
/** Every place in a file that rounds a sale pace to a tenth itself, rather than through soldPerDay. */
const ownRounding = (src: string) => src.split("\n").filter((l) => /Math\.round\([^)]*tradesPerDay \* 10\) \/ 10/.test(l) && !/sortValue/.test(l));

test("the rule the two places call: <0.1 for a slow seller, nothing for none lately", () => {
  assert.equal(soldPerDay(0.03), "<0.1");
  assert.equal(soldPerDay(null), null);
});

test("Mods' Sold/day column shows soldPerDay and sorts by the number it showed before", () => {
  const col = mods.split("\n").find((l) => l.includes('key: "trades", label: "Sold/day"'));
  assert.ok(col, "the Sold/day column");
  assert.match(col, /value: \(r\) => soldPerDay\(r\.tradesPerDay\)/);
  // "<0.1" is text: the sort keeps to the number rounded to a tenth, so the column's order is as before.
  assert.match(col, /sortValue: \(r\) => \(r\.tradesPerDay == null \? null : Math\.round\(r\.tradesPerDay \* 10\) \/ 10\)/);
});

test("Mods' cards say the same pace as the column", () => {
  assert.match(mods, /\{#if !r\.tradable\}[^\n]*\{:else if r\.tradesPerDay != null\}[^\n]*\{soldPerDay\(r\.tradesPerDay\)\} sold\/day/);
  assert.deepEqual(ownRounding(mods), [], "no Sold/day figure in Mods rounds a pace to 0 itself");
});

test("the hover card's per-day figures never read 0 for something that sells", () => {
  // A prime part's figures: Sells <0.1/day.
  assert.match(card, /\{#if d\.tradesPerDay != null\}<span><span class="register">Sells<\/span><b>\{soldPerDay\(d\.tradesPerDay\)\}<small>\/day<\/small><\/b><\/span>\{\/if\}/);
  // Anything else: a sentence, which says "less than once in ten days" rather than "about <0.1 a day".
  assert.match(card, /\{#if d\.tradesPerDay != null\}\{@const pace = soldPerDay\(d\.tradesPerDay\)\}<p class="more dim">\{pace === "<0\.1" \? "Sells less than once in ten days" : `Sells about \$\{pace\} a day`\} on warframe\.market\.<\/p>\{\/if\}/);
  assert.deepEqual(ownRounding(card), [], "no per-day figure in the hover card rounds a pace to 0 itself");
});
