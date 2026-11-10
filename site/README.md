# The website

MyOrbiter's site for GitHub Pages (https://shezisssnake.github.io/myorbiter/): a landing page (`landing.html`), the app's Guide as pages,
What's New and Other versions (`downloads.html`), in the app's own design (`site.css`: the tokens,
type, surfaces and drawn icons of `src/app.css` and `src/lib/ui/Icon.svelte`, design pass 2). `scripts/site.mjs` builds it into `site/_site/` (not committed): it
draws the Guide and What's New from `src/lib/tabs/Guide.svelte` and `src/lib/whatsNew.ts` with
Svelte's server renderer, so the site says what the app says, and copies the fonts, the game icons
the Guide and the tour use (each page with the icon the app's sidebar shows for it) and the
screenshots beside them.

```fish
node scripts/site.mjs --check
node scripts/site.mjs --check --offline
```

The download links are read from the repository's releases on GitHub once, at build time
(`scripts/site-downloads.mjs`), and written into the pages; nothing on the pages reads GitHub.
The landing page's buttons offer the best channel that has a build (Stable, else Beta, else
Experimental, from the `latest.json` on the release named after the channel) and say which:
Windows the setup `.exe`, Linux and the Steam Deck the AppImage. `downloads.html` lists the newest
ten builds made on GitHub (from 0.2.120) on Releases, each with its AppImage, `.deb` and `.exe`
where the build has them and a link to its release notes. A manifest that doesn't check out, or
any answer but the file or a 404, stops the build rather than link a wrong file. `--offline` reads
nothing: the buttons point at the Releases page (for a local build). The pages are a snapshot of
the channels when they were built, so every release and promotion ends by rebuilding the site, as
the `pages` task does.

`--check` also checks every link and image, that links leave only for github.com, that the only
script a page loads is the site's own `site.js` (no inline code, no handlers, no frames) and that it
names no address and uses nothing that requests, stores or builds markup from text, and that no
`dev-*.json` (real account data) is in it. The Release workflow
(`.github/workflows/release.yml`: *task* `pages` on `main`, and the end of every release and
promotion) builds and checks the site and publishes it on GitHub Pages. The old address on GitLab
Pages only redirects here.

## The content security policy

Every page starts its head with the same `<meta http-equiv="Content-Security-Policy">` (GitHub
Pages can't send headers): `default-src 'self'; img-src 'self'; base-uri 'none'; form-action
'none'`. Scripts, styles, fonts and pictures come only from the site's own files. Nothing inline is
allowed (no `'unsafe-inline'`), so the pages carry no inline script, style element or style
attribute: a section's colour is a class (`.s-trade`), the Guide's legend swatches and part ring
are classes too (`scripts/site.mjs` turns the app's style attributes into them), and the
stylesheet's tiles and marks are files in `art/` rather than `data:` pictures. The viewer's Close is
a plain button, not a `<form method="dialog">`. `--check` fails on a page without exactly the
build's tag first in its head, on any other `http-equiv`, on an inline style, a style element, a
form or a `<base>`, and on a `data:` address.

## The landing page's script

`site.js`, loaded by the landing page only, is plain script with no library. It turns the tour of
the app's four sections into tabs (arrow keys, Home and End move between them; each section's pages
are chips, and picking one shows that page's screenshot), opens a screenshot large in a `<dialog>`
(previous and next, the arrow keys, Esc and Close; the large file is loaded only then), puts the
visitor's platform first among the downloads (from the browser's user agent, read on the page and
sent nowhere) and opens "Licence and sources" when a link to it is followed. It requests nothing
from anywhere else, stores nothing and counts nothing. Motion is short, opacity and transform only,
on an action only, and none under reduced motion.

Without it the page reads top to bottom: every section with its pages and screenshot, every
screenshot a link to its large file, every download listed.

## Screenshots

`shots/` holds the demo account only (`npm run dev:demo`, the invented account in `demo/`), as WebP:
the picture on the page at 1280 × 800, and in `shots/large/` the one the viewer opens, at twice
those pixels. `npm run screenshots -- --only site` takes them again. Never a screenshot of a real
account.
