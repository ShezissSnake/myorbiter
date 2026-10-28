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
