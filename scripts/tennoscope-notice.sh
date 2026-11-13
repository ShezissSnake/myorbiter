#!/usr/bin/env bash
# What goes beside the TennoScope MyOrbiter carries: TennoScope is GPL-3.0-only, so its licence and
# where its complete source is (NOTICE.md), its own third-party notices, and the notices of the
# Tesseract it carries (THIRD-PARTY-NOTICES/tesseract/, from licenses/ in the vendored Tesseract,
# which scripts/vendor-linux-tesseract.sh and scripts/vendor-windows-tesseract.sh fill; on Windows,
# tennoscope/scripts/vendor-windows-tesseract.ps1 does).
#
#   scripts/tennoscope-notice.sh <folder with TennoScope in it>
set -euo pipefail
dir=${1:?usage: tennoscope-notice.sh <folder>}
here=$(cd "$(dirname "$0")/.." && pwd)
tesseract_notices="$here/tennoscope/app/src-tauri/vendor/tesseract/licenses"
install -m 644 "$here/tennoscope/LICENSE" "$dir/LICENSE"
install -m 644 "$here/tennoscope/THIRD_PARTY_NOTICES.md" "$dir/THIRD_PARTY_NOTICES.md"
[ -d "$tesseract_notices" ] || { echo "no Tesseract notices in $tesseract_notices: vendor Tesseract first" >&2; exit 1; }
# Windows: TennoScope's Tesseract is in tesseract/ beside it, with its DLLs, and each DLL needs its
# row in the table of projects and licences (whichever script vendored it: the .ps1 has no such
# check). On Linux there is no tesseract/ folder here (the Tesseract is inside TennoScope's AppImage).
if [ -d "$dir/tesseract" ]; then
  "$here/scripts/check-windows-dlls.sh" "$dir/tesseract"
fi
rm -rf "$dir/THIRD-PARTY-NOTICES/tesseract"
mkdir -p "$dir/THIRD-PARTY-NOTICES"
cp -R "$tesseract_notices" "$dir/THIRD-PARTY-NOTICES/tesseract"
# Where the source of those libraries is, with the written offer for the GPL and LGPL ones, goes in
# MyOrbiter's own THIRD-PARTY-NOTICES/ too (Linux: collect-linux-sources.sh wrote it; Windows: the
# table in tennoscope/packaging/windows-tesseract/). On Linux, ci/build.sh then replaces it with the
# list of every library TennoScope's AppImage carries, which the AppImage and the .deb both take,
# and repack-appimage.sh replaces that inside the AppImage with the list of every library the
# AppImage carries.
[ -f "$tesseract_notices/SOURCES.md" ] || { echo "no SOURCES.md in $tesseract_notices: vendor Tesseract again" >&2; exit 1; }
install -m 644 "$tesseract_notices/SOURCES.md" "$here/THIRD-PARTY-NOTICES/SOURCES.md"
version=$(sed -n 's/^version = "\(.*\)"$/\1/p' "$here/tennoscope/Cargo.toml" | head -n 1)
commit=$(git -C "$here" rev-parse --short HEAD 2>/dev/null || echo unknown)
cat > "$dir/NOTICE.md" <<NOTE
# TennoScope, as MyOrbiter carries it

MyOrbiter starts this TennoScope in the background so you only open MyOrbiter. It is TennoScope by
Deftera186 and its contributors (https://github.com/Deftera186/tennoscope), licensed under the GNU
General Public License v3.0 only (LICENSE, beside this file), like MyOrbiter itself.

It's built from the tennoscope/ folder of MyOrbiter's source at MyOrbiter commit $commit: TennoScope
$version with MyOrbiter's changes (tennoscope/ORBITER.md there lists them). It runs without a window
when MyOrbiter starts it, shares the reward cards with MyOrbiter and shows MyOrbiter's pick on its
overlay, leaves your warframe.market status to MyOrbiter while MyOrbiter holds it, and leaves updates to
MyOrbiter. Its Tesseract (the OCR engine that reads the reward cards) is Apache-2.0; it and the
libraries that come with it are listed, with their copyright and licence files, in
THIRD-PARTY-NOTICES/tesseract/. TennoScope's own notices are in THIRD_PARTY_NOTICES.md.
THIRD-PARTY-NOTICES/tesseract/SOURCES.md gives each library's version and where its source is, with
a written offer of the source of the GPL- and LGPL-licensed ones.

The complete source of this build, MyOrbiter and TennoScope both, comes with every MyOrbiter release as
myorbiter-source.tar.gz.
NOTE
echo "notice written in $dir"
