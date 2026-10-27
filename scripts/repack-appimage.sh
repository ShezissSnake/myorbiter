#!/usr/bin/env bash
# Puts the TennoScope AppImage back into orbiter's AppImage as it was built, and packs again.
#
#   scripts/repack-appimage.sh            (after `tauri build --bundles appimage --config src-tauri/tauri.bundle.json`)
#
# While Tauri bundles, linuxdeploy rewrites every program it finds in the AppDir so it loads
# libraries from inside it. TennoScope's AppImage is a program to it too, and the rewrite moves its
# ELF headers, which breaks it (it then crashes on start: the runtime can no longer find its
# filesystem). So the untouched copy goes back in, and the AppDir is packed again with the same
# packer Tauri used (TennoScope's own build repacks its AppImage the same way).
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
bundle="$here/target/release/bundle/appimage"
appdir="$bundle/orbiter.AppDir"
nested="$appdir/usr/lib/orbiter/tennoscope/TennoScope.AppImage"
pristine="$here/vendor/tennoscope/TennoScope.AppImage"
packer="${XDG_CACHE_HOME:-$HOME/.cache}/tauri/linuxdeploy-plugin-appimage.AppImage"

[ -d "$appdir" ] || { echo "no AppDir at $appdir: build the AppImage first" >&2; exit 1; }
[ -f "$nested" ] || { echo "the AppDir carries no TennoScope (built without src-tauri/tauri.bundle.json?)" >&2; exit 1; }
[ -x "$packer" ] || { echo "Tauri's AppImage packer wasn't found at $packer" >&2; exit 1; }
built=$(ls "$bundle"/*.AppImage)
[ "$(echo "$built" | wc -l)" -eq 1 ] || { echo "expected one AppImage in $bundle" >&2; exit 1; }

install -m 755 "$pristine" "$nested"
log=$(mktemp)
(cd "$bundle" && APPIMAGE_EXTRACT_AND_RUN=1 LDAI_OUTPUT="$built" OUTPUT="$built" "$packer" --appdir "$appdir" >"$log" 2>&1) || { cat "$log" >&2; exit 1; }
rm -f "$log"

# Proof: the TennoScope inside the final AppImage is byte for byte the one built, and runs.
check=$(mktemp -d)
trap 'rm -rf "$check"' EXIT
(cd "$check" && APPIMAGE_EXTRACT_AND_RUN=1 "$built" --appimage-extract usr/lib/orbiter/tennoscope/TennoScope.AppImage >/dev/null)
cmp "$check/squashfs-root/usr/lib/orbiter/tennoscope/TennoScope.AppImage" "$pristine"
"$check/squashfs-root/usr/lib/orbiter/tennoscope/TennoScope.AppImage" --appimage-offset >/dev/null
echo "repacked $(basename "$built") ($(du -h "$built" | cut -f1)) with TennoScope intact"
