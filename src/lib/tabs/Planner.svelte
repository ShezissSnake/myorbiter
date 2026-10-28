<script lang="ts">
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

  // The mode is kept in settings, so it survives a restart and the Guide can open either one.
  let { model, settings = $bindable(), mode = $bindable("sets") }: { model: Model; settings: AdviceSettings; mode?: "sets" | "radiant" } = $props();
  let metric = $state<RadiantMetric>("plat");
  let vaultedOnly = $state(false);
  let query = $state("");
  let sortSets = $state({ key: "value", desc: true });
  let sortRad = $state({ key: "gain", desc: true });

  const traces = $derived((model.inventoryByBase.get("/Lotus/Types/Items/MiscItems/VoidTearDrop") ?? []).reduce((n, r) => n + r.quantity, 0));

  // ------------------------------------------------ crack for sets
  const plan = $derived(crackRows(model, settings.maxMissing));
  const crack = $derived(plan.relics.filter((r) => (!vaultedOnly || r.vaulted) && matches(query, r.base, ...r.hits.map((h) => h.reward))));
  /** The gap lists show a few at first: the table above them is the plan. */
  const GAPS_SHOWN = 10;
  let open = $state<Record<string, boolean>>({});
  // The stats and the lists below follow the table's filters.
  const filtered = $derived(vaultedOnly || !!query.trim());
  const gaps = $derived(filterGaps(model, plan, vaultedOnly, (...fields) => matches(query, ...fields)));
  const lastParts = $derived(gaps.filter((g) => g.missingCount === 1));
  const uncovered = $derived(gaps.filter((g) => g.relicsOwned === 0));
  /** The table's empty line: what the filters found nothing for. */
  const emptyLine = (none: string) => (query.trim() ? `Nothing matches “${query.trim()}”.` : none);
  /** The two lists below the table don't repeat each other: one part away with a relic for it, then no relic for it. */
  const lastCovered = $derived(lastParts.filter((g) => g.relicsOwned > 0));

  const crackCols: Column<CrackRow>[] = [
    { key: "base", label: "Relic", value: (r) => r.base, defaultDesc: false, cell: relicCell },
    { key: "owned", label: "You have", value: (r) => Object.values(r.owned).reduce((a, b) => a + b, 0), cell: ownedCell, align: "right" },
    { key: "vault", label: "Vault", value: (r) => (r.vaulted ? 1 : 0), cell: vaultCell, align: "center", title: "Vaulted: no new copies drop" },
    { key: "chance", label: "Part chance", value: (r) => r.chance, cell: chanceCell, align: "right", title: "Chance one crack, at your best refinement, gives a part a near-complete set is missing" },
    { key: "value", label: "Set value", value: (r) => r.value, cell: valueCell, align: "right", title: "Platinum per crack, counting each part as its share of the set's price" },
    { key: "hits", label: "Parts it can give", value: (r) => r.hits.length, cell: hitsCell, sortable: false },
  ];

  // ------------------------------------------------ radiant
  const radiant = $derived(
    radiantRows(model, { squad: settings.squad, metric, platPerDucat: settings.platPerDucat }).filter(
      (r) => r.refinable > 0 && (!vaultedOnly || r.vaulted) && matches(query, r.base, r.rare?.name),
    ),
  );
  const canRefine = $derived(Math.floor(traces / 100));
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

  const radCols: Column<RadiantRow>[] = $derived([
    { key: "base", label: "Relic", value: (r) => r.base, defaultDesc: false, cell: radRelicCell },
    { key: "owned", label: "You have", value: (r) => r.refinable, cell: radOwnedCell, align: "right", title: "Copies you could still refine" },
    { key: "vault", label: "Vault", value: (r) => (r.vaulted ? 1 : 0), cell: vaultCell, align: "center", title: "Vaulted: no new copies drop" },
    { key: "rare", label: "Rare reward", value: (r) => r.rare?.price ?? null, cell: rareCell, title: "The rare drop: 2% from an intact relic, 10% from a radiant one" },
    { key: "intact", label: `${metric === "need" ? "Need, intact" : "Avg intact"}${settings.squad > 1 ? " ×4" : ""}`, value: (r) => r.intact, cell: intactCell, align: "right" },
    { key: "radiant", label: `${metric === "need" ? "Need, radiant" : "Avg radiant"}${settings.squad > 1 ? " ×4" : ""}`, value: (r) => r.radiant, cell: radiantCell, align: "right" },
    { key: "gain", label: "Gain", value: (r) => r.gain, cell: gainCell, align: "right", title: settings.squad > 1 ? "What 100 Void Traces add: the best reward of a 4-person radshare, radiant vs intact" : "What 100 Void Traces add: one crack, radiant vs intact" },
  ]);
</script>

{#snippet relicCell(r: CrackRow)}<span class="rel"><Named file={model.imageOf(r.base)} name={r.base} tint={eraTint(r.base)} /></span>{/snippet}
{#snippet ownedCell(r: CrackRow)}<Owned owned={r.owned} />{/snippet}
{#snippet vaultCell(r: { vaulted: boolean })}<Avail v={r.vaulted ? "vaulted" : "farmable"} />{/snippet}
{#snippet chanceCell(r: CrackRow)}<span class="pct">{(r.chance * 100).toFixed(1)}%</span>{/snippet}
{#snippet valueCell(r: CrackRow)}<P v={Math.round(r.value * 10) / 10} />{/snippet}
{#snippet hitsCell(r: CrackRow)}
  <span class="hits">
    {#each r.hits as h (h.reward + h.set)}
      <span class="hit" class:last={h.last} use:info={h.reward}>
        <Thumb file={model.imageOf(h.reward)} size={20} />{h.reward}{#if h.last}<b title="The last part you need for a complete set">last</b>{/if}
      </span>
    {/each}
  </span>
{/snippet}

{#snippet radRelicCell(r: RadiantRow)}<span class="rel"><Named file={model.imageOf(r.base)} name={r.base} tint={eraTint(r.base)} /></span>{/snippet}
{#snippet radOwnedCell(r: RadiantRow)}<Owned owned={r.owned} />{/snippet}
{#snippet rareCell(r: RadiantRow)}
  {#if r.rare}<span class="rr"><span class="rr-name" use:info={r.rare.name}><Thumb file={model.imageOf(r.rare.name)} size={22} />{r.rare.name}</span><P v={r.rare.price} dim /></span>{/if}
{/snippet}
{#snippet intactCell(r: RadiantRow)}{#if unit(r.intact)}<span class="pct dim">{unit(r.intact)}</span>{:else}<P v={Math.round(r.intact * 10) / 10} d={metric === "ducats"} dim />{/if}{/snippet}
{#snippet radiantCell(r: RadiantRow)}{#if unit(r.radiant)}<span class="pct">{unit(r.radiant)}</span>{:else}<P v={Math.round(r.radiant * 10) / 10} d={metric === "ducats"} />{/if}{/snippet}
{#snippet gainCell(r: RadiantRow)}{#if unit(r.gain)}<span class="pct gain">+{unit(r.gain)}</span>{:else}<span class="gain">+<P v={Math.round(r.gain * 10) / 10} d={metric === "ducats"} /></span>{/if}{/snippet}

{#snippet gapList(list: SetGap[], key: string)}
  <div class="gaps">
    {#each open[key] ? list : list.slice(0, GAPS_SHOWN) as g (g.unique)}
      <div class="gap">
        <button class="set" use:info={`${g.set} Set`} onclick={() => details.open(g.unique)}>
          <Thumb file={model.imageOf(g.set)} size={22} /><span class="name-mark">{g.set}</span>
        </button>
        <span class="dim small needs">needs {#each g.missing as x, i (x.name)}{i ? ", " : ""}<span class="miss" use:info={x.name}>{x.name.replace(g.set + " ", "")}{x.count > 1 ? ` ×${x.count}` : ""}</span>{/each}</span>
        {#if key === "last"}<span class="dim small src" title="Relics you hold that drop the missing part (see the table above)">{g.relicsOwned} relic{g.relicsOwned === 1 ? "" : "s"}</span>{/if}
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
    blurb={mode === "sets"
      ? "Your relics most likely to finish a set you're close to."
      : "Where 100 Void Traces gain the most."}
  >
    {#snippet band()}
      {#if mode === "sets"}
        <Stat label="Sets close to done" note={`${settings.maxMissing === 1 ? "One part" : `Up to ${settings.maxMissing} parts`} away${filtered ? ", matching the filters" : ""}`}>{gaps.length}</Stat>
        <Stat label="One part away" tone="gold" note="A single drop completes them">{lastParts.length}</Stat>
        <Stat label="Relics that help" note={filtered ? "Matching the filters" : "From your inventory"}>{crack.length}</Stat>
        <Stat label="No relic for it" tone="dim" note="Buy the part or farm relics">{uncovered.length}</Stat>
      {:else}
        <Stat label="Void Traces" note={`Enough to refine ${canRefine} relic${canRefine === 1 ? "" : "s"} to radiant`}>{traces.toLocaleString("en")}</Stat>
        <Stat label="Best gain" tone="gold" note={radiant[0] ? `${radiant[0].base}${filtered ? ", of the relics matching the filters" : ""}` : "—"}>
          {#if radiant[0]}{#if unit(radiant[0].gain)}+{unit(radiant[0].gain)}{:else}+<P v={Math.round(radiant[0].gain * 10) / 10} d={metric === "ducats"} big />{/if}{:else}—{/if}
        </Stat>
        <Stat label="Your traces, spent best" note={spend.copies ? `Refining your top ${spend.copies} cop${spend.copies === 1 ? "y" : "ies"}${filtered ? " matching the filters" : ""}${metric === "need" ? `: ${spend.copies === 1 ? "its gain" : "their gains"} in chance of a part you need, added up` : ""}` : "Not enough traces to refine one"}>
          {#if !spend.copies}—{:else if unit(spend.total)}+{unit(spend.total)}{:else}+<P v={Math.round(spend.total * 10) / 10} d={metric === "ducats"} big />{/if}
        </Stat>
      {/if}
    {/snippet}
  </PageHead>

  <div class="bar">
    <Seg bind:value={mode} options={[{ v: "sets", label: "Complete sets", title: "Which relics to crack to finish sets you're close to" }, { v: "radiant", label: "Make radiant", title: "Where your Void Traces gain the most, refining relics to radiant" }]} />
    {#if mode === "sets"}
      <select bind:value={settings.maxMissing} aria-label="How close">
        {#each [1, 2, 3, 4] as n (n)}<option value={n}>{n === 1 ? "One part away" : `Up to ${n} parts away`}</option>{/each}
      </select>
    {:else}
      <Seg bind:value={settings.squad} options={[{ v: 1, label: "Solo", title: "One crack, your own reward" }, { v: 4, label: "Radshare", title: "Four players crack the same relic and you pick the best of the four rewards" }]} />
      <Seg bind:value={metric} options={[{ v: "plat", label: "Platinum", title: "Rank by what a crack is worth in platinum" }, { v: "ducats", label: "Ducats", title: "Rank by the ducats a crack gives, for Baro" }, { v: "need", label: "Parts I need", title: "Chance of a part for something you haven't built or mastered" }]} />
    {/if}
    <Chip bind:on={vaultedOnly} label="Vaulted only" title="Only relics that drop nowhere now" />
    <input type="search" placeholder={mode === "sets" ? "Relic or part…" : "Relic or reward…"} bind:value={query} />
  </div>

  {#if mode === "sets"}
    <Table rows={crack} columns={crackCols} key={(r) => r.base} bind:sort={sortSets} empty={emptyLine(vaultedOnly ? "None of your vaulted relics drop a missing part." : "None of your relics drop a missing part.")} />
    {#if lastCovered.length}
      <h2 class="register">One part from a complete set, and your relics drop it</h2>
      {@render gapList(lastCovered, "last")}
    {/if}
    {#if uncovered.length}
      <h2 class="register">Close, but none of your relics drop the missing part</h2>
      {@render gapList(uncovered, "uncovered")}
    {/if}
  {:else}
    <Table rows={radiant} columns={radCols} key={(r) => r.base} bind:sort={sortRad} empty={emptyLine(vaultedOnly ? "No vaulted relics left to refine." : "No relics left to refine.")} />
  {/if}
</div></div>

<style>
  h2 { margin: var(--course, 2rem) 0 .6rem; }
  .setp { white-space: nowrap; margin-left: auto; }
  .src { white-space: nowrap; }
  .setp .register { font-size: .6rem; color: var(--platinum-deep); }
  .more { margin-top: .5rem; font-size: .78rem; }
  .pct { font-family: var(--face-mark); font-weight: 700; font-size: .98rem; font-variant-numeric: tabular-nums; }
  .gain { color: var(--gold); display: inline-flex; align-items: center; gap: .1rem; font-family: var(--face-mark); font-weight: 700; }
  .hits { display: flex; flex-wrap: wrap; gap: .3rem .8rem; }
  .hit { display: inline-flex; align-items: center; gap: .35rem; font-size: .8rem; color: var(--platinum-dim); }
  .hit.last { color: var(--platinum); }
  .hit b { font-family: var(--face-register); font-size: .6rem; letter-spacing: .1em; text-transform: uppercase; background: var(--gold); color: var(--slab); padding: .05rem .3rem; }
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
