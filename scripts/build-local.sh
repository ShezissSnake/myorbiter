#!/usr/bin/env bash
# Builds orbiter's Linux AppImage on this PC, the way the release pipeline's build job does
# (ci/build.sh, run by .gitlab-ci.yml): Tesseract put inside TennoScope, TennoScope's own AppImage
# build, orbiter's AppImage with TennoScope inside it, and the same repack step
# (scripts/repack-appimage.sh). For trying a build out locally without a pipeline. To build
# exactly as the pipeline does, run ci/build.sh in the builder image instead (ci/Dockerfile).
#
#   scripts/build-local.sh [--version X.Y.Z] [--skip-tennoscope] [--check]
#
#   --version X.Y.Z    the version the build carries (default: tauri.conf.json's, 0.1.0). A release
#                      build is 0.2.<run number>; an installed 0.1.0 is offered the channel's
#                      update like any older build.
#   --skip-tennoscope  reuse the TennoScope AppImage of the last run (vendor/tennoscope/), for when
#                      only orbiter changed.
#   --check            only check that the tools it needs are installed, and stop.
#
# Made for Arch Linux and CachyOS; other distributions work with their own package names. Once:
#
#   sudo pacman -S --needed base-devel rust clang pnpm nodejs npm libpipewire webkit2gtk-4.1 \
#     tesseract tesseract-data-eng patchelf xdg-utils
#
# How it differs from the release build: it isn't signed (no updater files, so it never offers
# itself as an update), it links against this system's libraries, which are newer than the
# Ubuntu 24.04 the release builds on (so it may not start on an older system or SteamOS), and
# the bundled libraries' notices are matched with pacman rather than dpkg, without the list of
# their sources (THIRD-PARTY-NOTICES/SOURCES.md says so). Fine for testing; share release builds.
#
# The AppImage ends up in target/release/bundle/appimage/ (or under CARGO_TARGET_DIR).
set -euo pipefail

here=$(cd "$(dirname "$0")/.." && pwd)
cd "$here"

version=""
skip_tennoscope=false
check_only=false
while [ $# -gt 0 ]; do
  case "$1" in
    --version)
      version=${2:-}
      [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "--version takes X.Y.Z, e.g. 0.2.900" >&2; exit 2; }
      shift 2
      ;;
    --skip-tennoscope) skip_tennoscope=true; shift ;;
    --check) check_only=true; shift ;;
    -h|--help) sed -n '2,27p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1 (see --help)" >&2; exit 2 ;;
  esac
done

# ------------------------------------------------------------------ what it needs

missing=()
# xdg-open: Tauri bundles it into the AppImage (xdg-utils).
for tool in cargo node npm npx pnpm clang tesseract patchelf pkg-config xdg-open; do
  command -v "$tool" >/dev/null || missing+=("$tool")
done
pkg-config --exists webkit2gtk-4.1 2>/dev/null || missing+=("webkit2gtk-4.1 (its development files)")
pkg-config --exists libpipewire-0.3 2>/dev/null || missing+=("libpipewire (its development files)")
# Wherever the distribution keeps it (Arch: /usr/share/tessdata), as vendor-linux-tesseract.sh looks.
model=$(find /usr/share/tessdata /usr/share/tesseract-ocr -name eng.traineddata -print -quit 2>/dev/null || true)
[ -n "$model" ] || missing+=("Tesseract's English model (tesseract-data-eng)")
if [ ${#missing[@]} -gt 0 ]; then
  echo "Missing: ${missing[*]}" >&2
  if command -v pacman >/dev/null; then
    echo "Install them with: sudo pacman -S --needed base-devel rust clang pnpm nodejs npm libpipewire webkit2gtk-4.1 tesseract tesseract-data-eng patchelf xdg-utils" >&2
  fi
  exit 1
fi
if $check_only; then
  echo "Everything the build needs is installed."
  exit 0
fi

step() { printf '\n==> %s\n' "$*"; }
target="${CARGO_TARGET_DIR:-$here/target}"
started=$(date +%s)

# ------------------------------------------------------------------ TennoScope

if $skip_tennoscope; then
  [ -x vendor/tennoscope/TennoScope.AppImage ] || { echo "no TennoScope from an earlier run in vendor/tennoscope/: run without --skip-tennoscope" >&2; exit 1; }
  step "Reusing vendor/tennoscope/TennoScope.AppImage"
else
  step "Putting Tesseract inside TennoScope"
  scripts/vendor-linux-tesseract.sh tennoscope/app/src-tauri/vendor/tesseract
  # It empties the folder first, the placeholder that keeps it in Git included: put that back, so
  # a local build leaves the working tree as it was.
  git checkout -q -- tennoscope/app/src-tauri/vendor/tesseract/.gitkeep 2>/dev/null || true

  step "TennoScope's packages"
  (cd tennoscope/app && pnpm install --frozen-lockfile)

  # Its AppImage script runs `tauri build` without --locked: stop first if tennoscope/Cargo.lock
  # doesn't match its Cargo.toml files, as the release build does.
  step "Checking TennoScope's Cargo.lock is current"
  (cd tennoscope && cargo metadata --locked --format-version 1 >/dev/null)

  step "Building TennoScope's AppImage"
  (cd tennoscope && ./scripts/build-linux-bundles.sh --skip-gates appimage)

  step "Putting TennoScope beside orbiter's sources"
  rm -rf vendor/tennoscope
  mkdir -p vendor/tennoscope
  built=(tennoscope/target/release/bundle/appimage/*.AppImage)
  [ ${#built[@]} -eq 1 ] && [ -f "${built[0]}" ] || { echo "expected one TennoScope AppImage, found: ${built[*]}" >&2; exit 1; }
  cp "${built[0]}" vendor/tennoscope/TennoScope.AppImage
  chmod +x vendor/tennoscope/TennoScope.AppImage
  scripts/tennoscope-notice.sh vendor/tennoscope
fi

# ------------------------------------------------------------------ orbiter

step "orbiter's packages"
npm ci

# An earlier build's AppImage would make the repack find two.
rm -f "$target"/release/bundle/appimage/*.AppImage

step "Building orbiter's AppImage${version:+ ($version)}"
config=(--config src-tauri/tauri.bundle.json)
[ -n "$version" ] && config+=(--config "{\"version\":\"$version\"}")
# linuxdeploy's own strip doesn't know the newer sections Arch's toolchain writes (TennoScope's
# build sets the same).
NO_STRIP=${NO_STRIP:-true} npx tauri build --bundles appimage "${config[@]}" -- --locked

step "Repacking with TennoScope as it was built"
scripts/repack-appimage.sh

# As the release build checks: a build for the updater's end-to-end test must never be used.
if grep -q ORBITER_UPDATER_E2E "$target/release/orbiter"; then
  echo "this binary was built with the e2e-updater feature" >&2
  exit 1
fi

out=("$target"/release/bundle/appimage/*.AppImage)
printf '\nBuilt %s in %d minutes.\n' "${out[0]}" $(( ($(date +%s) - started + 59) / 60 ))
