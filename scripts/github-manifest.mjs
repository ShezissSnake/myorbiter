#!/usr/bin/env node
// The updater manifest (latest.json) of a build published on GitHub, and its check. The Release
// workflow (.github/workflows/release.yml) puts every file of build <n> on the repository's release
// build-<n>, so each download's address is
//
//   https://github.com/<owner>/<repo>/releases/download/build-<n>/<file>
//
// where scripts/updater-manifest.mjs's --base wants a folder named after the version (GitLab's
// package registry, myorbiter/0.2.<n>/). Everything else is that script's own, imported from it:
// the signature checks (each download checked against tauri.conf.json's public key, for this
// version, before the manifest is written), the systems and their file names, the date format and
// the manifest's shape. That script kept its own folder rule for the builds GitLab made, whose
// manifests its checks still describe.
//
//   node scripts/github-manifest.mjs manifest --dir DIR --version 0.2.120 --repo OWNER/REPO
//        [--commit SHA] [--notes-file notes.txt] [--config src-tauri/tauri.conf.json] [--out latest.json]
//   node scripts/github-manifest.mjs check --manifest latest.json --version 0.2.120 --repo OWNER/REPO
//        --require linux-x86_64,windows-x86_64
//
// Flags without brackets are required: check stops with an error rather than leave out the check
// a missing flag stands for.
//
// Plain Node (no dependencies), so the workflow runs it with Node alone.

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkManifest, findAssets, PLATFORMS, pubkeyFromConfig, rfc3339, verifySignature } from "./updater-manifest.mjs";

/** A build's version, 0.2.<n>, and its number n. */
const VERSION = /^0\.2\.([1-9][0-9]{0,8})$/;
/** An owner/repository as GitHub allows them, and nothing that could leave the path. */
const REPO = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9_.-]{1,100}$/;

/**
 * The address build <n>'s files are downloaded from: the release build-<n> of `repo` on github.com,
 * for version 0.2.<n>. Throws for anything else, so a manifest can only point at that build's own
 * release.
 */
export function releaseFolder(repo, version) {
  const m = VERSION.exec(String(version));
  if (!m) throw new Error(`not a build version: ${version} (0.2.<n>)`);
  const r = String(repo);
  if (!REPO.test(r) || r.split("/").some((part) => part === "." || part === "..")) throw new Error(`not a GitHub repository: ${repo}`);
  return `https://github.com/${r}/releases/download/build-${m[1]}`;
}

/**
 * The manifest for one build, from the downloads in `dir`, each checked against `pubkey` for
 * `version` first; every address on the build's own release (`releaseFolder`).
 */
export function buildGithubManifest({ dir, version, repo, commit = null, notes = "", pubkey, date = new Date() }) {
  const folder = releaseFolder(repo, version);
  const assets = findAssets(readdirSync(dir));
  if (!Object.keys(assets).length) throw new Error(`no updater downloads in ${dir}`);
  const platforms = {};
  for (const [platform, { file, sig }] of Object.entries(assets)) {
    const signature = readFileSync(join(dir, sig), "utf8").trim();
    try {
      verifySignature(readFileSync(join(dir, file)), signature, pubkey, version);
    } catch (e) {
      throw new Error(`${file}: ${e.message}`);
    }
    platforms[platform] = { signature, url: `${folder}/${encodeURIComponent(file)}` };
  }
  const manifest = { version, notes, pub_date: rfc3339(date), platforms };
  // Not read by the updater: where the next build's notes start from.
  if (commit) manifest.commit = commit;
  return manifest;
}

/**
 * Checks a manifest before it goes on a channel: everything updater-manifest.mjs's checkManifest
 * checks (its version, the systems `require`d, each signature well formed and naming the version),
 * and every download that system's file of that version on the build's own release, in the exact form
 * buildGithubManifest writes. Returns its platforms.
 */
export function checkGithubManifest(manifest, { version = null, require = [], repo } = {}) {
  const platforms = checkManifest(manifest, { version, require });
  const v = version ?? manifest.version;
  const prefix = `${releaseFolder(repo, v)}/`;
  for (const p of platforms) {
    const { url } = manifest.platforms[p];
    if (!Object.hasOwn(PLATFORMS, p)) throw new Error(`${p}: not a system the updater serves`);
    if (!url.startsWith(prefix)) throw new Error(`${p}: ${url} isn't on ${prefix.slice(0, -1)}`);
    let name;
    try {
      name = decodeURIComponent(url.slice(prefix.length));
    } catch {
      throw new Error(`${p}: ${url} isn't a file name`);
    }
    if (!PLATFORMS[p].test(name) || !name.startsWith(`myorbiter_${v}_`) || name.includes("/") || url !== prefix + encodeURIComponent(name)) throw new Error(`${p}: ${url} isn't ${p}'s download of ${v}`);
  }
  return platforms;
}

// ------------------------------------------------------------------ command line

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) throw new Error(`unexpected argument: ${a}`);
    out[a.slice(2)] = argv[i + 1];
    i++;
  }
  return out;
}

function main(argv) {
  const [command, ...rest] = argv;
  const a = args(rest);
  const config = a.config ?? "src-tauri/tauri.conf.json";
  switch (command) {
    case "manifest": {
      for (const k of ["dir", "version", "repo"]) if (!a[k]) throw new Error(`manifest needs --${k}`);
      const notes = a["notes-file"] ? readFileSync(a["notes-file"], "utf8").trim() : "";
      const manifest = buildGithubManifest({ dir: a.dir, version: a.version, repo: a.repo, commit: a.commit ?? null, notes, pubkey: pubkeyFromConfig(config) });
      const text = `${JSON.stringify(manifest, null, 2)}\n`;
      if (a.out) writeFileSync(a.out, text);
      else process.stdout.write(text);
      console.error(`latest.json for ${a.version}: ${Object.keys(manifest.platforms).join(", ")}`);
      return;
    }
    case "check": {
      for (const k of ["manifest", "version", "require", "repo"]) if (!a[k]) throw new Error(`check needs --${k}`);
      const require = a.require.split(",").filter(Boolean);
      if (!require.length) throw new Error(`check needs --require to name a system, not "${a.require}"`);
      const manifest = JSON.parse(readFileSync(a.manifest, "utf8"));
      console.log(checkGithubManifest(manifest, { version: a.version, require, repo: a.repo }).join(","));
      return;
    }
    default:
      throw new Error(`unknown command: ${command ?? "(none)"} (manifest, check)`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(`github-manifest: ${e.message}`);
    process.exit(1);
  }
}
