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
  import Browse from "../ui/Browse.svelte";
  import Named from "../ui/Named.svelte";
  import type { Column } from "../ui/table";
  import ItemCard from "../ui/ItemCard.svelte";
  import PartChip from "../ui/PartChip.svelte";
  import GameIcon, { kindIcon, type GameIconName } from "../ui/GameIcon.svelte";
  import P from "../ui/P.svelte";

  let { model, settings = $bindable() }: { model: Model; settings: Settings } = $props();

  const all = $derived(collection(model));
  const ICON: Record<Group, GameIconName> = { warframes: "warframes", primary: "primary", secondary: "secondary", melee: "melee", companions: "companions", archwing: "archwing", other: "foundry" };

  let group = $state<Group | "all">("warframes");
  let show = $state<"all" | "todo" | "owned" | "build" | "fav">("all");
  let sort = $state({ key: "name", desc: false });
  let q = $state("");

  const favs = $derived(new Set(settings.favourites));
  const inGroup = $derived(group === "all" ? all : all.filter((c) => c.group === group));
  const shown = $derived.by(() => {
    const needle = q.trim().toLowerCase();
    // A search, and your wishlist (its count is every category's), look through every category.
    return (needle || show === "fav" ? all : inGroup).filter((c) => {
      if (needle && !c.name.toLowerCase().includes(needle)) return false;
      if (show === "todo") return !c.mastered && !c.unobtainable;
      if (show === "owned") return c.owned;
      if (show === "build") return c.buildable || c.building;
      if (show === "fav") return favs.has(c.unique);
      return true;
    });
  });
  const filtered = $derived(!!q.trim() || show !== "all");
  function clear() {
    q = "";
    show = "all";
  }
  /** The share of its parts you hold or are building. */
  const have = (c: CollectionItem) => {
    const pieces = c.parts.filter((p) => !p.resource);
    return pieces.length ? pieces.filter((p) => p.have >= p.required || p.building).length / pieces.length : 0;
  };
  const pieces = (c: CollectionItem) => c.parts.filter((p) => !p.resource).length;
  const columns: Column<CollectionItem>[] = [
    { key: "name", label: "Name", value: (c) => c.name, cell: nameCell, defaultDesc: false, width: "22rem" },
    { key: "type", label: "Type", value: (c) => c.type, muted: true, defaultDesc: false, minor: true },
    // Not mastered first, then what you own, then the most parts in hand.
    { key: "close", label: "Closest to done", value: (c) => (pieces(c) ? `${pieces(c) - missing(c)}/${pieces(c)} parts` : null), sortValue: (c) => (c.mastered ? -1 : (c.owned ? 2 : 0) + have(c)), align: "right", muted: true, title: "Parts in hand or building. Sorted: not mastered first, then what you own, then the most parts in hand" },
    { key: "points", label: "Mastery", value: (c) => c.points, sortValue: (c) => (c.mastered ? -1 : c.points), align: "right", cell: pointsCell, title: "The mastery points it gives. Sorted: not mastered first" },
    { key: "price", label: "Set price", value: (c) => (c.setPrice == null ? null : Math.round(c.setPrice)), align: "right", cell: priceCell, title: "What its set sold for lately on warframe.market" },
    { key: "mr", label: "MR", value: (c) => c.masteryReq || null, align: "right", muted: true, minor: true, title: "The Mastery Rank it needs" },
    { key: "state", label: "", value: () => null, cell: stateCell, sortable: false },
  ];
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

{#snippet nameCell(c: CollectionItem)}<Named file={c.image} name={c.name}>{#if favs.has(c.unique)}<span class="star" title="On your wishlist">★</span>{/if}</Named>{/snippet}
{#snippet pointsCell(c: CollectionItem)}<span class="pts" class:dim={c.mastered}><GameIcon name="mastery" size={12} />{c.points.toLocaleString("en")}</span>{/snippet}
{#snippet priceCell(c: CollectionItem)}{#if c.setPrice != null}<P v={Math.round(c.setPrice)} />{/if}{/snippet}
{#snippet stateCell(c: CollectionItem)}
  {#if c.mastered}<span class="tag good">✓ Mastered</span>
  {:else if c.owned}<span class="tag mastery">Owned · level it</span>
  {:else if c.building}<span class="tag">Building</span>
  {:else if c.buildable && c.tier === "hard"}<span class="tag bad" title="Every part in hand, but building needs {c.short.join(', ')}: from an open world or an event. Open it for what each part takes">Parts ready · needs {c.short[0]}{c.short.length > 1 ? ` +${c.short.length - 1}` : ""}</span>
  {:else if c.buildable && c.short.length}<span class="tag warn" title="Every part in hand; still to farm: {c.short.join(', ')}. Open it for what each part takes">Parts ready · farm {c.short[0]}{c.short.length > 1 ? ` +${c.short.length - 1}` : ""}</span>
  {:else if c.buildable}<span class="tag ok">Ready to build</span>
  {:else if c.parts.some((p) => !p.resource)}<span class="dim small">{missing(c)} part{missing(c) === 1 ? "" : "s"} missing</span>{/if}
  {#if c.resurgence}<Avail v="resurgence" />{:else if c.vaulted}<Avail v="vaulted" />{/if}
{/snippet}
{#snippet card(c: CollectionItem, open: () => void)}
  <ItemCard
    hover={c.name}
    title={c.name}
    sub={`${c.type}${c.masteryReq ? ` · MR ${c.masteryReq}` : ""}`}
    image={c.image}
    fallback={kindIcon(c.type, c.name)}
    owned={c.owned && !c.mastered}
    ownedNote="Not mastered: you own it, level it to master it"
    markPrime
    done={c.mastered}
    fav={favs.has(c.unique)}
    onfav={() => toggleFav(c.unique)}
    onopen={open}
  >
    <!-- Parts then resources in one row, wrapping together, so a resource sits beside the last part rather than under all of them. -->
    <div class="chips">
      {#each c.parts.filter((p) => !p.resource) as p, i (i)}<PartChip part={p} size={38} />{/each}
      <!-- Resources only when you're short of one: the 839 Orokin Cells you hold say nothing on a mastered frame. -->
      {#each c.parts.filter((p) => p.resource && !c.mastered && p.have < p.required) as p, i (i)}<span class="res"><PartChip part={p} size={28} /></span>{/each}
    </div>
    {#snippet foot()}
      {@render stateCell(c)}
      <span class="grow"></span>
      {#if c.setPrice != null}<P v={Math.round(c.setPrice)} />{:else if !c.mastered}<span class="pts" title="The mastery points it gives"><GameIcon name="mastery" size={12} />{c.points.toLocaleString("en")}</span>{/if}
    {/snippet}
  </ItemCard>
{/snippet}

<div class="page"><div class="page-inner">
  <PageHead title="Foundry" blurb="Everything you can master, with the parts you hold (gold: in hand). Click one for its stats, drops and prices.">
    {#snippet band()}
      <Stat label="Mastered" note={`of ${inGroup.length} ${groupLabel}`}><GameIcon name="mastery" size={30} />{mastered}<span class="of">/{inGroup.length}</span></Stat>
      <Stat label="Owned, not mastered" tone="gold" note="Level these">{ownedOnly}</Stat>
      <Stat label="Ready to build" note={partsReady ? `Everything in hand · ${partsReady} more with resources to farm` : "Every part and resource in hand, not mastered yet"}>{buildable}</Stat>
      <Stat label="Building" tone="dim" note="Whole items in your foundry now (parts, and what's ready to claim, are on Home)">{building}</Stat>
    {/snippet}
  </PageHead>

  <Tabs bind:value={group} label="Category" options={[{ v: "all", label: "All", count: all.length }, ...GROUPS.map((g) => ({ v: g.v, label: g.label, icon: ICON[g.v], count: count(g.v).length }))]} />

  <div class="bar">
    <input type="search" placeholder="Filter items…" bind:value={q} aria-label="Filter items by name" title="Looks through every category" />
    <Seg label="Show" bind:value={show} options={[{ v: "all", label: "All", title: "Everything in this group" }, { v: "todo", label: "Not mastered", title: "What you still have to master" }, { v: "owned", label: "Owned", title: "What you have built (mastered or not)" }, { v: "build", label: "Can build", title: "Every part in hand, or building now" }, ...(favs.size || show === "fav" ? [{ v: "fav" as const, label: `★ Wishlist ${favs.size}`, title: "What you starred, from every category (star a card to add it)" }] : [])]} />
  </div>

  <Browse id="foundry" rows={shown} {columns} key={(c) => c.unique} bind:sort {card} title={(c) => c.name} onopen={(c) => details.open(c.unique)} min="19rem" clear={filtered ? clear : null} empty="Nothing here." />
</div></div>

<style>
  .bar { padding-top: .9rem; }
  .chips { display: flex; flex-wrap: wrap; gap: .45rem; }
  .chips { align-items: center; row-gap: .7rem; }
  .chips .res { display: inline-flex; margin-left: .15rem; padding-bottom: 4px; }
  .pts { display: inline-flex; align-items: center; gap: .25rem; color: var(--platinum-dim); font-variant-numeric: tabular-nums; }
  .star { margin-left: .4rem; color: var(--gold); }
</style>
