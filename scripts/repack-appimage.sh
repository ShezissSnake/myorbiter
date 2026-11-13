#!/usr/bin/env bash
# Puts the TennoScope AppImage back into MyOrbiter's AppImage as it was built, and packs again.
#
#   scripts/repack-appimage.sh            (after `tauri build --bundles appimage --config src-tauri/tauri.bundle.json`)
#
# While Tauri bundles, linuxdeploy rewrites every program it finds in the AppDir so it loads
# libraries from inside it. TennoScope's AppImage is a program to it too, and the rewrite moves its
# ELF headers, which breaks it (it then crashes on start: the runtime can no longer find its
# filesystem). So the untouched copy goes back in, and the AppDir is packed again with the same
# packer Tauri used (TennoScope's own build repacks its AppImage the same way). Before packing,
# THIRD-PARTY-NOTICES/SOURCES.md in it lists every bundled library's package, version and source.
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
# The build's target folder: the workspace's own, or CARGO_TARGET_DIR when the build used another.
bundle="${CARGO_TARGET_DIR:-$here/target}/release/bundle/appimage"
appdir="$bundle/myorbiter.AppDir"
nested="$appdir/usr/lib/myorbiter/tennoscope/TennoScope.AppImage"
pristine="$here/vendor/tennoscope/TennoScope.AppImage"
packer="${XDG_CACHE_HOME:-$HOME/.cache}/tauri/linuxdeploy-plugin-appimage.AppImage"

[ -d "$appdir" ] || { echo "no AppDir at $appdir: build the AppImage first" >&2; exit 1; }
[ -f "$nested" ] || { echo "the AppDir carries no TennoScope (built without src-tauri/tauri.bundle.json?)" >&2; exit 1; }
[ -x "$packer" ] || { echo "Tauri's AppImage packer wasn't found at $packer" >&2; exit 1; }
built=$(ls "$bundle"/*.AppImage)
[ "$(echo "$built" | wc -l)" -eq 1 ] || { echo "expected one AppImage in $bundle" >&2; exit 1; }

install -m 755 "$pristine" "$nested"
# MyOrbiter installs its own launcher entry (scripts/install-desktop.sh, myorbiter.desktop: the window's
# app id, so the taskbar icon and notifications find it). AppImageLauncher and appimaged would add a
# second one (appimagekit_…-myorbiter.desktop) whenever the AppImage runs, so the menu shows MyOrbiter
# twice. This key asks them not to (libappimage's appimage_shall_not_be_integrated).
for entry in "$appdir"/*.desktop "$appdir"/usr/share/applications/*.desktop; do
  [ -e "$entry" ] || continue
  real=$(readlink -f "$entry")
  grep -q '^X-AppImage-Integrate=' "$real" || sed -i '/^\[Desktop Entry\]/a X-AppImage-Integrate=false' "$real"
done
# Where the source of every library the AppImage carries is: linuxdeploy's (GTK, WebKitGTK and the
# rest, in the AppDir), the TennoScope AppImage's own and its Tesseract's, each matched to the Ubuntu
# package it came from on this build machine, with the written offer for the GPL and LGPL ones
# (scripts/collect-linux-sources.sh). The copyright files of linuxdeploy's go beside them in linux/,
# which is emptied first: the one the bundle took from the tree (ci/build.sh's, for TennoScope's
# AppImage alone) is written again here with the rest, and none is kept that this list doesn't name.
notices="$appdir/usr/lib/myorbiter/THIRD-PARTY-NOTICES"
[ -d "$notices" ] || { echo "no THIRD-PARTY-NOTICES in the AppDir at $notices" >&2; exit 1; }
rm -rf "$notices/linux"
inner=$(mktemp -d)
(cd "$inner" && APPIMAGE_EXTRACT_AND_RUN=1 "$pristine" --appimage-extract >/dev/null)
NOTICES_DIR="$notices/linux" "$here/scripts/collect-linux-sources.sh" "$notices/SOURCES.md" "$appdir/usr/lib" "$appdir/usr/bin" "$inner/squashfs-root/usr"
rm -rf "$inner"

log=$(mktemp)
(cd "$bundle" && APPIMAGE_EXTRACT_AND_RUN=1 LDAI_OUTPUT="$built" OUTPUT="$built" "$packer" --appdir "$appdir" >"$log" 2>&1) || { cat "$log" >&2; exit 1; }
rm -f "$log"

# Proof: the TennoScope inside the final AppImage is byte for byte the one built, and runs.
check=$(mktemp -d)
trap 'rm -rf "$check"' EXIT
(cd "$check" && APPIMAGE_EXTRACT_AND_RUN=1 "$built" --appimage-extract usr/lib/myorbiter/tennoscope/TennoScope.AppImage >/dev/null)
cmp "$check/squashfs-root/usr/lib/myorbiter/tennoscope/TennoScope.AppImage" "$pristine"
"$check/squashfs-root/usr/lib/myorbiter/tennoscope/TennoScope.AppImage" --appimage-offset >/dev/null
# And its launcher entry asks AppImageLauncher not to add a second one.
(cd "$check" && APPIMAGE_EXTRACT_AND_RUN=1 "$built" --appimage-extract 'usr/share/applications/*' >/dev/null)
grep -q '^X-AppImage-Integrate=false' "$check"/squashfs-root/usr/share/applications/myorbiter.desktop
# And it says where the source of what it carries is.
(cd "$check" && APPIMAGE_EXTRACT_AND_RUN=1 "$built" --appimage-extract usr/lib/myorbiter/THIRD-PARTY-NOTICES/SOURCES.md >/dev/null)
grep -q 'complete corresponding source code' "$check"/squashfs-root/usr/lib/myorbiter/THIRD-PARTY-NOTICES/SOURCES.md
echo "repacked $(basename "$built") ($(du -h "$built" | cut -f1)) with TennoScope intact"
