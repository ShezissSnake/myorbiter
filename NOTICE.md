# Notice

**orbiter** © 2026 Sheziss. Licensed under the GNU General Public License v3.0 only
(GPL-3.0-only); the full text is in `LICENSE`.

orbiter is free software: you can redistribute it and/or modify it under the terms of the GNU
General Public License as published by the Free Software Foundation, version 3. It is distributed in
the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more
details.

Every orbiter release carries its complete source as `orbiter-source.tar.gz`.

## TennoScope

`tennoscope/` is [TennoScope](https://github.com/Deftera186/tennoscope) © Deftera186 and the
TennoScope contributors, GPL-3.0-only (`tennoscope/LICENSE`), with orbiter's changes
(`tennoscope/ORBITER.md`). Its history, with every upstream author, is kept in this repository.
TennoScope's own notices are in `tennoscope/THIRD_PARTY_NOTICES.md`. The Linux and Windows downloads
carry a TennoScope built from that folder, with Tesseract (Apache-2.0).

## Files under other licences

These are bundled with orbiter but are not covered by its licence:

- `public/data/wiki/` (`modular-parts.json`, `modular-parts-extra.json`, `vosfor.json`): data from
  the Warframe Wiki, under Creative Commons Attribution-NonCommercial-ShareAlike 3.0 (CC BY-NC-SA
  3.0); source, attribution and changes in `public/data/wiki/LICENSE.md`. These are separate data
  files shipped beside orbiter (in every download, as `data/wiki/` among its web files), not
  compiled into its program: orbiter reads them when it starts. Their licence is theirs alone (mere
  aggregation): it doesn't extend to orbiter, and orbiter's doesn't extend to them.
- `src/lib/data/modular-parts-paths.json`: from WFCD's warframe-items data (MIT).
- `public/game/`: Warframe's own icons, taken from the official wiki and WFCD
  (`public/game/SOURCES.json` records where each came from), and TennoScope's part, pistol and
  currency icons (`tennoscope/app/src/assets/`, see `tennoscope/THIRD_PARTY_NOTICES.md`): © Digital
  Extremes Ltd., excluded from orbiter's and TennoScope's GPL. They are used to identify what they
  depict; Digital Extremes retains all rights in them. Warframe and its names are © and ™ Digital
  Extremes Ltd. orbiter is an unofficial project, not affiliated with or endorsed by Digital
  Extremes.
- The fonts Archivo Narrow, IBM Plex Sans and IBM Plex Mono: SIL Open Font License 1.1 (the texts
  are in `THIRD-PARTY-NOTICES/fonts/`).
- The libraries that come with the Tesseract in the Linux and Windows downloads: each under its own
  licence, with its notice in the download's `tennoscope/THIRD-PARTY-NOTICES/tesseract/`.
