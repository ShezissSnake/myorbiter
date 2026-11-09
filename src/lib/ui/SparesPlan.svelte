<script lang="ts">
  // Sell spares, the choices: one compact row per category (its box, its choices in a line of
  // words, what it would list), and the row you click opens its options beneath it, one at a time.
  // Every option says what it does; what a category always keeps whatever the options say is
  // written at the foot of its options. The listing limit and the minimum prices (one for
  // everything, then each category's own), stay at the bottom with the button that makes the plan. A category that's off
  // keeps its options as they are, greyed out.
  //
  // It draws the choices (settings.market.spares, version 2: core/sparesRules.ts) and the counts
  // the page gives it (core/bulk.ts: sparesPreview, planTally).
  import type { Snippet } from "svelte";
  import CategoryRow from "./spares/CategoryRow.svelte";
  import FamilyLine from "./spares/FamilyLine.svelte";
  import NeverSoldLine from "./spares/NeverSoldLine.svelte";
  import Stepper from "./spares/Stepper.svelte";
  import Minimums from "./spares/Minimums.svelte";
  import Seg from "./Seg.svelte";
  import Switch from "./Switch.svelte";
  import P from "./P.svelte";
  import Count from "./Count.svelte";
  import type { GameIconName } from "./GameIcon.svelte";
  import {
    CATEGORY_LABEL,
    KEEP_MIN,
    MOD_FAMILIES,
    MOD_FAMILY_LABEL,
    RESOURCE_FAMILY_LABEL,
    SPARE_CATEGORIES,
    isUsual,
    minimumFor,
    neverSoldIn,
    summaryOf,
    usualKeeping,
    type SellAs,
    type SpareCategory,
    type MinByCategory,
    type SparesRules,
  } from "../core/sparesRules";
  import type { SparesFacts, SparesPreview } from "./spares/types";

  let {
    rules = $bindable(),
    veiledRivens = $bindable(false),
    saveForSets = $bindable(true),
    minPrice = $bindable(),
    minByCategory = $bindable(),
    preview,
    facts,
    open = $bindable(null),
    page = false,
    onsellagain,
    actions,
  }: {
    rules: SparesRules;
    /** Sell veiled rivens: they count as spare (and so can be listed). Switched at the foot, and shown under Resources. */
    veiledRivens?: boolean;
    /** Save prime parts for sets: a loose part waits for its set when the set sells for clearly more. */
    saveForSets?: boolean;
    /** The minimum price for everything (also Orders' Never under), and each category's own. */
    minPrice: number;
    minByCategory: MinByCategory;
    preview: SparesPreview;
    facts: SparesFacts;
    /** The category whose options are open: one at a time. */
    open?: SpareCategory | null;
    /** On a page of its own (the title is the page's); false inside Orders' fold. */
    page?: boolean;
    onsellagain: (ids: string[]) => void;
    /** The plan button (ProgressButton in the app), at the foot beside the rules for everything. */
    actions?: Snippet;
  } = $props();

  const ICON: Record<SpareCategory, GameIconName> = { prime: "ducats", mods: "endo", arcanes: "vosfor", relics: "relic-axi-intact", gear: "foundry", resources: "aya", imprints: "companions" };
  const toggle = (c: SpareCategory) => (open = open === c ? null : c);

  const ticked = $derived(SPARE_CATEGORIES.filter((c) => rules[c].on));
  const total = $derived(ticked.reduce((t, c) => ({ listings: t.listings + (preview[c]?.listings ?? 0), plat: t.plat + (preview[c]?.plat ?? 0) }), { listings: 0, plat: 0 }));
  const estimate = $derived(ticked.some((c) => preview[c]?.estimate));
  const usual = $derived(isUsual(rules));
  const rate = $derived(facts.platPerDucat.toFixed(2).replace(/0$/, ""));
  const fam = (c: SpareCategory, f: string) => preview[c]?.families?.[f as keyof NonNullable<SparesPreview[SpareCategory]>["families"]] ?? null;
  const under = (c: SpareCategory, what: string) => {
    const n = preview[c]?.under ?? 0;
    const min = minimumFor(facts, c);
    return n ? `${n} more spare ${what} sell for under your ${min}p minimum${facts.minByCategory[c] != null ? " for them" : ""}: left out` : "";
  };

  const off = (c: SpareCategory) => !rules[c].on;
  const SELL_AS_OPTIONS = (whole: string): { v: SellAs; label: string; title: string }[] => [
    { v: "sets", label: "Whole sets", title: `Only complete ${whole} sets; loose parts stay in your inventory` },
    { v: "setsFirst", label: "Sets, then parts", title: "Complete sets first, then every spare part left over on its own" },
    { v: "parts", label: "Parts only", title: "Every spare part on its own, never put together as a set (parts often sell faster)" },
  ];
  const SELL_AS_NOTE: Record<SellAs, string> = {
    sets: "Only complete sets go up. A set usually fetches more than its parts one by one, but sells less often.",
    setsFirst: "Spare parts that make complete sets go up as sets; the rest go one by one.",
    parts: "Every spare part goes up on its own, sets broken up. Faster to sell, often less in all.",
  };
</script>

<div class="spares-plan" class:page>
  <header class="top">
    {#if !page}<p class="small dim lead">Tick what to sell, open a row to choose how. Nothing is sent until you've looked over the plan.</p>{/if}
    <div class="totals" title={estimate ? "From the daily prices: the plan reads the cheapest in-game price for each" : "From the last plan"}>
      <span class="register">{ticked.length} of {SPARE_CATEGORIES.length} kinds</span>
      {#if ticked.every((c) => preview[c])}
        <span><b><Count value={total.listings} /></b> listings</span>
        <span class="pl">{estimate ? "~" : ""}<P v={Math.round(total.plat)} /></span>
      {:else}<span title="Working out what each kind would list">…</span>{/if}
      {#if !usual}<button type="button" class="link quiet" title="Every choice back to MyOrbiter's usual one (what you never sell stays as it is)" onclick={() => (rules = usualKeeping(rules))}>Back to the usual rules</button>{/if}
    </div>
  </header>

  <div class="cats">
    <!-- Prime -->
    <CategoryRow id="cat-prime" bind:on={rules.prime.on} open={open === "prime"} ontoggle={() => toggle("prime")} label={CATEGORY_LABEL.prime} icon={ICON.prime} summary={summaryOf("prime", rules, facts.lichLeft)} preview={preview.prime}
      always="Always kept: the parts and sets you need to build and master anything unbuilt; anything its ducats beat at your rate ({rate}p a ducat, set on Prime parts); loose parts waiting for a set worth more whole (Save prime parts for sets, at the foot of this page).">
      <fieldset class="opts" disabled={off("prime")}>
        <div class="opt wide">
          <Seg label="Sell" bind:value={rules.prime.sellAs} options={SELL_AS_OPTIONS("prime")} />
          <p class="note">{SELL_AS_NOTE[rules.prime.sellAs]}</p>
        </div>
        <div class="opt" class:quiet={rules.prime.sellAs === "sets"}>
          <span class="ol"><span class="register">Keep</span><Stepper bind:value={rules.prime.keep} min={KEEP_MIN.prime} disabled={off("prime")} label="Loose copies of each prime part to keep" title="Loose copies of each prime part kept, on top of what you build and master" /><span class="register">of each part</span></span>
          <p class="note">Loose ones, on top of what you build and master; parts in a whole set still go as the set. 0 sells every spare.{#if rules.prime.sellAs === "sets"} No loose parts are sold now.{/if}</p>
        </div>
        <div class="opt" class:quiet={rules.prime.sellAs === "parts"}>
          <Switch bind:on={rules.prime.onlyRelicsHeld} disabled={off("prime")} label="Only sets my relics drop" title="Sell a prime set only when a relic you hold drops every one of its parts">A set goes only when a relic you hold drops each of its parts, so you can crack another.{#if rules.prime.sellAs === "parts"} No sets are sold now.{/if}</Switch>
        </div>
      </fieldset>
      {#if under("prime", "parts")}<p class="note">{under("prime", "parts")}.</p>{/if}
      <NeverSoldLine entries={neverSoldIn(rules, "prime")} one="part or set" many="parts and sets" {onsellagain} />
    </CategoryRow>

    <!-- Mods -->
    <CategoryRow id="cat-mods" bind:on={rules.mods.on} open={open === "mods"} ontoggle={() => toggle("mods")} label={CATEGORY_LABEL.mods} icon={ICON.mods} summary={summaryOf("mods", rules, facts.lichLeft)} preview={preview.mods}
      always="Always kept: copies installed in a build, and at least one of every mod. Rivens aren't here: veiled ones are under Resources, unveiled ones go by auction on Rivens.">
      <fieldset class="opts" disabled={off("mods")}>
        <div class="opt">
          <Switch bind:on={rules.mods.dailyOnly} disabled={off("mods")} label="Only mods that sell every day" title="Leave out mods that sell less than once a day on warframe.market">Common mods at a few platinum can sit for weeks. Off lists slow sellers too.</Switch>
        </div>
      </fieldset>
      <fieldset class="families" disabled={off("mods")} aria-label="Kinds of mods">
        <FamilyLine fixed on={true} disabled={off("mods")} bind:keep={rules.mods.keep} keepMin={KEEP_MIN.mods} label="Every other mod" title="Every mod outside the kinds below" note={rules.mods.keep === 2 ? "your best copy and one to give a new player" : ""} tally={fam("mods", "ordinary")} estimate={preview.mods?.estimate} />
        {#each MOD_FAMILIES as f (f)}
          {@const lich = f === "requiem" ? facts.lichLeft.requiem : f === "antivirus" ? facts.lichLeft.antivirus : null}
          <FamilyLine disabled={off("mods")} bind:on={rules.mods.families[f].on} bind:keep={rules.mods.families[f].keep} keepMin={KEEP_MIN.family} label={MOD_FAMILY_LABEL[f]} tally={fam("mods", f)} estimate={preview.mods?.estimate}
            note={lich == null ? "" : lich ? `while ${lich} ${f === "requiem" ? "Kuva or Tenet" : "Coda"} weapon${lich === 1 ? " is" : "s are"} left to master, then ${rules.mods.keep}` : `all mastered: ${rules.mods.keep}, as other mods`}
            title={f === "requiem" ? "Requiem mods (Khra, Lohk and the rest, and Oull): Kuva Liches and Sisters of Parvos take them" : f === "antivirus" ? "Antivirus mods: the Technocyte Coda take them" : f === "galvanized" ? "Galvanized and Archon mods" : f === "augment" ? "Warframe augment mods (an ability's augment)" : f === "primed" ? "Primed mods" : "Stance mods"} />
        {/each}
      </fieldset>
      {#if under("mods", "mods")}<p class="note">{under("mods", "mods")}.</p>{/if}
      <NeverSoldLine entries={neverSoldIn(rules, "mods")} one="mod" many="mods" {onsellagain} />
    </CategoryRow>

    <!-- Arcanes -->
    <CategoryRow id="cat-arcanes" bind:on={rules.arcanes.on} open={open === "arcanes"} ontoggle={() => toggle("arcanes")} label={CATEGORY_LABEL.arcanes} icon={ICON.arcanes} summary={summaryOf("arcanes", rules, facts.lichLeft)} preview={preview.arcanes}
      always="Always kept: the copies toward your own maxed one, and arcanes worth more dissolved for Vosfor (Arcanes, Sell or dissolve).">
      <fieldset class="opts" disabled={off("arcanes")}>
        <div class="opt wide">
          <Seg label="Sell" bind:value={rules.arcanes.which} options={[
            { v: "maxed", label: "Maxed copies", title: "Only arcanes at their top rank (5, or 3 for older ones), beyond the ones you keep" },
            { v: "any", label: "Every spare copy", title: "Maxed ones, and unranked copies beyond what your maxed one took" },
          ]} />
          <p class="note">{rules.arcanes.which === "maxed" ? "Fuse spare copies in game first: a maxed arcane sells for its 21 copies' worth at once." : "Unranked copies go up as they are. Quicker, but a pile of them rarely fetches the unranked price."}</p>
        </div>
        <div class="opt">
          <span class="ol"><span class="register">Keep</span><Stepper bind:value={rules.arcanes.keepMaxed} min={KEEP_MIN.arcanes} disabled={off("arcanes")} label="Maxed copies of each arcane to keep" /><span class="register">maxed</span></span>
          <p class="note">Of each arcane. Two if you run it on two builds at once.</p>
        </div>
        <div class="opt">
          <Switch bind:on={rules.arcanes.legendary} disabled={off("arcanes")} label="Legendary ones too" title="Sell spare Legendary arcanes as well">The rarest arcanes, slowest to farm again. Off keeps every copy.</Switch>
        </div>
      </fieldset>
      {#if under("arcanes", "arcanes")}<p class="note">{under("arcanes", "arcanes")}.</p>{/if}
      <NeverSoldLine entries={neverSoldIn(rules, "arcanes")} one="arcane" many="arcanes" {onsellagain} />
    </CategoryRow>

    <!-- Relics -->
    <CategoryRow id="cat-relics" bind:on={rules.relics.on} open={open === "relics"} ontoggle={() => toggle("relics")} label={CATEGORY_LABEL.relics} icon={ICON.relics} summary={summaryOf("relics", rules, facts.lichLeft)} preview={preview.relics}
      always="Always kept: relics that drop a part you still need, and any relic that sells for no more than a crack of it is worth ({facts.squad > 1 ? 'in a radshare' : 'cracked solo'}, as chosen on Relics). Each refinement is weighed on its own.">
      <fieldset class="opts" disabled={off("relics")}>
        <div class="opt">
          <span class="ol"><span class="register">Keep</span><Stepper bind:value={rules.relics.keep} min={KEEP_MIN.relics} disabled={off("relics")} label="Copies of each relic to keep" /><span class="register">of each</span></span>
          <p class="note">To crack yourself, of each relic and refinement. 0 sells every one worth selling.</p>
        </div>
      </fieldset>
      {#if under("relics", "relics")}<p class="note">{under("relics", "relics")}.</p>{/if}
      <NeverSoldLine entries={neverSoldIn(rules, "relics")} one="relic" many="relics" {onsellagain} />
    </CategoryRow>

    <!-- Gear -->
    <CategoryRow id="cat-gear" bind:on={rules.gear.on} open={open === "gear"} ontoggle={() => toggle("gear")} label={CATEGORY_LABEL.gear} icon={ICON.gear} summary={summaryOf("gear", rules, facts.lichLeft)} preview={preview.gear}
      always="Always kept: the parts and blueprints your unbuilt weapons take; hound, MOA, kitgun, zaw and amp parts while anything in that family is unmastered; damaged Necramech parts you'll build with.">
      <fieldset class="opts" disabled={off("gear")}>
        <div class="opt wide">
          <Seg label="Sell" bind:value={rules.gear.sellAs} options={SELL_AS_OPTIONS("weapon")} />
          <p class="note">Weapon parts, their blueprints, Necramech parts and the sets warframe.market trades whole (Mandonel, Lato Vandal, Necramechs). {SELL_AS_NOTE[rules.gear.sellAs]}</p>
        </div>
      </fieldset>
      {#if under("gear", "parts")}<p class="note">{under("gear", "parts")}.</p>{/if}
      <NeverSoldLine entries={neverSoldIn(rules, "gear")} one="part" many="parts" {onsellagain} />
    </CategoryRow>

    <!-- Resources -->
    <CategoryRow id="cat-resources" bind:on={rules.resources.on} open={open === "resources"} ontoggle={() => toggle("resources")} label={CATEGORY_LABEL.resources} icon={ICON.resources} summary={summaryOf("resources", rules, facts.lichLeft)} preview={preview.resources}
      always="Never listed: Archon and Eidolon shards, fish parts, raw ores and gems and most other resources. warframe.market doesn't trade them.">
      <fieldset class="opts" disabled={off("resources")}>
        <div class="opt wide">
          <span class="ol"><span class="register">Keep what builds need, plus</span><Stepper bind:value={rules.resources.margin} min={KEEP_MIN.margin} disabled={off("resources")} label="Copies kept beyond what builds need" /><span class="register">of each</span></span>
          <p class="note">What everything you haven't mastered still takes to build, its parts' own recipes included (a Rahn Prism's 20 Tear Azurite, the Styanax Neuroptics' 40 Purged Dagonic). The rest is spare.</p>
        </div>
      </fieldset>
      <fieldset class="families" disabled={off("resources")} aria-label="Kinds of resources">
        <FamilyLine disabled={off("resources")} bind:on={rules.resources.families.gems} label={RESOURCE_FAMILY_LABEL.gems} note="Cut and refined ones (Tear Azurite, Heart Noctrul)" tally={fam("resources", "gems")} estimate={preview.resources?.estimate} />
        <FamilyLine disabled={off("resources")} bind:on={rules.resources.families.fish} label={RESOURCE_FAMILY_LABEL.fish} note="Caught whole, each size its own listing" tally={fam("resources", "fish")} estimate={preview.resources?.estimate} />
        <FamilyLine disabled={off("resources")} bind:on={rules.resources.families.ayatan} label={RESOURCE_FAMILY_LABEL.ayatan} note="Empty ones, as they are (MyOrbiter can't see which hold stars, so filled ones aren't offered)" tally={fam("resources", "ayatan")} estimate={preview.resources?.estimate} />
        <FamilyLine disabled={off("resources")} bind:on={rules.resources.families.stars} label={RESOURCE_FAMILY_LABEL.stars} note="Amber and Cyan" tally={fam("resources", "stars")} estimate={preview.resources?.estimate} />
        <FamilyLine disabled={off("resources")} bind:on={rules.resources.families.captura} label={RESOURCE_FAMILY_LABEL.captura} note="One of each kept to use" tally={fam("resources", "captura")} estimate={preview.resources?.estimate} />
        <FamilyLine disabled={off("resources")} bind:on={rules.resources.families.lenses} label={RESOURCE_FAMILY_LABEL.lenses} note="And their blueprints" tally={fam("resources", "lenses")} estimate={preview.resources?.estimate} />
        <FamilyLine disabled={off("resources")} bind:on={rules.resources.families.other} label={RESOURCE_FAMILY_LABEL.other} note="Keys you don't need, Proof Fragments, ship part blueprints" tally={fam("resources", "other")} estimate={preview.resources?.estimate} />
        <FamilyLine disabled={off("resources")} bind:on={veiledRivens} label="Veiled rivens" title="The Sell veiled rivens switch at the foot of this page: one setting, shown in both places" note="Sell veiled rivens, at the foot: also counts them as spare on Inventory" tally={fam("resources", "veiled")} estimate={preview.resources?.estimate} />
      </fieldset>
      {#if under("resources", "things")}<p class="note">{under("resources", "things")}.</p>{/if}
      <NeverSoldLine entries={neverSoldIn(rules, "resources")} one="thing" many="things" {onsellagain} />
    </CategoryRow>

    <!-- Imprints -->
    <CategoryRow id="cat-imprints" bind:on={rules.imprints.on} open={open === "imprints"} ontoggle={() => toggle("imprints")} label={CATEGORY_LABEL.imprints} icon={ICON.imprints} summary={summaryOf("imprints", rules, facts.lichLeft)} preview={preview.imprints}
      always="An imprint only hatches a companion: keep the ones you'll breed.">
      <fieldset class="opts" disabled={off("imprints")}>
        <div class="opt">
          <span class="ol"><span class="register">Keep</span><Stepper bind:value={rules.imprints.keep} min={KEEP_MIN.imprints} disabled={off("imprints")} label="Imprints of each breed to keep" /><span class="register">of each breed</span></span>
          <p class="note">Kubrow, Kavat, Vulpaphyla, Predasite and Helminth Charger imprints, by breed.</p>
        </div>
      </fieldset>
      <NeverSoldLine entries={neverSoldIn(rules, "imprints")} one="imprint" many="imprints" {onsellagain} />
    </CategoryRow>
  </div>

  <div class="minimums" id="minimums">
    <div class="switches">
      <Switch bind:on={saveForSets} label="Save prime parts for sets">
        A loose prime part waits for its set instead of being sold on its own when the set sells for clearly more than its parts one by one (at least 10% and 5p more, each part at its price or its ducats at your rate, whichever is more), and you can still get every part it's missing: from a relic you own, a relic that still drops, Varzia, or a part you've been getting lately (Stats, Parts you got). When you put your spares on sale, your listing for a part comes down if every copy you hold is waiting (one you also keep copies of to build stays as you listed it). Sets → Saving up shows what's waiting and what's left to get.
      </Switch>
      <Switch bind:on={veiledRivens} label="Sell veiled rivens">
        Off keeps every veiled riven to unveil yourself: never counted as spare on Inventory, and never put up by Sell spares (where it's the Veiled rivens line under Resources and more).
      </Switch>
    </div>
    <Minimums bind:minPrice bind:minByCategory />
    <p class="note">Nothing is listed or priced under its minimum (a spare that sells for less is left out), and repricing raises a listing under it to it. Your own floors on Orders, a prime's ducats and a relic's crack value still hold above it.</p>
  </div>

  <footer class="foot">
    <span class="prio" title="Only matters when there's more to list than warframe.market's 100 listings allow: which ones get the slots">
      <Seg label="Over 100 listings? Keep" bind:value={rules.priority} options={[
        { v: "plat", label: "Most plat", title: "The listings worth the most platinum (quantity × price)" },
        { v: "trades", label: "Sells most often", title: "The listings that sell most often, so your slots keep turning over" },
      ]} />
    </span>
    <span class="grow"></span>
    {#if actions}{@render actions()}{/if}
  </footer>
</div>

<style>
  .spares-plan { display: grid; gap: .7rem; }
  .top { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: .4rem 1.5rem; }
  .lead { margin: 0; }
  .totals { display: inline-flex; align-items: baseline; gap: .9rem; font-size: .82rem; color: var(--platinum-dim); font-variant-numeric: tabular-nums; margin-left: auto; }
  .totals b { font-family: var(--face-mark); font-size: 1.15rem; color: var(--platinum); margin-right: .15rem; }
  .totals .pl { display: inline-flex; align-items: center; }
  .cats { border-top: 1px solid var(--rule-bright); background: var(--plate); }
  fieldset { margin: 0; min-width: 0; }
  .opts { display: grid; grid-template-columns: repeat(auto-fill, minmax(17rem, 1fr)); gap: .9rem 1.6rem; align-items: start; border: 0; padding: 0; }
  /* Greyed out by colour, not opacity, so the text stays above 4.5:1. */
  .opts:disabled .note, .opts:disabled .register { color: var(--platinum-deep); }
  .opt { display: grid; gap: .35rem; min-width: 0; }
  .opt.wide { grid-column: 1 / -1; }
  .opt.quiet, .opt.quiet .note, .opt.quiet .register, .opt.quiet :global(.n) { color: var(--platinum-deep); }
  .ol { display: inline-flex; align-items: center; gap: .55rem; flex-wrap: wrap; }
  .note { margin: 0; font-size: .78rem; color: var(--platinum-deep); line-height: 1.5; max-width: 72ch; }
  .families { display: grid; padding: .1rem .7rem; border: 1px solid var(--rule); background: var(--well); }
  .families :global(.seg button) { height: 26px; padding: 0 .55rem; }
  .foot { display: flex; flex-wrap: wrap; align-items: center; gap: .6rem 1.2rem; padding-top: .3rem; }
  /* The plan button keeps to the right, wrapped onto its own line or not. */
  .foot :global(.planbtn) { margin-left: auto; }
  .switches { display: grid; grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr)); gap: .7rem 2rem; padding-bottom: .5rem; margin-bottom: .2rem; border-bottom: 1px solid var(--rule); }
  .minimums { display: grid; gap: .35rem; padding: .55rem .7rem; border: 1px solid var(--rule); background: var(--well); }
  .grow { flex: 1; }
</style>
