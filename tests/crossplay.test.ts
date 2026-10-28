import { test } from "node:test";
import assert from "node:assert/strict";
import { canTrade, type BookUser, type Me } from "../src/lib/core/market";

const me = (platform: string, crossplay = true) => ({ id: "me", ingameName: "me", platform, crossplay }) as Me;
const seller = (platform: string, crossplay: boolean | null = true) => ({ id: "x", ingameName: "x", platform, crossplay }) as BookUser;

test("an Xbox player with cross-play on can buy from PC, PlayStation and mobile sellers who have it on", () => {
  for (const p of ["xbox", "pc", "ps4", "mobile"]) assert.equal(canTrade(me("xbox"), seller(p)), true, p);
  assert.equal(canTrade(me("xbox"), seller("pc", false)), false, "the seller has cross-play off");
});

test("with your own cross-play off, only your platform", () => {
  assert.equal(canTrade(me("xbox", false), seller("xbox", false)), true);
  assert.equal(canTrade(me("xbox", false), seller("pc")), false);
});

test("no platinum between Switch and the other platforms", () => {
  assert.equal(canTrade(me("switch"), seller("pc")), false);
  assert.equal(canTrade(me("pc"), seller("switch")), false);
  assert.equal(canTrade(me("switch"), seller("switch", false)), true);
});
