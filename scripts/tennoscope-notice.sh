#!/usr/bin/env bash
# What goes beside the TennoScope orbiter carries: TennoScope is GPL-3.0-only, so its licence and
# where its complete source is (NOTICE.md), its own third-party notices, and the notices of the
# Tesseract it carries (THIRD-PARTY-NOTICES/tesseract/, from licenses/ in the vendored Tesseract,
# which scripts/vendor-linux-tesseract.sh and tennoscope/scripts/vendor-windows-tesseract.ps1 fill).
#
#   scripts/tennoscope-notice.sh <folder with TennoScope in it>
set -euo pipefail
dir=${1:?usage: tennoscope-notice.sh <folder>}
here=$(cd "$(dirname "$0")/.." && pwd)
tesseract_notices="$here/tennoscope/app/src-tauri/vendor/tesseract/licenses"
install -m 644 "$here/tennoscope/LICENSE" "$dir/LICENSE"
install -m 644 "$here/tennoscope/THIRD_PARTY_NOTICES.md" "$dir/THIRD_PARTY_NOTICES.md"
[ -d "$tesseract_notices" ] || { echo "no Tesseract notices in $tesseract_notices: vendor Tesseract first" >&2; exit 1; }
rm -rf "$dir/THIRD-PARTY-NOTICES/tesseract"
mkdir -p "$dir/THIRD-PARTY-NOTICES"
cp -R "$tesseract_notices" "$dir/THIRD-PARTY-NOTICES/tesseract"
# Where the source of those libraries is, with the written offer for the GPL and LGPL ones, goes in
# orbiter's own THIRD-PARTY-NOTICES/ too (Linux: collect-linux-sources.sh wrote it; Windows: the
# table in tennoscope/packaging/windows-tesseract/). On Linux, repack-appimage.sh then replaces it
# inside the AppImage with the list of every library the AppImage carries.
[ -f "$tesseract_notices/SOURCES.md" ] || { echo "no SOURCES.md in $tesseract_notices: vendor Tesseract again" >&2; exit 1; }
install -m 644 "$tesseract_notices/SOURCES.md" "$here/THIRD-PARTY-NOTICES/SOURCES.md"
version=$(sed -n 's/^version = "\(.*\)"$/\1/p' "$here/tennoscope/Cargo.toml" | head -n 1)
commit=$(git -C "$here" rev-parse --short HEAD 2>/dev/null || echo unknown)
cat > "$dir/NOTICE.md" <<NOTE
# TennoScope, as orbiter carries it

orbiter starts this TennoScope in the background so you only open orbiter. It is TennoScope by
Deftera186 and its contributors (https://github.com/Deftera186/tennoscope), licensed under the GNU
General Public License v3.0 only (LICENSE, beside this file), like orbiter itself.

It's built from the tennoscope/ folder of orbiter's source at orbiter commit $commit: TennoScope
$version with orbiter's changes (tennoscope/ORBITER.md there lists them). It runs without a window
when orbiter starts it, shares the reward cards with orbiter and shows orbiter's pick on its
overlay, leaves your warframe.market status to orbiter while orbiter holds it, and leaves updates to
orbiter. Its Tesseract (the OCR engine that reads the reward cards) is Apache-2.0; it and the
libraries that come with it are listed, with their copyright and licence files, in
THIRD-PARTY-NOTICES/tesseract/. TennoScope's own notices are in THIRD_PARTY_NOTICES.md.
THIRD-PARTY-NOTICES/tesseract/SOURCES.md gives each library's version and where its source is, with
a written offer of the source of the GPL- and LGPL-licensed ones.

The complete source of this build, orbiter and TennoScope both, comes with every orbiter release as
orbiter-source.tar.gz.
NOTE
echo "notice written in $dir"
