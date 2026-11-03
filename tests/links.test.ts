import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LINK_SITES, openable } from "../src/lib/core/links";

test("links to the sites orbiter uses open", () => {
  for (const url of [
    "https://warframe.market/items/serration",
    "https://warframe.market/profile/Seller1",
    "https://wiki.warframe.com/w/Mesa_Prime",
    "https://warframe.fandom.com/wiki/Mesa_Prime",
    "https://overframe.gg/build/1234/",
    "https://noxsframe.com/",
    "https://github.com/ShezissSnake/orbiter/releases",
  ])
    assert.equal(openable(url), url, url);
});

test("anything else is refused", () => {
  for (const url of [
    "http://warframe.market/items/serration",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "https://warframe.market.example.com/",
    "https://evil.example/warframe.market/",
    "https://user:pass@warframe.market/",
    "https://warframe.market:8443/",
    "https://github.com/someone-else/repo",
    "https://github.com/ShezissSnake",
    "smb://warframe.market/share",
    "not a url",
    "",
  ])
    assert.equal(openable(url), null, url);
});

test("the opener permission allows exactly the same sites", () => {
  const cap = JSON.parse(readFileSync(new URL("../src-tauri/capabilities/default.json", import.meta.url), "utf8"));
  const opener = cap.permissions.find((p: { identifier?: string }) => typeof p === "object" && p.identifier === "opener:allow-open-url");
  assert.ok(opener, "a scoped opener:allow-open-url");
  assert.ok(!cap.permissions.includes("opener:default"), "not the default (any http, https, mailto, tel; reveal in folder)");
  const urls = opener.allow.map((a: { url: string }) => a.url).sort();
  assert.deepEqual(urls, LINK_SITES.map((s) => `https://${s.host}${s.path}*`).sort());
});
