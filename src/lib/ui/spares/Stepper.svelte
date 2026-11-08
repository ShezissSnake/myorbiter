<script lang="ts">
  // A small whole number, stepped: − 2 +. The figure is a spinbutton (arrow keys, Home, End), so a
  // keep number changes without typing, and a press answers on the button itself (app.css). At its
  // bound, that side's button goes quiet; the title says why.
  //   <Stepper bind:value={rules.mods.keep} min={1} label="Copies of each mod to keep" />
  // `disabled`: its category is off (the number is kept, greyed out, until it's ticked again).
  let { value = $bindable(), min = 0, max = 99, label, title, unit = "", disabled = false }: { value: number; min?: number; max?: number; label: string; title?: string; unit?: string; disabled?: boolean } = $props();
  const set = (n: number) => (value = Math.min(max, Math.max(min, n)));
  function key(e: KeyboardEvent) {
    if (disabled) return;
    const to = e.key === "ArrowUp" || e.key === "ArrowRight" ? value + 1 : e.key === "ArrowDown" || e.key === "ArrowLeft" ? value - 1 : e.key === "Home" ? min : e.key === "End" ? max : e.key === "PageUp" ? value + 5 : e.key === "PageDown" ? value - 5 : null;
    if (to == null) return;
    e.preventDefault();
    set(to);
  }
</script>

<span class="stepper" class:off={disabled} title={title ?? label}>
  <button type="button" class="st" tabindex="-1" aria-hidden="true" disabled={disabled || value <= min} title={value <= min ? `${min} is the least` : `One fewer`} onclick={() => set(value - 1)}>−</button>
  <span class="n" role="spinbutton" tabindex={disabled ? -1 : 0} aria-label={label} aria-disabled={disabled || undefined} aria-valuenow={value} aria-valuemin={min} aria-valuemax={max} onkeydown={key}>{value}{#if unit}<small>{unit}</small>{/if}</span>
  <button type="button" class="st" tabindex="-1" aria-hidden="true" disabled={disabled || value >= max} title={value >= max ? `${max} is the most` : `One more`} onclick={() => set(value + 1)}>+</button>
</span>

<style>
  .stepper { display: inline-flex; align-items: stretch; height: 26px; border: 1px solid var(--rule-control); background: var(--well); }
  .st { width: 24px; padding: 0; border: 0; background: transparent; font-family: var(--face-figures); font-size: .8rem; letter-spacing: 0; color: var(--platinum-dim); }
  .st:hover:not(:disabled) { color: var(--platinum); background: var(--raised); }
  .st:disabled { color: var(--rule-bright); }
  .n { min-width: 1.9rem; display: inline-grid; place-items: center; grid-auto-flow: column; gap: .15rem; padding: 0 .2rem; border-left: 1px solid var(--rule); border-right: 1px solid var(--rule); font-family: var(--face-figures); font-size: .78rem; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--platinum); cursor: ns-resize; }
  .n small { font-size: .6rem; color: var(--platinum-deep); font-weight: 500; }
  .n:focus-visible { outline: 1px solid var(--select); outline-offset: 1px; }
  .off .n { color: var(--platinum-deep); cursor: default; }
</style>
