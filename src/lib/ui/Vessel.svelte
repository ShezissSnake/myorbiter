<script lang="ts">
  // The meter for a page's headline figures (figure tiles, Mastery rank, a set's completion; a few
  // a page): a slanted glass channel with liquid in it, darker at the bottom and lighter at the
  // top, a bright edge where it ends, a streak of light on the glass, a mark etched at each unit.
  // No sloshing, no bubbles rising: when its value changed since it was last shown, the liquid
  // slides to its new level as one layer, over SETTLE (lib/meters.svelte.ts).
  //
  //   <Vessel key="orders.trades" value={left} max={limit} label="Trades left today">{#snippet figure(n)}<b>{Math.round(n)}</b>{/snippet}</Vessel>
  import type { Snippet } from "svelte";
  import { OUT_CSS, SETTLE } from "../motion";
  import { meterMotion } from "../meters.svelte";
  import type { MeterPart } from "./Segments.svelte";

  let { key = null, value = 0, max, parts, units, tone, label, big = false, figure, title }: {
    key?: string | null; value?: number; max: number; parts?: MeterPart[];
    /** Marks etched along the glass: one a unit up to 40 units, else none (default). */
    units?: number; tone?: string; label: string; big?: boolean;
    figure?: Snippet<[number]>; title?: string;
  } = $props();

  const list = $derived<MeterPart[]>(parts ?? [{ value, tone }]);
  const split = $derived(list.length > 1);
  const whole = $derived(Math.max(0, max) || 1);
  const marks = $derived(units ?? (whole === Math.round(whole) && whole <= 40 ? whole : 0));
  const totals = $derived(list.reduce<number[]>((a, p) => [...a, (a.at(-1) ?? 0) + Math.max(0, p.value)], []));
  const level = (v: number) => `translateX(${(-(1 - Math.max(0, Math.min(1, v / whole))) * 100).toFixed(3)}%)`;

  let layers: HTMLElement[] = $state([]);
  let root: HTMLElement | undefined = $state();
  const motion = meterMotion(
    () => ({ key, values: totals }),
    () => root,
    (from, to) => {
      from.forEach((f, i) => {
        const el = layers[i];
        if (f === to[i] || !el || typeof el.animate !== "function") return;
        el.animate([{ transform: level(f) }, { transform: level(to[i]) }], { duration: SETTLE, easing: OUT_CSS });
      });
    },
  );
  const aria = $derived(split ? `${label}: ${list.map((p, i) => `${p.label ?? `part ${i + 1}`} ${Math.round(p.value)}`).join(", ")} of ${Math.round(whole)}` : label);
</script>

<span class="meter" class:big {title}>
  {#if figure}{@render figure(motion.figure)}{/if}
  <span class="ves" bind:this={root} role={split ? "img" : "meter"} aria-label={aria}
    aria-valuemin={split ? undefined : 0} aria-valuemax={split ? undefined : whole} aria-valuenow={split ? undefined : Math.max(0, Math.min(whole, list[0]?.value ?? 0))}>
    <!-- The whole underneath, each part over it in its own colour; only the furthest has the bright edge. -->
    {#each totals.map((_, i) => totals.length - 1 - i) as i (i)}
      <span class="liq" class:edge={i === totals.length - 1} aria-hidden="true" bind:this={layers[i]} style:color={list[i].tone ?? null} style:transform={level(motion.drawn[i] ?? totals[i])}></span>
    {/each}
    {#if marks > 1}<span class="tk" aria-hidden="true" style:background-size="{100 / marks}% 100%"></span>{/if}
    <span class="gl" aria-hidden="true"></span>
  </span>
</span>

<style>
  .meter { display: flex; align-items: center; gap: 14px; min-width: 0; color: var(--sec); }
  .ves {
    position: relative; display: block; flex: 1; min-width: 0; height: 14px; margin: 0 9px; overflow: hidden;
    transform: skewX(-45deg); background: var(--well); box-shadow: 0 0 0 1px var(--rule), inset 0 2px 5px rgb(0 0 0 / 90%);
  }
  .big .ves { height: 26px; margin: 0 16px; }
  /* The liquid: lighter at the top, darker at the bottom, a few specks held still in it. */
  .liq {
    position: absolute; inset: 0;
    background:
      radial-gradient(circle at 22% 62%, rgb(255 255 255 / 22%) 0 1px, transparent 1.6px),
      radial-gradient(circle at 57% 40%, rgb(255 255 255 / 16%) 0 1px, transparent 1.6px),
      radial-gradient(circle at 83% 70%, rgb(255 255 255 / 20%) 0 1px, transparent 1.6px),
      linear-gradient(180deg, color-mix(in srgb, currentColor 62%, #fff) 0, currentColor 34%, color-mix(in srgb, currentColor 52%, #000) 100%);
  }
  /* Where the liquid ends: a bright edge. */
  .liq.edge { box-shadow: inset -2px 0 0 color-mix(in srgb, currentColor 45%, #fff); }
  /* A mark etched at each unit. */
  .tk { position: absolute; inset: 0; background-image: linear-gradient(90deg, transparent calc(100% - 1px), rgb(0 0 0 / 55%) 0); }
  /* The streak of light on the glass. */
  .gl { position: absolute; left: 0; right: 0; top: 1px; height: 36%; background: linear-gradient(180deg, rgb(255 255 255 / 24%), rgb(255 255 255 / 0%)); }
</style>
