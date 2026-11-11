// The Full mode warning (src/lib/FullMode.svelte), shown beside every switch that turns Full mode on
// and copied into the docs: what Digital Extremes publishes about third-party programs (no list of
// allowed or forbidden ones, at your own risk), and everything Full mode sends and to whom.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");
const WARNING = /export const FULL_MODE_WARNING =\s*"([^"]+)";/.exec(read("src/lib/FullMode.svelte"))![1];

test("the warning says what Digital Extremes publishes and where Full mode sends what it reads", () => {
  assert.match(WARNING, /Digital Extremes publishes no list of allowed or forbidden third-party programs and leaves using them at your own risk/);
  assert.match(WARNING, /could put your account at risk/);
  assert.match(WARNING, /only sends your login session to Digital Extremes and the names of reward items read from the screen to warframe\.market, for their prices\.$/);
  assert.ok(!/EULA/.test(WARNING));
});

test("the docs quote the warning word for word, and nothing claims the EULA forbids it", () => {
  assert.ok(flat(read("docs/install.md")).includes(WARNING), "install.md quotes it");
  for (const p of ["README.md", "docs/install.md", "docs/privacy.md", "src/lib/FullMode.svelte", "src/lib/tabs/Guide.svelte", "src/lib/whatsNew.ts"])
    assert.ok(!/EULA forbids|unauthori[sz]ed third-party/i.test(read(p)), `${p} still says the EULA forbids it`);
  // Where a link can go (the docs), it goes to Digital Extremes' own post.
  for (const p of ["README.md", "docs/privacy.md"]) assert.ok(read(p).includes("https://forums.warframe.com/topic/1383123/"), p);
});
