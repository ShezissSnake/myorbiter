import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LINK_SITES, PRIVACY_PAGE, openable } from "../src/lib/core/links";

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
    "https://github.com/ShezissSnake/myorbiter/releases/tag/build-120",
    "https://github.com/ShezissSnake/myorbiter/issues/new?template=bug_report.yml",
    "https://shezisssnake.github.io/myorbiter/",
    PRIVACY_PAGE.url,
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
    "https://github.com/ShezissSnake/myorbiter",
    "https://github.com/ShezissSnake/myorbiter-other/releases",
    "https://github.com/user-attachments/assets/0123",
    "https://github.com/ShezissSnake/myorbiter/files/123/picture.zip",
    "https://github.com/ShezissSnake/myorbiter/assets/123/0123abcd",
    "https://github.com/ShezissSnake/myorbiter/raw/main/README.md",
    "https://github.com/ShezissSnake/myorbiter/blob/other-branch/README.md",
    "https://raw.githubusercontent.com/ShezissSnake/myorbiter/main/README.md",
    "https://shezisssnake.github.io/",
    "https://shezisssnake.github.io/other/",
    "https://someone.github.io/myorbiter/",
    // The repository's name before the rename: GitHub redirects it today, but anyone could take it.
    "https://github.com/ShezissSnake/orbiter/releases",
    "https://github.com/ShezissSnake/orbiter/issues/new",
    "https://gitlab.com/someone-else/orbiter/-/issues",
    "smb://warframe.market/share",
    "not a url",
    "",
  ])
    assert.equal(openable(url), null, url);
});

test("the app allows exactly the same sites, and the page has no opener permission", () => {
  // link.rs checks each link again before it opens it; the page can't reach the opener plugin.
  const cap = JSON.parse(readFileSync(new URL("../src-tauri/capabilities/default.json", import.meta.url), "utf8"));
  assert.deepEqual(cap.permissions.filter((p: string | { identifier: string }) => /^opener:/.test(typeof p === "string" ? p : p.identifier)), []);
  const link = readFileSync(new URL("../src-tauri/src/link.rs", import.meta.url), "utf8");
  const list = link.slice(link.indexOf("const SITES"), link.indexOf("];", link.indexOf("const SITES")));
  const sites = [...list.matchAll(/\("([^"]+)", "([^"]+)"\)/g)].map((m) => `${m[1]}${m[2]}`).sort();
  assert.deepEqual(sites, LINK_SITES.map((s) => `${s.host}${s.path}`).sort());
});

test("the page opens a checked link through the app (link.rs), not straight through the opener plugin", () => {
  // Through the plugin, a browser started from the Linux AppImage inherited the AppImage's libraries.
  const backend = readFileSync(new URL("../src/lib/backend.ts", import.meta.url), "utf8");
  assert.match(backend, /if \(inTauri\) return invoke<void>\("open_link", \{ url: safe \}\);/);
  assert.doesNotMatch(backend, /export (async function|const) openUrl\b/, "pages open links through links.svelte.ts");
  const store = readFileSync(new URL("../src/lib/links.svelte.ts", import.meta.url), "utf8");
  assert.match(store, /const safe = openable\(url\);\s*if \(!safe\) \{[\s\S]*?return;\s*\}[\s\S]*await linkOpener\.open\(safe\);/, "only a checked link goes to the app");
  const src = readdirSync("src", { recursive: true, encoding: "utf8" }).filter((f) => /\.(ts|svelte)$/.test(f));
  const read = (f: string) => readFileSync(join("src", f), "utf8");
  assert.deepEqual(src.filter((f) => /plugin-opener/.test(read(f))), [], "no page imports the opener plugin");
  assert.deepEqual(src.filter((f) => /linkOpener/.test(read(f))).sort(), ["lib/backend.ts", "lib/links.svelte.ts"], "nothing opens a link past the store");
  const link = readFileSync(new URL("../src-tauri/src/link.rs", import.meta.url), "utf8");
  assert.match(link, /let Some\(url\) = openable\(url\) else \{/, "the app checks the link again");
  assert.match(link, /crate::folder::first_opener\(crate::folder::OPENERS, /, "on Linux, the openers without the AppImage's environment");
  assert.match(link, /#\[cfg\(not\(target_os = "linux"\)\)\]\s*\{\s*use tauri_plugin_opener::OpenerExt;/, "the opener plugin only off Linux");
});

test("every link control reads \"Opening…\" while its link is on its way", () => {
  const src = readdirSync("src", { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".svelte"));
  let controls = 0;
  for (const f of src) {
    const text = readFileSync(join("src", f), "utf8");
    // Each click that opens a link sits on a control that shows it's on its way: its label swaps
    // (Opening), or it's a progress button (an icon) or the Overframe row, busy meanwhile.
    for (const m of text.matchAll(/onclick=\{\(\) => openUrl\(/g)) {
      const tag = text.slice(text.lastIndexOf("<", m.index), text.indexOf(">", m.index) + 1);
      assert.match(tag, /aria-busy=\{links\.isOpening\(|busy=\{links\.isOpening\(/, `${f}: ${tag.slice(0, 120)}`);
      controls++;
    }
  }
  assert.ok(controls >= 25, `the controls were found (${controls})`);
});

test("a link that couldn't open says so in the corner, and its Logs opens Settings at Logs", () => {
  const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
  const notice = read("src/lib/LinkTrouble.svelte");
  assert.match(notice, /\{#if links\.trouble\}/);
  assert.match(notice, />Couldn't open your browser; see Logs</);
  assert.match(read("src/App.svelte"), /<LinkTrouble onlogs=\{\(\) => goTo\("settings#logs"\)\} \/>/);
  const sheet = read("src/lib/SettingsSheet.svelte");
  assert.match(sheet, /<section id="settings-logs">/);
  // Clearing `focus` runs the effect again: a cleanup that cleared the timer cancelled the scroll.
  const effect = sheet.slice(sheet.indexOf("let focusTimer"), sheet.indexOf("});", sheet.indexOf("let focusTimer")));
  assert.match(effect, /focusTimer = setTimeout\(/);
  assert.doesNotMatch(effect, /return \(\) => clearTimeout/);
});

test("tricks that read like an allowed site are refused", () => {
  for (const url of [
    "https://warframe.market@evil.example/",
    "https:\\\\evil.example\\warframe.market",
    "https://evil.example\\@warframe.market/",
    "https://github.com/ShezissSnake/../someone-else/repo",
    "https://github.com/ShezissSnake/%2e%2e/someone-else/repo",
    "https://github.com/ShezissSnake/myorbiter/../someone-else/repo",
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
    assert.ok(!/github\.com\/ShezissSnake\/orbiter\b/i.test(text), "the old GitHub address is allowed nowhere");
});

test("no page links to the repository's old name on GitHub, which no longer opens", () => {
  const files = readdirSync("src", { recursive: true, encoding: "utf8" }).filter((f) => /\.(ts|svelte|json)$/.test(f));
  assert.ok(files.length > 50, "the sources were found");
  const found = files.filter((f) => /github\.com\/ShezissSnake\/orbiter\b/i.test(readFileSync(join("src", f), "utf8")));
  assert.deepEqual(found, []);
});
