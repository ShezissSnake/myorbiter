import { test } from "node:test";
import assert from "node:assert/strict";
import { PAGES, pagesFor } from "../src/lib/pages";

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
