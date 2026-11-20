// Orders: each listing row's controls say which listing they act on ("Remove: Arcane Energize"),
// as ListButton's "Sell: …" does. A screen reader read twelve rows of identical "Quantity", "Your
// price", "Auto-price", "Shown to buyers", "Sold" and "Remove", and Remove takes a listing off
// warframe.market. The buttons the row finds again after a question (its Remove, for the focus)
// are found by a mark of their own, not by a name that now carries the item.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync("src/lib/tabs/Orders.svelte", "utf8");
const start = src.indexOf('<tr class="order" class:hidden');
const row = src.slice(start, src.indexOf("</tr>", start));
const buyStart = src.indexOf("{#each mkt.buys as o");
const buyRow = src.slice(buyStart, src.indexOf("</li>", buyStart));

/** Every accessible name given in a stretch of markup: aria-label="…", label="…" and label={…}. */
function names(markup: string): string[] {
  return [...markup.matchAll(/(?<![\w-])(?:aria-label|label)=("[^"]*"|\{[^}]*\})/g)].map((m) => m[1]);
}

test("the sell row has its controls' names to check", () => {
  assert.ok(start > 0 && row.length > 0);
  assert.ok(names(row).length >= 10, `found ${names(row).length}`);
});

test("every control in a sell row carries the item's name", () => {
  const bare = names(row).filter((n) => !/\{nm\}|\$\{nm\}|\bnm\b/.test(n));
  assert.deepEqual(bare, []);
});

test("every control in a buy order's row carries the item's name", () => {
  const bare = names(buyRow).filter((n) => !/\{nm\}|\$\{nm\}|\bnm\b/.test(n));
  assert.deepEqual(bare, []);
});

test("the row's Remove is found again by a mark, not by its name", () => {
  assert.doesNotMatch(src, /\[aria-label="Remove"\]|\[aria-label="Take down"\]/);
  assert.ok((src.match(/data-remove/g) ?? []).length >= 3, "each Remove or Take down carries data-remove");
});
