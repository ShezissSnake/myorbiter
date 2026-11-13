// The release scripts that put other people's libraries and their notices into the downloads,
// run against stand-ins: a folder of made-up DLLs, made-up packages answered by a stand-in
// `dpkg-query` first on PATH, a made-up copyright folder, a tar standing in for a .deb. They prove
// the scripts' logic only: what a real Ubuntu or Windows build holds is shown by a release run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(".");
const windows = process.platform === "win32";
const bash = windows ? "" : spawnSync("sh", ["-c", "command -v bash"], { encoding: "utf8" }).stdout.trim();
const skip = windows || !bash ? "needs bash on Linux or macOS" : false;

const tmp = (): string => mkdtempSync(join(tmpdir(), "release-notices-"));
const run = (args: string[], env: NodeJS.ProcessEnv = {}, cwd = root) =>
  spawnSync(bash, args, { cwd, encoding: "utf8", env: { ...process.env, LC_ALL: "C", ...env } });
const write = (path: string, text: string, mode = 0o644) => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
  chmodSync(path, mode);
};

// ---------------------------------------------------------------- point 1: every DLL has its row

const TABLE = "tennoscope/packaging/windows-tesseract/README.md";
// The file names in the table's first column, as scripts/check-windows-dlls.sh reads them.
const tableDlls = (): string[] =>
  readFileSync(TABLE, "utf8").split("\n")
    .filter((line) => line.split("|").length > 3)
    .flatMap((line) => line.split("|")[1].split(","))
    .map((cell) => cell.replace(/^[ `]+|[ `]+$/g, ""))
    .filter((name) => /\.dll$/i.test(name));

const dllFolder = (extra: string[] = []): string => {
  const dir = tmp();
  for (const name of [...tableDlls(), ...extra, "tesseract.exe", "eng.traineddata"]) writeFileSync(join(dir, name), "");
  return dir;
};

test("the table names the DLLs it is checked against", { skip }, () => {
  const names = tableDlls();
  assert.ok(names.length >= 40, `${names.length} DLLs in the table`);
  assert.ok(names.includes("libglib-2.0-0.dll") && names.includes("zlib1.dll"));
});

test("a folder with the table's DLLs passes", { skip }, () => {
  const dir = dllFolder();
  const r = run(["scripts/check-windows-dlls.sh", dir]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`each of the ${tableDlls().length} DLLs`));
  rmSync(dir, { recursive: true });
});

test("one DLL more stops it, and is named", { skip }, () => {
  const dir = dllFolder(["libnew-1.dll"]);
  const r = run(["scripts/check-windows-dlls.sh", dir]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^1 DLL\(s\) in .* have no row in .*README\.md:\n {2}libnew-1\.dll\n$/);
  rmSync(dir, { recursive: true });
});

test("two DLLs more are both named, a space or an upper-case .DLL included", { skip }, () => {
  const dir = dllFolder(["lib new-2.dll", "LIBOTHER.DLL"]);
  const r = run(["scripts/check-windows-dlls.sh", dir]);
  assert.equal(r.status, 1);
  const named = r.stderr.split("\n").filter((l) => l.startsWith("  ")).map((l) => l.slice(2)).sort();
  assert.deepEqual(named, ["LIBOTHER.DLL", "lib new-2.dll"]);
  rmSync(dir, { recursive: true });
});

test("a folder with no DLL passes", { skip }, () => {
  const dir = tmp();
  writeFileSync(join(dir, "tesseract.exe"), "");
  const r = run(["scripts/check-windows-dlls.sh", dir]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, "");
  rmSync(dir, { recursive: true });
});

// tennoscope-notice.sh, in a copy of the repository's few files it reads, so it writes nothing here.
const noticeRepo = (): string => {
  const repo = tmp();
  for (const f of ["scripts/tennoscope-notice.sh", "scripts/check-windows-dlls.sh"]) {
    mkdirSync(join(repo, "scripts"), { recursive: true });
    copyFileSync(f, join(repo, f));
    chmodSync(join(repo, f), 0o755);
  }
  mkdirSync(join(repo, "tennoscope/packaging/windows-tesseract"), { recursive: true });
  copyFileSync(TABLE, join(repo, TABLE));
  write(join(repo, "tennoscope/LICENSE"), "GPL-3.0 text\n");
  write(join(repo, "tennoscope/THIRD_PARTY_NOTICES.md"), "notices\n");
  write(join(repo, "tennoscope/Cargo.toml"), 'version = "0.1.0"\n');
  write(join(repo, "tennoscope/app/src-tauri/vendor/tesseract/licenses/SOURCES.md"), "sources\n");
  mkdirSync(join(repo, "THIRD-PARTY-NOTICES"));
  mkdirSync(join(repo, "vendor/tennoscope"), { recursive: true });
  return repo;
};
const notice = (repo: string) =>
  run([join(repo, "scripts/tennoscope-notice.sh"), join(repo, "vendor/tennoscope")], { GIT_CEILING_DIRECTORIES: tmpdir() }, repo);

test("tennoscope-notice.sh: a Linux build, with no tesseract/ beside TennoScope, is as before", { skip }, () => {
  const repo = noticeRepo();
  const r = notice(repo);
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /DLL/);
  assert.ok(existsSync(join(repo, "vendor/tennoscope/NOTICE.md")));
  assert.equal(readFileSync(join(repo, "THIRD-PARTY-NOTICES/SOURCES.md"), "utf8"), "sources\n");
  rmSync(repo, { recursive: true });
});

test("tennoscope-notice.sh: a Windows build passes with the table's DLLs and stops on one more", { skip }, () => {
  const repo = noticeRepo();
  const tess = join(repo, "vendor/tennoscope/tesseract");
  mkdirSync(tess);
  for (const name of tableDlls()) writeFileSync(join(tess, name), "");
  let r = notice(repo);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /DLLs in .* has its row/);
  writeFileSync(join(tess, "libnew-1.dll"), "");
  r = notice(repo);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /\n {2}libnew-1\.dll\n/);
  rmSync(repo, { recursive: true });
});

// ---------------------------------------------------------------- point 4: the Linux source list

// A stand-in dpkg-query that knows the packages of $STANDIN_PACKAGES ("package arch file version
// source source-version" per line): -S answers for /usr/lib/x86_64-linux-gnu/<file> and for
// */<file>, as dpkg-query does, and -W fills in the format it's given.
const STANDIN = `#!/usr/bin/env bash
set -euo pipefail
found=1
case $1 in
  -S)
    while read -r pkg arch file _; do
      path=/usr/lib/x86_64-linux-gnu/$file
      if [ "$2" = "$path" ] || [ "$2" = "*/$file" ]; then echo "$pkg:$arch: $path"; found=0; fi
    done <"$STANDIN_PACKAGES"
    ;;
  -W)
    fmt=\${2#-f=}
    want=\${3%%:*}
    while read -r pkg arch file version src srcver; do
      [ "$pkg" = "$want" ] || continue
      out=\${fmt//'\${Package}'/$pkg}
      out=\${out//'\${Version}'/$version}
      out=\${out//'\${source:Package}'/$src}
      out=\${out//'\${source:Version}'/$srcver}
      printf '%b' "$out"
      found=0
    done <"$STANDIN_PACKAGES"
    ;;
esac
exit $found
`;

type Fixture = { dir: string; bin: string; files: string; docs: string; packages: string };
const fixture = (): Fixture => {
  const dir = tmp();
  const f: Fixture = { dir, bin: join(dir, "bin"), files: join(dir, "bundle/usr"), docs: join(dir, "doc"), packages: join(dir, "packages.txt") };
  write(join(f.bin, "dpkg-query"), STANDIN, 0o755);
  write(f.packages, "libfoo1 amd64 libfoo.so.1 1.2-3 foo 1.2-3\nlibbar2 amd64 libbar.so.2 2.0-1ubuntu1 bar 2.0-1ubuntu1\n");
  write(join(f.files, "lib/libfoo.so.1"), "");
  write(join(f.files, "lib/libbar.so.2"), "");
  write(join(f.files, "bin/tennoscope"), "", 0o755);
  write(join(f.docs, "libfoo1/copyright"), "Format: https://www.debian.org/doc/packaging-manuals/copyright-format/1.0/\n\nFiles: *\nLicense: LGPL-2.1+\n");
  write(join(f.docs, "libbar2/copyright"), "Files: *\nLicense: MIT\n");
  return f;
};
const collect = (f: Fixture, out: string, env: NodeJS.ProcessEnv = {}) =>
  run(["scripts/collect-linux-sources.sh", out, f.files], {
    PATH: `${f.bin}:${process.env.PATH}`, STANDIN_PACKAGES: f.packages, COPYRIGHT_DOC_DIR: f.docs, ...env,
  });

const OFFER = `## Written offer

For three years from the date of this release, the complete corresponding source code of the GPL-
and LGPL-licensed libraries bundled in this build is available on request: open an issue at
https://github.com/ShezissSnake/myorbiter/issues or contact the maintainer.

The source of MyOrbiter and TennoScope (both GPL-3.0-only) is attached to every release as
myorbiter-source.tar.gz.
`;
const pretty = (): string =>
  spawnSync(bash, ["-c", '. /etc/os-release 2>/dev/null || true; printf %s "${PRETTY_NAME:-Debian/Ubuntu}"'], { encoding: "utf8" }).stdout;

test("collect-linux-sources.sh: every package with its copyright file passes, with the list as before", { skip }, () => {
  const f = fixture();
  const out = join(f.dir, "SOURCES.md");
  const linux = join(f.dir, "linux");
  const r = collect(f, out, { NOTICES_DIR: linux });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(out, "utf8"), `# Sources of the bundled libraries

This build carries files from these ${pretty()} packages (the build machine's), at
exactly these versions. Each package's source, at that version, is on the page linked: Ubuntu
keeps the source of every version it published (https://launchpad.net/ubuntu/+source/<source
package>/<version>). "(L)GPL" marks the packages whose copyright file names the GPL or the
LGPL for any part of them (for some, only build files): the written offer below covers them all.

| Package | Version | Source package | Licences (its copyright file) | (L)GPL | Source | Files |
|---|---|---|---|---|---|---|
| libbar2 | 2.0-1ubuntu1 | bar 2.0-1ubuntu1 | MIT |  | https://launchpad.net/ubuntu/+source/bar/2.0-1ubuntu1 | libbar.so.2 |
| libfoo1 | 1.2-3 | foo 1.2-3 | LGPL-2.1+ | yes | https://launchpad.net/ubuntu/+source/foo/1.2-3 | libfoo.so.1 |

GPL or LGPL: libfoo1.

Not from a package (MyOrbiter's and TennoScope's own programs, the AppImage runtime and the
like): tennoscope.

${OFFER}`);
  assert.deepEqual(readdirSync(linux).sort(), ["libbar2.copyright", "libfoo1.copyright"]);
  assert.equal(readFileSync(join(linux, "libfoo1.copyright"), "utf8"), readFileSync(join(f.docs, "libfoo1/copyright"), "utf8"));
  rmSync(f.dir, { recursive: true });
});

test("collect-linux-sources.sh: one package without its copyright file stops it, and is named", { skip }, () => {
  for (const notices of [false, true]) {
    const f = fixture();
    rmSync(join(f.docs, "libbar2"), { recursive: true });
    const out = join(f.dir, "SOURCES.md");
    const r = collect(f, out, notices ? { NOTICES_DIR: join(f.dir, "linux") } : {});
    assert.equal(r.status, 1, `NOTICES_DIR ${notices ? "set" : "unset"}`);
    assert.match(r.stderr, /^1 bundled package\(s\) have no copyright file in .*:\n {2}libbar2\n$/);
    assert.ok(!existsSync(out), "no SOURCES.md written");
    rmSync(f.dir, { recursive: true });
  }
});

test("collect-linux-sources.sh: two packages without it are both named", { skip }, () => {
  for (const notices of [false, true]) {
    const f = fixture();
    rmSync(join(f.docs, "libbar2"), { recursive: true });
    rmSync(join(f.docs, "libfoo1/copyright"));
    const r = collect(f, join(f.dir, "SOURCES.md"), notices ? { NOTICES_DIR: join(f.dir, "linux") } : {});
    assert.equal(r.status, 1);
    assert.match(r.stderr, /^2 bundled package\(s\) have no copyright file in .*:\n {2}libbar2\n {2}libfoo1\n$/);
    rmSync(f.dir, { recursive: true });
  }
});

test("collect-linux-sources.sh: with no dpkg-query on PATH it writes the no-dpkg list and passes", { skip }, () => {
  const f = fixture();
  // A PATH of only the tools the script uses before it looks for dpkg (an Ubuntu runner has a real
  // dpkg-query in /usr/bin, so the ordinary PATH would not do).
  const tools = join(f.dir, "tools");
  mkdirSync(tools);
  for (const tool of ["mkdir", "dirname", "find", "sort", "cat"]) {
    const at = spawnSync("sh", ["-c", `command -v ${tool}`], { encoding: "utf8" }).stdout.trim();
    assert.ok(at, `${tool} is installed`);
    symlinkSync(at, join(tools, tool));
  }
  const out = join(f.dir, "SOURCES.md");
  const r = collect(f, out, { PATH: tools });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /no dpkg here/);
  assert.equal(readFileSync(out, "utf8"), `# Sources of the bundled libraries

This build was made on a system without dpkg, so the packages its libraries came from
weren't listed automatically.

${OFFER}`);
  rmSync(f.dir, { recursive: true });
});

// ---------------------------------------------------------------- point 3: the .deb's notices

// check_deb_notices, as ci/build.sh has it, run on a tar standing in for the .deb (a stand-in
// dpkg-deb -x unpacks it).
const debCheck = (): string => {
  const text = readFileSync("ci/build.sh", "utf8");
  const start = text.indexOf("check_deb_notices() {");
  const end = text.indexOf("\n}\n", start);
  assert.ok(start >= 0 && end > start, "check_deb_notices in ci/build.sh");
  return text.slice(start, end + 3);
};
const deb = (f: Fixture, build: (notices: string) => void): ReturnType<typeof run> => {
  const tree = join(f.dir, "deb");
  const notices = join(tree, "usr/lib/myorbiter/THIRD-PARTY-NOTICES");
  write(join(notices, "README.md"), "# Third-party notices\n");
  write(join(notices, "fonts/OFL.txt"), "OFL\n");
  write(join(tree, "usr/lib/myorbiter/tennoscope/THIRD-PARTY-NOTICES/tesseract/SOURCES.md"), "Tesseract's\n");
  build(notices);
  const file = join(f.dir, "myorbiter_0.2.900_amd64.deb");
  assert.equal(spawnSync("tar", ["-cf", file, "-C", tree, "."]).status, 0);
  write(join(f.bin, "dpkg-deb"), '#!/usr/bin/env bash\n[ "$1" = -x ] && tar -xf "$2" -C "$3"\n', 0o755);
  const harness = join(f.dir, "check.sh");
  write(harness, `set -euo pipefail\n${debCheck()}\ncheck_deb_notices "$1"\n`);
  return run([harness, file], { PATH: `${f.bin}:${process.env.PATH}` });
};
const listed = (f: Fixture, notices: string) => {
  const r = collect(f, join(notices, "SOURCES.md"), { NOTICES_DIR: join(notices, "linux") });
  assert.equal(r.status, 0, r.stderr);
};

test("the .deb check passes on a list with every package's copyright file", { skip }, () => {
  const f = fixture();
  const r = deb(f, (n) => listed(f, n));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /lists 2 packages, each with its copyright file/);
  rmSync(f.dir, { recursive: true });
});

test("the .deb check stops on a missing copyright file, and names its package", { skip }, () => {
  const f = fixture();
  const r = deb(f, (n) => { listed(f, n); rmSync(join(n, "linux/libfoo1.copyright")); });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no copyright file in \/usr\/lib\/myorbiter\/THIRD-PARTY-NOTICES\/linux\/ for: libfoo1\n$/);
  rmSync(f.dir, { recursive: true });
});

test("the .deb check stops without a written offer, without a list, or with an empty one", { skip }, () => {
  const f = fixture();
  let r = deb(f, (n) => { listed(f, n); write(join(n, "SOURCES.md"), readFileSync(join(n, "SOURCES.md"), "utf8").replace(/complete corresponding source code/, "")); });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /has no written offer/);
  rmSync(join(f.dir, "deb"), { recursive: true });
  r = deb(f, () => {});
  assert.equal(r.status, 1);
  assert.match(r.stderr, /has no written offer/);
  rmSync(join(f.dir, "deb"), { recursive: true });
  r = deb(f, (n) => write(join(n, "SOURCES.md"), `# Sources of the bundled libraries\n\n${OFFER}`));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /lists no package/);
  rmSync(f.dir, { recursive: true });
});

test("the .deb check stops unless exactly one THIRD-PARTY-NOTICES/ is MyOrbiter's", { skip }, () => {
  const f = fixture();
  const r = deb(f, (n) => {
    listed(f, n);
    write(join(n, "../../other/THIRD-PARTY-NOTICES/README.md"), "x\n");
    write(join(n, "../../other/THIRD-PARTY-NOTICES/fonts/x"), "x\n");
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /expected one THIRD-PARTY-NOTICES\/ with README\.md and fonts\/, found 2/);
  rmSync(f.dir, { recursive: true });
});
