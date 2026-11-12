import { test } from "node:test";
import assert from "node:assert/strict";
import { homeCardsChosen } from "../src/lib/core/homeCards";

const { loadSettings } = await import("../src/lib/backend");
const store = (saved: unknown) => ((globalThis as { localStorage?: unknown }).localStorage = { getItem: () => (saved == null ? null : JSON.stringify(saved)) });

test("a player who never chose has not chosen Home's cards", () => {
  assert.equal(homeCardsChosen({ homeChosen: false, homeHidden: [] }), false);
});

test("choosing every card counts: nothing hidden, but the choice was made", () => {
  assert.equal(homeCardsChosen({ homeChosen: true, homeHidden: [] }), true);
});

test("hiding cards counts, also from before the choice was recorded", () => {
  assert.equal(homeCardsChosen({ homeChosen: false, homeHidden: ["baro"] }), true);
  assert.equal(homeCardsChosen({ homeChosen: true, homeHidden: ["baro"] }), true);
});

test("the choice is kept across a restart, and only a real true is believed", async () => {
  store({ homeChosen: true, homeHidden: [] });
  assert.equal((await loadSettings()).homeChosen, true);
  store({ homeChosen: "yes" });
  assert.equal((await loadSettings()).homeChosen, false);
  store(null);
  assert.equal((await loadSettings()).homeChosen, false);
});
