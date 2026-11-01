#!/usr/bin/env bash
# What goes beside the TennoScope orbiter carries: TennoScope is GPL-3.0, so its licence, the
# change orbiter makes to it, and where the full source is.
#
#   scripts/tennoscope-notice.sh <folder with TennoScope in it>
set -euo pipefail
dir=${1:?usage: tennoscope-notice.sh <folder>}
here=$(cd "$(dirname "$0")/.." && pwd)
commit=${TENNOSCOPE_COMMIT:-e5755f8}
cp "$here/patches/tennoscope-orbiter.patch" "$dir/"
cat > "$dir/NOTICE.md" <<NOTE
# TennoScope, as orbiter carries it

orbiter starts this TennoScope in the background so you only open orbiter. It is TennoScope by
Deftera186 (https://github.com/Deftera186/tennoscope), licensed under the GNU General Public
License v3.0 (LICENSE, beside this file), not orbiter's MIT licence.

It's built from TennoScope's commit $commit with one change, \`tennoscope-orbiter.patch\` (beside
this file): it runs without a window when orbiter starts it, shares the reward cards with orbiter
and shows orbiter's pick on its overlay, leaves your warframe.market status to orbiter while
orbiter holds it, and leaves updates to orbiter. Its Tesseract (the OCR engine that reads the
reward cards) is Apache-2.0.

The complete source of this build is that commit with the patch applied; every orbiter release
also carries it as tennoscope-orbiter-source.tar.gz.
NOTE
echo "notice written in $dir"
