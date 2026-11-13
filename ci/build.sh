#!/usr/bin/env bash
# Builds a release's downloads in the builder image (ci/Dockerfile): the Linux AppImage and .deb,
# natively, and the Windows installer, cross-compiled with cargo-xwin. The `build` job in
# .gitlab-ci.yml runs it; it also runs by hand in the image, for trying a release build locally:
#
#   docker run --rm -v "$PWD:/src" -w /src <builder image> ci/build.sh 0.2.900 [--no-windows]
#
# Each system carries TennoScope, built from tennoscope/ (see tennoscope/ORBITER.md) with its
# Tesseract, beside MyOrbiter's sources in vendor/tennoscope/ (src-tauri/tauri.bundle.json): first
# the Linux AppImage of it, then, for the Windows build, its .exe. No signing and no updater files
# here (Tauri's createUpdaterArtifacts stays off): the sign job signs the final files.
#
# The downloads end up in release-files/:
#   myorbiter_<version>_amd64.AppImage   myorbiter_<version>_amd64.deb   myorbiter_<version>_x64-setup.exe
set -euo pipefail

version=${1:?usage: ci/build.sh <version> [--no-windows]}
windows=true
[ "${2:-}" = "--no-windows" ] && windows=false
[[ "$version" =~ ^0\.2\.[1-9][0-9]*$ ]] || { echo "not a release version: $version (0.2.<n>)" >&2; exit 2; }

here=$(cd "$(dirname "$0")/.." && pwd)
cd "$here"
target="${CARGO_TARGET_DIR:-$here/target}"
out="$here/release-files"
win=x86_64-pc-windows-msvc
step() { printf '\n==> %s\n' "$*"; }

# The update check's address is fixed in the code; a build made for the end-to-end test of
# updating (the e2e-updater feature) can be pointed elsewhere, and must never ship.
not_e2e() {
  if grep -q MYORBITER_UPDATER_E2E "$1"; then
    echo "$1 was built with the e2e-updater feature" >&2
    exit 1
  fi
}

# The glibc floor (ci/Dockerfile builds on Ubuntu 22.04 for it): nothing built or bundled for Linux
# may ask for a newer glibc, or the AppImage stops starting on SteamOS and older systems. Raise it
# only on purpose, with the base image.
glibc_floor=2.35
# Each folder is checked on its own, so a missing one stops the build instead of going unchecked.
check_glibc_floor() {
  local dir newest
  for dir in "$@"; do
    [ -d "$dir" ] || { echo "glibc check: $dir isn't there" >&2; exit 1; }
    # objdump fails on the files that aren't ELF; only its output matters.
    newest=$( { find "$dir" -type f -exec objdump -T {} + 2>/dev/null || true; } \
      | grep -o 'GLIBC_[0-9][0-9.]*' | sed 's/^GLIBC_//' | sort -uV | tail -n 1 || true)
    [ -n "$newest" ] || { echo "glibc check: no glibc symbol versions found in $dir" >&2; exit 1; }
    if [ "$(printf '%s\n' "$glibc_floor" "$newest" | sort -V | tail -n 1)" != "$glibc_floor" ]; then
      echo "$dir needs glibc $newest, newer than the $glibc_floor floor" >&2
      exit 1
    fi
    echo "glibc: $dir asks for $newest at most (floor $glibc_floor)"
  done
}

# The .deb carries TennoScope's AppImage too, so it must carry THIRD-PARTY-NOTICES/ with SOURCES.md
# (every package-built library in that AppImage, where its source is, and the written offer) and
# linux/ (each package's copyright file). Proved on the built .deb, as repack-appimage.sh proves
# its AppImage. The folder is found by name: MyOrbiter's is the one with the tree's README.md and
# fonts/ (TennoScope's, tennoscope/THIRD-PARTY-NOTICES/, holds only tesseract/).
check_deb_notices() {
  local deb=$1 unpacked notices dir pkg rows=0
  local found=() missing=()
  unpacked=$(mktemp -d)
  dpkg-deb -x "$deb" "$unpacked"
  while IFS= read -r -d '' dir; do
    if [ -f "$dir/README.md" ] && [ -d "$dir/fonts" ]; then found+=("$dir"); fi
  done < <(find "$unpacked" -type d -name THIRD-PARTY-NOTICES -print0)
  [ ${#found[@]} -eq 1 ] || { echo "$deb: expected one THIRD-PARTY-NOTICES/ with README.md and fonts/, found ${#found[@]}" >&2; exit 1; }
  notices=${found[0]}
  grep -q 'complete corresponding source code' "$notices/SOURCES.md" 2>/dev/null \
    || { echo "$deb: ${notices#"$unpacked"}/SOURCES.md has no written offer" >&2; exit 1; }
  # The table's rows (scripts/collect-linux-sources.sh): the package is the first cell, and its
  # copyright file is linux/<package without :arch>.copyright.
  while IFS= read -r pkg; do
    rows=$((rows + 1))
    [ -f "$notices/linux/${pkg%%:*}.copyright" ] || missing+=("$pkg")
  done < <(awk -F'|' '/^\| Package \|/ { table = 1; next }
    table && /^\|---/ { next }
    table && /^\| / { gsub(/^ +| +$/, "", $2); print $2; next }
    table { exit }' "$notices/SOURCES.md")
  [ "$rows" -gt 0 ] || { echo "$deb: ${notices#"$unpacked"}/SOURCES.md lists no package" >&2; exit 1; }
  if [ ${#missing[@]} -gt 0 ]; then
    echo "$deb: no copyright file in ${notices#"$unpacked"}/linux/ for: ${missing[*]}" >&2
    exit 1
  fi
  rm -rf "$unpacked"
  echo "notices: $(basename "$deb") lists $rows packages, each with its copyright file"
}

rm -rf "$out"
mkdir -p "$out"

step "MyOrbiter's and TennoScope's packages"
npm ci
(cd tennoscope/app && pnpm install --frozen-lockfile)
# TennoScope's builds run `tauri build` without --locked: stop first if tennoscope/Cargo.lock
# doesn't match its Cargo.toml files, so they can't resolve other versions than the ones committed.
(cd tennoscope && cargo metadata --locked --format-version 1 >/dev/null)

# ------------------------------------------------------------------ Linux and the Steam Deck

step "Tesseract inside TennoScope (Linux)"
scripts/vendor-linux-tesseract.sh tennoscope/app/src-tauri/vendor/tesseract

step "TennoScope's AppImage"
# Its own AppImage build: it forces X11 for the reward overlay and repacks.
(cd tennoscope && ./scripts/build-linux-bundles.sh --skip-gates appimage)
rm -rf vendor/tennoscope
mkdir -p vendor/tennoscope
built=(tennoscope/target/release/bundle/appimage/*.AppImage)
[ ${#built[@]} -eq 1 ] && [ -f "${built[0]}" ] || { echo "expected one TennoScope AppImage, found: ${built[*]}" >&2; exit 1; }
install -m 755 "${built[0]}" vendor/tennoscope/TennoScope.AppImage
# Its licence, its notices and its Tesseract's, and NOTICE.md (where its source is).
scripts/tennoscope-notice.sh vendor/tennoscope
# Where the source of every library TennoScope's AppImage carries is (the system libraries
# linuxdeploy copied into it, its Tesseract's), with the written offer, and their copyright files
# in linux/: in the tree's THIRD-PARTY-NOTICES/, so the AppImage and the .deb both carry them.
# linux/ is emptied first, so nothing from an earlier build goes with them. repack-appimage.sh
# then writes the AppImage's own, longer list. The AppDir is what TennoScope's AppImage was packed
# from (its build repacks from it), the folder the glibc check reads below.
tennoscope_appdir=tennoscope/target/release/bundle/appimage/TennoScope.AppDir
[ -d "$tennoscope_appdir/usr" ] || { echo "no $tennoscope_appdir/usr: TennoScope's AppImage build left no AppDir" >&2; exit 1; }
rm -rf THIRD-PARTY-NOTICES/linux
NOTICES_DIR=THIRD-PARTY-NOTICES/linux scripts/collect-linux-sources.sh THIRD-PARTY-NOTICES/SOURCES.md "$tennoscope_appdir/usr"

step "MyOrbiter's AppImage and .deb ($version)"
rm -f "$target"/release/bundle/appimage/*.AppImage "$target"/release/bundle/deb/*.deb
npx tauri build --bundles appimage,deb --config src-tauri/tauri.bundle.json --config "{\"version\":\"$version\"}" -- --locked
# TennoScope's AppImage back in as it was built (linuxdeploy rewrites it), with the bundled
# libraries' sources listed (scripts/repack-appimage.sh).
scripts/repack-appimage.sh
check_deb_notices "$target/release/bundle/deb/myorbiter_${version}_amd64.deb"
not_e2e "$target/release/myorbiter"
check_glibc_floor "$target/release/bundle/appimage/myorbiter.AppDir" \
  tennoscope/target/release/bundle/appimage/TennoScope.AppDir
install -m 755 "$target/release/bundle/appimage/myorbiter_${version}_amd64.AppImage" "$out/"
install -m 644 "$target/release/bundle/deb/myorbiter_${version}_amd64.deb" "$out/"

# ------------------------------------------------------------------ Windows

if $windows; then
  step "Tesseract inside TennoScope (Windows)"
  scripts/vendor-windows-tesseract.sh tennoscope/app/src-tauri/vendor/tesseract

  step "TennoScope's program (Windows)"
  # The program alone: MyOrbiter's installer carries it, beside its Tesseract.
  (cd tennoscope/app && pnpm tauri build --no-bundle --runner cargo-xwin --target "$win" -- --locked)
  rm -rf vendor/tennoscope
  mkdir -p vendor/tennoscope/tesseract
  cp tennoscope/target/$win/release/tennoscope.exe vendor/tennoscope/
  cp -r tennoscope/app/src-tauri/vendor/tesseract/. vendor/tennoscope/tesseract/
  # The installer carries the Windows list (tennoscope-notice.sh writes SOURCES.md over the Linux
  # one) and none of the Linux half's copyright files.
  rm -rf THIRD-PARTY-NOTICES/linux
  scripts/tennoscope-notice.sh vendor/tennoscope

  step "MyOrbiter's installer (Windows, $version)"
  rm -f "$target/$win"/release/bundle/nsis/*-setup.exe
  # tauri.windows.conf.json is named as well as merged by Tauri itself: when cross-compiling, the
  # installer's settings (NSIS only, per-user, the WebView2 bootstrapper) must apply either way.
  npx tauri build --runner cargo-xwin --target "$win" --config src-tauri/tauri.bundle.json \
    --config src-tauri/tauri.windows.conf.json --config "{\"version\":\"$version\"}" -- --locked
  not_e2e "$target/$win/release/myorbiter.exe"
  install -m 644 "$target/$win/release/bundle/nsis/myorbiter_${version}_x64-setup.exe" "$out/"
fi

# The Linux Tesseract folder is a build product; put back the placeholder that keeps it in Git.
git checkout -q -- tennoscope/app/src-tauri/vendor/tesseract/.gitkeep 2>/dev/null || true

step "Built"
ls -l "$out"
