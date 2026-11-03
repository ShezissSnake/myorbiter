<script lang="ts">
  // Every open void fissure of one kind (normal, Steel Path or Void Storm), by era: what mission,
  // where, against whom, and how long it has left. Each era says your best relic to crack in it.
  // With "Only my alerts", just the ones your fissure alerts match, of every kind.
  import type { Fissure } from "../core/types";
  import { fissureCounts, fissuresByEra, type FissureMode } from "../core/board";
  import { until } from "../core/traders";
  import Seg from "./Seg.svelte";
  import Chip from "./Chip.svelte";
  import GameIcon, { eraIcon } from "./GameIcon.svelte";
  import Foe from "./Foe.svelte";
  import Mission from "./Mission.svelte";
  import Icon from "./Icon.svelte";
  import P from "./P.svelte";
  import { info } from "../hover.svelte";
  import { eraTint } from "./table";
  import { recruitLine } from "../core/recruit";

  type Best = { name: string; refinement: string; held: string; plat: number } | null;
  let {
    fissures,
    mode = $bindable(),
    only = $bindable(false),
    alerts = 0,
    now,
    best = () => null,
    watched = new Set<string>(),
    onera = null,
    saving = () => null,
  }: {
    fissures: Fissure[] | null;
    mode: FissureMode;
    only?: boolean;
    alerts?: number;
    now: number;
    best?: (era: string) => Best;
    watched?: Set<string>;
    onera?: ((era: string) => void) | null;
    /** Sets you're saving parts for that a relic of yours of this era drops a missing part of, and those relics. */
    saving?: (era: string) => { sets: string[]; relics: string[] } | null;
  } = $props();

  const counts = $derived(fissureCounts(fissures, now));
  // Only with alerts to go by: none set, it's the whole board again.
  const mine = $derived(only && alerts > 0);
  const eras = $derived(mine ? fissuresByEra((fissures ?? []).filter((f) => watched.has(f.id)), "all", now) : fissuresByEra(fissures, mode, now));
  /** Every fissure read has closed: the read is stale (the worldstate couldn't be read since), not a quiet hour. */
  const outOfDate = $derived(!!fissures?.length && counts.normal + counts.steel + counts.storm === 0);
  /** "A, B and 3 more" */
  const some = (xs: string[], n = 4) => (xs.length <= n ? xs.join(", ") : `${xs.slice(0, n).join(", ")} and ${xs.length - n} more`);
  const left = (f: Fissure) => until(f.expiry, now).replace("under a minute", "<1 min");
  // Recruit: the line for a squad sharing your best relic of the era, on the clipboard.
  let copied = $state<string | null>(null);
  /** The clipboard refused: the line to copy by hand. */
  let failedLine = $state<string | null>(null);
  async function copyLine(era: string, line: string) {
    try {
      await navigator.clipboard.writeText(line);
      failedLine = null;
      copied = era;
      setTimeout(() => (copied === era ? (copied = null) : null), 2000);
    } catch {
      copied = null;
      failedLine = line;
    }
  }
</script>

{#if failedLine}<p class="small warn">Couldn't copy: <input class="by-hand" readonly value={failedLine} aria-label="Recruiting line to copy by hand" onfocus={(e) => e.currentTarget.select()} /></p>{/if}
<div class="kinds">
  {#if !mine}<Seg
    bind:value={mode}
    label="Show"
    options={[
      { v: "normal", label: `Normal · ${counts.normal}`, game: "void-tear", title: "Normal fissures on the star chart" },
      { v: "steel", label: `Steel Path · ${counts.steel}`, game: "steel-essence", title: "Steel Path fissures: Steel Path enemies (higher levels, Acolytes), and 1 Steel Essence at the end of the mission for each relic you open yourself" },
      { v: "storm", label: `Void Storms · ${counts.storm}`, game: "railjack", title: "Void Storms: Railjack missions on the Proxima nodes. Open a relic as usual (Reactant drops are shared by the crew), and an extra end-of-mission reward table (Corrupted Holokeys and more) pays even without a relic" },
    ]}
  />{/if}
  {#if alerts > 0}<Chip bind:on={only} label="Only my alerts" title="Show only the fissures your fissure alerts (below) match, normal, Steel Path and Void Storms together. Off: every fissure of the kind you pick" />{/if}
</div>

{#if outOfDate}
  <p class="dim small">The fissure list is out of date: every fissure orbiter last read has closed, and the worldstate can't be read right now (api.warframestat.us and the game's own list). orbiter tries again every few minutes.</p>
{:else if !eras.length}
  <p class="dim small">{mine ? "None of the fissures open right now match your alerts." : `No ${mode === "steel" ? "Steel Path fissures" : mode === "storm" ? "Void Storms" : "fissures"} open right now.`}</p>
{:else}
  <div class="eras">
    {#each eras as e (e.era)}
      {@const b = best(e.era)}
      {@const sv = saving(e.era)}
      <section class="era era-wash" style:--tint={eraTint(e.era)}>
        <header>
          {#if onera && e.era !== "Omnia"}<button class="name go" title="Your {e.era} relics, on Relics" onclick={() => onera(e.era)}><GameIcon name={eraIcon(e.era)} size={22} /><b class="mark">{e.era}</b></button>
          {:else}<span class="name"><GameIcon name={eraIcon(e.era)} size={22} /><b class="mark">{e.era}</b></span>{/if}
          <span class="dim small">{e.list.length}</span>
          {#if sv}<span class="saving" title="Your {some(sv.relics)} drop{sv.relics.length === 1 ? 's' : ''} a part still missing from {some(sv.sets.map((x) => `the ${x} Set`), 6)}, which your loose parts are waiting for (Sets → Saving up)">parts for {sv.sets.length === 1 ? sv.sets[0] : `${sv.sets.length} sets`}</span>{/if}
          <span class="grow"></span>
          {#if b}<span class="best" title="Your relic whose crack is worth most here ({b.held}), and the average platinum of the reward you'd take"><span class="dim small crackw">Crack</span> <b use:info={b.name}>{b.name}</b> <span class="dim small refw">{b.refinement}</span> <span class="pv"><P v={b.plat} /></span></span><button class="copy" class:done={copied === e.era} title="Copy a recruiting line for a squad sharing it ({recruitLine(b.name, b.refinement)}): paste it in Recruiting chat" aria-label="Copy a recruiting line for {b.name}" onclick={() => copyLine(e.era, recruitLine(b.name, b.refinement))}>{copied === e.era ? "Copied" : "Recruit"}</button>{/if}
        </header>
        <ul>
          {#each e.list as f (f.id)}
            <li class:hit={watched.has(f.id) && !mine}>
              <span class="mt">{#if watched.has(f.id) && !mine}<Icon name="bell" size={11} />{/if}{#if mine && (f.isHard || f.isStorm)}<span class="kind" title={f.isStorm ? "Void Storm" : "Steel Path"}><GameIcon name={f.isStorm ? "railjack" : "steel-essence"} size={10} />{f.isStorm ? "Storm" : "SP"}</span>{/if}<span class="mg"><Mission type={f.missionType} storm={f.isStorm} size={13} /></span><span class="mtn" title={f.missionType}>{f.missionType}</span></span>
              <span class="node dim small" title="{f.node} · {f.enemy}">{f.node}</span>
              <span class="foe dim small"><Foe enemy={f.enemy} size={13} /></span>
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
  /* Each era a plate washed in its relic's colour (app.css, .era-wash), its name in that colour. */
  .era { padding: .55rem .75rem .45rem .85rem; border: 1px solid color-mix(in srgb, var(--tint) 18%, var(--rule)); clip-path: var(--cut); }
  .era header { display: flex; align-items: center; gap: .5rem; padding-bottom: .3rem; border-bottom: 1px solid color-mix(in srgb, var(--tint) 22%, var(--rule)); min-width: 0; }
  .era header .mark { color: color-mix(in srgb, var(--tint) 70%, var(--platinum)); }
  .name { display: inline-flex; align-items: center; gap: .45rem; }
  .name b { font-size: 1.02rem; }
  button.go { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: .45rem; }
  button.go:hover b { color: var(--gold); }
  button.go:focus-visible { outline: 1px solid var(--gold); outline-offset: 2px; }
  .grow { flex: 1; }
  .best { display: inline-flex; align-items: baseline; gap: .3rem; min-width: 0; white-space: nowrap; }
  /* The relic's name gives way first; its value and the Recruit button never do. */
  .best b { font-weight: 600; color: var(--platinum); font-size: .86rem; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .pv { flex: none; }
  .copy { flex: none; }
  .by-hand { width: 16rem; }
  :global(html[data-room~="lt1100"]) .best .crackw, :global(html[data-room~="lt1100"]) .best .refw { display: none; }
  ul { list-style: none; margin: .3rem 0 0; padding: 0; display: grid; gap: .15rem; }
  li { display: grid; grid-template-columns: minmax(6.5rem, 1fr) minmax(0, 1.3fr) 4.2rem 4.6rem; gap: .5rem; align-items: baseline; padding: .12rem 0; }
  .mt { display: inline-flex; align-items: center; gap: .3rem; color: var(--platinum); font-size: .88rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .node, .foe { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .left { text-align: right; font-variant-numeric: tabular-nums; color: var(--platinum-dim); white-space: nowrap; }
  .left.soon { color: var(--platinum-deep); }
  li.hit .mt { color: var(--gold); }
  .mtn { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .mg { display: inline-flex; color: color-mix(in srgb, var(--tint) 65%, var(--platinum-dim)); }
  .saving { font-size: .7rem; color: var(--verdigris); border: 1px solid color-mix(in srgb, var(--verdigris) 45%, transparent); padding: 0 .3rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; cursor: default; }
  .kind { display: inline-flex; align-items: center; gap: .18rem; font-family: var(--face-register); font-size: .58rem; letter-spacing: .1em; color: var(--gold); border: 1px solid var(--gold-dim); padding: 0 .25rem; }
  .kinds { align-items: center; }
  :global(html[data-room~="lt640"]) li { grid-template-columns: minmax(6rem, 1fr) minmax(0, 1.3fr) 4.4rem; }
  :global(html[data-room~="lt640"]) .foe { display: none; }
  /* Recruit: a small struck button after the best relic. */
  .copy { font-family: var(--face-register); font-size: .56rem; letter-spacing: .1em; text-transform: uppercase; color: var(--gold); border: 1px solid var(--gold-dim); background: none; padding: .1rem .35rem; margin-left: .35rem; cursor: pointer; }
  .copy:hover { border-color: var(--gold); }
  .copy.done { color: var(--verdigris); border-color: var(--verdigris); }
</style>
