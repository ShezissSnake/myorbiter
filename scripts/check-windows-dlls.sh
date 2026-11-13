#!/usr/bin/env bash
# Every DLL that ships beside the Windows Tesseract needs its row in the table of projects and
# licences, tennoscope/packaging/windows-tesseract/README.md: a new installer can bring a new one,
# and the build stops rather than ship a library the notices don't name.
#
#   scripts/check-windows-dlls.sh <folder with the DLLs>
#
# Both Windows builds run it: scripts/vendor-windows-tesseract.sh (ci/build.sh's Windows half) on
# the folder it fills, and scripts/tennoscope-notice.sh on the tesseract/ folder beside TennoScope,
# which is how the Release workflow's Windows job, whose Tesseract comes from
# tennoscope/scripts/vendor-windows-tesseract.ps1, runs it too. There it runs under Git for
# Windows' bash, so it uses only bash, awk and the folder's glob. A folder with no DLL passes.
set -euo pipefail

dir=${1:?usage: check-windows-dlls.sh <folder with the DLLs>}
here=$(cd "$(dirname "$0")/.." && pwd)
table="$here/tennoscope/packaging/windows-tesseract/README.md"
[ -d "$dir" ] || { echo "no folder at $dir" >&2; exit 1; }
[ -f "$table" ] || { echo "no table of the Windows DLLs at $table" >&2; exit 1; }

# The DLLs, by their file name (.dll in any case: Windows doesn't tell them apart).
dlls=()
for f in "$dir"/*; do
  name=${f##*/}
  [ -f "$f" ] && [[ "${name,,}" == *.dll ]] && dlls+=("$name")
done
[ ${#dlls[@]} -gt 0 ] || exit 0

unlisted=()
for dll in "${dlls[@]}"; do
  # A cell of the table's first column, exactly (rows name one or more files, comma-separated).
  # The name goes through the environment: awk -v would read backslashes in it as escapes.
  DLL="$dll" awk -F'|' 'NF > 2 { n = split($2, c, ","); for (i = 1; i <= n; i++) {
      gsub(/^[ `]+|[ `]+$/, "", c[i]); if (c[i] == ENVIRON["DLL"]) found = 1 } }
    END { exit found ? 0 : 1 }' "$table" || unlisted+=("$dll")
done
if [ ${#unlisted[@]} -gt 0 ]; then
  echo "${#unlisted[@]} DLL(s) in $dir have no row in $table:" >&2
  printf '  %s\n' "${unlisted[@]}" >&2
  exit 1
fi
echo "each of the ${#dlls[@]} DLLs in $dir has its row in $table"
