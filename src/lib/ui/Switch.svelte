<script lang="ts">
  // A setting that is on or off: what it does on the left, the switch on the right.
  import type { Snippet } from "svelte";

  // `title`: a tooltip for the whole line; `disabled`: shown, not changeable (its section is off).
  let { on = $bindable(), label, title, disabled = false, children }: { on: boolean; label: string; title?: string; disabled?: boolean; children?: Snippet } = $props();
</script>

<label class="row" class:disabled {title}>
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
  input:checked + .track { background: color-mix(in srgb, var(--gold) 18%, var(--well)); border-color: var(--gold-dim); }
  input:checked + .track .knob { transform: translateX(1.15rem); background: var(--gold); }
  input:focus-visible + .track { outline: 1px solid var(--gold); outline-offset: 2px; }
  .disabled { cursor: default; opacity: .55; }
</style>
