#!/usr/bin/env bash
# Where the source of every Debian/Ubuntu package a download carries files from can be had, and
# MyOrbiter's written offer for the GPL- and LGPL-licensed ones among them.
#
#   scripts/collect-linux-sources.sh <SOURCES.md> <file or folder>...
#
# Each file (folders are searched for shared libraries and programs) is matched to the package
# that installed it on this machine, the build machine: by its own path when it's still where the
# package put it, else by its name (a library linuxdeploy or vendor-linux-tesseract.sh copied into
# a bundle). For each package SOURCES.md gives its exact version and its source package's, as
#
#   dpkg-query -W -f='${Package} ${Version} ${source:Package} ${source:Version}\n'
#
# says, with the Ubuntu page for that source (launchpad.net/ubuntu/+source/<srcpkg>/<version>),
# the licences its copyright file names, and which are GPL or LGPL. Files no package owns (MyOrbiter
# and TennoScope themselves, the AppImage runtime) are listed apart.
#
# With NOTICES_DIR set, each package's copyright file is also copied there (<package>.copyright),
# for bundles whose libraries collect-linux-notices.sh didn't see (linuxdeploy's).
#
# A package without its copyright file (/usr/share/doc/<package>/copyright) stops it, as it stops
# collect-linux-notices.sh: every such package is named, and SOURCES.md isn't written. The download
# must not carry a library without its notice. A file no package owns doesn't stop it (see above).
# COPYRIGHT_DOC_DIR stands in for /usr/share/doc (the tests' made-up packages).
#
# Needs dpkg (Debian, Ubuntu: what the release builds run on). Without it, it writes a SOURCES.md
# that says so, rather than an empty list.
set -euo pipefail

out=${1:?usage: collect-linux-sources.sh <SOURCES.md> <file or folder>...}
shift
doc_dir=${COPYRIGHT_DOC_DIR:-/usr/share/doc}
mkdir -p "$(dirname "$out")"

offer() {
  cat <<'OFFER'
## Written offer

For three years from the date of this release, the complete corresponding source code of the GPL-
and LGPL-licensed libraries bundled in this build is available on request: open an issue at
https://github.com/ShezissSnake/myorbiter/issues or contact the maintainer.

The source of MyOrbiter and TennoScope (both GPL-3.0-only) is attached to every release as
myorbiter-source.tar.gz.
OFFER
}

# The files to look at: shared libraries and programs, whatever folders they're in.
files=()
for arg in "$@"; do
  if [ -d "$arg" ]; then
    while IFS= read -r -d '' f; do files+=("$f"); done < <(find "$arg" -type f \( -name '*.so' -o -name '*.so.*' -o -perm -u+x \) -print0 | sort -z)
  elif [ -e "$arg" ]; then
    files+=("$arg")
  else
    echo "warning: $arg isn't there" >&2
  fi
done

if ! command -v dpkg-query >/dev/null; then
  echo "warning: no dpkg here, so the bundled packages' sources weren't listed" >&2
  {
    echo "# Sources of the bundled libraries"
    echo
    echo "This build was made on a system without dpkg, so the packages its libraries came from"
    echo "weren't listed automatically."
    echo
    offer
  } >"$out"
  exit 0
fi

# The package that installed a file: by its path (merged /usr either way, through symlinks), else
# by its name anywhere under the system's library and program folders.
owner() {
  local file=$1 real candidate name hit
  real=$(readlink -f "$file")
  for candidate in "$file" "$real" "/usr$file" "/usr$real" "${file#/usr}" "${real#/usr}"; do
    [ -n "$candidate" ] || continue
    hit=$(dpkg-query -S "$candidate" 2>/dev/null | head -n 1 | cut -d: -f1) && [ -n "$hit" ] && { echo "$hit"; return 0; }
  done
  name=$(basename "$file")
  hit=$(dpkg-query -S "*/$name" 2>/dev/null | grep -E "^[^ ]+: (/usr)?/(lib|bin|sbin)[^ ]*/$(printf '%s' "$name" | sed 's/[.+]/\\&/g')\$" | head -n 1 | cut -d: -f1) || true
  [ -n "$hit" ] && { echo "$hit"; return 0; }
  return 1
}

# The licences a package's copyright file names: DEP-5's License: lines, else the GPL family by name.
licences() {
  local doc=$1
  [ -f "$doc" ] || { echo "(no copyright file)"; return; }
  local named
  # GPL-family licences first, then the others, at most eight in all.
  named=$(sed -n 's/^License: *\([^ ].*\)$/\1/p' "$doc" | sed 's/ *$//' | sort -u | awk '/GPL/ { print 0 "\t" $0; next } { print 1 "\t" $0 }' | sort -t "$(printf '\t')" -k1,1 -s | cut -f2-)
  if [ -n "$named" ]; then
    local n
    n=$(printf '%s\n' "$named" | wc -l)
    printf '%s\n' "$named" | head -n 8 | paste -sd ',' - | sed 's/,/, /g' | tr -d '\n'
    [ "$n" -gt 8 ] && printf ' and %d more' $((n - 8))
    echo
    return
  fi
  grep -oE 'GNU (Lesser|Library) General Public License|GNU General Public License|BSD|MIT|Apache License' "$doc" | sort -u | paste -sd ',' - | sed 's/,/, /g' || true
}

declare -A pkgs=() byfile=()
unowned=()
for f in "${files[@]}"; do
  if p=$(owner "$f"); then
    pkgs[$p]=1
    byfile[$p]+="$(basename "$f") "
  else
    unowned+=("$(basename "$f")")
  fi
done

rows=()
gpl=()
nocopyright=()
for p in $(printf '%s\n' "${!pkgs[@]}" | sort); do
  read -r name version src srcver < <(dpkg-query -W -f='${Package} ${Version} ${source:Package} ${source:Version}\n' "$p" | head -n 1)
  doc="$doc_dir/${name%%:*}/copyright"
  [ -f "$doc" ] || { nocopyright+=("$name"); continue; }
  lic=$(licences "$doc")
  [ -n "$lic" ] || lic="(see its copyright file)"
  link="https://launchpad.net/ubuntu/+source/$src/$srcver"
  mark=""
  if printf '%s' "$lic" | grep -qE 'GPL|General Public License'; then mark="yes"; gpl+=("$name"); fi
  shown=$(printf '%s\n' ${byfile[$p]} | sort -u | head -n 6 | paste -sd ' ' -)
  rows+=("| $name | $version | $src $srcver | $lic | $mark | $link | $shown |")
  if [ -n "${NOTICES_DIR:-}" ] && [ -f "$doc" ] && [ ! -f "$NOTICES_DIR/${name%%:*}.copyright" ]; then
    mkdir -p "$NOTICES_DIR"
    install -m 644 "$doc" "$NOTICES_DIR/${name%%:*}.copyright"
  fi
done
if [ ${#nocopyright[@]} -gt 0 ]; then
  echo "${#nocopyright[@]} bundled package(s) have no copyright file in $doc_dir/<package>/, so their licence can't be shipped:" >&2
  printf '  %s\n' "${nocopyright[@]}" >&2
  exit 1
fi

. /etc/os-release 2>/dev/null || true
{
  echo "# Sources of the bundled libraries"
  echo
  echo "This build carries files from these ${PRETTY_NAME:-Debian/Ubuntu} packages (the build machine's), at"
  echo "exactly these versions. Each package's source, at that version, is on the page linked: Ubuntu"
  echo "keeps the source of every version it published (https://launchpad.net/ubuntu/+source/<source"
  echo "package>/<version>). \"(L)GPL\" marks the packages whose copyright file names the GPL or the"
  echo "LGPL for any part of them (for some, only build files): the written offer below covers them all."
  echo
  echo "| Package | Version | Source package | Licences (its copyright file) | (L)GPL | Source | Files |"
  echo "|---|---|---|---|---|---|---|"
  printf '%s\n' "${rows[@]}"
  echo
  if [ ${#gpl[@]} -gt 0 ]; then
    echo "GPL or LGPL: $(printf '%s\n' "${gpl[@]}" | paste -sd ',' - | sed 's/,/, /g')."
    echo
  fi
  if [ ${#unowned[@]} -gt 0 ]; then
    echo "Not from a package (MyOrbiter's and TennoScope's own programs, the AppImage runtime and the"
    echo "like): $(printf '%s\n' "${unowned[@]}" | sort -u | paste -sd ',' - | sed 's/,/, /g')."
    echo
  fi
  offer
} >"$out"
echo "sources of ${#pkgs[@]} packages (${#gpl[@]} GPL or LGPL) listed in $out"
