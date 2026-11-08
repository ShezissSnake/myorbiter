// The website's downloads (scripts/site.mjs): which build the landing page's buttons offer, and the
// last builds downloads.html lists, from what the package registry and the releases say. Pure: the
// caller reads the registry (once, at build time) and hands the parsed answers in; nothing here
// fetches, and nothing in the pages it feeds runs in the browser.
//
// A channel's latest.json (channel/<stable|beta|experimental>/latest.json) is the updater manifest of
// the build installed copies on that channel are offered: checked as the updater's own tools check it
// (scripts/updater-manifest.mjs), so the buttons link exactly the files a channel ships.
import { checkManifest } from "./updater-manifest.mjs";

export const REPO = "https://gitlab.com/sheziss-group/myorbiter";
export const HOST = "gitlab.com";
/** The project's API, by its path, as the manifests and the release links name it. */
export const API = "https://gitlab.com/api/v4/projects/sheziss-group%2Fmyorbiter";
export const PACKAGES = `${API}/packages/generic`;
/** The channels, best first: a button offers the best one that has a build. */
export const CHANNELS = [["stable", "Stable"], ["beta", "Beta"], ["experimental", "Experimental"]];
/** How many builds downloads.html lists. */
export const ROWS = 10;

const VERSION = /^0\.2\.([1-9][0-9]{0,8})$/;
const TAG = /^build-([1-9][0-9]{0,8})$/;

/** The files a build carries, by what they're for: the front page offers the first three. */
export const FILES = [
  { key: "appimage", label: "AppImage", re: /_amd64\.AppImage$/ },
  { key: "deb", label: ".deb", re: /_amd64\.deb$/ },
  { key: "exe", label: "Windows .exe", re: /_x64-setup\.exe$/ },
];

/** Where this project's files are on gitlab.com: its package registry (as the release links to
 *  them, the project named by its path) or its own pages. */
const PROJECT_PATHS = ["/api/v4/projects/sheziss-group%2Fmyorbiter/packages/generic/", "/sheziss-group/myorbiter/"];

/** A download's address if it's https to this project on gitlab.com, else null (not escaped). */
export function safeUrl(url) {
  let u;
  try {
    u = new URL(String(url));
  } catch {
    return null;
  }
  const ours = u.protocol === "https:" && u.hostname === HOST && !u.username && !u.password && !u.port && !u.search && !u.hash;
  return ours && PROJECT_PATHS.some((p) => u.pathname.startsWith(p)) && !u.pathname.includes("/../") ? u.href : null;
}

/** A channel's manifest, checked: its version a build's (0.2.<n>), Linux and Windows both there,
 *  each in that build's own folder in the registry and signed for that version. */
export function checkChannel(channel, manifest) {
  const where = `channel/${channel}/latest.json`;
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error(`${where}: not a manifest`);
  if (typeof manifest.version !== "string" || !VERSION.test(manifest.version)) throw new Error(`${where}: names no build version (${JSON.stringify(manifest.version)})`);
  try {
    checkManifest(manifest, { version: manifest.version, require: ["linux-x86_64", "windows-x86_64"], base: `${PACKAGES}/myorbiter/${manifest.version}` });
  } catch (e) {
    throw new Error(`${where}: ${e.message}`);
  }
  return manifest;
}

/**
 * What the front page offers: the best channel with a build. `heads` holds each channel's manifest,
 * or null where the registry has none (a 404: no build on that channel yet). No build on any channel
 * is an error, as is a manifest that doesn't check out: the page never links a wrong file.
 * Returns { channel, label, version, tag, buttons: { windows, linux, deck } } (addresses).
 */
export function frontButtons(heads) {
  // Every channel's manifest is checked, not just the one offered: the rows are labelled from all.
  for (const [key] of CHANNELS) if (heads?.[key] != null) checkChannel(key, heads[key]);
  for (const [key, name] of CHANNELS) {
    const m = heads?.[key];
    if (m == null) continue;
    const windows = safeUrl(m.platforms["windows-x86_64"].url);
    const linux = safeUrl(m.platforms["linux-x86_64"].url);
    if (!windows || !linux) throw new Error(`channel/${key}/latest.json: a download isn't this project's on ${HOST}`);
    const n = VERSION.exec(m.version)[1];
    return { channel: key, label: `Download ${m.version} · ${name} build`, version: m.version, tag: `build-${n}`, name, buttons: { windows, linux, deck: linux } };
  }
  throw new Error("No channel has a build: channel/stable, channel/beta and channel/experimental all missing (use --offline for a build without them)");
}

/**
 * downloads.html's rows: the newest ROWS builds among `releases` (the releases API's answer: each
 * { tag_name, released_at, assets: { links: [{ name, url }] } }), newest first. Each row: version,
 * date (YYYY-MM-DD, UTC), the best channel the registry records it reached, and a link per file it
 * carries (a file the build lacks has no link; a link that isn't that very file in the build's own
 * folder in the registry stops the build). `heads` are the channels' manifests, checked first
 * (frontButtons). The registry records Stable for good (stable-builds/<version>, `stableBuilds`) and each
 * channel's current build (`heads`), nothing else: a build no record names has channel null.
 */
export function buildRows(releases, { heads = {}, stableBuilds = [] } = {}) {
  if (!Array.isArray(releases)) throw new Error("releases: not a list");
  const builds = [];
  for (const r of releases) {
    const m = TAG.exec(r?.tag_name ?? "");
    if (!m) continue;
    builds.push({ n: Number(m[1]), r });
  }
  builds.sort((a, b) => b.n - a.n);
  const ever = new Set(stableBuilds);
  return builds.slice(0, ROWS).map(({ n, r }) => {
    const version = `0.2.${n}`;
    const at = new Date(r.released_at);
    if (Number.isNaN(at.getTime())) throw new Error(`build-${n}: no release date (${JSON.stringify(r.released_at)})`);
    const links = Array.isArray(r.assets?.links) ? r.assets.links : [];
    const files = {};
    for (const f of FILES) {
      const hits = links.filter((l) => typeof l?.name === "string" && f.re.test(l.name));
      if (hits.length > 1) throw new Error(`build-${n}: more than one ${f.label} (${hits.map((h) => h.name).join(", ")})`);
      if (!hits.length) continue;
      if (!hits[0].name.includes(`_${version}_`)) throw new Error(`build-${n}: ${hits[0].name} isn't ${version}'s`);
      files[f.key] = { name: hits[0].name, url: ownFile(n, version, hits[0]) };
    }
    const sumsLink = links.find((l) => l?.name === "SHA256SUMS");
    const sums = sumsLink ? ownFile(n, version, sumsLink) : null;
    const named = (key) => heads?.[key]?.version === version;
    const channel = ever.has(version) || named("stable") ? "Stable" : named("beta") ? "Beta" : named("experimental") ? "Experimental" : null;
    return {
      version, tag: `build-${n}`, date: at.toISOString().slice(0, 10), channel, files, sums,
      notes: `${REPO}/-/releases/build-${n}`,
    };
  });
}

/** A release link's address, if it's exactly that file in the build's own registry folder (as
 *  ci/publish.sh links them); anything else stops the build. */
function ownFile(n, version, link) {
  const want = `${PACKAGES}/myorbiter/${version}/${encodeURIComponent(link.name)}`;
  if (link.url !== want || safeUrl(want) !== want) throw new Error(`build-${n}: ${link.name} links to ${String(link.url)}, not to ${want}`);
  return want;
}

/** The versions stable-builds/ holds (the packages API's answer for package_name=stable-builds). */
export function stableVersions(packages) {
  if (!Array.isArray(packages)) throw new Error("stable-builds: not a list");
  return packages.filter((p) => p?.name === "stable-builds" && VERSION.test(p?.version ?? "")).map((p) => p.version);
}
