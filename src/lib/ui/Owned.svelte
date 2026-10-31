<script lang="ts">
  // The relics you hold by refinement, in words: "3 int · 1 rad". Radiant copies in gold.
  import { REFINEMENTS } from "../core/model";
  let { owned }: { owned: Partial<Record<string, number>> } = $props();
  const SHORT: Record<string, string> = { Intact: "int", Exceptional: "exc", Flawless: "flaw", Radiant: "rad" };
  const parts = $derived(REFINEMENTS.filter((r) => owned[r]).map((r) => ({ r, n: owned[r]! })));
</script>

<span class="owned" title={parts.map((p) => `${p.n} ${p.r}`).join(", ") || "None"}>
  {#each parts as p, i (p.r)}{#if i}<span class="sep">·</span>{/if}<span class="o o-{p.r}"><b>{p.n}</b>{SHORT[p.r]}</span>{:else}<span class="none">none</span>{/each}
</span>

<style>
  .owned { display: inline-flex; align-items: baseline; gap: .35rem; white-space: nowrap; font-family: var(--face-register); font-size: .62rem; letter-spacing: .08em; text-transform: uppercase; color: var(--platinum-deep); }
  b { font-family: var(--face-mark); font-size: .95rem; letter-spacing: 0; color: var(--platinum); margin-right: .2rem; }
  .o-Radiant, .o-Radiant b { color: var(--gold); }
  .sep { color: var(--rule-control); }
  /* Little room: one refinement a line, so the column narrows instead of the table overflowing. */
  .o { white-space: nowrap; }
  :global(html[data-room~="lt760"]) .owned { white-space: normal; flex-wrap: wrap; justify-content: flex-end; row-gap: 0; }
  :global(html[data-room~="lt760"]) .sep { display: none; }
  .none { color: var(--rule-control); }
</style>
