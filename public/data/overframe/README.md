# Overframe's popular builds

`popular.json` is a copy of Overframe's public build **lists** (overframe.gg/builds/…): for each
build, its title, item, author, votes, Forma count, game update, created and updated dates, and
its address on overframe.gg. Never a build page, and none of a build's contents (mods, arcanes,
shards). The Builds page shows an item's entries under "Popular on Overframe", each one a link
that opens the build on overframe.gg, so its author gets the visit.

## Permission

Overframe's team, by email on 3 Nov 2026: orbiter may take Overframe's lists of
popular builds and show all of that information, not the build pages themselves. They suggested
collecting the lists in a browser and keeping the result in orbiter's own data, since relying on
access through Cloudflare could break. So:

- orbiter never contacts Overframe. The app reads this file from its own assets.
- The file is dated (`collected`) and the page shows that date.
- Only the list pages were read, never a `/build/<id>/` page.

## What's in it

- `collected`: when the lists were read (ISO time).
- `builds`: one per line. `uniqueName` is orbiter's catalog path for the item, matched by name;
  builds whose item matched nothing (companion claws, items newer than the catalog) keep `item`
  only, and the page finds them by name.
- Six list pages: `warframes`, `primary-weapons`, `secondary-weapons`, `melee-weapons`,
  `archwing` and `sentinels` (the Companions tab). For each, four views, each showing the top
  100: by rating, by rating for update 44, by rating for update 43, and most recently updated.
  Repeats are kept once.

The page shows at most 5 builds per item: the most voted among those updated in the last two years,
so the list stays short and current.

## Refreshing it

Collect Overframe's popular builds again in a browser. The steps:

1. In an ordinary browser window, open one list page, e.g.
   `https://overframe.gg/builds/warframes/`. Never sign in, and never press vote, copy or comment.
   On a Cloudflare challenge or a sign-in prompt, stop.
2. From that page's console, for each list page and view (`?patch=44`, `?patch=43`, `?sort=Updated`, and
   none), `fetch()` the page (same origin), at least 3 seconds apart, and parse it with DOMParser.
   `<script id="__NEXT_DATA__">`'s `props.pageProps.builds` holds each build's id, dates, score,
   url, author, Forma count and title; the row whose link is the build's url names the item ("…
   guide by …"). The update chip is drawn in the browser, from the build's `updated` date and
   Overframe's patch list (the page's `patchlogs` data): the latest major update before that date.
3. Keep only: `id`, `path`, `title`, `item`, `author`, `score`, `formas`, `created`, `updated`
   (days), `patch`, `category`. Drop Overframe's private-use icon characters from titles.
4. Copy the rows out of the browser as text, check them against a hash, and save them as one JSON array.
5. Match and write the file:

   ```
   npx tsx scripts/overframe-popular.ts <collected.json> <TennoScope catalog-generation.json> <collected ISO time>
   ```

   It prints the match rate and the unmatched item names (add a spelling to `ALIASES` in the
   script when the catalog names an item differently).
6. `npm test`, look at the Builds page, and commit the new file.
