#!/usr/bin/env node
// The third-party packages compiled into one program for one system, each with its name, version,
// licence and licence texts, read from what the build itself has unpacked (cargo's registry folder,
// the page's node_modules), with no request: and the gate that stops the build when one of them
// has no licence, a licence scripts/dependency-licences-allowed.txt doesn't allow, a source other
// than the registry, or no licence text and nothing in scripts/dependency-licences-no-text.json.
//
//   node scripts/dependency-licences.mjs <myorbiter|tennoscope> [<target>] [--out <folder>]
//       [--allowed <file>] [--no-text <file>]
//   node scripts/dependency-licences.mjs --check <folder> <myorbiter|tennoscope> <target>
//
// The first form runs after the program is compiled, before it's packed: MyOrbiter's as Tauri's
// beforeBundleCommand (src-tauri/tauri.bundle.json; Tauri gives it the target as
// TAURI_ENV_TARGET_TRIPLE), TennoScope's once it's put in vendor/tennoscope/ (ci/build.sh, the
// Release workflow). It writes the list (README.md) and the texts (texts/) into the folder, by
// default THIRD-PARTY-NOTICES/dependencies/ for MyOrbiter and
// vendor/tennoscope/THIRD-PARTY-NOTICES/dependencies/ for TennoScope, after emptying it; when the
// gate stops, it names every package that stops it and leaves no folder. The second form checks a
// folder as a download carries it (the .deb check in ci/build.sh).
//
// The packages: the Rust crates `cargo tree` gives for the program's package on that target through
// normal dependencies, without procedural macros (what is compiled into the program; build scripts,
// macros and test-only crates are not), and the npm packages whose code, CSS or files the page's
// Vite build writes into the page. The program's own workspace crates are left out.
import { createHash } from "node:crypto";
import childProcess, { spawnSync } from "node:child_process";
import fs from "node:fs";
import * as nodeModule from "node:module";
import workerThreads from "node:worker_threads";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SELF = fileURLToPath(import.meta.url).replace(/\\/g, "/");
export const ALLOWED_FILE = "scripts/dependency-licences-allowed.txt";
export const NO_TEXT_FILE = "scripts/dependency-licences-no-text.json";

/**
 * The processes a page's build may start: each by its exact command line, each shown to read no
 * package's file, and each only on the system that starts it (`any`, or a `process.platform`): the
 * system the build runs on, as Vite tells them apart, so a Windows half cross-built on Linux starts
 * none of Windows'.
 */
const commandsOn = (lines, system = process.platform) => [...(lines.any ?? []), ...(lines[system] ?? [])];
// Vite on Windows, the first time it takes a path to its real one (the page's root, in every build:
// resolveConfig), runs `net use` and reads its answer, the network drives this machine has mapped,
// to give a mapped drive's path by its letter (node_modules/vite/dist/node/chunks/node.js,
// optimizeSafeRealPathSync). Its own output, no file: both pages build with that Vite.
const VITE_ON_WINDOWS = ["net use"];

export const PROGRAMS = {
  myorbiter: {
    name: "MyOrbiter", cargo: ".", pkg: "myorbiter",
    page: {
      root: ".", config: "vite.config.ts", lock: "npm", install: "npm ci",
      // The build's known tools: what may run while the page builds, with every package they use
      // (knownTools). Added to by hand, in the same change that adds a tool to the page's build.
      tools: ["vite", "@sveltejs/vite-plugin-svelte", "svelte"],
      // The processes it may start: vite.config.ts's build stamp; Vite's, on Windows.
      commands: commandsOn({ any: ["git log -1 --format=%h%x20%cs"], win32: VITE_ON_WINDOWS }),
    },
    out: "THIRD-PARTY-NOTICES/dependencies",
  },
  tennoscope: {
    name: "TennoScope", cargo: "tennoscope", pkg: "tennoscope",
    page: {
      root: "tennoscope/app", config: "tennoscope/app/vite.config.ts", lock: "pnpm", install: "pnpm install --frozen-lockfile in tennoscope/app",
      tools: ["vite", "vitest", "@vitejs/plugin-react"],
      commands: commandsOn({ win32: VITE_ON_WINDOWS }),
    },
    out: "vendor/tennoscope/THIRD-PARTY-NOTICES/dependencies",
  },
};
export const TARGETS = { "x86_64-unknown-linux-gnu": "Linux", "x86_64-pc-windows-msvc": "Windows" };

// ------------------------------------------------------------------ licence expressions

/**
 * An SPDX licence expression as a tree, read as written: `OR` and the old `/` are a choice, `AND`
 * binds tighter than either, `WITH` tighter than `AND`, and parentheses group. Anything else (an
 * operator in lower case, a stray parenthesis, two ids side by side, an empty expression) is an
 * Error: an expression that isn't understood never passes.
 */
export function parseExpression(text) {
  if (typeof text !== "string" || !text.trim()) throw new Error("no licence expression");
  const tokens = text.match(/\(|\)|\/|[^\s()/]+/g) ?? [];
  const ID = /^[A-Za-z0-9][A-Za-z0-9.+-]*$/;
  let i = 0;
  const peek = () => tokens[i];
  const fail = (why) => { throw new Error(`"${text}" is not understood: ${why}`); };
  function choice() {
    const sides = [all()];
    while (peek() === "OR" || peek() === "/") { i++; sides.push(all()); }
    return sides.length === 1 ? sides[0] : { or: sides };
  }
  function all() {
    const sides = [term()];
    while (peek() === "AND") { i++; sides.push(term()); }
    return sides.length === 1 ? sides[0] : { and: sides };
  }
  function term() {
    const t = tokens[i++];
    if (t === undefined) fail("it ends where a licence was expected");
    if (t === "(") {
      const inner = choice();
      if (tokens[i++] !== ")") fail("a parenthesis isn't closed");
      return inner;
    }
    if (t === ")" || t === "/" || t === "AND" || t === "OR" || t === "WITH") fail(`"${t}" where a licence was expected`);
    if (!ID.test(t)) fail(`"${t}" isn't a licence id`);
    if (peek() === "WITH") {
      i++;
      const exception = tokens[i++];
      if (exception === undefined || !ID.test(exception)) fail("WITH has no exception after it");
      return { id: t, with: exception };
    }
    return { id: t };
  }
  const tree = choice();
  if (i < tokens.length) fail(`"${tokens[i]}" after a complete expression`);
  return tree;
}

/** The allowed list: one licence id, or "<id> WITH <exception>", per line; # starts a comment. */
export function readAllowed(text, name = ALLOWED_FILE) {
  const allowed = new Set();
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^([A-Za-z0-9][A-Za-z0-9.+-]*)(?: WITH ([A-Za-z0-9][A-Za-z0-9.+-]*))?$/.exec(line);
    if (!m) throw new Error(`${name}: "${line}" is neither a licence id nor "<id> WITH <exception>"`);
    allowed.add(line);
  }
  return allowed;
}

/** Whether a parsed expression is allowed: a choice when one side is, an AND when every side is. */
export function treeAllowed(tree, allowed) {
  if (tree.or) return tree.or.some((t) => treeAllowed(t, allowed));
  if (tree.and) return tree.and.every((t) => treeAllowed(t, allowed));
  return allowed.has(tree.with ? `${tree.id} WITH ${tree.with}` : tree.id);
}

/** { allowed: true } or { allowed: false, why }: an expression not understood is not allowed. */
export function licenceAllowed(expression, allowed, name = ALLOWED_FILE) {
  let tree;
  try {
    tree = parseExpression(expression);
  } catch (e) {
    return { allowed: false, why: e.message };
  }
  return treeAllowed(tree, allowed) ? { allowed: true } : { allowed: false, why: `"${expression}" is not allowed by ${name}` };
}

// ------------------------------------------------------------------ the gate

/** A licence text file at the top of a package's folder; NOTICE files are carried but don't count. */
export const isLicenceText = (name) => /^(licen[cs]e|copying|copyright|unlicen[cs]e)/i.test(name);
export const isNotice = (name) => /^notice/i.test(name);

/**
 * The gate. `packages`: { kind: "rust" | "npm", name, version, licence (the expression, or null),
 * licenceForm (why there is no expression, when there isn't), source ("registry", or what it is),
 * texts: [{ file, sha256, licence: bool }] }. `noText`: the parsed no-text file. Returns the
 * failures (one line per package, naming it) and, per package that ships no text, what the
 * download carries for it: { name, version, carry: { from, file, sha256 } | null, entry }.
 */
export function gate(packages, allowed, noText, names = { allowed: ALLOWED_FILE, noText: NO_TEXT_FILE }) {
  const failures = [];
  const supplied = [];
  const byHash = new Map();
  for (const p of packages) {
    for (const t of p.texts) {
      if (!byHash.has(t.sha256)) byHash.set(t.sha256, []);
      byHash.get(t.sha256).push({ from: p, file: t.file });
    }
  }
  const named = (p) => `${p.name} ${p.version} (${p.kind === "rust" ? "Rust crate" : "npm package"})`;
  for (const p of packages) {
    const why = [];
    if (p.source !== "registry") why.push(`its source is not the registry: ${p.source}`);
    if (!p.licence) why.push(`no licence${p.licenceForm ? `: ${p.licenceForm}` : ""}`);
    else {
      const a = licenceAllowed(p.licence, allowed, names.allowed);
      if (!a.allowed) why.push(a.why);
    }
    if (!p.texts.some((t) => t.licence)) {
      const entry = p.kind === "rust" ? noText.crates.find((c) => c.name === p.name && c.version === p.version) : undefined;
      if (!entry) why.push(`no licence text in its source, and none in ${names.noText}`);
      else if (entry.licence !== p.licence) why.push(`${names.noText} has it as "${entry.licence}", its manifest says "${p.licence}"`);
      else if (entry.text === null) supplied.push({ name: p.name, version: p.version, carry: null, entry });
      else {
        const found = (byHash.get(entry.text.sha256) ?? []).find((h) => h.from !== p && (!entry.text.from || h.from.name === entry.text.from));
        if (!found) why.push(`the text ${names.noText} gives it (${entry.text.from ?? "any package"}, SHA-256 ${entry.text.sha256.slice(0, 12)}…) is in no package of this build`);
        else supplied.push({ name: p.name, version: p.version, carry: { from: found.from, file: found.file, sha256: entry.text.sha256 }, entry });
      }
    }
    for (const w of why) failures.push(`${named(p)}: ${w}`);
  }
  return { failures, supplied };
}

// ------------------------------------------------------------------ the list

const cell = (s) => String(s).replace(/\|/g, "\\|");

/**
 * The list a download carries (README.md), and the texts to copy beside it: { list, files: [{ name,
 * from (the package), file, sha256 }] }, one file per distinct text, named after the first package
 * that ships it.
 */
export function renderList(program, target, packages, supplied) {
  const prog = PROGRAMS[program];
  const system = TARGETS[target];
  const names = new Map(); // sha256 -> texts/<name>
  const files = [];
  const textName = (p, t) => {
    if (!names.has(t.sha256)) {
      // Named by the file and its content, since one file can be several packages' text.
      const [, base, ext] = /^(.*?)((?:\.(?:md|txt|markdown|rst|spdx))?)$/i.exec(t.file.replace(/[/\\]/g, "_"));
      const name = `texts/${base}-${t.sha256.slice(0, 10)}${ext}`;
      names.set(t.sha256, name);
      files.push({ name, from: p, file: t.file, sha256: t.sha256 });
    }
    return names.get(t.sha256);
  };
  const rust = packages.filter((p) => p.kind === "rust");
  const npm = packages.filter((p) => p.kind === "npm");
  const order = (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version, undefined, { numeric: true });
  const rows = [...rust.sort(order), ...npm.sort(order)].map((p) => {
    const own = p.texts.map((t) => `\`${textName(p, t)}\``);
    const s = supplied.find((x) => x.name === p.name && x.version === p.version);
    const texts = own.length ? own.join(", ")
      : s?.carry ? `none in its source; \`${textName(s.carry.from, { file: s.carry.file, sha256: s.carry.sha256 })}\` (below)`
      : "none in its source (below)";
    return `| ${cell(p.name)} | ${cell(p.version)} | ${p.kind === "rust" ? "Rust crate" : "npm package"} | ${cell(p.licence)} | ${texts} |`;
  });
  const noTextRows = [...supplied].sort(order).map((s) => {
    const p = packages.find((x) => x.name === s.name && x.version === s.version);
    const what = s.carry
      ? `\`${names.get(s.carry.sha256)}\`, ${s.carry.from.name} ${s.carry.from.version}'s ${s.carry.file} unchanged${s.entry.used !== p.licence ? `, for ${s.entry.used}` : ""}: ${s.entry.why}`
      : `No text: its published source carries none, and none is carried here. The licence its manifest names is ${p.licence}, and the repository it names is ${s.entry.upstream}.`;
    return `| ${cell(s.name)} | ${cell(s.version)} | ${cell(p.licence)} | ${cell(what)} |`;
  });
  const list = `# The packages compiled into ${prog.name} for ${system}

Program: ${program}
Target: ${target}
Packages: ${packages.length} (${rust.length} Rust crates, ${npm.length} npm packages)

Every third-party package compiled into this program, made when this download was built
(\`scripts/dependency-licences.mjs\` in ${prog.name === "MyOrbiter" ? "the" : "MyOrbiter's"} source) from the packages the build itself
unpacked: the Rust crates the program is compiled from, and the npm packages whose code, styles or
files are in the page it shows. Each is under the licence its own manifest names (\`license\` in its
\`Cargo.toml\` or \`package.json\`), written here as the manifest writes it: \`OR\`, or the older
\`/\`, is a choice between licences, and \`AND\` means all of them. Its licence texts are the files
its own published source carries, unchanged, in \`texts/\`, each named after the file and the
start of its SHA-256: packages that ship the same file share one copy.

## What this list does not cover

- The Rust standard library (\`std\`, \`core\`, \`alloc\` and what they are built from), which the
  Rust toolchain compiles into every program: it is in no lockfile, so it isn't listed.
- Code a package carries inside itself: each package is listed with its own licence only, not
  with that of a copy of another library inside it (for example the copy of \`tslib\` inside
  \`@tauri-apps/api\`).
- C and C++ sources inside crates (the \`-sys\` crates, \`ring\`'s C and assembly, a C header a
  crate bundles): only the crate's own licence is listed.
- What isn't a package: the system libraries an AppImage carries (\`SOURCES.md\` and \`linux/\`
  beside MyOrbiter's notices), Tesseract and its libraries (\`THIRD-PARTY-NOTICES/tesseract/\` in
  TennoScope's folder), WebView2's installer on Windows, and the files that aren't programs
  (\`NOTICE.md\`).
- Packages used only to build or test the program: build scripts, procedural macros, and Vite
  and its plugins, apart from the helpers Vite writes into the page.

## The packages

| Package | Version | Kind | Licence | Licence texts |
|---|---|---|---|---|
${rows.join("\n")}
${noTextRows.length ? `
## Packages whose published source carries no licence text

| Package | Version | Licence | What this download carries for it |
|---|---|---|---|
${noTextRows.join("\n")}
` : ""}`;
  return { list, files };
}

/** Problems with a list folder as a download carries it; empty when it's whole. */
export function checkList(dir, program, target) {
  const problems = [];
  const file = join(dir, "README.md");
  if (!existsSync(file)) return [`${dir}: no README.md (the list)`];
  const text = readFileSync(file, "utf8");
  if (!text.includes(`\nProgram: ${program}\n`)) problems.push(`${file}: not the list of ${program}`);
  if (!text.includes(`\nTarget: ${target}\n`)) problems.push(`${file}: not the list for ${target}`);
  const count = Number(/\nPackages: (\d+) /.exec(text)?.[1] ?? 0);
  const table = text.split("\n## The packages\n")[1]?.split("\n## ")[0] ?? "";
  const rows = table.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| Package |")).length;
  if (count === 0 || rows !== count) problems.push(`${file}: lists ${rows} packages, says ${count}`);
  for (const name of new Set(text.match(/texts\/[^`\s|]+/g) ?? [])) {
    if (!existsSync(join(dir, name))) problems.push(`${file}: names ${name}, which isn't there`);
  }
  return problems;
}

// ------------------------------------------------------------------ reading a build

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

/** Licence text and NOTICE files at the top of a package's folder (or in a LICENSE(S) folder). */
export function readTexts(dir, extra = []) {
  const texts = [];
  for (const e of readdirSync(dir).sort()) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isFile() && (isLicenceText(e) || isNotice(e))) texts.push({ file: e, path: p, licence: isLicenceText(e) });
    else if (st.isDirectory() && /^licen[cs]es?$/i.test(e)) {
      for (const f of readdirSync(p).sort()) if (statSync(join(p, f)).isFile()) texts.push({ file: `${e}/${f}`, path: join(p, f), licence: true });
    }
  }
  for (const f of extra) if (!texts.some((t) => t.file === f) && existsSync(join(dir, f))) texts.push({ file: f, path: join(dir, f), licence: true });
  return texts.map((t) => ({ ...t, sha256: sha256(t.path) }));
}

/**
 * `cargo tree --format '{p}|{l}'` lines: { name, version, source (null for the registry), licence }.
 * A line it can't read stops it, so no crate is left out of the list unread: a colour code (or any
 * other control character) among them, since cargo is asked for none (readRust).
 */
export function parseCargoTree(text) {
  const seen = new Map();
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd().replace(/ \(\*\)$/, "");
    if (line === "") continue;
    const m = /[\x00-\x1f\x7f]/.test(line) ? null : /^(\S+) v(\S+)(?: \((.*)\))?\|(.*)$/.exec(line);
    if (!m) throw new Error(`cargo tree printed a line this script can't read, so it can't list that crate: ${JSON.stringify(line)}`);
    const [, name, version, source, licence] = m;
    seen.set(`${name} ${version} ${source ?? ""}`, { name, version, source: source ?? null, licence: licence.trim() || null });
  }
  return [...seen.values()];
}

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 1 << 28, shell: false });
  if (r.error) throw new Error(`${cmd} ${args.join(" ")}: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed (in ${relative(REPO, cwd) || "."}):\n${r.stderr.trim()}`);
  return r.stdout;
}

/** The registry folders of a crate this machine has unpacked (cargo's registry/src/<index>/). */
function crateDir(name, version) {
  const home = process.env.CARGO_HOME || join(homedir(), ".cargo");
  const src = join(home, "registry", "src");
  if (!existsSync(src)) return null;
  for (const index of readdirSync(src).sort()) {
    const dir = join(src, index, `${name}-${version}`);
    if (existsSync(join(dir, "Cargo.toml"))) return dir;
  }
  return null;
}

/** A crate's `license-file`, read from its own Cargo.toml's [package] table. */
function licenceFile(dir) {
  const toml = readFileSync(join(dir, "Cargo.toml"), "utf8");
  const pkg = toml.split(/^\[(?!package\])/m)[0].split(/^\[package\]/m)[1] ?? "";
  return /^license-file\s*=\s*"([^"]+)"/m.exec(pkg)?.[1] ?? null;
}

/** The Rust crates compiled into the program for the target, offline, from cargo's own folders. */
export function readRust(program, target, repo = REPO) {
  const prog = PROGRAMS[program];
  const cwd = join(repo, prog.cargo);
  // `--color never`: cargo colours its answer when the build asks for colour (CARGO_TERM_COLOR, as
  // the Release workflow and the builder image set it to always, or CLICOLOR_FORCE), wrapping
  // `cargo tree`'s repeat mark in colour codes; the flag beats both, and cargo's own config.
  const meta = JSON.parse(run("cargo", ["metadata", "--color", "never", "--format-version", "1", "--no-deps", "--offline", "--locked"], cwd));
  const own = new Set(meta.packages.map((p) => `${p.name} ${p.version}`));
  const tree = run("cargo", ["tree", "--color", "never", "--offline", "--locked", "--target", target, "-p", prog.pkg, "-e", "normal,no-proc-macro",
    "--features", "tauri/custom-protocol", "--prefix", "none", "--format", "{p}|{l}"], cwd);
  const packages = [];
  for (const c of parseCargoTree(tree)) {
    const path = c.source && (c.source.startsWith("/") || /^[A-Za-z]:[\\/]/.test(c.source));
    if (path && own.has(`${c.name} ${c.version}`)) continue; // the program's own workspace crates
    const p = { kind: "rust", name: c.name, version: c.version, licence: c.licence, licenceForm: null, source: "registry", texts: [] };
    if (c.source) {
      p.source = path ? "a path outside the workspace" : c.source;
      packages.push(p);
      continue;
    }
    const dir = crateDir(c.name, c.version);
    if (!dir) {
      p.source = "registry, but not unpacked on this machine (its licence texts can't be read)";
      packages.push(p);
      continue;
    }
    const file = licenceFile(dir);
    if (!p.licence && file) p.licenceForm = `a licence file (${file}) in place of an expression`;
    p.texts = readTexts(dir, file ? [file] : []);
    packages.push(p);
  }
  if (packages.length === 0) throw new Error(`cargo tree gave no crate for ${prog.name} (${target}), so there is nothing to list: every program here has some`);
  return packages;
}

/** The folder of the package a module id belongs to (the last node_modules/<name> in it). */
export function packageDir(id) {
  const clean = id.replace(/^\0/, "").split("?")[0].replace(/\\/g, "/");
  const i = clean.lastIndexOf("/node_modules/");
  if (i < 0) return null;
  const rest = clean.slice(i + "/node_modules/".length).split("/");
  const n = rest[0].startsWith("@") ? 2 : 1;
  if (rest.length <= n || rest[0].startsWith(".")) return null; // .pnpm, .vite-temp: not a package
  return clean.slice(0, i + "/node_modules/".length) + rest.slice(0, n).join("/");
}

/** pnpm-lock.yaml's `packages:` entries: "name@version" -> its resolution line. */
export function pnpmResolutions(text) {
  const out = new Map();
  let inPackages = false;
  let key = null;
  for (const line of text.split("\n")) {
    if (/^\S/.test(line)) { inPackages = line.startsWith("packages:"); key = null; continue; }
    if (!inPackages) continue;
    const k = /^ {2}'?([^' ][^']*?)'?:\s*$/.exec(line);
    if (k) { key = k[1]; continue; }
    const r = /^ {4}resolution: (.*)$/.exec(line);
    if (key && r) out.set(key, r[1].trim());
  }
  return out;
}

/** Whether a page package came from the npm registry, by the page's own lockfile. */
function npmSource(prog, repo, dir, name, version) {
  const root = join(repo, prog.page.root);
  if (prog.page.lock === "npm") {
    const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
    const key = relative(root, dir).split(sep).join("/");
    const e = lock.packages?.[key];
    if (!e) return `not in package-lock.json (${key})`;
    if (e.link) return "a link in package-lock.json";
    if (e.version !== version) return `package-lock.json has ${e.version}`;
    if (!/^https:\/\/registry\.npmjs\.org\//.test(e.resolved ?? "")) return `package-lock.json resolves it to ${e.resolved ?? "nothing"}`;
    return "registry";
  }
  const res = pnpmResolutions(readFileSync(join(root, "pnpm-lock.yaml"), "utf8")).get(`${name}@${version}`);
  if (!res) return `not in pnpm-lock.yaml's packages (${name}@${version})`;
  if (!/^\{integrity: [^,{}]+\}$/.test(res)) return `pnpm-lock.yaml resolves it as ${res}`;
  return "registry";
}

const { registerHooks, syncBuiltinESMExports } = nodeModule;
const STYLE = /\.(css|scss|sass|less|styl|stylus|pcss|postcss|sss)$/;
/** CSS preprocessors that read what a style imports in a thread or process of their own. */
export const PREPROCESSORS = ["sass", "sass-embedded", "less", "stylus"];

const norm = (p) => p.replace(/\\/g, "/");
/**
 * A path as the disk has it, every link followed as the system follows it (a link, then "..",
 * leads where the link's target's parent is); the path as given when there is no such file.
 */
const real = (p) => {
  try {
    return norm(realpathSync.native(p));
  } catch {
    return norm(normalize(p));
  }
};

/**
 * The file a stack frame's code is in: "at f (file:///a/b.js:1:2)" and "at /a/b.js:1:2" give
 * "/a/b.js", "at f (node:fs:4:5)" gives "node:fs" (Node's own code), and a frame that names no
 * file ("at new Promise (<anonymous>)", "at async Promise.all (index 0)", an eval) gives "".
 */
export function frameFile(line) {
  const t = line.trim();
  const loc = (/\(([^()]*)\)$/.exec(t)?.[1] ?? /^at (?:async )?([^()\s][^()]*)$/.exec(t)?.[1] ?? "").replace(/:\d+:\d+$/, "");
  if (/^node:[\w/.-]+$/.test(loc)) return loc;
  if (loc.startsWith("file://")) {
    try {
      return norm(fileURLToPath(loc));
    } catch {
      return "";
    }
  }
  return /^(\/|[A-Za-z]:[\\/])/.test(loc) ? norm(loc) : "";
}

/** The file of the first frame of a stack that names one: the code that made the call. */
export const callerOf = (stack) => stack.split("\n").map(frameFile).find(Boolean) ?? "";

/**
 * Every file under a folder (or the file itself), links followed as a copy follows them, each by
 * the path it is reached by. Nothing is opened: only names and kinds are read.
 */
export function filesUnder(path) {
  const out = [];
  const seen = new Set();
  const walk = (dir) => {
    const r = real(dir);
    if (seen.has(r)) return;
    seen.add(r);
    for (const e of readdirSync(dir).sort()) {
      const p = join(dir, e);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue; // a link to nothing: copied as nothing
      }
      if (st.isDirectory()) walk(p);
      else if (st.isFile()) out.push(p);
    }
  };
  let st = null;
  try {
    st = statSync(path);
  } catch {
    return out;
  }
  // A folder from where the system finds it (a path through a link and "..": not where the
  // words of the path lead).
  if (st.isDirectory()) walk(real(path));
  else if (st.isFile()) out.push(path);
  return out;
}

/** The folder of a package as Node finds it from `from`: node_modules/<name> there or above. */
function findPackage(from, name) {
  for (let d = resolve(from); ; d = dirname(d)) {
    if (existsSync(join(d, "node_modules", name, "package.json"))) return real(join(d, "node_modules", name));
    if (dirname(d) === d) return null;
  }
}

/**
 * The build's known tools and every package one of them uses: the real folders of `names` as Node
 * finds them from the page's folder, and of their `dependencies` and `optionalDependencies` as
 * Node finds those from each package's own folder, all the way down. Peer dependencies aren't
 * followed: a tool's peer is a choice of the page (a CSS preprocessor among them), not the tool's.
 */
export function knownTools(root, names) {
  const found = new Set();
  const queue = names.map((n) => findPackage(root, n)).filter(Boolean);
  while (queue.length) {
    const dir = queue.pop();
    if (found.has(dir)) continue;
    found.add(dir);
    const pj = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    for (const n of Object.keys({ ...pj.dependencies, ...pj.optionalDependencies })) {
      const d = findPackage(dir, n);
      if (d) queue.push(d);
    }
  }
  return found;
}

/**
 * What goes into the page, recorded while the page's own build runs again; and everything the
 * build does that this script can't follow, so that the build stops on it.
 * - `plugin`, a Vite plugin, sees every module of a chunk with code in it, every style module, and
 *   every file the build emits, by the file it came from, in the page's build and in every worker
 *   Vite builds for it; and the page's public folder, which a build copies as it is.
 * - `read(path, stack)` is called for every file the build reads by name through Node's `fs`, a
 *   copy or a link of a file made with it, and every file under a folder `cp` copies (`stack`
 *   starts at the frame that called `fs`). Every file of a package read that way is taken to be in
 *   the page, by the path given and by the path the disk has: a style's `@import` (a page's
 *   stylesheet, a component's `<style>`, a CSS module's `composes`), a file a style, the code or
 *   index.html inlines as a data: URL, an asset, what the page's config reads. But for two
 *   readers: one of the known tools (`known.tools`, the real folders of the build's own tools and
 *   the packages they use) reading a package's package.json, to find a package's files; and
 *   Node's loader reading code to run it, which is `loaded` instead. Any other code reading a
 *   package's package.json stops the build.
 * - `loaded(file)` is called for every module Node loads while the build runs (and every native
 *   addon): one that is neither one of the known tools' nor the page's own stops the build, since
 *   what its code puts into the page can't be followed.
 * - `config(files)` takes the files the page's config is bundled from: a package's file there is
 *   in the page (the config holds it), and a file outside the page that is no package's stops it.
 * - `worker(what)` and `command(line)`: a thread started during the build stops it (what it reads
 *   isn't heard), and so does a process, unless its command line is one of `known.commands`.
 * - `symlink(target, path)`: a symbolic link made during the build stops it, wherever it leads
 *   (what reads the output, such as the app's bundler, follows it later, out of the script's hearing).
 * Each is traced to its package (`rendered`: package folder -> how), or to Vite's or Rolldown's
 * helpers; a module that is neither the page's own (under `root`) nor a package's is `unknown`.
 * `unheard()` names each file the build emitted as a file of its own (not its code, styles or
 * HTML) without having read it through `fs`: Vite then reads files where `read` isn't called, and
 * a file it inlines that way would go unseen. `stops()` names the rest of what stops the build.
 */
export function pageRecorder(root, helpers = { vite: null, rolldown: null }, known = { tools: new Set(), commands: [] }) {
  const rendered = new Map();
  const unknown = new Set();
  const heard = new Set();
  const emitted = new Set();
  const stopped = new Map(); // what stops the build, once each (the config is loaded twice)
  const stop = (key, why) => {
    if (!stopped.has(key)) stopped.set(key, why);
  };
  let hooked = 0;
  const mark = (dir, how) => {
    if (!rendered.has(dir)) rendered.set(dir, new Set());
    rendered.get(dir).add(how);
  };
  const inPage = (p) => p === root || p.startsWith(`${root}/`);
  // A package of the path as given, and of the path the disk has (a link into a package).
  const packagesOf = (path) => [...new Set([packageDir(norm(normalize(path))), packageDir(real(path))].filter(Boolean))];
  const toolsOwn = (file) => {
    const d = packageDir(real(file));
    return !!d && known.tools.has(real(d));
  };
  const loaded = (file, byHook = false) => {
    if (byHook) hooked++;
    const r = real(file);
    const dir = packageDir(r) ?? packageDir(norm(file));
    if (dir ? !known.tools.has(real(dir)) : !inPage(r)) {
      stop(`load ${dir ? real(dir) : r}`, `the build loaded ${dir ? `the package in ${real(dir)}` : r}, which is none of the build's known tools nor a package one of them uses, so what its code puts into the page can't be followed`);
    }
  };
  const read = (path, stack, how = "read") => {
    const given = norm(normalize(path));
    heard.add(given);
    heard.add(real(path));
    const dirs = packagesOf(path);
    if (!dirs.length) return;
    // A copy, a link or a move: what it makes can be read anywhere, so the file is in the page.
    if (how === "copy") {
      for (const d of dirs) mark(d, "file");
      return;
    }
    const caller = callerOf(stack);
    // Node's loader reading code to run it (or a package.json to find it).
    if (caller.startsWith("node:internal/modules/")) {
      if (!/\/package\.json$/.test(given)) loaded(path);
      return;
    }
    if (dirs.some((d) => given === `${d}/package.json` || real(path) === `${d}/package.json`)) {
      // One of the known tools finding a package's files, called by no code but theirs and Node's
      // (the page's config calling a tool to read it is a reader too); any other stops the build.
      const all = stack.split("\n").map(frameFile).filter(Boolean);
      const mine = all.indexOf(SELF); // this script running the build, and what runs this script
      const frames = mine < 0 ? all : all.slice(0, mine);
      const other = frames.find((f) => !f.startsWith("node:") && !toolsOwn(f));
      if (caller && !caller.startsWith("node:") && toolsOwn(caller) && !other) return;
      stop(`${dirs[0]}/package.json`, `${dirs[0]}/package.json is read by ${other ?? (caller || "code that names no file")}, which is none of the build's known tools, so where it goes can't be followed`);
      return;
    }
    for (const d of dirs) mark(d, "file");
  };
  const config = (files) => {
    for (const f of files) {
      const dirs = packagesOf(f);
      for (const d of dirs) mark(d, "config");
      if (!dirs.length && !inPage(real(f))) stop(real(f), `the page's config is built from ${real(f)}, a file outside the page that is no package's`);
    }
  };
  const worker = (what) => stop(`thread ${what}`, `the build started a thread (${what}), whose reads this script doesn't hear`);
  const symlink = (target, path) => stop(`symlink ${path}`, `the build made a symbolic link, ${path} to ${target}, which what reads the output follows where this script doesn't hear it`);
  const command = (line) => {
    if (!known.commands.includes(line)) stop(`process ${line}`, `the build started a process this script doesn't know, whose reads it doesn't hear: ${line}`);
  };
  const transform = (_code, id) => {
    const clean = norm(id.split("?")[0]);
    if (STYLE.test(clean) && packageDir(clean)) mark(packageDir(clean), "css");
    return null;
  };
  const walk = (bundle) => {
    for (const f of Object.values(bundle)) {
      if (f.type === "chunk") {
        for (const [rawId, m] of Object.entries(f.modules ?? {})) {
          if (!(m.renderedLength > 0)) continue;
          const id = norm(rawId);
          if (id.startsWith("\0vite/") && helpers.vite) mark(helpers.vite, "js");
          else if (/^\0?rolldown[:/]runtime/.test(id) && helpers.rolldown) mark(helpers.rolldown, "js");
          else if (packageDir(id)) mark(packageDir(id), "js");
          else if (id.startsWith("\0") || !id.startsWith(`${root}/`)) unknown.add(id.replace(/^\0/, "\\0"));
        }
      } else {
        // The page's styles and HTML name the entry they were built for, not a file read.
        const own = /\.(css|html|m?js|map)$/.test(f.fileName);
        for (const o of f.originalFileNames ?? []) {
          const abs = norm(o.startsWith("/") || /^[A-Za-z]:/.test(o) ? o : join(root, o));
          if (packageDir(abs)) mark(packageDir(abs), "asset");
          if (!own) emitted.add(abs);
        }
      }
    }
  };
  // A worker is a build of its own: the same listener goes into it.
  const workerPlugin = { name: "dependency-licences:worker", enforce: "pre", transform, generateBundle: (_o, bundle) => walk(bundle) };
  const plugin = {
    name: "dependency-licences",
    enforce: "pre",
    config(c) {
      const own = c.worker?.plugins;
      c.worker = { ...c.worker, plugins: () => [...(typeof own === "function" ? own() : []), workerPlugin] };
    },
    // The public folder is copied into the download as it is, by a build that writes (this one
    // doesn't): each file of a package there, or linked from there, is in the page.
    configResolved(c) {
      if (!c.publicDir || c.build?.copyPublicDir === false) return;
      for (const f of filesUnder(c.publicDir)) for (const d of packagesOf(f)) mark(d, "public");
    },
    transform,
    generateBundle: (_o, bundle) => walk(bundle),
  };
  const unheard = () => [...emitted].filter((f) => !heard.has(f)).sort();
  const stops = () => [...stopped.values()].sort();
  return { plugin, read, loaded, config, worker, command, symlink, rendered, unknown, unheard, stops, hooks: () => hooked };
}

// Node, listened to while a build runs (`build`, a recorder, is set): `fs`'s functions that read
// a file by name, copy it or link it; Node's loader (every module it loads, and native addons);
// threads and processes. Put in once, before the page's build loads anything, so no tool holds
// the functions from before; they stay in, and call nothing when no build runs.
let build = null;
let listening = false;
const STOPS_AT = /^node:(fs|internal\/fs\/.*)$/;
function listenOnce() {
  if (listening) return;
  listening = true;
  // The path as the call gives it, made absolute without folding "..": the system follows a link
  // before a "..", so "src/link/../x" may be a package's file where "src/x" isn't.
  const absolute = (s) => (isAbsolute(s) ? s : `${process.cwd()}${sep}${s}`);
  const toPath = (p) => (typeof p === "string" ? absolute(p) : p instanceof URL ? fileURLToPath(p) : Buffer.isBuffer(p) ? absolute(p.toString()) : null);
  const inCall = []; // paths of the calls listened to that are running now
  const streams = new Map(); // createReadStream's paths, until its stream opens the file
  // The stack from the frame that called `fn` on, one "at <function> (<file>:<line>:<column>)" a
  // frame, by the files that run (a source map never moves a frame into another file).
  const stackFrom = (fn) => {
    const o = {};
    const limit = Error.stackTraceLimit;
    const prepare = Error.prepareStackTrace;
    Error.stackTraceLimit = 50;
    Error.prepareStackTrace = (_e, sites) => sites
      .map((s) => `    at ${s.getFunctionName() ?? "<function>"} (${s.getFileName() ?? "<anonymous>"}:${s.getLineNumber()}:${s.getColumnNumber()})`)
      .join("\n");
    try {
      Error.captureStackTrace(o, fn);
      return String(o.stack);
    } finally {
      Error.stackTraceLimit = limit;
      Error.prepareStackTrace = prepare;
    }
  };
  // how: "read" (the first argument is a file read), "copy" (a file copied, linked or moved), "tree"
  // (a file or a folder copied whole).
  const wrap = (obj, name, how) => {
    const orig = obj[name];
    if (typeof orig !== "function") return;
    const listened = function (p, ...rest) {
      const raw = build ? toPath(p) : null;
      if (!raw) return orig.call(this, p, ...rest);
      const path = resolve(raw);
      const stack = stackFrom(listened);
      const caller = callerOf(stack);
      if (STOPS_AT.test(caller) && inCall.some((c) => path === c || path.startsWith(c + sep))) {
        // fs's own code inside a call already heard (readFileSync opening its file, cpSync copying
        // a file of the folder it copies).
      } else if (caller === "node:internal/fs/streams" && streams.get(path) > 0) {
        streams.set(path, streams.get(path) - 1); // the stream createReadStream made, opening its file
      } else {
        // Anything else is heard, fs's own code too: `new fs.ReadStream` opens its file later, from
        // fs's stream code, and that open is all there is to hear of it.
        for (const f of how === "tree" ? filesUnder(raw) : [raw]) build.read(f, stack, how === "read" ? "read" : "copy");
        if (name === "createReadStream") streams.set(path, (streams.get(path) ?? 0) + 1);
      }
      inCall.push(path);
      try {
        return orig.call(this, p, ...rest);
      } finally {
        inCall.pop();
      }
    };
    obj[name] = listened;
  };
  for (const name of ["readFileSync", "readFile", "createReadStream", "openSync", "open", "openAsBlob"]) wrap(fs, name, "read");
  for (const name of ["copyFileSync", "copyFile", "linkSync", "link"]) wrap(fs, name, "copy");
  // A move takes a folder whole, as cp copies one.
  for (const name of ["cpSync", "cp", "renameSync", "rename"]) wrap(fs, name, "tree");
  for (const name of ["readFile", "open"]) wrap(fs.promises, name, "read");
  for (const name of ["copyFile", "link"]) wrap(fs.promises, name, "copy");
  for (const name of ["cp", "rename"]) wrap(fs.promises, name, "tree");
  // A symbolic link: its target is read by whatever follows it, later; it stops the build.
  for (const obj of [fs, fs.promises]) {
    for (const name of obj === fs ? ["symlinkSync", "symlink"] : ["symlink"]) {
      const orig = obj[name];
      obj[name] = function (target, path, ...rest) {
        const at = build ? toPath(path) : null;
        if (at) {
          const to = target instanceof URL ? fileURLToPath(target) : String(target);
          build.symlink(isAbsolute(to) ? to : join(dirname(at), to), at); // a relative target: from the link's folder
        }
        return orig.call(this, target, path, ...rest);
      };
    }
  }
  // Processes: heard by their command line, once (execSync starts its process through spawnSync).
  let inProcess = 0;
  for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) {
    const orig = childProcess[name];
    childProcess[name] = function (cmd, ...rest) {
      if (build && !inProcess) {
        const args = Array.isArray(rest[0]) ? rest[0] : [];
        build.command(/^exec(Sync)?$/.test(name) ? String(cmd) : [String(cmd), ...args].join(" "));
      }
      inProcess++;
      try {
        return orig.call(this, cmd, ...rest);
      } finally {
        inProcess--;
      }
    };
  }
  const Worker = workerThreads.Worker;
  workerThreads.Worker = class extends Worker {
    constructor(what, ...rest) {
      if (build) build.worker(String(what).split("\n")[0].slice(0, 80));
      super(what, ...rest);
    }
  };
  const dlopen = process.dlopen;
  process.dlopen = function (module, file, ...rest) {
    if (build) build.loaded(String(file));
    return dlopen.call(this, module, file, ...rest);
  };
  // Every module Node loads, by import or require: told by Node itself, not inferred from fs.
  registerHooks?.({
    load(url, context, next) {
      if (build && !url.startsWith("node:")) build.loaded(url.startsWith("file:") ? fileURLToPath(url) : url, true);
      return next(url, context);
    },
  });
  syncBuiltinESMExports();
}

/**
 * Hears what a build does while it runs, for `recorder` (a pageRecorder): `read` for every file
 * read by name through Node's `fs` (readFile, readFileSync, createReadStream and the stream
 * fs.ReadStream opens, open, openSync, openAsBlob, and fs.promises' readFile and open), copied
 * (copyFile, cp, in each form; cp's every file) or linked or moved (link, rename; a folder moved,
 * its every file); `symlink` for every symbolic link made (symlink, in each form); `loaded` for
 * every module Node loads and every native addon; `worker` and `command` for every thread and
 * process started; until the returned function is called.
 */
export function listenToBuild(recorder) {
  listenOnce();
  build = recorder;
  return () => {
    if (build === recorder) build = null;
  };
}

/**
 * The npm packages in the program's page: its Vite build is run again, as `vite build` does with
 * the page's own config, writing nothing, and every module, style and file it puts into the page
 * is traced to its package. Returns { packages, failures }: a page whose packages aren't
 * installed, a page with a CSS preprocessor installed, a module in the page that is neither the
 * page's own nor a package's, a file the build emitted without reading it through `fs`, and
 * anything the build does that the script can't follow (pageRecorder's `stops`), fails.
 */
export async function readPage(program, repo = REPO) {
  const prog = PROGRAMS[program];
  const root = join(repo, prog.page.root);
  const viteLink = join(root, "node_modules", "vite");
  if (!existsSync(join(viteLink, "package.json"))) {
    return { packages: [], failures: [`${prog.name}'s page: its packages aren't installed (${prog.page.install}), so they can't be read`] };
  }
  const viteDir = realpathSync(viteLink);
  // Found as Vite finds one: in node_modules of the page's folder or any folder above it, then of
  // Vite's own folder or any above it (pnpm's hidden node_modules/.pnpm/node_modules among them).
  const above = [];
  for (const from of [resolve(root), join(viteDir, "dist", "node")]) {
    for (let d = from; ; d = dirname(d)) {
      above.push(d);
      if (dirname(d) === d) break;
    }
  }
  const preprocessors = PREPROCESSORS.filter((p) => above.some((d) => existsSync(join(d, "node_modules", p, "package.json"))));
  if (preprocessors.length) {
    return { packages: [], failures: [`${prog.name}'s page: a CSS preprocessor is installed for it (${preprocessors.join(", ")}), which reads what a style imports where this script can't see, so the page can't be read`] };
  }
  if (typeof registerHooks !== "function") {
    return { packages: [], failures: [`${prog.name}'s page: this Node (${process.version}) has no module.registerHooks, so the script can't hear what the build loads`] };
  }
  const helpers = { vite: norm(viteDir), rolldown: existsSync(join(viteDir, "..", "rolldown")) ? norm(realpathSync(join(viteDir, "..", "rolldown"))) : null };
  const rootN = norm(realpathSync(root));
  const recorder = pageRecorder(rootN, helpers, { tools: knownTools(root, prog.page.tools), commands: prog.page.commands });
  const outDir = mkdtempSync(join(tmpdir(), "dependency-licences-"));
  const cwd = process.cwd();
  const configFile = join(repo, prog.page.config);
  // Listening starts before Vite is loaded, so no part of it holds Node's functions from before.
  const stopListening = listenToBuild(recorder);
  try {
    const vite = await import(pathToFileURL(join(viteDir, "dist", "node", "index.js")).href);
    process.chdir(root);
    // The files the config is bundled from (read by Vite's bundler, not through fs).
    const env = { command: "build", mode: "production", isSsrBuild: false, isPreview: false };
    const loadedConfig = await vite.loadConfigFromFile(env, configFile, realpathSync(root), "warn");
    recorder.config(loadedConfig?.dependencies ?? []);
    await vite.build({
      root: realpathSync(root), configFile, mode: "production", logLevel: "warn",
      build: { write: false, outDir, emptyOutDir: false }, plugins: [recorder.plugin],
    });
  } finally {
    stopListening();
    process.chdir(cwd);
    rmSync(outDir, { recursive: true, force: true });
  }
  const shown = (id) => (id.startsWith(`${rootN}/`) ? relative(rootN, id) : id.replace(rootN, "<page>"));
  const failures = [
    ...recorder.unheard().map((f) => `${prog.name}'s page: the build emitted ${shown(f)} without reading it through Node's fs, where this script listens, so a file it inlines could go unseen`),
    ...[...recorder.unknown].sort().map((id) => `${prog.name}'s page: a module of no known package is in the page: ${shown(id)}`),
    ...recorder.stops().map((s) => `${prog.name}'s page: ${s.split(rootN).join("<page>")}`),
  ];
  if (recorder.hooks() === 0) failures.push(`${prog.name}'s page: Node told the script of no module loaded during the build, its config's included, so what the build loads wasn't heard`);
  const packages = [];
  const seen = new Set();
  for (const d of recorder.rendered.keys()) {
    const dir = realpathSync(d);
    if (seen.has(dir)) continue; // the same package by two paths (a link and its target)
    seen.add(dir);
    const pj = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    const p = { kind: "npm", name: pj.name, version: pj.version, licence: null, licenceForm: null, source: "registry", texts: readTexts(dir) };
    if (typeof pj.license === "string" && /^SEE LICEN[CS]E IN /i.test(pj.license)) p.licenceForm = `"${pj.license}" in place of an expression`;
    else if (typeof pj.license === "string") p.licence = pj.license;
    else if (pj.license !== undefined || pj.licenses !== undefined) p.licenceForm = "its package.json gives the licence in an old form (an object or a list), not an expression";
    p.source = npmSource(prog, repo, d, pj.name, pj.version);
    packages.push(p);
  }
  return { packages, failures };
}


// ------------------------------------------------------------------ the command

/** Reads one program for one target, runs the gate and, when it passes, writes the list. */
export async function main(argv, env = process.env) {
  // Every argument is one this knows, or the run stops: one it doesn't (or an option without its
  // value) would otherwise change nothing and let the run pass against what it didn't mean.
  const programs = Object.keys(PROGRAMS).join("|");
  const usage = `usage: dependency-licences.mjs <${programs}> [<target>] [--out <folder>] [--allowed <file>] [--no-text <file>]\n` +
    `       dependency-licences.mjs --check <folder> <${programs}> <target>`;
  const opts = {};
  const args = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("-")) { args.push(a); continue; }
    if (!["--check", "--out", "--allowed", "--no-text"].includes(a)) throw new Error(`no such argument: "${a}"\n${usage}`);
    if (a in opts) throw new Error(`${a} given twice\n${usage}`);
    const v = argv[i + 1];
    if (v === undefined || v === "" || v.startsWith("-")) throw new Error(`${a} needs a value\n${usage}`);
    opts[a] = v;
    i++;
  }
  if (args.length > 2) throw new Error(`one program and one target at most, not: ${args.join(" ")}\n${usage}`);
  const check = opts["--check"] ?? null;
  if (check && (opts["--out"] || opts["--allowed"] || opts["--no-text"])) throw new Error(`--check takes no other option\n${usage}`);
  const out = opts["--out"] ?? null;
  const allowedFile = opts["--allowed"] ?? join(REPO, ALLOWED_FILE);
  const noTextFile = opts["--no-text"] ?? join(REPO, NO_TEXT_FILE);
  const [program, targetArg] = args;
  const target = targetArg ?? (check ? undefined : env.TAURI_ENV_TARGET_TRIPLE);
  if (!PROGRAMS[program]) throw new Error(usage);
  const none = check ? "(none: --check takes the target after the program)" : "(none: give it, or TAURI_ENV_TARGET_TRIPLE)";
  if (!TARGETS[target]) throw new Error(`no target, or not one this builds for: ${target ?? none}`);
  const prog = PROGRAMS[program];
  if (check) {
    const problems = checkList(check, program, target);
    if (problems.length) {
      console.error(`The dependencies' list in ${check} isn't whole:\n${problems.map((p) => `  ${p}`).join("\n")}`);
      return 1;
    }
    console.log(`dependencies: ${check} lists ${prog.name}'s packages for ${TARGETS[target]}, each text there`);
    return 0;
  }
  // Named in every message as given, or as the repository's own when none is.
  const names = {
    allowed: opts["--allowed"] ?? ALLOWED_FILE,
    noText: opts["--no-text"] ?? NO_TEXT_FILE,
  };
  const allowed = readAllowed(readFileSync(allowedFile, "utf8"), names.allowed);
  const noText = JSON.parse(readFileSync(noTextFile, "utf8"));
  const folder = resolve(REPO, out ?? prog.out);
  // Emptied first, so a list from an earlier build (the other system's) never goes with this one;
  // only ever a folder this script wrote.
  if (existsSync(folder) && readdirSync(folder).some((e) => e !== "README.md" && e !== "texts")) {
    throw new Error(`${folder} holds files this script doesn't write: not emptying it`);
  }
  rmSync(folder, { recursive: true, force: true });
  const rust = readRust(program, target);
  const page = await readPage(program);
  const packages = [...rust, ...page.packages];
  const { failures, supplied } = gate(packages, allowed, noText, names);
  failures.push(...page.failures);
  const where = folder.startsWith(REPO + sep) ? relative(REPO, folder).split(sep).join("/") : folder;
  console.log(`${prog.name} for ${TARGETS[target]} (${target}): ${rust.length} Rust crates, ${page.packages.length} npm packages in the page`);
  if (failures.length) {
    console.error(`The dependencies' licences stop this build: ${failures.length} problem(s), each named (docs/maintaining.md, "The dependencies' licences"):\n${failures.map((f) => `  ${f}`).join("\n")}`);
    return 1;
  }
  const { list, files } = renderList(program, target, packages, supplied);
  mkdirSync(join(folder, "texts"), { recursive: true });
  for (const f of files) {
    const from = f.from.texts.find((t) => t.sha256 === f.sha256);
    copyFileSync(from.path, join(folder, f.name));
  }
  writeFileSync(join(folder, "README.md"), list);
  console.log(`licences allowed; the list and ${files.length} texts written to ${where}/ (${supplied.length} package(s) with no text of their own, as ${names.noText} says)`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (e) => {
    console.error(`dependency-licences: ${e.message}`);
    process.exit(1);
  });
}
