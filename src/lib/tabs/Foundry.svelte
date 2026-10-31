<script lang="ts">
  // Every warframe, weapon, companion and archwing as a card: its artwork, each part as a chip
  // (gold when you have it), and whether you own it, have mastered it, or can build it now.
  // A click opens everything about it.
  import Avail from "../ui/Avail.svelte";
  import type { Model } from "../core/model";
  import type { Settings } from "../backend";
  import { collection, GROUPS, type CollectionItem, type Group } from "../core/collection";
  import { details } from "../details.svelte";
  import PageHead from "../ui/PageHead.svelte";
  import Stat from "../ui/Stat.svelte";
  import Tabs from "../ui/Tabs.svelte";
  import Seg from "../ui/Seg.svelte";
  import { nearEnd } from "../ui/nearEnd";
  import CardGrid from "../ui/CardGrid.svelte";
  import ItemCard from "../ui/ItemCard.svelte";
  import PartChip from "../ui/PartChip.svelte";
  import GameIcon, { type GameIconName } from "../ui/GameIcon.svelte";
  import P from "../ui/P.svelte";

  let { model, settings = $bindable() }: { model: Model; settings: Settings } = $props();

  const all = $derived(collection(model));
  const ICON: Record<Group, GameIconName> = { warframes: "warframes", primary: "primary", secondary: "secondary", melee: "melee", companions: "companions", archwing: "archwing", other: "foundry" };

  let group = $state<Group | "all">("warframes");
  let show = $state<"all" | "todo" | "owned" | "build" | "fav">("all");
  let sort = $state<"name" | "close" | "points" | "price">("name");
  let q = $state("");
  // A first screenful at once, then more as you scroll.
  let limit = $state(24);

  const favs = $derived(new Set(settings.favourites));
  const inGroup = $derived(group === "all" ? all : all.filter((c) => c.group === group));
  const shown = $derived.by(() => {
    const needle = q.trim().toLowerCase();
    // A search, and your wishlist (its count is every category's), look through every category.
    let xs = (needle || show === "fav" ? all : inGroup).filter((c) => {
      if (needle && !c.name.toLowerCase().includes(needle)) return false;
      if (show === "todo") return !c.mastered && !c.unobtainable;
      if (show === "owned") return c.owned;
      if (show === "build") return c.buildable || c.building;
      if (show === "fav") return favs.has(c.unique);
      return true;
    });
    const have = (c: CollectionItem) => {
      const pieces = c.parts.filter((p) => !p.resource);
      return pieces.length ? pieces.filter((p) => p.have >= p.required || p.building).length / pieces.length : 0;
    };
    if (sort === "close") xs = [...xs].sort((a, b) => Number(a.mastered) - Number(b.mastered) || Number(b.owned) - Number(a.owned) || have(b) - have(a) || a.name.localeCompare(b.name));
    else if (sort === "points") xs = [...xs].sort((a, b) => Number(a.mastered) - Number(b.mastered) || b.points - a.points || a.name.localeCompare(b.name));
    else if (sort === "price") xs = [...xs].sort((a, b) => (b.setPrice ?? -1) - (a.setPrice ?? -1) || a.name.localeCompare(b.name));
    return xs;
  });
  $effect(() => {
    group;
    show;
    q;
    sort;
    limit = 24;
  });

  const count = (g: Group | "all") => (g === "all" ? all : all.filter((c) => c.group === g));
  const mastered = $derived(inGroup.filter((c) => c.mastered).length);
  const ownedOnly = $derived(inGroup.filter((c) => c.owned && !c.mastered).length);
  // Only what would still give mastery: a part set for something mastered is just spares.
  // Ready means everything in hand: parts with resources still to farm count apart.
  const buildable = $derived(inGroup.filter((c) => c.buildable && !c.mastered && (c.tier == null || c.tier === "now")).length);
  const partsReady = $derived(inGroup.filter((c) => c.buildable && !c.mastered && c.tier != null && c.tier !== "now").length);
  const building = $derived(inGroup.filter((c) => c.building).length);
  const groupLabel = $derived(group === "all" ? "items" : (GROUPS.find((g) => g.v === group)?.label.toLowerCase() ?? ""));

  function toggleFav(u: string) {
    settings.favourites = favs.has(u) ? settings.favourites.filter((x) => x !== u) : [u, ...settings.favourites];
  }
  const missing = (c: CollectionItem) => c.parts.filter((p) => !p.resource && p.have < p.required && !p.building).length;
</script>

<div class="page"><div class="page-inner">
  <PageHead title="Foundry" blurb="Everything you can master, with the parts you hold (gold: in hand). Click one for its stats, drops and prices.">
    {#snippet band()}
      <Stat label="Mastered" note={`of ${inGroup.length} ${groupLabel}`}><GameIcon name="mastery" size={30} />{mastered}<span class="of">/{inGroup.length}</span></Stat>
      <Stat label="Owned, not mastered" tone="gold" note="Level these">{ownedOnly}</Stat>
      <Stat label="Ready to build" note={partsReady ? `Everything in hand · ${partsReady} more with resources to farm` : "Every part and resource in hand, not mastered yet"}>{buildable}</Stat>
      <Stat label="Building" tone="dim" note="In your foundry now">{building}</Stat>
    {/snippet}
  </PageHead>

  <Tabs bind:value={group} label="Category" options={[{ v: "all", label: "All", count: all.length }, ...GROUPS.map((g) => ({ v: g.v, label: g.label, icon: ICON[g.v], count: count(g.v).length }))]} />

  <div class="bar">
    <Seg bind:value={show} options={[{ v: "all", label: "All", title: "Everything in this group" }, { v: "todo", label: "Not mastered", title: "What you still have to master" }, { v: "owned", label: "Owned", title: "What you have built (mastered or not)" }, { v: "build", label: "Can build", title: "Every part in hand, or building now" }, { v: "fav", label: `★ ${favs.size}`, title: "Your wishlist" }]} />
    <select bind:value={sort} aria-label="Sort" title="Sort the cards">
      <option value="name">By name</option>
      <option value="close">Closest to done</option>
      <option value="points">Most mastery</option>
      <option value="price">Set price</option>
    </select>
    <input type="search" placeholder="Filter items…" bind:value={q} />
    <span class="dim small grow right nowrap">{shown.length} {shown.length === 1 ? "item" : "items"}</span>
  </div>

  {#if shown.length}
    <CardGrid min="19rem">
      {#each shown.slice(0, limit) as c (c.unique)}
        <ItemCard
          hover={c.name}
          title={c.name}
          sub={`${c.type}${c.masteryReq ? ` · MR ${c.masteryReq}` : ""}`}
          image={c.image}
          owned={c.owned && !c.mastered}
          done={c.mastered}
          fav={favs.has(c.unique)}
          onfav={() => toggleFav(c.unique)}
          onopen={() => details.open(c.unique)}
        >
          <!-- Parts then resources in one row, wrapping together, so a resource sits beside the last part rather than under all of them. -->
          <div class="chips">
            {#each c.parts.filter((p) => !p.resource) as p, i (i)}<PartChip part={p} size={38} />{/each}
            {#each c.parts.filter((p) => p.resource) as p, i (i)}<span class="res"><PartChip part={p} size={28} /></span>{/each}
          </div>
          {#snippet foot()}
            {#if c.mastered}<span class="tag good">✓ Mastered</span>
            {:else if c.owned}<span class="tag ok">Owned · level it</span>
            {:else if c.building}<span class="tag">Building</span>
            {:else if c.buildable && c.tier === "hard"}<span class="tag bad" title="Every part in hand, but building needs {c.short.join(', ')}: from an open world or an event. Open it for what each part takes">Parts ready · needs {c.short[0]}{c.short.length > 1 ? ` +${c.short.length - 1}` : ""}</span>
            {:else if c.buildable && c.short.length}<span class="tag warn" title="Every part in hand; still to farm: {c.short.join(', ')}. Open it for what each part takes">Parts ready · farm {c.short[0]}{c.short.length > 1 ? ` +${c.short.length - 1}` : ""}</span>
            {:else if c.buildable}<span class="tag ok">Ready to build</span>
            {:else if c.parts.some((p) => !p.resource)}<span class="dim small">{missing(c)} part{missing(c) === 1 ? "" : "s"} missing</span>{/if}
            {#if c.resurgence}<Avail v="resurgence" />{:else if c.vaulted}<Avail v="vaulted" />{/if}
            <span class="grow"></span>
            {#if c.setPrice != null}<P v={Math.round(c.setPrice)} />{:else if !c.mastered}<span class="pts"><GameIcon name="mastery" size={12} />{c.points.toLocaleString("en")}</span>{/if}
          {/snippet}
        </ItemCard>
      {/each}
    </CardGrid>
    {#if shown.length > limit}<div class="more dim small" use:nearEnd={() => (limit += 48)}>{shown.length - limit} more below</div>{/if}
  {:else}
    <p class="nothing">Nothing here{q ? ` called “${q}”` : ""}.</p>
  {/if}
</div></div>

<style>
  .bar { padding-top: .9rem; }
  .right { text-align: right; }
  .chips { display: flex; flex-wrap: wrap; gap: .45rem; }
  .chips { align-items: center; row-gap: .7rem; }
  .chips .res { display: inline-flex; margin-left: .15rem; padding-bottom: 4px; }
  .pts { display: inline-flex; align-items: center; gap: .25rem; color: var(--platinum-dim); font-variant-numeric: tabular-nums; }
  .more { display: flex; justify-content: center; padding: 1.2rem 0; }
</style>
