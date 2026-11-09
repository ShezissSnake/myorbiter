<script lang="ts">
  // The relics you hold by refinement: each as the relic looks at that refinement (`base`, "Lith
  // A13", gives its era's pictures), its count, and the refinement's name ("3 intact · 1 radiant").
  // `compact`: smaller, for a card's footer, and it wraps rather than widening the card. Radiant in bright platinum. The pictures are bundled (public/game), so they show offline;
  // an era without one here falls back to the item art.
  import { REFINEMENTS, relicImage } from "../core/model";
  import { imageUrl } from "../backend";
  import { relicIcon } from "./GameIcon.svelte";
  let { owned, base = null, compact = false }: { owned: Partial<Record<string, number>>; base?: string | null; compact?: boolean } = $props();
  const SHORT: Record<string, string> = { Intact: "intact", Exceptional: "exceptional", Flawless: "flawless", Radiant: "radiant" };
  const parts = $derived(REFINEMENTS.filter((r) => owned[r]).map((r) => ({ r, n: owned[r]!, pic: base ? picOf(base, r) : null })));
  function picOf(base: string, refinement: string): string | null {
    const own = relicIcon(base.split(" ")[0], refinement);
    if (own) return `/game/${own}.png`;
    const art = relicImage(`${base} ${refinement}`);
    return art ? imageUrl(art) : null;
  }
</script>

<span class="owned" class:compact title={parts.map((p) => `${p.n} ${p.r}`).join(", ") || "None"}>
  {#each parts as p, i (p.r)}{#if i}<span class="sep">·</span>{/if}<span class="o o-{p.r}">{#if p.pic}<img src={p.pic} alt="" width="15" height="15" loading="lazy" decoding="async" onerror={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")} />{/if}<b>{p.n}</b><span class="w">{SHORT[p.r]}</span></span>{:else}<span class="none">none</span>{/each}
</span>

<style>
  .owned { display: inline-flex; align-items: center; gap: .35rem; white-space: nowrap; font-family: var(--face-register); font-size: .74rem; letter-spacing: .08em; text-transform: uppercase; color: var(--platinum-deep); }
  b { font-family: var(--face-mark); font-size: .95rem; letter-spacing: 0; color: var(--platinum); margin-right: .2rem; }
  img { flex: none; margin-right: .18rem; object-fit: contain; }
  .compact b { margin-right: .1rem; }
  /* Compact: the words smaller, and a refinement a line when there's no room for them all. */
  .compact { white-space: normal; flex-wrap: wrap; row-gap: 0; font-size: 11px; letter-spacing: .05em; }
  .o { display: inline-flex; align-items: center; white-space: nowrap; }
  .o-Radiant, .o-Radiant b { color: var(--platinum); font-weight: 600; }
  .sep { color: var(--rule-control); }
  /* Little room (a table under 1100 px): one refinement a line, so the column narrows instead of the
     table overflowing, and the words stay. */
  :global(html[data-room~="lt1100"]) .owned:not(.compact) { white-space: normal; flex-wrap: wrap; justify-content: flex-end; row-gap: 0; }
  :global(html[data-room~="lt1100"]) .owned:not(.compact) .sep { display: none; }
  /* Nothing here: quiet, but still readable (about 5:1). */
  .none { color: var(--platinum-deep); }
</style>
