<script lang="ts" generics="V extends string | number">
  // Segmented single choice: a row of struck plates, the chosen one inverted. An option with an
  // icon shows just the icon; its label is then the tooltip and what a screen reader reads. One with
  // a game icon (`game`) shows it before its label.
  import Icon from "./Icon.svelte";
  import GameIcon, { type GameIconName } from "./GameIcon.svelte";
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

  function pick(v: V) {
    at = null;
    value = v;
    onchange?.(v);
  }
  // A radio group: one tab stop, arrow keys move the choice (or, manual, just the focus).
  function key(e: KeyboardEvent) {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const group = e.currentTarget as HTMLElement;
    if (manual) {
      const buttons = [...group.querySelectorAll<HTMLElement>('[role="radio"]')];
      const from = buttons.indexOf(e.target as HTMLElement);
      at = ((from >= 0 ? from : options.findIndex((o) => o.v === value)) + step + options.length) % options.length;
      queueMicrotask(() => buttons[at!]?.focus());
      return;
    }
    const i = options.findIndex((o) => o.v === value);
    const next = options[(i + step + options.length) % options.length];
    pick(next.v);
    queueMicrotask(() => group.querySelector<HTMLElement>('[aria-checked="true"]')?.focus());
  }
  /** The one tab stop: the option the arrows are on (manual), else the chosen one, else the first. */
  const stop = (i: number) => (at != null ? i === at : options[i].v === value || (i === 0 && !options.some((x) => x.v === value)));
</script>

<div class="seg-wrap">
  {#if label}<span class="register">{label}</span>{/if}
  <div class="seg" role="radiogroup" aria-label={label} tabindex="-1" onkeydown={key} onfocusout={(e) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) at = null; }}>
    {#each options as o, i (o.v)}
      <button role="radio" aria-checked={value === o.v} tabindex={stop(i) ? 0 : -1} class:on={value === o.v} class:pending={pending === o.v} aria-busy={pending === o.v || undefined} class:icon={!!o.icon} title={o.title ?? (o.icon ? o.label : undefined)} aria-label={o.icon ? o.label : undefined} onclick={() => pick(o.v)}>{#if o.icon}<Icon name={o.icon} />{:else if o.game}<span class="gl"><GameIcon name={o.game} size={14} />{o.label}</span>{:else}{o.label}{/if}</button>
    {/each}
  </div>
</div>

<style>
  .seg-wrap { display: inline-flex; align-items: center; gap: .6rem; }
  .gl { display: inline-flex; align-items: center; gap: .35rem; }
  .seg { display: inline-flex; }
  .seg button { margin-left: -1px; }
  .seg button.icon { display: inline-grid; place-items: center; width: 34px; padding: 0; }
  .seg button.on { background: var(--platinum); border-color: var(--platinum); color: var(--slab); position: relative; }
  .seg button:focus-visible { position: relative; z-index: 1; }
  /* Chosen, not confirmed yet: a gold line runs along its foot until it is. */
  .seg button.pending { position: relative; overflow: hidden; }
  .seg button.pending::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 2px; background: linear-gradient(90deg, transparent, var(--gold), transparent); background-size: 50% 100%; background-repeat: no-repeat; animation: seg-wait 1.1s ease-in-out infinite; }
  @keyframes seg-wait { from { background-position: -60% 0; } to { background-position: 160% 0; } }
  @media (prefers-reduced-motion: reduce) { .seg button.pending::after { animation: none; background: var(--gold-dim); } }
</style>
