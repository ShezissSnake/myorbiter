#!/usr/bin/env bash
# Moves a build up a channel (.gitlab-ci.yml, task promote): nothing is built. The build's own
# latest.json, pointing at the files that were tested, is copied to channel/<beta|stable>/, where
# installed copies on that channel look for updates (src-tauri/src/updates.rs).
#
#   ci/promote.sh check <build number>              the `promote-check` job: writes promote.env
#   ci/promote.sh promote <build number> <channel>  the `promote` job: needs promote.env's checksum
#
# `check` checks the build: its latest.json is for 0.2.<n> with both the Linux and Windows
# downloads, every download in it is that system's file in orbiter/0.2.<n>/ and nowhere else, and
# each one's signature checks out against the public key in tauri.conf.json. `promote` takes
# latest.json again, only if it's byte for byte the one `check` passed, and copies it. Promoting
# to Stable also records the build in stable-builds/ (so pruning never deletes it) and moves Beta up
# to it when Beta's build is older (Beta is never behind Stable).
#
# The build number and channel come from the pipeline's inputs and are checked here before use:
# digits only, and one of the two channels.
here=$(cd "$(dirname "$0")/.." && pwd)
cd "$here"
# shellcheck source=ci/lib.sh
. ci/lib.sh

what=${1:-}
n=${2:-}
[[ "$n" =~ ^[1-9][0-9]{0,8}$ ]] || { echo "not a build number: '$n' (digits only, the n of build-<n>)" >&2; exit 2; }
version="0.2.$n"
base="$public_packages/orbiter/$version"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

case "$what" in
  check)
    fetch "$packages_api/orbiter/$version/latest.json" "$work/latest.json" ||
      { echo "build $n has no latest.json: it was built without the signing key, pruned, or never published" >&2; exit 1; }
    # Its version, both systems, every download in this build's own folder and nowhere else.
    node scripts/updater-manifest.mjs check --manifest "$work/latest.json" --version "$version" \
      --require linux-x86_64,windows-x86_64 --base "$base"
    # The files it points at, checked against the key installed copies use.
    for platform in linux-x86_64 windows-x86_64; do
      url=$(jq -r --arg p "$platform" '.platforms[$p].url' "$work/latest.json")
      file=$(basename "$url")
      fetch "$packages_api/orbiter/$version/$file" "$work/$file" || { echo "$platform: $url isn't in orbiter/$version" >&2; exit 1; }
      jq -r --arg p "$platform" '.platforms[$p].signature' "$work/latest.json" >"$work/$file.manifest.sig"
      node scripts/updater-manifest.mjs verify --file "$work/$file" --sig "$work/$file.manifest.sig" --version "$version"
    done
    echo "MANIFEST_SHA256=$(sha256sum "$work/latest.json" | cut -d' ' -f1)" >promote.env
    echo "Build $n ($version) checks out."
    ;;
  promote)
    channel=${3:-}
    case "$channel" in
      beta) label=Beta ;;
      stable) label=Stable ;;
      *) echo "not a channel: '$channel' (beta or stable)" >&2; exit 2 ;;
    esac
    [[ "${MANIFEST_SHA256:-}" =~ ^[0-9a-f]{64}$ ]] || { echo "the check passed no manifest" >&2; exit 1; }
    # The manifest the check passed, and no other.
    fetch "$packages_api/orbiter/$version/latest.json" "$work/latest.json" || { echo "build $n's latest.json is gone" >&2; exit 1; }
    echo "$MANIFEST_SHA256  $work/latest.json" | sha256sum --check --strict
    # Recorded as once-Stable before Stable names it, so pruning can never miss it.
    if [ "$channel" = stable ]; then put_file stable-builds "$version" "$work/latest.json" latest.json; fi
    put_file channel "$channel" "$work/latest.json" latest.json
    echo "$version (build-$n) is now $label's build."
    if [ "$channel" = stable ]; then
      beta=""
      if fetch "$packages_api/channel/beta/latest.json" "$work/beta.json"; then
        beta=$(jq -r '.version // empty' "$work/beta.json")
      fi
      if [ -z "$beta" ] || { [ "$beta" != "$version" ] && [ "$(newest "$beta" "$version")" = "$version" ]; }; then
        put_file channel beta "$work/latest.json" latest.json
        echo "Beta was ${beta:-empty}: it's now $version too."
      else
        echo "Beta stays on $beta (not older than $version)."
      fi
    fi
    ;;
  *)
    echo "usage: ci/promote.sh check <n> | promote <n> <beta|stable>" >&2
    exit 2
    ;;
esac
