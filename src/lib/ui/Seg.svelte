<script lang="ts" generics="V extends string | number">
  // Segmented single choice: a row of struck plates, the chosen one inverted. An option with an
  // icon shows just the icon; its label is then the tooltip and what a screen reader reads. One with
  // a game icon (`game`) shows it before its label.
  import Icon from "./Icon.svelte";
  import GameIcon, { type GameIconName } from "./GameIcon.svelte";
  import { afterPaint } from "./soon";
  let {
    value = $bindable(),
    options,
    label,
    onchange,
    pending = null,
    manual = false,
  }: {
    value: V;
    options: { v: V; label: string; title?: string; icon?: string; game?: GameIconName }[];
    label?: string;
    onchange?: (v: V) => void;
    /** A choice sent and not confirmed yet: underlined with a running line until it is. */
    pending?: V | null;
    /** Arrow keys only move the focus, Enter or Space picks: for a choice that acts at once (your market status), so stepping past one doesn't send it. */
    manual?: boolean;
  } = $props();
  /** Manual: the option the arrow keys are on, until the focus leaves the group. */
  let at = $state<number | null>(null);
  // A pick shows on the plates at once and reaches the page a frame later (soon.ts), so a page that
  // redraws a long list on it doesn't hold up the press.
  let chosen = $state<{ v: V } | null>(null);
  const current = $derived(chosen ? chosen.v : value);
  let cancel: (() => void) | null = null;

  function pick(v: V) {
    at = null;
    cancel?.();
    chosen = { v };
    cancel = afterPaint(() => {
      cancel = null;
      chosen = null;
      value = v;
      onchange?.(v);
    });
  }
  $effect(() => () => cancel?.());
  // A radio group: one tab stop, arrow keys move the choice (or, manual, just the focus).
  function key(e: KeyboardEvent) {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const group = e.currentTarget as HTMLElement;
    if (manual) {
      const buttons = [...group.querySelectorAll<HTMLElement>('[role="radio"]')];
      const from = buttons.indexOf(e.target as HTMLElement);
      at = ((from >= 0 ? from : options.findIndex((o) => o.v === current)) + step + options.length) % options.length;
      queueMicrotask(() => buttons[at!]?.focus());
      return;
    }
    const i = options.findIndex((o) => o.v === current);
    const next = options[(i + step + options.length) % options.length];
    pick(next.v);
    queueMicrotask(() => group.querySelector<HTMLElement>('[aria-checked="true"]')?.focus());
  }
  /** The one tab stop: the option the arrows are on (manual), else the chosen one, else the first. */
  const stop = (i: number) => (at != null ? i === at : options[i].v === current || (i === 0 && !options.some((x) => x.v === current)));
</script>

<div class="seg-wrap">
  {#if label}<span class="register">{label}</span>{/if}
  <div class="seg" role="radiogroup" aria-label={label} tabindex="-1" onkeydown={key} onfocusout={(e) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) at = null; }}>
    {#each options as o, i (o.v)}
      <button role="radio" aria-checked={current === o.v} tabindex={stop(i) ? 0 : -1} class:on={current === o.v} class:pending={pending === o.v} aria-busy={pending === o.v || undefined} class:icon={!!o.icon} title={o.title ?? (o.icon ? o.label : undefined)} aria-label={o.icon ? o.label : undefined} onclick={() => pick(o.v)}>{#if o.icon}<Icon name={o.icon} />{:else if o.game}<span class="gl"><GameIcon name={o.game} size={14} />{o.label}</span>{:else}{o.label}{/if}</button>
    {/each}
  </div>
</div>

<style>
  .seg-wrap { display: inline-flex; align-items: center; gap: .6rem; }
  .gl { display: inline-flex; align-items: center; gap: .35rem; }
  .seg { display: inline-flex; }
  /* The choice inverts at once: fading text and plate together passes both through the same grey,
     so the label would be unreadable mid-change. Only the hover edge fades. */
  .seg button { margin-left: -1px; transition: border-color var(--quick); }
  .seg button.icon { display: inline-grid; place-items: center; width: 34px; padding: 0; }
  .seg button.on { background: var(--platinum); border-color: var(--platinum); color: var(--slab); position: relative; }
  .seg button:focus-visible { position: relative; z-index: 1; }
  /* Chosen, not confirmed yet: a gold line runs along its foot until it is. */
  .seg button.pending { position: relative; overflow: hidden; }
  /* The band runs by transform (app.css, sweep-band); the button clips it. */
  .seg button.pending::after { content: ""; position: absolute; left: 0; bottom: 0; width: 50%; height: 2px; background: linear-gradient(90deg, transparent, var(--gold), transparent); animation: sweep-band 1.1s ease-in-out infinite; }
  @media (prefers-reduced-motion: reduce) { .seg button.pending::after { animation: none; width: 100%; transform: none; background: var(--gold-dim); } }
</style>
