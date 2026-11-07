#!/usr/bin/env bash
# Builds a release's downloads in the builder image (ci/Dockerfile): the Linux AppImage and .deb,
# natively, and the Windows installer, cross-compiled with cargo-xwin. The `build` job in
# .gitlab-ci.yml runs it; it also runs by hand in the image, for trying a release build locally:
#
#   docker run --rm -v "$PWD:/src" -w /src <builder image> ci/build.sh 0.2.900 [--no-windows]
#
# Each system carries TennoScope, built from tennoscope/ (see tennoscope/ORBITER.md) with its
# Tesseract, beside orbiter's sources in vendor/tennoscope/ (src-tauri/tauri.bundle.json): first
# the Linux AppImage of it, then, for the Windows build, its .exe. No signing and no updater files
# here (Tauri's createUpdaterArtifacts stays off): the sign job signs the final files.
#
# The downloads end up in release-files/:
#   orbiter_<version>_amd64.AppImage   orbiter_<version>_amd64.deb   orbiter_<version>_x64-setup.exe
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
  if grep -q ORBITER_UPDATER_E2E "$1"; then
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

rm -rf "$out"
mkdir -p "$out"

step "orbiter's and TennoScope's packages"
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

step "orbiter's AppImage and .deb ($version)"
rm -f "$target"/release/bundle/appimage/*.AppImage "$target"/release/bundle/deb/*.deb
npx tauri build --bundles appimage,deb --config src-tauri/tauri.bundle.json --config "{\"version\":\"$version\"}" -- --locked
# TennoScope's AppImage back in as it was built (linuxdeploy rewrites it), with the bundled
# libraries' sources listed (scripts/repack-appimage.sh).
scripts/repack-appimage.sh
not_e2e "$target/release/orbiter"
check_glibc_floor "$target/release/bundle/appimage/orbiter.AppDir" \
  tennoscope/target/release/bundle/appimage/TennoScope.AppDir
install -m 755 "$target/release/bundle/appimage/orbiter_${version}_amd64.AppImage" "$out/"
install -m 644 "$target/release/bundle/deb/orbiter_${version}_amd64.deb" "$out/"

# ------------------------------------------------------------------ Windows

if $windows; then
  step "Tesseract inside TennoScope (Windows)"
  scripts/vendor-windows-tesseract.sh tennoscope/app/src-tauri/vendor/tesseract

  step "TennoScope's program (Windows)"
  # The program alone: orbiter's installer carries it, beside its Tesseract.
  (cd tennoscope/app && pnpm tauri build --no-bundle --runner cargo-xwin --target "$win" -- --locked)
  rm -rf vendor/tennoscope
  mkdir -p vendor/tennoscope/tesseract
  cp tennoscope/target/$win/release/tennoscope.exe vendor/tennoscope/
  cp -r tennoscope/app/src-tauri/vendor/tesseract/. vendor/tennoscope/tesseract/
  scripts/tennoscope-notice.sh vendor/tennoscope

  step "orbiter's installer (Windows, $version)"
  rm -f "$target/$win"/release/bundle/nsis/*-setup.exe
  # tauri.windows.conf.json is named as well as merged by Tauri itself: when cross-compiling, the
  # installer's settings (NSIS only, per-user, the WebView2 bootstrapper) must apply either way.
  npx tauri build --runner cargo-xwin --target "$win" --config src-tauri/tauri.bundle.json \
    --config src-tauri/tauri.windows.conf.json --config "{\"version\":\"$version\"}" -- --locked
  not_e2e "$target/$win/release/orbiter.exe"
  install -m 644 "$target/$win/release/bundle/nsis/orbiter_${version}_x64-setup.exe" "$out/"
fi

# The Linux Tesseract folder is a build product; put back the placeholder that keeps it in Git.
git checkout -q -- tennoscope/app/src-tauri/vendor/tesseract/.gitkeep 2>/dev/null || true

step "Built"
ls -l "$out"
