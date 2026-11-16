// Text from outside MyOrbiter (another player's chat message, a seller's name) on its way to
// Discord and into the page: as it was typed, with nothing of its own (core/untrusted.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { discordMessage } from "../src/lib/core/untrusted";
import { auctionsIn, bookIn, chatsIn, feedOrderIn, marketUserIn } from "../src/lib/backend";
import type { BookOrder } from "../src/lib/core/market";
import type { RivenAuction } from "../src/lib/core/rivens";

// Right-to-left override, zero-width space, a "tag" character: none of them is drawn as itself.
const RLO = "\u202E";
const ZWSP = "\u200B";
const TAG = "\u{E0041}";

test("warframe.market: a chat's partner and newest message come in cleaned, one line, ids untouched", () => {
  const [c] = chatsIn([{ id: "c1", with: `Bu${RLO}yer${ZWSP}`, unread: 2, lastUpdate: "2026-10-27T09:00:00+00:00", lastMessage: `wtb${TAG} blind rage\nsecond line\r\n${RLO}third` }]);
  assert.deepEqual(c, { id: "c1", with: "Buyer", unread: 2, lastUpdate: "2026-10-27T09:00:00+00:00", lastMessage: "wtb blind rage second line third" });
  // Nothing left of a message: none, as when the reply carries no text.
  assert.equal(chatsIn([{ id: "c2", with: "A", unread: 1, lastUpdate: "x", lastMessage: `${ZWSP} ` }])[0].lastMessage, null);
  assert.equal(chatsIn([{ id: "c3", with: "A", unread: 1, lastUpdate: "x", lastMessage: null }])[0].lastMessage, null);
});

test("warframe.market: sellers' names in a book, the live feed, a profile and riven auctions come in cleaned", () => {
  const user = { id: "u1", ingameName: `Sel${RLO}ler1`, status: "ingame", platform: "pc", crossplay: true };
  const order: BookOrder = { id: "o1", type: "sell", platinum: 9, quantity: 1, rank: null, subtype: null, visible: true, user };
  const [o] = bookIn([order, { ...order, id: "o2", user: { ...user, ingameName: null } }]);
  assert.equal(o.user.ingameName, "Seller1");
  assert.equal(o.id, "o1");
  assert.equal(o.user.id, "u1");
  assert.equal(bookIn([{ ...order, user: { ...user, ingameName: null } }])[0].user.ingameName, null);
  assert.equal(feedOrderIn({ id: "f", type: "sell", platinum: 3, itemId: "i", user: { ingameName: `Feed${ZWSP}1\n`, id: "f1" } }).user.ingameName, "Feed1");
  assert.equal(marketUserIn({ ingameName: `Rep${TAG}Example`, slug: "repexample", reputation: 3, status: null })?.ingameName, "RepExample");
  assert.equal(marketUserIn(null), null);
  const a = { id: "a1", price: 100, starting: 90, name: `visi${RLO}-critacron`, rank: 0, rerolls: 0, mr: 8, polarity: "madurai", attributes: [], seller: `Riven${ZWSP}Seller`, status: "ingame", updated: "x" } as RivenAuction;
  assert.deepEqual(auctionsIn([a]).map((x) => [x.name, x.seller]), [["visi-critacron", "RivenSeller"]]);
  // Real names come through as they are.
  assert.equal(bookIn([{ ...order, user: { ...user, ingameName: "Alpha_1.Beta-2" } }])[0].user.ingameName, "Alpha_1.Beta-2");
});

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
