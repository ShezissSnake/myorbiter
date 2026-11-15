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

test("the Guide says who sees the Trades left tile: a PC player whose Mastery Rank has been read", () => {
  // Orders draws the tile on PC only, and only once the Mastery Rank is known (TennoScope's read).
  assert.match(orders, /\{#if !console && trades\.limit != null\}[\s\S]{0,800}<span class="register">Trades left<\/span>/);
  assert.match(orders, /const trades = \$derived\(tradeAllowance\(settings\.trades, masteryRank, minute\)\)/);
  // The Guide's Orders section is the PC guide's: a console player reads the short guide instead.
  const pcGuide = guide.indexOf("{:else}", guide.indexOf("{#if console}"));
  assert.ok(pcGuide > 0 && guide.indexOf("{#each ROUTINES", pcGuide) > pcGuide, "the routines are drawn in the PC guide only");
  const at = section.indexOf("Trades left today");
  // From the tile before it to the end of its own bracket.
  const clause = section.slice(section.lastIndexOf("Undercut (", at), section.indexOf(")", at));
  assert.match(clause, /on PC/, "the tile is PC-only");
  assert.match(clause, /once your Mastery Rank has been read/, "and shows only once the Mastery Rank is known");
});
