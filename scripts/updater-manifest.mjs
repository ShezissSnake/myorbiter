#!/usr/bin/env node
// The updater manifest (latest.json) for one build, and the checks around it. The release and
// promote jobs in .gitlab-ci.yml run it; tests/updaterManifest.test.ts covers it.
//
//   git log --format=%s A..B | node scripts/updater-manifest.mjs notes      the release notes, on stdout
//   node scripts/updater-manifest.mjs verify --file F --sig F.sig --version 0.2.52 [--config src-tauri/tauri.conf.json]
//   node scripts/updater-manifest.mjs manifest --dir DIR --version 0.2.152 --base URL
//        [--commit SHA] [--notes-file notes.txt] [--config src-tauri/tauri.conf.json] [--out latest.json]
//   node scripts/updater-manifest.mjs check --manifest latest.json --version 0.2.152 --require linux-x86_64,windows-x86_64
//        [--base URL]
//
// Flags without brackets are required: verify and check stop with an error rather than leave out
// the check a missing flag stands for.
//
// URL (--base) is the folder the build's files are downloaded from, ending in its version: the
// build's generic package, https://gitlab.com/api/v4/projects/<project>/packages/generic/myorbiter/0.2.152.
//
// The manifest is what tauri-plugin-updater reads: a version, notes, a date and, for each system,
// the download's address and its signature. Signatures are minisign signatures made by
// `tauri signer sign` (base64 of the .sig text); `verify` checks one against the public key in
// tauri.conf.json, including the version in its trusted comment, exactly as the app will before
// installing. A manifest is only written when every signature in it checks out.
//
// Plain Node (no dependencies), so CI can run it without installing anything.

import { createHash, createPublicKey, verify as edVerify } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** The systems the updater serves, and how their downloads are named by `tauri build`. */
export const PLATFORMS = {
  "linux-x86_64": /_amd64\.AppImage$/,
  "windows-x86_64": /_x64-setup\.exe$/,
};

// ------------------------------------------------------------------ release notes

/** At most this many lines, each at most LINE_MAX characters, and NOTES_MAX in all. */
export const LINES_MAX = 10;
export const LINE_MAX = 120;
export const NOTES_MAX = 1000;

/**
 * The release notes from commit subjects, newest first: "Merge: " prefixes stripped, Git's own merge
 * subjects ("Merge branch …", "Merge pull request …") left out, duplicates dropped, each line and
 * the whole capped. More than fit end in "…and N more".
 */
export function formatNotes(subjects) {
  const seen = new Set();
  const lines = [];
  for (const raw of subjects) {
    // Commit subjects can come from contributors: hidden and bidi characters go, and backticks
    // become quotes so a subject can't close a code block in the job summary.
    let s = String(raw).replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF\u{E0000}-\u{E007F}]/gu, "").replace(/`/g, "'").replace(/\s+/g, " ").trim();
    if (/^Merge (branch|pull request|remote-tracking branch|tag) /.test(s)) continue;
    s = s.replace(/^(Merge:\s*)+/i, "").trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(s.length > LINE_MAX ? `${s.slice(0, LINE_MAX - 1).trimEnd()}…` : s);
  }
  const shown = [];
  let length = 0;
  for (const line of lines) {
    if (shown.length >= LINES_MAX || length + line.length + 1 > NOTES_MAX - 24) break;
    shown.push(line);
    length += line.length + 1;
  }
  const left = lines.length - shown.length;
  if (left > 0) shown.push(`…and ${left} more`);
  return shown.join("\n");
}

// ------------------------------------------------------------------ signatures

const ED25519_SPKI = Buffer.from("302a300506032b6570032100", "hex");

/** The text of a base64-wrapped minisign file (a tauri pubkey or .sig), or the text itself. */
function unwrap(text) {
  const t = String(text).trim();
  if (t.startsWith("untrusted comment:")) return t;
  const decoded = Buffer.from(t, "base64").toString("utf8");
  if (!decoded.startsWith("untrusted comment:")) throw new Error("not a minisign key or signature");
  return decoded;
}

/** A minisign public key: its key id and Ed25519 key. */
export function parsePubkey(text) {
  const lines = unwrap(text).split("\n");
  const bin = Buffer.from((lines[1] ?? "").trim(), "base64");
  if (bin.length !== 42 || bin.subarray(0, 2).toString("latin1") !== "Ed") throw new Error("not an Ed25519 minisign public key");
  return { keyId: bin.subarray(2, 10), key: createPublicKey({ key: Buffer.concat([ED25519_SPKI, bin.subarray(10)]), format: "der", type: "spki" }) };
}

/** A minisign signature: prehashed or not, key id, the signature, the trusted comment and its signature. */
export function parseSignature(text) {
  const lines = unwrap(text).split("\n");
  const bin = Buffer.from((lines[1] ?? "").trim(), "base64");
  const alg = bin.subarray(0, 2).toString("latin1");
  if (bin.length !== 74 || (alg !== "Ed" && alg !== "ED")) throw new Error("not a minisign signature");
  const trusted = (lines[2] ?? "").replace(/^trusted comment: /, "");
  if (!(lines[2] ?? "").startsWith("trusted comment: ")) throw new Error("the signature has no trusted comment");
  const global = Buffer.from((lines[3] ?? "").trim(), "base64");
  if (global.length !== 64) throw new Error("the signature's trusted comment isn't signed");
  return { prehashed: alg === "ED", keyId: bin.subarray(2, 10), sig: bin.subarray(10), trusted, global };
}

/** The `version:` field of a trusted comment (tab-separated key:value pairs), if it has one. */
export function signedVersion(trusted) {
  for (const field of trusted.split("\t")) if (field.startsWith("version:")) return field.slice("version:".length);
  return null;
}

/**
 * Checks `data` against a tauri signature and public key, as the app's updater does: the key ids
 * match, the signature covers the data (BLAKE2b-512 of it when prehashed), the trusted comment is
 * signed, and it names `version`. Throws with the reason; returns the signed version.
 */
export function verifySignature(data, signatureText, pubkeyText, version) {
  const pub = parsePubkey(pubkeyText);
  const sig = parseSignature(signatureText);
  if (!pub.keyId.equals(sig.keyId)) throw new Error(`signed with another key (${hex(sig.keyId)}, the public key is ${hex(pub.keyId)})`);
  const message = sig.prehashed ? createHash("blake2b512").update(data).digest() : data;
  if (!edVerify(null, message, pub.key, sig.sig)) throw new Error("the signature doesn't match the file");
  if (!edVerify(null, Buffer.concat([sig.sig, Buffer.from(sig.trusted, "utf8")]), pub.key, sig.global)) throw new Error("the trusted comment isn't signed by this key");
  const signed = signedVersion(sig.trusted);
  if (signed == null) throw new Error("the signature names no version (sign with --app-version)");
  if (version != null && signed.replace(/^v/, "") !== String(version).replace(/^v/, "")) throw new Error(`signed for ${signed}, not ${version}`);
  return signed;
}

const hex = (b) => Buffer.from(b).toString("hex").toUpperCase();

/** The updater's public key from tauri.conf.json. */
export function pubkeyFromConfig(path) {
  const key = JSON.parse(readFileSync(path, "utf8"))?.plugins?.updater?.pubkey;
  if (typeof key !== "string" || !key.trim()) throw new Error(`no plugins.updater.pubkey in ${path}`);
  return key;
}

// ------------------------------------------------------------------ the manifest

/**
 * Which of `names` (a release's files) is each system's download, and its signature file: the
 * download plus ".sig". A system with no download is left out; one with two, or with a download
 * but no signature, is an error.
 */
export function findAssets(names) {
  const out = {};
  for (const [platform, pattern] of Object.entries(PLATFORMS)) {
    const found = names.filter((n) => pattern.test(n));
    if (found.length > 1) throw new Error(`${platform}: more than one download (${found.join(", ")})`);
    if (!found.length) continue;
    const sig = `${found[0]}.sig`;
    if (!names.includes(sig)) throw new Error(`${platform}: ${found[0]} has no signature (${sig})`);
    out[platform] = { file: found[0], sig };
  }
  return out;
}

/** An RFC 3339 time without milliseconds, as the updater's parser expects. */
export const rfc3339 = (d) => new Date(d).toISOString().replace(/\.\d{3}Z$/, "Z");

/**
 * The folder a build's files are downloaded from, checked: https, no user name, query or fragment,
 * and its last part the build's version (so a manifest can only point at that build's own files).
 * Returned without a trailing slash.
 */
export function checkBase(base, version) {
  let u;
  try {
    u = new URL(base);
  } catch {
    throw new Error(`not a download folder: ${base}`);
  }
  const b = String(base).replace(/\/+$/, "");
  if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash || b.includes("?") || b.includes("#")) throw new Error(`not an https download folder: ${base}`);
  if (version != null && !b.endsWith(`/${version}`)) throw new Error(`${base} isn't the folder of ${version}`);
  return b;
}

/**
 * The manifest for one build, from the downloads in `dir`, each checked against `pubkey` for
 * `version` first. URLs point at the build's own folder (`base`, ending in the version).
 */
export function buildManifest({ dir, version, base, commit = null, notes = "", pubkey, date = new Date() }) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`not a version: ${version}`);
  const folder = checkBase(base, version);
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
 * Checks a manifest before it goes on a channel: its version, each platform's signature present
 * (and well formed, naming the version), and the systems `require`d all there. With `base`, every
 * download must also be that system's file in that folder (the build's own, ending in its
 * version), in the exact form buildManifest writes, and every system one the updater serves.
 * Returns its platforms.
 */
export function checkManifest(manifest, { version = null, require = [], base = null } = {}) {
  if (!manifest || typeof manifest !== "object") throw new Error("not a manifest");
  if (version != null && manifest.version !== version) throw new Error(`the manifest is for ${manifest.version}, not ${version}`);
  const folder = base == null ? null : checkBase(base, version ?? manifest.version);
  const platforms = Object.keys(manifest.platforms ?? {});
  for (const p of require) if (!platforms.includes(p)) throw new Error(`no ${p} build in it`);
  for (const p of platforms) {
    const { signature, url } = manifest.platforms[p];
    if (typeof url !== "string" || !url.startsWith("https://")) throw new Error(`${p}: no https download`);
    if (folder != null) {
      const prefix = `${folder}/`;
      if (!url.startsWith(prefix)) throw new Error(`${p}: ${url} isn't in ${folder}`);
      let name;
      try {
        name = decodeURIComponent(url.slice(prefix.length));
      } catch {
        throw new Error(`${p}: ${url} isn't a file name`);
      }
      if (!Object.hasOwn(PLATFORMS, p)) throw new Error(`${p}: not a system the updater serves`);
      if (!PLATFORMS[p].test(name) || name.includes("/") || url !== prefix + encodeURIComponent(name)) throw new Error(`${p}: ${url} isn't ${p}'s download`);
    }
    if (typeof signature !== "string" || !signature) throw new Error(`${p}: no signature`);
    const signed = signedVersion(parseSignature(signature).trusted);
    if (signed !== manifest.version) throw new Error(`${p}: signed for ${signed}, not ${manifest.version}`);
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
    case "notes": {
      const subjects = readFileSync(0, "utf8").split("\n");
      process.stdout.write(`${formatNotes(subjects)}\n`);
      return;
    }
    case "verify": {
      if (!a.file || !a.sig) throw new Error("verify needs --file and --sig");
      if (!a.version) throw new Error("verify needs --version");
      const signed = verifySignature(readFileSync(a.file), readFileSync(a.sig, "utf8"), a.pubkey ?? pubkeyFromConfig(config), a.version);
      console.log(`${a.file}: signature good, signed for ${signed}`);
      return;
    }
    case "manifest": {
      for (const k of ["dir", "version", "base"]) if (!a[k]) throw new Error(`manifest needs --${k}`);
      const notes = a["notes-file"] ? readFileSync(a["notes-file"], "utf8").trim() : "";
      const manifest = buildManifest({ dir: a.dir, version: a.version, base: a.base, commit: a.commit ?? null, notes, pubkey: a.pubkey ?? pubkeyFromConfig(config) });
      const text = `${JSON.stringify(manifest, null, 2)}\n`;
      if (a.out) writeFileSync(a.out, text);
      else process.stdout.write(text);
      console.error(`latest.json for ${a.version}: ${Object.keys(manifest.platforms).join(", ")}`);
      return;
    }
    case "check": {
      for (const k of ["manifest", "version", "require"]) if (!a[k]) throw new Error(`check needs --${k}`);
      const require = a.require.split(",").filter(Boolean);
      if (!require.length) throw new Error(`check needs --require to name a system, not "${a.require}"`);
      const manifest = JSON.parse(readFileSync(a.manifest, "utf8"));
      console.log(checkManifest(manifest, { version: a.version, require, base: a.base ?? null }).join(","));
      return;
    }
    default:
      throw new Error(`unknown command: ${command ?? "(none)"} (notes, verify, manifest, check)`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(`updater-manifest: ${e.message}`);
    process.exit(1);
  }
}
