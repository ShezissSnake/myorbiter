// The sign job (.gitlab-ci.yml) runs the signer only if its files match SIGNER_SHA256, since the
// build's files are unpacked over its checkout. A change to either file has to change the
// checksums too, or every release would go out unsigned.
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
  const check = sign.indexOf('= "$SIGNER_SHA256"');
  const pin = sign.indexOf("*@sha256:*)");
  const run = sign.indexOf("node scripts/updater-sign.mjs");
  assert.ok(check > 0 && pin > 0 && run > 0, "the sign job's checks are missing");
  assert.ok(check < run && pin < run, "the sign job runs the signer before checking it");
  assert.match(sign, /GIT_STRATEGY: clone/);
});

test("main and release tags run in the builder image by digest; the image task pushes a tag", () => {
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
  const image = ci.slice(ci.indexOf("\nbuilder-image:\n"));
  assert.match(image, /--tag "\$BUILDER_PUSH"/);
  assert.match(image, /buildah push --digestfile builder\.digest "\$BUILDER_PUSH"/);
  assert.match(ci, /^ {2}BUILDER_DIGEST: "(sha256:[0-9a-f]{64})?"$/m);
});
