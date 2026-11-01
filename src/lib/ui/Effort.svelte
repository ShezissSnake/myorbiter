<script lang="ts">
  // How hard something is to get, at a glance: five pips filled to its difficulty, coloured from
  // easy (green) to hard (red), with where it comes from and that place's own icon.
  import { DIFFICULTY_LABEL, DIFFICULTY_TIP, METHOD_LABEL, type Acquisition } from "../core/acquire";
  import GameIcon, { type GameIconName } from "./GameIcon.svelte";

  let { acq, compact = false }: { acq: Acquisition; compact?: boolean } = $props();
  const d = $derived(acq.difficulty);
</script>

<span class="effort d{d}" title="{DIFFICULTY_LABEL[d]}: {DIFFICULTY_TIP[d]}">
  <span class="pips" aria-label="Difficulty {d} of 5">{#each [1, 2, 3, 4, 5] as i (i)}<i class:on={i <= d}></i>{/each}</span>
  {#if !compact}
    <span class="what">
      <!-- The icon's place is kept when there's none, so the words line up down a list. -->
      {#if acq.icon}<GameIcon name={acq.icon as GameIconName} size={16} />{:else}<span class="noicon"></span>{/if}
      <span class="word">{d === 0 ? DIFFICULTY_LABEL[0] : METHOD_LABEL[acq.method]}</span>
    </span>
  {/if}
</span>

<style>
  .effort { display: inline-flex; align-items: center; gap: .6rem; white-space: nowrap; }
  .pips { display: inline-flex; gap: 3px; }
  .noicon { width: 16px; height: 16px; flex: none; }
  .pips i { width: 7px; height: 7px; transform: rotate(45deg); border: 1px solid var(--rule-bright); }
  .what { display: inline-flex; align-items: center; gap: .35rem; font-family: var(--face-register); font-size: .6rem; font-weight: 600; letter-spacing: .1em; text-transform: uppercase; color: var(--platinum-dim); }
  .d0 .pips i { border-color: var(--platinum-deep); }
  .d0 .what { color: var(--platinum); }
  .d1 .on, .d2 .on { background: var(--verdigris); border-color: var(--verdigris); }
  .d3 .on { background: var(--platinum); border-color: var(--platinum); }
  .d4 .on { background: var(--gold); border-color: var(--gold); }
  .d5 .on { background: var(--oxblood); border-color: var(--oxblood); }
</style>
