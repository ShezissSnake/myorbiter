import { test } from "node:test";
import assert from "node:assert/strict";
import { PAGES, pagesFor } from "../src/lib/pages";

test("a PC player gets every page", () => {
  assert.equal(pagesFor(false), PAGES);
});

test("a console player gets only the pages that work without reading the game", () => {
  const pages = pagesFor(true);
  assert.deepEqual(pages.map((p) => p.id), ["home", "market", "sales", "rivens", "guide"]);
  // Each keeps its section: listings and rivens under Selling, sales under Market.
  assert.deepEqual([...new Set(pages.map((p) => p.group).filter(Boolean))], ["Selling", "Market"]);
  assert.equal(PAGES.find((p) => p.id === "rivens")?.group, "Selling");
  assert.equal(PAGES.find((p) => p.id === "rivens")?.label, "Rivens");
});

test("your page order: pages move within their section, sections move whole, Ctrl+1…9 follow the sidebar", async () => {
  const { drawnOrder, grouped, movePage, moveSection, orderPages, sectionsOf } = await import("../src/lib/pages");
  const ids = orderPages(PAGES, []).map((p) => p.id);
  assert.deepEqual(ids, PAGES.map((p) => p.id), "no order: as they come");
  // Selling to the top: its pages come first in the sidebar and the shortcuts.
  let order = moveSection(grouped(orderPages(PAGES, [])), "Selling", -1);
  order = moveSection(grouped(orderPages(PAGES, order)), "Selling", -1);
  const pages = orderPages(PAGES, order);
  assert.deepEqual(sectionsOf(pages), ["Selling", "Fissures", "Collection", "Market"]);
  const drawn = drawnOrder(pages).map((p) => p.id);
  assert.deepEqual(drawn.slice(0, 3), ["home", "market", "sets"], "Orders leads Selling");
  // Prime parts up two within Selling (past Sets and Orders): first there.
  order = movePage(grouped(pages), "parts", -1);
  order = movePage(grouped(orderPages(PAGES, order)), "parts", -1);
  assert.deepEqual(drawnOrder(orderPages(PAGES, order)).map((p) => p.id).slice(0, 3), ["home", "parts", "market"]);
});
