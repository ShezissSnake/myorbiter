#!/usr/bin/env bash
# Builds the builder image (ci/Dockerfile) with Docker on this computer, pushes it to the project's
# container registry and prints its digest, for BUILDER_DIGEST in .gitlab-ci.yml.
#
#   ci/build-image.sh            for main: builder:<BUILDER_TAG>.<UTC time> and builder:<BUILDER_TAG>
#   ci/build-image.sh <branch>   for a branch's pipelines: builder:<BUILDER_TAG>-<branch slug>
#
# BUILDER_TAG is read from .gitlab-ci.yml. The push uses a deploy token of the project (Settings →
# Repository → Deploy tokens, scopes read_registry and write_registry only): its user name in
# DEPLOY_TOKEN_USER, the token typed at the prompt or given on standard input. Docker keeps the
# sign-in in a folder made for this run and removed after, never in ~/.docker.
#
# Only a committed ci/, on the branch the image is for (main without an argument), so the digest
# printed is that commit's Dockerfile.
#
# The <BUILDER_TAG>.<UTC time> tag is new on every run, and a branch's tag never has a dot, so no
# other push writes it: it keeps the digest BUILDER_DIGEST names tagged (docs/maintaining.md, the
# registry's cleanup policy).
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
registry=registry.gitlab.com
repo=$registry/sheziss-group/myorbiter/builder
tag=$(sed -n 's/^  BUILDER_TAG: "\(.*\)"$/\1/p' "$here/../.gitlab-ci.yml")
[[ $tag =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || { echo "BUILDER_TAG not found in .gitlab-ci.yml" >&2; exit 1; }

if [ $# -gt 1 ]; then
  echo "usage: ci/build-image.sh [branch]" >&2
  exit 2
elif [ $# -eq 1 ]; then
  # GitLab's CI_COMMIT_REF_SLUG: lower case, anything but a-z and 0-9 as -, at most 63 characters,
  # no - at either end.
  slug=$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | cut -c1-63 | sed 's/^-*//; s/-*$//')
  [ -n "$slug" ] || { echo "not a branch name: $1" >&2; exit 2; }
  tags=("$repo:$tag-$slug")
else
  tags=("$repo:$tag.$(date -u +%Y%m%d%H%M%S)" "$repo:$tag")
fi

want=${1:-main}
branch=$(git -C "$here" rev-parse --abbrev-ref HEAD)
[ "$branch" = "$want" ] || { echo "this checkout is on $branch, not $want: check out $want first" >&2; exit 1; }
[ -z "$(git -C "$here" status --porcelain -- .)" ] || { echo "ci/ has changes not committed: commit them first" >&2; exit 1; }
commit=$(git -C "$here" rev-parse HEAD)

: "${DEPLOY_TOKEN_USER:?set DEPLOY_TOKEN_USER to the user name of the deploy token}"
DOCKER_CONFIG=$(mktemp -d)
export DOCKER_CONFIG
trap 'docker logout "$registry" >/dev/null 2>&1 || true; rm -rf -- "$DOCKER_CONFIG"' EXIT
if [ -t 0 ]; then
  read -rsp "Deploy token for $DEPLOY_TOKEN_USER: " token || true
  echo
else
  read -r token || true
fi
[ -n "$token" ] || { echo "no deploy token given" >&2; exit 2; }
printf '%s' "$token" | docker login --username "$DEPLOY_TOKEN_USER" --password-stdin "$registry"
unset token

docker build --pull --file "$here/Dockerfile" --tag "${tags[0]}" "$here"
for t in "${tags[@]:1}"; do
  docker tag "${tags[0]}" "$t"
done
for t in "${tags[@]}"; do
  docker push "$t"
done
digest=$(docker inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "${tags[0]}" | sed -n "s|^$repo@\(sha256:[0-9a-f]\{64\}\)\$|\1|p" | head -n1)
[ -n "$digest" ] || { echo "pushed, but Docker didn't report the image's digest" >&2; exit 1; }

echo "Pushed ${tags[*]} as $digest, built from ci/ at $commit."
if [ $# -eq 0 ]; then
  echo "Put it in .gitlab-ci.yml through a merge request that names that commit: BUILDER_DIGEST: \"$digest\""
else
  echo "Pipelines on $1 run in ${tags[0]}."
fi
