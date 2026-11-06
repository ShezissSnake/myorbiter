# Demo account

An invented account for screenshots and UI work: nothing here comes from a real account. The
player is `ExamplePlayer`, the other players (`Tenno_Alpha`, `VoidTrader42`…) are made up, and so
are the inventory, the mastery, the listings, the order books, the prices and the trades. Game data
(item names, paths, ducats, relic rewards, drop chances) is public and comes from the
[@wfcd/items](https://www.npmjs.com/package/@wfcd/items) package.

```sh
npm run dev:demo        # ORBITER_DEMO=1 vite: the browser dev mode on this account
```

With `ORBITER_DEMO=1` the dev server answers every `/dev-*.json` from this folder instead of
`public/` (see `demoData` in `vite.config.ts`). A file this folder hasn't got is a 404, never
`public/`'s copy. `/dev-history-<slug>.json` is one entry of `dev-history.json`.

The files are written as of the moment in `meta.json` (`now`, Unix ms). The dev server moves every
time in them up to the real time when it serves them, in whole minutes, so the inventory always reads
as synced a few minutes ago and the fissure's reward screen is on (read again once a minute).

What the account is: mastery rank 22, about 390 items mastered, spare prime sets and parts, a few
dozen relics, mods with duplicates, arcanes, twelve listings on warframe.market (some above the
cheapest seller, so Check prices has something to reprice), a fissure with four relics and its
reward screen, and two builds in the foundry.

It also holds the situations `tests/sparesPlan.test.ts` checks Sell spares against (the last block
of `scripts/demo-data.mjs`, with a random generator of its own so nothing else moves): Requiem mods
two to four deep (Khra four) and fifteen Computer Cop while Kuva, Tenet and Coda weapons are left,
Cleaving Whirlwind six times unranked, Arcane Energize one maxed and nine unranked, Virtuos Forge two
maxed, a Requiem relic held twice, gems the unbuilt Keratinos' parts take, Ayatan sculptures, and
Sunika Kubrow imprints on warframe.market's list. Paris Prime is the one spare set whose every part
drops from a relic the account holds. Change any of these and the tests say which rule now reads
differently.

@wfcd/items doesn't carry a part's own recipe, nor list Requiem and Antivirus mods as tradable:
the Keratinos parts' recipes are made up like the rest of the account, and those mods are traded as
in the game.

## Regenerating

The files are built by `scripts/demo-data.mjs` (plain Node, no dependencies, no network) from a copy
of @wfcd/items outside the repository. The same package gives the same files: the ones here come
from @wfcd/items 1.1276.48 (`npm pack @wfcd/items@1.1276.48`).

```sh
mkdir -p /tmp/wfcd && cd /tmp/wfcd && npm pack @wfcd/items && tar xzf wfcd-items-*.tgz
cd - && node scripts/demo-data.mjs /tmp/wfcd/package
```

Still read from the network in the browser dev mode: the worldstate (api.warframestat.us) and item
pictures (raw.githubusercontent.com).

## @wfcd/items's licence

The game data in these files (item names, paths, ducats, components, relic rewards, drop chances)
comes from @wfcd/items, under its MIT licence:

```text
MIT License

Copyright (c) 2017 Kaptard

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
