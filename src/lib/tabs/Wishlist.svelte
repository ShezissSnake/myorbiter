<script lang="ts">
  import { mkt } from "../marketStore.svelte";
  // The things you starred, and the quickest way to each missing part: crack a relic you hold
  // (lit when a fissure of its era is open right now), farm a relic that still drops, or buy it.
  import { ERAS, type Model } from "../core/model";
  import type { Settings } from "../backend";
  import { openEras, wishItem, wishlistEras, type FarmSpot, type WishItem } from "../core/wishlist";
  import { details } from "../details.svelte";
  import { info } from "../hover.svelte";
  import { placeName } from "../core/describe";
  import { until } from "../core/traders";
  import PageHead from "../ui/PageHead.svelte";
  import Stat from "../ui/Stat.svelte";
  import Art from "../ui/Art.svelte";
  import PartChip from "../ui/PartChip.svelte";
  import P from "../ui/P.svelte";
  import GameIcon, { eraIcon, type GameIconName } from "../ui/GameIcon.svelte";
  import Icon from "../ui/Icon.svelte";
  import IconButton from "../ui/IconButton.svelte";

  let { model, settings = $bindable() }: { model: Model; settings: Settings } = $props();

  let now = $state(Date.now());
  $effect(() => {
    const t = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(t);
  });

  const items = $derived(settings.favourites.map((u) => wishItem(model, u)).filter((w): w is WishItem => !!w));
  const open = $derived(openEras(model.live.fissures, now));
  const byEra = $derived(wishlistEras(model, settings.favourites));
  // Every era with relics (Omnia fissures take any of them).
  // Eras with a fissure open now where a relic you hold drops something you want (Omnia takes any).
  const crackNow = $derived(
    ERAS.map((e) => ({ era: e, fissures: [...(open[e] ?? []), ...(open.Omnia ?? [])], relics: byEra.get(e) ?? [] })).filter((x) => x.relics.length && x.fissures.length),
  );
  const missingCount = $derived(items.reduce((n, w) => n + w.missing.length, 0));
  const relicsHeld = $derived(new Set([...byEra.values()].flat().map((x) => x.relic)).size);

  // Adding by name.
  let adding = $state("");
  const names = $derived(
    [...model.catalogByUnique.values()].filter((c) => c.masterable && !c.excludeFromCodex && ["Warframes", "Primary", "Secondary", "Melee", "Sentinels", "Pets", "Archwing", "Arch-Gun", "Arch-Melee", "Misc"].includes(c.category)),
  );
  /** Each name once for the list (a few items share one). */
  const listNames = $derived([...new Set(names.map((c) => c.name))].sort((a, b) => a.localeCompare(b)));
  // Of items that share a name, the one already starred.
  const pick = $derived.by(() => {
    const same = names.filter((c) => c.name.toLowerCase() === adding.trim().toLowerCase());
    return same.find((c) => settings.favourites.includes(c.uniqueName)) ?? same[0] ?? null;
  });
  const already = $derived(!!pick && settings.favourites.includes(pick.uniqueName));
  function add() {
    if (!pick || already) return;
    settings.favourites = [pick.uniqueName, ...settings.favourites];
    adding = "";
  }
  const remove = (u: string) => (settings.favourites = settings.favourites.filter((x) => x !== u));
  const pct = (x: number) => (x >= 0.995 ? "99%+" : x < 0.005 && x > 0 ? "<1%" : `${Math.round(x * 100)}%`);
  /** Missing parts that come from relics, but none you hold. */
  const uncovered = (w: WishItem) => w.missing.filter((p) => !p.yours.length && model.sourcesByReward.get(p.name)?.length).length;
  /** The best farm spots, one heading per relic. */
  function farmByRelic(spots: FarmSpot[]) {
    const out: { relic: string; spots: FarmSpot[] }[] = [];
    for (const f of spots.slice(0, 2)) {
      const g = out.find((x) => x.relic === f.relic);
      if (g) g.spots.push(f);
      else out.push({ relic: f.relic, spots: [f] });
    }
    return out;
  }
  const liveFor = (era: string) => (open[era]?.length ?? 0) + (open.Omnia?.length ?? 0);
  /** As Relics and Home say it: this era's normal fissures + Steel Path, then Omnia ones apart. */
  const fissureCount = (era: string) => {
    const own = open[era] ?? [];
    const sp = own.filter((f) => f.isHard).length;
    const om = open.Omnia?.length ?? 0;
    return [own.length - sp ? `${own.length - sp} open` : "", sp ? `${sp} Steel Path` : "", om ? `${om} Omnia` : ""].filter(Boolean).join(" · ");
  };
</script>

<!-- The band only once something is starred: four zeros say nothing. -->
{#snippet band()}
  <Stat label="Wished for" note="Star anything in Foundry, Mastery or its details">{items.length}</Stat>
  <Stat label="Parts missing" tone="dim" note="Across everything you starred">{missingCount}</Stat>
  <Stat extra label="Relics you hold" note="That drop one of those parts">{relicsHeld}</Stat>
  <Stat keep label="Crack now" tone="gold" note={crackNow.length ? crackNow.map((c) => c.era).join(", ") + " fissures open" : "No matching fissure open"}>{crackNow.length}</Stat>
{/snippet}

<div class="page"><div class="page-inner">
  <PageHead title="Wishlist" blurb="What you've starred, and the quickest way to each missing part: a relic you hold, where to farm one, or what it costs." band={items.length ? band : undefined} />

  <div class="bar">
    <input list="wish-names" placeholder="Add something to your wishlist…" bind:value={adding} onkeydown={(e) => e.key === "Enter" && add()} aria-label="Item to add" />
    <datalist id="wish-names">{#each listNames as n (n)}<option value={n}></option>{/each}</datalist>
    <IconButton icon="plus" tone="gold" label="Add to your wishlist" disabled={!pick || already} onclick={add} />
    {#if adding && !pick}<span class="dim small">Pick a warframe, weapon or companion from the list.</span>
    {:else if already}<span class="dim small">Already on your wishlist.</span>{/if}
  </div>

  {#if crackNow.length}
    <section class="now" aria-label="Crack now">
      {#each crackNow as c (c.era)}
        <div class="era">
          <div class="eh"><GameIcon name={eraIcon(c.era)} size={26} /><b class="mark">{c.era}</b><span class="dim small">{fissureCount(c.era)} · next closes in {until([...c.fissures].sort((a, b) => Date.parse(a.expiry) - Date.parse(b.expiry))[0].expiry, now)}</span></div>
          <ul>
            {#each c.relics.slice(0, 4) as r, i (i)}<li><b class="name-mark" use:info={r.relic}>{r.relic}</b><span class="dim small">for</span><span use:info={r.part}>{r.part.replace(`${r.item} `, "")}</span><span class="dim small">· {r.item}</span></li>{/each}
            {#if c.relics.length > 4}<li class="dim small">+{c.relics.length - 4} more</li>{/if}
          </ul>
        </div>
      {/each}
    </section>
  {/if}

  {#if !items.length}
    <section class="panel empty">
      <h2 class="mark">Nothing starred yet</h2>
      <p class="prose">Star something (☆ in Foundry, Mastery or its details) or add it above: you'll see the relics for each missing part, and what buying them costs.</p>
    </section>
  {:else}
    <div class="list">
      {#each items as w (w.c.unique)}
        <article class="wish" class:done={!w.missing.length}>
          <div class="who">
            <button class="art" onclick={() => details.open(w.c.unique)} aria-label="{w.c.name}: details" use:info={w.c.name}><Art file={w.c.image} size={96} /></button>
            <div class="wt">
              <button class="nm" onclick={() => details.open(w.c.unique)}><b class="mark">{w.c.name}</b></button>
              <span class="register">{w.c.type}</span>
              <div class="chips">{#each w.c.parts.filter((p) => !p.resource) as p (p.name)}<PartChip part={p} size={30} />{/each}</div>
              <div class="sum">
                {#if w.c.mastered}<span class="tag good">✓ Mastered</span><button class="link quiet" title="You've mastered it: take it off your wishlist" onclick={() => remove(w.c.unique)}>Done: remove it</button>
                {:else if w.c.owned}<span class="tag ok">Owned · level it</span>
                {:else if w.c.building}<span class="tag">Building</span>
                {:else if !w.missing.length}<span class="tag ok">Ready to build</span>
                {:else}
                  {#if w.odds != null && w.odds > 0}<span class="odds" title="Chance your relics give every missing part if you crack each of them once">{pct(w.odds)} <span class="dim small">from your relics</span></span>
                  {:else if uncovered(w)}<span class="dim small">{uncovered(w) === w.missing.length ? "None of the missing parts are in your relics" : `${uncovered(w)} of ${w.missing.length} missing parts aren't in your relics`}</span>{/if}
                  {#if w.buyCost != null}<span class="buy"><span class="dim small">{w.odds ? "or buy for" : "Buy what's missing for"}</span><P v={w.buyCost} /></span>{/if}
                {/if}
              </div>
            </div>
            <button class="unstar" title="Remove from your wishlist" aria-label="Remove {w.c.name} from your wishlist" onclick={() => remove(w.c.unique)}><Icon name="star" size={15} /></button>
          </div>
          {#if w.missing.length}
            <table>
              <colgroup><col style="width: 26%" /><col style="width: 39%" /><col style="width: 35%" /><col style="width: 6.8rem" /></colgroup>
              <thead><tr><th>Missing</th><th>Your relics</th><th>Farm</th><th class="r">Buy</th></tr></thead>
              <tbody>
                {#each w.missing as p (p.name)}
                  <tr>
                    <td><span class="part"><PartChip part={{ label: p.label, name: p.name, image: p.image, required: p.required, have: p.have, resource: false, building: p.building, price: p.price, ducats: null, tradable: true, blueprint: p.label === "Blueprint" }} size={28} /><b class="name-mark" use:info={p.name}>{p.label}</b></span></td>
                    <td>
                      {#if p.yours.length}
                        <span class="relics">
                          {#each p.yours.slice(0, 3) as r (r.base)}
                            <span class="relic" class:live={liveFor(r.era) > 0} use:info={r.base}><GameIcon name={eraIcon(r.era)} size={15} />{r.base}<em>×{r.total}</em><span class="dim">{Math.round(r.best)}%</span></span>
                          {/each}
                          {#if p.yours.length > 3}<span class="dim small">+{p.yours.length - 3}</span>{/if}
                        </span>
                        <span class="dim small">{pct(p.odds)} to get {p.required - p.have > 1 ? `the ${p.required - p.have} you need` : "it"} cracking each once</span>
                      {:else if p.drops.length}<span class="dim small">Not from relics</span>
                      {:else}<span class="dim small">none held</span>{/if}
                    </td>
                    <td>
                      {#if p.farm.length}
                        {#each farmByRelic(p.farm) as g (g.relic)}<div class="farm"><b use:info={g.relic}>{g.relic}</b>{#each g.spots as f, i (i)}<span class="dim small">{placeName(f.location)} · {Math.round(f.chance * 10) / 10}%</span>{/each}</div>{/each}
                      {:else if p.drops.length}
                        <div class="farm">{#each p.drops as d, i (i)}<span class="small">{placeName(d.location)} <span class="dim">· {Math.round(d.chance * 100) / 100}%</span></span>{/each}</div>
                      {:else if p.resurgence}<span class="tag ok">Varzia has it</span>
                      {:else if p.vaulted}<span class="dim small">Vaulted</span>
                      {:else}<span class="dim small">–</span>{/if}
                    </td>
                    <td class="r"><span class="buycell"><P v={p.price == null ? null : Math.round(p.price)} /><button class="link buyo" title="Post a buy order on warframe.market for {p.name}: sellers whisper you" onclick={() => mkt.startBuy(p.name, { quantity: Math.max(1, p.required - p.have) })}>Buy order</button></span></td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}
        </article>
      {/each}
    </div>
  {/if}
</div></div>

<style>
  /* A part's price over its Buy order button, right-aligned in its cell: the button may wrap, never cut. */
  .buycell { display: inline-grid; justify-items: end; gap: .15rem; max-width: 100%; }
  .buyo { font-size: .58rem; white-space: nowrap; padding: 0; }
  .bar input[list] { min-width: 22rem; }
  .now { align-items: start; display: grid; grid-template-columns: repeat(auto-fit, minmax(17rem, 1fr)); gap: .8rem; margin: 0 0 var(--step); }
  .era { border: 1px solid var(--gold-dim); background: linear-gradient(180deg, #1a1810, var(--plate) 55%); padding: .7rem .9rem; display: grid; gap: .5rem; clip-path: var(--cut); }
  .eh { display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; }
  .eh b { font-size: 1.15rem; color: var(--gold); }
  .era ul { list-style: none; margin: 0; padding: 0; display: grid; gap: .25rem; font-size: .82rem; }
  .era li { display: flex; gap: .35rem; align-items: baseline; flex-wrap: wrap; }
  .list { display: grid; gap: .9rem; }
  .wish { border: 1px solid var(--rule); background: linear-gradient(180deg, #14161a, var(--plate) 40%); clip-path: var(--cut); padding: .9rem 1rem; display: grid; grid-template-columns: minmax(18rem, 24rem) 1fr; gap: 1.2rem; align-items: start; }
  .wish.done { grid-template-columns: 1fr; }
  /* Page area under 950 px (App sets the flag, by the room pages actually have). */
  :global(html[data-room~="lt950"]) .wish { grid-template-columns: 1fr; }
  .who { display: grid; grid-template-columns: auto 1fr auto; gap: .8rem; align-items: start; }
  .art, .nm { padding: 0; border: 0; background: none; text-align: left; }
  .nm b { font-size: 1.3rem; }
  .nm:hover b { color: var(--gold); }
  .wt { display: grid; gap: .35rem; min-width: 0; }
  .chips { display: flex; gap: .35rem; flex-wrap: wrap; margin-top: .2rem; }
  .sum { display: flex; gap: .8rem; align-items: baseline; flex-wrap: wrap; margin-top: .2rem; }
  .sum .tag { margin: 0; }
  .odds { font-family: var(--face-mark); font-size: 1.2rem; color: var(--gold); }
  .buy { display: inline-flex; gap: .35rem; align-items: center; }
  .unstar { border: 0; background: none; padding: .2rem; color: var(--gold); line-height: 0; }
  /* The icon draws its path with fill="none": the rule has to reach the path itself. */
  .unstar :global(svg path) { fill: var(--gold); }
  .unstar:hover { color: var(--oxblood); }
  .unstar:hover :global(svg path) { fill: none; }
  table { width: 100%; table-layout: fixed; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  th { text-align: left; font-family: var(--face-register); font-weight: 500; font-size: .6rem; letter-spacing: .14em; text-transform: uppercase; color: var(--platinum-deep); padding: 0 .5rem .45rem; border-bottom: 1px solid var(--rule); }
  td { padding: .5rem; border-bottom: 1px solid var(--rule); vertical-align: middle; }
  tr:last-child td { border-bottom: 0; }
  .r { text-align: right; }
  .part { display: inline-flex; align-items: center; gap: .55rem; }
  .relics { display: flex; gap: .35rem; flex-wrap: wrap; margin-bottom: .2rem; }
  .relic { display: inline-flex; align-items: center; gap: .3rem; padding: .12rem .45rem .12rem .25rem; border: 1px solid var(--rule-bright); font-size: .78rem; }
  .relic em { font-style: normal; color: var(--gold); font-weight: 600; }
  .relic.live { border-color: var(--gold); box-shadow: 0 0 10px -4px rgb(214 174 74 / 70%); }
  .farm { display: grid; font-size: .8rem; }
  .farm + .farm { margin-top: .3rem; }
  .farm b { font-weight: 600; }
</style>
