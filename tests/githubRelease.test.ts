// The Release workflow (.github/workflows/release.yml): what keeps the signing key and the channels
// safe, checked on the text, so a change that loosens it fails here before it reaches a run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FIRST_BUILD } from "../scripts/site-downloads.mjs";
import { releasePage } from "../src/lib/core/updates";

const wf = readFileSync(".github/workflows/release.yml", "utf8");
/** A job's text, from its key to the next job's. */
function job(name: string): string {
  const at = wf.indexOf(`\n  ${name}:\n`);
  assert.ok(at > 0, `no ${name} job`);
  const next = wf.slice(at + 1).search(/\n {2}[a-z][a-z-]*:\n/);
  return next < 0 ? wf.slice(at) : wf.slice(at, at + 1 + next);
}

test("the workflow runs only when started by hand, with no token permission by default", () => {
  assert.match(wf, /^on:\n {2}workflow_dispatch:\n/m);
  assert.doesNotMatch(wf, /^ {2}(push|pull_request|pull_request_target|schedule|workflow_run):/m);
  assert.match(wf, /^permissions: \{\}$/m);
});

test("every action is pinned to a commit", () => {
  const uses = [...wf.matchAll(/^\s*-?\s*uses: (\S+)/gm)].map((m) => m[1]);
  assert.ok(uses.length > 10);
  for (const u of uses) assert.match(u, /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/, u);
});

test("only the sign job has the signing key, and it runs the checked-out signer with an emptied environment", () => {
  const holders = wf.split("\n").filter((l) => /secrets\.TAURI_SIGNING/.test(l)).length;
  const sign = job("sign");
  assert.equal(sign.split("\n").filter((l) => /secrets\.TAURI_SIGNING/.test(l)).length, holders);
  assert.match(sign, /^ {4}environment: release-signing$/m);
  assert.match(sign, /^ {4}if: >-\n {6}\$\{\{ !cancelled\(\) && github\.ref == 'refs\/heads\/main'$/m);
  // Its checkout is the signer, the manifest script and the public key: nothing to build or install.
  assert.match(sign, /sparse-checkout: \|\n {12}scripts\/updater-sign\.mjs\n {12}scripts\/updater-manifest\.mjs\n {12}src-tauri\/tauri\.conf\.json\n/);
  assert.match(sign, /persist-credentials: false/);
  assert.doesNotMatch(sign, /\b(npm|npx|pnpm|cargo|rustup|setup-node|cache)\b/);
  const links = sign.indexOf("find signed -type l");
  const unset = sign.indexOf('unset "$v"');
  const run = sign.indexOf('exec "$node" scripts/updater-sign.mjs --config src-tauri/tauri.conf.json --version "$version"');
  assert.ok(links > 0 && unset > 0 && run > 0, "the sign step's checks are missing");
  assert.ok(links < run && unset < run, "the signer runs before the checks");
  // The key and its password are in that one step's environment, never the job's.
  const step = sign.slice(sign.indexOf("- name: Sign them"), sign.indexOf("- name: Check the signatures"));
  assert.ok(step.length > 0);
  const key = /\$\{\{ secrets\.TAURI_SIGNING_PRIVATE_KEY(_PASSWORD)? \}\}/g;
  assert.equal(sign.match(key)?.length, 2);
  assert.equal(step.match(key)?.length, 2);
});

test("the jobs that build or run project code hold a read-only token and no secret", () => {
  for (const name of ["test", "linux", "windows", "assemble", "site"]) {
    const j = job(name);
    assert.doesNotMatch(j, /secrets\./, name);
    assert.doesNotMatch(j, /:\s*write\b/, name);
    assert.doesNotMatch(j, /^ {4}environment:/m, name);
  }
});

test("the jobs that write releases check out nothing, and channel moves share one concurrency group", () => {
  for (const name of ["publish", "promote"]) {
    const j = job(name);
    assert.doesNotMatch(j, /actions\/checkout@/, name);
    assert.match(j, /^ {6}contents: write\b/m, name);
    assert.match(j, /concurrency:\n {6}group: channels\n {6}cancel-in-progress: false/, name);
  }
  assert.match(job("site"), /concurrency:\n {6}group: channels\n/);
  // A build's files are never replaced: only a channel's latest.json is uploaded over.
  for (const line of wf.split("\n").filter((l) => l.includes("--clobber") && l.includes("gh release upload")))
    assert.match(line, /gh release upload (experimental|"\$CHANNEL"|beta) [^\n]*latest\.json/, line);
  // Cleanup deletes the build's artifacts by name, never the website's on its way to deploy.
  assert.match(job("cleanup"), /select\(\.name == "build-linux" or \.name == "build-windows" or \.name == "signatures" or \.name == "release-meta"\)/);
  // Promote and pages started off main fail rather than end green.
  assert.match(job("main-only"), /if: inputs\.task != 'release' && github\.ref != 'refs\/heads\/main'[\s\S]*exit 1/);
  // Nothing deletes a release or a tag.
  assert.doesNotMatch(wf, /gh release delete|--cleanup-tag|git push[^\n]*--delete|git\/refs\/tags/);
});

test("the first build made on GitHub is the same number everywhere", () => {
  const offset = Number(/^ {2}BUILD_OFFSET: "(\d+)"$/m.exec(wf)?.[1]);
  assert.equal(offset, 26);
  assert.equal(FIRST_BUILD, 120);
  assert.equal(Number(/^ {2}FIRST_BUILD: "(\d+)"$/m.exec(wf)?.[1]), FIRST_BUILD);
  assert.equal(releasePage(`0.2.${FIRST_BUILD}`), `https://github.com/ShezissSnake/myorbiter/releases/tag/build-${FIRST_BUILD}`);
  assert.equal(releasePage(`0.2.${FIRST_BUILD - 1}`), `https://gitlab.com/sheziss-group/myorbiter/-/releases/build-${FIRST_BUILD - 1}`);
  assert.match(readFileSync("docs/maintaining.md", "utf8"), /BUILD_OFFSET[^\n]*26|26[^\n]*BUILD_OFFSET/);
});
