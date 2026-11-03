# Data from the Warframe Wiki: source and licence

The files in this folder come from the Warframe Wiki and are under its licence (below), not
orbiter's GPL-3.0-only. They are separate data files shipped beside orbiter, not part of its
program: orbiter reads them from its own files when it starts (`src/lib/core/wikiData.ts`), and
never fetches the wiki.

This licence note covers three data files in this folder:

- `modular-parts.json`: a snapshot of the Warframe Wiki's Lua module
  [Module:Modular/data](https://wiki.warframe.com/w/Module:Modular/data), converted to JSON as is
  (kitgun chambers, grips and loaders for primary and secondary; zaw strikes, grips and links; MOA
  and Hound parts). Revision 2787806, last edited on the wiki on 22 June 2026, read on
  3 November 2026.
- `modular-parts-extra.json`: values copied by hand from the tables on the wiki's
  [Amp](https://wiki.warframe.com/w/Amp) (revision 2818529, edited 14 October 2026),
  [Predasite](https://wiki.warframe.com/w/Predasite) (revision 2822723, edited 2 November 2026) and
  [Vulpaphyla](https://wiki.warframe.com/w/Vulpaphyla) (revision 2822724, edited 2 November 2026)
  pages, read on 3 November 2026.
- `vosfor.json`: Arcane Dissolution's Vosfor yields and Loid's Arcane Collection packs (contents,
  pool chances, prices), copied by hand from the wiki's [Vosphor](https://wiki.warframe.com/w/Vosphor)
  page (its Dissolution Yield List and Arcane Collections tables), read in October 2026 (the file's
  `source` field).

Each page was read once, by hand, when the snapshot was made (the module's rendered page, because
the wiki's robots.txt disallows `?action=raw`). orbiter never fetches the wiki: the app only reads
these files. To update them, read the pages again by hand and replace the files.

## Licence

The content of these three files comes from the Warframe Wiki and is licensed under the
**Creative Commons Attribution-NonCommercial-ShareAlike 3.0 Unported** licence (CC BY-NC-SA 3.0):
https://creativecommons.org/licenses/by-nc-sa/3.0/

Attribution: the Warframe Wiki contributors (https://wiki.warframe.com), hosted by Weird Gloop. The
page histories list the individual authors.

Changes made: the Lua table converted to JSON with a `_source` block added; the page tables
reduced to the values orbiter uses, with `_gaps` notes where a page has no numbers.

These files are under that licence, **separate from orbiter's own code and its licence**. They may
not be used commercially, and anything derived from them must be shared under the same licence.

## Not covered here

`src/lib/data/modular-parts-paths.json` (each part's game path and blueprint path) comes from
WFCD's warframe-items data (MIT licence, https://github.com/WFCD/warframe-items), not from the
wiki, and stays in orbiter's code.

The rankings orbiter shows from these numbers ("orbiter's ranking from part stats") are orbiter's
own formulas in `src/lib/core/recipes.ts`, not the wiki's.

Warframe and its content are trademarks of Digital Extremes Ltd.
