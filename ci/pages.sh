#!/usr/bin/env bash
# The `pages` job (.gitlab-ci.yml: task pages, and the end of every release and promotion): builds
# the website (scripts/site.mjs), checks it, and leaves it in public/, which GitLab Pages
# publishes. scripts/site.mjs reads the channels' manifests (the package registry) and the
# releases (the releases API) itself, anonymously, and fails if they don't check out: the download
# buttons offer the best channel's build (Stable, else Beta, else Experimental), downloads.html the
# newest builds. So it fails while the project is private.
#
# public/ in the repository holds the app's own static files (the app's build reads them, the site
# build copies its icons from public/game/); the site build runs first, then public/ is replaced
# by the site in this job's copy of the repository only.
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
cd "$here"

npm ci
node scripts/site.mjs --check
rm -rf public
mv site/_site public
