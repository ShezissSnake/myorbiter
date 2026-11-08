#!/usr/bin/env bash
# The `publish` job (.gitlab-ci.yml): everything the build's release carries, checked, and put in
# the package registry as myorbiter/<version>/ (ci/lib.sh). It runs after `sign`, on main or a
# release tag only, and builds nothing.
#
#   ci/publish.sh <build number>          with the downloads (and their .sig files) in release-files/
#
# What it adds: myorbiter-source.tar.gz (the complete source of the commit, as the GPL-3.0 asks),
# latest.json (scripts/updater-manifest.mjs: this build's version, notes from the commit subjects
# since the build on Experimental, each signed download at its public address, every signature
# checked again against tauri.conf.json's public key) when the build is signed, and SHA256SUMS of
# every file. Every file is checked against SHA256SUMS before it's uploaded. It writes, for the
# jobs after it, publish.env (VERSION, BUILD, SIGNED, COMPLETE: signed, with both the Linux and the
# Windows download, so it can go on a channel; and WINDOWS) and release-links.json (the release's
# links to every file).
here=$(cd "$(dirname "$0")/.." && pwd)
cd "$here"
# shellcheck source=ci/lib.sh
. ci/lib.sh

n=${1:?usage: ci/publish.sh <build number>}
[[ "$n" =~ ^[1-9][0-9]{0,8}$ ]] || { echo "not a build number: $n" >&2; exit 2; }
version="0.2.$n"
tag="build-$n"
files=release-files
base="$public_packages/myorbiter/$version"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# A release tag publishes only a commit that is on main (as a run on main does).
if [ -n "${CI_COMMIT_TAG:-}" ]; then
  git fetch --quiet origin "+refs/heads/$CI_DEFAULT_BRANCH:refs/remotes/origin/$CI_DEFAULT_BRANCH"
  git merge-base --is-ancestor "$CI_COMMIT_SHA" "origin/$CI_DEFAULT_BRANCH" ||
    { echo "$CI_COMMIT_TAG isn't on $CI_DEFAULT_BRANCH: nothing is published" >&2; exit 1; }
fi

[ -f "$files/myorbiter_${version}_amd64.AppImage" ] || { echo "no AppImage for $version in $files/" >&2; exit 1; }
signed=false
[ -f "$files/myorbiter_${version}_amd64.AppImage.sig" ] && signed=true
windows=false
[ -f "$files/myorbiter_${version}_x64-setup.exe" ] && windows=true

# The source of exactly this commit, MyOrbiter and tennoscope/ both, with the CI and scripts that build them.
git archive --format=tar.gz --prefix="myorbiter-$tag/" --output "$files/myorbiter-source.tar.gz" "$CI_COMMIT_SHA"

complete=false
if $signed; then
  # Release notes: the commit subjects since the build on Experimental, when that one is an
  # ancestor of this one; otherwise the last 15.
  prev=""
  if fetch "$packages_api/channel/experimental/latest.json" "$work/previous.json"; then
    prev=$(jq -r '.commit // empty' "$work/previous.json")
  fi
  if [[ "$prev" =~ ^[0-9a-f]{40}$ ]] && git cat-file -e "$prev^{commit}" 2>/dev/null && git merge-base --is-ancestor "$prev" "$CI_COMMIT_SHA"; then
    git log --format=%s "$prev..$CI_COMMIT_SHA" | node scripts/updater-manifest.mjs notes >"$work/notes.txt"
  else
    git log -n 15 --format=%s "$CI_COMMIT_SHA" | node scripts/updater-manifest.mjs notes >"$work/notes.txt"
  fi
  cat "$work/notes.txt"

  node scripts/updater-manifest.mjs manifest --dir "$files" --version "$version" --base "$base" \
    --commit "$CI_COMMIT_SHA" --notes-file "$work/notes.txt" --out "$files/latest.json"
  if node scripts/updater-manifest.mjs check --manifest "$files/latest.json" --version "$version" \
      --require linux-x86_64,windows-x86_64 --base "$base"; then
    complete=true
  else
    echo "Not for a channel: $version has no Windows installer, so it stays off Experimental (and can't be promoted)."
  fi
  echo "Updater manifest for $version:"
  cat "$files/latest.json"
else
  echo "No updater files: the build isn't signed (no signing key for this pipeline), so no channel will offer $version."
fi

# SHA256SUMS for every file, beside them; then exactly those files, each with its checksum.
(cd "$files" && sha256sum -- * >"$work/SHA256SUMS" && mv "$work/SHA256SUMS" SHA256SUMS && cat SHA256SUMS)
(cd "$files" && sha256sum --check --strict --quiet SHA256SUMS &&
  diff <(find . -maxdepth 1 -type f ! -name SHA256SUMS -printf '%f\n' | sort) <(cut -c67- SHA256SUMS | sort))

for f in "$files"/*; do
  echo "uploading $(basename "$f")"
  put_file myorbiter "$version" "$f"
done

# The release's links, one per file, at their public addresses (the release job makes build-<n>).
(cd "$files" && find . -maxdepth 1 -type f -printf '%f\n' | sort) |
  jq -R -s --arg base "$base" '[split("\n")[] | select(length > 0) | {
      name: .,
      url: "\($base)/\(@uri "\(.)")",
      link_type: (if test("\\.(AppImage|deb|exe)$") then "package" else "other" end),
      direct_asset_path: "/\(.)"
    }]' >release-links.json

{
  echo "BUILD=$n"
  echo "VERSION=$version"
  echo "SIGNED=$signed"
  echo "COMPLETE=$complete"
  echo "WINDOWS=$windows"
} >publish.env
echo "$version is in the package registry: $base/"
