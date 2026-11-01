<script lang="ts">
  // Every open void fissure of one kind (normal, Steel Path or Void Storm), by era: what mission,
  // where, against whom, and how long it has left. Each era says your best relic to crack in it.
  import type { Fissure } from "../core/types";
  import { fissureCounts, fissuresByEra, type FissureMode } from "../core/board";
  import { until } from "../core/traders";
  import Seg from "./Seg.svelte";
  import GameIcon, { type GameIconName } from "./GameIcon.svelte";
  import Icon from "./Icon.svelte";
  import P from "./P.svelte";
  import { info } from "../hover.svelte";

  type Best = { name: string; refinement: string; held: string; plat: number } | null;
  let {
    fissures,
    mode = $bindable(),
    now,
    best = () => null,
    watched = new Set<string>(),
    onera = null,
  }: { fissures: Fissure[] | null; mode: FissureMode; now: number; best?: (era: string) => Best; watched?: Set<string>; onera?: ((era: string) => void) | null } = $props();

  const counts = $derived(fissureCounts(fissures, now));
  const eras = $derived(fissuresByEra(fissures, mode, now));
  /** Every fissure read has closed: the read is stale (the worldstate couldn't be read since), not a quiet hour. */
  const outOfDate = $derived(!!fissures?.length && counts.normal + counts.steel + counts.storm === 0);
  const icon = (era: string): GameIconName => (era === "Omnia" ? "void-tear" : (`relic-${era.toLowerCase()}-intact` as GameIconName));
  const left = (f: Fissure) => until(f.expiry, now).replace("under a minute", "<1 min");
</script>

<div class="kinds">
  <Seg
    bind:value={mode}
    label="Show"
    options={[
      { v: "normal", label: `Normal · ${counts.normal}`, title: "Normal fissures on the star chart" },
      { v: "steel", label: `Steel Path · ${counts.steel}`, title: "Steel Path fissures: harder enemies, and Steel Essence and Kuva drops on top" },
      { v: "storm", label: `Void Storms · ${counts.storm}`, title: "Railjack Void Storms on the Proxima nodes" },
    ]}
  />
</div>

{#if outOfDate}
  <p class="dim small">The fissure list is out of date: every fissure orbiter last read has closed, and the worldstate can't be read right now (api.warframestat.us and the game's own list). orbiter tries again every few minutes.</p>
{:else if !eras.length}
  <p class="dim small">No {mode === "steel" ? "Steel Path fissures" : mode === "storm" ? "Void Storms" : "fissures"} open right now.</p>
{:else}
  <div class="eras">
    {#each eras as e (e.era)}
      {@const b = best(e.era)}
      <section class="era">
        <header>
          {#if onera && e.era !== "Omnia"}<button class="name go" title="Your {e.era} relics, on Relics" onclick={() => onera(e.era)}><GameIcon name={icon(e.era)} size={22} /><b class="mark">{e.era}</b></button>
          {:else}<span class="name"><GameIcon name={icon(e.era)} size={22} /><b class="mark">{e.era}</b></span>{/if}
          <span class="dim small">{e.list.length}</span>
          <span class="grow"></span>
          {#if b}<span class="best" title="Your relic whose crack is worth most here ({b.held}), and the average platinum of the reward you'd take"><span class="dim small">Crack</span> <b use:info={b.name}>{b.name}</b> <span class="dim small">{b.refinement}</span> <P v={b.plat} /></span>{/if}
        </header>
        <ul>
          {#each e.list as f (f.id)}
            <li class:hit={watched.has(f.id)}>
              <span class="mt">{#if watched.has(f.id)}<Icon name="bell" size={11} />{/if}{f.missionType}</span>
              <span class="node dim small" title="{f.node} · {f.enemy}">{f.node}</span>
              <span class="foe dim small">{f.enemy}</span>
              <span class="left small" class:soon={Date.parse(f.expiry) - now < 10 * 60_000}>{left(f)}</span>
            </li>
          {/each}
        </ul>
      </section>
    {/each}
  </div>
{/if}

<style>
  .kinds { display: flex; flex-wrap: wrap; gap: .5rem; }
  .eras { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(25rem, 100%), 1fr)); gap: .9rem 1.4rem; }
  .era header { display: flex; align-items: center; gap: .5rem; padding-bottom: .3rem; border-bottom: 1px solid var(--rule); min-width: 0; }
  .name { display: inline-flex; align-items: center; gap: .45rem; }
  .name b { font-size: 1.02rem; }
  button.go { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: .45rem; }
  button.go:hover b { color: var(--gold); }
  button.go:focus-visible { outline: 1px solid var(--gold); outline-offset: 2px; }
  .grow { flex: 1; }
  .best { display: inline-flex; align-items: baseline; gap: .3rem; min-width: 0; white-space: nowrap; overflow: hidden; }
  .best b { font-weight: 600; color: var(--platinum); font-size: .86rem; }
  ul { list-style: none; margin: .3rem 0 0; padding: 0; display: grid; gap: .15rem; }
  li { display: grid; grid-template-columns: minmax(6.5rem, 1fr) minmax(0, 1.3fr) 4.2rem 4.6rem; gap: .5rem; align-items: baseline; padding: .12rem 0; }
  .mt { display: inline-flex; align-items: center; gap: .3rem; color: var(--platinum); font-size: .88rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .node, .foe { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .left { text-align: right; font-variant-numeric: tabular-nums; color: var(--platinum-dim); white-space: nowrap; }
  .left.soon { color: var(--platinum-deep); }
  li.hit .mt { color: var(--gold); }
  :global(html[data-room~="lt640"]) li { grid-template-columns: minmax(6rem, 1fr) minmax(0, 1.3fr) 4.4rem; }
  :global(html[data-room~="lt640"]) .foe { display: none; }
</style>
