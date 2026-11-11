import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { PAGES, SECTION_GLYPH, pagesFor } from "../src/lib/pages";
import { withPage } from "../src/lib/backend";

test("a PC player gets every page", () => {
  assert.equal(pagesFor(false), PAGES);
});

test("a console player gets only the pages that work without reading the game", () => {
  const pages = pagesFor(true);
  assert.deepEqual(pages.map((p) => p.id), ["home", "market", "sales", "rivens", "guide"]);
  // Each keeps its section: rivens under Collection, listings and sales under Trade.
  assert.deepEqual([...new Set(pages.map((p) => p.group).filter(Boolean))], ["Trade", "Collection"]);
  assert.equal(PAGES.find((p) => p.id === "rivens")?.group, "Collection");
  assert.equal(PAGES.find((p) => p.id === "rivens")?.label, "Rivens");
});

test("your page order: pages move within their section, sections move whole, Ctrl+1…9 follow the sidebar", async () => {
  const { drawnOrder, grouped, movePage, moveSection, orderPages, sectionsOf } = await import("../src/lib/pages");
  const ids = orderPages(PAGES, []).map((p) => p.id);
  assert.deepEqual(ids, PAGES.map((p) => p.id), "no order: as they come");
  // Collection to the top: its pages come first in the sidebar and the shortcuts.
  let order = moveSection(grouped(orderPages(PAGES, [])), "Collection", -1);
  order = moveSection(grouped(orderPages(PAGES, order)), "Collection", -1);
  const pages = orderPages(PAGES, order);
  assert.deepEqual(sectionsOf(pages), ["Collection", "Fissures", "Progress", "Trade"]);
  const drawn = drawnOrder(pages).map((p) => p.id);
  assert.deepEqual(drawn.slice(0, 3), ["home", "inventory", "parts"], "Inventory leads Collection");
  // Sets up two within Collection (past Prime parts and Inventory): first there.
  order = movePage(grouped(pages), "sets", -1);
  order = movePage(grouped(orderPages(PAGES, order)), "sets", -1);
  assert.deepEqual(drawnOrder(orderPages(PAGES, order)).map((p) => p.id).slice(0, 3), ["home", "sets", "inventory"]);
});

test("Sell spares joins a saved sidebar order right after Orders", () => {
  assert.deepEqual(withPage(["inventory", "market", "sales", "stats"], "spares", "market"), ["inventory", "market", "spares", "sales", "stats"]);
  assert.deepEqual(withPage(["market", "spares", "sales"], "spares", "market"), ["market", "spares", "sales"], "already placed: left where it is");
  assert.deepEqual(withPage([], "spares", "market"), [], "no order saved: the usual order has it");
  assert.deepEqual(withPage(["sales", "home"], "spares", "market"), ["sales", "home", "spares"], "Orders not placed: at the end of what was placed");
  const trade = PAGES.filter((p) => p.group === "Trade").map((p) => p.id);
  assert.deepEqual(trade.slice(0, 2), ["market", "spares"]);
});

test("every page in the sidebar has a picture of its own, none a section's glyph, each bundled with its source", () => {
  const rows = PAGES.filter((p) => p.id !== "guide");
  const pics = rows.map((p) => ("game" in p.icon ? p.icon.game : null));
  assert.ok(pics.every(Boolean), "every row shows a picture, not a line icon");
  assert.equal(new Set(pics).size, pics.length, "no two rows share a picture");
  const crests = Object.values(SECTION_GLYPH);
  for (const pic of pics) assert.ok(!crests.includes(pic!), `${pic} is a section's glyph`);
  const sources = JSON.parse(readFileSync(new URL("../public/game/SOURCES.json", import.meta.url), "utf8")) as Record<string, { file: string }>;
  for (const name of [...pics, ...crests, "platinum", "refresh-timer", "mail", "menu"] as string[]) {
    const file = new URL(`../public/game/${name}.png`, import.meta.url);
    assert.ok(existsSync(file), `public/game/${name}.png`);
    assert.equal(sources[name]?.file, `${name}.png`, `SOURCES.json lists ${name}`);
  }
});
