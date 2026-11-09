// The website's downloads (scripts/site.mjs): which build the landing page's buttons offer, and the
// last builds downloads.html lists, from what the repository's releases on GitHub say. Pure: the
// caller reads the channels and the releases (once, at build time) and hands the parsed answers in;
// nothing here fetches, and nothing in the pages it feeds runs in the browser.
//
// A channel's latest.json (on the release named after the channel: stable, beta, experimental) is
// the updater manifest of the build installed copies on that channel are offered: checked as the
// Release workflow checks it (scripts/github-manifest.mjs), so the buttons link exactly the files a
// channel ships.
import { checkGithubManifest } from "./github-manifest.mjs";

/** The repository, as owner/name, and its pages on github.com. */
export const SLUG = "ShezissSnake/myorbiter";
export const REPO = `https://github.com/${SLUG}`;
export const HOST = "github.com";
/** The repository's API, which lists its releases. */
export const API = `https://api.github.com/repos/${SLUG}`;
/** The channels, best first: a button offers the best one that has a build. */
export const CHANNELS = [["stable", "Stable"], ["beta", "Beta"], ["experimental", "Experimental"]];
/** Where a channel's manifest is: the latest.json on the release named after the channel. */
export const channelManifest = (channel) => `${REPO}/releases/download/${channel}/latest.json`;
/** How many builds downloads.html lists. */
export const ROWS = 10;
/** The first build made on GitHub since the move back (the Release workflow's BUILD_OFFSET):
 *  older build-<n> releases here are from before the move to GitLab, and downloads.html leaves
 *  them out. */
export const FIRST_BUILD = 120;

const VERSION = /^0\.2\.([1-9][0-9]{0,8})$/;
const TAG = /^build-([1-9][0-9]{0,8})$/;

/** The files a build carries, by what they're for: the front page offers the first three. */
export const FILES = [
  { key: "appimage", label: "AppImage", re: /_amd64\.AppImage$/ },
  { key: "deb", label: ".deb", re: /_amd64\.deb$/ },
  { key: "exe", label: "Windows .exe", re: /_x64-setup\.exe$/ },
];

/** An address if it's https to this repository's own pages on github.com, else null (not escaped). */
export function safeUrl(url) {
  let u;
  try {
    u = new URL(String(url));
  } catch {
    return null;
  }
  const ours = u.protocol === "https:" && u.hostname === HOST && !u.username && !u.password && !u.port && !u.search && !u.hash;
  return ours && u.pathname.startsWith(`/${SLUG}/`) && !u.pathname.includes("/../") ? u.href : null;
}

/** A channel's manifest, checked: its version a build's (0.2.<n>), Linux and Windows both there,
 *  each that build's own file on its build-<n> release and signed for that version. */
export function checkChannel(channel, manifest) {
  const where = `${channel}/latest.json`;
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error(`${where}: not a manifest`);
  if (typeof manifest.version !== "string" || !VERSION.test(manifest.version)) throw new Error(`${where}: names no build version (${JSON.stringify(manifest.version)})`);
  try {
    checkGithubManifest(manifest, { version: manifest.version, require: ["linux-x86_64", "windows-x86_64"], repo: SLUG });
  } catch (e) {
    throw new Error(`${where}: ${e.message}`);
  }
  return manifest;
}

/**
 * What the front page offers: the best channel with a build. `heads` holds each channel's manifest,
 * or null where there's none (a 404: no build on that channel yet). No build on any channel is an
 * error, as is a manifest that doesn't check out: the page never links a wrong file.
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
    if (!windows || !linux) throw new Error(`${key}/latest.json: a download isn't this repository's on ${HOST}`);
    const n = VERSION.exec(m.version)[1];
    return { channel: key, label: `Download ${m.version} · ${name} build`, version: m.version, tag: `build-${n}`, name, buttons: { windows, linux, deck: linux } };
  }
  throw new Error("No channel has a build: the stable, beta and experimental releases have no latest.json (use --offline for a build without them)");
}

/**
 * downloads.html's rows: the newest ROWS builds from FIRST_BUILD on among `releases` (the releases
 * API's answer: each { tag_name, published_at, prerelease, draft, assets: [{ name,
 * browser_download_url }] }), newest first. Each row: version, date (YYYY-MM-DD, UTC), the best
 * channel it's known to have reached, and a link per file it carries (a file the build lacks has no
 * link; a link that isn't that very file on the build's own release stops the build). `heads` are
 * the channels' manifests, checked first (frontButtons). A build promoted to Stable becomes a full
 * release (not a pre-release) for good; otherwise only each channel's current build is known: a
 * build none names has channel null.
 */
export function buildRows(releases, { heads = {} } = {}) {
  if (!Array.isArray(releases)) throw new Error("releases: not a list");
  const builds = [];
  for (const r of releases) {
    const m = TAG.exec(r?.tag_name ?? "");
    if (!m || r.draft) continue;
    const n = Number(m[1]);
    if (n >= FIRST_BUILD) builds.push({ n, r });
  }
  builds.sort((a, b) => b.n - a.n);
  return builds.slice(0, ROWS).map(({ n, r }) => {
    const version = `0.2.${n}`;
    const at = new Date(r.published_at);
    if (Number.isNaN(at.getTime())) throw new Error(`build-${n}: no release date (${JSON.stringify(r.published_at)})`);
    const assets = Array.isArray(r.assets) ? r.assets : [];
    const files = {};
    for (const f of FILES) {
      const hits = assets.filter((a) => typeof a?.name === "string" && f.re.test(a.name));
      if (hits.length > 1) throw new Error(`build-${n}: more than one ${f.label} (${hits.map((h) => h.name).join(", ")})`);
      if (!hits.length) continue;
      if (!hits[0].name.includes(`_${version}_`)) throw new Error(`build-${n}: ${hits[0].name} isn't ${version}'s`);
      files[f.key] = { name: hits[0].name, url: ownFile(n, hits[0]) };
    }
    const sumsAsset = assets.find((a) => a?.name === "SHA256SUMS");
    const sums = sumsAsset ? ownFile(n, sumsAsset) : null;
    const named = (key) => heads?.[key]?.version === version;
    const channel = r.prerelease === false || named("stable") ? "Stable" : named("beta") ? "Beta" : named("experimental") ? "Experimental" : null;
    return {
      version, tag: `build-${n}`, date: at.toISOString().slice(0, 10), channel, files, sums,
      notes: `${REPO}/releases/tag/build-${n}`,
    };
  });
}

/** An asset's address, if it's exactly that file on the build's own release (as the Release
 *  workflow attaches them); anything else stops the build. */
function ownFile(n, asset) {
  const want = `${REPO}/releases/download/build-${n}/${encodeURIComponent(asset.name)}`;
  if (asset.browser_download_url !== want || safeUrl(want) !== want) throw new Error(`build-${n}: ${asset.name} links to ${String(asset.browser_download_url)}, not to ${want}`);
  return want;
}
