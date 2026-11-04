#!/usr/bin/env node
// Signs the updater downloads with the project's updater key, as `tauri signer sign --app-version`
// does, in plain Node with no dependencies. release.yml's sign job runs it; that job installs nothing
// and builds nothing, so the key never shares a job with npm, pnpm or Cargo code.
// tests/updaterSign.test.ts covers it against a key and a signature the Tauri CLI made: the
// signatures it writes have the CLI's exact form and check out the way the app's updater checks them.
// (They aren't byte for byte the CLI's: the CLI's Ed25519 signatures carry random noise, so two of
// its own signatures of one file differ too.)
//
//   TAURI_SIGNING_PRIVATE_KEY=… TAURI_SIGNING_PRIVATE_KEY_PASSWORD=… \
//     node scripts/updater-sign.mjs --version 0.1.52 [--config src-tauri/tauri.conf.json] FILE...
//
// The key and its password are read from the environment only (never from the command line, where
// a process list or a log could show them), and nothing about them is printed. For each FILE it
// writes FILE.sig: base64 of a minisign signature, prehashed (BLAKE2b-512), with the trusted comment
// `timestamp:<unix time>\tfile:<file name>\tversion:<version>`, which is what the app's updater
// checks (`requireSignedVersion` in tauri.conf.json).
//
// It refuses to sign unless the key's public half is the public key in tauri.conf.json (the one
// installed copies check with), and checks every signature it writes against that public key with
// scripts/updater-manifest.mjs before writing it.
//
// The secret key format (minisign's, as rsign2 and the Tauri CLI write it, base64-wrapped by Tauri):
//
//   "untrusted comment: …\n" + base64 of:
//     sig_alg "Ed" (2) | kdf_alg "Sc" or 0x0000 (2) | chk_alg "B2" (2) | kdf salt (32)
//     | kdf opslimit (8, LE) | kdf memlimit (8, LE) | key id (8) | secret key (64) | checksum (32)
//
// with the last 104 bytes XORed with scrypt(password, salt) when kdf_alg is "Sc". The secret key is
// Ed25519's 32-byte seed followed by its 32-byte public key. The checksum (BLAKE2b-256, which Node's
// crypto doesn't offer) isn't read: instead the public key derived from the decrypted seed must
// equal the one stored beside it, which a wrong password or a damaged key fails just as surely, and
// then must equal the configured public key.

import { createHash, createPrivateKey, createPublicKey, scryptSync, sign as edSign } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { parsePubkey, pubkeyFromConfig, verifySignature } from "./updater-manifest.mjs";

const ED25519_PKCS8 = Buffer.from("302e020100300506032b657004220420", "hex");
export const UNTRUSTED_COMMENT = "signature from tauri secret key";

/** The text of a base64-wrapped minisign secret key, or the text itself. */
function unwrapSecret(text) {
  const t = String(text).trim();
  if (t.startsWith("untrusted comment:")) return t;
  const decoded = Buffer.from(t, "base64").toString("utf8");
  if (!decoded.startsWith("untrusted comment:")) throw new Error("the signing key isn't a minisign secret key (expected the key's text, not a path)");
  return decoded;
}

/**
 * scrypt's N, r and p for libsodium's crypto_pwhash_scryptsalsa208sha256 limits (its pickparams),
 * which is how minisign keys store them.
 */
export function scryptParams(opslimit, memlimit) {
  let ops = Math.max(Number(opslimit), 32768);
  const mem = Number(memlimit);
  const r = 8;
  let nLog2 = 1;
  let p;
  if (ops < mem / 32) {
    p = 1;
    const maxN = ops / (r * 4);
    for (nLog2 = 1; nLog2 < 63; nLog2++) if (2 ** nLog2 > maxN / 2) break;
  } else {
    const maxN = mem / (r * 128);
    for (nLog2 = 1; nLog2 < 63; nLog2++) if (2 ** nLog2 > maxN / 2) break;
    let maxrp = Math.floor(ops / 4 / 2 ** nLog2);
    if (maxrp > 0x3fffffff) maxrp = 0x3fffffff;
    p = Math.floor(maxrp / r);
  }
  return { N: 2 ** nLog2, r, p };
}

/** The Ed25519 public key (32 bytes) of a 32-byte seed. */
function publicOf(seed) {
  const priv = createPrivateKey({ key: Buffer.concat([ED25519_PKCS8, seed]), format: "der", type: "pkcs8" });
  return createPublicKey(priv).export({ format: "der", type: "spki" }).subarray(12);
}

/**
 * Decrypts a minisign secret key (the Tauri CLI's format) with its password: its key id, the
 * Ed25519 private key and the raw public key. Throws on a wrong password or a damaged key.
 */
export function decodeSecretKey(text, password = "") {
  const lines = unwrapSecret(text).split("\n");
  const bin = Buffer.from((lines[1] ?? "").trim(), "base64");
  if (bin.length !== 158) throw new Error("the signing key isn't a minisign secret key (wrong length)");
  if (bin.subarray(0, 2).toString("latin1") !== "Ed") throw new Error("the signing key isn't an Ed25519 minisign key");
  const kdf = bin.subarray(2, 4).toString("latin1");
  const salt = bin.subarray(6, 38);
  const opslimit = bin.readBigUInt64LE(38);
  const memlimit = bin.readBigUInt64LE(46);
  const keynum = Buffer.from(bin.subarray(54, 158));
  if (kdf === "Sc") {
    const { N, r, p } = scryptParams(opslimit, memlimit);
    if (N > 2 ** 22 || p > 16) throw new Error("the signing key asks for unreasonable scrypt parameters");
    const stream = scryptSync(Buffer.from(password, "utf8"), salt, keynum.length, { N, r, p, maxmem: 256 * N * r * p + 32 * 1024 * 1024 });
    for (let i = 0; i < keynum.length; i++) keynum[i] ^= stream[i];
    stream.fill(0);
  } else if (kdf !== "\0\0") {
    throw new Error("the signing key uses an unknown key derivation");
  }
  const keyId = Buffer.from(keynum.subarray(0, 8));
  const seed = Buffer.from(keynum.subarray(8, 40));
  const stored = Buffer.from(keynum.subarray(40, 72));
  keynum.fill(0);
  const pub = publicOf(seed);
  if (!pub.equals(stored)) {
    seed.fill(0);
    throw new Error("the signing key doesn't decrypt: wrong TAURI_SIGNING_PRIVATE_KEY_PASSWORD, or a damaged key");
  }
  const privateKey = createPrivateKey({ key: Buffer.concat([ED25519_PKCS8, seed]), format: "der", type: "pkcs8" });
  seed.fill(0);
  return { keyId, privateKey, publicKey: pub };
}

/** Throws unless the secret key is the one whose public key is `pubkeyText` (a tauri pubkey). */
export function assertKeyMatches(key, pubkeyText) {
  const pub = parsePubkey(pubkeyText);
  const raw = pub.key.export({ format: "der", type: "spki" }).subarray(12);
  if (!pub.keyId.equals(key.keyId) || !raw.equals(key.publicKey)) {
    throw new Error(`the signing key (${hex(key.keyId)}) isn't the one tauri.conf.json's public key names (${hex(pub.keyId)})`);
  }
}

const hex = (b) => Buffer.from(b).toString("hex").toUpperCase();

/**
 * The signature of `data` (a file called `fileName`) for `version`, in the .sig file's form (base64
 * of minisign's text), as `tauri signer sign --app-version` writes it. `timestamp` is in seconds.
 */
export function signData(data, { fileName, version, key, timestamp = Math.floor(Date.now() / 1000) }) {
  if (!/^\d+\.\d+\.\d+$/.test(String(version))) throw new Error(`not a version: ${version}`);
  if (/[\t\n\r]/.test(fileName)) throw new Error(`not a file name for a signature: ${JSON.stringify(fileName)}`);
  const trusted = `timestamp:${timestamp}\tfile:${fileName}\tversion:${version}`;
  const sig = edSign(null, createHash("blake2b512").update(data).digest(), key.privateKey);
  const global = edSign(null, Buffer.concat([sig, Buffer.from(trusted, "utf8")]), key.privateKey);
  const text = `untrusted comment: ${UNTRUSTED_COMMENT}\n${Buffer.concat([Buffer.from("ED"), key.keyId, sig]).toString("base64")}\ntrusted comment: ${trusted}\n${global.toString("base64")}\n`;
  return Buffer.from(text, "utf8").toString("base64");
}

// ------------------------------------------------------------------ command line

function main(argv) {
  let version = null;
  let config = "src-tauri/tauri.conf.json";
  const files = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--version") version = argv[++i];
    else if (a === "--config") config = argv[++i];
    else if (a.startsWith("--")) throw new Error(`unknown option: ${a}`);
    else files.push(a);
  }
  if (!version || !files.length) throw new Error("usage: updater-sign.mjs --version X.Y.Z [--config tauri.conf.json] FILE...");
  const secret = process.env.TAURI_SIGNING_PRIVATE_KEY;
  if (!secret) throw new Error("TAURI_SIGNING_PRIVATE_KEY isn't set");
  const pubkey = pubkeyFromConfig(config);
  const key = decodeSecretKey(secret, process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? "");
  assertKeyMatches(key, pubkey);
  for (const file of files) {
    const data = readFileSync(file);
    const signature = signData(data, { fileName: basename(file), version, key });
    verifySignature(data, signature, pubkey, version);
    writeFileSync(`${file}.sig`, signature);
    console.log(`${basename(file)}: signed for ${version}, signature checked against ${config}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(`updater-sign: ${e.message}`);
    process.exit(1);
  }
}
