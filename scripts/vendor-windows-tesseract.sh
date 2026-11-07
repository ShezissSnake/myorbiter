#!/usr/bin/env bash
# The Windows Tesseract TennoScope ships inside orbiter's Windows installer, fetched on Linux for the
# cross-compiled build (.gitlab-ci.yml, build job). It does what TennoScope's own
# tennoscope/scripts/vendor-windows-tesseract.ps1 does on Windows, with the same pinned installer:
# the version and its SHA-256 are read from that script, so there is one place to bump them.
#
#   scripts/vendor-windows-tesseract.sh <folder>
#
# The installer (UB Mannheim's NSIS build) is checked against the pinned SHA-256 before anything is
# extracted from it, and 7-Zip extracts its payload without running it. Kept: tesseract.exe, the
# DLLs beside it, and the English and orientation models, as the PowerShell script keeps; and, as
# it writes them, their notices in licenses/ (which scripts/tennoscope-notice.sh copies beside
# TennoScope): Tesseract's licence and authors from the installer, everything in
# tennoscope/packaging/windows-tesseract/ (Leptonica's licence, the table of every DLL's project
# and licence, and SOURCES.md with the written offer), and DLLS.txt, the list of what was kept.
#
# What it can't do on Linux: run tesseract.exe once to prove every DLL is there (the PowerShell
# script does). That check waits for a Windows machine (docs/testing/windows.md).
set -euo pipefail

out=${1:?usage: vendor-windows-tesseract.sh <folder>}
here=$(cd "$(dirname "$0")/.." && pwd)
ps1="$here/tennoscope/scripts/vendor-windows-tesseract.ps1"
command -v 7z >/dev/null || { echo "7z isn't installed (p7zip-full or 7zip)" >&2; exit 1; }

version=$(sed -n "s/^\$version = '\([0-9.]*\)'\r\{0,1\}$/\1/p" "$ps1")
sha256=$(sed -n "s/^\$sha256 = '\([0-9A-Fa-f]\{64\}\)'\r\{0,1\}$/\1/p" "$ps1")
[[ "$version" =~ ^[0-9]+(\.[0-9]+)+$ ]] || { echo "no \$version in $ps1" >&2; exit 1; }
[[ "$sha256" =~ ^[0-9A-Fa-f]{64}$ ]] || { echo "no \$sha256 in $ps1" >&2; exit 1; }

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
installer="$work/tesseract-setup.exe"
curl --fail --silent --show-error --location --retry 3 --output "$installer" \
  "https://digi.bib.uni-mannheim.de/tesseract/tesseract-ocr-w64-setup-${version}.exe"
echo "${sha256,,}  $installer" | sha256sum --check --strict
7z x "$installer" "-o$work/extract" >/dev/null

rm -rf "$out"
mkdir -p "$out"
cp "$work/extract/tesseract.exe" "$out/"
cp "$work"/extract/*.dll "$out/"
cp "$work/extract/tessdata/eng.traineddata" "$work/extract/tessdata/osd.traineddata" "$out/"

mkdir -p "$out/licenses"
cp "$work/extract/doc/LICENSE" "$out/licenses/tesseract-LICENSE.txt"
cp "$work/extract/doc/AUTHORS" "$out/licenses/tesseract-AUTHORS.txt"
cp "$here"/tennoscope/packaging/windows-tesseract/* "$out/licenses/"
{
  echo "From UB Mannheim's tesseract-ocr-w64-setup-${version}.exe (SHA-256 ${sha256^^}):"
  echo tesseract.exe
  find "$out" -maxdepth 1 -name '*.dll' -printf '%f\n' | LC_ALL=C sort -f
} > "$out/licenses/DLLS.txt"
# Every DLL kept needs its row in the table of projects and licences (a new installer can bring a
# new one): stop rather than ship a library the notices don't name.
table="$here/tennoscope/packaging/windows-tesseract/README.md"
unlisted=()
while IFS= read -r dll; do
  grep -qF "$dll" "$table" || unlisted+=("$dll")
done < <(find "$out" -maxdepth 1 -name '*.dll' -printf '%f\n')
[ ${#unlisted[@]} -eq 0 ] || { echo "not in $table: ${unlisted[*]}" >&2; exit 1; }
echo "Tesseract $version for Windows in $out ($(find "$out" -maxdepth 1 -name '*.dll' | wc -l) DLLs)"
