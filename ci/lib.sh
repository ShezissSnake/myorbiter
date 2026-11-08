# shellcheck shell=bash
# Shared by the ci/*.sh scripts the release, promote, prune and pages jobs run (.gitlab-ci.yml).
# Sourced, not run. Needs curl and jq (both in the builder image) and GitLab's job variables.
#
# Where a build's files live: the project's generic package registry, at fixed paths.
#   myorbiter/<version>/<file>      every file of one build (version 0.2.<n>), and its latest.json
#   channel/<channel>/latest.json   the manifest installed copies on that channel read
#                                   (stable, beta, experimental): the app's updater endpoints
#   stable-builds/<version>/latest.json
#                                   one per build ever promoted to Stable, so pruning never
#                                   deletes one
# Uploading a file again under the same path adds a newer copy; GitLab serves the newest, and
# `put_file` deletes the older ones, so each path holds exactly one file.

set -euo pipefail
# A failure inside $(…) stops the job too (bash otherwise turns -e off there), so a failed read is
# never taken for an empty answer.
shopt -s inherit_errexit

: "${CI_API_V4_URL:?}" "${CI_SERVER_URL:?}" "${CI_PROJECT_ID:?}" "${CI_PROJECT_PATH:?}" "${CI_JOB_TOKEN:?}"

# Calls the API as this job (its token, never printed): the job token can read and write this
# project's packages and releases with the role of whoever started the pipeline. No redirect is
# followed: curl would send the token's header on to any host a redirect names.
project_api="$CI_API_V4_URL/projects/$CI_PROJECT_ID"
packages_api="$project_api/packages/generic"
# The same files' public addresses, as the app and the manifests name them: the project by its path
# (sheziss-group%2Fmyorbiter), which reads anonymously once the project is public.
# shellcheck disable=SC2034 # used by the scripts that source this file
public_packages="$CI_API_V4_URL/projects/${CI_PROJECT_PATH//\//%2F}/packages/generic"

api() {
  curl --fail-with-body --silent --show-error --retry 3 \
    --header "JOB-TOKEN: $CI_JOB_TOKEN" "$@"
}

# fetch <url> <file>: 0 when it was there (written to <file>), 1 when the registry has no such
# file (404); any other answer stops the job, so a failed read never passes for "nothing there".
# A download the registry answers with a redirect (to its object storage) is followed by hand: the
# token goes to this GitLab only, never to the host the redirect names.
fetch() {
  local url=$1 answer code auth _
  for _ in 1 2 3 4 5; do
    auth=()
    [[ "$url" == "$CI_SERVER_URL"/* ]] && auth=(--header "JOB-TOKEN: $CI_JOB_TOKEN")
    answer=$(curl --silent --show-error --retry 3 "${auth[@]}" \
      --output "$2" --write-out '%{http_code} %{redirect_url}' "$url") || { echo "couldn't read $1" >&2; exit 1; }
    code=${answer%% *}
    case "$code" in
      200) return 0 ;;
      404) rm -f "$2"; return 1 ;;
      301|302|303|307|308)
        url=${answer#* }
        [[ "$url" == https://* ]] || { echo "reading $1: a redirect to '$url'" >&2; rm -f "$2"; exit 1; }
        ;;
      *) echo "reading $1 answered $code" >&2; rm -f "$2"; exit 1 ;;
    esac
  done
  echo "reading $1: too many redirects" >&2
  rm -f "$2"
  exit 1
}

# The id of the generic package <name> <version>, or nothing. The API's name filter is a fuzzy
# search, so name and version are matched exactly here.
package_id() {
  api "$project_api/packages?package_type=generic&package_name=$1&package_version=$2&per_page=100" |
    jq -r --arg n "$1" --arg v "$2" '[.[] | select(.name == $n and .version == $v)][0].id // empty'
}

# put_file <name> <version> <local file> [<file name>]: uploads it, then deletes any older copy of
# the same file name in that package, so the path names exactly this file.
put_file() {
  local name=$1 version=$2 file=$3 as=${4:-$(basename "$3")} id
  api --request PUT --upload-file "$file" "$packages_api/$name/$version/$as" >/dev/null
  id=$(package_id "$name" "$version")
  [ -n "$id" ] || { echo "uploaded $as but found no package $name/$version" >&2; exit 1; }
  api "$project_api/packages/$id/package_files?per_page=100&sort=desc&order_by=created_at" |
    jq -r --arg f "$as" '[.[] | select(.file_name == $f)] | sort_by(.id) | .[:-1][] | .id' |
    while read -r old; do
      api --request DELETE "$project_api/packages/$id/package_files/$old" >/dev/null
    done
}

# Newer of two x.y.z versions, by number.
newest() { printf '%s\n%s\n' "$1" "$2" | sort -V | tail -n1; }
