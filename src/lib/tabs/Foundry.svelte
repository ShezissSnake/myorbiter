<script lang="ts">
  // Every warframe, weapon, companion and archwing as a card: its artwork, each part as a chip
  // (gold when you have it), and whether you own it, have mastered it, or can build it now.
  // A click opens everything about it.
  import Avail from "../ui/Avail.svelte";
  import type { Model } from "../core/model";
  import type { Settings } from "../backend";
  import { collection, GROUPS, type CollectionItem, type Group } from "../core/collection";
  import { details } from "../details.svelte";
  import { foundryBuilds } from "../core/foundry";
  import { describe } from "../core/describe";
  import { until } from "../core/traders";
  import Thumb from "../ui/Thumb.svelte";
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
  import CodexRings from "../ui/CodexRings.svelte";
  import { codexRings } from "../core/codex";

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
  const groupLabel = $derived(group === "all" ? "items" : (GROUPS.find((g) => g.v === group)?.label.toLowerCase() ?? ""));

  function toggleFav(u: string) {
    settings.favourites = favs.has(u) ? settings.favourites.filter((x) => x !== u) : [u, ...settings.favourites];
  }
  // What's in your foundry now (as Home shows it), so this page and Home tell the same story.
  let now = $state(Date.now());
  $effect(() => {
    const t = setInterval(() => (now = Date.now()), 60_000);
    return () => clearInterval(t);
  });
  const builds = $derived(foundryBuilds(model, settings.game.foundryReady, now));
  const readyToClaim = $derived(builds.filter((b) => b.ready).length);
  const gearOf = (name: string) => {
    const d = describe(model, name);
    return d?.kind === "gear" ? d.item.uniqueName : null;
  };
  const rings = $derived(codexRings(model));
  // What to do next in the category you're in: claim, build, then level.
  const nextLine = $derived(
    [
      readyToClaim ? `${readyToClaim} ready to claim in your foundry` : "",
      buildable ? `${buildable} ${groupLabel} ready to build` : "",
      ownedOnly ? `${ownedOnly} owned to level` : "",
    ].filter(Boolean).join(" · ") || (inGroup.length && mastered === inGroup.length ? `Every one of the ${groupLabel} mastered` : `Nothing to build or level here: the cards show what each still needs`),
  );
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
  <PageHead title="Foundry" brief="Everything you can master, part by part." blurb="Everything you can master, with the parts you hold (gold: in hand). Click one for its stats, drops and prices.">
    {#snippet band()}
      <Stat label="Mastered" note={`of ${inGroup.length} ${groupLabel}`}><GameIcon name="mastery" size={30} />{mastered}<span class="of">/{inGroup.length}</span></Stat>
      <Stat label="Owned, not mastered" tone="gold" note={group === "all" ? "Level these" : `Level these · ${groupLabel}`}>{ownedOnly}</Stat>
      <Stat label="Ready to build" note={`${partsReady ? `Everything in hand · ${partsReady} more with resources to farm` : "Every part and resource in hand, not mastered yet"}${group === "all" ? "" : ` · ${groupLabel}`}`}>{buildable}</Stat>
      <Stat label="In your foundry" tone={readyToClaim ? "gold" : "dim"} note={readyToClaim ? `${readyToClaim} ready to claim` : builds.length ? "Nothing ready yet" : "Nothing building"}>{builds.length}</Stat>
    {/snippet}
    {#snippet hero()}<CodexRings {rings} lit={group === "all" ? null : group} onpick={(g) => (group = group === g ? "all" : g)} action={(r) => (group === r.group ? "Click to show every category" : `Click to show only ${r.label.toLowerCase()}`)} line={nextLine} />{/snippet}
  </PageHead>

  {#if builds.length}
    <!-- The foundry itself: what's building and what's ready to claim, soonest first. -->
    <ul class="queue" aria-label="In your foundry">
      {#each builds as b (b.key)}
        {@const u = gearOf(b.name)}
        <li class:ready={b.ready}>
          <button type="button" class="qb" disabled={!u} title={u ? `${b.name}: details` : b.name} onclick={() => u && details.open(u)}>
            <Thumb file={b.image} size={24} name={b.name} />
            <span class="qn">{b.name}</span>
            <span class="qw">{b.ready ? "Ready" : until(new Date(b.readyAt).toISOString(), now)}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}

  <Tabs bind:value={group} label="Category" options={[{ v: "all", label: "All", count: all.length }, ...GROUPS.map((g) => ({ v: g.v, label: g.label, icon: ICON[g.v], count: count(g.v).length }))]} />

  <div class="bar">
    <input type="search" placeholder="Filter items…" bind:value={q} aria-label="Filter items by name" title="Looks through every category" />
    <Seg label="Show" bind:value={show} options={[{ v: "all", label: "All", title: "Everything in this group" }, { v: "todo", label: "Not mastered", title: "What you still have to master" }, { v: "owned", label: "Owned", title: "What you have built (mastered or not)" }, { v: "build", label: "Can build", title: "Every part in hand, or building now" }, ...(favs.size || show === "fav" ? [{ v: "fav" as const, label: `★ Wishlist ${favs.size}`, title: "What you starred, from every category (star a card to add it)" }] : [])]} />
  </div>

  <Browse id="foundry" rows={shown} {columns} key={(c) => c.unique} bind:sort {card} title={(c) => c.name} onopen={(c) => details.open(c.unique)} min="19rem" clear={filtered ? clear : null} empty="Nothing here." />
</div></div>

<style>
  .queue { list-style: none; margin: 0 0 var(--step); padding: 0; display: flex; flex-wrap: wrap; gap: .5rem; }
  .qb { all: unset; box-sizing: border-box; display: inline-flex; align-items: center; gap: .5rem; padding: .3rem .7rem .3rem .35rem; border: 1px solid var(--rule); background: var(--plate); cursor: pointer; font-size: .84rem; }
  .qb:disabled { cursor: default; }
  .qb:not(:disabled):hover { border-color: var(--gold-dim); }
  .qb:focus-visible { outline: 2px solid var(--gold); outline-offset: 2px; }
  .qn { color: var(--platinum); }
  .qw { color: var(--platinum-deep); font-size: .76rem; }
  .ready .qb { border-color: color-mix(in srgb, var(--verdigris) 55%, transparent); }
  .ready .qw { color: var(--verdigris); font-weight: 600; }
  .bar { padding-top: .9rem; }
  .chips { display: flex; flex-wrap: wrap; gap: .45rem; }
  .chips { align-items: center; row-gap: .7rem; }
  .chips .res { display: inline-flex; margin-left: .15rem; padding-bottom: 4px; }
  .pts { display: inline-flex; align-items: center; gap: .25rem; color: var(--platinum-dim); font-variant-numeric: tabular-nums; }
  .star { margin-left: .4rem; color: var(--gold); }
</style>
