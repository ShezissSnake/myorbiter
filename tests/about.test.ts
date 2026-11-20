// Settings' About and the wiki's credit show the repository's own words: each sentence is found,
// word for word, in the file it comes from (the files' own markup, ** and backticks, left out), and
// each control opens its file through the list of sites as it stands.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { openable } from "../src/lib/core/links";
import { ABOUT_FILES, ABOUT_LICENCE, ABOUT_UNOFFICIAL, ABOUT_WARRANTY } from "../src/lib/core/about";
import { WIKI_CREDIT, WIKI_CREDIT_URL, wikiCreditText } from "../src/lib/core/wikiData";

/** A file's text as one line: wrapped lines joined, its markdown's bold and code marks left out. */
const flat = (path: string) => readFileSync(path, "utf8").replace(/\*\*|`/g, "").replace(/\s+/g, " ");

test("the About's sentences are the README's and NOTICE.md's own, word for word", () => {
  assert.ok(flat("README.md").includes(`${ABOUT_UNOFFICIAL.lead} ${ABOUT_UNOFFICIAL.text}`), "README.md's Unofficial sentence");
  const notice = flat("NOTICE.md");
  assert.ok(notice.includes(`${ABOUT_LICENCE.name} ${ABOUT_LICENCE.text}`), "NOTICE.md's copyright line and licence");
  assert.ok(notice.includes(ABOUT_WARRANTY), "NOTICE.md's no-warranty sentences");
  assert.match(ABOUT_LICENCE.text, /GNU General Public License v3\.0 only \(GPL-3\.0-only\)/, "the licence named as NOTICE.md names it");
});

test("the About opens LICENSE, NOTICE.md and THIRD-PARTY-NOTICES/README.md, each on main, through the list of sites", () => {
  assert.deepEqual(ABOUT_FILES.map((f) => f.label), ["LICENSE", "NOTICE.md", "THIRD-PARTY-NOTICES/README.md"]);
  for (const f of ABOUT_FILES) {
    assert.equal(f.url, `https://github.com/ShezissSnake/myorbiter/blob/main/${f.label}`);
    assert.equal(openable(f.url), f.url, f.url);
    // The file is in the repository, and every install carries it (tauri.conf.json's resources).
    assert.ok(readFileSync(f.label, "utf8").length > 0, f.label);
  }
  const resources = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")).bundle.resources;
  assert.deepEqual(resources, { "../LICENSE": "LICENSE", "../NOTICE.md": "NOTICE.md", "../THIRD-PARTY-NOTICES/": "THIRD-PARTY-NOTICES/" });
});

test("Settings shows the About beside the line on how MyOrbiter is written, each file a control that says what it opens", () => {
  const sheet = readFileSync("src/lib/SettingsSheet.svelte", "utf8");
  const written = sheet.indexOf("MyOrbiter is written largely by AI");
  const about = sheet.indexOf('<div class="about"');
  assert.ok(written > 0 && about > written, "the About comes after that line");
  // Nothing but a comment between the two.
  assert.match(sheet.slice(sheet.indexOf("</p>", written) + 4, about), /^\s*(<!--[^>]*-->)?\s*$/, "the About follows that line");
  const block = sheet.slice(about, sheet.indexOf("</div>\n", about));
  for (const name of ["ABOUT_UNOFFICIAL", "ABOUT_LICENCE", "ABOUT_WARRANTY", "ABOUT_FILES"]) assert.ok(block.includes(name), name);
  assert.match(block, /\{#each ABOUT_FILES as f \(f\.url\)\}<button type="button" class="link" title=\{`Open \$\{f\.label\} \$\{f\.what\}/);
  // The one sentence on the three files is THIRD-PARTY-NOTICES/README.md's own: "Every download carries ...".
  const carries = "Every download carries the same three files.";
  assert.ok(flat("THIRD-PARTY-NOTICES/README.md").includes(carries.slice(0, carries.indexOf(" the same"))), "the README's words: Every download carries");
  assert.equal(ABOUT_FILES.length, 3, "three files, as the sentence says");
  assert.ok(sheet.slice(about, sheet.indexOf("</section>", about)).includes(`<p class="hint">${carries}</p>`), "the sentence is drawn as written, in the About");
});

test("the wiki's credit is the one its licence file states: the contributors, the address, the licence's name and version", () => {
  const licence = flat("public/data/wiki/LICENSE.md");
  assert.ok(licence.includes(`Attribution: ${WIKI_CREDIT.contributors} (${WIKI_CREDIT.address}), ${WIKI_CREDIT.host}.`), "the attribution line");
  assert.ok(licence.includes(`${WIKI_CREDIT.licence} licence (${WIKI_CREDIT.short})`), "the licence's name and version");
  assert.equal(WIKI_CREDIT.licence, "Creative Commons Attribution-NonCommercial-ShareAlike 3.0 Unported");
  assert.equal(openable(WIKI_CREDIT_URL), WIKI_CREDIT_URL, "the address opens through the list of sites");
  assert.equal(new URL(WIKI_CREDIT_URL).host, new URL(WIKI_CREDIT.address).host);
  assert.equal(wikiCreditText(), "Data from the Warframe Wiki contributors (https://wiki.warframe.com), hosted by Weird Gloop, under the Creative Commons Attribution-NonCommercial-ShareAlike 3.0 Unported licence (CC BY-NC-SA 3.0).");
});

test("Arcanes, where the Vosfor figures show, and Builds' recipes carry that credit, always", () => {
  const arcanes = readFileSync("src/lib/tabs/Arcanes.svelte", "utf8");
  // Both of Loid's sections: which packs to open, and the packs that weigh a dissolution.
  const sections = [...arcanes.matchAll(/<section class="vosfor[^"]*"[\s\S]*?<\/section>/g)].map((m) => m[0]);
  assert.equal(sections.length, 2);
  for (const s of sections) assert.match(s, /<p class="small dim credit"><WikiCredit \/><\/p>\s*<\/section>$/);
  const recipes = readFileSync("src/lib/ui/builds/Recipes.svelte", "utf8");
  assert.match(recipes, /<p class="dim small gaps">\{#if r\.gaps\.length\}\{`\$\{r\.gaps\.join\(" "\)\} `\}\{\/if\}<WikiCredit \/><\/p>/, "shown whether or not the recipe has gaps");
  assert.doesNotMatch(recipes, /CC BY-NC-SA\./, "the old short credit is gone");
  const credit = readFileSync("src/lib/ui/WikiCredit.svelte", "utf8");
  assert.ok(credit.includes('<span class="wiki-credit">Data from {WIKI_CREDIT.contributors} (<button'), "the words drawn start as wikiCreditText's");
  assert.ok(credit.includes('</button>), {WIKI_CREDIT.host}, under the {WIKI_CREDIT.licence} licence ({WIKI_CREDIT.short}).</span>'), "and end as wikiCreditText's");
  assert.match(credit, /aria-busy=\{links\.isOpening\(WIKI_CREDIT_URL\)\} onclick=\{\(\) => openUrl\(WIKI_CREDIT_URL\)\}/);
  assert.match(credit, /title="Open the Warframe Wiki \(wiki\.warframe\.com\) in your browser"/);
});

test("the Guide names where the Foundry recipes and TennoScope's day prices are downloaded from, as the code has them", () => {
  const guide = readFileSync("src/lib/tabs/Guide.svelte", "utf8");
  const pc = guide.slice(guide.indexOf("{:else}", guide.indexOf("{#if console}")));
  const list = pc.slice(pc.indexOf("Where the numbers come from"), pc.indexOf("</ul>", pc.indexOf("Where the numbers come from")));
  // TennoScope's day prices: relics.run (collection_prices.rs).
  const prices = readFileSync("tennoscope/crates/warframe-acquisition/src/collection_prices.rs", "utf8");
  assert.match(prices, /pub const RELICS_RUN_HISTORY_URL: &str = "https:\/\/relics\.run\/history\/";/);
  assert.match(list, /<li>Prices: the warframe\.market summary TennoScope downloads from relics\.run when it starts \(/);
  // The Foundry recipes: warframe-public-export-plus on raw.githubusercontent.com, once a week (recipes.rs).
  const recipes = readFileSync("src-tauri/src/recipes.rs", "utf8");
  assert.match(recipes, /const EXPORT: &str = "https:\/\/raw\.githubusercontent\.com\/calamity-inc\/warframe-public-export-plus\/senpai";/);
  assert.match(recipes, /const FRESH: u64 = 7 \* 24 \* 3600;/);
  assert.match(list, /<li>Foundry recipes \(what each blueprint takes\): warframe-public-export-plus on raw\.githubusercontent\.com, downloaded once a week\.<\/li>/);
});
