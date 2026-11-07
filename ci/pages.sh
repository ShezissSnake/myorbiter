#!/usr/bin/env bash
# The `pages` job (.gitlab-ci.yml, task pages): builds the website (scripts/site.mjs) with its
# download buttons pointing at the current Stable build's files, checks it, and leaves it in
# public/, which GitLab Pages publishes. The Stable build is the one channel/stable/latest.json
# names; its build-<n> release lists the files. With no Stable build yet, the buttons point at
# the releases page.
#
# public/ in the repository holds the app's own static files (the app's build reads them, the site
# build copies its icons from public/game/); the site build runs first, then public/ is replaced
# by the site in this job's copy of the repository only.
here=$(cd "$(dirname "$0")/.." && pwd)
cd "$here"
# shellcheck source=ci/lib.sh
. ci/lib.sh

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
release=()
if fetch "$packages_api/channel/stable/latest.json" "$work/stable.json"; then
  version=$(jq -r '.version // empty' "$work/stable.json")
  [[ "$version" =~ ^0\.2\.([1-9][0-9]*)$ ]] || { echo "channel/stable names no build version: '$version'" >&2; exit 1; }
  tag="build-${BASH_REMATCH[1]}"
  fetch "$project_api/releases/$tag" "$work/release.json" || { echo "Stable is $version but $tag has no release" >&2; exit 1; }
  # The shape scripts/site.mjs reads: the tag, and each file's name and address.
  jq '{ tagName: .tag_name, assets: [.assets.links[] | { name, url }] }' "$work/release.json" >"$work/site-release.json"
  release=(--release "$work/site-release.json")
  echo "Downloads from $tag ($version)."
else
  echo "No Stable build yet: the download buttons point at the releases page."
fi

npm ci
node scripts/site.mjs --check "${release[@]}"
rm -rf public
mv site/_site public
