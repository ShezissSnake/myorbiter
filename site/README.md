# The website

orbiter's site for GitHub Pages: a landing page (`landing.html`), the app's Guide as pages and
What's New, in the app's own design (`site.css`, the tokens and type of `src/app.css`).
`scripts/site.mjs` builds it into `site/_site/` (not committed): it draws the Guide and What's
New from `src/lib/tabs/Guide.svelte` and `src/lib/whatsNew.ts` with Svelte's server renderer, so
the site says what the app says, and copies the fonts, the game icons the Guide uses and the
screenshots beside them.

```fish
node scripts/site.mjs --check
```

`--check` also checks every link and image, that links leave only for github.com, and that no
`dev-*.json` (real account data) is in it. `--release <file>` takes the latest Stable release
(`gh release view --json tagName,assets`) for the download buttons; without it they point at
the Releases page. `.github/workflows/pages.yml` does both and publishes the result.

## Screenshots

`shots/` holds the demo account only (`npm run dev:demo`, the invented account in `demo/`), at
1280 × 800 and twice the pixels, as WebP. Never a screenshot of a real account.
