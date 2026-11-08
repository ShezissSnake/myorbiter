// The sign job (.gitlab-ci.yml) runs the signer only if its files match SIGNER_SHA256, and takes
// them from a clone of its own, never the build volume the runner's jobs share. A change to either
// file has to change the checksums too, or every release would go out unsigned.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

test("SIGNER_SHA256 in .gitlab-ci.yml names the signer as it is", () => {
  const ci = readFileSync(".gitlab-ci.yml", "utf8");
  const pinned = ci.match(/^ {2}SIGNER_SHA256: "([0-9a-f]{64}) ([0-9a-f]{64})"$/m);
  assert.ok(pinned, "no SIGNER_SHA256 in .gitlab-ci.yml");
  const now = [sha256("scripts/updater-sign.mjs"), sha256("scripts/updater-manifest.mjs")];
  assert.deepEqual(
    [pinned[1], pinned[2]],
    now,
    `the signer changed: set SIGNER_SHA256 in .gitlab-ci.yml to "${now.join(" ")}"`,
  );
});

test("the sign job checks the signer and the builder image's digest before signing", () => {
  const ci = readFileSync(".gitlab-ci.yml", "utf8");
  const sign = ci.slice(ci.indexOf("\nsign:\n"), ci.indexOf("\npublish:\n"));
  const clone = sign.indexOf('git -C "$src" -c advice.detachedHead=false checkout -q "$CI_COMMIT_SHA"');
  const copy = sign.indexOf('cp "$src/scripts/updater-sign.mjs" "$src/scripts/updater-manifest.mjs" "$src/src-tauri/tauri.conf.json" "$signer/"');
  const check = sign.indexOf('= "$SIGNER_SHA256"');
  const links = sign.indexOf("find release-files -type l");
  const pin = sign.indexOf("*@sha256:*)");
  const run = sign.indexOf('exec node "$signer/updater-sign.mjs" --config "$signer/tauri.conf.json"');
  assert.ok(clone > 0 && links > 0 && copy > 0 && check > 0 && pin > 0 && run > 0, "the sign job's checks are missing");
  assert.ok(clone < copy && copy < check && check < run && links < run && pin < run, "the sign job runs the signer before checking it");
  assert.doesNotMatch(sign, /node scripts\//, "the sign job runs a script from the build volume");
});

test("the sign job runs no git in the shared build volume", () => {
  const ci = readFileSync(".gitlab-ci.yml", "utf8");
  const sign = ci.slice(ci.indexOf("\nsign:\n"), ci.indexOf("\npublish:\n"));
  assert.match(sign, /^ {4}GIT_STRATEGY: none$/m);
  assert.doesNotMatch(sign, /GIT_DEPTH|GIT_CLONE_PATH/);
  // Its own folders, no config but its own, no hooks.
  assert.match(sign, /src=\$\(mktemp -d\)/);
  assert.match(sign, /GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=\/dev\/null/);
  assert.match(sign, /init -q --template="\$empty"/);
  assert.match(sign, /config core\.hooksPath "\$empty"/);
  for (const line of sign.split("\n").filter((l) => /\bgit /.test(l) && !l.trim().startsWith("#"))) {
    assert.match(line, /git -C "\$src"/, `a git command outside the job's own clone: ${line.trim()}`);
  }
  // Its image has git: the full Node image, by digest.
  assert.match(ci, /^ {2}SIGN_IMAGE: node:[0-9.]+-bookworm@sha256:[0-9a-f]{64}$/m);
  // On the runner the input names, like every job, and only on main and release tags (so on pc,
  // only the protected runner takes it).
  assert.doesNotMatch(sign, /^ {2}tags:/m);
  assert.match(sign, /^ {2}extends: \.publishing$/m);
});

test("a boolean input is never a variable's whole value", () => {
  // GitLab keeps an input's type when it is the whole value, and a variable must be a string.
  const ci = readFileSync(".gitlab-ci.yml", "utf8");
  assert.doesNotMatch(ci, /^\s+[A-Z_]+: "?\$\[\[ inputs\.windows \]\]"?$/m);
});

test("release caches are kept apart from other refs' caches", () => {
  const ci = readFileSync(".gitlab-ci.yml", "utf8");
  const keys = [...ci.matchAll(/- key: (\S+)/g)].map((m) => m[1]);
  assert.ok(keys.length >= 3);
  for (const k of keys) assert.match(k, /-\$CI_COMMIT_REF_PROTECTED$/);
});

test("main and release tags run in the builder image by digest; it is built outside the pipeline", () => {
  const ci = readFileSync(".gitlab-ci.yml", "utf8");
  const rules = ci.slice(ci.indexOf("\nworkflow:\n"), ci.indexOf("\ndefault:\n"));
  // Every rule that sets the digest form checks BUILDER_DIGEST first, and only main or a release
  // tag gets it.
  const byDigest = rules.split("\n    - if: ").filter((r) => r.includes("builder@$BUILDER_DIGEST"));
  assert.ok(byDigest.length >= 3, "no rule runs main in the image by digest");
  for (const r of byDigest) {
    assert.match(r, /\$BUILDER_DIGEST =~ \/\^sha256:\[0-9a-f\]\{64\}\$\//);
    assert.match(r, /\$CI_COMMIT_TAG =~ \/\^release-\//);
    assert.doesNotMatch(r, /BUILDER_SUFFIX/);
  }
  assert.match(ci, /^ {2}BUILDER_DIGEST: "(sha256:[0-9a-f]{64})?"$/m);
  // No job builds or pushes an image: ci/build-image.sh does, on the maintainer's computer, with
  // the BUILDER_TAG this file names.
  assert.doesNotMatch(ci, /kaniko|buildah|docker build|CI_REGISTRY_PASSWORD|\$TASK == "image"/i);
  const script = readFileSync("ci/build-image.sh", "utf8");
  assert.match(script, /BUILDER_TAG: "\\\(\.\*\\\)"\$/);
  assert.match(script, /--password-stdin/);
  assert.match(script, /BUILDER_DIGEST: \\"\$digest\\"/);
});
