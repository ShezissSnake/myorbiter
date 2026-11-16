// Inventory, Prime parts, Sets, Arcanes and the price history show a sale pace as Browse market
// does: something that sells never reads "0" a day (under a twentieth reads "<0.1", or says so in
// words), none lately still shows what it showed, and each column sorts by the number it sorted by.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (f: string) => readFileSync(f, "utf8");
const inventory = read("src/lib/tabs/Inventory.svelte");
const parts = read("src/lib/tabs/Parts.svelte");
const sets = read("src/lib/tabs/Sets.svelte");
const arcanes = read("src/lib/tabs/Arcanes.svelte");
const history = read("src/lib/ui/PriceHistory.svelte");

/** Every line of a file that rounds a sale pace to a tenth itself for show, rather than through soldPerDay. */
const ownRounding = (src: string) =>
  src.split("\n").filter((l) => /Math\.round\(\(?[\w.?!()]*(tradesPerDay\b|perDay\(r\)!?|\bt\b)[^)]*\* 10\) \/ 10/.test(l) && !/sortValue/.test(l));
/** The Sold/day columns of a file, one line each. */
const soldColumns = (src: string) => src.split("\n").filter((l) => l.includes('key: "trades"') && l.includes('label: "Sold/day"'));

test("Inventory's Sold/day column shows soldPerDay, sorts as before and says what <0.1 means", () => {
  const [col] = soldColumns(inventory);
  assert.ok(col, "the Sold/day column");
  assert.match(col, /value: \(r\) => soldPerDay\(perDay\(r\)\)/);
  assert.match(col, /sortValue: \(r\) => \{ const t = perDay\(r\); return t == null \? null : Math\.round\(t \* 10\) \/ 10; \}/);
  assert.match(col, /title: "[^"]*<0\.1 less than once in ten days/);
});

test("Inventory's cards say the same pace as the column; none lately is still 'no recent sales'", () => {
  assert.match(inventory, /\{#if perDay\(r\) != null\}[^\n]*\{soldPerDay\(perDay\(r\)\)\} sold\/day<\/span>\{:else if r\.kind !== "gear"\}[^\n]*no recent sales/);
  assert.deepEqual(ownRounding(inventory), [], "no Sold/day figure in Inventory rounds a pace to 0 itself");
});

test("Prime parts' Sold/day column and cards never read 0 for a part that sells", () => {
  const [col] = soldColumns(parts);
  assert.ok(col, "the Sold/day column");
  assert.match(col, /value: \(r\) => soldPerDay\(r\.tradesPerDay\)/);
  assert.match(col, /sortValue: \(r\) => \(r\.tradesPerDay == null \? null : Math\.round\(r\.tradesPerDay \* 10\) \/ 10\)/);
  assert.match(col, /title: "[^"]*<0\.1 less than once in ten days/);
  assert.match(parts, /\{#if r\.tradesPerDay != null\}<span title="[^"]*"><span class="register">Sold\/day<\/span><b>\{soldPerDay\(r\.tradesPerDay\)\}<\/b><\/span>\{\/if\}/);
  // Baro's table ("Ducats for less") lists only parts that sell at least once a day (ducatBuys),
  // so its tenth can't round to 0: left as it was.
  assert.ok(read("src/lib/core/advice.ts").includes("(tradesPerDay ?? 0) < 1) continue;"));
  assert.deepEqual(ownRounding(parts).filter((l) => !l.includes("b.tradesPerDay")), [], "no other Sold/day figure in Prime parts rounds a pace to 0 itself");
});

test("Sets' Sold/day column shows soldPerDay and sorts as before", () => {
  const [col] = soldColumns(sets);
  assert.ok(col, "the Sold/day column");
  assert.match(col, /value: \(r\) => soldPerDay\(r\.tradesPerDay\)/);
  assert.match(col, /sortValue: \(r\) => \(r\.tradesPerDay == null \? null : Math\.round\(r\.tradesPerDay \* 10\) \/ 10\)/);
  assert.match(col, /title: "[^"]*<0\.1 less than once in ten days/);
  assert.deepEqual(ownRounding(sets), [], "no Sold/day figure in Sets rounds a pace to 0 itself");
});

test("Sets' Sells faster never reads ×0 for a set that sells; it still sorts by the ratio", () => {
  // faster() is a number only when the set and every part sell: a ratio under 0.05 reads ×<0.1.
  assert.match(sets, /\{#snippet fasterCell\(r: SetRow\)\}\{@const f = faster\(r\)\}\{#if f != null\}<span class="dim">×\{f === 0 \? "<0\.1" : f\}<\/span>\{\/if\}\{\/snippet\}/);
  const col = sets.split("\n").find((l) => l.includes('key: "faster"'));
  assert.ok(col);
  assert.match(col, /value: faster,/);
  assert.match(col, /title: "[^"]*×<0\.1/);
});

test("Arcanes' two Sold/day columns and its cards never read 0 for an arcane that sells", () => {
  const cols = soldColumns(arcanes);
  assert.equal(cols.length, 2, "Dissolve or sell's and the collection's");
  assert.match(cols[0], /value: \(x\) => soldPerDay\(x\.row\.tradesPerDay\)/);
  assert.match(cols[0], /sortValue: \(x\) => \(x\.row\.tradesPerDay == null \? null : Math\.round\(x\.row\.tradesPerDay \* 10\) \/ 10\)/);
  assert.match(cols[1], /value: \(r\) => soldPerDay\(r\.tradesPerDay\)/);
  assert.match(cols[1], /sortValue: \(r\) => \(r\.tradesPerDay == null \? null : Math\.round\(r\.tradesPerDay \* 10\) \/ 10\)/);
  for (const c of cols) assert.match(c, /title: "[^"]*<0\.1 less than once in ten days/);
  assert.match(arcanes, /\{#if r\.tradesPerDay != null\}<span class="dim small"[^>]*>\{soldPerDay\(r\.tradesPerDay\)\} sold\/day<\/span>\{\/if\}/);
  assert.deepEqual(ownRounding(arcanes), [], "no Sold/day figure in Arcanes rounds a pace to 0 itself");
});

test("the price history's line says a sale in thirty days in words, never 'about 0 sold a day'", () => {
  // perDay is the last 30 days' sales over 30: one sale is 0.033, which rounded to a tenth read 0.
  assert.match(history, /const pace = \$derived\(t == null \|\| t\.perDay >= 10 \? Math\.round\(t\?\.perDay \?\? 0\) : soldPerDay\(t\.perDay\)\);/);
  assert.match(history, /\{pace === "<0\.1" \? "sold less than once in ten days" : `about \$\{pace\} sold a day`\}/);
  assert.ok(!history.includes("Math.round((t?.perDay ?? 0) * 10) / 10"), "the line no longer rounds the pace itself");
});
