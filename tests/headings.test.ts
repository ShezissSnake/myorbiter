// Headings don't jump a level. A list page's cards name themselves in an h3 (ItemCard, Rivens'
// cards), and nothing but the page's h1 stood above them, so a screen reader's list of headings went
// 1, 3, 3… and a section after the list ("Ducats for less", "Find a riven") read as part of the last
// card. Every list (Browse) now opens with an h2, shown to a screen reader only, and so does the
// Current fissure's reward screen, whose cards came before the page's first h2.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const hidden = (src: string, cls: string) =>
  new RegExp(`\\.${cls}\\s*\\{[^}]*clip-path: inset\\(50%\\)`).test(src) || new RegExp(`\\.${cls}\\s*\\{[^}]*clip: rect`).test(src);

test("every list opens with an h2 for a screen reader, above its filters, cards and table", () => {
  const src = readFileSync("src/lib/ui/Browse.svelte", "utf8");
  const markup = src.slice(src.indexOf("</script>"));
  const h2 = markup.match(/<h2 class="([\w-]+)"[^>]*>/);
  assert.ok(h2, "an h2 in the list's markup");
  assert.ok(markup.indexOf(h2[0]) < markup.indexOf('<div class="tools"'), "before the sort row");
  assert.ok(markup.indexOf(h2[0]) < markup.indexOf("<CardGrid"), "before the cards' h3");
  assert.ok(hidden(src, h2[1]), "visually hidden: the page looks as it did");
});

test("the Current fissure's reward screen opens with an h2 before its cards' h3", () => {
  const src = readFileSync("src/lib/tabs/InMission.svelte", "utf8");
  const from = src.indexOf("{#snippet screen()}");
  const screen = src.slice(from, src.indexOf("{/snippet}", from));
  const h2 = screen.match(/<h2 class="([\w-]+)"[^>]*>/);
  assert.ok(h2, "an h2 in the reward screen");
  assert.ok(screen.indexOf(h2[0]) < screen.indexOf("rewardCard("), "before the reward cards");
  assert.ok(screen.indexOf(h2[0]) < screen.indexOf('<h3 class="rc-name"'), "before the relic slots' h3");
  assert.ok(hidden(src, h2[1]), "visually hidden");
});
