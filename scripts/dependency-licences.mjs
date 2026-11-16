#!/usr/bin/env node
// The third-party packages compiled into one program for one system, each with its name, version,
// licence and licence texts, read from what the build itself has unpacked (cargo's registry folder,
// the page's node_modules), with no request: and the gate that stops the build when one of them
// has no licence, a licence scripts/dependency-licences-allowed.txt doesn't allow, a source other
// than the registry, or no licence text and nothing in scripts/dependency-licences-no-text.json.
//
//   node scripts/dependency-licences.mjs <myorbiter|tennoscope> [<target>] [--out <folder>]
//   node scripts/dependency-licences.mjs --check <folder> <myorbiter|tennoscope> <target>
//
// The first form runs after the program is compiled, before it's packed: MyOrbiter's as Tauri's
// beforeBundleCommand (src-tauri/tauri.bundle.json, which gives the target as
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
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const ALLOWED_FILE = "scripts/dependency-licences-allowed.txt";
export const NO_TEXT_FILE = "scripts/dependency-licences-no-text.json";

export const PROGRAMS = {
  myorbiter: {
    name: "MyOrbiter", cargo: ".", pkg: "myorbiter",
    page: { root: ".", config: "vite.config.ts", lock: "npm", install: "npm ci" },
    out: "THIRD-PARTY-NOTICES/dependencies",
  },
  tennoscope: {
    name: "TennoScope", cargo: "tennoscope", pkg: "tennoscope",
    page: { root: "tennoscope/app", config: "tennoscope/app/vite.config.ts", lock: "pnpm", install: "pnpm install --frozen-lockfile in tennoscope/app" },
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
export function readAllowed(text) {
  const allowed = new Set();
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^([A-Za-z0-9][A-Za-z0-9.+-]*)(?: WITH ([A-Za-z0-9][A-Za-z0-9.+-]*))?$/.exec(line);
    if (!m) throw new Error(`${ALLOWED_FILE}: "${line}" is neither a licence id nor "<id> WITH <exception>"`);
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
export function licenceAllowed(expression, allowed) {
  let tree;
  try {
    tree = parseExpression(expression);
  } catch (e) {
    return { allowed: false, why: e.message };
  }
  return treeAllowed(tree, allowed) ? { allowed: true } : { allowed: false, why: `"${expression}" is not allowed by ${ALLOWED_FILE}` };
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
export function gate(packages, allowed, noText) {
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
      const a = licenceAllowed(p.licence, allowed);
      if (!a.allowed) why.push(a.why);
    }
    if (!p.texts.some((t) => t.licence)) {
      const entry = p.kind === "rust" ? noText.crates.find((c) => c.name === p.name && c.version === p.version) : undefined;
      if (!entry) why.push(`no licence text in its source, and none in ${NO_TEXT_FILE}`);
      else if (entry.licence !== p.licence) why.push(`${NO_TEXT_FILE} has it as "${entry.licence}", its manifest says "${p.licence}"`);
      else if (entry.text === null) supplied.push({ name: p.name, version: p.version, carry: null, entry });
      else {
        const found = (byHash.get(entry.text.sha256) ?? []).find((h) => h.from !== p && (!entry.text.from || h.from.name === entry.text.from));
        if (!found) why.push(`the text ${NO_TEXT_FILE} gives it (${entry.text.from ?? "any package"}, SHA-256 ${entry.text.sha256.slice(0, 12)}…) is in no package of this build`);
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
 * A line it can't read stops it, so no crate is left out of the list unread.
 */
export function parseCargoTree(text) {
  const seen = new Map();
  for (const raw of text.split("\n")) {
    const line = raw.replace(/ \(\*\)$/, "").trimEnd();
    if (line === "") continue;
    const m = /^(\S+) v(\S+)(?: \((.*)\))?\|(.*)$/.exec(line);
    if (!m) throw new Error(`cargo tree printed a line this script can't read, so it can't list that crate: "${line}"`);
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
  const meta = JSON.parse(run("cargo", ["metadata", "--format-version", "1", "--no-deps", "--offline", "--locked"], cwd));
  const own = new Set(meta.packages.map((p) => `${p.name} ${p.version}`));
  const tree = run("cargo", ["tree", "--offline", "--locked", "--target", target, "-p", prog.pkg, "-e", "normal,no-proc-macro",
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
  if (rest.length <= n || rest[0] === ".pnpm") return null;
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

const STYLE = /\.(css|scss|sass|less|styl|stylus|pcss|postcss|sss)$/;

/**
 * The Vite plugin that records what goes into the page (the page's own build, run again):
 * - every module of a chunk with code in it;
 * - every style file Vite compiles (`transform`);
 * - every file a style pulls in, with `@import` or a `url()` Vite inlines as a data: URL, which has
 *   no module, transform or emitted file of its own: Vite's CSS plugin reports those with
 *   `addWatchFile`, which this listens to;
 * - every file the build emits, by the file it came from.
 * Each is traced to its package (`rendered`: package folder -> how), or to Vite's or Rolldown's
 * helpers; one that is neither the page's own (under `root`) nor a package's is `unknown`. When
 * Vite's CSS plugin isn't there to listen to, or styles went through without it being heard,
 * `failures` says so, and the page isn't read.
 */
export function pageRecorder(root, helpers = { vite: null, rolldown: null }) {
  const norm = (p) => p.replace(/\\/g, "/");
  const rendered = new Map();
  const unknown = new Set();
  const failures = [];
  let styles = 0; // style files this plugin saw go through the build
  let heard = 0; // calls of Vite's CSS plugin heard
  const mark = (dir, how) => {
    if (!rendered.has(dir)) rendered.set(dir, new Set());
    rendered.get(dir).add(how);
  };
  const file = (path, how) => {
    const clean = norm(path.split("?")[0]);
    if (packageDir(clean)) mark(packageDir(clean), how);
    else if (!clean.startsWith(`${root}/`)) unknown.add(clean.replace(/^\0/, "\\0"));
  };
  const plugin = {
    name: "dependency-licences",
    enforce: "pre",
    configResolved(config) {
      const css = config.plugins.find((p) => p.name === "vite:css");
      const hook = css?.transform;
      const handler = typeof hook === "function" ? hook : hook?.handler;
      if (typeof handler !== "function") {
        failures.push("Vite's CSS plugin (vite:css) isn't where this looks for it, so what the page's styles import can't be read");
        return;
      }
      const listened = function (code, id, ...rest) {
        heard++;
        const context = new Proxy(this, {
          get(target, key) {
            if (key === "addWatchFile") return (f) => { file(f, STYLE.test(norm(f.split("?")[0])) ? "css" : "asset"); return target.addWatchFile(f); };
            const v = Reflect.get(target, key);
            return typeof v === "function" ? v.bind(target) : v;
          },
        });
        return handler.call(context, code, id, ...rest);
      };
      css.transform = typeof hook === "function" ? listened : { ...hook, handler: listened };
    },
    transform(_code, id) {
      const clean = norm(id.split("?")[0]);
      if (STYLE.test(clean) && (clean.startsWith("/") || /^[A-Za-z]:\//.test(clean))) {
        styles++;
        file(clean, "css");
      }
      return null;
    },
    generateBundle(_o, bundle) {
      // Styles went through the build, but Vite's CSS plugin was never heard: what they pulled in
      // is unknown, so the page isn't read.
      if (styles > 0 && heard === 0 && failures.length === 0) {
        failures.push("Vite compiled the page's styles without the CSS plugin this listens to, so what they pull in can't be read");
      }
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
          for (const o of f.originalFileNames ?? []) {
            const abs = norm(o.startsWith("/") || /^[A-Za-z]:/.test(o) ? o : join(root, o));
            if (packageDir(abs)) mark(packageDir(abs), "asset");
          }
        }
      }
    },
  };
  return { plugin, rendered, unknown, failures };
}

/**
 * The npm packages in the program's page: its Vite build is run again, as `vite build` does with
 * the page's own config, writing nothing, and every module, style and file it puts into the page
 * is traced to its package. Returns { packages, failures }: a page whose packages aren't
 * installed, or a module in the page that is neither the page's own nor a package's, fails.
 */
export async function readPage(program, repo = REPO) {
  const prog = PROGRAMS[program];
  const root = join(repo, prog.page.root);
  const viteLink = join(root, "node_modules", "vite");
  if (!existsSync(join(viteLink, "package.json"))) {
    return { packages: [], failures: [`${prog.name}'s page: its packages aren't installed (${prog.page.install}), so they can't be read`] };
  }
  const viteDir = realpathSync(viteLink);
  const vite = await import(pathToFileURL(join(viteDir, "dist", "node", "index.js")).href);
  const norm = (p) => p.replace(/\\/g, "/");
  const helpers = { vite: norm(viteDir), rolldown: existsSync(join(viteDir, "..", "rolldown")) ? norm(realpathSync(join(viteDir, "..", "rolldown"))) : null };
  const rootN = norm(realpathSync(root));
  const { plugin: recorder, rendered, unknown, failures: recorderFailures } = pageRecorder(rootN, helpers);
  const outDir = mkdtempSync(join(tmpdir(), "dependency-licences-"));
  const cwd = process.cwd();
  try {
    process.chdir(root);
    await vite.build({
      root, configFile: join(repo, prog.page.config), mode: "production", logLevel: "warn",
      build: { write: false, outDir, emptyOutDir: false }, plugins: [recorder],
    });
  } finally {
    process.chdir(cwd);
    rmSync(outDir, { recursive: true, force: true });
  }
  const failures = [
    ...recorderFailures.map((f) => `${prog.name}'s page: ${f}`),
    ...[...unknown].sort().map((id) => `${prog.name}'s page: a module of no known package is in the page: ${id.startsWith(`${rootN}/`) ? relative(root, id) : id.replace(rootN, "<page>")}`),
  ];
  const packages = [];
  for (const d of rendered.keys()) {
    const dir = realpathSync(d);
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
  if (!TARGETS[target]) throw new Error(`no target, or not one this builds for: ${target ?? "(none: give it, or TAURI_ENV_TARGET_TRIPLE)"}`);
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
  const allowed = readAllowed(readFileSync(allowedFile, "utf8"));
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
  const { failures, supplied } = gate(packages, allowed, noText);
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
  console.log(`licences allowed; the list and ${files.length} texts written to ${where}/ (${supplied.length} package(s) with no text of their own, as ${NO_TEXT_FILE} says)`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (e) => {
    console.error(`dependency-licences: ${e.message}`);
    process.exit(1);
  });
}
