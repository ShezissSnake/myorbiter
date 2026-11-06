<script lang="ts">
  import { arrive, fresh } from "../motion";
  import Count from "../ui/Count.svelte";
  import PTick from "../ui/PTick.svelte";
  import Fold from "../ui/Fold.svelte";
  import Tabs from "../ui/Tabs.svelte";
  import type { Model } from "../core/model";
  import { crackRows, filterGaps, radiantRows, type CrackRow, type RadiantMetric, type RadiantRow, type SetGap } from "../core/advice";
  import type { AdviceSettings } from "../backend";
  import Table from "../ui/Table.svelte";
  import PageHead from "../ui/PageHead.svelte";
  import Stat from "../ui/Stat.svelte";
  import Named from "../ui/Named.svelte";
  import Thumb from "../ui/Thumb.svelte";
  import P from "../ui/P.svelte";
  import Avail from "../ui/Avail.svelte";
  import Seg from "../ui/Seg.svelte";
  import Chip from "../ui/Chip.svelte";
  import { eraTint, matches, type Column } from "../ui/table";
  import Owned from "../ui/Owned.svelte";
  import { info } from "../hover.svelte";
  import { details } from "../details.svelte";
  import { openEras, wishlistRelics } from "../core/wishlist";
  import type { Fissure } from "../core/types";
  import RelicPlate from "../ui/RelicPlate.svelte";
  import { keepWhile, shownPage, whenIdle, whileShown } from "../pane.svelte";
  import { inBackground } from "../progress.svelte";
  import { typed } from "../typed.svelte";

  // The mode is kept in settings, so it survives a restart and the Guide can open either one.
  // fissures: the live ones, so a relic you can crack right now says so.
  // wishlist: what you starred; relics you hold for it are marked, and can be the only ones shown.
  let { model, settings = $bindable(), mode = $bindable("sets"), fissures = null, wishlist = [], masteryRank = null }: { model: Model; settings: AdviceSettings; mode?: "sets" | "radiant"; fissures?: Fissure[] | null; wishlist?: string[]; masteryRank?: number | null } = $props();
  const forWish = $derived.by(whileShown("planner", () => wishlistRelics(model, wishlist)));
  let wishOnly = $state(false);
  const wishTitle = (base: string) => `For your wishlist: ${(forWish.get(base) ?? []).map((x) => x.part).join(", ")}`;
  let openOnly = $state(false);
  /** Buying a near-complete set's missing parts at the daily median; null when one has no price. */
  const buyCost = (g: SetGap) => g.missing.reduce<number | null>((n, x) => { const p = model.price(x.name); return n == null || p == null ? null : n + p * x.count; }, 0);
  // A fissure of the relic's own era open right now (Omnia ones take any relic, but one is nearly
  // always open, which would mark every relic).
  const openNow = $derived(openEras(fissures));
  const isOpen = (base: string) => (openNow[base.split(" ")[0]]?.length ?? 0) > 0;
  const ERAS_SHOWN = ["Lith", "Meso", "Neo", "Axi"];
  // Every era open (the usual case): the filter would leave everything, so it isn't offered.
  $effect(() => {
    if (openOnly && !ERAS_SHOWN.some((e) => !openNow[e]?.length)) openOnly = false;
  });
  let metric = $state<RadiantMetric>("plat");
  let vaultedOnly = $state(false);
  let query = $state("");
  /** What the list is filtered on: the box, a moment later while you type (typed.svelte.ts). */
  const q = $derived.by(typed(() => query));
  let sortSets = $state({ key: "value", desc: true });
  let sortRad = $state({ key: "gain", desc: true });

  /** "Intact ×18: 38.0%, 4.3p · Radiant ×1: 70.0%, 7.9p (solo)" */
  const refinementLine = (r: CrackRow) => `${r.perRefinement.map((x) => `${x.refinement} ×${x.copies}: ${(x.chance * 100).toFixed(1)}%, ${Math.round(x.value * 10) / 10}p`).join(" · ")} (${settings.squad > 1 ? "radshare, best of four" : "solo"}; the figure is the average over your copies)`;
  const traces = $derived((model.inventoryByBase.get("/Lotus/Types/Items/MiscItems/VoidTearDrop") ?? []).reduce((n, r) => n + r.quantity, 0));

  // ------------------------------------------------ crack for sets
  const plan = $derived.by(whileShown("planner", () => crackRows(model, settings.maxMissing, settings.squad)));
  const crack = $derived(plan.relics.filter((r) => (!vaultedOnly || r.vaulted) && (!openOnly || isOpen(r.base)) && (!wishOnly || forWish.has(r.base)) && matches(q, r.base, ...r.hits.map((h) => h.reward))));
  /** The gap lists show a few at first: the table above them is the plan. */
  const GAPS_SHOWN = 10;
  let open = $state<Record<string, boolean>>({});
  // The stats and the lists below follow the table's filters.
  const filtered = $derived(vaultedOnly || !!q.trim());
  const gaps = $derived.by(whileShown("planner", () => filterGaps(model, plan, vaultedOnly, (...fields) => matches(q, ...fields))));
  const lastParts = $derived(gaps.filter((g) => g.missingCount === 1));
  const uncovered = $derived(gaps.filter((g) => g.relicsOwned === 0));
  /** Any filter on, for the tables' empty line: Clear puts them all back. */
  const anyFilter = $derived(!!q.trim() || vaultedOnly || wishOnly || openOnly);
  function clear() {
    query = "";
    vaultedOnly = wishOnly = openOnly = false;
  }
  /** The two lists below the table don't repeat each other: one part away with a relic for it, then no relic for it. */
  const lastCovered = $derived(lastParts.filter((g) => g.relicsOwned > 0));

  /** Sets a crack of it could complete (it drops their last missing part). */
  const finishes = (r: CrackRow) => new Set(r.hits.filter((h) => h.last).map((h) => h.set)).size;
  const crackCols: Column<CrackRow>[] = [
    { key: "base", label: "Relic", value: (r) => r.base, defaultDesc: false, cell: relicCell },
    { key: "owned", label: "You have", value: (r) => Object.values(r.owned).reduce((a, b) => a + b, 0), cell: ownedCell, align: "right" },
    { key: "vault", label: "Vault", spare: true, value: (r) => (r.vaulted ? 1 : 0), cell: vaultCell, align: "center", title: "Vaulted: no new copies drop" },
    { key: "chance", label: "Part chance", value: (r) => r.chance, cell: chanceCell, align: "right", title: "Chance one crack gives a part a near-complete set is missing: the average over the copies you hold (hover a figure for each refinement), solo or radshare as set on Relics" },
    { key: "value", label: "Sets\u00a0/\u00a0crack", value: (r) => r.value, cell: valueCell, align: "right", title: "Toward sets, per crack: platinum per crack toward finishing sets, each missing part at what it adds to its set (the set's price over what your other parts already sell for loose), never less than the part's own price. Not the Relics page's plat per crack, which counts every reward at its own price" },
    { key: "finishes", label: "Finishes", value: (r) => finishes(r), cell: finishesCell, align: "right", title: "Sets one of its parts would complete: the last part you're missing" },
    { key: "hits", label: "Parts it can give", value: (r) => r.hits.length, cell: hitsCell, sortable: false, width: "38%", title: "The missing parts it drops; gold, with a ◆: the last part of a set" },
  ];

  // ------------------------------------------------ radiant
  const radiant = $derived.by(
    whileShown("planner", () =>
      radiantRows(model, { squad: settings.squad, metric, platPerDucat: settings.platPerDucat }).filter(
        (r) => r.refinable > 0 && (!vaultedOnly || r.vaulted) && (!openOnly || isOpen(r.base)) && (!wishOnly || forWish.has(r.base)) && matches(q, r.base, r.rare?.name),
      ),
    ),
  );
  /** Your traces spent where each one gains the most: how many relics that refines, and what it adds altogether. */
  const spend = $derived.by(() => {
    let left = traces;
    let total = 0;
    let copies = 0;
    const options = radiant.flatMap((r) => r.upgrades).filter((u) => u.gain > 0).sort((a, b) => b.gain / b.traces - a.gain / a.traces);
    for (const u of options) {
      const n = Math.min(u.count, Math.floor(left / u.traces));
      if (n <= 0) continue;
      total += n * u.gain;
      copies += n;
      left -= n * u.traces;
    }
    return { total, copies };
  });
  const unit = (v: number) => (metric === "need" ? `${Math.round(v * 1000) / 10}%` : null);

  // Both tabs stay drawn once drawn (the other one too, once the page is on screen and idle), the
  // one not chosen hidden: switching is then only showing it. The hidden one keeps its rows until
  // it's shown again, so a search typed in one doesn't redraw the other meanwhile.
  let drawnSets = $state(false);
  let drawnRadiant = $state(false);
  $effect.pre(() => {
    if (mode === "sets") drawnSets = true;
    else drawnRadiant = true;
  });
  $effect(() => {
    if (shownPage("planner") && !(drawnSets && drawnRadiant)) return whenIdle(() => inBackground(() => (drawnSets = drawnRadiant = true)));
  });
  const setsRows = $derived.by(keepWhile(() => mode === "sets", () => crack));
  const setsLast = $derived.by(keepWhile(() => mode === "sets", () => lastCovered));
  const setsUncovered = $derived.by(keepWhile(() => mode === "sets", () => uncovered));
  const radRows = $derived.by(keepWhile(() => mode === "radiant", () => radiant));
  const setsAnyFilter = $derived.by(keepWhile(() => mode === "sets", () => anyFilter));
  const radAnyFilter = $derived.by(keepWhile(() => mode === "radiant", () => anyFilter));

  // The squad and ducat rate are shared with Relics: while hidden, these wait for the next visit (lib/pane.svelte.ts).
  const radCols: Column<RadiantRow>[] = $derived.by(whileShown("planner", () => [
    { key: "base", label: "Relic", value: (r) => r.base, defaultDesc: false, cell: radRelicCell },
    { key: "owned", label: "You have", value: (r) => r.refinable, cell: radOwnedCell, align: "right", title: "Copies you could still refine" },
    { key: "vault", label: "Vault", spare: true, value: (r) => (r.vaulted ? 1 : 0), cell: vaultCell, align: "center", title: "Vaulted: no new copies drop" },
    { key: "rare", label: "Rare reward", value: (r) => r.rare?.price ?? null, cell: rareCell, title: "The rare drop: 2% from an intact relic, 10% from a radiant one" },
    { key: "intact", label: `${metric === "need" ? "Need, intact" : "Avg intact"}${settings.squad > 1 ? " ×4" : ""}`, value: (r) => r.intact, cell: intactCell, align: "right" },
    { key: "radiant", label: `${metric === "need" ? "Need, radiant" : "Avg radiant"}${settings.squad > 1 ? " ×4" : ""}`, value: (r) => r.radiant, cell: radiantCell, align: "right" },
    { key: "gain", label: "Gain", value: (r) => r.gain, cell: gainCell, align: "right", title: settings.squad > 1 ? "What 100 Void Traces add: the best reward of a 4-person radshare, radiant vs intact" : "What 100 Void Traces add: one crack, radiant vs intact" },
  ]));
</script>

{#snippet relicCell(r: { base: string })}<span class="rel"><Named file={model.imageOf(r.base)} name={r.base} tint={eraTint(r.base)} />{#if forWish.has(r.base)}<span class="tag ok" title={wishTitle(r.base)}>wishlist</span>{/if}{#if fissures && !isOpen(r.base)}<span class="closed" title="No {r.base.split(' ')[0]} fissure is open right now: an Omnia one takes it, or wait for the next">no fissure now</span>{/if}</span>{/snippet}
{#snippet ownedCell(r: CrackRow)}<Owned owned={r.owned} base={r.base} />{/snippet}
{#snippet vaultCell(r: { vaulted: boolean })}<Avail v={r.vaulted ? "vaulted" : "farmable"} />{/snippet}
{#snippet chanceCell(r: CrackRow)}<span class="pct" title={refinementLine(r)}>{(r.chance * 100).toFixed(1)}%</span>{/snippet}
{#snippet valueCell(r: CrackRow)}<span title={refinementLine(r)}><P v={Math.round(r.value * 10) / 10} tenths /></span>{/snippet}
{#snippet hitsCell(r: CrackRow)}
  <span class="hits">
    {#each r.hits as h (h.reward + h.set)}
      <span class="hit" class:last={h.last} use:info={h.reward}>
        <Thumb file={model.imageOf(h.reward)} size={20} /><span class="hn">{h.reward}</span>{#if h.last}<i class="lastmark" title="The last part you need for the {h.set} Set">last</i>{/if}
      </span>
    {/each}
  </span>
{/snippet}

{#snippet finishesCell(r: CrackRow)}{#if finishes(r)}<b class="fin" title="Sets it can complete">{finishes(r)}</b>{:else}<span class="dim">–</span>{/if}{/snippet}

{#snippet radRelicCell(r: RadiantRow)}{@render relicCell(r)}{/snippet}
{#snippet radOwnedCell(r: RadiantRow)}<Owned owned={r.owned} base={r.base} />{/snippet}
{#snippet rareCell(r: RadiantRow)}
  {#if r.rare}<span class="rr"><span class="rr-name" use:info={r.rare.name}><Thumb file={model.imageOf(r.rare.name)} size={22} />{r.rare.name}</span><P v={r.rare.price} dim /></span>{/if}
{/snippet}
{#snippet intactCell(r: RadiantRow)}{#if unit(r.intact)}<span class="pct dim">{unit(r.intact)}</span>{:else}<P v={Math.round(r.intact * 10) / 10} d={metric === "ducats"} dim tenths />{/if}{/snippet}
{#snippet radiantCell(r: RadiantRow)}{#if unit(r.radiant)}<span class="pct">{unit(r.radiant)}</span>{:else}<P v={Math.round(r.radiant * 10) / 10} d={metric === "ducats"} tenths />{/if}{/snippet}
{#snippet gainCell(r: RadiantRow)}{#if unit(r.gain)}<span class="pct gain">+{unit(r.gain)}</span>{:else}<span class="gain">+<P v={Math.round(r.gain * 10) / 10} d={metric === "ducats"} tenths /></span>{/if}{/snippet}

{#snippet gapList(list: SetGap[], key: string)}
  <div class="gaps">
    {#each open[key] ? list : list.slice(0, GAPS_SHOWN) as g (g.unique)}
      <div class="gap" in:arrive>
        <button class="set" use:info={`${g.set} Set`} onclick={() => details.open(g.unique)}>
          <Thumb file={model.imageOf(g.set)} size={22} /><span class="name-mark">{g.set}</span>
        </button>
        <span class="dim small needs">needs {#each g.missing as x, i (x.name)}{i ? ", " : ""}<span class="miss" use:info={x.name}>{x.name.replace(g.set + " ", "")}{x.count > 1 ? ` ×${x.count}` : ""}</span>{/each}</span>
        {#if key === "last"}<span class="dim small src" title="Relics you hold that drop the missing part (see the table above)">{g.relicsOwned} relic{g.relicsOwned === 1 ? "" : "s"}</span>{/if}
        {#if buyCost(g) != null}<span class="buyp" title="Buying what's missing, at the daily median"><span class="register">buy</span> <P v={Math.round(buyCost(g)!)} /></span>{/if}
        {#if g.setPrice != null}<span class="setp" title="What the complete set sells for"><span class="register">set</span> <P v={g.setPrice} dim /></span>{/if}
      </div>
    {/each}
  </div>
  {#if list.length > GAPS_SHOWN}
    <button class="link more" onclick={() => (open[key] = !open[key])}>{open[key] ? "Show fewer" : `Show all ${list.length}`}</button>
  {/if}
{/snippet}

<div class="page"><div class="page-inner">
  <PageHead
    title="Planner"
    brief={mode === "sets" ? "Relics to crack for sets you're close to." : "Where your Void Traces gain the most."}
    blurb={mode === "sets"
      ? "Your relics most likely to finish a set you're close to."
      : "Where 100 Void Traces gain the most."}
  >
    {#snippet band()}
      {#if mode === "sets"}
        <Stat label="Sets close to done" note={`${settings.maxMissing === 1 ? "One part" : `Up to ${settings.maxMissing} parts`} away${filtered ? ", matching the filters" : ""}`}><Count value={gaps.length} /></Stat>
        <Stat label="One part away" tone="gold" note="A single drop completes them"><Count value={lastParts.length} /></Stat>
        <Stat label="Relics that help" note={filtered ? "Matching the filters" : "From your inventory"}><Count value={crack.length} /></Stat>
        <Stat extra label="Sets with no relic" tone="dim" note="None of your relics drop what's missing: buy the part or farm relics"><Count value={uncovered.length} /></Stat>
      {:else}
        <Stat label="Best gain" tone="gold" note={radiant[0] ? `${radiant[0].base}${filtered ? ", of the relics matching the filters" : ""}` : "—"}>
          {#if radiant[0]}{#if unit(radiant[0].gain)}+{unit(radiant[0].gain)}{:else}+<PTick v={Math.round(radiant[0].gain * 10) / 10} d={metric === "ducats"} />{/if}{:else}—{/if}
        </Stat>
        <Stat label="Your traces, spent best" note={spend.copies ? `Refining your top ${spend.copies} cop${spend.copies === 1 ? "y" : "ies"}${filtered ? " matching the filters" : ""}${metric === "need" ? `: ${spend.copies === 1 ? "its gain" : "their gains"} in chance of a part you need, added up` : ""}` : "Not enough traces to refine one"}>
          {#if !spend.copies}—{:else if unit(spend.total)}+{unit(spend.total)}{:else}+<PTick v={Math.round(spend.total * 10) / 10} d={metric === "ducats"} />{/if}
        </Stat>
      {/if}
    {/snippet}
    {#snippet hero()}<RelicPlate {model} {masteryRank} />{/snippet}
  </PageHead>

  <!-- The page's modes as tabs (they change the whole page), the filters under them. -->
  <div class="modes"><Tabs bind:value={mode} label="Planner view" options={[{ v: "sets", label: "Complete sets", title: "Which relics to crack to finish sets you're close to" }, { v: "radiant", label: "Make radiant", title: "Where your Void Traces gain the most, refining relics to radiant" }]} /></div>
  <div class="bar">
    <input type="search" title="Shows only what matches what you type" placeholder={mode === "sets" ? "Relic or part…" : "Relic or reward…"} bind:value={query} />
    {#if mode === "sets"}
      <select bind:value={settings.maxMissing} aria-label="How close" title="How close a set must be to complete to count">
        {#each [1, 2, 3, 4] as n (n)}<option value={n}>{n === 1 ? "One part away" : `Up to ${n} parts away`}</option>{/each}
      </select>
    {:else}
      <Seg bind:value={settings.squad} options={[{ v: 1, label: "Solo", title: "One crack, your own reward" }, { v: 4, label: "Radshare", title: "Four players crack the same relic and you pick the best of the four rewards" }]} />
      <Seg bind:value={metric} options={[{ v: "plat", label: "Platinum", title: "Rank by what a crack is worth in platinum" }, { v: "ducats", label: "Ducats", title: "Rank by the ducats a crack gives, for Baro" }, { v: "need", label: "Parts I need", title: "Chance of a part for something you haven't built or mastered" }]} />
    {/if}
    <Fold active={(vaultedOnly ? 1 : 0) + (wishOnly ? 1 : 0) + (openOnly ? 1 : 0)} reset={() => { vaultedOnly = false; wishOnly = false; openOnly = false; }}>
      <Chip bind:on={vaultedOnly} label="Vaulted only" title="Only relics that drop nowhere now" />
      {#if forWish.size}<Chip bind:on={wishOnly} label="For my wishlist" title="Only relics you hold that drop a part for something on your wishlist" />{/if}
      {#if fissures && ERAS_SHOWN.some((e) => !openNow[e]?.length)}<Chip bind:on={openOnly} label="Fissure open now" title="Only relics with a fissure of their era open right now (some eras have none at the moment)" />{/if}
    </Fold>
  </div>

  {#if drawnSets}
    <div class="view swap" class:off={mode !== "sets"} use:fresh={mode === "sets"} in:arrive={{ y: 0 }}>
      <div class="sets-table"><Table rows={setsRows} columns={crackCols} key={(r) => r.base} tint={(r) => eraTint(r.base)} bind:sort={sortSets} clear={setsAnyFilter ? clear : null} empty="None of your relics drop a missing part." /></div>
      {#if setsLast.length}
        <h2 class="register">One part from a complete set, and your relics drop it</h2>
        {@render gapList(setsLast, "last")}
      {/if}
      {#if setsUncovered.length}
        <h2 class="register">Close, but none of your relics drop the missing part</h2>
        {@render gapList(setsUncovered, "uncovered")}
      {/if}
    </div>
  {/if}
  {#if drawnRadiant}
    <div class="view swap" class:off={mode !== "radiant"} use:fresh={mode === "radiant"} in:arrive={{ y: 0 }}>
      <Table rows={radRows} columns={radCols} key={(r) => r.base} tint={(r) => eraTint(r.base)} bind:sort={sortRad} clear={radAnyFilter ? clear : null} empty="No relics left to refine." />
    </div>
  {/if}
</div></div>

<style>
  /* The tab not chosen: kept laid out but not drawn, so showing it again is quick (where
     content-visibility isn't known, simply not there). */
  .view.off { display: none; }
  @supports (content-visibility: hidden) {
    .view.off { display: block; content-visibility: hidden; }
  }
  h2 { margin: var(--course, 2rem) 0 .6rem; }
  .closed { margin-left: .5rem; font-family: var(--face-register); font-size: .56rem; letter-spacing: .12em; text-transform: uppercase; color: var(--platinum-deep); white-space: nowrap; }
  .buyp { white-space: nowrap; margin-left: auto; }
  .buyp + .setp { margin-left: 0; }
  .setp { white-space: nowrap; margin-left: auto; }
  .src { white-space: nowrap; }
  .setp .register { font-size: .6rem; color: var(--platinum-deep); }
  .more { margin-top: .5rem; font-size: .78rem; }
  .pct { font-family: var(--face-mark); font-weight: 700; font-size: .98rem; font-variant-numeric: tabular-nums; }
  .gain { color: var(--gold); display: inline-flex; align-items: center; gap: .1rem; font-family: var(--face-mark); font-weight: 700; }
  /* Each part on one line, cut short with an ellipsis when the column is narrow (the whole name on
     hover). The list takes no width of its own, so the column keeps the share the table gives it. */
  .hits { display: flex; flex-wrap: wrap; gap: .3rem .8rem; contain: inline-size; min-width: 14rem; }
  /* Page area under 1100 px: the headings wrap onto two lines, so the parts keep room for their names. */
  :global(html[data-room~="lt1100"]) .sets-table :global(th) { white-space: normal; line-height: 1.35; vertical-align: bottom; }
  .hit { display: inline-flex; align-items: center; gap: .35rem; max-width: 100%; min-width: 0; font-size: .8rem; color: var(--platinum-dim); }
  .hit :global(.thumb) { flex: none; }
  .hn { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .lastmark { flex: none; }
  .hit.last { color: var(--gold); }
  .lastmark { font-style: normal; font-family: var(--face-register); font-size: .56rem; font-weight: 600; letter-spacing: .1em; text-transform: uppercase; color: var(--gold); margin-left: .2rem; }
  .fin { font-family: var(--face-mark); font-size: 1rem; color: var(--gold); }
  .gaps { display: grid; grid-template-columns: repeat(auto-fill, minmax(24rem, 1fr)); gap: 0 2.4rem; border-top: 1px solid var(--rule); margin-bottom: var(--step); }
  .gap { display: flex; align-items: center; gap: .6rem; padding: .5rem 0; border-bottom: 1px solid var(--rule); }
  .gap .needs { flex: 1; min-width: 0; }
  .miss { color: var(--platinum); cursor: default; }
  .miss:hover { color: var(--gold); }
  .set { display: inline-flex; align-items: center; gap: .6rem; padding: 0; border: 0; background: none; font: inherit; letter-spacing: normal; text-transform: none; text-align: left; color: var(--platinum); }
  .set:hover:not(:disabled) .name-mark { color: var(--gold); }
  .set .name-mark { white-space: nowrap; }
  .rr { display: inline-flex; align-items: center; gap: .6rem; white-space: nowrap; }
  .rr-name { display: inline-flex; align-items: center; gap: .45rem; }
  .rel :global(.name-mark) { white-space: nowrap; }
</style>
