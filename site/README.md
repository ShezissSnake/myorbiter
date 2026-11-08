# The website

MyOrbiter's site for GitLab Pages: a landing page (`landing.html`), the app's Guide as pages,
What's New and Other versions (`downloads.html`), in the app's own design (`site.css`, the tokens
and type of `src/app.css`). `scripts/site.mjs` builds it into `site/_site/` (not committed): it
draws the Guide and What's New from `src/lib/tabs/Guide.svelte` and `src/lib/whatsNew.ts` with
Svelte's server renderer, so the site says what the app says, and copies the fonts, the game icons
the Guide uses and the screenshots beside them.

```fish
node scripts/site.mjs --check
node scripts/site.mjs --check --offline
```

The download links are read from the package registry once, at build time
(`scripts/site-downloads.mjs`), and written into the pages; nothing in them runs in the browser.
The landing page's buttons offer the best channel that has a build (Stable, else Beta, else
Experimental, from `channel/<channel>/latest.json`) and say which: Windows the setup `.exe`, Linux
and the Steam Deck the AppImage. `downloads.html` lists the newest ten builds from Releases, each
with its AppImage, `.deb` and `.exe` where the build has them and a link to its release notes. A
manifest that doesn't check out, or any answer but the file or a 404, stops the build rather than
link a wrong file. `--offline` reads nothing: the buttons point at the Releases page (for a local
build). The pages are a snapshot of the registry when they were built: once a build they link
leaves every channel and the newest ten, `ci/prune.sh` deletes its files, so every release and
promotion ends by rebuilding the site (after pruning), as the `pages` task does.

`--check` also checks every link and image, that links leave only for gitlab.com, that no page
carries a script, and that no `dev-*.json` (real account data) is in it. The `pages` job
(`ci/pages.sh`: *task* `pages` on `main`, and the end of every release and promotion) builds and
checks the site and publishes it from `public/` on GitLab Pages.

## Screenshots

`shots/` holds the demo account only (`npm run dev:demo`, the invented account in `demo/`), at
1280 × 800 and twice the pixels, as WebP. Never a screenshot of a real account.
