<script lang="ts">
  // The minimum prices, at the foot of Sell spares: one for everything, then each category's own,
  // which replaces it for that category (an empty box uses the one for everything). The one for
  // everything is the same setting as Orders' "never under". Nothing is listed or repriced under
  // an item's minimum (core/sparesRules.ts, minimumFor); the other floors still hold above it.
  import Metal from "../Metal.svelte";
  import { CATEGORY_LABEL, CATEGORY_SHORT, SPARE_CATEGORIES, minimumOf, type MinByCategory, type SpareCategory } from "../../core/sparesRules";

  let { minPrice = $bindable(), minByCategory = $bindable() }: { minPrice: number; minByCategory: MinByCategory } = $props();

  /** A minimum typed in: a whole number of 1 or more, or null (the box goes back to what it was). */
  const typed = (box: HTMLInputElement) => (box.value.trim() === "" ? null : minimumOf(Number(box.value)));

  function setGlobal(box: HTMLInputElement) {
    const v = typed(box);
    if (v == null) box.value = String(minPrice);
    else minPrice = v;
  }
  function setCat(c: SpareCategory, box: HTMLInputElement) {
    if (box.value.trim() === "") {
      // Emptied: the category goes back to the minimum for everything.
      const rest = { ...minByCategory };
      delete rest[c];
      minByCategory = rest;
      return;
    }
    const v = typed(box);
    if (v == null) box.value = minByCategory[c] != null ? String(minByCategory[c]) : "";
    else minByCategory = { ...minByCategory, [c]: v };
  }
</script>

<div class="mins" role="group" aria-label="Minimum prices">
  <span class="all">
    <span class="register" title="Nothing is listed or repriced under this, anywhere in MyOrbiter, unless its kind has its own minimum below. The same setting as Never under on Orders">Never under</span>
    <input class="minp" type="number" min="1" step="1" inputmode="numeric" value={minPrice} aria-label="Minimum price for everything" onchange={(e) => setGlobal(e.currentTarget)} onwheel={(e) => e.currentTarget.blur()} />
    <Metal kind="plat" size={13} />
  </span>
  <span class="dim small lead">by kind (empty: {minPrice}p)</span>
  {#each SPARE_CATEGORIES as c (c)}
    <label class="cat" title="{CATEGORY_LABEL[c]}: nothing listed or repriced under this. Empty uses {minPrice}p, the minimum for everything. Your own floors on Orders, a prime's ducats and a relic's crack value still hold above it">
      <span class="register">{CATEGORY_SHORT[c]}</span>
      <input class="minp" type="number" min="1" step="1" inputmode="numeric" placeholder={String(minPrice)} value={minByCategory[c] ?? ""} aria-label="Minimum price for {CATEGORY_LABEL[c].toLowerCase()}" onchange={(e) => setCat(c, e.currentTarget)} onwheel={(e) => e.currentTarget.blur()} />
    </label>
  {/each}
</div>

<style>
  .mins { display: flex; flex-wrap: wrap; align-items: center; gap: .4rem .9rem; }
  .all, .cat { display: inline-flex; align-items: center; gap: .35rem; }
  .minp { width: 3.6rem; padding: .3rem .4rem; }
  .minp::placeholder { color: var(--platinum-deep); }
  .lead { white-space: nowrap; }
</style>
