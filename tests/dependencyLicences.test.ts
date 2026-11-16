// scripts/dependency-licences.mjs: the licence expressions, the allowed list, the gate, the list a
// download carries, and the files the build reads. Made-up packages only: nothing here runs cargo
// (a stand-in answers in its place); made-up pages are built with the repository's own Vite, as a
// release build does, writing nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs, { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { Worker } from "node:worker_threads";
import {
  ALLOWED_FILE, NO_TEXT_FILE, PREPROCESSORS, PROGRAMS, callerOf, checkList, frameFile, gate, knownTools, licenceAllowed, listenToBuild, main,
  packageDir, pageRecorder, parseCargoTree, parseExpression, pnpmResolutions, readAllowed, readPage, readRust, renderList,
  type NoTextEntry, type Package,
} from "../scripts/dependency-licences.mjs";

const allowed = readAllowed(readFileSync(ALLOWED_FILE, "utf8"));
const ok = (e: string | null) => licenceAllowed(e, allowed).allowed;
const why = (e: string | null) => {
  const r = licenceAllowed(e, allowed);
  return r.allowed ? "" : r.why;
};

// ---------------------------------------------------------------- the allowed list

test("the allowed list is the licences the downloads carried when it was made, and no other", () => {
  assert.deepEqual([...allowed].sort(), [
    "0BSD", "Apache-2.0", "Apache-2.0 WITH LLVM-exception", "BSD-2-Clause", "BSD-3-Clause", "BSL-1.0", "CC0-1.0",
    "CDLA-Permissive-2.0", "ISC", "MIT", "MIT-0", "MPL-2.0", "OFL-1.1", "Unicode-3.0", "Unlicense", "Zlib",
  ]);
  // A common licence, but one no package carried when the list was made.
  assert.equal(ok("Unicode-DFS-2016"), false);
});

test("every expression the downloads carried when the list was made is allowed", () => {
  for (const e of [
    "Apache-2.0", "Apache-2.0 / MIT", "Apache-2.0 OR ISC OR MIT", "Apache-2.0 OR MIT", "Apache-2.0/MIT", "BSD-2-Clause",
    "BSD-2-Clause OR Apache-2.0 OR MIT", "BSD-3-Clause", "BSD-3-Clause OR Apache-2.0", "BSD-3-Clause/MIT", "ISC", "MIT",
    "MIT OR Apache-2.0", "MIT OR Apache-2.0 OR Zlib", "MIT OR Zlib OR Apache-2.0", "MIT/Apache-2.0", "Unicode-3.0", "Zlib",
    "Zlib OR Apache-2.0 OR MIT", "(MIT OR Apache-2.0) AND Unicode-3.0", "0BSD OR MIT OR Apache-2.0", "Apache-2.0 AND ISC",
    "Apache-2.0 AND MIT", "Apache-2.0 OR BSL-1.0", "Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT", "BSD-3-Clause AND MIT",
    "BSL-1.0", "CC0-1.0 OR Apache-2.0", "CC0-1.0 OR MIT-0 OR Apache-2.0", "CDLA-Permissive-2.0", "MPL-2.0", "OFL-1.1",
    "Unlicense OR MIT", "Unlicense/MIT",
  ]) assert.equal(ok(e), true, e);
});

test("one licence: allowed when the list has it, exactly as written", () => {
  assert.equal(ok("MIT"), true);
  assert.equal(ok("GPL-3.0-only"), false);
  assert.match(why("GPL-3.0-only"), /"GPL-3\.0-only" is not allowed by scripts\/dependency-licences-allowed\.txt/);
  assert.equal(ok("mit"), false, "ids are matched as written");
  assert.equal(ok("UNLICENSED"), false, "npm's word for no licence is not the Unlicense");
  assert.equal(ok("MIT+"), false, "an or-later form is another licence");
  assert.equal(ok("LicenseRef-Proprietary"), false);
});

test("a choice (OR) passes when one side is allowed", () => {
  assert.equal(ok("GPL-3.0-only OR MIT"), true);
  assert.equal(ok("MIT OR GPL-3.0-only"), true);
  assert.equal(ok("GPL-3.0-only OR LGPL-2.1-only"), false);
});

test("the old / is a choice too, with or without spaces", () => {
  assert.equal(ok("GPL-2.0/MIT"), true);
  assert.equal(ok("GPL-2.0 / MIT"), true);
  assert.equal(ok("GPL-2.0/LGPL-2.1"), false);
  assert.deepEqual(parseExpression("MIT/Apache-2.0"), { or: [{ id: "MIT" }, { id: "Apache-2.0" }] });
});

test("an AND passes only when every side is allowed", () => {
  assert.equal(ok("Apache-2.0 AND ISC"), true);
  assert.equal(ok("MIT AND GPL-3.0-only"), false);
  assert.equal(ok("GPL-3.0-only AND MIT"), false);
});

test("an exception passes only as the list names it", () => {
  assert.equal(ok("Apache-2.0 WITH LLVM-exception"), true);
  assert.equal(ok("MIT WITH LLVM-exception"), false, "the exception with another licence");
  assert.equal(ok("Apache-2.0 WITH Classpath-exception-2.0"), false, "another exception with an allowed licence");
  assert.equal(ok("GPL-2.0-only WITH Classpath-exception-2.0 OR MIT"), true, "a choice with an allowed side");
  assert.match(why("Apache-2.0 WITH Classpath-exception-2.0"), /not allowed/);
});

test("parentheses group, and AND binds tighter than OR", () => {
  assert.equal(ok("(GPL-3.0-only OR MIT) AND Unicode-3.0"), true);
  assert.equal(ok("(GPL-3.0-only OR LGPL-2.1-only) AND MIT"), false);
  assert.deepEqual(parseExpression("MIT OR Apache-2.0 AND GPL-3.0-only"), {
    or: [{ id: "MIT" }, { and: [{ id: "Apache-2.0" }, { id: "GPL-3.0-only" }] }],
  });
  assert.equal(ok("MIT OR Apache-2.0 AND GPL-3.0-only"), true, "MIT alone is a side");
  assert.equal(ok("GPL-3.0-only AND MIT OR LGPL-2.1-only"), false, "(GPL AND MIT) OR LGPL");
  assert.equal(ok("((MIT))"), true);
});

test("an expression the reader doesn't understand stops: it never passes", () => {
  for (const e of ["MIT or Apache-2.0", "MIT and ISC", "MIT OR", "OR MIT", "(MIT OR ISC", "MIT)", "MIT Apache-2.0", "MIT AND AND ISC",
    "Apache-2.0 WITH", "WITH LLVM-exception", "MIT, Apache-2.0", "()", "MIT OR /ISC"]) {
    assert.equal(ok(e), false, e);
    assert.match(why(e), /is not understood/, e);
  }
  for (const e of ["", "  ", null]) assert.match(why(e), /no licence expression/);
});

test("the allowed list's own lines are read strictly", () => {
  assert.deepEqual([...readAllowed("# comment\n\nMIT\n  Apache-2.0  \nApache-2.0 WITH LLVM-exception\n")], ["MIT", "Apache-2.0", "Apache-2.0 WITH LLVM-exception"]);
  assert.throws(() => readAllowed("MIT OR Apache-2.0\n"), /is neither a licence id/);
  assert.throws(() => readAllowed("Apache-2.0 with LLVM-exception\n"), /is neither a licence id/);
});

// ---------------------------------------------------------------- the gate

const MIT_TEXT = { file: "LICENSE-MIT", sha256: "a".repeat(64), licence: true };
const crate = (name: string, version: string, licence: string | null, more: Partial<Package> = {}): Package => ({
  kind: "rust", name, version, licence, licenceForm: null, source: "registry", texts: [MIT_TEXT], ...more,
});
const noText = { crates: [] as NoTextEntry[] };

test("a build whose every package is allowed, from the registry and with its text passes", () => {
  const r = gate([crate("serde", "1.0.0", "MIT OR Apache-2.0"), crate("ring", "0.17.14", "Apache-2.0 AND ISC"),
    { ...crate("svelte", "5.0.0", "MIT"), kind: "npm" }], allowed, noText);
  assert.deepEqual(r, { failures: [], supplied: [] });
});

test("the gate stops at a package with no licence, and names it", () => {
  const r = gate([crate("good", "1.0.0", "MIT"), crate("made-up-none", "0.1.0", null)], allowed, noText);
  assert.deepEqual(r.failures, ["made-up-none 0.1.0 (Rust crate): no licence"]);
  const file = gate([crate("made-up-file", "0.1.0", null, { licenceForm: "a licence file (LICENSE.txt) in place of an expression" })], allowed, noText);
  assert.deepEqual(file.failures, ["made-up-file 0.1.0 (Rust crate): no licence: a licence file (LICENSE.txt) in place of an expression"]);
  const npm = gate([{ ...crate("made-up-see", "1.0.0", null, { licenceForm: '"SEE LICENSE IN LICENSE" in place of an expression' }), kind: "npm" }], allowed, noText);
  assert.match(npm.failures[0], /^made-up-see 1\.0\.0 \(npm package\): no licence: "SEE LICENSE IN/);
});

test("the gate stops at a licence the list doesn't allow, and at one it doesn't understand", () => {
  const r = gate([crate("made-up-gpl", "2.0.0", "GPL-3.0-only"), crate("made-up-odd", "1.0.0", "MIT or Apache-2.0")], allowed, noText);
  assert.deepEqual(r.failures, [
    'made-up-gpl 2.0.0 (Rust crate): "GPL-3.0-only" is not allowed by scripts/dependency-licences-allowed.txt',
    'made-up-odd 1.0.0 (Rust crate): "MIT or Apache-2.0" is not understood: "or" after a complete expression',
  ]);
});

test("the gate stops at a source that is not the registry", () => {
  const r = gate([crate("made-up-git", "0.3.0", "MIT", { source: "https://github.com/example/made-up#0123abcd" }),
    crate("made-up-path", "0.1.0", "MIT", { source: "a path outside the workspace" }),
    { ...crate("made-up-tarball", "1.0.0", "MIT", { source: "pnpm-lock.yaml resolves it as {tarball: https://example.com/x.tgz}" }), kind: "npm" }], allowed, noText);
  assert.deepEqual(r.failures, [
    "made-up-git 0.3.0 (Rust crate): its source is not the registry: https://github.com/example/made-up#0123abcd",
    "made-up-path 0.1.0 (Rust crate): its source is not the registry: a path outside the workspace",
    "made-up-tarball 1.0.0 (npm package): its source is not the registry: pnpm-lock.yaml resolves it as {tarball: https://example.com/x.tgz}",
  ]);
});

test("the gate stops at a package with no licence text and nothing in the no-text file", () => {
  const notice = { file: "NOTICE", sha256: "b".repeat(64), licence: false };
  const r = gate([crate("made-up-bare", "1.0.0", "MIT", { texts: [] }), crate("made-up-notice", "1.0.0", "Apache-2.0", { texts: [notice] }),
    { ...crate("made-up-npm", "1.0.0", "MIT", { texts: [] }), kind: "npm" }], allowed, noText);
  assert.deepEqual(r.failures, [
    "made-up-bare 1.0.0 (Rust crate): no licence text in its source, and none in scripts/dependency-licences-no-text.json",
    "made-up-notice 1.0.0 (Rust crate): no licence text in its source, and none in scripts/dependency-licences-no-text.json",
    "made-up-npm 1.0.0 (npm package): no licence text in its source, and none in scripts/dependency-licences-no-text.json",
  ]);
});

test("a package that fails several ways is named once for each", () => {
  const r = gate([crate("made-up-all", "0.0.1", "GPL-3.0-only", { source: "https://example.com/git", texts: [] })], allowed, noText);
  assert.equal(r.failures.length, 3);
  assert.ok(r.failures.every((f) => f.startsWith("made-up-all 0.0.1 (Rust crate): ")));
});

// ---------------------------------------------------------------- the crates that ship no text

const APACHE = { file: "LICENSE-APACHE", sha256: "c".repeat(64), licence: true };
const entry = (e: Partial<NoTextEntry>): NoTextEntry => ({ name: "made-up", version: "1.0.0", licence: "Apache-2.0", text: null, ...e });

test("a crate the no-text file names with no text passes, and the list says so", () => {
  const p = crate("made-up", "1.0.0", "MIT", { texts: [] });
  const r = gate([p], allowed, { crates: [entry({ licence: "MIT", upstream: "https://example.com/made-up" })] });
  assert.deepEqual(r.failures, []);
  assert.equal(r.supplied.length, 1);
  assert.equal(r.supplied[0].carry, null);
});

test("a crate given another package's text passes only when this build ships that text", () => {
  const p = crate("made-up", "1.0.0", "MIT OR Apache-2.0", { texts: [] });
  const e = entry({ licence: "MIT OR Apache-2.0", used: "Apache-2.0", text: { sha256: APACHE.sha256 } });
  const other = crate("other", "2.0.0", "Apache-2.0", { texts: [APACHE] });
  let r = gate([p, other], allowed, { crates: [e] });
  assert.deepEqual(r.failures, []);
  assert.equal(r.supplied[0].carry?.from, other);
  assert.equal(r.supplied[0].carry?.file, "LICENSE-APACHE");
  r = gate([p, crate("other", "2.0.0", "MIT")], allowed, { crates: [e] });
  assert.match(r.failures[0], /^made-up 1\.0\.0 \(Rust crate\): the text .* gives it \(any package, SHA-256 cccccccccccc…\) is in no package of this build$/);
  // Named by its package, it must come from that one.
  r = gate([p, other], allowed, { crates: [{ ...e, text: { sha256: APACHE.sha256, from: "sibling" } }] });
  assert.match(r.failures[0], /\(sibling, SHA-256/);
  r = gate([p, other, crate("sibling", "0.1.0", "Apache-2.0", { texts: [APACHE] })], allowed, { crates: [{ ...e, text: { sha256: APACHE.sha256, from: "sibling" } }] });
  assert.equal(r.supplied[0].carry?.from.name, "sibling");
});

test("a new version of a listed crate, or a changed licence, stops the build", () => {
  const e = entry({ licence: "MIT" });
  let r = gate([crate("made-up", "1.0.1", "MIT", { texts: [] })], allowed, { crates: [e] });
  assert.match(r.failures[0], /^made-up 1\.0\.1 .*none in scripts\/dependency-licences-no-text\.json$/);
  r = gate([crate("made-up", "1.0.0", "BSD-3-Clause", { texts: [] })], allowed, { crates: [e] });
  assert.deepEqual(r.failures, ['made-up 1.0.0 (Rust crate): scripts/dependency-licences-no-text.json has it as "MIT", its manifest says "BSD-3-Clause"']);
});

test("clipboard-win's text is the one error-code ships, even when another crate ships the same file first", () => {
  const file = JSON.parse(readFileSync(NO_TEXT_FILE, "utf8")) as { crates: NoTextEntry[] };
  const e = file.crates.find((c) => c.name === "clipboard-win");
  assert.ok(e?.text);
  const boost = { file: "LICENSE-BOOST", sha256: e.text.sha256, licence: true };
  const r = gate([
    crate("ryu", "1.0.23", "Apache-2.0 OR BSL-1.0", { texts: [boost] }),
    crate("error-code", "3.3.2", "BSL-1.0", { texts: [{ ...boost, file: "LICENSE" }] }),
    crate("clipboard-win", "5.4.1", "BSL-1.0", { texts: [] }),
  ], allowed, file);
  assert.deepEqual(r.failures, []);
  assert.equal(r.supplied[0].carry?.from.name, "error-code");
  assert.equal(r.supplied[0].carry?.file, "LICENSE");
});

test("the no-text file names the 13 crates whose published source carries no text", () => {
  const file = JSON.parse(readFileSync(NO_TEXT_FILE, "utf8")) as { crates: NoTextEntry[] };
  assert.deepEqual(file.crates.map((c) => `${c.name} ${c.version}`).sort(), [
    "alloc-stdlib 0.3.0", "clipboard-win 5.4.1", "cookie-factory 0.3.3", "dlopen2 0.8.2", "drm-fourcc 2.2.0", "gbm-sys 0.4.0", "gl 0.14.0",
    "libwayshot-xcap 0.3.3", "profiling 1.0.18", "pulp-wasm-simd-flag 0.1.1", "webview2-com 0.39.1", "webview2-com-sys 0.39.1", "zune-inflate 0.2.54",
  ]);
  for (const c of file.crates) {
    assert.equal(ok(c.licence), true, c.name);
    if (c.text) {
      assert.match(c.text.sha256, /^[0-9a-f]{64}$/, c.name);
      assert.ok(c.used && c.why, c.name);
      assert.equal(ok(c.used), true, c.name);
    } else assert.match(c.upstream ?? "", /^https:\/\//, c.name);
  }
});

// ---------------------------------------------------------------- what a build gives

test("cargo tree's lines: registry, path and git sources, repeats and an empty licence", () => {
  assert.deepEqual(parseCargoTree([
    "myorbiter v0.1.0 (/home/user/orbiter/src-tauri)|GPL-3.0-only",
    "base64 v0.23.1|MIT OR Apache-2.0",
    "crc32fast v1.5.3|MIT OR Apache-2.0 (*)",
    "crc32fast v1.5.3|MIT OR Apache-2.0",
    "toml v1.1.3+spec-1.1.0|MIT OR Apache-2.0",
    "made-up v0.1.0 (https://github.com/example/made-up#0123abcd)|MIT",
    "bare v1.0.0|",
    "winonly v1.0.0 (C:\\Users\\user\\orbiter\\src-tauri)|GPL-3.0-only",
    "",
  ].join("\n")), [
    { name: "myorbiter", version: "0.1.0", source: "/home/user/orbiter/src-tauri", licence: "GPL-3.0-only" },
    { name: "base64", version: "0.23.1", source: null, licence: "MIT OR Apache-2.0" },
    { name: "crc32fast", version: "1.5.3", source: null, licence: "MIT OR Apache-2.0" },
    { name: "toml", version: "1.1.3+spec-1.1.0", source: null, licence: "MIT OR Apache-2.0" },
    { name: "made-up", version: "0.1.0", source: "https://github.com/example/made-up#0123abcd", licence: "MIT" },
    { name: "bare", version: "1.0.0", source: null, licence: null },
    { name: "winonly", version: "1.0.0", source: "C:\\Users\\user\\orbiter\\src-tauri", licence: "GPL-3.0-only" },
  ]);
});

test("a line of cargo tree's it can't read stops it: no crate is left out unread", () => {
  for (const line of ["gplcrate 1.0.0|GPL-3.0", "gplcrate@1.0.0|GPL-3.0", "gplcrate v1.0.0 GPL-3.0", "warning: something"]) {
    assert.throws(() => parseCargoTree(`base64 v0.23.1|MIT OR Apache-2.0\n${line}\n`), /a line this script can't read/, line);
  }
});

// A stand-in cargo on PATH: `metadata` answers with the program's own crate, `tree` with $FAKE_TREE.
const withCargo = async (tree: string, run: (repo: string) => Promise<void>) => {
  const dir = mkdtempSync(join(tmpdir(), "dependency-licences-"));
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "cargo"),
    '#!/bin/sh\nif [ "$1" = metadata ]; then echo \'{"packages":[{"name":"myorbiter","version":"0.1.0"}]}\'; else cat "$FAKE_TREE"; fi\n');
  chmodSync(join(dir, "bin", "cargo"), 0o755);
  writeFileSync(join(dir, "tree.txt"), tree);
  const saved = { PATH: process.env.PATH, FAKE_TREE: process.env.FAKE_TREE };
  process.env.PATH = `${join(dir, "bin")}${delimiter}${saved.PATH}`;
  process.env.FAKE_TREE = join(dir, "tree.txt");
  try {
    await run(dir);
  } finally {
    process.env.PATH = saved.PATH;
    if (saved.FAKE_TREE === undefined) delete process.env.FAKE_TREE;
    else process.env.FAKE_TREE = saved.FAKE_TREE;
    rmSync(dir, { recursive: true, force: true });
  }
};

test("the Rust half stops when cargo answers with a line it can't read, or with no crate", { skip: process.platform === "win32" }, async () => {
  await withCargo("gplcrate 1.0.0|GPL-3.0\n", async (repo) => {
    assert.throws(() => readRust("myorbiter", "x86_64-unknown-linux-gnu", repo), /a line this script can't read.*gplcrate 1\.0\.0\|GPL-3\.0/);
  });
  await withCargo("\n", async (repo) => {
    assert.throws(() => readRust("myorbiter", "x86_64-unknown-linux-gnu", repo), /cargo tree gave no crate for MyOrbiter/);
  });
  // Only the program's own crate: nothing to list either.
  await withCargo("myorbiter v0.1.0 (/home/user/orbiter/src-tauri)|GPL-3.0-only\n", async (repo) => {
    assert.throws(() => readRust("myorbiter", "x86_64-unknown-linux-gnu", repo), /no crate/);
  });
});

test("a page module's package folder, with npm's layout, pnpm's and Windows paths", () => {
  assert.equal(packageDir("/r/node_modules/svelte/src/index.js"), "/r/node_modules/svelte");
  assert.equal(packageDir("/r/node_modules/@fontsource/ibm-plex-mono/index.css?inline"), "/r/node_modules/@fontsource/ibm-plex-mono");
  assert.equal(packageDir("/r/app/node_modules/.pnpm/react-dom@19.3.1_react@19.3.1/node_modules/react-dom/cjs/x.js"),
    "/r/app/node_modules/.pnpm/react-dom@19.3.1_react@19.3.1/node_modules/react-dom");
  assert.equal(packageDir("C:\\r\\node_modules\\clsx\\dist\\clsx.mjs"), "C:/r/node_modules/clsx");
  assert.equal(packageDir("\0/r/node_modules/a/node_modules/b/x.js"), "/r/node_modules/a/node_modules/b");
  assert.equal(packageDir("/r/src/App.svelte"), null);
  assert.equal(packageDir("/r/node_modules/.pnpm/lock.yaml"), null);
});

// ---------------------------------------------------------------- what the page's build reads

test("the file a stack frame's code is in, Node's own code, or none", () => {
  assert.equal(frameFile("    at x (file:///r/node_modules/vite/dist/node/chunks/node.js:1:1)"), "/r/node_modules/vite/dist/node/chunks/node.js");
  assert.equal(frameFile("    at /r/vite.config.ts:3:9"), "/r/vite.config.ts");
  assert.equal(frameFile("    at async file:///r/a%20b/c.mjs:3:9"), "/r/a b/c.mjs");
  assert.equal(frameFile("    at f (C:\\r\\node_modules\\x\\i.js:1:2)"), "C:/r/node_modules/x/i.js");
  assert.equal(frameFile("    at Object.readFileSync (node:fs:444:35)"), "node:fs");
  assert.equal(frameFile("    at ReadStream.open (node:internal/fs/streams:150:12)"), "node:internal/fs/streams");
  assert.equal(frameFile("    at new Promise (<anonymous>)"), "");
  assert.equal(frameFile("    at async Promise.all (index 0)"), "");
  assert.equal(callerOf("    at Array.map (<anonymous>)\n    at f (file:///r/x.js:1:1)"), "/r/x.js");
});

test("a file of a package read through fs is in the page; a known tool finding its files is not, and any other reader of a package.json, or a package Node loads that is no known tool's, stops it", () => {
  const r = pageRecorder("/r", { vite: null, rolldown: null }, { tools: new Set(["/r/node_modules/vite", "/r/node_modules/vitefu"]), commands: [] });
  // The stack from the frame that called fs on.
  const builder = "    at x (file:///r/node_modules/vite/dist/node/chunks/node.js:1:1)";
  const loader = "    at getSourceSync (node:internal/modules/esm/load:45:17)\n    at defaultLoadSync (node:internal/modules/esm/load:161:34)";
  // A config read while Node runs it: the reader is the config, with Node's loader only below it.
  const config = "    at file:///r/node_modules/.vite-temp/vite.config.ts.timestamp-1.mjs:3:9\n    at ModuleJob.run (node:internal/modules/esm/module_job:271:25)";
  r.read("/r/node_modules/fakesv/s.css", builder);
  r.read("/r/node_modules/.pnpm/deep@2.0.0/node_modules/deep/y.css", builder);
  r.read("C:\\r\\node_modules\\winpkg\\f.woff2", builder);
  r.read("/r/node_modules/resolved-only/package.json", builder);
  r.read("/r/node_modules/crawled-only/package.json", "    at readJson (file:///r/node_modules/vitefu/src/index.js:303:30)");
  // fs's own code with no outer call heard: `new fs.ReadStream` opening its file.
  r.read("/r/node_modules/fakestream/x.txt", "    at ReadStream.open (node:internal/fs/streams:150:12)\n    at process.processTicksAndRejections (node:internal/process/task_queues:85:11)");
  // Node's loader: a known tool's code, the config, and a package that is no known tool's.
  r.read("/r/node_modules/vite/dist/node/index.js", loader);
  r.read("/r/node_modules/.vite-temp/vite.config.ts.timestamp-1.mjs", loader);
  r.read("/r/node_modules/a-tool/dist/index.js", loader);
  r.loaded("/r/node_modules/vitefu/src/index.js", true);
  r.read("/r/node_modules/.modules.yaml", builder);
  r.read("/r/node_modules/fakedef/x.txt", config);
  // A package.json read by anything but the known tools: the config, a package that is no known
  // tool's, a known tool the config called.
  r.read("/r/node_modules/fakepj/package.json", config);
  r.read("/r/node_modules/fakepjread/package.json", "    at transform (file:///r/node_modules/fakeplugin/index.js:4:20)");
  r.read("/r/node_modules/fakepjcalled/package.json", `${builder}\n    at file:///r/node_modules/.vite-temp/vite.config.ts.timestamp-1.mjs:3:9`);
  // A package.json copied (cpSync of a package's folder): it is in the page.
  r.read("/r/node_modules/fakecopied/package.json", config, "copy");
  r.read("/r/src/app.css", builder);
  assert.deepEqual([...r.rendered].map(([d, how]) => [d, [...how]]), [
    ["/r/node_modules/fakesv", ["file"]],
    ["/r/node_modules/.pnpm/deep@2.0.0/node_modules/deep", ["file"]],
    ["C:/r/node_modules/winpkg", ["file"]],
    ["/r/node_modules/fakestream", ["file"]],
    ["/r/node_modules/fakedef", ["file"]],
    ["/r/node_modules/fakecopied", ["file"]],
  ]);
  assert.deepEqual(r.stops().map((s) => s.replace(/,.*/, "")), [
    "/r/node_modules/fakepj/package.json is read by /r/node_modules/.vite-temp/vite.config.ts.timestamp-1.mjs",
    "/r/node_modules/fakepjcalled/package.json is read by /r/node_modules/.vite-temp/vite.config.ts.timestamp-1.mjs",
    "/r/node_modules/fakepjread/package.json is read by /r/node_modules/fakeplugin/index.js",
    "the build loaded the package in /r/node_modules/a-tool",
  ]);
  assert.equal(r.hooks(), 1);
});

test("a thread, a process it doesn't know and a config built from a file outside the page stop the build", () => {
  const r = pageRecorder("/r", { vite: null, rolldown: null }, { tools: new Set(), commands: ["git log -1"] });
  r.command("git log -1");
  r.config(["/r/vite.config.ts", "/r/node_modules/fakerel/index.js"]);
  assert.deepEqual(r.stops(), []);
  r.config(["/elsewhere/shared.ts"]);
  r.command("cat node_modules/x/y.txt");
  r.worker("w.js");
  assert.deepEqual([...r.rendered.keys()], ["/r/node_modules/fakerel"]);
  assert.deepEqual(r.stops().map((s) => s.replace(/,.*/, "")), [
    "the build started a process this script doesn't know",
    "the build started a thread (w.js)",
    "the page's config is built from /elsewhere/shared.ts",
  ]);
});

test("fs's reads, copies and links are heard once each, by the code that called them; threads and processes too", { skip: process.platform === "win32" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "dependency-licences-"));
  const pkg = join(dir, "node_modules", "fakefs");
  mkdirSync(join(pkg, "sub"), { recursive: true });
  for (const f of ["a.txt", "b.txt", "c.txt", "d.txt", "e.txt", "f.txt", "sub/g.txt"]) writeFileSync(join(pkg, f), f);
  symlinkSync(join(pkg, "f.txt"), join(dir, "link.txt"));
  const heard: string[] = [];
  const events: string[] = [];
  const stop = listenToBuild({
    read: (path: string, stack: string, how = "read") => heard.push(`${path.slice(dir.length + 1)} ${how} ${callerOf(stack).endsWith("dependencyLicences.test.ts") ? "test" : callerOf(stack)}`),
    loaded: () => {},
    worker: (what: string) => events.push(`worker ${what}`),
    command: (line: string) => events.push(`command ${line}`),
  });
  try {
    readFileSync(join(pkg, "a.txt"), "utf8");
    readFileSync(join(pkg, "a.txt"));
    // fs.ReadStream's constructor, as a config can call it (its types name only the options).
    const ReadStream = fs.ReadStream as unknown as new (path: string) => fs.ReadStream;
    await new Promise((ok) => new ReadStream(join(pkg, "b.txt")).on("close", ok).resume());
    await new Promise((ok) => fs.createReadStream(join(pkg, "c.txt")).on("close", ok).resume());
    copyFileSync(join(pkg, "d.txt"), join(dir, "d-copy.txt"));
    await fs.promises.copyFile(join(pkg, "e.txt"), join(dir, "e-copy.txt"));
    fs.linkSync(join(pkg, "e.txt"), join(dir, "e-link.txt"));
    fs.cpSync(join(pkg, "sub"), join(dir, "sub-copy"), { recursive: true });
    readFileSync(join(dir, "link.txt"));
    execFileSync("true", ["made-up"]);
    await new Promise((ok) => new Worker("1", { eval: true }).on("exit", ok));
  } finally {
    stop();
    rmSync(dir, { recursive: true, force: true });
  }
  assert.deepEqual(heard, [
    "node_modules/fakefs/a.txt read test",
    "node_modules/fakefs/a.txt read test",
    "node_modules/fakefs/b.txt read node:internal/fs/streams",
    "node_modules/fakefs/c.txt read test",
    "node_modules/fakefs/d.txt copy test",
    "node_modules/fakefs/e.txt copy test",
    "node_modules/fakefs/e.txt copy test",
    "node_modules/fakefs/sub/g.txt copy test",
    "link.txt read test",
  ]);
  assert.deepEqual(events, ["command true made-up", "worker 1"]);
});

test("a file the build emits without having read it through fs is named: what it inlines could go unseen", () => {
  const r = pageRecorder("/r");
  r.read("/r/src/heard.svg", "Error");
  r.plugin.generateBundle({}, {
    "a.svg": { type: "asset", fileName: "assets/heard.svg", originalFileNames: ["src/heard.svg"] },
    "b.svg": { type: "asset", fileName: "assets/unheard.svg", originalFileNames: ["src/unheard.svg"] },
    // The page's styles and HTML name their entry, not a file read.
    "c.css": { type: "asset", fileName: "assets/index.css", originalFileNames: ["index.html"] },
    "index.html": { type: "asset", fileName: "index.html", originalFileNames: ["index.html"] },
  });
  assert.deepEqual(r.unheard(), ["/r/src/unheard.svg"]);
});

test("a worker the page's build makes gets the same listener", () => {
  const r = pageRecorder("/r");
  const config: { worker?: { plugins?: () => unknown[] } } = { worker: { plugins: () => ["the page's own"] } };
  r.plugin.config(config);
  const plugins = config.worker?.plugins?.() as unknown[];
  assert.equal(plugins[0], "the page's own");
  const worker = plugins[1] as { name: string; generateBundle(o: unknown, b: unknown): void };
  assert.equal(worker.name, "dependency-licences:worker");
  worker.generateBundle({}, { "w.js": { type: "chunk", modules: { "/r/node_modules/fakeworker/index.js": { renderedLength: 10 } } } });
  assert.deepEqual([...r.rendered.keys()], ["/r/node_modules/fakeworker"]);
});

// A made-up page with made-up GPL-3.0 packages, built with the repository's own Vite (and Svelte,
// for a component's style): the page's real build, run again by readPage as a release build does.
const pageBuild = async (files: Record<string, string>, svelte = false, links: Record<string, string> = {}) => {
  const repo = mkdtempSync(join(tmpdir(), "dependency-licences-"));
  const nm = join(repo, "node_modules");
  mkdirSync(nm);
  for (const p of svelte ? ["vite", "svelte", "@sveltejs"] : ["vite"]) symlinkSync(join(process.cwd(), "node_modules", p), join(nm, p));
  const lock: { packages: Record<string, unknown> } = { packages: {} };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(repo, path, ".."), { recursive: true });
    writeFileSync(join(repo, path), text);
    const m = /^node_modules\/([^/]+)\//.exec(path);
    if (m && !existsSync(join(nm, m[1], "package.json"))) {
      writeFileSync(join(nm, m[1], "package.json"), JSON.stringify({ name: m[1], version: "1.0.0", license: "GPL-3.0", type: "module", main: "index.js" }));
      writeFileSync(join(nm, m[1], "LICENSE"), `${m[1]}: a made-up licence text\n`);
      lock.packages[`node_modules/${m[1]}`] = { version: "1.0.0", resolved: `https://registry.npmjs.org/${m[1]}/-/${m[1]}-1.0.0.tgz` };
    }
  }
  // Links in the page's folder, each to a path in the page's folder, or to a folder elsewhere.
  for (const [path, target] of Object.entries(links)) {
    mkdirSync(join(repo, path, ".."), { recursive: true });
    symlinkSync(target.startsWith("/") ? target : join(repo, target), join(repo, path));
  }
  writeFileSync(join(repo, "package.json"), '{"type":"module"}\n');
  writeFileSync(join(repo, "package-lock.json"), JSON.stringify(lock));
  if (!files["index.html"]) writeFileSync(join(repo, "index.html"), '<!doctype html><html><body><script type="module" src="/src/main.js"></script></body></html>\n');
  if (!files["vite.config.ts"]) {
    writeFileSync(join(repo, "vite.config.ts"), svelte
      ? 'import { svelte } from "@sveltejs/vite-plugin-svelte";\nexport default { plugins: [svelte()] };\n'
      : "export default {};\n");
  }
  if (svelte) writeFileSync(join(repo, "svelte.config.js"), 'import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";\nexport default { preprocess: vitePreprocess() };\n');
  try {
    const page = await readPage("myorbiter", repo);
    const made = page.packages.filter((p) => p.name.startsWith("fake")).map((p) => `${p.name} ${p.version} ${p.licence}`).sort();
    const stops = gate(page.packages.filter((p) => p.name.startsWith("fake")), allowed, noText).failures;
    return { made, failures: page.failures, stops };
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
};
const unix = { skip: process.platform === "win32" };

test("a package a stylesheet @imports, and one whose file its url() inlines, are in the page", unix, async () => {
  const r = await pageBuild({
    "src/main.js": 'import "./app.css";\n',
    "src/app.css": '@import "fakecss/x.css";\n@font-face{font-family:F;src:url("fakefont/f.woff2")}\nbody{font-family:F}\n',
    "node_modules/fakecss/x.css": '@import "fakedeep/y.css";\n.x{color:red}\n',
    "node_modules/fakedeep/y.css": ".y{color:blue}\n",
    "node_modules/fakefont/f.woff2": "wOF2tinyfont",
  });
  assert.deepEqual(r.made, ["fakecss 1.0.0 GPL-3.0", "fakedeep 1.0.0 GPL-3.0", "fakefont 1.0.0 GPL-3.0"]);
  assert.deepEqual(r.failures, []);
  assert.equal(r.stops.length, 3);
});

test("a package a component's <style> @imports is in the page", unix, async () => {
  const r = await pageBuild({
    "src/main.js": 'import { mount } from "svelte";\nimport App from "./App.svelte";\nmount(App, { target: document.body });\n',
    "src/App.svelte": '<p class="fs">x</p>\n<style>\n  @import "fakesv/s.css";\n</style>\n',
    "node_modules/fakesv/s.css": ".fs{color:#654321}\n",
  }, true);
  assert.deepEqual(r.made, ["fakesv 1.0.0 GPL-3.0"]);
  assert.match(r.stops.join("\n"), /fakesv 1\.0\.0 \(npm package\): "GPL-3\.0" is not allowed/);
});

test("a package a CSS module composes from is in the page", unix, async () => {
  const r = await pageBuild({
    "src/main.js": 'import m from "./a.module.css";\nconsole.log(m.a);\n',
    "src/a.module.css": '.a{composes: b from "fakecomp/c.module.css"; color: blue}\n',
    "node_modules/fakecomp/c.module.css": ".b{color:#123456}\n",
  });
  assert.deepEqual(r.made, ["fakecomp 1.0.0 GPL-3.0"]);
  assert.deepEqual(r.failures, []);
});

test("a package's small file new URL(…, import.meta.url) inlines is in the page", unix, async () => {
  const r = await pageBuild({
    "src/main.js": 'console.log(new URL("../node_modules/fakemeta/a.svg", import.meta.url).href);\n',
    "node_modules/fakemeta/a.svg": "<svg xmlns='http://www.w3.org/2000/svg' id='made-up'/>\n",
  });
  assert.deepEqual(r.made, ["fakemeta 1.0.0 GPL-3.0"]);
  assert.deepEqual(r.failures, []);
});

test("a package's small file index.html inlines is in the page", unix, async () => {
  const r = await pageBuild({
    "index.html": '<!doctype html><html><body><img src="/node_modules/fakehtmlimg/i.svg" alt=""><script type="module" src="/src/main.js"></script></body></html>\n',
    "src/main.js": "console.log(1);\n",
    "node_modules/fakehtmlimg/i.svg": "<svg xmlns='http://www.w3.org/2000/svg' id='made-up'/>\n",
  });
  assert.deepEqual(r.made, ["fakehtmlimg 1.0.0 GPL-3.0"]);
  assert.deepEqual(r.failures, []);
});

test("a package a worker of the page imports is in the page", unix, async () => {
  const r = await pageBuild({
    "src/main.js": 'new Worker(new URL("./w.js", import.meta.url), { type: "module" });\n',
    "src/w.js": 'import { work } from "fakeworker";\nself.postMessage(work());\n',
    "node_modules/fakeworker/index.js": 'export const work = () => "made-up " + Math.random();\n',
  });
  assert.deepEqual(r.made, ["fakeworker 1.0.0 GPL-3.0"]);
  assert.deepEqual(r.failures, []);
});

test("a package's file the page's own config reads into the page is in the page; a package.json it reads stops the build", unix, async () => {
  const r = await pageBuild({
    "src/main.js": "console.log(__MADE_UP__, __MADE_UP_VERSION__);\n",
    "node_modules/fakedef/x.txt": "made-up words\n",
    "node_modules/fakepj/index.js": "export {};\n",
    "vite.config.ts": 'import { readFileSync } from "node:fs";\nexport default { define: {\n' +
      '  __MADE_UP__: JSON.stringify(readFileSync("node_modules/fakedef/x.txt", "utf8")),\n' +
      '  __MADE_UP_VERSION__: JSON.stringify(JSON.parse(readFileSync("node_modules/fakepj/package.json", "utf8")).version),\n} };\n',
  });
  assert.deepEqual(r.made, ["fakedef 1.0.0 GPL-3.0"]);
  assert.equal(r.failures.length, 1);
  assert.match(r.failures[0], /node_modules\/fakepj\/package\.json is read by .*vite\.config\.ts\.timestamp.*, which is none of the build's known tools/);
});

test("a package's file the config reads through fs.ReadStream's constructor, or through a link in the page's folder, is in the page", unix, async () => {
  const r = await pageBuild({
    "src/main.js": "console.log(__STREAM__, __LINKED__);\n",
    "node_modules/fakestream/x.txt": "made-up stream\n",
    "node_modules/fakesymcfg/x.txt": "made-up link\n",
    "vite.config.ts": 'import fs from "node:fs";\n' +
      'const stream = await new Promise((ok) => { let s = ""; new fs.ReadStream("node_modules/fakestream/x.txt", "utf8").on("data", (d) => (s += d)).on("end", () => ok(s)); });\n' +
      'export default { define: { __STREAM__: JSON.stringify(stream), __LINKED__: JSON.stringify(fs.readFileSync("src/linked.txt", "utf8")) } };\n',
  }, false, { "src/linked.txt": "node_modules/fakesymcfg/x.txt" });
  assert.deepEqual(r.made, ["fakestream 1.0.0 GPL-3.0", "fakesymcfg 1.0.0 GPL-3.0"]);
  assert.deepEqual(r.failures, []);
});

test("a package's files a plugin copies into the output, or copies and then reads the copy, are in the page", unix, async () => {
  const r = await pageBuild({
    "src/main.js": "console.log(1);\n",
    "node_modules/fakecopy/x.txt": "made-up copy\n",
    "node_modules/fakecp/x.txt": "made-up folder\n",
    "node_modules/fakeemitcp/x.txt": "made-up copy read\n",
    "node_modules/fakelinkcp/x.txt": "made-up hard link\n",
    "vite.config.ts": 'import { copyFileSync, cpSync, linkSync, mkdirSync, readFileSync, rmSync } from "node:fs";\nimport { join } from "node:path";\n' +
      "let out = \"\";\nexport default { plugins: [{ name: \"made-up-copier\",\n" +
      "  configResolved(c) { out = c.build.outDir; },\n" +
      '  generateBundle() { const t = join(process.cwd(), "made-up-tmp"); mkdirSync(t, { recursive: true });\n' +
      '    copyFileSync("node_modules/fakeemitcp/x.txt", join(t, "e.txt")); linkSync("node_modules/fakelinkcp/x.txt", join(t, "l.txt"));\n' +
      '    this.emitFile({ type: "asset", fileName: "copied.txt", source: readFileSync(join(t, "e.txt"), "utf8") + readFileSync(join(t, "l.txt"), "utf8") }); rmSync(t, { recursive: true }); },\n' +
      '  closeBundle() { mkdirSync(out, { recursive: true }); copyFileSync("node_modules/fakecopy/x.txt", join(out, "x.txt")); cpSync("node_modules/fakecp", join(out, "cp"), { recursive: true }); },\n' +
      "}] };\n",
  });
  assert.deepEqual(r.made, ["fakecopy 1.0.0 GPL-3.0", "fakecp 1.0.0 GPL-3.0", "fakeemitcp 1.0.0 GPL-3.0", "fakelinkcp 1.0.0 GPL-3.0"]);
  assert.deepEqual(r.failures, []);
});

test("a thread started during the build stops it", unix, async () => {
  const r = await pageBuild({
    "src/main.js": "console.log(__THREAD__);\n",
    "node_modules/fakethread/x.txt": "made-up thread\n",
    "vite.config.ts": 'import { Worker } from "node:worker_threads";\n' +
      "const text = await new Promise((ok) => { const w = new Worker('require(\"node:worker_threads\").parentPort.postMessage(require(\"node:fs\").readFileSync(\"node_modules/fakethread/x.txt\", \"utf8\"))', { eval: true }); w.on(\"message\", (m) => { ok(m); w.terminate(); }); });\n" +
      "export default { define: { __THREAD__: JSON.stringify(text) } };\n",
  });
  assert.deepEqual(r.made, []);
  assert.equal(r.failures.length, 1);
  assert.match(r.failures[0], /the build started a thread \(require\("node:worker_threads"\).*whose reads this script doesn't hear/);
});

test("a process the build starts stops it, unless it is one the page's build is known to start", unix, async () => {
  const r = await pageBuild({
    "src/main.js": "console.log(__CAT__);\n",
    "node_modules/fakecat/x.txt": "made-up process\n",
    "vite.config.ts": 'import { execSync } from "node:child_process";\n' +
      'export default { define: { __CAT__: JSON.stringify(execSync("cat node_modules/fakecat/x.txt", { encoding: "utf8" })) } };\n',
  });
  assert.deepEqual(r.made, []);
  assert.deepEqual(r.failures.map((f) => f.replace(/^MyOrbiter's page: /, "")), [
    "the build started a process this script doesn't know, whose reads it doesn't hear: cat node_modules/fakecat/x.txt",
  ]);
  // MyOrbiter's own config starts one, its build stamp.
  assert.match(readFileSync("vite.config.ts", "utf8"), new RegExp(`execSync\\("${PROGRAMS.myorbiter.page.commands[0]}"`));
});

test("a public folder that is a package's, or holds a link into one, is in the page", unix, async () => {
  const dir = await pageBuild({
    "src/main.js": "console.log(1);\n",
    "node_modules/fakepubdir/p.txt": "made-up public folder\n",
    "vite.config.ts": 'export default { publicDir: "node_modules/fakepubdir" };\n',
  });
  assert.deepEqual(dir.made, ["fakepubdir 1.0.0 GPL-3.0"]);
  assert.deepEqual(dir.failures, []);
  const linked = await pageBuild({
    "src/main.js": "console.log(1);\n",
    "public/own.txt": "the page's own\n",
    "node_modules/fakepub/p.txt": "made-up public file\n",
    "node_modules/fakepubtree/d/q.txt": "made-up public folder\n",
  }, false, { "public/p.txt": "node_modules/fakepub/p.txt", "public/tree": "node_modules/fakepubtree" });
  assert.deepEqual(linked.made, ["fakepub 1.0.0 GPL-3.0", "fakepubtree 1.0.0 GPL-3.0"]);
  assert.deepEqual(linked.failures, []);
});

test("a package the build loads that is no known tool's stops it: the config's import or require, a plugin, a link outside the page; a package's file bundled into the config is in the page", unix, async () => {
  const outside = mkdtempSync(join(tmpdir(), "dependency-licences-"));
  writeFileSync(join(outside, "package.json"), JSON.stringify({ name: "fakeout", version: "1.0.0", license: "GPL-3.0", type: "module", main: "index.js" }));
  writeFileSync(join(outside, "index.js"), 'export const out = "made-up outside";\n');
  try {
    const r = await pageBuild({
      "src/main.js": "console.log(__LOADED__, __REQUIRED__, __BUNDLED__, __REL__, __OUT__);\n",
      "node_modules/fakeloaded/index.js": 'export const text = "made-up loaded";\n',
      "node_modules/fakerequired/data.json": '{"m":"made-up required"}\n',
      "node_modules/fakebundled/d.json": '{"m":"made-up bundled"}\n',
      "node_modules/fakerel/index.js": 'export const rel = "made-up relative";\n',
      "node_modules/fakeplugin/index.js": 'export default () => ({ name: "made-up-plugin" });\n',
      "vite.config.ts": 'import { text } from "fakeloaded";\nimport plugin from "fakeplugin";\nimport { createRequire } from "node:module";\n' +
        'import bundled from "fakebundled/d.json" with { type: "json" };\nimport { rel } from "./node_modules/fakerel/index.js";\nimport { out } from "fakeout";\n' +
        'const required = createRequire(import.meta.url)("fakerequired/data.json");\n' +
        "export default { plugins: [plugin()], define: { __LOADED__: JSON.stringify(text), __REQUIRED__: JSON.stringify(required.m), __BUNDLED__: JSON.stringify(bundled.m), __REL__: JSON.stringify(rel), __OUT__: JSON.stringify(out) } };\n",
    }, false, { "node_modules/fakeout": outside });
    assert.deepEqual(r.made, ["fakebundled 1.0.0 GPL-3.0", "fakerel 1.0.0 GPL-3.0"]);
    const loaded = r.failures.map((f) => / loaded (?:the package in )?(\S+?),/.exec(f)?.[1]?.replace(/.*\/node_modules\//, "").replace(/.*\/(dependency-licences-[^/]+)\/index\.js$/, "outside")).sort();
    assert.deepEqual(loaded, ["fakeloaded", "fakeplugin", "fakerequired", "outside"]);
    assert.equal(r.failures.length, 4);
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});

test("the build's known tools are the page's own, with every package they use, and peer dependencies left to the page", () => {
  const tools = knownTools(process.cwd(), PROGRAMS.myorbiter.page.tools);
  const has = (name: string) => [...tools].some((d) => d.endsWith(`/node_modules/${name}`));
  for (const name of ["vite", "@sveltejs/vite-plugin-svelte", "svelte", "rolldown", "lightningcss", "vitefu", "acorn"]) assert.ok(has(name), name);
  // A page's own packages that no tool uses, and the preprocessors (a peer of Vite's), are not tools.
  for (const name of ["@fontsource/ibm-plex-mono", "@tauri-apps/api", "sass", "less"]) assert.ok(!has(name), name);
  assert.deepEqual(PROGRAMS.tennoscope.page.tools, ["vite", "vitest", "@vitejs/plugin-react"]);
  assert.match(readFileSync("tennoscope/app/vite.config.ts", "utf8"), /from 'vitest\/config'\nimport react from '@vitejs\/plugin-react'\n/);
});

test("a page with a CSS preprocessor installed stops: it reads what a style imports out of sight", unix, async () => {
  const repo = mkdtempSync(join(tmpdir(), "dependency-licences-"));
  mkdirSync(join(repo, "node_modules", "sass"), { recursive: true });
  symlinkSync(join(process.cwd(), "node_modules", "vite"), join(repo, "node_modules", "vite"));
  writeFileSync(join(repo, "node_modules", "sass", "package.json"), '{"name":"sass","version":"1.0.0"}');
  try {
    const page = await readPage("myorbiter", repo);
    assert.deepEqual(page.packages, []);
    assert.match(page.failures.join("\n"), /a CSS preprocessor is installed for it \(sass\)/);
    assert.ok(PREPROCESSORS.includes("sass-embedded"));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("under pnpm's layout, a CSS preprocessor only another package depends on stops it too, where Vite would find it", unix, async () => {
  // A made-up pnpm layout: the page's node_modules/vite links into the hidden store; a preprocessor
  // that only another package depends on sits beside Vite in its store folder, or in the store's
  // shared node_modules/.pnpm/node_modules, both found from Vite's own folder, not the page's.
  for (const [where, name] of [["node_modules/.pnpm/node_modules", "sass"], ["node_modules/.pnpm/vite@8.3.5/node_modules", "less"]]) {
    const repo = mkdtempSync(join(tmpdir(), "dependency-licences-"));
    const app = join(repo, "tennoscope", "app");
    const store = join(app, "node_modules", ".pnpm", "vite@8.3.5", "node_modules", "vite");
    mkdirSync(join(store, "dist", "node"), { recursive: true });
    writeFileSync(join(store, "package.json"), '{"name":"vite","version":"8.3.5"}');
    symlinkSync(store, join(app, "node_modules", "vite"));
    mkdirSync(join(app, where, name), { recursive: true });
    writeFileSync(join(app, where, name, "package.json"), `{"name":"${name}","version":"1.0.0"}`);
    try {
      const page = await readPage("tennoscope", repo);
      assert.deepEqual(page.packages, []);
      assert.deepEqual(page.failures, [`TennoScope's page: a CSS preprocessor is installed for it (${name}), which reads what a style imports where this script can't see, so the page can't be read`]);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }
});

test("pnpm-lock.yaml's resolutions are read per package", () => {
  const lock = `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      react:
        specifier: ^19.3.1
        version: 19.3.1

packages:

  '@tauri-apps/api@2.12.4':
    resolution: {integrity: sha512-abc}

  react@19.3.1:
    resolution: {integrity: sha512-def}
    engines: {node: '>=0.10.0'}

  made-up@1.0.0:
    resolution: {tarball: https://example.com/made-up.tgz}

snapshots:

  react@19.3.1: {}
`;
  assert.deepEqual([...pnpmResolutions(lock)], [
    ["@tauri-apps/api@2.12.4", "{integrity: sha512-abc}"],
    ["react@19.3.1", "{integrity: sha512-def}"],
    ["made-up@1.0.0", "{tarball: https://example.com/made-up.tgz}"],
  ]);
});

// ---------------------------------------------------------------- the list in a download

const listed = (): { dir: string; packages: Package[] } => {
  const dir = mkdtempSync(join(tmpdir(), "dependency-licences-"));
  const shared = { file: "LICENSE-MIT", sha256: "d".repeat(64), licence: true };
  const packages: Package[] = [
    crate("zeta", "1.0.0", "MIT", { texts: [shared] }),
    crate("alpha", "0.2.0", "MIT OR Apache-2.0", { texts: [shared, APACHE] }),
    crate("bare", "0.1.0", "MIT", { texts: [] }),
    crate("borrow", "0.1.0", "Apache-2.0", { texts: [] }),
    { ...crate("@scope/page", "3.0.0", "MIT", { texts: [{ file: "LICENSES/MIT.txt", sha256: "e".repeat(64), licence: true }] }), kind: "npm" },
  ];
  const { failures, supplied } = gate(packages, allowed, { crates: [
    entry({ name: "bare", version: "0.1.0", licence: "MIT", upstream: "https://example.com/bare" }),
    entry({ name: "borrow", version: "0.1.0", text: { sha256: APACHE.sha256 }, used: "Apache-2.0", why: "Apache-2.0's text has no line to fill." }),
  ] });
  assert.deepEqual(failures, []);
  const { list, files } = renderList("tennoscope", "x86_64-pc-windows-msvc", packages, supplied);
  mkdirSync(join(dir, "texts"));
  for (const f of files) writeFileSync(join(dir, f.name), f.sha256);
  writeFileSync(join(dir, "README.md"), list);
  return { dir, packages };
};

test("the list names each package with its licence and texts, one copy per text", () => {
  const { dir } = listed();
  const list = readFileSync(join(dir, "README.md"), "utf8");
  assert.match(list, /^# The packages compiled into TennoScope for Windows\n\nProgram: tennoscope\nTarget: x86_64-pc-windows-msvc\nPackages: 5 \(4 Rust crates, 1 npm packages\)\n/);
  assert.match(list, /\n\| alpha \| 0\.2\.0 \| Rust crate \| MIT OR Apache-2\.0 \| `texts\/LICENSE-MIT-dddddddddd`, `texts\/LICENSE-APACHE-cccccccccc` \|\n/);
  assert.match(list, /\n\| zeta \| 1\.0\.0 \| Rust crate \| MIT \| `texts\/LICENSE-MIT-dddddddddd` \|\n/);
  assert.match(list, /\n\| @scope\/page \| 3\.0\.0 \| npm package \| MIT \| `texts\/LICENSES_MIT-eeeeeeeeee\.txt` \|\n/);
  assert.match(list, /\n\| bare \| 0\.1\.0 \| Rust crate \| MIT \| none in its source \(below\) \|\n/);
  assert.match(list, /\n\| borrow \| 0\.1\.0 \| Rust crate \| Apache-2\.0 \| none in its source; `texts\/LICENSE-APACHE-cccccccccc` \(below\) \|\n/);
  assert.match(list, /\n\| bare \| 0\.1\.0 \| MIT \| No text: its published source carries none, and none is carried here\. The licence its manifest names is MIT, and the repository it names is https:\/\/example\.com\/bare\. \|\n/);
  assert.match(list, /\n\| borrow \| 0\.1\.0 \| Apache-2\.0 \| `texts\/LICENSE-APACHE-cccccccccc`, alpha 0\.2\.0's LICENSE-APACHE unchanged: Apache-2\.0's text has no line to fill\. \|\n/);
  for (const words of ["The Rust standard library", "Code a package carries inside itself", "C and C++ sources inside crates", "What isn't a package"]) {
    assert.ok(list.includes(words), words);
  }
  assert.deepEqual(checkList(dir, "tennoscope", "x86_64-pc-windows-msvc"), []);
  rmSync(dir, { recursive: true });
});

test("the check stops at another program's or system's list, a missing text, or a short table", () => {
  const { dir } = listed();
  assert.match(checkList(dir, "myorbiter", "x86_64-pc-windows-msvc").join("\n"), /not the list of myorbiter/);
  assert.match(checkList(dir, "tennoscope", "x86_64-unknown-linux-gnu").join("\n"), /not the list for x86_64-unknown-linux-gnu/);
  rmSync(join(dir, "texts/LICENSE-APACHE-cccccccccc"));
  assert.match(checkList(dir, "tennoscope", "x86_64-pc-windows-msvc").join("\n"), /names texts\/LICENSE-APACHE-cccccccccc, which isn't there/);
  const file = join(dir, "README.md");
  writeFileSync(file, readFileSync(file, "utf8").replace(/\n\| zeta [^\n]*/, ""));
  assert.match(checkList(dir, "tennoscope", "x86_64-pc-windows-msvc").join("\n"), /lists 4 packages, says 5/);
  rmSync(join(dir, "README.md"));
  assert.match(checkList(dir, "tennoscope", "x86_64-pc-windows-msvc").join("\n"), /no README\.md/);
  rmSync(dir, { recursive: true });
});

test("the command: --check on a whole list passes, an unknown program or target stops", async () => {
  const { dir } = listed();
  assert.equal(await main(["--check", dir, "tennoscope", "x86_64-pc-windows-msvc"]), 0);
  assert.equal(await main(["--check", dir, "tennoscope", "x86_64-unknown-linux-gnu"]), 1);
  await assert.rejects(main(["orbiter", "x86_64-unknown-linux-gnu"]), /usage/);
  await assert.rejects(main(["myorbiter", "aarch64-apple-darwin"]), /not one this builds for/);
  await assert.rejects(main(["myorbiter"], {}), /no target/);
  rmSync(dir, { recursive: true });
});

test("an argument it doesn't know stops it, before it reads anything", async () => {
  for (const argv of [
    ["myorbiter", "x86_64-unknown-linux-gnu", "--allowed scripts/other.txt"],
    ["myorbiter", "x86_64-unknown-linux-gnu", "--allowed=scripts/other.txt"],
    ["myorbiter", "x86_64-unknown-linux-gnu", "--dry-run"],
    ["myorbiter", "-o", "/tmp/x"],
  ]) await assert.rejects(main(argv), /no such argument/, argv.join(" "));
  await assert.rejects(main(["myorbiter", "x86_64-unknown-linux-gnu", "--no-text"]), /--no-text needs a value/);
  await assert.rejects(main(["myorbiter", "--out", "--allowed", "a.txt"]), /--out needs a value/);
  await assert.rejects(main(["myorbiter", "--out", "a", "--out", "b"]), /--out given twice/);
  await assert.rejects(main(["myorbiter", "x86_64-unknown-linux-gnu", "extra"]), /one program and one target at most/);
  await assert.rejects(main(["--check", "/tmp/x", "myorbiter", "x86_64-unknown-linux-gnu", "--out", "y"]), /--check takes no other option/);
});

test("the usage line and docs/maintaining.md name every argument it takes", async () => {
  const usage = await main([]).then(() => "", (e: Error) => e.message);
  const docs = readFileSync("docs/maintaining.md", "utf8").split("## The dependencies' licences")[1].split("\n## ")[0];
  for (const a of ["--out <folder>", "--allowed <file>", "--no-text <file>", "--check <folder>", "<target>"]) {
    assert.ok(usage.includes(a), `usage: ${a}`);
    assert.ok(docs.includes(a), `docs: ${a}`);
  }
  // What the no-text file can hold today, and what it can't; `from` only when it's given.
  for (const words of ["`null`", "`from`", "needs a change to the script"]) assert.ok(docs.includes(words), words);
  assert.match(docs, /optional `from`/);
  assert.doesNotMatch(docs, /`from`, the package that must ship it\)/);
});

test("the messages name the allowed list and no-text file the run was given, and --check's own form", async () => {
  const p = crate("made-up", "1.0.0", "GPL-3.0", { texts: [] });
  assert.deepEqual(gate([p], allowed, noText, { allowed: "/tmp/other-allowed.txt", noText: "/tmp/other-no-text.json" }).failures, [
    'made-up 1.0.0 (Rust crate): "GPL-3.0" is not allowed by /tmp/other-allowed.txt',
    "made-up 1.0.0 (Rust crate): no licence text in its source, and none in /tmp/other-no-text.json",
  ]);
  assert.throws(() => readAllowed("mit or apache\n", "/tmp/other-allowed.txt"), /^Error: \/tmp\/other-allowed\.txt: "mit or apache"/);
  // Without names, the repository's own files.
  assert.match(gate([p], allowed, noText).failures[0], /not allowed by scripts\/dependency-licences-allowed\.txt$/);
  await assert.rejects(main(["--check", "/tmp/x", "myorbiter"], { TAURI_ENV_TARGET_TRIPLE: "x86_64-unknown-linux-gnu" }),
    /no target, or not one this builds for: \(none: --check takes the target after the program\)/);
});

// ---------------------------------------------------------------- where the builds run it

test("every build runs it for each program before the download is packed", () => {
  const bundle = JSON.parse(readFileSync("src-tauri/tauri.bundle.json", "utf8"));
  assert.equal(bundle.build.beforeBundleCommand, "node scripts/dependency-licences.mjs myorbiter");
  const build = readFileSync("ci/build.sh", "utf8");
  assert.match(build, /\nscripts\/tennoscope-notice\.sh vendor\/tennoscope\n(?:#[^\n]*\n)*node scripts\/dependency-licences\.mjs tennoscope x86_64-unknown-linux-gnu\n/);
  assert.match(build, /\n {2}scripts\/tennoscope-notice\.sh vendor\/tennoscope\n {2}node scripts\/dependency-licences\.mjs tennoscope "\$win"\n/);
  const release = readFileSync(".github/workflows/release.yml", "utf8");
  assert.match(release, /\n {10}scripts\/tennoscope-notice\.sh vendor\/tennoscope\n(?: {10}#[^\n]*\n)* {10}node scripts\/dependency-licences\.mjs tennoscope x86_64-pc-windows-msvc\n/);
  assert.equal(release.match(/dependency-licences\.mjs/g)?.length, 2, "one call, one comment");
  assert.ok(readFileSync(".gitignore", "utf8").includes("\n/THIRD-PARTY-NOTICES/dependencies/\n"));
  assert.ok(ALLOWED_FILE && NO_TEXT_FILE);
});
