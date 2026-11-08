import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LINK_SITES, openable } from "../src/lib/core/links";

test("links to the sites MyOrbiter uses open", () => {
  for (const url of [
    "https://warframe.market/items/serration",
    "https://warframe.market/profile/Seller1",
    "https://wiki.warframe.com/w/Mesa_Prime",
    "https://warframe.fandom.com/wiki/Mesa_Prime",
    "https://overframe.gg/build/1234/",
    "https://noxsframe.com/",
    "https://gitlab.com/sheziss-group/myorbiter/-/releases",
    "https://gitlab.com/sheziss-group/myorbiter/-/work_items/new?issuable_template=Bug%20report",
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
    "https://gitlab.com/sheziss-group",
    "https://gitlab.com/sheziss-group/other-project/-/issues",
    "https://gitlab.com/sheziss-group/myorbiter",
    "https://gitlab.com/sheziss-group/myorbiter/uploads/0123456789abcdef/picture.png",
    "https://github.com/ShezissSnake/other-repo",
    // The old address on GitHub is gone: anyone could take the name.
    "https://github.com/ShezissSnake/orbiter/releases",
    "https://github.com/ShezissSnake/orbiter/issues/new",
    "https://gitlab.com/someone-else/orbiter/-/issues",
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

test("the page opens a checked link through the app (link.rs), not straight through the opener plugin", () => {
  // Through the plugin, a browser started from the Linux AppImage inherited the AppImage's libraries.
  const backend = readFileSync(new URL("../src/lib/backend.ts", import.meta.url), "utf8");
  const open = backend.slice(backend.indexOf("export async function openUrl("), backend.indexOf("/** warframe.market URL slug"));
  assert.match(open, /const safe = openable\(url\);[\s\S]*if \(inTauri\) return invoke<void>\("open_link", \{ url: safe \}\);/, "only a checked link goes to the app");
  const src = readdirSync("src", { recursive: true, encoding: "utf8" }).filter((f) => /\.(ts|svelte)$/.test(f));
  assert.deepEqual(src.filter((f) => /plugin-opener/.test(readFileSync(join("src", f), "utf8"))), [], "no page imports the opener plugin");
  const link = readFileSync(new URL("../src-tauri/src/link.rs", import.meta.url), "utf8");
  assert.match(link, /let Some\(url\) = openable\(url\) else \{/, "the app checks the link again");
  assert.match(link, /crate::folder::first_opener\(crate::folder::OPENERS, /, "on Linux, the openers without the AppImage's environment");
  assert.match(link, /#\[cfg\(not\(target_os = "linux"\)\)\]\s*\{\s*use tauri_plugin_opener::OpenerExt;/, "the opener plugin only off Linux");
});

test("tricks that read like an allowed site are refused", () => {
  for (const url of [
    "https://warframe.market@evil.example/",
    "https:\\\\evil.example\\warframe.market",
    "https://evil.example\\@warframe.market/",
    "https://github.com/ShezissSnake/../someone-else/repo",
    "https://github.com/ShezissSnake/%2e%2e/someone-else/repo",
    "https://github.com/shezisssnake/orbiter",
    "https://w\u0430rframe.market/", // a Cyrillic a
    "https://warframe.market./items/x",
    "https://overframe.gg:443@evil.example/",
    "HTTPS://evil.example/",
    "https://evil.example/?u=https://warframe.market/",
    " javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
  ])
    assert.equal(openable(url), null, url);
  // The address is opened as normalised, so what was checked is what opens.
  assert.equal(openable("https://WARFRAME.MARKET/items/x"), "https://warframe.market/items/x");
});

test("the web view connects only to MyOrbiter itself and Digital Extremes' riven figures", () => {
  // Nox's Frame is read from Rust (noxsframe.rs), never by the page, so the CSP doesn't list it.
  const conf = JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
  const sources = (csp: Record<string, string>) => csp["connect-src"].split(/\s+/);
  const app = ["'self'", "ipc:", "http://ipc.localhost", "https://www-static.warframe.com"];
  assert.deepEqual(sources(conf.app.security.csp), app);
  assert.deepEqual(sources(conf.app.security.devCsp), [...app, "ws://localhost:1421"]);
  const cap = readFileSync(new URL("../src-tauri/capabilities/default.json", import.meta.url), "utf8");
  for (const text of [JSON.stringify(conf), cap, readFileSync(new URL("../src/lib/core/links.ts", import.meta.url), "utf8")])
    assert.ok(!/github\.com\/ShezissSnake/i.test(text), "the old GitHub address is allowed nowhere");
});

test("no page links to the old GitHub address, which no longer opens", () => {
  const files = readdirSync("src", { recursive: true, encoding: "utf8" }).filter((f) => /\.(ts|svelte|json)$/.test(f));
  assert.ok(files.length > 50, "the sources were found");
  const found = files.filter((f) => /github\.com\/ShezissSnake/i.test(readFileSync(join("src", f), "utf8")));
  assert.deepEqual(found, []);
});
