// Builds MyOrbiter's website (site/ → site/_site/): the landing page, the in-app Guide as pages,
// What's New and the list of downloads, as plain HTML and CSS for GitHub Pages, with one small
// script of the site's own (site/site.js: the landing's tour, the screenshot viewer, the visitor's
// platform first). The Guide and What's New come from the app's own source
// (src/lib/tabs/Guide.svelte, src/lib/whatsNew.ts), drawn once with Svelte's server renderer through
// Vite, so the site says what the app says; its icons are the app's own (src/lib/ui/Icon.svelte).
// The download links are read from the repository's releases on GitHub once, at build time
// (scripts/site-downloads.mjs), and written into the pages: the script reads nothing and sends
// nothing.
//
//   node scripts/site.mjs             site/_site/, the buttons offering the best channel's build:
//                                     Stable, else Beta, else Experimental (latest.json on the
//                                     release named after the channel), and downloads.html the
//                                     last builds (the releases)
//   node scripts/site.mjs --offline   the same without reading GitHub: the buttons point at
//                                     Releases (a local build)
//   node scripts/site.mjs --check     build, then check every link, that the only script a page
//                                     loads is site.js and that it reaches for nothing outside the
//                                     page, that no dev-*.json (real account data) is in it, and
//                                     that the landing and Guide pages' grids fit 320, 360 and
//                                     390 px wide
//
// Reading GitHub fails the build on anything but a file that's there or a 404 (no build on that
// channel yet), and on a manifest that doesn't check out: the site never links a wrong file. With
// GITHUB_TOKEN set (the Release workflow's read-only token), the API is read with it, for its rate
// limit; nothing else is sent with it.
// Screenshots are of the demo account only (npm run dev:demo; site/README.md, Screenshots).
import { createServer } from "vite";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { API, buildRows, CHANNELS, channelManifest, FILES, frontButtons, HOST, REPO, safeUrl as projectUrl } from "./site-downloads.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "site");
const OUT = join(SRC, "_site");
const args = process.argv.slice(2);

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ---- The app's own words, drawn on the server.
const vite = await createServer({ root: ROOT, server: { middlewareMode: true, hmr: false }, appType: "custom", logLevel: "error" });
let guideHtml, news, warning, PAGES, pageById, PRIVACY_PAGE;
try {
  const { render } = await vite.ssrLoadModule("svelte/server");
  const Guide = (await vite.ssrLoadModule("/src/lib/tabs/Guide.svelte")).default;
  ({ NEWS: news } = await vite.ssrLoadModule("/src/lib/whatsNew.ts"));
  ({ FULL_MODE_WARNING: warning } = await vite.ssrLoadModule("/src/lib/FullMode.svelte"));
  ({ PAGES, pageById } = await vite.ssrLoadModule("/src/lib/pages.ts"));
  ({ PRIVACY_PAGE } = await vite.ssrLoadModule("/src/lib/core/links.ts"));
  // go: null draws page names in the text as plain words (no links into an app that isn't there).
  guideHtml = render(Guide, { props: { go: null, plannerMode: "sets", console: false, platform: "PC", hidden: [], expanded: true } }).body;
} finally {
  await vite.close();
}
if (!warning || !/account at risk/.test(warning)) throw new Error("Full mode's warning wasn't found in src/lib/FullMode.svelte");

/** The Guide's markup without the app around it: no buttons, no Svelte markers, local icon paths. */
const icons = new Set();
function clean(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    // A link control's label and the "Opening…" drawn over it while the browser starts
    // (ui/Opening.svelte): just the label here.
    .replace(/<span class="opening\b[^"]*"><span[^>]*>([\s\S]*?)<\/span><span[^>]*>Opening…<\/span><\/span>/g, "$1")
    // A page's name that opens it in the app: just the name here.
    .replace(/<button[^>]*class="link[^"]*"[^>]*>([\s\S]*?)<\/button>/g, '<b class="pg">$1</b>')
    // Every other control (Show me, the tour, more/less, Details) does nothing on a web page.
    .replace(/<button[\s\S]*?<\/button>/g, "")
    .replace(/\s(?:tabindex|aria-pressed|aria-expanded|data-card)="[^"]*"/g, "")
    .replace(/\sclass="([^"]*)"/g, (_, c) => { const k = c.split(/\s+/).filter((x) => x && !/^svelte-/.test(x)).join(" "); return k ? ` class="${k}"` : ""; })
    .replace(/src="\/game\/([\w.-]+)"/g, (_, f) => (icons.add(f), `src="{{base}}game/${f}"`))
    .replace(/\s{2,}/g, " ");
}

/** The Guide's top-level sections, in order: [class, inner html]. */
function sections(html) {
  const out = [];
  const re = /<section class="([^"]*)"[^>]*>/g;
  let m;
  while ((m = re.exec(html))) {
    let depth = 1, i = re.lastIndex;
    const tag = /<(\/?)section\b[^>]*>/g;
    tag.lastIndex = i;
    let t;
    while (depth && (t = tag.exec(html))) depth += t[1] ? -1 : 1;
    if (depth) throw new Error("The Guide has a <section> that isn't closed");
    out.push([m[1].split(/\s+/)[0], html.slice(i, t.index)]);
    re.lastIndex = tag.lastIndex;
  }
  return out;
}
const parts = sections(guideHtml);
const take = (cls, n = 0) => {
  const hits = parts.filter(([c]) => c === cls);
  if (!hits[n]) throw new Error(`The Guide has no section .${cls} #${n + 1}: has its layout changed?`);
  return clean(hits[n][1]);
};

/** The trust section's link to the privacy page (PRIVACY_PAGE, src/lib/core/links.ts): a button in the
 *  app (bold text once cleaned), a link here. */
function linkPrivacy(html) {
  const page = `<b class="pg">${esc(PRIVACY_PAGE.label)}</b>`;
  if (!html.includes(page)) throw new Error("The Guide's trust section has no link to the privacy page (PRIVACY_PAGE, src/lib/core/links.ts)");
  return html.replace(page, () => `<a href="${href(PRIVACY_PAGE.url)}">${esc(PRIVACY_PAGE.label)}</a>`);
}

// ---- Pages.
const GUIDE = [
  { file: "guide/index.html", title: "Walkthroughs", blurb: "What to open, in order, for the things players come to MyOrbiter for.", body: () => `<section class="walks">${take("walks")}</section>` },
  { file: "guide/pages.html", title: "Every page", blurb: "Each page, by when you'd use it.", body: () => `<section class="routines">${take("routines")}</section>` },
  { file: "guide/your-game.html", title: "Your game and your data", blurb: "What MyOrbiter reads, what it sends, and what Full mode means for your account.", body: () => `<section class="trust">${linkPrivacy(take("trust"))}</section>` },
  { file: "guide/getting-around.html", title: "Getting around", blurb: "The sidebar, the marks on cards and rows, and where every number comes from.", body: () => `<section class="cols">${take("cols")}</section>` },
];

// ---- Drawings, inline so they take the text's colour.
/** The app's own drawn icons (src/lib/ui/Icon.svelte), read from its source so the site draws the
 *  same family: PATHS on a 16 px grid, PATHS24 (the sections' glyphs, the kinds, the chevrons) on 24. */
const iconSource = readFileSync(join(ROOT, "src/lib/ui/Icon.svelte"), "utf8");
function iconTable(name) {
  const m = iconSource.match(new RegExp(`const ${name}: Record<string, string> = \\{([\\s\\S]*?)\\n\\s*\\};`));
  if (!m) throw new Error(`src/lib/ui/Icon.svelte: ${name} wasn't found`);
  return Object.fromEntries([...m[1].matchAll(/^\s*"?([\w-]+)"?:\s*"([^"]+)",?\s*$/gm)].map((x) => [x[1], x[2]]));
}
const P16 = iconTable("PATHS");
const P24 = iconTable("PATHS24");
/** Pages the app shows with the game's own picture and has no drawn icon for: drawn here in the
 *  same pen (16 px, square ends, nothing filled), since game art stays inside the screenshots. */
const SITE16 = {
  // The Foundry: an anvil on its foot.
  foundry: "M1.5 3.5h10l3 2.5h-4.5L8.5 8.5v2h-3v-2L3.5 6H1.5zM4 13.5h7.5M5.5 10.5 4 13.5M8.5 10.5l1.5 3",
  // A riven: the mod's diamond, twisted through.
  rivens: "M8 1.2 13.2 8 8 14.8 2.8 8zM8 4.2 10 8l-4 .2L8 11.8",
  // Spare copies going up for sale: two cards, an arrow rising from the front one.
  spares: "M2.5 5h7.5v9.5H2.5zM5 2.5h8.5V12M6.25 12.2V7.8M4.4 9.6l1.85-1.85L8.1 9.6",
};
/** One icon: the app's pen (miter joins, square ends, nothing filled), in the text's colour. */
function icon(name, { size = 16, stroke = 1.3, cls = "ic" } = {}) {
  const d = Object.hasOwn(P24, name) ? P24[name] : Object.hasOwn(P16, name) ? P16[name] : Object.hasOwn(SITE16, name) ? SITE16[name] : null;
  if (!d) throw new Error(`no drawn icon "${name}" (src/lib/ui/Icon.svelte, or SITE16 here)`);
  const box = Object.hasOwn(P24, name) ? 24 : 16;
  return `<svg class="${cls}" viewBox="0 0 ${box} ${box}" width="${size}" height="${size}" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linejoin="miter" stroke-linecap="square"/></svg>`;
}
/** A page's icon: the drawn one pages.ts names, else the app's drawn icon of the same name as the
 *  page, else the site's own (SITE16). */
const pageIcon = (p) => icon("line" in p.icon ? p.icon.line : p.id);

/** The platform glyphs: drawn for MyOrbiter in the wordmark's line style (design/icon/platform),
 *  no third-party logos. */
const glyph = (body, join = "miter", cap = "square") => `<svg class="glyph" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="${join}" stroke-linecap="${cap}">${body}</svg>`;
const GLYPHS = {
  window: glyph('<path d="M6 3.5h14.5v14.5l-2.5 2.5H3.5V6z"/><path d="M3.5 12h17M12 3.5v17"/>'),
  penguin: glyph('<path d="M12 2.8c-2.9 0-4.4 2.3-4.4 5v2.4L5.4 15c-.7 1.6-.4 3.5 1 4.6h11.2c1.4-1.1 1.7-3 1-4.6l-2.2-4.8V7.8c0-2.7-1.5-5-4.4-5z"/><path d="M9.6 12.2c-.8 1.6-1 3.6-.4 5.2M14.4 12.2c.8 1.6 1 3.6.4 5.2"/><path d="M10.6 8.6l1.4 1.2 1.4-1.2"/><path d="M7.2 19.6l-1.4 1.6h4.4M16.8 19.6l1.4 1.6h-4.4"/>', "round", "round"),
  handheld: glyph('<path d="M3.5 6.5h17l2 2v7l-2 2h-17l-2-2v-7z"/><path d="M8 9.5h8v5H8z"/><path d="M4.3 12h1.4M5 11.3v1.4M18.6 11v.1M18.6 13v.1"/>'),
};

/** The header's links, each with its icon; the wordmark first. */
const NAV = [
  ["guide/index.html", "Guide", "guide"],
  ["whats-new.html", "What's new", "event"],
  ["index.html#download", "Download", "import"],
  [REPO, "Source on GitHub", "external"],
];
/** The Guide's own pages, each with its icon. */
const GUIDE_ICONS = { "guide/index.html": "arrow-right", "guide/pages.html": "cards", "guide/your-game.html": "lock", "guide/getting-around.html": "planner" };

/** The one script: the landing's tour, the screenshot viewer and the visitor's platform first. In
 *  the head, so the page draws once with the tour folded into tabs rather than unfolding after. */
const SCRIPT = "site.js";

function page({ file, title, blurb, body, section, kicker, head, script }) {
  const base = "../".repeat(file.split("/").length - 1);
  const nav = NAV.map(([href, label, ic]) => {
    const out = href.startsWith("https:");
    const current = !out && (href === file || (section && href.startsWith(section)));
    return `<a href="${out ? href : base + href}"${out ? ' class="out"' : ""}${current ? ' aria-current="page"' : ""}>${icon(ic, { size: 14 })}<span>${esc(label)}</span></a>`;
  }).join("");
  const sub = section === "guide/" ? `<nav class="guide-nav" aria-label="Guide">${GUIDE.map((g) => `<a class="chip" href="${base}${g.file}"${g.file === file ? ' aria-current="page"' : ""}>${icon(GUIDE_ICONS[g.file])}<span>${esc(g.title)}</span></a>`).join("")}</nav>` : "";
  // Every page but the landing: the app's page head, kicker, title and one line, then the engraved rule.
  const top = head ? head(base) : `<div class="head"><div class="tx">${kicker ? `<p class="register kicker">${esc(kicker)}</p>` : ""}<h1 class="mark">${esc(title)}</h1><p class="lede">${esc(blurb)}</p></div></div><div class="engr" aria-hidden="true"></div>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title === "MyOrbiter" ? "MyOrbiter, the Warframe companion" : `${title} · MyOrbiter`)}</title>
<meta name="description" content="${esc(blurb)}">
<link rel="icon" href="${base}icon.svg" type="image/svg+xml">
<link rel="icon" href="${base}icon.png" sizes="32x32">
<link rel="stylesheet" href="${base}site.css">
${script ? `<script src="${base}${SCRIPT}"></script>\n` : ""}</head>
<body>
<a class="skip" href="#content">Skip to the page</a>
<header class="top"><nav class="main" aria-label="Site"><a class="home" href="${base}index.html"${file === "index.html" ? ' aria-current="page"' : ""}><img class="wordmark" src="${base}wordmark-gold.svg" width="145" height="34" alt="MyOrbiter"></a>${nav}</nav></header>
<main id="content">
${top}
${sub}
${body().replaceAll("{{base}}", () => base)}
</main>
<footer class="foot">
<p>MyOrbiter is a fan-made tool, not affiliated with or endorsed by Digital Extremes. Warframe and its artwork are © and ™ Digital Extremes Ltd.; the game's icons shown here are theirs, used to identify what they depict, and are not covered by MyOrbiter's licence.</p>
<p>MyOrbiter is free software under the <a href="${REPO}/blob/main/LICENSE">GNU General Public License, version 3 only</a>, with no warranty. <a href="${base}index.html#licence">Licence and sources</a> · <a href="${REPO}">Source on GitHub</a> · <a href="${REPO}/blob/main/NOTICE.md">Notices</a> · <a href="${href(PRIVACY_PAGE.url)}">What it reads and sends</a></p>
</footer>
</body>
</html>
`;
}

// What's New: one section per update, newest first, as the app's Guide lists them.
const longDay = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
function whatsNew() {
  return news.map((e) => {
    const items = e.items.map((it) => typeof it === "string" ? `<li>${esc(it)}</li>` : `<li><b>${esc(it.title)}.</b> ${esc(it.text)}</li>`).join("");
    const id = `update-${esc(e.id)}`;
    return `<section class="update" id="${id}"><h2 class="mark"><a href="#${id}">${esc(longDay(e.date))}</a></h2><ul>${items}</ul></section>`;
  }).join("\n");
}

// ---- Downloads: read from the releases on GitHub once, here, and written into the pages
// (scripts/site-downloads.mjs). With --offline nothing is read and the buttons point at Releases.
const OFFLINE = args.includes("--offline");
if (args.includes("--release")) console.log("site: --release is no longer read; the downloads come from the channels' manifests on GitHub.");
/** How the build names itself to GitHub. */
const USER_AGENT = `MyOrbiter-site (+${REPO})`;
/** The workflow's token, sent to the API only (api.github.com), never with a download. */
const TOKEN = process.env.GITHUB_TOKEN ?? "";

/** A JSON answer from GitHub: its value, or null when there's no such file (404). Any other
 *  answer, a failed read or text that isn't JSON stops the build. A download from a release is
 *  redirected to GitHub's file host, and followed. */
async function get(url) {
  let res;
  const headers = { "User-Agent": USER_AGENT, Accept: "application/json" };
  if (TOKEN && url.startsWith(`${API}/`)) headers.Authorization = `Bearer ${TOKEN}`;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
  } catch (e) {
    throw new Error(`reading ${url}: ${e.message}`);
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`reading ${url} answered ${res.status}`);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`reading ${url}: not JSON`);
  }
}

/** The best channel's build for the buttons, and the last builds for downloads.html. */
async function readReleases() {
  const heads = {};
  for (const [key] of CHANNELS) heads[key] = await get(channelManifest(key));
  const front = frontButtons(heads);
  // Newest first; the channels' own releases are among them, and skipped.
  const releases = await get(`${API}/releases?per_page=40`);
  if (releases == null) throw new Error("github.com has no releases list for the repository: is it public?");
  const rows = buildRows(releases, { heads });
  if (!rows.length) throw new Error("Releases lists no build made on GitHub");
  console.log(`site: ${front.label}; downloads.html lists ${rows.length} builds.`);
  return { front, rows };
}
const DL = OFFLINE ? null : await readReleases();

/** What each channel is, as docs/install.md puts it, when no better channel has a build. */
const CHANNEL_NOTE = {
  stable: "",
  beta: "No Stable build yet. Beta is the next Stable, a few days early.",
  experimental: "No Stable or Beta build yet. Experimental is every change, as soon as it's built: it may break.",
};
/** An address of this repository's on github.com, escaped for an attribute; anything else stops the build. */
function href(url) {
  const ok = projectUrl(url);
  if (!ok) throw new Error(`not this project's address on ${HOST}: ${url}`);
  return esc(ok);
}
const fileName = (url) => decodeURIComponent(new URL(url).pathname.split("/").pop());

// The front page: one button per platform, the best channel's files. Windows the setup .exe, Linux
// and the Steam Deck the AppImage; the .deb is on downloads.html. site.js puts the visitor's
// platform first (from the browser's user agent, read on the page, sent nowhere).
const PLATFORMS = [
  { key: "windows", label: "Windows 10 and 11", short: "Windows", glyph: "window", note: "Installs for your user; SmartScreen asks the first time: More info, Run anyway." },
  { key: "linux", label: "Linux", short: "Linux", glyph: "penguin", note: "AppImage: make it executable and open it." },
  { key: "deck", label: "Steam Deck", short: "the Steam Deck", glyph: "handheld", note: "Desktop mode." },
];
function downloads(base) {
  const f = DL?.front;
  const rows = PLATFORMS.map((p) => {
    const url = f ? href(f.buttons[p.key]) : `${REPO}/releases`;
    const what = f ? `<span class="file register figures">${esc(fileName(f.buttons[p.key]))}</span>` : `<span class="file register">on Releases</span>`;
    return `<li class="dl" data-platform="${p.key}" data-name="${esc(p.short)}"><a class="plate" href="${url}">${GLYPHS[p.glyph]}<span class="name">${esc(p.label)}</span>${what}<span class="note">${esc(p.note)}</span></a></li>`;
  }).join("");
  const head = f
    ? `<p class="register channel">${esc(f.label)}</p>${CHANNEL_NOTE[f.channel] ? `<p class="small dim">${esc(CHANNEL_NOTE[f.channel])}</p>` : ""}`
    : `<p class="register channel">The latest builds are on Releases</p>`;
  const check = f ? `Check a download against <span class="register">SHA256SUMS</span> on <a href="${href(`${REPO}/releases/tag/${f.tag}`)}">its release</a>` : `Check a download against <span class="register">SHA256SUMS</span> on its release`;
  return `${head}<ul class="dls">${rows}</ul><p class="small">${check} (<a href="${base}downloads.html#check">how</a>). <a href="${base}downloads.html">Other versions</a>: older builds, the .deb, release notes.</p>`;
}

/** The README's own words for a section (### heading), as HTML: paragraphs and flat "- " lists,
 *  with `code` and **bold**. A link, a quote, a numbered or nested list, a code block, emphasis or
 *  HTML stops the build rather than show as text. */
function readmeSection(heading) {
  const md = readFileSync(join(ROOT, "README.md"), "utf8").replace(/\r\n/g, "\n");
  const m = md.match(new RegExp(`^### ${heading}\\n([\\s\\S]*?)(?=^#{2,3} )`, "m"));
  if (!m) throw new Error(`README.md has no "### ${heading}" section: has it changed?`);
  const inline = (t) => t.split("`").map((part, i) => i % 2 ? `<code>${esc(part)}</code>` : esc(part).replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")).join("");
  return m[1].trim().split(/\n\s*\n/).map((block) => {
    if (/\[[^\]]*\]\(|<|\*|_|^\s*(?:#|>|\d+[.)]|```|~~~)|^\s+[-+*]/m.test(block.replace(/`[^`]*`/g, "").replace(/\*\*[^*]+\*\*/g, ""))) throw new Error(`README.md, ${heading}: markup the site can't draw: ${block.slice(0, 60)}`);
    if (block.startsWith("- ")) return `<ul>${block.split(/\n(?=- )/).map((li) => `<li>${inline(li.slice(2).replace(/\s*\n\s*/g, " "))}</li>`).join("")}</ul>`;
    return `<p>${inline(block.replace(/\s*\n\s*/g, " "))}</p>`;
  }).join("");
}

// downloads.html: the last builds, newest first, each with the files it carries.
const FILE_GLYPH = { appimage: "penguin", deb: "penguin", exe: "window" };
function builds() {
  const rows = DL ? DL.rows.map((r) => {
    const files = FILES.filter((f) => r.files[f.key]).map((f) => `<a class="stamp" href="${href(r.files[f.key].url)}" title="${esc(r.files[f.key].name)}">${GLYPHS[FILE_GLYPH[f.key]]}${esc(f.label)}</a>`).join("");
    const channel = r.channel ? `<span class="tag${r.channel === "Stable" ? " on" : ""}">${esc(r.channel)}</span>` : "";
    const sums = r.sums ? ` · <a href="${href(r.sums)}">SHA256SUMS</a>` : "";
    return `<li class="build plate"><div class="what"><span class="ver figures">${esc(r.version)}</span>${channel}<time class="register" datetime="${esc(r.date)}">${esc(longDay(r.date))}</time></div><div class="files">${files || `<span class="small dim">No downloads in this build</span>`}</div><p class="small"><a href="${href(r.notes)}">Release notes</a>${sums}</p></li>`;
  }).join("") : "";
  const list = DL
    ? `<p class="small dim">A channel shows where one names the build now; a build that has been Stable stays marked.</p><ol class="builds">${rows}</ol>`
    : `<p>This copy of the site was built without reading GitHub: every build is on <a href="${REPO}/releases">Releases</a>.</p>`;
  return `<section class="list" aria-label="Builds">${list}</section>
<section class="check plate" id="check"><h2 class="register">Checking a download</h2>${readmeSection("Checking a download")}</section>
<section class="more"><p class="small">Every build, with its source (<span class="register">myorbiter-source.tar.gz</span>) and checksums: <a href="${REPO}/releases">Releases on GitHub</a>. The code: <a href="${REPO}">the repository</a>. The builds made before 0.2.120 are on GitLab's releases.</p></section>`;
}

/** The app's four sections, each in its colour, crest and glyph: the question it answers, its pages
 *  from the app's own page list (src/lib/pages.ts) with their icons, and a screenshot. `kinds`: the
 *  section names the Arsenal's slots, each with its icon. */
const SECTIONS = [
  ["Fissures", "fissures", "What to crack, and which reward to take."],
  ["Progress", "progress", "What's left to master and build, and how to get it.", true],
  ["Collection", "collection", "What you hold, what to keep and what to sell."],
  ["Trade", "trade", "Your warframe.market listings at the market price, never under your floors, and your sales."],
];
/** The Arsenal's slots (src/lib/core/kinds.ts), with the app's icon for each. */
const KINDS = [["warframe", "Warframe"], ["primary", "Primary"], ["secondary", "Secondary"], ["melee", "Melee"], ["companion", "Companion"], ["archwing", "Archwing"], ["necramech", "Necramech"], ["amp", "Amp"]];
/** The screenshots (site/shots/, large/ at twice the pixels; npm run screenshots -- --only site), by
 *  the page they show: a short caption, and what's in the picture for someone who can't see it. */
const SHOTS = {
  home: { file: "home", caption: "today at a glance", alt: "Home: the world's clocks, your orders and status, what's ready to list, and the open fissures with your best relic for each era" },
  mission: { file: "current-fissure", caption: "the reward screen, scored", alt: "Current fissure: the four reward cards scored, with Take this on the best one, and everything the squad's relics can drop" },
  relics: { file: "relics", caption: "what a crack is worth", alt: "Relics: your relics counted by era with your Void Traces, then every relic you hold as a card with its rewards and what a crack is worth" },
  mastery: { file: "mastery", caption: "what's left, easiest first", alt: "Mastery: what you have mastered of each kind, your rank and what is left, then every item not yet mastered, easiest first" },
  builds: { file: "builds", caption: "by tier, with what's missing", alt: "Builds: Saryn Prime's builds by tier, with a suggested build and its mods" },
  inventory: { file: "inventory", caption: "everything you own, with its worth", alt: "Inventory: your most valuable spares, what your spares are worth, then everything you own as cards" },
  market: { file: "orders", caption: "your listings, kept at the market price", alt: "Orders: your listings, their listed value, how many are undercut and the trades left today, each with its meter, then your status and your listings" },
  spares: { file: "sell-spares", caption: "a plan you look over first", alt: "Sell spares: what to sell in each category and its rule, your minimum prices, and the plan of new and changed listings ready to apply" },
};
/** A screenshot as a link to its large file: the viewer (site.js) opens it in place; without the
 *  script, the link opens the large file. */
function shotLink(id, cls, { lazy = true } = {}) {
  const s = SHOTS[id];
  const label = pageById[id].label;
  return `<a class="${cls}" href="{{base}}shots/large/${s.file}.webp" data-shot="${s.file}" data-name="${esc(label)}" data-caption="${esc(s.caption)}"><img src="{{base}}shots/${s.file}.webp" width="1280" height="800"${lazy ? ' loading="lazy"' : ""} alt="${esc(s.alt)}"></a>`;
}
function tour() {
  // The tabs, hidden until the script makes them tabs; without it, every section reads in turn.
  const tabs = SECTIONS.map(([name, key], i) => `<button type="button" role="tab" class="tab" id="tab-${key}" aria-controls="sec-${key}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}" style="--sec: var(--${key})">${icon(`sec-${key}`, { size: 18, stroke: 1.8 })}<span>${name}</span></button>`).join("");
  const panels = SECTIONS.map(([name, key, line, kinds]) => {
    const pages = PAGES.filter((p) => p.group === name);
    if (!pages.length) throw new Error(`src/lib/pages.ts has no pages in ${name}: has it changed?`);
    const shown = pages.filter((p) => SHOTS[p.id]);
    if (!shown.length) throw new Error(`site: no screenshot of a page in ${name}`);
    // A page with a screenshot is a control that shows it; the others are tags, a fact.
    const chips = pages.map((p) => SHOTS[p.id]
      ? `<li><a class="chip" href="{{base}}shots/large/${SHOTS[p.id].file}.webp" data-pick="${SHOTS[p.id].file}" data-small="{{base}}shots/${SHOTS[p.id].file}.webp" data-name="${esc(p.label)}" data-caption="${esc(SHOTS[p.id].caption)}" data-alt="${esc(SHOTS[p.id].alt)}"${p === shown[0] ? ' aria-current="true"' : ""}>${pageIcon(p)}<span>${esc(p.label)}</span></a></li>`
      : `<li><span class="chip tag" title="No screenshot of this page here">${pageIcon(p)}<span>${esc(p.label)}</span></span></li>`).join("");
    const kindRow = kinds ? `<ul class="kinds" aria-label="Every kind, counted">${KINDS.map(([k, label]) => `<li class="kind">${icon(`kind-${k}`, { size: 16, stroke: 1.4 })}<span>${label}</span></li>`).join("")}</ul>` : "";
    // Every page with a screenshot is in the panel's well's list: the chips swap which one shows.
    const first = shown[0];
    return `<section class="panel" id="sec-${key}" aria-labelledby="h-${key}" style="--sec: var(--${key})">
<div class="ptx"><div class="phead"><span class="crest" aria-hidden="true"><i class="outer"></i><i class="inner"></i>${icon(`sec-${key}`, { size: 30, stroke: 1.5 })}</span><div><p class="register kicker">Section</p><h3 class="mark" id="h-${key}">${name}</h3></div></div>
<p class="line">${esc(line)}</p>
<ul class="chips" aria-label="${name}'s pages">${chips}</ul>${kindRow}</div>
<figure class="frame">${shotLink(first.id, "shot well")}<figcaption><b>${esc(first.label)}</b> <span>${esc(SHOTS[first.id].caption)}</span></figcaption></figure>
</section>`;
  }).join("\n");
  return `<div class="tabs" role="tablist" aria-label="MyOrbiter's sections" hidden>${tabs}</div>\n${panels}`;
}
/** The viewer the screenshots open in (site.js): constant markup, filled in by the script. */
const VIEWER = `<dialog class="viewer" id="viewer" aria-labelledby="viewer-name">
<figure><div class="well big"><img alt="" width="2560" height="1600"></div>
<figcaption><b id="viewer-name"></b> <span class="cap"></span><span class="count register"></span></figcaption></figure>
<div class="vbar"><button type="button" class="stamp prev">${icon("chev-right", { size: 16, stroke: 1.8, cls: "ic flip" })}<span>Previous</span></button><button type="button" class="stamp next"><span>Next</span>${icon("chev-right", { size: 16, stroke: 1.8 })}</button><form method="dialog"><button class="stamp close" autofocus>${icon("close", { size: 14 })}<span>Close</span></button></form></div>
</dialog>`;

/** The landing's head: the name, one sentence, the download (the visitor's platform once site.js
 *  knows it; the list below without it) and What's new; Home's screenshot beside it. */
function hero(base) {
  return `<div class="hero"><div class="tx">
<p class="register kicker">Free software · GPL-3.0-only · Linux, the Steam Deck and Windows</p>
<h1 class="mark">MyOrbiter</h1>
<p class="lede">A Warframe companion for your desktop: your relics, sets, mastery and spares, and your warframe.market listings, kept in one place.</p>
<div class="acts"><a class="primary get" href="${base}index.html#download">${icon("import", { size: 16, stroke: 1.5 })}<span>${esc(DL?.front.label ?? "Download")}</span></a><a class="link" href="${base}whats-new.html">${icon("event", { size: 14 })}<span>What's new</span></a></div>
<p class="for small dim" hidden></p>
</div>
<figure class="frame lit">${shotLink("home", "shot well", { lazy: false }).replaceAll("{{base}}", base)}<figcaption><b>Home</b> <span>${esc(SHOTS.home.caption)}</span></figcaption></figure>
</div><div class="engr" aria-hidden="true"></div>`;
}

function landing() {
  const tpl = readFileSync(join(SRC, "landing.html"), "utf8");
  // Functions, not strings: a "$" in a release's name or the warning stays as it is.
  return tpl.replace("{{downloads}}", () => downloads("{{base}}")).replace("{{tour}}", () => tour()).replace("{{viewer}}", () => VIEWER).replace("{{fullModeWarning}}", () => esc(warning));
}

// ---- Write it out.
rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, "guide"), { recursive: true });
const write = (file, html) => writeFileSync(join(OUT, file), html);
write("index.html", page({
  file: "index.html", title: "MyOrbiter", script: true, head: hero,
  blurb: "A Warframe companion for your desktop: your relics, sets, mastery and spares, and your warframe.market listings, kept in one place.",
  body: landing,
}));
for (const g of GUIDE) write(g.file, page({ ...g, section: "guide/", kicker: "Guide" }));
write("whats-new.html", page({ file: "whats-new.html", title: "What's new", kicker: "Updates", blurb: "Every update, newest first, as the app's Guide lists them.", body: whatsNew }));
write("downloads.html", page({ file: "downloads.html", title: "Other versions", kicker: "Downloads", blurb: "The newest builds, up to ten, with the files each one carries and its release notes.", body: builds }));

cpSync(join(SRC, "site.css"), join(OUT, "site.css"));
cpSync(join(SRC, SCRIPT), join(OUT, SCRIPT));
cpSync(join(SRC, "shots"), join(OUT, "shots"), { recursive: true, filter: (f) => !f.endsWith(".md") });
// The app icon's small drawing (npm run icons), as the favicon and the mark in the header.
cpSync(join(ROOT, "src-tauri/icons/icon-small.svg"), join(OUT, "icon.svg"));
cpSync(join(ROOT, "src-tauri/icons/32x32.png"), join(OUT, "icon.png"));
// The wordmark with its gold line (site/wordmark-gold.svg) as the first link in the header.
cpSync(join(SRC, "wordmark-gold.svg"), join(OUT, "wordmark-gold.svg"));
mkdirSync(join(OUT, "game"));
for (const f of icons) cpSync(join(ROOT, "public/game", f), join(OUT, "game", f));
// The app's two typefaces (SIL Open Font License, its text beside them): Archivo Narrow for titles,
// labels and figures, IBM Plex Sans for the text.
mkdirSync(join(OUT, "fonts"));
for (const [pkg, files] of [["archivo-narrow", ["latin-500-normal", "latin-600-normal", "latin-700-normal"]], ["ibm-plex-sans", ["latin-400-normal", "latin-500-normal"]]]) {
  for (const f of files) cpSync(join(ROOT, "node_modules/@fontsource", pkg, "files", `${pkg}-${f}.woff2`), join(OUT, "fonts", `${pkg}-${f}.woff2`));
  cpSync(join(ROOT, "node_modules/@fontsource", pkg, "LICENSE"), join(OUT, "fonts", `${pkg}-LICENSE.txt`));
}

/** Phone widths the landing and Guide pages must fit without scrolling sideways (CSS px). */
const NARROW = [320, 360, 390];
/** The pages checked at those widths. */
const NARROW_PAGES = ["index.html", ...GUIDE.map((g) => g.file)];
/** The page's side padding (`main`, 1.5rem on each side) in px. */
const GUTTERS = 2 * 1.5 * 16;

/**
 * Grids on a page whose narrowest column is wider than the page at a phone's width:
 * `repeat(auto-fit, minmax(20rem, 1fr))` still draws one 20rem column at 320 px, past the edge.
 * A column written `minmax(min(100%, 20rem), 1fr)` shrinks to the page instead. Only rules whose
 * classes all appear on the page are checked; rem is taken as 16 px.
 */
function narrowOverflow(css, html, file) {
  const used = new Set([...html.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)));
  const out = [];
  for (const [, selector, body] of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const cols = /grid-template-columns:\s*repeat\(\s*auto-(?:fit|fill)\s*,\s*minmax\(\s*([^,]+?)\s*,/.exec(body);
    if (!cols || cols[1].startsWith("min(100%")) continue;
    const classes = [...selector.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
    if (!classes.length || !classes.every((c) => used.has(c))) continue;
    const len = /^([\d.]+)(rem|px)$/.exec(cols[1]);
    if (!len) continue;
    const px = Number(len[1]) * (len[2] === "rem" ? 16 : 1);
    for (const w of NARROW) if (px > w - GUTTERS) out.push(`site.css: ${selector.trim()} needs ${px} px a column; ${file} has ${w - GUTTERS} at ${w} px (use minmax(min(100%, ${cols[1]}), 1fr))`);
  }
  return out;
}

// ---- Checks: every local link, image and stylesheet url() resolves (same-page anchors included),
// external links go only to github.com, the only script is site.js and it reaches for nothing
// outside its page, no dev-*.json file (a real account's data) is in the output or named in it, and
// the landing and Guide pages' grids fit a phone 320, 360 and 390 px wide.
if (args.includes("--check")) {
  const ALLOWED = new Set([HOST]);
  const all = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? all(join(d, f)) : [join(d, f)]));
  const files = all(OUT);
  const bad = [];
  for (const f of files) {
    const rel = relative(OUT, f);
    if (/dev-.*\.json$/.test(rel)) bad.push(`${rel}: account data file`);
    if (!f.endsWith(".html") && !f.endsWith(".css")) continue;
    const text = readFileSync(f, "utf8");
    if (/dev-[\w-]+\.json/.test(text)) bad.push(`${rel}: names a dev-*.json file`);
    // The only script a page may load is the site's own file (site.js, checked below): no other
    // script, no inline code or handler, no frame, nothing that reads github.com (or anything) on load.
    const own = new RegExp(`<script src="(?:\\.\\./)*${SCRIPT.replace(".", "\\.")}"></script>`, "g");
    if (f.endsWith(".html") && /<(?:script|iframe|object|embed)\b|<meta[^>]+http-equiv|<[a-z][^>]*\son[a-z]+\s*=/i.test(text.replace(own, ""))) bad.push(`${rel}: carries a script other than ${SCRIPT}`);
    for (const m of text.matchAll(/(?:href|src|data-small)="([^"]+)"|url\(["']?([^"')]+)/g)) {
      const url = m[1] ?? m[2];
      if (!url || url.startsWith("data:")) continue;
      if (/^https?:/.test(url)) { const h = new URL(url).hostname; if (!ALLOWED.has(h)) bad.push(`${rel}: link to ${h}`); continue; }
      if (url.startsWith("mailto:")) continue;
      if (url.startsWith("#")) { if (url.length > 1 && !text.includes(`id="${url.slice(1)}"`)) bad.push(`${rel}: ${url} has no target`); continue; }
      // From the site's root ("/…") breaks under the project's address (/myorbiter/): relative only.
      if (url.startsWith("/")) { bad.push(`${rel}: ${url} is from the root, not relative`); continue; }
      const [path, hash] = url.split("#");
      const target = resolve(dirname(f), path || relative(dirname(f), f));
      if (relative(OUT, target).startsWith("..")) { bad.push(`${rel}: ${url} leaves the site`); continue; }
      if (!existsSync(target)) { bad.push(`${rel}: ${url} doesn't exist`); continue; }
      if (hash && target.endsWith(".html") && !readFileSync(target, "utf8").includes(`id="${hash}"`)) bad.push(`${rel}: ${url} has no #${hash}`);
    }
  }
  // site.js works on the page it is in and nothing else: no address (a "//host" one included), no
  // request, no storage, no element made but a button, a span or a link, no navigation, no markup
  // built from text, nothing run from a string. A tripwire for mistakes, read with the script: only
  // whole-line comments are left out, so nothing after code on a line escapes it.
  const js = readFileSync(join(OUT, SCRIPT), "utf8").replace(/^\s*\/\/.*$|\/\*[\s\S]*?\*\//gm, "");
  const reach = /["'`]\/\/|\bcreateElement\(\s*["'`](?!(?:button|span|a)["'`])|\blocation\.(?:assign|replace|reload)\b|\.click\(\)|\bObject\.assign\b|\b(?:https?:|fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|localStorage|sessionStorage|indexedDB|cookie|caches|serviceWorker|importScripts|import|eval|Function|innerHTML|outerHTML|insertAdjacentHTML|write|postMessage|setAttributeNS|createContextualFragment)\b|\bwindow\.open\b|\blocation\s*(?:\.href)?\s*=[^=]|\bsrc(?:doc)?\s*=\s*["'`]|\bon[a-z]+\s*=/g;
  for (const m of js.matchAll(reach)) bad.push(`${SCRIPT}: "${m[0]}" (it may only work on its own page)`);
  const css = readFileSync(join(OUT, "site.css"), "utf8");
  for (const file of NARROW_PAGES) bad.push(...narrowOverflow(css, readFileSync(join(OUT, file), "utf8"), file));
  if (bad.length) { console.error(bad.join("\n")); process.exit(1); }
  console.log(`site/_site: ${files.length} files, every link checked, the landing and Guide pages fit ${NARROW.join(", ")} px.`);
} else {
  console.log("site/_site written.");
}
