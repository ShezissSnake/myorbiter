// The mission page's reward screen: what is drawn about TennoScope's reading comes from one held
// object. The page keeps what it last worked out while another page is shown, and the reading
// itself (`cards`) goes null when it expires: the time of the reading read from `cards` then threw
// "null is not an object (evaluating 'G().at')" while the held cards were still drawn.
import { readFileSync } from "node:fs";
import { flush, effectRoot } from "./support/runes";
import { test } from "node:test";
import assert from "node:assert/strict";

const { whileShown, setShownPage } = await import("../src/lib/pane.svelte");
// @ts-expect-error: Svelte's client internals have no type declarations
const internal = (await import("svelte/internal/client")) as { proxy: <T>(v: T) => T; render_effect: (f: () => void) => void };

test("a held reading keeps its time with its cards after the reading is gone", () => {
  const app = internal.proxy({ tab: "mission" });
  const input = internal.proxy<{ cards: { at: number; cards: string[] } | null }>({ cards: { at: 1000, cards: ["a", "b"] } });
  setShownPage(() => app.tab);
  let screen!: () => { rows: string[]; at: number } | null;
  let drawn: { rows: string[]; at: number } | null = null;
  const stop = effectRoot(() => {
    screen = whileShown("mission", () => (input.cards ? { rows: input.cards.cards.map((c) => c.toUpperCase()), at: input.cards.at } : null));
    internal.render_effect(() => {
      drawn = screen();
    });
  });
  flush();
  assert.deepEqual(drawn, { rows: ["A", "B"], at: 1000 });
  // Another page is shown, and the reading expires: the page still holds the cards it drew, with
  // the time that goes with them, and nothing in what it draws reads `input.cards` again.
  app.tab = "home";
  flush();
  input.cards = null;
  flush();
  assert.deepEqual(drawn, { rows: ["A", "B"], at: 1000 });
  // Shown again, it follows the reading: none.
  app.tab = "mission";
  flush();
  assert.equal(drawn, null);
  stop();
});

test("the page never reads the reading's time off `cards` beside the held cards", () => {
  const page = readFileSync(new URL("../src/lib/tabs/InMission.svelte", import.meta.url), "utf8");
  assert.doesNotMatch(page, /cards!\./, "`cards` may be null while the held cards are drawn");
  assert.match(page, /readAt\(reading\?\.at/);
});
