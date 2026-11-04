# Put my spares on sale: finer choices

A design for the spares panel with options per category. Built as the Sell spares page
(`src/lib/tabs/Spares.svelte`, with `src/lib/ui/SparesPlan.svelte` and `src/lib/ui/spares/`; the
settings in `src/lib/core/sparesRules.ts`, the plan in `bulk.ts`). The decisions taken on the open
questions (section 8) are at the end; where the build differs from the text below, it says so there.

The request: if orbiter lists things automatically, the player should be able to say how, per kind
of thing (prime sets or parts, mod families and how many to keep, Ayatan full or empty, arcanes by
rank and rarity, resources, weapon sets, imprints), without the panel becoming a list of a million
switches.

## 1. What warframe.market trades, checked against the data

Checked against `dev-market-items.json` (3,893 items with tags) and the inventory and catalog in
`dev-bundle.json`, by matching every held item to a market item the way `spareRows` does.

| Kind | Tradable? | In the data |
|---|---|---|
| Prime parts, prime sets | Yes | 236 of 239 held parts match; 234 `set` items |
| Other sets (Mandonel, Lato Vandal, Necramechs, Spectra Vandal) and their parts and blueprints | Yes | `set` without `prime`; parts tagged `component` or `blueprint` |
| Mods, ordinary | Yes | 1,399 `mod` items; 1,212 of 1,253 held mods match |
| Primed mods | Yes | 63 (`Primed …`, rank 10) |
| Galvanized mods | Yes | 12; two have a variant (`regular`, `atragraph`) |
| Archon mods | Yes | 5 (`archon` tag) |
| Requiem mods (Khra … Xata, Oull) | Yes | 9, tagged `parazon`, rank 3 |
| Antivirus mods (Anti-V, Byteryte, Computer Cop, Drive-Duster, Keep-Clean, Soft Safe, Trojan Tracker, Worm Away) | Yes | 8; paths `/Immortal/Antivirus…Mod` |
| Augments, stances | Yes | 211 `augment`, 85 `stance` |
| Railjack, Necramech, archwing, companion, K-Drive, Peculiar mods | Yes | they're all `mod` items |
| Requiem tomes (Xata Invocation, Lohk Canticle…) | Yes | 8 `tome` |
| Arcanes | Yes, by rank | 170 `arcane_enhancement`; held: 90 Rare, 22 Uncommon, 15 Common, 11 Legendary at rank 5, the rest rank 3 |
| Relics | Yes, by refinement | 800, subtypes intact … radiant; all 136 held match |
| Veiled rivens | Yes | 7 `veiled_riven` items (subtypes unrevealed, revealed) |
| Unveiled rivens | Auctions only | Rivens page, not listings |
| Ayatan sculptures | Yes; stars in are part of the listing | 11 `ayatan_sculpture`; orders carry `amberStars`/`cyanStars` (market.ts) |
| Ayatan stars | Yes | Amber and Cyan |
| Refined gems | Yes | 18 `gem` (Tear Azurite, Heart Noctrul…); 18 of the 58 held gem and ore rows |
| Raw ores and gems, alloys | **No** | Tiametrite, Dagonic, Adramal Alloy… (the other 40) |
| Whole fish | Yes, by size | 44 `fish` (small/medium/large, or basic/adorned/magnificent); 6 held |
| Fish parts (scales, oils, pebbles) | **No** | 46 held, none on the market |
| Archon shards (incl. Tauforged) | **No** | 7 held, none on the market |
| Eidolon shards and Sentient cores | **No** | |
| Captura scenes and simulacra | Mostly | 180 `scene`; 44 of 50 held match (some, such as Umbra's Courtyard, aren't traded) |
| Focus lenses and lens blueprints | Yes | 15 `lens` |
| Keys (Mutalist Alad V…), Proof Fragments, ship part blueprints | Yes | a handful each |
| Imprints | Yes, by breed | 15 `imprint` |
| Kuva and Tenet weapons, liches | Not as listings | lich auctions only; a built weapon can't be traded |
| Cosmetics (syndicate armour, Arcane helmets, emotes) | Yes, but not readable | 61 `skin`, 22 `emote`; TennoScope's inventory doesn't carry them |
| Resources in general (Kuva, Riven Sliver, Kavat Genetic Code…) | **No** | 48 of 377 held resource rows match, all in the kinds above |

So the panel offers only what's both tradable and in the inventory read. Archon shards, fish parts
and raw ores are named once, in Resources' "never listed" line, so a player looking for them knows
why they aren't there.

### Keeping what building for mastery still needs

The catalog gives each masterable item's components with `itemCount` (a Rahn Prism takes 20 Tear
Azurite), and `needsByUnique` already keeps those for every item not mastered and not owned. It
doesn't look one level down: a warframe's Neuroptics blueprint takes gems too, and the catalog lists
the Neuroptics, not what they take. The recipe data (`dev-recipe-data.json`, `Model.recipes`, from
recipes.rs) has every Foundry recipe, parts' own included (`recipes[path].i: [path, count][]`);
`buildPlan` already reads it for one item.

On the dev data, three tradable gems are needed by part recipes that the current rule misses:

| Gem | Kept now (top level) | Also taken by parts' recipes | Held |
|---|---|---|---|
| Purged Dagonic | 0 | 40 | 200 |
| Star Crimzian | 6 | 20 | 104 |
| Radian Sentirum | 0 | 5 | 30 |

With "Everything else" ticked today, the 40 Purged Dagonic would be listed. The rule to compute:
for each item masterable, not mastered and not owned, for each component that is a part (a
`…Component` or `…Blueprint` path) not built yet (`m.owned(part) < itemCount`), add
`recipes[part].i` × the copies still to build; plus the components themselves as now. That's
`needsByUnique` extended, and it's what "Keep what builds need" means in the panel. Worth fixing in
spares.ts whatever happens to this design (not done here: spares.ts is being changed on
`listing-fix`).

## 2. Where it lives: its own page

The developer allowed moving the panel off Orders if it takes too much room. Both are mocked in
the prototype (Where it lives: In Orders, Its own page, Orders then).

**Recommendation: its own page, "Sell spares", in Trade, right after Orders.** Orders keeps one
line pointing at it.

- **Room.** With one row open and a plan made, the panel is 1,500–2,000 px tall at 1000 px wide
  (screenshots `*-inline-mods`, `*-review-*`). Inside Orders it pushes the player's listings, the
  thing Orders is for, a screen or two down. The review list also needs its own scroll box inside
  the fold, and a row menu at the foot of a scroll box gets clipped. On a page the page scrolls.
- **Two tasks.** Orders is keeping listings right (prices, shown or hidden, sold out). The spares
  plan is choosing what to put up. They share a store, not a screen.
- **Sidebar and shortcuts.** One entry in `PAGES` after `market`:
  `{ id: "spares", label: "Sell spares", group: "Trade", icon: { game: "platinum" }, hint: "Choose what to sell and how, look over the plan, list it in one go" }`.
  Ctrl+1…9 follow the drawn order of shown pages; with the usual hidden pages (Planner, Browse,
  Stats) the first nine end at Prime parts, so Trade's order doesn't move anyone's shortcuts. A
  player who hid enough pages to bring Orders into the first nine would find Sales one key later.
  Not on consoles (the plan needs the inventory): leave it out of `CONSOLE`.
- **Links that point at the panel now**, each to move to `spares`:
  - Home's Ready to list head (`market?spares=1#spares`, "List spares");
  - What's New entries with `open: "market?spares=1#spares"` (old notes: keep them working by
    sending `market?spares=1` to `spares` in the intent handler);
  - Orders' `takeIntent("market")?.spares`, and `settings.market.sparesOpen` (retired: the page has
    no fold);
  - the Guide's Orders line and the Trade section's paragraph about Put my spares on sale, plus a
    line of its own for the page; the "What you can spare" list item that says "Everything else I
    don't need" on Orders;
  - Tick.svelte and ListDialog's notes that name the panel ("Put my spares on sale keeps it off the
    market"): the page name instead;
  - the tour has no step on it today; a Show me target on the page (`spares#cat-mods`) works with the
    ids the rows already carry.
- **Orders keeps** a one-line summary: "Sell spares · 71 listings ready from 7 kinds · ~1,899p · a
  plan of 9 changes to look over · Open →", and "Applying the plan: 4 of 9" while it runs, so a plan
  in progress is never out of sight.

If the page is turned down, the inline version works as it stands (`page={false}`, the review list
in its own scroll box).

## 3. The panel

### Anatomy

- **One row per category, closed by default.** Box (sell these or not), icon and name, the choices
  in one line of plain words, then what it would list: "42 listings · ~827p". A row that's off says
  "Not sold" and dims its numbers, which still show what ticking it would add.
- **Clicking the row opens its options beneath it.** One row at a time: opening another closes the
  first. Every row's choices are already readable in its line, so two open at once would only buy
  scrolling. The fold is the motion kit's `reveal` (grid rows, `--quick`), and the chevron turns.
- **In the options:** Seg for a choice of two or three, Switch for an on/off with a sentence under
  it, a small stepper (− n +) for keep numbers, and for categories with several kinds a compact
  table of lines (box, name, keep, note, count). Every control says what it does in its label, note
  or title. At the foot of the options, a lock line says what the category **always** keeps,
  whatever the options say: the rules that aren't options are written down rather than hidden.
- **Numbers:** before a plan, from the daily medians, marked "~"; after a plan, the plan's own
  counts. The count left out by the price minimum is said in the options ("268 more spare mods sell
  for under your 10p minimum: left out"), so a short count is never a mystery.
- **Top:** "7 of 7 kinds · 71 listings · ~1,899p", and "Back to the usual rules" when anything
  differs from the usual (never-sell items kept).
- **Foot:** the two rules that apply to everything, "Over 100 listings? Keep: Most plat | Sells most
  often" and "Skips anything under 10p, relics under 3p", with the Plan button.

### Presets: no

"Careful / Usual / Clear everything" were weighed and left out. The closed rows already summarise
every choice in a line each, which is what a preset name would stand for; a preset needs a "Custom"
state the moment one stepper moves; and "Clear everything" would have to define what it does to
never-sell items and lich mods, the two places where the safe answer matters most. One "Back to the
usual rules" link covers the real need (undoing experiments).

### Categories, options and defaults

Defaults are the current rules. Keep numbers count the player's best copy.

| Row | Options | Default | Always kept (not an option) |
|---|---|---|---|
| **Prime sets and parts** | Sell: Whole sets / Sets, then parts / Parts only · Keep n of each part · Only sets my relics drop | on · Sets, then parts · keep 0 · off | parts and sets to build and master anything unbuilt; anything its ducats beat at the player's rate (bulk.ts' ducat edge); loose parts waiting for a set worth more whole (Settings, Selling) |
| **Mods** | Keep n (every other mod) · Only mods that sell every day · per family: on/off and keep n for Primed, Galvanized and Archon, Warframe augments, Stances, Requiem, Antivirus | on · keep 2 · daily only · every family on, keep 2; Requiem and Antivirus 5 while their weapons are left to master, then the ordinary keep | installed copies; at least one of every mod (keep never goes below 1) |
| **Arcanes** | Sell: Maxed copies / Every spare copy · Keep n maxed · Legendary ones too | on · maxed · keep 1 · Legendary on | copies toward the player's own maxed one; arcanes worth more dissolved for Vosfor |
| **Relics** | Keep n of each (per refinement) | off (it was part of Everything else) · keep 0 | relics that drop a part still needed; any relic selling for no more than a crack is worth (solo or radshare, as on Relics); Settings' "relics worth selling" still gates it |
| **Weapon parts and sets** | Sell: Whole sets / Sets, then parts / Parts only | on · Whole sets (the old Sets I don't need without Everything else) | parts and blueprints unbuilt weapons take; hound, MOA, kitgun, zaw and amp parts while the family has anything unmastered; damaged Necramech parts to build with |
| **Resources and more** | Keep what builds need, plus n · per kind on/off: Refined gems, Whole fish, Ayatan sculptures (Empty / Filled), Ayatan stars, Captura scenes, Focus lenses, Keys and the rest, Veiled rivens | off · plus 0 · every kind on · Empty | what unmastered gear takes to build, parts' recipes included (section 1); one of each Captura scene; never listed: shards, fish parts, raw ores |
| **Companion imprints** | Keep n of each breed | on · keep 0 | |

Notes on single options:
- **Only sets my relics drop**: a set goes only when the player holds a relic that drops each of its
  parts, so it can be cracked again. The request said "only prime sets for items they have relics
  for"; an alternative reading is "only sets that aren't vaulted" (vaulted sets gain value). See
  the open questions.
- **Ayatan Filled**: the inventory doesn't say which sculptures have stars in. Filled lists as many
  sculptures as the spare stars can fill (a table of each sculpture's slots is needed; the wiki
  has it), as filled listings, and says to socket the stars in game first. Stars the filled ones
  take aren't listed as stars.
- **Veiled rivens** is the existing Settings, Selling switch shown here as well (one setting, two
  places); its note says it also changes what Inventory counts as spare.
- **Arcanes, Every spare copy** lists unranked copies beyond the maxed one's 21. They sell slowly
  in piles (vosfor.ts' `copyValue`), which the note says.

## 4. The plan, looked over

- **Every line says which rule decided it**, in its own column: category then rule ("Mods · Keep 2",
  "Prime · Ducats", "Relics · Beats a crack", "Under 10p", "Never sold"), with the reason in words
  under the item's name. The words already exist (`why`, `priceWhy`); the rule tag is new: each
  `BulkAction` gains `rule: string` (a few words) set where the action is made.
- **Left out** is part of the same table, under a "Left out · n" heading, each line with its rule.
  This replaces "Show n left out".
- **One ⋯ per line** (RowMenu: a menu button with two choices; Enter, Space or ↓ opens on the first,
  ↑ ↓ Home End move, Esc and Tab close, focus returns to the ⋯; a click elsewhere closes it):
  - **Skip this time**: out of this plan only (in memory with the plan: `mkt.bulk.skipped`, a set
    of listing keys); the line moves to Left out as "Skipped this time" with the menu offering "Put
    it back". The next Plan starts clean.
  - **Never sell**: on the never-sell list for good. The line collapses to UndoSlot's "Never sold:
    Xiran · Undo" for five seconds (UndoSlots), then moves to Left out as "Never sold", its menu
    offering "Sell again".
  - Removals carry no menu (taking a listing down for good is the opposite of never selling).
- **Undoing a never-sell**, outside the plan:
  - in each category's options, only when it has some, "Never sold: 4 mods" opens the list with
    "Sell again" on each and "Sell all 4 again" (shown from two up: with one item the two buttons
    would do the same thing);
  - in the item's details sheet and Find anything's result: "Never sold · Sell again"
    (`NeverSoldTag`).
- No other lines or pages get extra buttons.

### Never sell, or keep at least N per item?

Recommended: **Never sell**, plain. The keep numbers that matter already exist where players think
about them (per family, per category: "keep 5 Requiem" covers "keep 3 Khra"). A per-item keep
number would need a stepper in a menu, a column to show it, and a rule for how it combines with the
family's number (the larger? the item's?). The schema leaves room: if per-item numbers are wanted
later, `neverSell` entries can gain `keep?: number`, absent meaning never.

## 5. Motion and feedback

Per the motion contract: the row's fold uses `reveal`, the chevron turns over `--quick`; boxes fill
at once; a stepper's buttons sink a pixel on press; the menu opens with `opens` (fade and .98 → 1,
120 ms); a Never sell line leaves with `leave` and the table closes up with `flip`; Sell again in
the never-sold list leaves the same way; Sell again in a sheet pulses the gold ring (`pulse`).
Counts could roll with `Count` when a choice changes them (one rAF, ≤240 ms). Nothing animates on
load. Reduced motion drops every duration, never a state.

## 6. Settings: schema and migration

`src/lib/core/sparesRules.ts`, tested in `tests/sparesRules.test.ts`.

```ts
settings.market.spares: SparesRules = {
  version: 2,
  prime:     { on, sellAs: "sets" | "setsFirst" | "parts", onlyRelicsHeld, keep },     // keep ≥ 0
  mods:      { on, keep, dailyOnly,                                                   // keep ≥ 1
               families: { primed, galvanized, augment, stance, requiem, antivirus: { on, keep } } },
  arcanes:   { on, which: "maxed" | "any", legendary, keepMaxed },                     // keepMaxed ≥ 1
  relics:    { on, keep },
  gear:      { on, sellAs },
  resources: { on, families: { gems, fish, ayatan, stars, captura, lenses, other }, ayatan: "empty" | "filled", margin },
  imprints:  { on, keep },
  priority:  "plat" | "trades",
  neverSell: { id, name, cat }[],   // warframe.market item id; every rank and variant
}
```

- **Sanitising** (`sparesRulesOf`, `sparesSettingsOf`): anything missing or of the wrong type takes
  its default; numbers are rounded and clamped (keep numbers 0 or 1 up to 99); enums fall back to
  the default; never-sell entries need an id of `[A-Za-z0-9_-]`, are deduplicated by id, have
  control and format characters stripped from the name (zero-width, bidi), and are capped at 5,000.
- **Where it's stored**: version 2 under `settings.market.spares`; the old switches stay under
  `settings.market.bulk`, rewritten from the new choices on every save (`toStored`). Version 2
  can't go under `bulk`: it shares names with the old switches, and an older build (Stable behind
  Experimental) would read `mods: { on: false }` as ticked. This way an older build reads the
  player's choices as closely as six switches can.
- **Migration** (`fromV1`), so what was listed before is listed after:

  | Old | New |
  |---|---|
  | `sets` + `parts` | `prime.on`, `prime.sellAs`: both → setsFirst, sets only → sets, parts only → parts |
  | `sets` + `other` | `gear.on`, `gear.sellAs`: same mapping (weapon parts were under Everything else) |
  | `partsKeep` | `prime.keep` |
  | `mods`, `arcanes`, `imprints` | `.on`; their keep numbers are today's fixed ones (2; Requiem and Antivirus 5; 1 maxed; 0) |
  | `other` | `relics.on` and `resources.on` |
  | `priority` | `priority` |

  Every one of the 64 combinations of the old switches round-trips through `legacyRules` (tested).
- **Before the plan logic reads version 2**, `legacyRules` gives bulk.ts the old switches, so the
  panel can ship first; what it can't say is listed in its comment.
- **Wiring** (for the build, not done here): `backend.ts` replaces the `bulk` spread with
  `spares: sparesSettingsOf(raw?.market)` and saves `toStored(rules)`; `rulesKey` in the panel
  becomes `JSON.stringify(rules)`.

### What the plan logic needs to honour (for the build)

- `neverSell` in **every** category in `sellTargets` (a target whose resolved item id is on the
  list becomes a skip, rule "Never sold") and in the final pre-listing guard (`listGuard.ts` on
  `listing-fix`: refuse a create, a raise or a re-show for a never-sell item, with the reason);
  an existing listing of a never-sell item is left as listed (not taken down: it's the player's).
- Skip this time: the plan's skipped keys are dropped from Apply, and from a replan that keeps the
  same plan (the 10-minute reprice).
- Per category: prime `sellAs` and `onlyRelicsHeld` (relic ownership: `m.ownedRelicCount`,
  `m.sourcesByReward`); mod families by path (Requiem, Antivirus as views.ts already does) and by
  name or catalog flag (Primed by name, Galvanized and Archon by name, augments by `isAugment`,
  stances by `type`); `dailyOnly`; arcanes `which`, `legendary` (catalog rarity) and `keepMaxed`;
  relics `keep`; resource families by `typeOf` in spares.ts; `margin` on top of the recipe needs
  of section 1; imprints `keep`.
- `preview`: per category and family, listings and platinum, from the spare ledger before a plan
  (daily medians) and from the plan after.

## 7. The prototype

The dev-server preview (`spares-preview.html`, `src/dev/`) was removed once the page was built.
Files: `src/lib/ui/SparesPlan.svelte` (the rows), `src/lib/ui/spares/` (`CategoryRow`,
`FamilyLine`, `Stepper`, `NeverSoldLine`, `PlanReview`, `RowMenu`, `NeverSoldTag`, `types.ts`),
`src/lib/tabs/Spares.svelte` (the page).

## 8. Open questions

1. "Only prime sets for items they have relics for": sets whose parts the player's own relics drop
   (as designed), or sets that aren't vaulted?
2. Own page "Sell spares" (recommended), or keep it inside Orders?
3. Never sell as a plain list (recommended), or "keep at least N" per item?
4. Ayatan Filled needs each sculpture's star slots (wiki data, not in the catalog). Worth adding, or
   offer Empty only for now?
5. Relics as their own row means Settings, Selling's "relics worth selling" and the row's box both
   gate it. Fold the setting into the row?
6. Should a category's options be editable while it's off (as now, with a note), or greyed out?

### Decided

1. Sets whose every part drops from a relic the player holds.
2. Its own page, Sell spares, in Trade after Orders; Orders keeps one line with a link. Old links
   (`market?spares=1`) open the page.
3. Never sell, plain, keyed by warframe.market's item id; the last check before a listing
   (`listGuard.ts`) refuses it too, the listing form included, with Sell again beside the refusal.
4. Empty Ayatan sculptures only for now: Filled isn't offered.
5. Settings, Selling's relic switch is the Relics row: off there before, the row starts off. Every
   relic worth more sold than cracked counts as spare on Inventory, as the switch's default did.
6. An unticked row's options are greyed out (disabled); its line says "Not sold".

Differences from the text above:
- Prime "keep n of each part" counts loose parts, as the old `partsKeep` did: parts that go out in a
  whole set still go as the set (so the old settings plan the same).
- Resources' margin and relics' keep apply to each row; Captura keeps its one on top.
- An older build reading the same settings gets the six switches only; the old relic switch isn't
  written back (it can't tell relics from the rest of Everything else anyway).
