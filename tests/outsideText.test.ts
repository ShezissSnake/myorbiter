// Text from outside MyOrbiter (another player's chat message, a seller's name) on its way to
// Discord and into the page: as it was typed, with nothing of its own (core/untrusted.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { discordMessage } from "../src/lib/core/untrusted";

test("discord: a chat line can't make a masked link or other Markdown of its own", () => {
  const m = discordMessage("Buyer messaged you on warframe.market", "Buyer: [warframe.market/verify](https://example.invalid) **now**");
  // The title stays bold: the one piece of Markdown MyOrbiter writes itself.
  assert.ok(m.startsWith("**Buyer messaged you on warframe.market**\n"), m);
  const body = m.slice(m.indexOf("\n") + 1);
  // No masked link: the brackets are escaped, so Discord shows them as typed.
  assert.doesNotMatch(body, /(?<!\\)\[[^\]]*(?<!\\)\]\(/, body);
  assert.equal(body, "Buyer: \\[warframe.market/verify\\](https://example.invalid) \\*\\*now\\*\\*");
});

test("discord: headings, quotes, lists, mentions and code come out as typed; plain text is unchanged", () => {
  const lines = (s: string) => discordMessage("t", s).split("\n").slice(1);
  assert.deepEqual(lines("# big\n> quoted\n- item\n-# small\n1. first\n  + more"), ["\\# big", "\\> quoted", "\\- item", "\\-# small", "1\\. first", "  \\+ more"]);
  assert.deepEqual(lines("<@123> <t:1700000000> <:x:1> `code` ||spoiler|| ~~gone~~ __u__ back\\slash"), [
    "\\<@123\\> \\<t:1700000000\\> \\<:x:1\\> \\`code\\` \\|\\|spoiler\\|\\| \\~\\~gone\\~\\~ \\_\\_u\\_\\_ back\\\\slash",
  ]);
  // Ordinary notification text reads the same, a name with an underscore shown as written.
  assert.equal(discordMessage("You sold Mesa Prime Set", "to Buyer for 120 platinum. Ack & Brunt (rank 5) · 3 listings"), "**You sold Mesa Prime Set**\nto Buyer for 120 platinum. Ack & Brunt (rank 5) · 3 listings");
  assert.equal(discordMessage("Alpha_1 whispered you", ""), "**Alpha\\_1 whispered you**");
  assert.equal(discordMessage("Beta-2 whispered you", "a - b, 2. c"), "**Beta-2 whispered you**\na - b, 2. c");
});
