#!/usr/bin/env bash
# The `prune` job (.gitlab-ci.yml): keeps the newest KEEP (10) Experimental builds, not counting
# the ones a channel keeps. An older build's files (its orbiter/<version> package) and its
# build-<n> release go, unless a channel names it: the build in channel/stable, channel/beta or channel/experimental's latest.json stays,
# as does every build ever promoted to Stable (stable-builds/). Its build-<n> tag stays, so the
# commit it was built from is still named. If a channel can't be read, nothing is deleted. Each
# build's channels are read again just before it goes, so a promotion that lands meanwhile keeps it.
#
#   KEEP=10 ci/prune.sh
here=$(cd "$(dirname "$0")/.." && pwd)
cd "$here"
# shellcheck source=ci/lib.sh
. ci/lib.sh

keep=${KEEP:-10}
[[ "$keep" =~ ^[1-9][0-9]*$ ]] || { echo "KEEP must be a positive number" >&2; exit 2; }
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# Every generic package <name> as "<id> <version>", all pages.
packages() {
  local page=1 out
  while [ -n "$page" ]; do
    # Each step stops the job on a failure: a list cut short must never read as "nothing there".
    rm -f "$work/headers"
    out=$(api --dump-header "$work/headers" "$project_api/packages?package_type=generic&package_name=$1&per_page=100&page=$page") || exit 1
    jq -e 'type == "array"' <<<"$out" >/dev/null || { echo "listing $1 answered something other than a list" >&2; exit 1; }
    jq -r --arg n "$1" '.[] | select(.name == $n) | "\(.id) \(.version)"' <<<"$out" || exit 1
    page=$(tr -d '\r' <"$work/headers" | sed -n 's/^x-next-page: *//Ip') || exit 1
  done
}

# The build numbers that must stay, one per line; stops the job if any channel can't be read.
on_channels() {
  local channel
  {
    for channel in stable beta experimental; do
      if fetch "$packages_api/channel/$channel/latest.json" "$work/$channel.json"; then
        # By version (0.2.<n>) and by where its downloads are (…/orbiter/0.2.<n>/…).
        jq -r '(.version // "" | capture("^0\\.2\\.(?<n>[0-9]+)$").n),
               (.platforms[]?.url // "" | capture("/packages/generic/orbiter/0\\.2\\.(?<n>[0-9]+)/").n)' "$work/$channel.json"
      fi
    done
    packages stable-builds | awk '{ print $2 }' | sed -n 's/^0\.2\.\([0-9][0-9]*\)$/\1/p'
  } | sort -un
}

protected=$(on_channels)
echo "On a channel or once Stable: $(tr '\n' ' ' <<<"$protected")"

# Every build a channel doesn't keep, newest first: "<n> <package id>". The ones a channel keeps
# don't count among the newest KEEP, so KEEP Experimental builds stay besides them.
builds=$(packages orbiter | sed -n 's/^\([0-9][0-9]*\) 0\.2\.\([0-9][0-9]*\)$/\2 \1/p' | sort -rn |
  awk 'NR == FNR { if ($1 != "") keep[$1] = 1; next } !($1 in keep)' <(printf '%s\n' "$protected") -)
deleted=()
while read -r n id; do
  [ -n "$n" ] || continue
  # Read again right before: on its own line, so a failed read stops the job (set -e) instead of
  # reading as "no channel names it".
  now=$(on_channels)
  if grep -qx "$n" <<<"$now"; then
    echo "build-$n stays: a channel names it."
    continue
  fi
  api --request DELETE "$project_api/packages/$id" >/dev/null
  # Its release, if it has one (a build that failed before its release has none); the tag stays.
  code=$(curl --silent --show-error --retry 3 --header "JOB-TOKEN: $CI_JOB_TOKEN" --request DELETE \
    --output /dev/null --write-out '%{http_code}' "$project_api/releases/build-$n")
  case "$code" in
    200|404) ;;
    *) echo "deleting the release build-$n answered $code" >&2; exit 1 ;;
  esac
  deleted+=("build-$n")
done < <(tail -n +$((keep + 1)) <<<"$builds")

if [ ${#deleted[@]} -gt 0 ]; then
  echo "Deleted ${#deleted[@]} older Experimental build(s): ${deleted[*]} (their tags stay)."
else
  echo "No older Experimental builds to delete."
fi
