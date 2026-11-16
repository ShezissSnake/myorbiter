// scripts/dependency-licences.mjs: the licence expressions, the allowed list, the gate, the list a
// download carries, and the files the build reads. Made-up packages only: nothing here runs cargo
// or Vite (a release build runs the script on the real ones).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ALLOWED_FILE, NO_TEXT_FILE, checkList, gate, licenceAllowed, main, packageDir, parseCargoTree, parseExpression,
  pnpmResolutions, readAllowed, renderList, type NoTextEntry, type Package,
} from "../scripts/dependency-licences.mjs";

const allowed = readAllowed(readFileSync(ALLOWED_FILE, "utf8"));
const ok = (e: string | null) => licenceAllowed(e, allowed).allowed;
const why = (e: string | null) => {
  const r = licenceAllowed(e, allowed);
  return r.allowed ? "" : r.why;
};

// ---------------------------------------------------------------- point 1: the allowed list

test("the allowed list is the first round's licences, and no other", () => {
  assert.deepEqual([...allowed].sort(), [
    "0BSD", "Apache-2.0", "Apache-2.0 WITH LLVM-exception", "BSD-2-Clause", "BSD-3-Clause", "BSL-1.0", "CC0-1.0",
    "CDLA-Permissive-2.0", "ISC", "MIT", "MIT-0", "MPL-2.0", "OFL-1.1", "Unicode-3.0", "Unlicense", "Zlib",
  ]);
  // In the first round's definition of the common licences, but in no package it found.
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

// ---------------------------------------------------------------- point 3: the gate

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

// ---------------------------------------------------------------- point 5: the 13 crates

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

// ---------------------------------------------------------------- point 2: what a build gives

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

// ---------------------------------------------------------------- point 4: the list in a download

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

// ---------------------------------------------------------------- point 7: where the builds run it

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
