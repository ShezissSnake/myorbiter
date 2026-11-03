<script lang="ts" module>
  import { LastSeen, moves, type Move } from "../core/ticker";
  /** One figure on the tape. */
  export interface Tick {
    key: string;
    label: string;
    /** The figure, compared between looks; null while it isn't known. */
    value: number | null;
    /** How it reads ("13:05", "+1,240"); the value, with thousands marked, by default. */
    text?: string;
    /** In platinum: the metal after it. */
    plat?: boolean;
    /** After the figure, smaller: "/24". */
    of?: string;
    /** After that, smallest: "resets in 13 h". */
    sub?: string;
    /** On hover: what the figure is. */
    title: string;
    /** Gold: it wants doing (trades nearly gone, listings to reprice). */
    tone?: "gold" | "dim";
    /** Never ticked as moved (a clock, which always moves). */
    still?: boolean;
  }
  // What each tape showed when you last looked away, kept for the session only.
  const seen = new LastSeen();
</script>

<script lang="ts">
  // The Trade pages' signature: one dense line of live figures, as a market terminal shows them,
  // under the page's title. A gold tick marks a figure that moved since you last looked at the page
  // (or while you watch), and a figure that changes while you watch rolls to its new value (Count). One line where it fits; on a narrow page it wraps onto a second.
  import { untrack } from "svelte";
  import Metal from "./Metal.svelte";
  import Count from "./Count.svelte";

  let { id, items, label }: { id: string; items: Tick[]; label: string } = $props();

  const current = $derived(new Map(items.filter((x) => !x.still).map((x) => [x.key, x.value])));
  let el = $state<HTMLElement>();
  let looking = $state(false);
  /** What you saw when this look started: the figures are compared with it. */
  let base = $state<Map<string, number | null>>(new Map());
  // A look starts when the page is shown (and the window is), and ends when you leave it.
  $effect(() => {
    if (!el) return;
    const pane = el.closest(".pane");
    const check = () => {
      const on = (!pane || pane.classList.contains("shown")) && document.visibilityState !== "hidden";
      if (on === looking) return;
      if (on) base = new Map(seen.get(id) ?? current);
      else seen.set(id, current);
      looking = on;
    };
    untrack(check);
    const mo = pane ? new MutationObserver(check) : null;
    if (pane) mo!.observe(pane, { attributes: true, attributeFilter: ["class"] });
    document.addEventListener("visibilitychange", check);
    return () => {
      mo?.disconnect();
      document.removeEventListener("visibilitychange", check);
      untrack(() => {
        if (looking) seen.set(id, current);
      });
    };
  });
  // A figure that was still loading when the look started counts from when it arrives.
  $effect(() => {
    const now = current;
    untrack(() => {
      let fill: Map<string, number | null> | null = null;
      for (const [k, v] of now) if (v != null && base.get(k) == null) (fill ??= new Map(base)).set(k, v);
      if (fill) base = fill;
    });
  });
  const moved = $derived(looking ? moves(base, current) : new Map<string, Move>());
  const fmt = (v: number | null) => (v == null ? "–" : Math.round(v).toLocaleString("en"));
  const was = (k: string) => base.get(k);
</script>

<div class="tape" bind:this={el} role="group" aria-label={label}>
  <span class="cap" aria-hidden="true"><i></i></span>
  <div class="figs">
  {#each items as x (x.key)}
    {@const m = moved.get(x.key)}
    <span class="fig t-{x.tone ?? 'plain'}" class:moved={!!m} class:word={x.value == null && !!x.text} title={m ? `${x.title}. ${m === "up" ? "Up" : "Down"} from ${fmt(was(x.key) ?? null)} since you last looked` : x.title}>
      <span class="lb">{x.label}</span>
      <b class="v">{#if x.text != null}{x.text}{:else if x.value != null}<Count value={x.value} format={fmt} />{:else}–{/if}{#if x.plat && x.value != null}<Metal kind="plat" size={14} />{/if}{#if x.of}<span class="of">{x.of}</span>{/if}</b>
      {#if m}{@const d = (x.value ?? 0) - (was(x.key) ?? 0)}<i class="tick" aria-label="{m === 'up' ? 'up' : 'down'} {fmt(Math.abs(d))} since you last looked">{m === "up" ? "▲" : "▼"}{fmt(Math.abs(d))}</i>{/if}
      {#if x.sub}<span class="sub">{x.sub}</span>{/if}
    </span>
  {/each}
  </div>
</div>

<style>
  /* Deeper than the slab, a hairline above and below. The figures wrap onto a second line when the
     page is narrow, rather than run off its edge. */
  .tape {
    display: flex; align-items: stretch;
    background: #0b0e12; border-top: 1px solid var(--rule-bright); border-bottom: 1px solid var(--rule-bright);
    font-variant-numeric: tabular-nums;
  }
  /* Each figure carries its rule on the left and above, pulled out by a pixel: the ones at the start
     or top of a line lose theirs to the clip, so only the rules between figures show. */
  .figs { flex: 1; min-width: 0; display: flex; flex-wrap: wrap; overflow: hidden; }
  /* The market's mark at the head of the tape, in the section's gold. */
  .cap { flex: none; display: grid; place-items: center; width: 2.4rem; border-right: 1px solid var(--rule-bright); background: color-mix(in srgb, var(--sec) 9%, transparent); }
  .cap i { width: 1rem; height: 1rem; background: var(--sec); -webkit-mask: var(--sec-sigil) center / contain no-repeat; mask: var(--sec-sigil) center / contain no-repeat; }
  .fig { flex: none; display: inline-flex; align-items: baseline; gap: .6rem; padding: .55rem 1.25rem .5rem; white-space: nowrap; cursor: default; border-left: 1px solid var(--rule); border-top: 1px solid var(--rule); margin: -1px 0 0 -1px; }
  .lb { font-family: var(--face-register); font-size: .6rem; letter-spacing: .12em; text-transform: uppercase; color: var(--platinum-deep); }
  /* The figures struck in the app's number face, as every page's band strikes them. */
  .v { display: inline-flex; align-items: center; gap: .25rem; font-family: var(--face-mark); font-weight: 700; font-size: 1.5rem; line-height: 1.1; color: var(--platinum); letter-spacing: 0; }
  .t-gold .v { color: var(--gold); }
  /* Not a figure yet ("not yet", "loading…"): words, quieter. */
  /* Padded down so its label sits on the same line as the figures' labels. */
  .word .v { font-family: var(--face-text); font-weight: 400; font-size: .84rem; letter-spacing: 0; color: var(--platinum-dim); padding-top: .62rem; }
  .t-dim .v { color: var(--platinum-dim); }
  .of { font-size: .72em; font-weight: 500; color: var(--platinum-deep); }
  .sub { font-size: .72rem; color: var(--platinum-deep); }
  /* Moved since you last looked: by how much, in gold, as a market terminal marks a price. */
  .tick { font-style: normal; font-family: var(--face-register); font-weight: 600; font-size: .78rem; color: var(--gold); margin-left: -.2rem; animation: blink 1.1s steps(2, jump-none) 2; }
  @keyframes blink { 50% { opacity: 0; } }
  .fig.moved .lb { color: var(--gold-dim); }
  @media (prefers-reduced-motion: reduce) {
    .tick { animation: none; }
  }
</style>
