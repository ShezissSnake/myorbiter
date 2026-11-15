// The Guide says what Orders shows under its title: figure tiles, not a tape. Each tile it names
// is one Orders draws, and the tape is left to the pages that have one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const guide = readFileSync("src/lib/tabs/Guide.svelte", "utf8");
const orders = readFileSync("src/lib/tabs/Orders.svelte", "utf8");
/** The Guide's Orders section: from its heading to the next page's. */
const start = guide.indexOf('["market", "Orders", [');
const section = guide.slice(start, guide.indexOf('["spares", ', start));

test("the Guide's Orders section names the tiles Orders draws, and no tape on Orders", () => {
  assert.ok(section.length > 100, "the section is found");
  assert.doesNotMatch(section, /tape under the title \(Orders/, "Orders has no tape");
  const tiles = [...orders.matchAll(/<section class="tiles"[\s\S]*?<\/section>/g)].flatMap((m) => [...m[0].matchAll(/<span class="register">([^<]+)<\/span>/g)].map((x) => x[1]));
  assert.deepEqual(tiles, ["Listings", "Listed value", "Undercut", "Trades left"]);
  for (const t of tiles) assert.ok(section.includes(t), `the Guide names the ${t} tile`);
});

test("the pages with a tape still have it in the Guide, and they do draw one", () => {
  for (const page of ["Market", "Sales", "Stats"]) assert.match(readFileSync(`src/lib/tabs/${page}.svelte`, "utf8"), /<Ticker\b/, `${page} draws a ticker`);
  assert.match(section, /Browse market, Sales and Stats carry a tape under the title/);
});
