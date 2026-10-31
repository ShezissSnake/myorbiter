<script lang="ts">
  // A mod's or arcane's details, opened from its card or row on Mods or Arcanes: what it does at
  // max rank, the copies you hold by rank, what it sells for, where it drops and its price over
  // time. The page adds its own actions (List…) in `children`.
  import type { Snippet } from "svelte";
  import type { Model } from "../core/model";
  import { describe, effectLines, placeName } from "../core/describe";
  import { marketUrl, openUrl, wikiUrl } from "../backend";
  import P from "./P.svelte";
  import ModCard from "./ModCard.svelte";
  import PriceHistory from "./PriceHistory.svelte";

  let {
    model,
    name,
    unique = null,
    ranks = [],
    tradable = true,
    children,
  }: {
    model: Model;
    name: string;
    unique?: string | null;
    /** Copies you hold, by rank. */
    ranks?: { rank: number; count: number }[];
    tradable?: boolean;
    children?: Snippet;
  } = $props();

  const d = $derived(describe(model, name, unique));
  const item = $derived(d && (d.kind === "mod" || d.kind === "arcane") ? d.item : null);
  const lines = $derived(effectLines(item));
  const price = $derived(model.price(name));
  const priceMax = $derived(model.priceMax(name));
  const pct = (v: number) => `${Math.round(v * 100) / 100}%`;
</script>

<div class="up">
  {#if item}
    <div class="show">
      <ModCard arcane={d?.kind === "arcane"} {name} image={model.imageOf(name)} rarity={item.rarity ?? ""} polarity={item.polarity ?? null} drain={item.baseDrain ?? null} maxRank={item.maxRank ?? null} rank={ranks.length ? Math.max(...ranks.map((x) => x.rank)) : 0} label={item.compatName ?? ""} does={item.maxStats?.[0] ?? ""} width={150} />
    </div>
  {/if}
  {#if lines.length}
    <div class="effect"><span class="register">At max rank{item?.maxRank ? ` (${item.maxRank})` : ""}</span>{#each lines as l, i (i)}<p>{l}</p>{/each}</div>
  {/if}
  <div class="figs">
    <span title="Copies you hold, whatever their rank"><span class="register">Held</span><b>{ranks.reduce((n, x) => n + x.count, 0)}</b></span>
    {#if tradable}
      <span title="What an unranked copy sells for on warframe.market (daily median)"><span class="register">Unranked</span><P v={price} /></span>
      <span title="What a max-rank copy sells for (daily median)"><span class="register">Maxed</span><P v={priceMax} /></span>
    {:else}<span class="dim small">Can't be traded</span>{/if}
    {#if item?.rarity}<span><span class="register">Rarity</span><b class="small">{item.rarity}</b></span>{/if}
  </div>
  {#if ranks.length}
    <div class="ranks" title="Your copies by rank">{#each [...ranks].sort((a, b) => b.rank - a.rank) as x (x.rank)}<span>{x.rank ? `R${x.rank}` : "Unranked"}{x.count > 1 ? ` ×${x.count}` : ""}</span>{/each}</div>
  {/if}
  {@render children?.()}
  {#if item?.drops?.length}
    <div class="register lbl">Drops from</div>
    <ul class="srcs">{#each item.drops.slice(0, 6) as x, i (i)}<li><span>{placeName(x.location)}</span><span class="grow"></span><span class="dim">{pct(x.chance)}</span></li>{/each}</ul>
    {#if item.drops.length > 6}<p class="dim small">and {item.drops.length - 6} more places</p>{/if}
  {/if}
  {#if tradable}<div class="hist"><PriceHistory {name} {unique} rank={0} height={130} /></div>{/if}
  <div class="links">
    <button class="link" onclick={() => openUrl(wikiUrl(name))}>Wiki ↗</button>
    {#if tradable}<button class="link" onclick={() => openUrl(marketUrl(name))}>warframe.market ↗</button>{/if}
  </div>
</div>

<style>
  .up { display: grid; gap: .8rem; }
  .show { display: flex; justify-content: center; padding: .3rem 0; }
  .effect { display: grid; gap: .25rem; padding: .55rem .7rem; background: var(--well); border: 1px solid var(--rule); }
  .effect p { margin: 0; white-space: pre-line; color: var(--platinum); line-height: 1.4; font-size: .86rem; }
  .register { font-size: .6rem; }
  .figs { display: flex; flex-wrap: wrap; gap: 1.2rem; align-items: baseline; }
  .figs > span { display: grid; gap: .15rem; }
  .ranks { display: flex; flex-wrap: wrap; gap: .4rem; font-size: .76rem; }
  .ranks span { padding: .1rem .45rem; border: 1px solid var(--rule); color: var(--platinum-dim); }
  .lbl { color: var(--gold-dim); }
  .srcs { list-style: none; margin: 0; padding: 0; display: grid; gap: .2rem; font-size: .8rem; }
  .srcs li { display: flex; gap: .6rem; }
  .grow { flex: 1; }
  .links { display: flex; gap: 1.2rem; }
</style>
