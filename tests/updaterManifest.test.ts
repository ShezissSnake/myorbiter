import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomBytes, sign as edSign } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildManifest, checkBase, checkManifest, findAssets, formatNotes, LINE_MAX, LINES_MAX, rfc3339, verifySignature } from "../scripts/updater-manifest.mjs";

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64");

/** Where the builds' files are downloaded from: one generic package version per build. */
const PACKAGES = "https://gitlab.com/api/v4/projects/sheziss-group%2Fmyorbiter/packages/generic/orbiter";

/** A signing key in tauri's format (base64 of minisign's text), signing as `tauri signer sign` does. */
function signer() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(12);
  const keyId = randomBytes(8);
  const pub = b64(`untrusted comment: minisign public key: ${keyId.toString("hex").toUpperCase()}\n${b64(Buffer.concat([Buffer.from("Ed"), keyId, raw]))}\n`);
  const sign = (data: Buffer, version: string | null, file = "payload") => {
    const sig = edSign(null, createHash("blake2b512").update(data).digest(), privateKey);
    const trusted = `timestamp:1793750182\tfile:${file}${version ? `\tversion:${version}` : ""}`;
    const global = edSign(null, Buffer.concat([sig, Buffer.from(trusted)]), privateKey);
    return b64(`untrusted comment: signature from tauri secret key\n${b64(Buffer.concat([Buffer.from("ED"), keyId, sig]))}\ntrusted comment: ${trusted}\n${b64(global)}\n`);
  };
  return { pub, sign };
}

/** A release's files in a temporary folder: each download with its .sig, plus the files that aren't for the updater. */
function release(files: Record<string, Buffer>, sign: (d: Buffer, v: string | null, f: string) => string, version: string | null) {
  const dir = mkdtempSync(join(tmpdir(), "myorbiter-manifest-"));
  for (const [name, data] of Object.entries(files)) {
    writeFileSync(join(dir, name), data);
    if (!/SHA256SUMS|source/.test(name)) writeFileSync(join(dir, `${name}.sig`), sign(data, version, name));
  }
  return dir;
}

const APPIMAGE = "myorbiter_0.1.52_amd64.AppImage";
const SETUP = "myorbiter_0.1.52_x64-setup.exe";

test("a signature made by tauri's signer checks out, and a changed byte doesn't", () => {
  const dir = "tests/fixtures/updater";
  const data = readFileSync(join(dir, "tauri-signed.bin"));
  const sig = readFileSync(join(dir, "tauri-signed.bin.sig"), "utf8");
  const pub = readFileSync(join(dir, "tauri-signed.pub"), "utf8");
  assert.equal(verifySignature(data, sig, pub, "0.1.7"), "0.1.7");
  assert.throws(() => verifySignature(data, sig, pub, "0.1.8"), /signed for 0.1.7, not 0.1.8/);
  const tampered = Buffer.from(data);
  tampered[0] ^= 1;
  assert.throws(() => verifySignature(tampered, sig, pub, "0.1.7"), /doesn't match/);
});

test("signatures: another key, an unsigned version and a forged trusted comment are refused", () => {
  const a = signer();
  const b = signer();
  const data = Buffer.from("orbiter");
  assert.equal(verifySignature(data, a.sign(data, "0.1.3"), a.pub, "0.1.3"), "0.1.3");
  assert.throws(() => verifySignature(data, b.sign(data, "0.1.3"), a.pub, "0.1.3"), /another key/);
  assert.throws(() => verifySignature(data, a.sign(data, null), a.pub, "0.1.3"), /names no version/);
  // The version in the trusted comment rewritten after signing.
  const text = Buffer.from(a.sign(data, "0.1.3"), "base64").toString("utf8").replace("version:0.1.3", "version:0.1.9");
  assert.throws(() => verifySignature(data, b64(text), a.pub, "0.1.9"), /trusted comment isn't signed/);
});

test("the manifest lists each system's download with its signature, in the build's own folder", () => {
  const k = signer();
  const dir = release({ [APPIMAGE]: Buffer.from("\x7fELF linux"), [SETUP]: Buffer.from("MZ windows"), SHA256SUMS: Buffer.from("sums"), "myorbiter-source.tar.gz": Buffer.from("src") }, k.sign, "0.1.52");
  try {
    const m = buildManifest({ dir, version: "0.1.52", base: `${PACKAGES}/0.1.52`, commit: "abc1234", notes: "Faster sync", pubkey: k.pub, date: new Date("2026-11-04T10:20:30.456Z") });
    assert.equal(m.version, "0.1.52");
    assert.equal(m.notes, "Faster sync");
    assert.equal(m.pub_date, "2026-11-04T10:20:30Z");
    assert.equal(m.commit, "abc1234");
    assert.deepEqual(Object.keys(m.platforms).sort(), ["linux-x86_64", "windows-x86_64"]);
    assert.equal(m.platforms["linux-x86_64"].url, `${PACKAGES}/0.1.52/${APPIMAGE}`);
    assert.equal(m.platforms["windows-x86_64"].url, `${PACKAGES}/0.1.52/${SETUP}`);
    assert.equal(m.platforms["linux-x86_64"].signature, readFileSync(join(dir, `${APPIMAGE}.sig`), "utf8").trim());
    assert.deepEqual(checkManifest(m, { version: "0.1.52", require: ["linux-x86_64", "windows-x86_64"] }).sort(), ["linux-x86_64", "windows-x86_64"]);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("a system that wasn't built is left out, and promotion can require it", () => {
  const k = signer();
  const dir = release({ [APPIMAGE]: Buffer.from("\x7fELF linux") }, k.sign, "0.1.52");
  try {
    const m = buildManifest({ dir, version: "0.1.52", base: `${PACKAGES}/0.1.52`, pubkey: k.pub });
    assert.deepEqual(Object.keys(m.platforms), ["linux-x86_64"]);
    assert.equal(m.commit, undefined);
    assert.throws(() => checkManifest(m, { require: ["linux-x86_64", "windows-x86_64"] }), /no windows-x86_64 build/);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("no manifest from a tampered download, a signature for another version, or another key", () => {
  const k = signer();
  const other = signer();
  const opts = { version: "0.1.52", base: `${PACKAGES}/0.1.52` };
  const tampered = release({ [APPIMAGE]: Buffer.from("\x7fELF linux") }, k.sign, "0.1.52");
  const older = release({ [APPIMAGE]: Buffer.from("\x7fELF linux") }, k.sign, "0.1.51");
  try {
    writeFileSync(join(tampered, APPIMAGE), "\x7fELF linuX");
    assert.throws(() => buildManifest({ ...opts, dir: tampered, pubkey: k.pub }), /AppImage: the signature doesn't match/);
    assert.throws(() => buildManifest({ ...opts, dir: older, pubkey: k.pub }), /signed for 0.1.51, not 0.1.52/);
    assert.throws(() => buildManifest({ ...opts, dir: older, pubkey: other.pub }), /another key/);
    assert.throws(() => buildManifest({ ...opts, dir: older, pubkey: k.pub, version: "0.1" }), /not a version/);
    // Another build's folder, or one that isn't a plain https folder.
    assert.throws(() => buildManifest({ ...opts, dir: older, pubkey: k.pub, base: `${PACKAGES}/0.1.51` }), /isn't the folder of 0.1.52/);
    assert.throws(() => buildManifest({ ...opts, dir: older, pubkey: k.pub, base: `http://gitlab.com/x/0.1.52` }), /not an https download folder/);
  } finally {
    rmSync(tampered, { recursive: true });
    rmSync(older, { recursive: true });
  }
});

test("downloads are found by name, each with its signature", () => {
  assert.deepEqual(findAssets([APPIMAGE, `${APPIMAGE}.sig`, "SHA256SUMS", "myorbiter_0.1.52_aarch64.dmg"]), { "linux-x86_64": { file: APPIMAGE, sig: `${APPIMAGE}.sig` } });
  assert.throws(() => findAssets([APPIMAGE]), /has no signature/);
  assert.throws(() => findAssets([APPIMAGE, `${APPIMAGE}.sig`, "myorbiter_0.1.53_amd64.AppImage", "myorbiter_0.1.53_amd64.AppImage.sig"]), /more than one/);
  assert.deepEqual(findAssets(["myorbiter-source.tar.gz"]), {});
});

test("checking a manifest: its version, https downloads and signatures for that version", () => {
  const k = signer();
  const sig = k.sign(Buffer.from("x"), "0.1.40");
  const m = { version: "0.1.40", notes: "", pub_date: rfc3339(0), platforms: { "linux-x86_64": { url: "https://example.com/x/0.1.40/a.AppImage", signature: sig } } };
  assert.deepEqual(checkManifest(m, { version: "0.1.40" }), ["linux-x86_64"]);
  assert.throws(() => checkManifest(m, { version: "0.1.41" }), /for 0.1.40, not 0.1.41/);
  assert.throws(() => checkManifest({ ...m, version: "0.1.41" }), /signed for 0.1.40, not 0.1.41/);
  assert.throws(() => checkManifest({ ...m, platforms: { "linux-x86_64": { url: "http://x", signature: sig } } }), /no https/);
  assert.throws(() => checkManifest({ ...m, platforms: { "linux-x86_64": { url: "https://x", signature: "" } } }), /no signature/);
  assert.throws(() => checkManifest(null), /not a manifest/);
});

test("promotion checks every download is the build's own file in its own folder", () => {
  const k = signer();
  const sig = k.sign(Buffer.from("x"), "0.1.52");
  const at = (url: string, platform = "linux-x86_64") => ({ version: "0.1.52", notes: "", pub_date: rfc3339(0), platforms: { [platform]: { url, signature: sig } } });
  const where = { version: "0.1.52", base: `${PACKAGES}/0.1.52` };
  const base = `${PACKAGES}/0.1.52/`;
  assert.deepEqual(checkManifest(at(base + APPIMAGE), where), ["linux-x86_64"]);
  assert.deepEqual(checkManifest(at(base + SETUP, "windows-x86_64"), where), ["windows-x86_64"]);
  // A trailing slash on the folder is the same folder.
  assert.deepEqual(checkManifest(at(base + APPIMAGE), { ...where, base }), ["linux-x86_64"]);
  // Another project, another build, a channel's folder, another host, another system's file.
  assert.throws(() => checkManifest(at(`https://gitlab.com/api/v4/projects/someone%2Forbiter/packages/generic/orbiter/0.1.52/${APPIMAGE}`), where), /isn't in https:\/\/gitlab.com\/api\/v4\/projects\/sheziss-group%2Fmyorbiter\/packages\/generic\/orbiter\/0.1.52/);
  assert.throws(() => checkManifest(at(`${PACKAGES}/0.1.51/${APPIMAGE}`), where), /isn't in/);
  assert.throws(() => checkManifest(at(`https://gitlab.com/api/v4/projects/sheziss-group%2Fmyorbiter/packages/generic/channel/stable/${APPIMAGE}`), where), /isn't in/);
  assert.throws(() => checkManifest(at(`https://example.com/api/v4/projects/sheziss-group%2Fmyorbiter/packages/generic/orbiter/0.1.52/${APPIMAGE}`), where), /isn't in/);
  assert.throws(() => checkManifest(at(base + SETUP), where), /isn't linux-x86_64's download/);
  // Paths out of the folder, encoded or not, and a query on the end.
  assert.throws(() => checkManifest(at(`${base}..%2F..%2F0.1.1%2F${APPIMAGE}`), where), /isn't linux-x86_64's download/);
  assert.throws(() => checkManifest(at(`${base}x/${APPIMAGE}`), where), /isn't linux-x86_64's download/);
  assert.throws(() => checkManifest(at(`${base}${APPIMAGE}?x=1`), where), /isn't linux-x86_64's download/);
  assert.throws(() => checkManifest(at(`${base}%E0%A4%A`), where), /isn't a file name/);
  // A system the updater doesn't serve.
  assert.throws(() => checkManifest(at(base + APPIMAGE, "darwin-aarch64"), where), /not a system the updater serves/);
  // A folder that isn't this version's, or isn't a plain https folder.
  assert.throws(() => checkManifest(at(base + APPIMAGE), { ...where, base: `${PACKAGES}/0.1.5` }), /isn't the folder of 0.1.52/);
  assert.throws(() => checkManifest(at(base + APPIMAGE), { ...where, base: `${base}?x=/0.1.52` }), /not an https download folder/);
  assert.throws(() => checkManifest(at(base + APPIMAGE), { ...where, base: "not a url" }), /not a download folder/);
});

test("a download folder is https, plain, and ends in its build's version", () => {
  assert.equal(checkBase(`${PACKAGES}/0.2.152/`, "0.2.152"), `${PACKAGES}/0.2.152`);
  assert.equal(checkBase(`${PACKAGES}/0.2.152`, null), `${PACKAGES}/0.2.152`);
  assert.throws(() => checkBase(`${PACKAGES}/0.2.1520`, "0.2.152"), /isn't the folder of 0.2.152/);
  assert.throws(() => checkBase(`${PACKAGES}/10.2.152x`, "0.2.152"), /isn't the folder/);
  assert.throws(() => checkBase(`https://user:pw@gitlab.com/0.2.152`, "0.2.152"), /not an https download folder/);
  assert.throws(() => checkBase(`https://gitlab.com/0.2.152#x`, "0.2.152"), /not an https download folder/);
  assert.throws(() => checkBase(`file:///tmp/0.2.152`, "0.2.152"), /not an https download folder/);
});

test("release notes: Merge prefixes stripped, Git's merge lines dropped, duplicates once, capped", () => {
  assert.equal(
    formatNotes(["Merge: Sync answers on its frame", "Merge branch 'main' of gitlab.com:x/y", "Merge branch 'work/ci-gitlab' into 'main'", "Merge pull request #4 from a/b", "Sync answers on its frame", "  Fissures   read faster ", "", "sync answers on its frame"]),
    "Sync answers on its frame\nFissures read faster",
  );
  assert.equal(formatNotes([]), "");
  const long = "x".repeat(LINE_MAX + 40);
  const [line] = formatNotes([long]).split("\n");
  assert.equal(line.length, LINE_MAX);
  assert.ok(line.endsWith("…"));
  const many = Array.from({ length: LINES_MAX + 5 }, (_, i) => `Change ${i}`);
  const lines = formatNotes(many).split("\n");
  assert.equal(lines.length, LINES_MAX + 1);
  assert.equal(lines.at(-1), "…and 5 more");
  const wide = Array.from({ length: 30 }, (_, i) => `${i} ${"y".repeat(LINE_MAX)}`);
  assert.ok(formatNotes(wide).length <= 1000);
});
