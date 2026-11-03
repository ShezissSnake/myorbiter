#!/usr/bin/env bash
# The copyright and licence files of the distribution packages that the given files come from, so
# a bundle that carries those files (the vendored Tesseract and its libraries) carries their
# notices too.
#
#   scripts/collect-linux-notices.sh <notices folder> <file>...
#
# For each file it finds the package that installed it, then copies that package's notice into
# the folder once: `/usr/share/doc/<package>/copyright` on Debian and Ubuntu (what the release
# builds run on), `/usr/share/licenses/<package>/` on Arch and its kin. PACKAGES.txt lists each file
# with its package and version. On Debian and Ubuntu a file without a package, or a package
# without its copyright file, is an error: the release must not ship a library without its notice.
# Elsewhere (no dpkg, no pacman) it says what it couldn't do and writes that into the folder.
set -euo pipefail

out=${1:?usage: collect-linux-notices.sh <folder> <file>...}
shift
mkdir -p "$out"
list="$out/PACKAGES.txt"
{
  echo "Files bundled from this system's packages, with the package each came from."
  echo "Each package's copyright and licence file is beside this list."
  echo
} >"$list"

# dpkg knows a file by the path its package installed it at: on merged-/usr systems ldd can report
# /lib/... for a file installed as /usr/lib/... (or the other way round), and a library is often
# reached through a symlink to the versioned file.
owner_dpkg() {
  local file=$1 real candidate
  real=$(readlink -f "$file")
  for candidate in "$file" "$real" "/usr$file" "/usr$real" "${file#/usr}" "${real#/usr}"; do
    [ -n "$candidate" ] || continue
    dpkg-query -S "$candidate" 2>/dev/null | head -n 1 | cut -d: -f1 && return 0
  done
  return 1
}

if command -v dpkg-query >/dev/null; then
  declare -A seen=()
  for file in "$@"; do
    pkg=$(owner_dpkg "$file") || { echo "no package owns $file: its licence can't be found" >&2; exit 1; }
    version=$(dpkg-query -W -f='${Version}' "$pkg")
    echo "$(basename "$file")  $pkg $version" >>"$list"
    [ -n "${seen[$pkg]:-}" ] && continue
    seen[$pkg]=1
    # Multi-arch packages are named pkg:amd64 by dpkg-query -S; the doc folder is the bare name.
    doc="/usr/share/doc/${pkg%%:*}/copyright"
    [ -f "$doc" ] || { echo "$pkg has no $doc" >&2; exit 1; }
    install -m 644 "$doc" "$out/${pkg%%:*}.copyright"
  done
elif command -v pacman >/dev/null; then
  declare -A seen=()
  for file in "$@"; do
    pkg=$(pacman -Qoq "$(readlink -f "$file")" 2>/dev/null) || { echo "warning: no package owns $file" >&2; echo "$(basename "$file")  (no package)" >>"$list"; continue; }
    version=$(pacman -Q "$pkg" | cut -d' ' -f2)
    licence=$(LC_ALL=C pacman -Qi "$pkg" | sed -n 's/^Licenses *: //p')
    echo "$(basename "$file")  $pkg $version  ($licence)" >>"$list"
    [ -n "${seen[$pkg]:-}" ] && continue
    seen[$pkg]=1
    if [ -d "/usr/share/licenses/$pkg" ]; then
      mkdir -p "$out/$pkg"
      cp -L /usr/share/licenses/"$pkg"/* "$out/$pkg/"
    fi
  done
else
  echo "warning: neither dpkg nor pacman is here, so the bundled libraries' notices weren't collected" >&2
  {
    echo "This build was made on a system without dpkg or pacman, so the notices of these files"
    echo "weren't collected automatically:"
    for file in "$@"; do echo "  $(basename "$file")"; done
  } >>"$list"
fi
echo "notices of $# files collected in $out"
