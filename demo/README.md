# Demo account

An invented account for screenshots and UI work: nothing here comes from a real account. The
player is `ExamplePlayer`, the other players (`Tenno_Alpha`, `VoidTrader42`…) are made up, and so
are the inventory, the mastery, the listings, the order books, the prices and the trades. Game data
(item names, paths, ducats, relic rewards, drop chances) is public and comes from the
[@wfcd/items](https://www.npmjs.com/package/@wfcd/items) package.

```sh
npm run dev:demo        # MYORBITER_DEMO=1 vite: the browser dev mode on this account
```

With `MYORBITER_DEMO=1` the dev server answers every `/dev-*.json` from this folder instead of
`public/` (see `demoData` in `vite.config.ts`). A file this folder hasn't got is a 404, never
`public/`'s copy. `/dev-history-<slug>.json` is one entry of `dev-history.json`.

The files are written as of the moment in `meta.json` (`now`, Unix ms). The dev server moves every
time in them up to the real time when it serves them, in whole minutes, so the inventory always reads
as synced a few minutes ago and the fissure's reward screen is on (read again once a minute).

What the account is: mastery rank 22, about 390 items mastered, spare prime sets and parts, a few
dozen relics, mods with duplicates, arcanes, twelve listings on warframe.market (some above the
cheapest seller, so Check prices has something to reprice), a fissure with four relics and its
reward screen, and two builds in the foundry. Rivens: three veiled, and four unveiled (Soma, Lex,
Nikana, Hek) with invented rolls, the Soma one up for sale on warframe.market (`auctions` in
`dev-market.json`, which the browser dev mode reads as your riven auctions); `dev-auctions.json` is
twelve invented riven listings that answer every riven search, enough for the Estimate.

It also holds the situations `tests/sparesPlan.test.ts` checks Sell spares against (the last block
of `scripts/demo-data.mjs`, with a random generator of its own so nothing else moves): Requiem mods
two to four deep (Khra four) and fifteen Computer Cop while Kuva, Tenet and Coda weapons are left,
Cleaving Whirlwind six times unranked, Arcane Energize one maxed and nine unranked, Virtuos Forge
two maxed, a Requiem relic held twice, gems the unbuilt Keratinos' parts take, Ayatan sculptures, a
whole spare Braton Vandal set, and Sunika Kubrow imprints on warframe.market's list. Paris Prime is
the one spare set whose every part drops from a relic the account holds. Change any of these and the
tests say which rule now reads differently.

@wfcd/items doesn't carry a part's own recipe: the Keratinos parts' recipes are made up like the
rest of the account. It lists Requiem and Antivirus mods as untradable, and the demo leaves them so:
their prices on warframe.market are what make them tradable, as with a real catalog.

## The world state

`dev-worldstate.json` is the demo's world: what `npm run dev` reads live from api.warframestat.us,
invented. With `MYORBITER_DEMO=1` the page reads it (`loadLive` in `src/lib/backend.ts`) and asks
no world-state service, so the screenshots, the help pictures, the help-picture check and the sweep
see the same world on every run, online or not. Its times move up with the rest, so nothing in it
has ended and every countdown reads the same whenever the demo is started (to within a minute).
The 1999 Calendar's own dates (in 1999) are left as they are.

It has every part the pages show: 24 fissures (normal, Steel Path and Void Storms, every era),
three invasions and three alerts (Strun Wraith and Latron Wraith parts the account needs, an Orokin
Catalyst and an Orokin Reactor), Baro here with eight items (two Prisma weapons, Primed mods, two
invented cosmetics), Varzia with Gauss Prime, Vauban Prime and seven of their relics, the six
clocks (Earth, Cetus, Orb Vallis, the Cambion Drift, the Zariman, Duviri's mood), the Circuit's
picks (Temple and Kullervo not mastered), Darvo's deal (Latron Wraith), bounties for Cetus,
Fortuna and the Necralisk, two events, the Sortie, the Archon Hunt, Nightwave, Teshin's offer,
both Archimedeas, the 1999 Calendar and the Descendia. Node, mission and item names are the
game's; which of them appear where, the ids, rewards, chances, challenge texts and the two events
are invented for the pictures, not taken from a day's real answer. Only its shape is the service's.

## Regenerating

The files are built by `scripts/demo-data.mjs` (plain Node, no dependencies, no network) from a copy
of @wfcd/items outside the repository. The same package gives the same files; the ones here come
from @wfcd/items 1.1276.48.

```sh
mkdir -p /tmp/wfcd && cd /tmp/wfcd && npm pack @wfcd/items@1.1276.48 && tar xzf wfcd-items-*.tgz
cd - && node scripts/demo-data.mjs /tmp/wfcd/package
```

`dev-worldstate.json` is not made by the script: it is written by hand, in the shape
api.warframestat.us answers, with invented values (see "The world state" above). Edit it directly;
keep its times as of `meta.json`'s `now`.

Still read from the network in the demo: item pictures (raw.githubusercontent.com). Without the
network they are left blank and everything else is the same.

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
