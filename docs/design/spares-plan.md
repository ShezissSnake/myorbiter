# Sell spares: what can be sold, and why the page is built this way

Sell spares (`src/lib/tabs/Spares.svelte`, `src/lib/ui/SparesPlan.svelte`, `src/lib/ui/spares/`)
lets the player say, per kind of thing, what MyOrbiter lists and what it keeps. What each row and
option does is in the in-app Guide; the settings, their sanitising and the migration from the old
switches are in `src/lib/core/sparesRules.ts`; the plan is `src/lib/core/bulk.ts`. This page keeps
what neither says: what warframe.market trades, and the reasons behind the design.

## What warframe.market trades

The page offers only what is both tradable and in TennoScope's inventory read.

| Kind | Tradable on warframe.market |
|---|---|
| Prime parts and sets; other sets (Mandonel, Lato Vandal, Necramechs, Spectra Vandal) and their parts | Yes |
| Mods of every kind (Primed, Galvanized, Archon, Requiem, Antivirus, augments, stances, Railjack, Necramech, companion) | Yes |
| Requiem tomes | Yes |
| Arcanes | Yes, by rank |
| Relics | Yes, by refinement |
| Veiled rivens | Yes |
| Unveiled rivens | Auctions only (the Rivens page) |
| Ayatan sculptures (stars in are part of the listing) and Ayatan stars | Yes |
| Refined gems | Yes |
| Raw ores and gems, alloys | No |
| Whole fish (by size) | Yes |
| Fish parts (scales, oils, pebbles) | No |
| Archon shards (Tauforged too), Eidolon shards, Sentient cores | No |
| Captura scenes and simulacra | Mostly (a few scenes aren't traded) |
| Focus lenses and their blueprints; keys, Proof Fragments, ship part blueprints | Yes |
| Imprints | Yes, by breed |
| Kuva and Tenet weapons, liches | Not as listings (lich auctions only; a built weapon can't be traded) |
| Cosmetics (syndicate armour, Arcane helmets, emotes) | Yes, but TennoScope's inventory doesn't carry them |
| Other resources (Kuva, Riven Sliver, Kavat Genetic Code…) | No |

Archon shards, fish parts and raw ores are named once, in the Resources row's "never listed" line,
so a player looking for them knows why they aren't there.

What gear still to build takes is kept, including what its parts' own blueprints take (a
warframe's Neuroptics blueprint takes gems the catalog doesn't list for the warframe).
`needsByUnique` in `spares.ts` takes the item's own components from the catalog and what its parts
take from the Foundry recipes.

## Decisions

- **Its own page, in Trade after Orders, not a fold on Orders.** With a row open and a plan made
  it is 1,500–2,000 px tall, which pushed the listings (what Orders is for) a screen or two down, and
  a menu at the foot of a scroll box gets clipped. Choosing what to put up and keeping listings right
  are two tasks. Orders keeps one line ("Applying the plan: x of y" while it runs); old
  `market?spares=1` links open the page. It isn't offered on consoles: the plan needs the inventory.
- **No presets** ("Careful", "Usual", "Clear everything"). Each closed row already sums up its
  choices in a line; a preset needs a "Custom" state as soon as one number moves; and "Clear
  everything" would have to decide what happens to never-sell items and lich mods, where the safe
  answer matters most. *Back to the usual rules* covers undoing experiments.
- **One row open at a time.** Every row's choices are readable in its closed line, so two open rows
  would only add scrolling.
- **The rules that aren't options are written down** at the foot of each row ("always keeps…"),
  not hidden.
- **Never sell is a plain list**, keyed by warframe.market's item id (every rank and variant), not
  "keep at least N" per item. The keep numbers that matter already exist per family and per row;
  a per-item number would need its own control, column and rule for combining with the family's.
  The last check before any listing (`listGuard.ts`) refuses a never-sell item too, the listing
  form included. Entries can gain a `keep` later if that's ever wanted.
- **"Only sets my relics drop"** means sets whose every part drops from a relic the player holds,
  so the set can be cracked again (not "sets that aren't vaulted").
- **Ayatan: empty sculptures only.** Filled ones would need each sculpture's star slots, which the
  catalog doesn't have.
- **Relics are their own row**, and that row is Settings → Selling's old relic switch.
- **An unticked row's options are greyed out**, and its line says "Not sold".
- **Stored beside the old switches.** Version 2 lives under `settings.market.spares`, and the old
  six switches under `settings.market.bulk` are rewritten from it on every save. Version 2 can't go
  under `bulk`: it shares names with the old switches, and an older build (Stable behind
  Experimental) would misread them. An older build reading the same file gets the closest the six
  switches can say.
