import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { assertKeyMatches, decodeSecretKey, scryptParams, signData } from "../scripts/updater-sign.mjs";
import { parsePubkey, parseSignature, verifySignature } from "../scripts/updater-manifest.mjs";

// A throwaway key pair made with `tauri signer generate -p orbiter-test-only` for these tests only:
// nothing trusts it (the app's key is the one in src-tauri/tauri.conf.json, which a Rust test pins),
// and test-only-signed.bin.sig is the Tauri CLI's own signature with it (`tauri signer sign
// --app-version 0.1.52`).
const dir = "tests/fixtures/updater";
const SECRET = readFileSync(join(dir, "test-only.key"), "utf8");
const PUB = readFileSync(join(dir, "test-only.key.pub"), "utf8");
const PASSWORD = "orbiter-test-only";
const DATA = readFileSync(join(dir, "test-only-signed.bin"));
const TAURI_SIG = readFileSync(join(dir, "test-only-signed.bin.sig"), "utf8").trim();
const OTHER_PUB = readFileSync(join(dir, "tauri-signed.pub"), "utf8");

const text = (sig: string) => Buffer.from(sig, "base64").toString("utf8");

test("scrypt parameters follow libsodium's, as minisign keys store them", () => {
  // rsign2's defaults, what the Tauri CLI writes.
  assert.deepEqual(scryptParams(1048576n, 33554432n), { N: 32768, r: 8, p: 1 });
  // minisign's sensitive limits.
  assert.deepEqual(scryptParams(33554432n, 1073741824n), { N: 1048576, r: 8, p: 1 });
});

test("a key the Tauri CLI made decrypts with its password, and only with it", () => {
  const key = decodeSecretKey(SECRET, PASSWORD);
  assert.deepEqual(key.keyId, parsePubkey(PUB).keyId);
  assertKeyMatches(key, PUB);
  assert.throws(() => assertKeyMatches(key, OTHER_PUB), /isn't the one tauri.conf.json's public key names/);
  assert.throws(() => decodeSecretKey(SECRET, "wrong"), /wrong TAURI_SIGNING_PRIVATE_KEY_PASSWORD/);
  assert.throws(() => decodeSecretKey(SECRET, ""), /wrong TAURI_SIGNING_PRIVATE_KEY_PASSWORD/);
  assert.throws(() => decodeSecretKey("not a key", PASSWORD), /isn't a minisign secret key/);
  assert.throws(() => decodeSecretKey("src-tauri/orbiter.key", PASSWORD), /isn't a minisign secret key/);
});

test("a signature made here checks out as the updater checks it, and has the Tauri CLI's form", () => {
  const key = decodeSecretKey(SECRET, PASSWORD);
  const tauriTime = /timestamp:(\d+)/.exec(text(TAURI_SIG))![1];
  const ours = signData(DATA, { fileName: "test-only-signed.bin", version: "0.1.52", key, timestamp: Number(tauriTime) });
  assert.equal(verifySignature(DATA, ours, PUB, "0.1.52"), "0.1.52");
  assert.equal(verifySignature(DATA, TAURI_SIG, PUB, "0.1.52"), "0.1.52");
  // The Tauri CLI's Ed25519 signatures are hedged (random noise per signature), so the two differ
  // only in the two signature values: same comments, same algorithm and key id, same layout.
  const a = parseSignature(ours);
  const b = parseSignature(TAURI_SIG);
  assert.equal(a.prehashed, true);
  assert.equal(b.prehashed, true);
  assert.deepEqual(a.keyId, b.keyId);
  assert.equal(a.trusted, b.trusted);
  const blank = (s: string) => {
    const lines = text(s).split("\n");
    const head = Buffer.from(lines[1], "base64");
    lines[1] = Buffer.concat([head.subarray(0, 10), Buffer.alloc(64)]).toString("base64");
    lines[3] = Buffer.alloc(64).toString("base64");
    return lines.join("\n");
  };
  assert.equal(blank(ours), blank(TAURI_SIG));
  assert.equal(ours.length, TAURI_SIG.length);
});

test("a signature binds the version and the bytes", () => {
  const key = decodeSecretKey(SECRET, PASSWORD);
  const sig = signData(DATA, { fileName: "f.AppImage", version: "0.1.9", key });
  assert.throws(() => verifySignature(DATA, sig, PUB, "0.1.10"), /signed for 0.1.9, not 0.1.10/);
  const changed = Buffer.from(DATA);
  changed[3] ^= 1;
  assert.throws(() => verifySignature(changed, sig, PUB, "0.1.9"), /doesn't match/);
  assert.throws(() => signData(DATA, { fileName: "f", version: "latest", key }), /not a version/);
  assert.throws(() => signData(DATA, { fileName: "a\tversion:9.9.9", version: "0.1.9", key }), /not a file name/);
});

test("the command signs with the key from the environment, checked against the config's public key", () => {
  const work = mkdtempSync(join(tmpdir(), "myorbiter-sign-"));
  try {
    const file = join(work, "myorbiter_0.1.52_amd64.AppImage");
    writeFileSync(file, DATA);
    // A config carrying the test key's public key, as tauri.conf.json carries the release key's.
    const config = join(work, "tauri.conf.json");
    writeFileSync(config, JSON.stringify({ plugins: { updater: { pubkey: PUB.trim() } } }));
    const run = (env: Record<string, string>, cfg = config) =>
      spawnSync(process.execPath, ["scripts/updater-sign.mjs", "--version", "0.1.52", "--config", cfg, file], {
        env: { PATH: process.env.PATH ?? "", ...env },
        encoding: "utf8",
      });
    const ok = run({ TAURI_SIGNING_PRIVATE_KEY: SECRET.trim(), TAURI_SIGNING_PRIVATE_KEY_PASSWORD: PASSWORD });
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(verifySignature(DATA, readFileSync(`${file}.sig`, "utf8"), PUB, "0.1.52"), "0.1.52");
    assert.match(text(readFileSync(`${file}.sig`, "utf8")), /\tfile:myorbiter_0\.1\.52_amd64\.AppImage\tversion:0\.1\.52\n/);
    // Nothing of the key or its password is printed, whatever happens.
    for (const r of [ok, run({ TAURI_SIGNING_PRIVATE_KEY: SECRET.trim(), TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "wrong" })]) {
      assert.ok(!(r.stdout + r.stderr).includes(PASSWORD));
      assert.ok(!(r.stdout + r.stderr).includes(SECRET.trim().slice(0, 40)));
    }
    rmSync(`${file}.sig`);
    const wrong = run({ TAURI_SIGNING_PRIVATE_KEY: SECRET.trim(), TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "wrong" });
    assert.notEqual(wrong.status, 0);
    assert.match(wrong.stderr, /wrong TAURI_SIGNING_PRIVATE_KEY_PASSWORD/);
    const none = run({});
    assert.notEqual(none.status, 0);
    assert.match(none.stderr, /TAURI_SIGNING_PRIVATE_KEY isn't set/);
    // A key that isn't the configured one signs nothing.
    const other = join(work, "other.conf.json");
    writeFileSync(other, JSON.stringify({ plugins: { updater: { pubkey: OTHER_PUB.trim() } } }));
    const mismatch = run({ TAURI_SIGNING_PRIVATE_KEY: SECRET.trim(), TAURI_SIGNING_PRIVATE_KEY_PASSWORD: PASSWORD }, other);
    assert.notEqual(mismatch.status, 0);
    assert.match(mismatch.stderr, /isn't the one tauri.conf.json's public key names/);
    assert.throws(() => readFileSync(`${file}.sig`));
  } finally {
    rmSync(work, { recursive: true });
  }
});
