<script lang="ts">
  // How much each thing counts when orbiter picks a reward card: one slider each, 0 to 10.
  // 0 leaves it out (no interest in ducats while farming platinum, say); at least one stays above 0.
  import { defaultPickWeights, type PickWeights } from "../core/pick";

  let { weights = $bindable() }: { weights: PickWeights } = $props();

  const ROWS: { k: keyof PickWeights; label: string; title: string }[] = [
    { k: "plat", label: "Plat", title: "What it sells for, as a share of the best card on the screen" },
    { k: "needed", label: "Unmastered", title: "A part for something you haven't mastered or built, that you don't have yet" },
    { k: "ducats", label: "Ducats", title: "Its ducat value, out of 100" },
    { k: "set", label: "Completes a set", title: "Finishes a set (half for leaving it one part short)" },
  ];
  let note = $state<string | null>(null);
  function set(k: keyof PickWeights, n: number) {
    if (n === 0 && ROWS.every((r) => r.k === k || weights[r.k] === 0)) {
      note = "Keep at least one above 0: with all of them at 0 every card scores the same.";
      weights = { ...weights };
      return;
    }
    note = null;
    weights = { ...weights, [k]: n };
  }
  const DEFAULT = defaultPickWeights();
  const isDefault = $derived(ROWS.every((r) => weights[r.k] === DEFAULT[r.k]));
  const total = $derived(ROWS.reduce((n, r) => n + weights[r.k], 0) || 1);
</script>

<div class="sliders">
  {#each ROWS as r (r.k)}
    <label class="slider" title={r.title}>
      <span class="name">{r.label}</span>
      <input type="range" min="0" max="10" step="1" value={weights[r.k]} oninput={(e) => set(r.k, Number(e.currentTarget.value))} aria-label="{r.label} weight" />
      <span class="val" title="Its share of the score">{weights[r.k] ? `${Math.round((100 * weights[r.k]) / total)}%` : "off"}</span>
    </label>
  {/each}
  <div class="foot">
    {#if note}<span class="small warn-text">{note}</span>{/if}
    {#if !isDefault}<button class="link" title="Back to plat 8, unmastered 4, ducats 2, set 1" onclick={() => { weights = defaultPickWeights(); note = null; }}>Back to the usual weights</button>{/if}
  </div>
</div>

<style>
  .sliders { display: grid; gap: .55rem; }
  .slider { display: grid; grid-template-columns: 8.5rem 1fr 3rem; align-items: center; gap: .8rem; cursor: pointer; }
  .name { font-size: .86rem; color: var(--platinum); }
  .val { font-family: var(--face-register); font-size: .74rem; text-align: right; color: var(--gold); }
  input[type="range"] { width: 100%; accent-color: var(--gold); }
  .foot { display: flex; gap: .8rem; align-items: center; min-height: 1rem; }
</style>
