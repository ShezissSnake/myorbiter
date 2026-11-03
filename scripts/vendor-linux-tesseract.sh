#!/usr/bin/env bash
# A Tesseract that runs on any Linux without installing anything: the program, every library it
# loads (bar the C library itself, which every system has), and the English model, in one folder.
#
#   scripts/vendor-linux-tesseract.sh <folder>
#
# TennoScope reads the reward cards with Tesseract and looks for `tesseract/tesseract` in its own
# resource folder before the system's one (its Windows installer ships one the same way), passing
# that folder as `--tessdata-dir`. The libraries sit in `lib/` beside it, found through an RPATH of
# `$ORIGIN/lib` (an RPATH, not a RUNPATH, so an LD_LIBRARY_PATH the AppImage sets can't pull in
# different copies).
#
# Needs tesseract-ocr, tesseract-ocr-eng and patchelf installed where it runs (the build machine).
# The notices of everything copied go in `licenses/` (scripts/collect-linux-notices.sh), with
# SOURCES.md: each package's version, where its source is, and the written offer
# (scripts/collect-linux-sources.sh).
set -euo pipefail

out=${1:?usage: vendor-linux-tesseract.sh <folder>}
src=$(command -v tesseract) || { echo "tesseract isn't installed" >&2; exit 1; }
command -v patchelf >/dev/null || { echo "patchelf isn't installed" >&2; exit 1; }

# The English model, wherever the distribution keeps it. Not osd.traineddata (11 MB): the reward
# reads use page modes 6 and 11, which never ask for orientation detection.
model=$(find /usr/share/tesseract-ocr /usr/share/tessdata /usr/share -name eng.traineddata -print -quit 2>/dev/null || true)
[ -n "$model" ] || { echo "eng.traineddata wasn't found (install tesseract-ocr-eng)" >&2; exit 1; }

rm -rf "$out"
mkdir -p "$out/lib"
install -m 755 "$src" "$out/tesseract"
install -m 644 "$model" "$out/"

# Every library the program loads, resolved the way the loader resolves it here. The C library,
# its loader and its split-out parts stay the system's: they must match the kernel interface the
# system provides, and every Linux has them.
skip='^(linux-vdso|linux-gate|ld-linux|libc\.so|libm\.so|libdl\.so|libpthread\.so|librt\.so|libresolv\.so|libutil\.so)'
# Some distributions (Arch, CachyOS) list the loader by its full path ("/lib64/ld-linux-x86-64.so.2
# => …"): the name is taken without its folder.
ldd "$src" | awk '/=> \// { print $1, $3 }' | while read -r name path; do
  name=${name##*/}
  if [[ $name =~ $skip ]]; then continue; fi
  install -m 644 "$path" "$out/lib/$name"
done

# Their notices: the copyright and licence file of every package the program, its model and its
# libraries came from, in licenses/ beside them (PACKAGES.txt there says which file is whose).
mapfile -t libs < <(ldd "$src" | awk '/=> \// { print $1, $3 }' | while read -r name path; do
  [[ ${name##*/} =~ $skip ]] || echo "$path"
done)
"$(dirname "$0")/collect-linux-notices.sh" "$out/licenses" "$src" "$model" "${libs[@]}"
# And where each package's source is, at the version copied, with the written offer for the GPL and
# LGPL ones (scripts/collect-linux-sources.sh): licenses/SOURCES.md.
"$(dirname "$0")/collect-linux-sources.sh" "$out/licenses/SOURCES.md" "$src" "$model" "${libs[@]}"

# The program finds them beside it; each library finds its siblings in the same folder.
patchelf --force-rpath --set-rpath '$ORIGIN/lib' "$out/tesseract"
for lib in "$out"/lib/*; do
  patchelf --force-rpath --set-rpath '$ORIGIN' "$lib"
done

# Proof it runs from there, with nothing from the system's Tesseract on the path.
probe=$(mktemp -d)
trap 'rm -rf "$probe"' EXIT
printf 'P2\n8 8\n255\n%s\n' "$(printf '255 %.0s' $(seq 64))" >"$probe/blank.pgm"
env -i PATH=/nonexistent "$out/tesseract" --tessdata-dir "$out" --version >/dev/null
env -i PATH=/nonexistent "$out/tesseract" --tessdata-dir "$out" "$probe/blank.pgm" - --psm 11 >/dev/null 2>&1
echo "tesseract vendored in $out ($(du -sh "$out" | cut -f1), $(ls "$out/lib" | wc -l) libraries)"
