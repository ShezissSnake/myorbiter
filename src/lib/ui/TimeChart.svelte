<script lang="ts">
  // A line chart over time, one axis. Several series get a legend and labels at their ends; one
  // series needs neither (the title names it). Hover shows the nearest reading.
  import type { Snippet } from "svelte";

  let {
    title,
    at,
    series,
    height = 170,
    fmt = (v: number) => (v >= 1_000_000 ? `${Math.round(v / 100_000) / 10}M` : v >= 10_000 ? `${Math.round(v / 1000)}k` : Math.round(v).toLocaleString("en")),
    icon,
    empty = "Fills in as orbiter sees your account change.",
    since = "since the first day shown",
    single = "One reading so far: the line starts with the next one.",
  }: {
    title: string;
    at: number[];
    series: { label: string; color: string; values: (number | null | undefined)[] }[];
    height?: number;
    fmt?: (v: number) => string;
    icon?: Snippet;
    empty?: string;
    /** What the change beside the latest value is measured from ("in 90 days"). */
    since?: string;
    /** What a chart with a single point says (empty: nothing, when the page says it once). */
    single?: string;
  } = $props();

  let W = $state(480);
  const H = $derived(height);
  const many = $derived(series.length > 1);
  const PAD = $derived({ l: 44, r: many ? 140 : 56, t: 10, b: 22 });
  const iw = $derived(Math.max(60, W - PAD.l - PAD.r));
  const ih = $derived(H - PAD.t - PAD.b);

  // Only readings where at least one series has a value.
  const idx = $derived(at.map((_, i) => i).filter((i) => series.some((s) => s.values[i] != null)));
  const t0 = $derived(idx.length ? at[idx[0]] : 0);
  const t1 = $derived(idx.length ? at[idx[idx.length - 1]] : 1);
  const vals = $derived(idx.flatMap((i) => series.map((s) => s.values[i]).filter((v): v is number => v != null)));
  const lo = $derived.by(() => {
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    // Start at zero unless the line would be a flat smear at the top.
    return min > 0 && (max - min) / max < 0.35 ? niceDown(min - (max - min) * 0.3) : 0;
  });
  const hi = $derived.by(() => {
    const max = Math.max(1, ...vals);
    if (max <= lo) return lo + 1;
    const step = 10 ** Math.floor(Math.log10(max - lo));
    return lo + Math.ceil((max - lo) / step) * step;
  });
  function niceDown(v: number) {
    if (v <= 0) return 0;
    const step = 10 ** Math.floor(Math.log10(v));
    return Math.floor(v / step) * step;
  }
  const x = (t: number) => PAD.l + (t1 === t0 ? iw : ((t - t0) / (t1 - t0)) * iw);
  const y = (v: number) => PAD.t + ih - ((v - lo) / (hi - lo)) * ih;
  const path = (values: (number | null | undefined)[]) =>
    idx
      .filter((i) => values[i] != null)
      .map((i, k) => `${k ? "L" : "M"}${x(at[i]).toFixed(1)},${y(values[i] as number).toFixed(1)}`)
      .join("");
  const ticks = $derived([lo, (lo + hi) / 2, hi]);
  const day = (t: number) => new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" });

  const ends = $derived.by(() => {
    const out: { label: string; v: number; y: number }[] = [];
    for (const s of series) {
      const last = [...idx].reverse().find((i) => s.values[i] != null);
      if (last != null) out.push({ label: s.label, v: s.values[last] as number, y: y(s.values[last] as number) });
    }
    out.sort((a, b) => a.y - b.y);
    for (let i = 1; i < out.length; i++) if (out[i].y - out[i - 1].y < 13) out[i].y = out[i - 1].y + 13;
    return out;
  });
  const latest = $derived.by(() => {
    const s = series[0];
    const last = s ? [...idx].reverse().find((i) => s.values[i] != null) : undefined;
    const first = s ? idx.find((i) => s.values[i] != null) : undefined;
    return s && last != null ? { v: s.values[last] as number, change: first != null && first !== last ? (s.values[last] as number) - (s.values[first] as number) : null } : null;
  });

  let hover = $state<number | null>(null);
  function move(e: PointerEvent) {
    const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const px = e.clientX - r.left;
    let best = idx[0];
    for (const i of idx) if (Math.abs(x(at[i]) - px) < Math.abs(x(at[best]) - px)) best = i;
    hover = best ?? null;
  }
</script>

<figure class="tc">
  <figcaption>
    <span class="tt">{#if icon}{@render icon()}{/if}<span class="register">{title}</span></span>
    {#if many}
      <span class="legend">{#each series as s (s.label)}<span class="lg"><i style:background={s.color}></i>{s.label}{#if idx.length === 1 && s.values[idx[0]] != null}<b>{(s.values[idx[0]] as number).toLocaleString("en")}</b>{/if}</span>{/each}</span>
    {:else if latest}
      <span class="now"><b class="mark">{latest.v.toLocaleString("en")}</b>{#if latest.change}<span class="small" class:up={latest.change > 0} class:down={latest.change < 0} title="The change {since}">{latest.change > 0 ? "+" : ""}{fmt(latest.change)} <span class="dim">{since}</span></span>{/if}</span>
    {/if}
  </figcaption>
  <div class="wrap" bind:clientWidth={W}>
    {#if idx.length >= 2}
      <svg width={W} height={H} viewBox="0 0 {W} {H}" role="img" aria-label={title} onpointermove={move} onpointerleave={() => (hover = null)}>
        {#each ticks as t, i (i)}
          <line class="grid" x1={PAD.l} x2={PAD.l + iw} y1={y(t)} y2={y(t)} />
          <text class="ax" x={PAD.l - 8} y={y(t) + 4} text-anchor="end">{fmt(t)}</text>
        {/each}
        <text class="ax" x={PAD.l} y={H - 5}>{day(t0)}</text>
        <text class="ax" x={PAD.l + iw} y={H - 5} text-anchor="end">{day(t1)}</text>
        {#each series as s (s.label)}<path d={path(s.values)} fill="none" stroke={s.color} stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />{/each}
        {#if many}{#each ends as e (e.label)}<text class="end" x={PAD.l + iw + 8} y={e.y + 4}>{fmt(e.v)} <tspan class="el">{e.label}</tspan></text>{/each}{/if}
        {#if hover != null}
          <line class="cross" x1={x(at[hover])} x2={x(at[hover])} y1={PAD.t} y2={PAD.t + ih} />
          {#each series as s (s.label)}{#if s.values[hover] != null}<circle cx={x(at[hover])} cy={y(s.values[hover] as number)} r="4" fill={s.color} stroke="var(--plate)" stroke-width="2" />{/if}{/each}
        {/if}
      </svg>
      {#if hover != null}
        <div class="tip" style:left="{x(at[hover])}px" class:flip={x(at[hover]) > W * 0.6}>
          <div class="register">{new Date(at[hover]).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</div>
          {#each series as s (s.label)}{#if s.values[hover] != null}<div class="tr">{#if many}<i style:background={s.color}></i>{s.label}{/if}<b>{(s.values[hover] as number).toLocaleString("en")}</b></div>{/if}{/each}
        </div>
      {/if}
    {:else}
      <!-- One reading already (its number is in the header): the line needs a second. -->
      <!-- With nothing to say (the page says it once), the card stays short: its header has the number. -->
      {#if !(latest && !single)}<p class="dim small none" style:height="{Math.min(H - 20, 96)}px">{latest ? single : empty}</p>{/if}
    {/if}
  </div>
</figure>

<style>
  .tc { margin: 0; border: 1px solid var(--rule); background: rgb(17 19 23 / 70%); padding: .8rem 1rem .5rem; min-width: 0; }
  figcaption { display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap; margin-bottom: .3rem; }
  .tt { display: inline-flex; align-items: center; gap: .45rem; }
  .legend { display: flex; gap: 1rem; font-size: .78rem; color: var(--platinum-dim); flex-wrap: wrap; }
  .lg, .tr { display: inline-flex; align-items: center; gap: .4rem; }
  .lg i, .tr i { width: 10px; height: 3px; border-radius: 2px; display: inline-block; }
  .lg b { color: var(--platinum); font-family: var(--face-mark); font-size: 1rem; font-weight: 600; margin-left: .15rem; }
  .now { display: inline-flex; align-items: baseline; gap: .45rem; }
  .now b { font-size: 1.15rem; }
  .up { color: var(--verdigris); }
  .down { color: var(--oxblood); }
  .wrap { position: relative; }
  svg { display: block; touch-action: none; }
  .grid { stroke: var(--rule); stroke-width: 1; }
  .ax { fill: var(--platinum-deep); font-family: var(--face-register); font-size: 10px; }
  .end { fill: var(--platinum); font-size: 11px; font-variant-numeric: tabular-nums; }
  .el { fill: var(--platinum-deep); }
  .cross { stroke: var(--rule-bright); stroke-width: 1; }
  .tip { position: absolute; top: 0; transform: translateX(12px); background: var(--raised); border: 1px solid var(--rule-bright); padding: .4rem .55rem; font-size: .78rem; display: grid; gap: .2rem; pointer-events: none; white-space: nowrap; z-index: 2; }
  .tip.flip { transform: translateX(calc(-100% - 12px)); }
  .tr { justify-content: space-between; gap: .5rem; color: var(--platinum-dim); }
  .tr b { margin-left: auto; color: var(--platinum); font-weight: 600; font-variant-numeric: tabular-nums; }
  .none { display: flex; align-items: center; justify-content: center; margin: 0; text-align: center; }
</style>
