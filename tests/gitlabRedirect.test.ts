// GitLab is the mirror: its one pipeline (.gitlab-ci.yml) publishes GitLab Pages as a redirect to
// the website on GitHub Pages, and builds, signs and publishes nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ci = readFileSync(".gitlab-ci.yml", "utf8");
const SITE = "https://shezisssnake.github.io/myorbiter/";

test("the only job is pages, started by hand on main", () => {
  const jobs = [...ci.matchAll(/^([a-z][a-z0-9_-]*):$/gm)].map((m) => m[1]).filter((k) => !["spec", "workflow", "variables"].includes(k));
  assert.deepEqual(jobs, ["pages"]);
  assert.match(ci, /^ {4}- if: \(\$CI_PIPELINE_SOURCE == "web" \|\| \$CI_PIPELINE_SOURCE == "api"\) && \$CI_COMMIT_BRANCH == \$CI_DEFAULT_BRANCH$/m);
  assert.match(ci, /^ {4}- when: never$/m);
});

test("it needs no secret and checks nothing out", () => {
  assert.doesNotMatch(ci, /TAURI_SIGNING|SIGNER_SHA256|release-signing|environment:|CI_JOB_TOKEN|glab|curl|wget/);
  assert.match(ci, /^ {4}GIT_STRATEGY: none$/m);
});

test("every page of the old site points at the same page on GitHub Pages, and any other at the front page", () => {
  assert.ok(ci.includes(`SITE: "${SITE}"`));
  const pages = /^\s*for p in ([^;\n]+); do$/m.exec(ci)?.[1].trim().split(/\s+/);
  assert.deepEqual(pages, ["index.html", "downloads.html", "whats-new.html", "guide/index.html", "guide/pages.html", "guide/your-game.html", "guide/getting-around.html"]);
  assert.match(ci, /page 404\.html "\$SITE"/);
  assert.match(ci, /<meta http-equiv="refresh" content="0; url=\$2">/);
  assert.match(ci, /<a href="\$2">\$2<\/a>/);
  assert.doesNotMatch(ci, /<script/i);
});
