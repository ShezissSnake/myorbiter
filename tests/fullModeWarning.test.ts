// The Full mode warning (src/lib/FullMode.svelte), shown beside every switch that turns Full mode on
// and copied into the docs: what Digital Extremes publishes about third-party programs (no list of
// allowed or forbidden ones, at your own risk), where the login session goes, and the page that
// lists everything MyOrbiter and TennoScope send.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PRIVACY_PAGE, openable } from "../src/lib/core/links";

const read = (p: string) => readFileSync(p, "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");
const WARNING = /export const FULL_MODE_WARNING =\s*"([^"]+)";/.exec(read("src/lib/FullMode.svelte"))![1];

test("the warning says what Digital Extremes publishes and where Full mode sends what it reads", () => {
  assert.match(WARNING, /Digital Extremes publishes no list of allowed or forbidden third-party programs and leaves using them at your own risk/);
  assert.match(WARNING, /could put your account at risk/);
  assert.match(WARNING, /the login session found there goes to Digital Extremes, for your inventory\./);
  assert.ok(!/EULA/.test(WARNING));
});

test("no Full mode text says it only sends some things: they point to the page that lists everything", () => {
  const PAGE = /label: "([^"]+)"/.exec(read("src/lib/core/links.ts"))![1];
  assert.ok(WARNING.endsWith(`Everything MyOrbiter and TennoScope read and send is listed on the page ${PAGE}.`), "the warning names the page");
  // TennoScope's own window has no MyOrbiter beside it to open the page: its address is spelled out.
  assert.ok(read("tennoscope/app/src/access.ts").includes(`listed on MyOrbiter's page ${PAGE} (${PRIVACY_PAGE.url}).`), "TennoScope's warning names the page and its address");
  for (const p of ["README.md", "docs/install.md", "docs/releases/first-public.md", "src/lib/FullMode.svelte", "tennoscope/app/src/access.ts"])
    assert.ok(!/only reads, and only sends|only sends your login session/.test(flat(read(p))), `${p} still says it only sends some things`);
});

test("the docs quote the warning word for word, and nothing claims the EULA forbids it", () => {
  assert.ok(flat(read("docs/install.md")).includes(WARNING), "install.md quotes it");
  for (const p of ["README.md", "docs/install.md", "docs/privacy.md", "docs/releases/first-public.md", "src/lib/FullMode.svelte", "src/lib/tabs/Guide.svelte", "src/lib/whatsNew.ts", "tennoscope/app/src/access.ts"])
    assert.ok(!/EULA forbids|unauthori[sz]ed third-party/i.test(read(p)), `${p} still says the EULA forbids it`);
  // Where a link can go (the docs), it goes to Digital Extremes' own post.
  for (const p of ["README.md", "docs/privacy.md"]) assert.ok(read(p).includes("https://forums.warframe.com/topic/1383123/"), p);
});

test("the page the warning names opens from the warning, wherever it is drawn", () => {
  // The page's name is in the sentence once, so the control is that name and the words around it
  // are the rest of the sentence: read aloud or quoted, the warning stays the same.
  const at = WARNING.indexOf(PRIVACY_PAGE.label);
  assert.ok(at > 0 && WARNING.indexOf(PRIVACY_PAGE.label, at + 1) < 0, "the page's name is in the warning once");
  assert.equal(WARNING.slice(0, at) + PRIVACY_PAGE.label + WARNING.slice(at + PRIVACY_PAGE.label.length), WARNING);
  assert.ok(openable(PRIVACY_PAGE.url), "an address the app may already open");

  const piece = read("src/lib/FullModeWarning.svelte");
  assert.match(piece, /import \{ FULL_MODE_WARNING \} from "\.\/FullMode\.svelte"/);
  assert.match(piece, /import \{ PRIVACY_PAGE \} from "\.\/core\/links"/);
  assert.match(piece, /const at = FULL_MODE_WARNING\.indexOf\(PRIVACY_PAGE\.label\);/);
  assert.match(piece, /\{before\}<button type="button" class="link pagename" [^>]*title="Open the page in your browser"[^>]*onclick=\{open\}>\{PRIVACY_PAGE\.label\}<\/button>\{after\}/);
  // It opens the page and does nothing else: no answer to the question, no flip of the switch.
  const open = /function open\(e: MouseEvent\) \{([^}]*)\}/.exec(piece)![1];
  assert.match(open, /e\.preventDefault\(\);\s*e\.stopPropagation\(\);\s*void openUrl\(PRIVACY_PAGE\.url\);/);
  assert.doesNotMatch(piece, /onanswer|ts\.ask|\{@html/);

  // Each place the warning is drawn draws it through that piece, and nowhere as plain text.
  const first = read("src/lib/FirstRun.svelte");
  assert.match(first, /<p class="warn" id="first-run-warning"><FullModeWarning disabled=\{!ready\} \/><\/p>/, "the first start's question");
  const full = read("src/lib/FullMode.svelte");
  assert.match(full, /<Switch name="settings\.full-mode"[^\n]*>\n\s*<span class="warn"><FullModeWarning \/><\/span>/, "beside the switch");
  assert.match(full, /<p class="warn small"><FullModeWarning \/><\/p>/, "beside the button");
  for (const [p, src, n] of [["FirstRun.svelte", first, 1], ["FullMode.svelte", full, 2]] as const) {
    assert.equal(src.match(/<FullModeWarning\b/g)?.length, n, p);
    assert.doesNotMatch(src, /\{FULL_MODE_WARNING\}/, `${p} draws the warning without its control`);
  }
});
