import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomBytes, sign as edSign } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildGithubManifest, checkGithubManifest, releaseFolder } from "../scripts/github-manifest.mjs";

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64");

const REPO = "ShezissSnake/myorbiter";
const FOLDER = "https://github.com/ShezissSnake/myorbiter/releases/download/build-120";
const APPIMAGE = "myorbiter_0.2.120_amd64.AppImage";
const SETUP = "myorbiter_0.2.120_x64-setup.exe";

/** A signing key in tauri's format (base64 of minisign's text), signing as `tauri signer sign` does. */
function signer() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(12);
  const keyId = randomBytes(8);
  const pub = b64(`untrusted comment: minisign public key: ${keyId.toString("hex").toUpperCase()}\n${b64(Buffer.concat([Buffer.from("Ed"), keyId, raw]))}\n`);
  const sign = (data: Buffer, version: string, file: string) => {
    const sig = edSign(null, createHash("blake2b512").update(data).digest(), privateKey);
    const trusted = `timestamp:1793750182\tfile:${file}\tversion:${version}`;
    const global = edSign(null, Buffer.concat([sig, Buffer.from(trusted)]), privateKey);
    return b64(`untrusted comment: signature from tauri secret key\n${b64(Buffer.concat([Buffer.from("ED"), keyId, sig]))}\ntrusted comment: ${trusted}\n${b64(global)}\n`);
  };
  return { pub, sign };
}

/** A build's files in a temporary folder, each download with its .sig, plus files that aren't for the updater. */
function release(names: string[], sign: (d: Buffer, v: string, f: string) => string, version: string) {
  const dir = mkdtempSync(join(tmpdir(), "myorbiter-gh-manifest-"));
  for (const name of names) {
    const data = Buffer.from(`${name} bytes`);
    writeFileSync(join(dir, name), data);
    if (/AppImage$|exe$/.test(name)) writeFileSync(join(dir, `${name}.sig`), sign(data, version, name));
  }
  writeFileSync(join(dir, "SHA256SUMS"), "");
  return dir;
}

test("a build's files are on its own release, build-<n> for version 0.2.<n>", () => {
  assert.equal(releaseFolder(REPO, "0.2.120"), FOLDER);
  assert.equal(releaseFolder(REPO, "0.2.7"), "https://github.com/ShezissSnake/myorbiter/releases/download/build-7");
  for (const v of ["0.1.52", "0.2.0", "0.2.012", "1.2.3", "0.2.120-rc", ""]) assert.throws(() => releaseFolder(REPO, v), /not a build version/);
  for (const r of ["ShezissSnake", "ShezissSnake/myorbiter/x", "ShezissSnake/..", "../myorbiter", "-x/myorbiter", "a b/c", "ShezissSnake/my?orbiter", ""]) {
    assert.throws(() => releaseFolder(r, "0.2.120"), /not a GitHub repository/, r);
  }
});

test("the manifest names each system's download on the build's release, signed for its version", () => {
  const k = signer();
  const dir = release([APPIMAGE, SETUP, "myorbiter_0.2.120_amd64.deb"], k.sign, "0.2.120");
  try {
    const m = buildGithubManifest({ dir, version: "0.2.120", repo: REPO, commit: "abc1234", notes: "Faster sync", pubkey: k.pub, date: new Date("2026-11-09T10:20:30.456Z") });
    assert.equal(m.version, "0.2.120");
    assert.equal(m.pub_date, "2026-11-09T10:20:30Z");
    assert.equal(m.commit, "abc1234");
    assert.equal(m.platforms["linux-x86_64"].url, `${FOLDER}/${APPIMAGE}`);
    assert.equal(m.platforms["windows-x86_64"].url, `${FOLDER}/${SETUP}`);
    assert.equal(m.platforms["linux-x86_64"].signature, readFileSync(join(dir, `${APPIMAGE}.sig`), "utf8").trim());
    assert.deepEqual(checkGithubManifest(m, { version: "0.2.120", require: ["linux-x86_64", "windows-x86_64"], repo: REPO }).sort(), ["linux-x86_64", "windows-x86_64"]);
    // Read back as the workflow writes and reads it.
    const again = JSON.parse(JSON.stringify(m));
    assert.deepEqual(checkGithubManifest(again, { require: ["linux-x86_64"], repo: REPO }).sort(), ["linux-x86_64", "windows-x86_64"]);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("no manifest from a download signed for another version or by another key", () => {
  const k = signer();
  const other = signer();
  const older = release([APPIMAGE], k.sign, "0.2.119");
  try {
    assert.throws(() => buildGithubManifest({ dir: older, version: "0.2.120", repo: REPO, pubkey: k.pub }), /signed for 0.2.119, not 0.2.120/);
    assert.throws(() => buildGithubManifest({ dir: older, version: "0.2.120", repo: REPO, pubkey: other.pub }), /another key/);
    assert.throws(() => buildGithubManifest({ dir: older, version: "0.2.120", repo: "x", pubkey: k.pub }), /not a GitHub repository/);
  } finally {
    rmSync(older, { recursive: true });
  }
});

test("a channel's manifest is refused unless every download is that build's own file on its release", () => {
  const k = signer();
  const dir = release([APPIMAGE, SETUP], k.sign, "0.2.120");
  try {
    const good = buildGithubManifest({ dir, version: "0.2.120", repo: REPO, pubkey: k.pub });
    const swap = (platform: string, url: string) => ({ ...good, platforms: { ...good.platforms, [platform]: { ...good.platforms[platform], url } } });
    const opts = { version: "0.2.120", require: ["linux-x86_64", "windows-x86_64"], repo: REPO };
    // Another build's release, another repository, another host, another file.
    assert.throws(() => checkGithubManifest(swap("linux-x86_64", `https://github.com/ShezissSnake/myorbiter/releases/download/build-119/${APPIMAGE}`), opts), /isn't on/);
    assert.throws(() => checkGithubManifest(swap("linux-x86_64", `https://github.com/someone/myorbiter/releases/download/build-120/${APPIMAGE}`), opts), /isn't on/);
    assert.throws(() => checkGithubManifest(swap("linux-x86_64", `https://gitlab.com/x/${APPIMAGE}`), opts), /isn't on/);
    assert.throws(() => checkGithubManifest(swap("linux-x86_64", `${FOLDER}/${SETUP}`), opts), /isn't linux-x86_64's download/);
    assert.throws(() => checkGithubManifest(swap("linux-x86_64", `${FOLDER}/x/${APPIMAGE}`), opts), /isn't linux-x86_64's download/);
    assert.throws(() => checkGithubManifest(swap("linux-x86_64", `${FOLDER}/${APPIMAGE}?x=1`), opts), /isn't linux-x86_64's download/);
    // Another version's file, even on this build's release.
    assert.throws(() => checkGithubManifest(swap("linux-x86_64", `${FOLDER}/myorbiter_0.2.119_amd64.AppImage`), opts), /isn't linux-x86_64's download of 0\.2\.120/);
    assert.throws(() => checkGithubManifest(swap("linux-x86_64", `${FOLDER}/other_0.2.120_amd64.AppImage`), opts), /isn't linux-x86_64's download/);
    assert.throws(() => checkGithubManifest(swap("linux-x86_64", `http://github.com/ShezissSnake/myorbiter/releases/download/build-120/${APPIMAGE}`), opts), /no https download/);
    // The wrong version, a missing system, a system the updater doesn't serve.
    assert.throws(() => checkGithubManifest(good, { ...opts, version: "0.2.121" }), /for 0.2.120, not 0.2.121/);
    const linuxOnly = { ...good, platforms: { "linux-x86_64": good.platforms["linux-x86_64"] } };
    assert.throws(() => checkGithubManifest(linuxOnly, opts), /no windows-x86_64 build/);
    const extra = { ...good, platforms: { ...good.platforms, "darwin-aarch64": good.platforms["linux-x86_64"] } };
    assert.throws(() => checkGithubManifest(extra, opts), /darwin-aarch64: not a system the updater serves/);
  } finally {
    rmSync(dir, { recursive: true });
  }
});
