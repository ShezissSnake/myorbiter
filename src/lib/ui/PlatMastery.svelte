<script lang="ts">
  // Mastery for platinum (platMastery.ts): what you haven't mastered that platinum buys, cheapest
  // first or least platinum per mastery point, with what to buy. Each part or item can go on your
  // wishlist, or straight into a buy order on warframe.market so sellers whisper you.
  import type { Model } from "../core/model";
  import type { MasteryRow } from "../core/views";
  import { platMastery, type PlatMastery } from "../core/platMastery";
  import { mkt } from "../marketStore.svelte";
  import { details } from "../details.svelte";
  import Seg from "./Seg.svelte";
  import Thumb from "./Thumb.svelte";
  import P from "./P.svelte";
  import GameIcon from "./GameIcon.svelte";
  import NoMatch from "./NoMatch.svelte";

  let { model, rows, wished, onwish, clear = null }: { model: Model; rows: MasteryRow[]; wished: Set<string>; onwish: (unique: string) => void; clear?: (() => void) | null } = $props();

  let order = $state<"plat" | "perK">("plat");
  let limit = $state(60);
  const list = $derived.by(() => {
    const xs = platMastery(model, rows);
    return order === "perK" ? [...xs].sort((a, b) => a.perK - b.perK || a.plat - b.plat) : xs;
  });
  // Spending down the list, cheapest first: how much mastery a budget buys.
  const running = $derived.by(() => {
    let plat = 0;
    let pts = 0;
    return list.map((x) => ((plat += x.plat), (pts += x.row.points), { plat, pts }));
  });
  const buy = (x: PlatMastery, b: PlatMastery["buys"][number]) => mkt.startBuy(b.name, { quantity: b.need, known: b.price });
</script>

<div class="bar">
  <Seg label="Order" bind:value={order} options={[{ v: "plat", label: "Least plat", title: "Cheapest first: the least you can spend for each item" }, { v: "perK", label: "Plat per mastery", title: "Least platinum per 1,000 mastery points first: the most mastery for your platinum" }]} />
  <span class="dim small">Prices are warframe.market's daily median, or the in-game Market's platinum price when that's cheaper. Prime sets count only the parts you're missing.</span>
</div>

{#if !list.length}
  {#if clear}<p class="nothing"><NoMatch {clear} /></p>{:else}<p class="dim">Nothing you haven't mastered has a platinum price MyOrbiter knows.</p>{/if}
{:else}
  <div class="pmh register" aria-hidden="true"><span>Item</span><span>What to buy</span><span class="r">Cost · per 1,000 mastery</span><span class="r">Buying down to here</span><span></span></div>
  <ol class="pm">
    {#each list.slice(0, limit) as x, i (x.row.unique)}
      <li>
        <button class="it" data-opens aria-label="{x.row.name}: details" onclick={() => details.open(x.row.unique)}>
          <Thumb file={model.imageOf(x.row.name)} name={x.row.name} size={34} />
          <span class="nm"><b class="mark">{x.row.name}</b><span class="dim small">{x.row.category} · <GameIcon name="mastery" size={11} /> {x.row.points.toLocaleString("en")}</span></span>
        </button>
        <span class="buys">
          {#if x.where === "ingame"}
            <span class="src" title="Bought built from the in-game Market for platinum"><GameIcon name="market" size={14} />In-game Market</span>
          {:else}
            {#each x.buys as b (b.name)}
              <span class="buy">
                <Thumb file={model.imageOf(b.name.replace(/ Set$/, "")) ?? model.imageOf(x.row.name)} name={b.name} size={22} />
                <span class="bn" title={b.name}>{b.name.replace(`${x.row.name} `, "")}{b.need > 1 ? ` ×${b.need}` : ""}</span>
                <P v={b.price} dim />
                <button class="link" title="Post a buy order for {b.name} on warframe.market: sellers whisper you, often for less" onclick={() => buy(x, b)}>Buy order</button>
              </span>
            {/each}
          {/if}
        </span>
        <span class="cost"><P v={x.plat} /><span class="dim small" title="Platinum per 1,000 mastery points">{x.perK}p per 1k</span></span>
        <span class="tot dim small" title="Buying everything down the list to here">{running[i].plat.toLocaleString("en")}p → {running[i].pts.toLocaleString("en")} mastery</span>
        <button class="star" class:on={wished.has(x.row.unique)} aria-pressed={wished.has(x.row.unique)} aria-label={wished.has(x.row.unique) ? `Remove ${x.row.name} from your wishlist` : `Add ${x.row.name} to your wishlist`} title={wished.has(x.row.unique) ? "On your wishlist (click to remove)" : "Add to your wishlist: Home and the cheap-buy alerts watch for it"} onclick={() => onwish(x.row.unique)}>
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 1.6l1.9 4.1 4.5.5-3.4 3 1 4.4L8 11.4l-4 2.2 1-4.4-3.4-3 4.5-.5z" /></svg>
        </button>
      </li>
    {/each}
  </ol>
  {#if list.length > limit}<button class="link more" onclick={() => (limit += 60)}>{list.length - limit} more</button>{/if}
{/if}

<style>
  .bar { display: flex; flex-wrap: wrap; align-items: center; gap: .6rem 1.2rem; margin-bottom: 1rem; }
  .pm { list-style: none; margin: 0; padding: 0; display: grid; gap: .15rem; }
  .pmh { display: grid; grid-template-columns: minmax(12rem, 1.1fr) minmax(0, 2fr) 6.5rem 9.5rem 28px; gap: .9rem; padding: 0 .5rem .35rem; font-size: 11px; color: var(--platinum-deep); }
  .pmh .r { text-align: right; }
  :global(html[data-room~="lt900"]) .pmh { grid-template-columns: minmax(10rem, 1fr) minmax(0, 1.4fr) 6rem 28px; }
  :global(html[data-room~="lt900"]) .pmh span:nth-child(4) { display: none; }
  :global(html[data-room~="lt640"]) .pmh { display: none; }
  .pm li { display: grid; grid-template-columns: minmax(12rem, 1.1fr) minmax(0, 2fr) 6.5rem 9.5rem 28px; gap: .9rem; align-items: center; padding: .4rem .5rem; border-top: 1px solid var(--rule); }
  .pm li:hover { background: var(--raised); }
  .it { all: unset; cursor: pointer; display: flex; align-items: center; gap: .6rem; min-width: 0; }
  .it:hover .mark { color: var(--gold); }
  .it:focus-visible { outline: 1px solid var(--gold); outline-offset: 2px; }
  .nm { display: grid; min-width: 0; }
  .nm b { font-size: 1rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .nm .small { display: inline-flex; align-items: center; gap: .25rem; }
  .buys { display: flex; flex-wrap: wrap; gap: .35rem .9rem; min-width: 0; }
  .buy { display: inline-flex; align-items: center; gap: .4rem; font-size: .84rem; }
  .bn { max-width: 12rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .src { display: inline-flex; align-items: center; gap: .35rem; font-size: .84rem; color: var(--platinum-dim); }
  .cost { display: grid; justify-items: end; }
  .tot { text-align: right; font-variant-numeric: tabular-nums; }
  .star { display: grid; place-items: center; width: 28px; height: 28px; padding: 0; border: 0; background: none; color: var(--platinum-deep); }
  .star svg { fill: none; stroke: currentColor; stroke-width: 1.2; }
  .star:hover, .star.on { color: var(--gold); }
  .star.on svg { fill: var(--gold); }
  .more { margin-top: .6rem; }
  :global(html[data-room~="lt900"]) .pm li { grid-template-columns: minmax(10rem, 1fr) minmax(0, 1.4fr) 6rem 28px; }
  :global(html[data-room~="lt900"]) .tot { display: none; }
  :global(html[data-room~="lt640"]) .pm li { grid-template-columns: minmax(0, 1fr) 5.5rem 28px; }
  :global(html[data-room~="lt640"]) .buys { grid-column: 1 / -1; grid-row: 2; }
</style>
