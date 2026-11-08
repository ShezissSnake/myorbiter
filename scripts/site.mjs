// Builds MyOrbiter's website (site/ → site/_site/): the landing page, the in-app Guide as pages and
// What's New, as plain HTML and CSS for GitLab Pages. The Guide and What's New come from the app's
// own source (src/lib/tabs/Guide.svelte, src/lib/whatsNew.ts), drawn once with Svelte's server
// renderer through Vite, so the site says what the app says. Nothing here runs in the browser.
//
//   node scripts/site.mjs                       site/_site/, downloads pointing at Releases
//   node scripts/site.mjs --release release.json   the same, with the Stable build's files:
//                                               { tagName, assets: [{ name, url }] } (ci/pages.sh
//                                               makes it from the build-<n> release)
//   node scripts/site.mjs --check               build, then check every link and that no
//                                               dev-*.json (real account data) is in it
//
// Screenshots are of the demo account only (npm run dev:demo; site/README.md, Screenshots).
import { createServer } from "vite";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "site");
const OUT = join(SRC, "_site");
const REPO = "https://gitlab.com/sheziss-group/myorbiter";
/** The only host the site links out to (the repository, its releases and the downloads). */
const HOST = "gitlab.com";
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i < 0 ? null : (args[i + 1] ?? ""); };

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ---- The app's own words, drawn on the server.
const vite = await createServer({ root: ROOT, server: { middlewareMode: true, hmr: false }, appType: "custom", logLevel: "error" });
let guideHtml, news, warning;
try {
  const { render } = await vite.ssrLoadModule("svelte/server");
  const Guide = (await vite.ssrLoadModule("/src/lib/tabs/Guide.svelte")).default;
  ({ NEWS: news } = await vite.ssrLoadModule("/src/lib/whatsNew.ts"));
  ({ FULL_MODE_WARNING: warning } = await vite.ssrLoadModule("/src/lib/FullMode.svelte"));
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

// ---- Pages.
const GUIDE = [
  { file: "guide/index.html", title: "Walkthroughs", blurb: "What to open, in order, for the things players come to MyOrbiter for.", body: () => `<section class="walks">${take("walks")}</section>` },
  { file: "guide/pages.html", title: "Every page", blurb: "Each page, by when you'd use it.", body: () => `<section class="routines">${take("routines")}</section>` },
  { file: "guide/your-game.html", title: "Your game and your data", blurb: "What MyOrbiter reads, what it sends, and what Full mode means for your account.", body: () => `<section class="trust">${take("trust")}</section>` },
  { file: "guide/getting-around.html", title: "Getting around", blurb: "The sidebar, the marks on cards and rows, and where every number comes from.", body: () => `<section class="cols">${take("cols")}</section>` },
];

const NAV = [["index.html", "MyOrbiter"], ["guide/index.html", "Guide"], ["whats-new.html", "What's new"], ["index.html#download", "Download"]];

function page({ file, title, blurb, body, section }) {
  const base = "../".repeat(file.split("/").length - 1);
  const nav = NAV.map(([href, label], i) => `<a href="${base}${href}"${href === file || (section && href.startsWith(section)) ? ' aria-current="page"' : ""}>${i === 0 ? `<img class="wordmark" src="${base}wordmark.svg" height="26" alt="${esc(label)}">` : esc(label)}</a>`).join("");
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
<main>
<div class="head"><h1 class="mark">${esc(title)}</h1><p class="blurb">${esc(blurb)}</p></div>
${sub}
${body().replaceAll("{{base}}", () => base)}
</main>
<footer class="foot">
<p>MyOrbiter is a fan-made tool, not affiliated with or endorsed by Digital Extremes. Warframe and its artwork are © and ™ Digital Extremes Ltd.; the game's icons shown here are theirs, used to identify what they depict, and are not covered by MyOrbiter's licence.</p>
<p>MyOrbiter is free software under the <a href="${REPO}/-/blob/main/LICENSE">GNU General Public License, version 3 only</a>, with no warranty. <a href="${REPO}">Source on GitLab</a> · <a href="${REPO}/-/blob/main/NOTICE.md">Notices</a></p>
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

// Downloads: the Stable build's release (the one channel/stable/latest.json names), when the build
// was given it. GitLab's "latest release" is the newest build of any channel, so without it the
// buttons point at the list of releases.
const PLATFORMS = [
  { key: "linux", label: "Linux and Steam Deck", re: /_amd64\.AppImage$/, note: "AppImage: make it executable and open it." },
  { key: "windows", label: "Windows 10 and 11", re: /_x64-setup\.exe$/, note: "Installs for your user; SmartScreen asks the first time: More info, Run anyway." },
  { key: "macos", label: "macOS (Apple silicon)", re: /_aarch64\.dmg$/, note: "No TennoScope on a Mac, so no inventory: the market, fissures and the world's clocks work." },
];
function downloads() {
  const file = flag("--release");
  let rel = null;
  if (file) rel = JSON.parse(readFileSync(file, "utf8"));
  if (rel && (typeof rel.tagName !== "string" || !/^build-[1-9][0-9]*$/.test(rel.tagName) || !Array.isArray(rel.assets)))
    throw new Error(`${file}: not a release ({ tagName: "build-<n>", assets: [{ name, url }] })`);
  // Each file's address as the release links it, which must be one of this project's on gitlab.com:
  // a download or the checksums with any other address stops the build rather than showing as
  // "not built".
  const assets = (rel?.assets ?? []).filter((x) => typeof x?.name === "string");
  for (const x of assets)
    if ((x.name === "SHA256SUMS" || PLATFORMS.some((p) => p.re.test(x.name))) && !safeUrl(x.url))
      throw new Error(`${file}: ${x.name} links to ${String(x.url)}, not to this project on ${HOST}`);
  // macOS builds are optional, so its button shows only when the release carries a .dmg; Linux and
  // Windows always show (pointing at Releases when the file isn't there).
  const found = PLATFORMS.map((p) => [p, assets.find((x) => p.re.test(x.name))]);
  const rows = found.filter(([p, a]) => a || p.key !== "macos").map(([p, a]) => {
    const href = a ? safeUrl(a.url) : `${REPO}/-/releases`;
    const what = a ? esc(a.name) : rel ? "not built for this release: see Releases" : "on the latest Stable release";
    return `<li class="dl"><a class="stamp" href="${href}">${esc(p.label)}</a><span class="file register">${what}</span><span class="note">${esc(p.note)}</span></li>`;
  }).join("");
  const sumsFile = assets.find((x) => x.name === "SHA256SUMS");
  const sums = sumsFile ? `<a href="${safeUrl(sumsFile.url)}">SHA256SUMS</a>` : "SHA256SUMS";
  const version = rel ? `<p class="register">Stable · ${esc(rel.tagName)}</p>` : `<p class="register">Stable</p>`;
  return `${version}<ul class="dls">${rows}</ul><p class="small">Check a download against ${sums} on the same release (<a href="${REPO}/-/blob/main/README.md#checking-a-download">how</a>). Every release also carries <span class="register">myorbiter-source.tar.gz</span>, its complete source. Other builds (Beta, Experimental) are on <a href="${REPO}/-/releases">Releases</a>.</p>`;
}

/** Where this project's files are on gitlab.com: its package registry (as the release links to
 *  them, the project named by its path) or its own pages. */
const PROJECT_PATHS = ["/api/v4/projects/sheziss-group%2Fmyorbiter/packages/generic/", "/sheziss-group/myorbiter/"];

/** A download's address, escaped for an attribute, if it's https to this project on gitlab.com;
 *  else null. */
function safeUrl(url) {
  let u;
  try {
    u = new URL(String(url));
  } catch {
    return null;
  }
  const ours = u.protocol === "https:" && u.hostname === HOST && !u.username && !u.password && !u.port;
  return ours && PROJECT_PATHS.some((p) => u.pathname.startsWith(p)) && !u.pathname.includes("/../") ? esc(u.href) : null;
}

function landing() {
  const tpl = readFileSync(join(SRC, "landing.html"), "utf8");
  // Functions, not strings: a "$" in a release's name or the warning stays as it is.
  return tpl.replace("{{downloads}}", () => downloads()).replace("{{fullModeWarning}}", () => esc(warning));
}

// ---- Write it out.
rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, "guide"), { recursive: true });
const write = (file, html) => writeFileSync(join(OUT, file), html);
write("index.html", page({ file: "index.html", title: "MyOrbiter", blurb: "A Warframe companion for your desktop: your relics, sets, mastery and spares, and your warframe.market listings, kept in one place.", body: landing }));
for (const g of GUIDE) write(g.file, page({ ...g, section: "guide/" }));
write("whats-new.html", page({ file: "whats-new.html", title: "What's new", blurb: "Every update, newest first, as the app's Guide lists them.", body: whatsNew }));

cpSync(join(SRC, "site.css"), join(OUT, "site.css"));
cpSync(join(SRC, "shots"), join(OUT, "shots"), { recursive: true, filter: (f) => !f.endsWith(".md") });
// The app icon's small drawing (npm run icons), as the favicon and the mark in the header.
cpSync(join(ROOT, "src-tauri/icons/icon-small.svg"), join(OUT, "icon.svg"));
cpSync(join(ROOT, "src-tauri/icons/32x32.png"), join(OUT, "icon.png"));
// The wordmark (src-tauri/icons/wordmark.svg) as the first link in the header.
cpSync(join(ROOT, "src-tauri/icons/wordmark.svg"), join(OUT, "wordmark.svg"));
mkdirSync(join(OUT, "game"));
for (const f of icons) cpSync(join(ROOT, "public/game", f), join(OUT, "game", f));
// The fonts the app uses (SIL Open Font License, its text beside them).
mkdirSync(join(OUT, "fonts"));
for (const [pkg, files] of [["archivo-narrow", ["latin-600-normal", "latin-700-normal"]], ["ibm-plex-sans", ["latin-400-normal", "latin-500-normal"]], ["ibm-plex-mono", ["latin-400-normal", "latin-500-normal"]]]) {
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
