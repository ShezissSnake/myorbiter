<script lang="ts">
  // The relic plate atop Relics and the Planner: your relics as the game's relic icons, era by era,
  // with how many you hold and how many are radiant, and the Void Trace meter beside them (what you
  // hold against the most you can, 100 + 50 a Mastery Rank). `onera`: a click on an era filters the
  // page to it (Relics); without it the eras are a summary only.
  import type { Model } from "../core/model";
  import { relicsByEra } from "../core/relicHold";
  import { nearTraceCap, traceCap, voidTraces, TO_RADIANT } from "../core/traces";
  import GameIcon, { relicIcon } from "./GameIcon.svelte";
  import { eraTint } from "./table";
  import Vessel from "./Vessel.svelte";

  let { model, masteryRank = null, era = null, onera = null }: { model: Model; masteryRank?: number | null; era?: string | null; onera?: ((era: string) => void) | null } = $props();

  const eras = $derived(relicsByEra(model));
  const traces = $derived(voidTraces(model));
  const cap = $derived(traceCap(masteryRank));
  const near = $derived(nearTraceCap(traces, cap));
  /** The meter's scale: the cap, or (rank unknown) the next thousand above what you hold. */
  const scale = $derived(cap ?? Math.max(1000, Math.ceil((traces + 1) / 1000) * 1000));
  const refines = $derived(Math.floor(traces / TO_RADIANT));
  const n = (x: number) => x.toLocaleString("en");
  const eraTitle = (e: { era: string; total: number; radiant: number }) =>
    `${e.era}: you hold ${n(e.total)} relic${e.total === 1 ? "" : "s"}${e.radiant ? `, ${n(e.radiant)} of them radiant` : ""}${onera ? (era === e.era ? ". Click to show every era" : `. Click to show only ${e.era} relics`) : ""}`;
</script>

<section class="plate" aria-label="Your relics and Void Traces">
  <div class="eras">
    {#each eras as e (e.era)}
      {@const icon = relicIcon(e.era, e.radiant && e.radiant === e.total ? "radiant" : "intact")}
      {#if onera}
        <button type="button" class="era" class:on={era === e.era} class:none={!e.total} aria-pressed={era === e.era} style:--tint={eraTint(e.era)} title={eraTitle(e)} onclick={() => onera?.(e.era)}>
          {@render cell(e, icon)}
        </button>
      {:else}
        <div class="era" class:none={!e.total} style:--tint={eraTint(e.era)} title={eraTitle(e)}>{@render cell(e, icon)}</div>
      {/if}
    {/each}
  </div>
  <div class="meter" data-card="traces" class:near title={cap != null ? `Void Traces: you hold ${n(traces)} of the ${n(cap)} your rank allows (100 + 50 a Mastery Rank). Refining to Radiant costs 100 (Exceptional 25, Flawless 50). Past the cap, a crack's traces are lost: refine some first` : `Void Traces: you hold ${n(traces)}. Refining to Radiant costs 100. Your cap (100 + 50 a Mastery Rank) shows once TennoScope reads your rank`}>
    <div class="m-head">
      <GameIcon name="void-traces" size={22} />
      <span class="register">Void Traces</span>
      <span class="m-fig"><b>{n(traces)}</b>{#if cap != null}<span class="of">/{n(cap)}</span>{/if}</span>
    </div>
    <!-- Traces against the cap, a mark etched every 100 (one relic to Radiant). -->
    <div class="gauge"><Vessel key="traces" value={Math.min(traces, scale)} max={scale} units={scale / TO_RADIANT <= 40 ? scale / TO_RADIANT : 0} tone={near ? "var(--alert)" : undefined} label="Void Traces against the cap" /></div>
    <span class="m-note">{refines ? `Enough for ${n(refines)} Radiant` : "Not enough to refine one"}{#if cap != null}{" · "}{near ? (traces >= cap ? "at the cap: refine some" : "near the cap: refine some") : `${n(cap - traces)} until the cap`}{:else}{" · cap once your rank is read"}{/if}</span>
  </div>
</section>

{#snippet cell(e: { era: string; total: number; radiant: number }, icon: ReturnType<typeof relicIcon>)}
  {#if icon}<GameIcon name={icon} size={36} />{:else}<GameIcon name="void-tear" size={30} />{/if}
  <span class="txt">
    <span class="en">{e.era}</span>
    <b>{n(e.total)}</b>
    <span class="rad" class:zero={!e.radiant}>{n(e.radiant)} radiant</span>
  </span>
{/snippet}

<style>
  /* One band: the eras' relics on a cut plate, the meter on the right, the section's violet at the edge. */
  .plate {
    display: flex; flex-wrap: wrap; align-items: stretch; gap: 0;
    background: var(--plate-sheen), var(--plate); clip-path: var(--cut); box-shadow: inset 3px 0 0 var(--sec), var(--plate-light);
  }
  .eras { display: flex; flex: 1 1 34rem; min-width: 0; }
  .era {
    all: unset; box-sizing: border-box; display: flex; align-items: center; gap: .5rem; padding: .6rem .7rem .6rem .8rem; flex: 1 1 0; min-width: 0;
    border-right: 1px solid var(--rule); position: relative;
  }
  button.era { cursor: pointer; }
  button.era:hover { background: var(--raised); }
  button.era:focus-visible { outline: 2px solid var(--sec); outline-offset: -2px; }
  /* The era the page shows: lit from below in the section's violet. */
  .era.on { background: var(--raised); box-shadow: inset 0 -2px 0 var(--sec); }
  .era.none :global(.gi) { opacity: .35; filter: saturate(.3); }
  .txt { display: grid; line-height: 1.1; min-width: 0; }
  .en { font-family: var(--face-register); font-size: .72rem; letter-spacing: .14em; text-transform: uppercase; color: color-mix(in srgb, var(--tint, var(--platinum)) 75%, var(--platinum)); }
  .txt b { font-family: var(--face-mark); font-size: 1.45rem; font-weight: 700; color: var(--platinum); font-variant-numeric: tabular-nums; }
  .era.none b { color: var(--platinum-deep); }
  .rad { font-size: .7rem; color: var(--platinum-dim); white-space: nowrap; }
  .rad.zero { color: var(--platinum-deep); }
  .meter { flex: 1 1 15rem; display: grid; align-content: center; gap: .4rem; padding: .6rem 1.1rem .65rem; min-width: 0; }
  .m-head { display: flex; align-items: center; gap: .45rem; }
  .m-head .register { font-size: 11px; color: var(--platinum-dim); }
  .m-fig { margin-left: auto; display: inline-flex; align-items: baseline; gap: .1rem; }
  .m-fig b { font-family: var(--face-mark); font-size: 1.35rem; font-weight: 700; color: var(--platinum); font-variant-numeric: tabular-nums; }
  .m-fig .of { color: var(--platinum-deep); font-size: .8rem; font-variant-numeric: tabular-nums; }
  /* Traces against the cap, a notch every 100 (one relic to Radiant); the last 100 before the cap marked. */
  .near .m-fig b { color: var(--alert); }
  .m-note { font-size: .72rem; color: var(--platinum-deep); }
  /* Page area under 950 px: the eras take the whole row, each with room for its "143 radiant", and
     the meter goes under them. */
  :global(html[data-room~="lt950"]) .eras { flex-basis: 100%; }
  :global(html[data-room~="lt950"]) .meter { border-top: 1px solid var(--rule); grid-template-columns: auto minmax(0, 1fr); align-items: center; column-gap: 1.2rem; }
  :global(html[data-room~="lt950"]) .gauge { grid-column: 2; grid-row: 1; }
  :global(html[data-room~="lt950"]) .m-note { grid-column: 1 / -1; }
  .near .m-note { color: var(--alert); }
</style>
