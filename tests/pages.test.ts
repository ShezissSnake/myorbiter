import { test } from "node:test";
import assert from "node:assert/strict";
import { PAGES, pagesFor } from "../src/lib/pages";

test("a PC player gets every page", () => {
  assert.equal(pagesFor(false), PAGES);
});

test("a console player gets only the pages that work without reading the game", () => {
  const pages = pagesFor(true);
  assert.deepEqual(pages.map((p) => p.id), ["home", "market", "sales", "rivens", "guide"]);
  // Rivens moves to Trade, so the sidebar has one section.
  assert.deepEqual([...new Set(pages.map((p) => p.group).filter(Boolean))], ["Trade"]);
  // The shared list isn't changed.
  assert.equal(PAGES.find((p) => p.id === "rivens")?.group, "Collection");
});

test("your page order: moved pages first in their new places, sections where their first page is, Home first", async () => {
  const { movePage, orderPages, sectionsOf } = await import("../src/lib/pages");
  const ids = orderPages(PAGES, []).map((p) => p.id);
  assert.deepEqual(ids, PAGES.map((p) => p.id), "no order: as they come");
  // Orders to the top of the list (below Home): Trade becomes the first section.
  let order: string[] = ids.filter((id) => id !== "home");
  for (let i = 0; i < 20; i++) order = movePage(order, "market", -1);
  const pages = orderPages(PAGES, order);
  assert.equal(pages[0].id, "home");
  assert.equal(pages[1].id, "market");
  assert.equal(sectionsOf(pages)[0], "Trade");
  assert.deepEqual(movePage(["a", "b"], "a", -1), ["a", "b"], "nothing above the first");
});
