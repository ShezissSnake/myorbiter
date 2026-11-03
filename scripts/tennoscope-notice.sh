#!/usr/bin/env bash
# What goes beside the TennoScope orbiter carries: TennoScope is GPL-3.0-only, so its licence (the
# release workflow copies tennoscope/LICENSE beside it) and where its complete source is.
#
#   scripts/tennoscope-notice.sh <folder with TennoScope in it>
set -euo pipefail
dir=${1:?usage: tennoscope-notice.sh <folder>}
here=$(cd "$(dirname "$0")/.." && pwd)
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
orbiter. Its Tesseract (the OCR engine that reads the reward cards) is Apache-2.0.

The complete source of this build, orbiter and TennoScope both, comes with every orbiter release as
orbiter-source.tar.gz.
NOTE
echo "notice written in $dir"
