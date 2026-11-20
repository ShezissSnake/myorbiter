// A table of rows that open (ui/Table.svelte, the list pages' Table view) is one Tab stop, as a
// grid of cards is: the arrow keys move between its rows, Enter opens one. With every row a stop,
// Inventory's 590 demo items took more than 600 presses to get past. Orders keeps each row's
// controls as stops (each must be reachable) and offers a link past the listings instead.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { rovingKey } = await import("../src/lib/ui/roving");

test("Table view: the rows of a table that opens are one Tab stop, moved between by the arrows (roving.ts)", () => {
  const src = readFileSync("src/lib/ui/Table.svelte", "utf8");
  const body = src.match(/<tbody[^>]*>/)?.[0] ?? "";
  assert.match(body, /use:roving\b/);
  // Enter (and Space) on a row still opens it.
  assert.match(src, /e\.key === "Enter" \|\| e\.key === " "\) && e\.target === e\.currentTarget/);
});

test("rows, one under the other, take Up and Down one row at a time", () => {
  const rows = [0, 40, 80, 120].map((top) => ({ top, focused: false, focus() { this.focused = true; }, getBoundingClientRect() { return { top: this.top }; } }));
  const press = (key: string, from: number) => {
    rows.forEach((r) => (r.focused = false));
    const moved = rovingKey({ key, target: rows[from], preventDefault() {} }, rows);
    return moved ? rows.findIndex((r) => r.focused) : null;
  };
  assert.equal(press("ArrowDown", 0), 1);
  assert.equal(press("ArrowDown", 2), 3);
  assert.equal(press("ArrowUp", 2), 1);
  assert.equal(press("ArrowDown", 3), null);
  assert.equal(press("Home", 3), 0);
  assert.equal(press("End", 0), 3);
});

test("Orders: a skip link, shown on keyboard focus, takes the focus past the listings' table", () => {
  const src = readFileSync("src/lib/tabs/Orders.svelte", "utf8");
  const link = src.indexOf("Skip past the listings");
  const table = src.indexOf('<table class="orders"');
  assert.ok(link > 0, "the link is there");
  assert.ok(link < table, "before the table");
  const target = src.match(/id="orders-after"[^>]*>/)?.[0];
  assert.ok(target, "something after the table to land on");
  assert.match(target, /tabindex="-1"/, "which can take the focus");
  assert.ok(src.indexOf('id="orders-after"') > src.indexOf("</table>", table), "after the table");
  assert.match(src, /\.skiprows:focus/, "shown when it has the focus");
});
