#!/usr/bin/env bash
# The `experimental` job (.gitlab-ci.yml): the build becomes Experimental's. Its latest.json, as
# `publish` uploaded it to orbiter/<version>/, is copied to channel/experimental/latest.json, which
# installed copies on Experimental read. Never backwards: a pipeline that finishes after a newer
# one leaves the channel on the newer build. Runs only for a complete build (signed, Linux and
# Windows), after its release exists.
#
#   ci/experimental.sh <version>
here=$(cd "$(dirname "$0")/.." && pwd)
cd "$here"
# shellcheck source=ci/lib.sh
. ci/lib.sh

version=${1:?usage: ci/experimental.sh <version>}
[[ "$version" =~ ^0\.2\.[1-9][0-9]{0,8}$ ]] || { echo "not a build version: $version" >&2; exit 2; }
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

fetch "$packages_api/orbiter/$version/latest.json" "$work/latest.json" ||
  { echo "orbiter/$version has no latest.json" >&2; exit 1; }
node scripts/updater-manifest.mjs check --manifest "$work/latest.json" --version "$version" \
  --require linux-x86_64,windows-x86_64 --base "$public_packages/orbiter/$version"

current=""
if fetch "$packages_api/channel/experimental/latest.json" "$work/current.json"; then
  current=$(jq -r '.version // empty' "$work/current.json")
fi
if [ -n "$current" ] && [ "$(newest "$current" "$version")" != "$version" ]; then
  echo "Experimental stays on $current, newer than $version."
  exit 0
fi
put_file channel experimental "$work/latest.json" latest.json
echo "$version is now Experimental's build. Promote it with a pipeline: task promote, build ${version##*.}."
