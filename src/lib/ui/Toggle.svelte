<script lang="ts">
  // A bare on/off switch for a table cell; the column header says what it switches.
  let { on, label, title, onchange, disabled = false }: { on: boolean; label: string; title?: string; onchange: (on: boolean) => void; disabled?: boolean } = $props();
</script>

<button class="tog" class:on role="switch" aria-checked={on} aria-label={label} {title} {disabled} onclick={() => onchange(!on)}>
  <span class="knob"></span>
</button>

<style>
  .tog { width: 2.3rem; height: 1.15rem; padding: 0; position: relative; background: var(--well); border: 1px solid var(--rule-control); }
  /* The click lands over 26 px of height, though it is drawn 18: still inside its own row. */
  .tog::before { content: ""; position: absolute; inset: -5px -1px; }
  .knob { position: absolute; top: 2px; left: 2px; width: calc(1.15rem - 6px); height: calc(1.15rem - 6px); background: var(--platinum-deep); transition: transform .14s, background .12s; }
  /* On: white, as everything that's chosen is (gold is kept for platinum). */
  .tog.on { background: color-mix(in srgb, var(--platinum) 14%, var(--well)); border-color: var(--platinum-dim); }
  .tog.on .knob { transform: translateX(1.15rem); background: var(--platinum); }
  .tog:hover:not(:disabled) { border-color: var(--platinum-dim); }
</style>
