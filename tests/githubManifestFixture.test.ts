// The GitHub manifest kept as a fixture (tests/fixtures/updater/github-0.2.120.json): what
// scripts/github-manifest.mjs writes today for fixed inputs. The Rust tests pass its addresses
// through the app's own rule (`download_allowed`, src-tauri/src/updates.rs), so the address the
// release script writes and the address installed copies accept are held to the same text.
//
// Made again, after a deliberate change to what the script writes:
//   MYORBITER_WRITE_FIXTURE=1 npx tsx --test tests/githubManifestFixture.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, createPrivateKey, createPublicKey, sign as edSign } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildGithubManifest } from "../scripts/github-manifest.mjs";

const FIXTURE = "tests/fixtures/updater/github-0.2.120.json";
const VERSION = "0.2.120";
const REPO = "ShezissSnake/myorbiter";

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64");

/**
 * A made-up signing key in tauri's format, the same on every run (a fixed seed; Ed25519 signs the
 * same bytes the same way), so the signatures, and with them the manifest, never change.
 */
function fixedSigner() {
  const seed = Buffer.alloc(32, 0x5a);
  const privateKey = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]), format: "der", type: "pkcs8" });
  const raw = createPublicKey(privateKey).export({ format: "der", type: "spki" }).subarray(12);
  const keyId = Buffer.from("0000000000000054", "hex");
  const pub = b64(`untrusted comment: minisign public key: ${keyId.toString("hex").toUpperCase()}\n${b64(Buffer.concat([Buffer.from("Ed"), keyId, raw]))}\n`);
  const sign = (data: Buffer, file: string) => {
    const sig = edSign(null, createHash("blake2b512").update(data).digest(), privateKey);
    const trusted = `timestamp:1794560400\tfile:${file}\tversion:${VERSION}`;
    const global = edSign(null, Buffer.concat([sig, Buffer.from(trusted)]), privateKey);
    return b64(`untrusted comment: signature from tauri secret key\n${b64(Buffer.concat([Buffer.from("ED"), keyId, sig]))}\ntrusted comment: ${trusted}\n${b64(global)}\n`);
  };
  return { pub, sign };
}

/** The manifest's text as the script's `manifest` command writes it, for the fixed inputs. */
function manifestText() {
  const k = fixedSigner();
  const dir = mkdtempSync(join(tmpdir(), "myorbiter-gh-fixture-"));
  try {
    for (const name of [`myorbiter_${VERSION}_amd64.AppImage`, `myorbiter_${VERSION}_x64-setup.exe`]) {
      const data = Buffer.from(`${name}: made-up bytes for a test`);
      writeFileSync(join(dir, name), data);
      writeFileSync(join(dir, `${name}.sig`), k.sign(data, name));
    }
    const manifest = buildGithubManifest({
      dir,
      version: VERSION,
      repo: REPO,
      commit: "0000000000000000000000000000000000000054",
      notes: "Made-up notes for a test",
      pubkey: k.pub,
      date: new Date("2026-11-13T12:00:00Z"),
    });
    return `${JSON.stringify(manifest, null, 2)}\n`;
  } finally {
    rmSync(dir, { recursive: true });
  }
}

test("the GitHub manifest fixture is what the release script writes today", () => {
  const text = manifestText();
  if (process.env.MYORBITER_WRITE_FIXTURE === "1") writeFileSync(FIXTURE, text);
  assert.equal(text, readFileSync(FIXTURE, "utf8"), `${FIXTURE} differs from what scripts/github-manifest.mjs writes: if that change is meant, make the fixture again (this file's opening lines) and let the Rust tests judge it`);
  // Both systems, each on the build's own release.
  const m = JSON.parse(text);
  assert.deepEqual(Object.keys(m.platforms).sort(), ["linux-x86_64", "windows-x86_64"]);
  for (const { url } of Object.values(m.platforms) as { url: string }[]) assert.ok(url.startsWith(`https://github.com/${REPO}/releases/download/build-120/`), url);
});
