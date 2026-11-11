<script lang="ts">
  // A setting that is on or off: what it does on the left, the switch on the right.
  import type { Snippet } from "svelte";

  // `title`: a tooltip for the whole line; `disabled`: shown, not changeable (its section is off).
  // `name`: the switch's own name ("settings.auto-trades"), as `data-switch`, so the help's pictures
  // and the sweep find it by name rather than by where it sits; the sweep lists a switch without one.
  let { on = $bindable(), label, name, title, disabled = false, children }: { on: boolean; label: string; name: string; title?: string; disabled?: boolean; children?: Snippet } = $props();
</script>

<label class="row" class:disabled {title} data-switch={name}>
  <span class="text">
    <span class="label">{label}</span>
    {#if children}<span class="note">{@render children()}</span>{/if}
  </span>
  <input type="checkbox" role="switch" bind:checked={on} {disabled} />
  <span class="track" aria-hidden="true"><span class="knob"></span></span>
</label>

<style>
  /* The switch sits level with the setting's name, however long the note under it runs. */
  .row { display: grid; grid-template-columns: 1fr auto; align-items: start; gap: 1rem; cursor: pointer; }
  .track { margin-top: .1rem; }
  .text { display: grid; gap: .2rem; }
  .label { font-size: .88rem; color: var(--platinum); }
  .note { font-size: .78rem; color: var(--platinum-deep); line-height: 1.5; }
  input { position: absolute; opacity: 0; width: 1px; height: 1px; }
  .track { width: 2.3rem; height: 1.15rem; border: 1px solid var(--rule-control); background: var(--well); position: relative; transition: background .12s, border-color .12s; }
  .knob { position: absolute; top: 2px; left: 2px; width: calc(1.15rem - 6px); height: calc(1.15rem - 6px); background: var(--platinum-deep); transition: transform .14s, background .12s; }
  /* On: white, as everything that's chosen is (gold is kept for platinum). */
  input:checked + .track { background: color-mix(in srgb, var(--platinum) 14%, var(--well)); border-color: var(--platinum-dim); }
  input:checked + .track .knob { transform: translateX(1.15rem); background: var(--platinum); }
  input:focus-visible + .track { outline: 1px solid var(--select); outline-offset: 2px; }
  /* Greyed out by colour, not opacity, so the text stays above 4.5:1; only the switch fades. */
  .disabled { cursor: default; }
  .disabled .label { color: var(--platinum-deep); }
  .disabled .track { opacity: .55; }
</style>
