<script lang="ts">
  // The relics you hold by refinement: each as the relic looks at that refinement (`base`, "Lith
  // A13", gives its era's pictures), its count, and the refinement's name ("3 intact · 1 radiant").
  // `compact`: the pictures, counts and initials (15 I · 1 R), the names on hover, for a card's
  // footer. Radiant in gold.
  import { REFINEMENTS, relicImage } from "../core/model";
  import { imageUrl } from "../backend";
  let { owned, base = null, compact = false }: { owned: Partial<Record<string, number>>; base?: string | null; compact?: boolean } = $props();
  const SHORT: Record<string, string> = { Intact: "intact", Exceptional: "exceptional", Flawless: "flawless", Radiant: "radiant" };
  const parts = $derived(REFINEMENTS.filter((r) => owned[r]).map((r) => ({ r, n: owned[r]!, pic: base ? relicImage(`${base} ${r}`) : null })));
</script>

<span class="owned" class:compact title={parts.map((p) => `${p.n} ${p.r}`).join(", ") || "None"}>
  {#each parts as p, i (p.r)}{#if i}<span class="sep">·</span>{/if}<span class="o o-{p.r}">{#if p.pic}<img src={imageUrl(p.pic)} alt="" width="15" height="15" loading="lazy" onerror={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")} />{/if}<b>{p.n}</b>{#if !compact}<span class="w" class:pw={!!p.pic}>{SHORT[p.r]}</span>{:else}<span class="l">{p.r[0]}</span>{/if}</span>{:else}<span class="none">none</span>{/each}
</span>

<style>
  .owned { display: inline-flex; align-items: center; gap: .35rem; white-space: nowrap; font-family: var(--face-register); font-size: .62rem; letter-spacing: .08em; text-transform: uppercase; color: var(--platinum-deep); }
  b { font-family: var(--face-mark); font-size: .95rem; letter-spacing: 0; color: var(--platinum); margin-right: .2rem; }
  img { flex: none; margin-right: .18rem; object-fit: contain; }
  .compact b { margin-right: .1rem; }
  /* Compact: the refinement's initial (I, E, F, R) after the count; the pictures alone are too alike at this size. */
  .l { font-size: .62rem; }
  .o { display: inline-flex; align-items: center; white-space: nowrap; }
  .o-Radiant, .o-Radiant b { color: var(--gold); }
  .sep { color: var(--rule-control); }
  /* Little room: one refinement a line, so the column narrows instead of the table overflowing. */
  :global(html[data-room~="lt760"]) .owned:not(.compact) { white-space: normal; flex-wrap: wrap; justify-content: flex-end; row-gap: 0; }
  :global(html[data-room~="lt760"]) .owned:not(.compact) .sep { display: none; }
  .none { color: var(--rule-control); }
  /* Under 1100 px a table's row has no room for the words: the pictures and counts stay, the words go to the tooltip. */
  :global(html[data-room~="lt1100"]) .w.pw { display: none; }
</style>
