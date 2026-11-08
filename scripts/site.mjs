// Builds MyOrbiter's website (site/ → site/_site/): the landing page, the in-app Guide as pages,
// What's New and the list of downloads, as plain HTML and CSS for GitLab Pages. The Guide and
// What's New come from the app's own source (src/lib/tabs/Guide.svelte, src/lib/whatsNew.ts), drawn
// once with Svelte's server renderer through Vite, so the site says what the app says. Nothing here
// runs in the browser: the download links are read from the package registry once, at build time
// (scripts/site-downloads.mjs), and written into the pages.
//
//   node scripts/site.mjs             site/_site/, the buttons offering the best channel's build:
//                                     Stable, else Beta, else Experimental (channel/<c>/latest.json),
//                                     and downloads.html the last builds (the releases)
//   node scripts/site.mjs --offline   the same without reading the registry: the buttons point at
//                                     Releases (a local build)
//   node scripts/site.mjs --check     build, then check every link, that no page carries a script,
//                                     and that no dev-*.json (real account data) is in it
//
// Reading the registry fails the build on anything but a file that's there or a 404 (no build on
// that channel yet), and on a manifest that doesn't check out: the site never links a wrong file.
// Screenshots are of the demo account only (npm run dev:demo; site/README.md, Screenshots).
import { createServer } from "vite";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { API, buildRows, CHANNELS, FILES, frontButtons, HOST, PACKAGES, REPO, safeUrl as projectUrl, stableVersions } from "./site-downloads.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "site");
const OUT = join(SRC, "_site");
const args = process.argv.slice(2);

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ---- The app's own words, drawn on the server.
const vite = await createServer({ root: ROOT, server: { middlewareMode: true, hmr: false }, appType: "custom", logLevel: "error" });
let guideHtml, news, warning, PAGES;
try {
  const { render } = await vite.ssrLoadModule("svelte/server");
  const Guide = (await vite.ssrLoadModule("/src/lib/tabs/Guide.svelte")).default;
  ({ NEWS: news } = await vite.ssrLoadModule("/src/lib/whatsNew.ts"));
  ({ FULL_MODE_WARNING: warning } = await vite.ssrLoadModule("/src/lib/FullMode.svelte"));
  ({ PAGES } = await vite.ssrLoadModule("/src/lib/pages.ts"));
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

/** The trust section's link to the privacy page: a button in the app (bold text once cleaned), a link here. */
function linkPrivacy(html) {
  const page = "<b class=\"pg\">What MyOrbiter reads and sends</b>";
  if (!html.includes(page)) throw new Error("The Guide's link to docs/privacy.md wasn't found: has its wording changed?");
  return html.replace(page, () => `<a href="${REPO}/-/blob/main/docs/privacy.md">What MyOrbiter reads and sends</a>`);
}

// ---- Pages.
const GUIDE = [
  { file: "guide/index.html", title: "Walkthroughs", blurb: "What to open, in order, for the things players come to MyOrbiter for.", body: () => `<section class="walks">${take("walks")}</section>` },
  { file: "guide/pages.html", title: "Every page", blurb: "Each page, by when you'd use it.", body: () => `<section class="routines">${take("routines")}</section>` },
  { file: "guide/your-game.html", title: "Your game and your data", blurb: "What MyOrbiter reads, what it sends, and what Full mode means for your account.", body: () => `<section class="trust">${linkPrivacy(take("trust"))}</section>` },
  { file: "guide/getting-around.html", title: "Getting around", blurb: "The sidebar, the marks on cards and rows, and where every number comes from.", body: () => `<section class="cols">${take("cols")}</section>` },
];

const NAV = [["index.html", "MyOrbiter"], ["guide/index.html", "Guide"], ["whats-new.html", "What's new"], ["index.html#download", "Download", "dl-link"], [REPO, "Source on GitLab", "out"]];

// ---- Drawings, inline so they take the text's colour.
/** The app icon's craft (the wordmark's O), from the wordmark the app ships. */
const wordmarkSvg = readFileSync(join(ROOT, "src-tauri/icons/wordmark.svg"), "utf8");
const craft = [...wordmarkSvg.matchAll(/<path d="([^"]+)" fill="(#[0-9a-f]{6})"/g)];
if (craft.length !== 2) throw new Error("src-tauri/icons/wordmark.svg: the craft's two paths weren't found");
const LOGO = `<svg viewBox="15.6 8.5 68.8 81.5" width="101" height="120" role="img" aria-label="MyOrbiter's icon, the craft"><path d="${craft[0][1]}" fill="#f1f3f6"/><path d="${craft[1][1]}" fill="#d6ae4a"/></svg>`;
/** The platform glyphs: drawn for MyOrbiter in the wordmark's line style, no third-party logos. */
const glyph = (body, join = "miter", cap = "square") => `<svg class="glyph" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="${join}" stroke-linecap="${cap}">${body}</svg>`;
const GLYPHS = {
  window: glyph('<path d="M6 3.5h14.5v14.5l-2.5 2.5H3.5V6z"/><path d="M3.5 12h17M12 3.5v17"/>'),
  penguin: glyph('<path d="M12 2.8c-2.9 0-4.4 2.3-4.4 5v2.4L5.4 15c-.7 1.6-.4 3.5 1 4.6h11.2c1.4-1.1 1.7-3 1-4.6l-2.2-4.8V7.8c0-2.7-1.5-5-4.4-5z"/><path d="M9.6 12.2c-.8 1.6-1 3.6-.4 5.2M14.4 12.2c.8 1.6 1 3.6.4 5.2"/><path d="M10.6 8.6l1.4 1.2 1.4-1.2"/><path d="M7.2 19.6l-1.4 1.6h4.4M16.8 19.6l1.4 1.6h-4.4"/>', "round", "round"),
  handheld: glyph('<path d="M3.5 6.5h17l2 2v7l-2 2h-17l-2-2v-7z"/><path d="M8 9.5h8v5H8z"/><path d="M4.3 12h1.4M5 11.3v1.4M18.6 11v.1M18.6 13v.1"/>'),
};

function page({ file, title, blurb, body, section, kicker, acts, logo }) {
  const base = "../".repeat(file.split("/").length - 1);
  const nav = NAV.map(([href, label, cls], i) => {
    const out = href.startsWith("https:");
    const current = !out && (href === file || (section && href.startsWith(section)));
    return `<a href="${out ? href : base + href}"${cls ? ` class="${cls}"` : ""}${current ? ' aria-current="page"' : ""}>${i === 0 ? `<img class="wordmark" src="${base}wordmark-gold.svg" width="145" height="34" alt="${esc(label)}">` : esc(label)}</a>`;
  }).join("");
  const sub = section === "guide/" ? `<nav class="guide-nav" aria-label="Guide">${GUIDE.map((g) => `<a href="${base}${g.file}"${g.file === file ? ' aria-current="page"' : ""}>${esc(g.title)}</a>`).join("")}</nav>` : "";
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
</head>
<body>
<header class="top"><nav class="main" aria-label="Site">${nav}</nav></header>
<div class="pane"><div class="head"><div class="text">${kicker ? `<p class="register kicker">${esc(kicker)}</p>` : ""}<h1 class="mark">${esc(title)}</h1><p class="blurb">${esc(blurb)}</p>${acts ? `<div class="acts">${acts(base)}</div>` : ""}</div>${logo ? `<div class="logo">${LOGO}</div>` : ""}</div></div>
<main>
${sub}
${body().replaceAll("{{base}}", () => base)}
</main>
<footer class="foot">
<p>MyOrbiter is a fan-made tool, not affiliated with or endorsed by Digital Extremes. Warframe and its artwork are © and ™ Digital Extremes Ltd.; the game's icons shown here are theirs, used to identify what they depict, and are not covered by MyOrbiter's licence.</p>
<p>MyOrbiter is free software under the <a href="${REPO}/-/blob/main/LICENSE">GNU General Public License, version 3 only</a>, with no warranty. <a href="${REPO}">Source on GitLab</a> · <a href="${REPO}/-/blob/main/NOTICE.md">Notices</a> · <a href="${REPO}/-/blob/main/docs/privacy.md">What it reads and sends</a></p>
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

// ---- Downloads: read from the package registry once, here, and written into the pages
// (scripts/site-downloads.mjs). With --offline nothing is read and the buttons point at Releases.
const OFFLINE = args.includes("--offline");
if (args.includes("--release")) console.log("site: --release is no longer read; the downloads come from the channels' manifests in the registry.");
/** How the build names itself to gitlab.com. */
const USER_AGENT = `MyOrbiter-site (+${REPO})`;

/** A JSON answer from gitlab.com: its value, or null when there's no such file (404). Any other
 *  answer, a failed read or text that isn't JSON stops the build. */
async function get(url) {
  let res;
  try {
    res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
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
async function readRegistry() {
  const heads = {};
  for (const [key] of CHANNELS) heads[key] = await get(`${PACKAGES}/channel/${key}/latest.json`);
  const front = frontButtons(heads);
  const releases = await get(`${API}/releases?per_page=20`);
  const stable = await get(`${API}/packages?package_type=generic&package_name=stable-builds&order_by=created_at&sort=desc&per_page=100`);
  if (releases == null || stable == null) throw new Error("gitlab.com has no releases or packages list for the project: is it public?");
  const rows = buildRows(releases, { heads, stableBuilds: stableVersions(stable) });
  if (!rows.length) throw new Error("Releases lists no build");
  console.log(`site: ${front.label}; downloads.html lists ${rows.length} builds.`);
  return { front, rows };
}
const DL = OFFLINE ? null : await readRegistry();

/** What each channel is, as docs/install.md puts it, when no better channel has a build. */
const CHANNEL_NOTE = {
  stable: "",
  beta: "No Stable build yet. Beta is the next Stable, a few days early.",
  experimental: "No Stable or Beta build yet. Experimental is every change, as soon as it's built: it may break.",
};
/** An address of this project's on gitlab.com, escaped for an attribute; anything else stops the build. */
function href(url) {
  const ok = projectUrl(url);
  if (!ok) throw new Error(`not this project's address on ${HOST}: ${url}`);
  return esc(ok);
}
const fileName = (url) => decodeURIComponent(new URL(url).pathname.split("/").pop());

// The front page: one button per platform, the best channel's files. Windows the setup .exe, Linux
// and the Steam Deck the AppImage; the .deb is on downloads.html.
const PLATFORMS = [
  { key: "windows", label: "Windows 10 and 11", glyph: "window", note: "Installs for your user; SmartScreen asks the first time: More info, Run anyway." },
  { key: "linux", label: "Linux", glyph: "penguin", note: "AppImage: make it executable and open it." },
  { key: "deck", label: "Steam Deck", glyph: "handheld", note: "Desktop mode." },
];
function downloads(base) {
  const f = DL?.front;
  const rows = PLATFORMS.map((p) => {
    const url = f ? href(f.buttons[p.key]) : `${REPO}/-/releases`;
    const what = f ? `<span class="file register figures">${esc(fileName(f.buttons[p.key]))}</span>` : `<span class="file register">on Releases</span>`;
    return `<li class="dl"><a class="plate" href="${url}">${GLYPHS[p.glyph]}<span class="name">${esc(p.label)}</span>${what}<span class="note">${esc(p.note)}</span></a></li>`;
  }).join("");
  const head = f
    ? `<p class="register channel">${esc(f.label)}</p>${CHANNEL_NOTE[f.channel] ? `<p class="small dim">${esc(CHANNEL_NOTE[f.channel])}</p>` : ""}`
    : `<p class="register channel">The latest builds are on Releases</p>`;
  const check = f ? `Check a download against <span class="register">SHA256SUMS</span> on <a href="${href(`${REPO}/-/releases/${f.tag}`)}">its release</a>` : `Check a download against <span class="register">SHA256SUMS</span> on its release`;
  return `${head}<ul class="dls">${rows}</ul><p class="small">${check} (<a href="${base}downloads.html#check">how</a>). <a href="${base}downloads.html">Other versions</a>: the last builds, the .deb for Debian and Ubuntu, and each build's release notes.</p>`;
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
    const channel = r.channel ? `<span class="tag${r.channel === "Stable" ? " gold" : ""}">${esc(r.channel)}</span>` : "";
    const sums = r.sums ? ` · <a href="${href(r.sums)}">SHA256SUMS</a>` : "";
    return `<li class="build plate"><div class="what"><span class="ver figures">${esc(r.version)}</span>${channel}<time class="register" datetime="${esc(r.date)}">${esc(longDay(r.date))}</time></div><div class="files">${files || `<span class="small dim">No downloads in this build</span>`}</div><p class="small"><a href="${href(r.notes)}">Release notes</a>${sums}</p></li>`;
  }).join("") : "";
  const list = DL
    ? `<p class="small dim">A channel shows where one names the build now; a build that has been Stable stays marked.</p><ol class="builds">${rows}</ol>`
    : `<p>This copy of the site was built without reading the package registry: every build is on <a href="${REPO}/-/releases">Releases</a>.</p>`;
  return `<section class="list" aria-label="Builds">${list}</section>
<section class="check plate" id="check"><h2 class="register">Checking a download</h2>${readmeSection("Checking a download")}</section>
<section class="more"><p class="small">Every build, with its source (<span class="register">myorbiter-source.tar.gz</span>) and checksums: <a href="${REPO}/-/releases">Releases on GitLab</a>. The code: <a href="${REPO}">the repository</a>.</p></section>`;
}

/** The app's four sections, each in its colour: the question it answers and its pages, from the
 *  app's own page list (src/lib/pages.ts). */
const SECTIONS = [
  ["Fissures", "fissures", "What to crack, and which reward to take."],
  ["Progress", "progress", "What's left to master and build, and how to get it."],
  ["Collection", "collection", "What you hold, what to keep and what to sell."],
  ["Trade", "trade", "Your warframe.market listings, the spares plan, prices and sales."],
];
function features() {
  return SECTIONS.map(([name, key, line]) => {
    const pages = PAGES.filter((p) => p.group === name).map((p) => esc(p.label));
    if (!pages.length) throw new Error(`src/lib/pages.ts has no pages in ${name}: has it changed?`);
    return `<div class="feature" style="--c: var(--${key})"><h2 class="register">${name}</h2><p>${esc(line)}</p><p class="pages">${pages.join(" · ")}</p></div>`;
  }).join("");
}

function landing() {
  const tpl = readFileSync(join(SRC, "landing.html"), "utf8");
  // Functions, not strings: a "$" in a release's name or the warning stays as it is.
  return tpl.replace("{{downloads}}", () => downloads("{{base}}")).replace("{{features}}", () => features()).replace("{{fullModeWarning}}", () => esc(warning));
}

// ---- Write it out.
rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, "guide"), { recursive: true });
const write = (file, html) => writeFileSync(join(OUT, file), html);
write("index.html", page({
  file: "index.html", title: "MyOrbiter", logo: true,
  kicker: "Free software · GPL-3.0-only · Linux, the Steam Deck and Windows",
  blurb: "A Warframe companion for your desktop: your relics, sets, mastery and spares, and your warframe.market listings, kept in one place.",
  acts: (base) => `<a class="stamp gold" href="${base}index.html#download">${esc(DL?.front.label ?? "Download")}</a><a class="register" href="${base}whats-new.html">What's new</a>`,
  body: landing,
}));
for (const g of GUIDE) write(g.file, page({ ...g, section: "guide/", kicker: "Guide" }));
write("whats-new.html", page({ file: "whats-new.html", title: "What's new", kicker: "Updates", blurb: "Every update, newest first, as the app's Guide lists them.", body: whatsNew }));
write("downloads.html", page({ file: "downloads.html", title: "Other versions", kicker: "Downloads", blurb: "The newest builds, up to ten, with the files each one carries and its release notes.", body: builds }));

cpSync(join(SRC, "site.css"), join(OUT, "site.css"));
cpSync(join(SRC, "shots"), join(OUT, "shots"), { recursive: true, filter: (f) => !f.endsWith(".md") });
// The app icon's small drawing (npm run icons), as the favicon and the mark in the header.
cpSync(join(ROOT, "src-tauri/icons/icon-small.svg"), join(OUT, "icon.svg"));
cpSync(join(ROOT, "src-tauri/icons/32x32.png"), join(OUT, "icon.png"));
// The wordmark with its gold line (site/wordmark-gold.svg) as the first link in the header.
cpSync(join(SRC, "wordmark-gold.svg"), join(OUT, "wordmark-gold.svg"));
mkdirSync(join(OUT, "game"));
for (const f of icons) cpSync(join(ROOT, "public/game", f), join(OUT, "game", f));
// The fonts the app uses (SIL Open Font License, its text beside them).
mkdirSync(join(OUT, "fonts"));
for (const [pkg, files] of [["archivo-narrow", ["latin-500-normal", "latin-600-normal", "latin-700-normal"]], ["ibm-plex-sans", ["latin-400-normal", "latin-500-normal"]], ["ibm-plex-mono", ["latin-400-normal", "latin-500-normal"]]]) {
  for (const f of files) cpSync(join(ROOT, "node_modules/@fontsource", pkg, "files", `${pkg}-${f}.woff2`), join(OUT, "fonts", `${pkg}-${f}.woff2`));
  cpSync(join(ROOT, "node_modules/@fontsource", pkg, "LICENSE"), join(OUT, "fonts", `${pkg}-LICENSE.txt`));
}

// ---- Checks: every local link, image and stylesheet url() resolves (same-page anchors included),
// external links go only to gitlab.com, and no dev-*.json file (a real account's data) is in the
// output or named in it.
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
    // The pages stay static: nothing in them runs, so nothing reads gitlab.com (or anything) on load.
    if (f.endsWith(".html") && /<(?:script|iframe|object|embed)\b|<meta[^>]+http-equiv|<[a-z][^>]*\son[a-z]+\s*=/i.test(text)) bad.push(`${rel}: carries a script`);
    for (const m of text.matchAll(/(?:href|src)="([^"]+)"|url\(["']?([^"')]+)/g)) {
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
  if (bad.length) { console.error(bad.join("\n")); process.exit(1); }
  console.log(`site/_site: ${files.length} files, every link checked.`);
} else {
  console.log("site/_site written.");
}
