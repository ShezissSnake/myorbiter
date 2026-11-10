<script lang="ts" module>
  /** One part of a meter: its amount and colour (a CSS colour; the section's by default). */
  export interface MeterPart {
    value: number;
    tone?: string;
    /** Its name, for the meter's label when there are several. */
    label?: string;
  }
</script>

<script lang="ts">
  // The meter for rows in lists and tables: slanted cells in a sunk, slanted channel. Cells you
  // have are lit from above, missing ones are hollow outlines. A progress meter (one part) lights
  // its leading cell's top edge brighter, a highlight with no glow; a split (several parts, the
  // amounts of a whole) has no leading cell.
  //
  //   <Segments key="arcane:{name}" value={copies} max={needed} label="Copies toward max" />
  //   <Segments key="invasion:{id}" parts={[{ value: a, tone: "…" }, { value: b, tone: "…" }]} max={100} label="…" />
  //
  // `key` remembers what it last showed (lib/meters.svelte.ts): a changed value steps from the old
  // to the new, cell by cell, by moving one layer of lit cells (transform only); none, no motion.
  import type { Snippet } from "svelte";
  import { SETTLE } from "../motion";
  import { meterMotion } from "../meters.svelte";

  let { key = null, value = 0, max, parts, cells, tone, label, fill = false, big = false, figure, title }: {
    key?: string | null; value?: number; max: number; parts?: MeterPart[]; cells?: number; tone?: string; label: string;
    /** Stretch to the room it's given (cells widen), rather than its own width. */
    fill?: boolean; big?: boolean;
    /** The number beside it, ticking along with a move. */
    figure?: Snippet<[number]>; title?: string;
  } = $props();

  const list = $derived<MeterPart[]>(parts ?? [{ value, tone }]);
  const split = $derived(list.length > 1);
  const whole = $derived(Math.max(0, max) || 1);
  /** How many cells: one a unit up to 24, else 20 standing for the whole. */
  const n = $derived(Math.max(1, Math.round(cells ?? (whole === Math.round(whole) && whole <= 24 ? whole : 20))));
  /** The running totals, one a part (each layer lights up to its total). */
  const totals = $derived(list.reduce<number[]>((a, p) => [...a, (a.at(-1) ?? 0) + Math.max(0, p.value)], []));
  /** Lit cells for an amount: none only for nothing, all only for the whole. */
  const litOf = (v: number) => (v <= 0 ? 0 : v >= whole ? n : Math.min(n - 1, Math.max(1, Math.round((v / whole) * n))));
  const GAP = $derived(big ? 6 : 3);
  const shift = (lit: number) => `translateX(calc((100% + ${GAP}px) * ${lit - n} / ${n}))`;

  let layers: HTMLElement[] = $state([]);
  let root: HTMLElement | undefined = $state();
  const motion = meterMotion(
    () => ({ key, values: totals }),
    () => root,
    (from, to) => {
      from.forEach((f, i) => {
        const a = litOf(f), b = litOf(to[i]), el = layers[i];
        if (a === b || !el || typeof el.animate !== "function") return;
        // Cell by cell: each step holds until the next, all of them within SETTLE.
        const k = Math.abs(b - a), dir = Math.sign(b - a);
        const frames: Keyframe[] = [{ transform: shift(a), offset: 0, easing: "step-end" }];
        for (let j = 1; j <= k; j++) frames.push({ transform: shift(a + dir * j), offset: j / (k + 1), easing: "step-end" });
        frames.push({ transform: shift(b), offset: 1 });
        el.animate(frames, { duration: SETTLE });
      });
    },
  );
  const aria = $derived(split ? `${label}: ${list.map((p, i) => `${p.label ?? `part ${i + 1}`} ${Math.round(p.value)}`).join(", ")} of ${Math.round(whole)}` : label);
</script>

<span class="meter" class:fill class:big {title}>
  {#if figure}{@render figure(motion.figure)}{/if}
  <span class="seg" bind:this={root} role={split ? "img" : "meter"} aria-label={aria}
    aria-valuemin={split ? undefined : 0} aria-valuemax={split ? undefined : whole} aria-valuenow={split ? undefined : Math.max(0, Math.min(whole, list[0]?.value ?? 0))}>
    <span class="track">
      <span class="row" aria-hidden="true">{#each { length: n }, i (i)}<i></i>{/each}</span>
      <!-- The longest total underneath, each part over it in its own colour. -->
      {#each totals.map((_, i) => totals.length - 1 - i) as i (i)}
        <span class="row lit" class:tipped={!split} aria-hidden="true" bind:this={layers[i]} style:color={list[i].tone ?? null} style:transform={shift(litOf(motion.drawn[i] ?? totals[i]))}>{#each { length: n }, c (c)}<i></i>{/each}</span>
      {/each}
    </span>
  </span>
</span>

<style>
  .meter { display: inline-flex; align-items: center; gap: 14px; vertical-align: middle; min-width: 0; color: var(--sec); }
  .meter.fill { display: flex; width: 100%; }
  /* The channel: sunk, slanted 45°, cells inside it. */
  .seg {
    display: inline-flex; padding: 3px 4px; margin: 0 7px; transform: skewX(-45deg);
    background: var(--well); box-shadow: 0 0 0 1px var(--rule), inset 0 2px 4px rgb(0 0 0 / 80%);
  }
  .fill .seg { display: flex; flex: 1; min-width: 0; }
  .track { position: relative; display: flex; flex: 1; min-width: 0; overflow: hidden; }
  .row { display: flex; gap: 3px; }
  .fill .row { flex: 1; }
  .row i { width: 9px; height: 8px; flex: none; box-shadow: inset 0 0 0 1px rgb(255 255 255 / 13%); }
  .fill .row i { flex: 1; width: auto; min-width: 2px; }
  /* One layer of lit cells, slid along by whole cells: the lit part shows, the rest is past the edge. */
  .lit { position: absolute; inset: 0; }
  .lit i { box-shadow: none; background-color: currentColor; background-image: linear-gradient(180deg, rgb(255 255 255 / 45%), rgb(255 255 255 / 0%) 55%, rgb(0 0 0 / 25%)); }
  /* The leading cell's brighter top edge: a highlight, no glow. It travels with the layer. */
  .lit.tipped i:last-child { background-image: linear-gradient(180deg, rgb(255 255 255 / 62%), rgb(255 255 255 / 14%) 60%, rgb(0 0 0 / 12%)); }
  .big .seg { padding: 6px 8px; margin: 0 14px; }
  .big .row { gap: 6px; }
  .big .row i { width: 22px; height: 20px; }
</style>
