<script lang="ts">
  import HelpMark from "../ui/HelpMark.svelte";
  import Count from "../ui/Count.svelte";
  import PTick from "../ui/PTick.svelte";
  import Fold from "../ui/Fold.svelte";
  import Tabs from "../ui/Tabs.svelte";
  import { takeIntent } from "../intent.svelte";
  import type { Model } from "../core/model";
  import { arcaneRows, type ArcaneRow } from "../core/views";
  import UpgradeDetail from "../ui/UpgradeDetail.svelte";
  import Browse from "../ui/Browse.svelte";
  import ItemCard from "../ui/ItemCard.svelte";
  import ModCard from "../ui/ModCard.svelte";
  import { mkt } from "../marketStore.svelte";
  import P from "../ui/P.svelte";
  import Named from "../ui/Named.svelte";
  import Seg from "../ui/Seg.svelte";
  import Stat from "../ui/Stat.svelte";
  import PageHead from "../ui/PageHead.svelte";
  import { matches, type Column } from "../ui/table";
  import ListButton from "../ui/ListButton.svelte";
  import GameIcon from "../ui/GameIcon.svelte";
  import Thumb from "../ui/Thumb.svelte";
  import type { AdviceSettings } from "../backend";
  import { collections, packValues, spareArcanes, vosforHeld, vosforWorth, type SpareArcane } from "../core/vosfor";
  import { info } from "../hover.svelte";
  import { arcanesWorthSelling, worthTotal } from "../core/worthSelling";
  import Showcase, { type Exhibit } from "../ui/Showcase.svelte";
  import { pickShowcase } from "../core/showcase";
  import { whileShown } from "../pane.svelte";
  import { typed } from "../typed.svelte";
  import Segments from "../ui/Segments.svelte";

  let { model, advice = $bindable() }: { model: Model; advice: AdviceSettings } = $props();
  /** Your copies of an arcane by rank. */
  const ranksOf = (r: ArcaneRow) => {
    const by = new Map<number, number>();
    for (const x of model.inventoryByBase.get(r.unique) ?? []) by.set(x.rank ?? 0, (by.get(x.rank ?? 0) ?? 0) + x.quantity);
    return [...by].map(([rank, count]) => ({ rank, count }));
  };


  let query = $state("");


  /** What the list is filtered on: the box, a moment later while you type (typed.svelte.ts). */


  const q = $derived.by(typed(() => query));
  /** Unfinished: still collecting. Spares: copies beyond the one you keep, to sell or dissolve. */
  let show = $state<"unfinished" | "spares" | "all">("unfinished");
  let owned = $state<"all" | "owned" | "unowned">("all");
  let type = $state("all");
  /** Loid's collection an arcane comes from ("Eidolon", "Duviri"…); "none" for arcanes in no pack. */
  let collection = $state("all");
  // Owned only filters outside Sell or dissolve, where it's shown.
  const filtered = $derived(!!q.trim() || type !== "all" || collection !== "all" || (show !== "spares" && owned !== "all"));
  function clear() {
    query = "";
    type = "all";
    collection = "all";
    owned = "all";
  }
  // Ctrl+K asked for one arcane: every arcane, searched for it.
  $effect(() => {
    const want = takeIntent("arcanes");
    if (!want?.q) return;
    query = want.q;
    show = "all";
    owned = "all";
    type = "all";
    collection = "all";
  });
  const inCollection = (name: string) =>
    collection === "all" || (collection === "none" ? !collections().some((c) => c.arcanes.has(name)) : !!collections().find((c) => c.name === collection)?.arcanes.has(name));
  let sort = $state({ key: "priceMax", desc: true });

  const all = $derived.by(whileShown("arcanes", () => arcaneRows(model)));
  const types = $derived([...new Set(all.map((r) => r.type))].sort());
  const rows = $derived(
    all.filter(
      (r) =>
        (show === "all" || !r.complete) &&
        (owned === "all" || (owned === "owned") === r.copies > 0) &&
        (type === "all" || r.type === type) &&
        inCollection(r.name) &&
        matches(q, r.name, r.type),
    ),
  );
  const completeCount = $derived(all.filter((r) => r.complete).length);
  /** Loose unranked copies you can sell without touching the one you max. */
  const looseSpare = (r: ArcaneRow) => Math.min(r.unranked, r.spare);
  /** Loose copies left once the extra maxed ones are fused. */
  const leftover = (r: ArcaneRow) => Math.max(0, looseSpare(r) - r.toFuse * r.needed);
  const fuseHint = (r: ArcaneRow) => (r.toFuse ? `Fuse ${r.toFuse} more to R${r.maxRank} in game before you trade (${r.needed} copies each)` : null);

  // ---------------------------------------------------------------- sell or dissolve
  const lens = $derived(advice.vosforLens ?? "need");
  const packs = $derived.by(whileShown("arcanes", () => packValues(model, all)));
  const worth = $derived(vosforWorth(packs, lens));
  const spares = $derived.by(whileShown("arcanes", () => spareArcanes(model, all, worth.perVosfor, { lens, minPrice: advice.minPlat })));
  const spareRows = $derived(spares.filter((x) => matches(q, x.row.name, x.row.type) && (type === "all" || x.row.type === type) && inCollection(x.row.name)));
  const toSell = $derived(spares.filter((x) => x.verdict === "sell"));
  // Worth selling, counted as Prime parts, Mods and Home's Ready to list count it
  // (core/worthSelling.ts): the ones marked Sell, no more of each than the market sells in a month.
  const sellWorth = $derived(worthTotal(arcanesWorthSelling(spares)));
  // The showcase: the five arcanes worth most in Worth selling (maxed and loose copies together), as
  // their sigils; with none to sell, the dearest arcanes you hold. A click opens it under Sell or
  // dissolve (or, held, under All arcanes).
  let opened = $state<ArcaneRow | null>(null);
  let spareOpened = $state<SpareArcane | null>(null);
  const sellingBy = $derived.by(() => {
    const out = new Map<string, { plat: number; copies: number }>();
    for (const x of arcanesWorthSelling(spares)) {
      const g = out.get(x.name) ?? { plat: 0, copies: 0 };
      g.plat += x.plat;
      g.copies += x.copies;
      out.set(x.name, g);
    }
    return out;
  });
  const shelf = $derived(pickShowcase(all, { spare: (r) => sellingBy.get(r.name)?.plat, held: (r) => (r.copies > 0 ? (r.priceMax ?? r.price) : null), name: (r) => r.name, key: (r) => r.unique }));
  function openShelf(r: ArcaneRow) {
    const x = spares.find((y) => y.row.unique === r.unique);
    if (x && shelf.mode === "spares") {
      show = "spares";
      spareOpened = x;
    } else {
      if (show === "spares") show = "all";
      opened = r;
    }
  }
  const exhibits = $derived(
    shelf.items.map(({ row: r, value }): Exhibit => {
      const w = sellingBy.get(r.name);
      return {
        key: r.unique,
        name: r.name,
        sub: w ? `×${w.copies} to sell` : `×${r.copies} held · ${r.priceMax != null ? `R${r.maxRank}, each` : "each"}`,
        value: Math.round(value),
        title: w ? `${r.name}: ${w.copies} marked Sell, ${Math.round(value).toLocaleString("en")}p in all (maxed copies at the max-rank price, loose ones at their share; no more than the market sells in a month: its part of Worth selling). Click for its details` : `${r.name}: ${Math.round(value)}p each${r.priceMax != null ? ` at R${r.maxRank}` : ""}, ${r.copies} held. Click for its details`,
        open: () => openShelf(r),
        image: model.imageOf(r.name),
        look: "arcane",
        card: { rarity: r.rarity, maxRank: r.maxRank, rank: r.highestRank ?? 0 },
      };
    }),
  );
  const toDissolve = $derived(spares.filter((x) => x.verdict === "dissolve"));
  const held = $derived(vosforHeld(model));
  const gain = $derived(toDissolve.reduce((n, x) => n + (x.vosfor ?? 0), 0));
  const rankedPacks = $derived([...packs].sort((a, b) => (lens === "need" ? b.needPlat - a.needPlat || b.needCopies - a.needCopies : b.plat - a.plat)));
  const short = (pack: string) => pack.replace(/ Arcane Collection$/, "");
  /** The usual reasons go without saying on every row; the hover still has them. */
  const PLAIN = new Set(["Sells for more than its Vosfor is worth", "Worth more as packs toward arcanes you're collecting", "Worth more as Vosfor packs"]);
  let spareSort = $state({ key: "best", desc: true });
  const spareColumns: Column<SpareArcane>[] = [
    { key: "name", label: "Arcane", value: (x) => x.row.name, defaultDesc: false, cell: spareName },
    { key: "have", label: "Spare", value: (x) => x.maxed * 1000 + x.unranked, cell: spareHave, align: "right", title: "Maxed copies beyond the one you keep, and loose unranked copies" },
    { key: "sell", label: "Sell for", value: (x) => x.sellPlat, cell: sellCell, align: "right", title: "Priced as maxed arcanes: maxed copies at the max-rank price, loose ones at their share of one (a maxed arcane is 21 copies, 10 for one that maxes at R3) or their own price, whichever is less" },
    { key: "vosfor", label: "Dissolve for", value: (x) => x.vosfor, cell: vosforCell, align: "right", title: "Vosfor from Loid's Arcane Dissolution, and what it's worth through the best pack" },
    { key: "best", label: "Best as", value: (x) => x.verdict, sortValue: (x) => (x.verdict === "sell" ? (x.sellPlat ?? 0) : (x.dissolvePlat ?? 0)), cell: verdictCell },
    { key: "trades", minor: true, label: "Sold/day", value: (x) => (x.row.tradesPerDay == null ? null : Math.round(x.row.tradesPerDay * 10) / 10), align: "right", muted: true },
    { key: "list", label: "", value: () => null, cell: spareList, sortable: false, align: "right" },
  ];

  /** Beside the copies bar on a card: how far along your best copy is, or what's beyond the one you keep. */
  const note = (r: ArcaneRow) => (r.complete ? (r.extraSets ? `+${r.extraSets} extra R${r.maxRank}${r.toFuse ? ` (${r.toFuse} to fuse)` : ""}` : "") : r.highestRank ? `best copy R${r.highestRank}` : "");



  // Spare only has numbers for arcanes you've finished, so they show with those.
  const columns: Column<ArcaneRow>[] = $derived(([
    { key: "name", label: "Arcane", value: (r) => r.name, defaultDesc: false, cell: nameCell },
    // All arcanes needs the room for Spare and List; the slot filter and the hover card still say it.
    ...(show === "all" ? [] : [{ key: "type", minor: true, label: "Slot", value: (r: ArcaneRow) => r.type, muted: true, defaultDesc: false }] as Column<ArcaneRow>[]),
    { key: "progress", label: "Collection", value: (r) => r.copies / r.needed, cell: progressCell, title: "Rank-0 copies you hold (fused ones counted at what they cost) out of what a maxed one needs" },
    { key: "price", minor: true, label: "R0 price", title: "Price of an unranked copy", value: (r) => r.price, align: "right", cell: priceCell },
    { key: "priceMax", label: "Max price", value: (r) => r.priceMax, align: "right", cell: maxCell },
    { key: "cost", label: "To finish", value: (r) => (r.complete ? null : r.costToFinish), align: "right", cell: costCell, defaultDesc: false, title: "Cheapest of buying the missing copies or one maxed copy" },
    ...(show !== "all" ? [] : [{ key: "spare", label: "Spare", value: (r: ArcaneRow) => r.extraSets * 1000 + leftover(r) || null, cell: rowSpare, align: "right", title: "Maxed copies beyond the one you keep, and loose unranked copies beyond what it needs" }] as Column<ArcaneRow>[]),
    { key: "trades", minor: true, label: "Sold/day", value: (r) => (r.tradesPerDay == null ? null : Math.round(r.tradesPerDay * 10) / 10), align: "right", muted: true, title: "Demand on warframe.market" },
    // Still collecting has nothing spare, so nothing to list.
    ...(show !== "all" ? [] : [{ key: "list", label: "", value: () => null, cell: listCell, sortable: false, align: "right" }] as Column<ArcaneRow>[]),
  ] as Column<ArcaneRow>[]));
  /** How the sale price adds up, for its tooltip. */
  const sellWhy = (x: SpareArcane) =>
    [x.maxed ? `${x.maxed} maxed at ${x.row.priceMax ?? "?"}p` : "", x.unranked ? `${x.unranked} loose at ${x.each == null ? "?" : Math.round(x.each * 10) / 10}p each (${x.row.price != null ? `the lower of its own ${x.row.price}p and ` : ""}1/${x.row.needed} of a maxed one)` : ""].filter(Boolean).join(" + ");
  const things = (n: number, one = "thing", many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
</script>

{#snippet progressCell(r: ArcaneRow)}
  <div class="prog" title="{r.copies} / {r.needed}{r.highestRank != null ? ` · best copy R${r.highestRank}` : ''}">
    <Segments key="arcane:{r.name}" value={Math.min(r.copies, r.needed)} max={r.needed} fill label="{r.copies} of {r.needed} copies to max" />
    <span class="dim small">{r.complete && r.copies <= r.needed ? "maxed" : `${r.copies}/${r.needed}`}</span>
  </div>
{/snippet}
{#snippet listCell(r: ArcaneRow, labelled = false)}
  {#if r.tradable && r.extraSets > 0}
    <ListButton {model} {labelled} name={r.name} label="Sell {r.extraSets}× R{r.maxRank}" req={{ unique: r.unique, rank: r.maxRank, quantity: r.extraSets }} hint={fuseHint(r)} />
  {:else if r.tradable && looseSpare(r) > 0}
    <ListButton {model} {labelled} name={r.name} req={{ unique: r.unique, rank: 0, quantity: looseSpare(r) }} />
  {/if}
{/snippet}
{#snippet nameCell(r: ArcaneRow)}<Named file={model.imageOf(r.name)} name={r.name} />{/snippet}
{#snippet priceCell(r: ArcaneRow)}<P v={r.price} dim />{/snippet}
{#snippet maxCell(r: ArcaneRow)}<P v={r.priceMax} />{/snippet}
{#snippet costCell(r: ArcaneRow)}{#if !r.complete}<P v={r.costToFinish} />{/if}{/snippet}
{#snippet spareName(x: SpareArcane)}<Named file={model.imageOf(x.row.name)} name={x.row.name} />{/snippet}
{#snippet rowSpare(r: ArcaneRow)}
  {#if r.extraSets || leftover(r)}<span class="have" title="{r.extraSets ? `${r.extraSets} maxed${r.toFuse ? ` (${r.toFuse} still to fuse)` : ''}` : ''}{r.extraSets && leftover(r) ? ' and ' : ''}{leftover(r) ? `${leftover(r)} unranked` : ''} beyond the one you keep">{#if r.extraSets}<b>{r.extraSets}</b> <span class="dim small">R{r.maxRank}</span>{/if}{#if r.extraSets && leftover(r)}<span class="dim">&nbsp;·&nbsp;</span>{/if}{#if leftover(r)}<b>{leftover(r)}</b> <span class="dim small">R0</span>{/if}</span>{:else}<span class="nil" aria-label="none">–</span>{/if}
{/snippet}
{#snippet spareHave(x: SpareArcane)}
  <span class="have" title={fuseHint(x.row) ?? undefined}>{#if x.maxed}<b>{x.maxed}</b> <span class="dim small">maxed{x.row.toFuse ? `, ${x.row.toFuse} to fuse` : ""}</span>{/if}{#if x.maxed && x.unranked}<span class="dim">&nbsp;·&nbsp;</span>{/if}{#if x.unranked}<b>{x.unranked}</b> <span class="dim small">unranked</span>{/if}</span>
{/snippet}
{#snippet sellCell(x: SpareArcane)}<span title={sellWhy(x)}><P v={x.sellPlat == null ? null : Math.round(x.sellPlat)} dim={x.verdict !== "sell"} /></span>{/snippet}
{#snippet vosforCell(x: SpareArcane)}
  {#if x.vosfor == null}<span class="dim small">can't</span>
  {:else}<span class="vf" class:dim={x.verdict !== "dissolve"}><b>{x.vosfor.toLocaleString("en")}</b><GameIcon name="vosfor" size={14} /><span class="dim small">≈ {Math.round(x.dissolvePlat ?? 0)}p</span></span>{/if}
{/snippet}
{#snippet verdictCell(x: SpareArcane)}<span class="vc" title={x.why}><span class="verdict v-{x.verdict}">{x.verdict === "sell" ? "Sell" : "Dissolve"}</span>{#if !PLAIN.has(x.why)}<span class="why">{x.why}</span>{/if}</span>{/snippet}
{#snippet spareList(x: SpareArcane)}
  {#if x.verdict === "sell" && x.row.tradable && x.maxed > 0}
    <ListButton {model} name={x.row.name} label="Sell {x.maxed}× R{x.row.maxRank}" req={{ unique: x.row.unique, rank: x.row.maxRank, quantity: x.maxed }} hint={fuseHint(x.row)} />
  {:else if x.verdict === "sell" && x.row.tradable && x.unranked > 0}
    <ListButton {model} name={x.row.name} req={{ unique: x.row.unique, rank: 0, quantity: x.unranked }} />
  {/if}
{/snippet}

{#snippet arcaneCard(r: ArcaneRow)}
  <ModCard arcane name={r.name} image={model.imageOf(r.name)} rarity={r.rarity} maxRank={r.maxRank} rank={r.highestRank ?? 0} width={96} />
{/snippet}
{#snippet card(r: ArcaneRow, open: () => void)}
  <ItemCard hover={r.name} title={r.name} sub={r.type} image={model.imageOf(r.name)} owned={r.complete} ownedNote={r.maxedCopies ? "Maxed" : "Enough copies to max it"} onopen={open}>
    {#snippet art()}{@render arcaneCard(r)}{/snippet}
    <div class="coll">
      <div class="ch"><span class="register">Copies</span>{#if note(r)}<span class="register note">{note(r)}</span>{/if}</div>
      {@render progressCell(r)}
    </div>
    <div class="prices">
      <span><span class="register">R0</span><P v={r.price} dim /></span>
      <span><span class="register">R{r.maxRank}</span><P v={r.priceMax} /></span>
      {#if !r.complete && r.costToFinish != null}<span title="Cheapest of buying the missing copies or one maxed copy"><span class="register">To finish</span><P v={r.costToFinish} /></span>{/if}
    </div>
    {#snippet foot()}
      {#if r.tradesPerDay != null}<span class="dim small" title="How many times a day it trades on warframe.market">{Math.round(r.tradesPerDay * 10) / 10} sold/day</span>{/if}
      <span class="grow"></span>
      {@render listCell(r, true)}
    {/snippet}
  </ItemCard>
{/snippet}
{#snippet spareCard(x: SpareArcane, open: () => void)}
  <ItemCard hover={x.row.name} title={x.row.name} sub={x.row.type} image={model.imageOf(x.row.name)} owned={x.verdict === "sell"} ownedNote="Worth more sold than dissolved: sell it" onopen={open}>
    {#snippet art()}{@render arcaneCard(x.row)}{/snippet}
    {@render spareHave(x)}
    <div class="choice">
      <span class:win={x.verdict === "sell"}><span class="register">Sell</span>{@render sellCell(x)}</span>
      <span class:win={x.verdict === "dissolve"}><span class="register">Dissolve</span>{@render vosforCell(x)}</span>
    </div>
    {#if !PLAIN.has(x.why)}<p class="why small">{x.why}</p>{/if}
    {#snippet foot()}
      <span class="verdict v-{x.verdict}" title={x.why}>{x.verdict === "sell" ? "Sell" : "Dissolve at Loid"}</span>
      <span class="grow"></span>
      {@render spareList(x)}
    {/snippet}
  </ItemCard>
{/snippet}

{#snippet spareDetail(x: SpareArcane)}
  <UpgradeDetail {model} name={x.row.name} unique={x.row.unique} ranks={ranksOf(x.row)} tradable={x.row.tradable}>
    <p class="small"><b class="verdict v-{x.verdict}">{x.verdict === "sell" ? "Sell" : "Dissolve at Loid"}</b> <span class="dim">· {x.why}</span></p>
    <p class="small dim">Sold as maxed arcanes: {x.sellPlat == null ? "no price" : `about ${Math.round(x.sellPlat)}p`} ({sellWhy(x)}).{#if x.vosfor != null} Dissolved: {x.vosfor.toLocaleString("en")} Vosfor, about {Math.round(x.dissolvePlat ?? 0)}p through the best pack.{/if}</p>
    <div class="actions">{@render spareList(x)}</div>
  </UpgradeDetail>
{/snippet}

{#snippet detail(r: ArcaneRow)}
  <UpgradeDetail {model} name={r.name} unique={r.unique} ranks={ranksOf(r)} tradable={r.tradable}>
    <p class="small dim">{r.complete ? "Maxed, or enough copies to max it" : `${r.copies} of ${r.needed} copies to max it`}{r.maxedCopies ? ` · ${r.maxedCopies} maxed` : ""}</p>
    {#if r.tradable && r.extraSets > 0 && leftover(r) > 0}<div><button class="stamp" title="Sell on warframe.market the unranked copies left over beyond the ones that make up maxed arcanes" onclick={(e) => { e.stopPropagation(); mkt.startListing(model, r.name, { unique: r.unique, rank: 0, quantity: leftover(r) }); }}>Sell {leftover(r)} unranked</button></div>{/if}
  </UpgradeDetail>
{/snippet}

<div class="page"><div class="page-inner">
  <PageHead help={{ band: "arcanes.band", hero: "arcanes.showcase" }} title="Arcanes" brief="Arcanes by worth, and how close to maxed." blurb="What each arcane is worth, and how close you are to maxing it.">
    {#snippet hero()}
      <Showcase items={exhibits} caption={shelf.mode === "held" ? "Nothing marked Sell: your dearest arcanes" : "Your most valuable arcanes to sell"} note={shelf.mode === "held" ? "Each, at the daily median · click one for its details" : "By Worth selling · click one for its details"} empty="No arcanes read yet: press Sync while Warframe is running, and they go on display here." />
    {/snippet}
    {#snippet band()}
      <Stat label="Maxed" note="Arcanes at max rank, or with enough copies to max one"><Count value={completeCount} /><span class="of">/{all.length}</span></Stat>
      <Stat label="Worth selling" note={`${things(toSell.length, "arcane")} marked Sell · no more of each than sells in a month`} title="Worth selling: the spare arcanes marked Sell (not the ones worth more dissolved, or under a trade's worth), maxed copies at the max-rank price and loose ones at their share of one, no more of each than the market sells in a month. Counted the same way on Prime parts, Mods and Home"><PTick v={sellWorth} /></Stat>
      <Stat label="Vosfor held" note={gain ? `+${gain.toLocaleString("en")} from the ${toDissolve.length} marked Dissolve` : "Nothing marked Dissolve"}><GameIcon name="vosfor" size={30} /><Count value={held} /></Stat>
    {/snippet}
  </PageHead>

  <!-- The page's modes as tabs (they change the whole page), the filters under them. -->
  <div class="modes"><Tabs bind:value={show} label="Arcanes view" options={[
    { v: "unfinished", label: "Still collecting", title: "Arcanes you haven't maxed (or got enough copies to max)" },
    { v: "spares", label: "Sell or dissolve", title: "Copies beyond the one you keep: sell them, or dissolve them for Vosfor" },
    { v: "all", label: "All arcanes", title: "Every arcane, held or not" },
  ]} /></div>
  <!-- Loid's packs above the filters, so the filters and the sort row under them stay together. -->
  {#if show === "spares"}
  <section class="vosfor">
    <header>
      <span class="register"><GameIcon name="vosfor" size={18} /> Loid's arcane packs · 200 Vosfor each</span>
      <Seg label="Value Vosfor by" bind:value={advice.vosforLens} options={[
        { v: "need", label: "Arcanes I'm collecting", title: "A pack is worth the arcanes in it you haven't finished, each copy at its own price or its share of a maxed one, whichever is less" },
        { v: "market", label: "Market price", title: "A pack is worth its three arcanes, each copy at its own price or its share of a maxed one, whichever is less; arcanes trading under 5 a day count as nothing" },
      ]} />
      <HelpMark part="arcanes.packs" />
    </header>
    <p class="small dim">You hold <b>{held.toLocaleString("en")}</b> Vosfor{gain ? `, ${(held + gain).toLocaleString("en")} after dissolving what's marked Dissolve` : ""}: {Math.floor((held + gain) / 200)} pack{Math.floor((held + gain) / 200) === 1 ? "" : "s"}. Best pack {lens === "need" ? "for what you're collecting" : "by market value"}: <b>{worth.best ? short(worth.best.name) : "none"}</b>, about {worth.perVosfor ? (worth.perVosfor * 200).toFixed(0) : 0}p a pack.</p>
    <p class="small dim" title="The wiki lists Vosfor per unranked arcane and doesn't say how rank changes it">A ranked copy is counted as the copies it's made of (a maxed one is 21, or 10 for arcanes that max at R3). Loid shows the exact Vosfor before you confirm a dissolution.</p>
    <div class="packs">
      {#each rankedPacks as p (p.name)}
        <div class="pack" class:best={p === worth.best}>
          <div class="ph"><b class="mark">{short(p.name)}</b>{#if lens === "market"}<span class="dim small" title="Its three arcanes, each copy at its own price or its share of a maxed one, whichever is less; arcanes trading under 5 a day count as nothing">≈ {Math.round(p.plat)}p / pack</span>{:else if p.needCopies}<span class="dim small" title="On average {p.needCopies.toFixed(1)} of a pack's three arcanes are ones you're still collecting, worth each copy's own price or its share of a maxed one, whichever is less">{p.needPlat < 0.5 ? "under 1p" : `≈ ${Math.round(p.needPlat)}p`} / pack</span>{/if}</div>
          {#if p.wanted.length}
            <div class="wanted">{#each p.wanted.slice(0, 4) as w (w.name)}<span use:info={w.name}><Thumb file={model.imageOf(w.name)} size={18} />{w.name}</span>{/each}{#if p.wanted.length > 4}<span class="dim small" title={p.wanted.slice(4).map((w) => w.name).join(", ")}>+{p.wanted.length - 4}</span>{/if}</div>
          {:else}<span class="dim small">Nothing you still need</span>{/if}
        </div>
      {/each}
    </div>
  </section>
  {/if}
  {#snippet filters()}
  <input type="search" aria-label="Filter arcanes by name" title="Shows only what matches what you type" placeholder="Filter arcanes…" bind:value={query} />
  <select bind:value={type} aria-label="Slot" title="What it goes on">
    <option value="all">All slots</option>
    {#each types as t (t)}<option value={t}>{t}</option>{/each}
  </select>
  <Fold active={(show !== "spares" && owned !== "all" ? 1 : 0) + (collection !== "all" ? 1 : 0)} reset={() => { owned = "all"; collection = "all"; }}>
  {#if show !== "spares"}<Seg bind:value={owned} options={[{ v: "all", label: "All", title: "Held or not" }, { v: "owned", label: "Started", title: "Arcanes you hold at least one copy of" }, { v: "unowned", label: "None yet", title: "Arcanes you don't have a copy of" }]} />{/if}
  <select bind:value={collection} aria-label="Collection" title="The collection at Loid whose packs hold it">
    <option value="all">All collections</option>
    {#each collections() as c (c.name)}<option value={c.name}>{c.name}</option>{/each}
    <option value="none">In no collection</option>
  </select>
  </Fold>
  <HelpMark part="arcanes.filters" />
  {/snippet}

  {#if show === "spares"}
    <Browse {filters} id="arcane-spares" bind:opened={spareOpened} rows={spareRows} columns={spareColumns} key={(x) => x.row.unique} bind:sort={spareSort} detail={spareDetail} card={spareCard} title={(x) => x.row.name} min="18rem" clear={filtered ? clear : null} empty="No spare arcanes: you keep one of each and have nothing extra." />
  {:else}
    <Browse {filters} id="arcanes" bind:opened {rows} {columns} key={(r) => r.unique} bind:sort {detail} {card} title={(r) => r.name} min="18rem" clear={filtered ? clear : null} empty={show === "unfinished" ? "Every arcane maxed: nothing left to collect." : "No arcanes."} />
  {/if}
</div></div>

<style>
  .have { white-space: nowrap; }
  .have b { font-family: var(--face-mark); font-size: 1rem; }
  .coll { display: grid; gap: .3rem; }
  .ch { display: flex; justify-content: space-between; align-items: baseline; gap: .5rem; }
  .ch .register { font-size: 11px; }
  .ch .note { color: var(--platinum-dim); }
  .prices, .choice { display: flex; gap: 1rem; flex-wrap: wrap; }
  .prices > span, .choice > span { display: grid; gap: .15rem; }
  .prices .register, .choice .register { font-size: 11px; }
  .choice > span { padding: .3rem .5rem; border: 1px solid var(--rule); }
  .choice > span.win { border-color: var(--gold-dim); }
  .grow { flex: 1; }
  .vf { display: inline-flex; align-items: center; gap: .3rem; white-space: nowrap; }
  .vf b { font-family: var(--face-mark); font-size: .98rem; color: var(--platinum); }
  .vf.dim b { color: var(--platinum-dim); }
  .vc { display: grid; justify-items: start; gap: .15rem; }
  /* A verdict, not a button: a tinted label (hover for why). */
  .verdict { display: inline-block; padding: .18rem .5rem; font-family: var(--face-register); font-size: .72rem; font-weight: 600; letter-spacing: .12em; text-transform: uppercase; cursor: help; }
  .v-sell { color: var(--platinum); background: rgb(241 243 246 / 8%); }
  .v-dissolve { color: var(--verdigris); background: rgb(111 183 163 / 12%); }
  .why { font-size: .74rem; color: var(--platinum-deep); }
  .vosfor { border: 1px solid var(--rule); background: var(--plate); padding: 1rem 1.2rem; margin-bottom: var(--step); display: grid; gap: .7rem; }
  .vosfor header { display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap; }
  .vosfor header .register { display: inline-flex; align-items: center; gap: .5rem; color: var(--platinum); }
  .vosfor p { margin: 0; }
  .vosfor p b { color: var(--platinum); font-weight: 600; }
  .packs { display: grid; grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr)); gap: .5rem; }
  .pack { border: 1px solid var(--rule); padding: .55rem .7rem; display: grid; gap: .45rem; align-content: start; background: var(--well); }
  .pack.best { border-color: var(--verdigris); box-shadow: inset 3px 0 0 var(--verdigris); }
  .ph { display: flex; justify-content: space-between; align-items: baseline; gap: .5rem; }
  .ph b { font-size: 1rem; }
  .wanted { display: flex; flex-wrap: wrap; gap: .25rem .7rem; font-size: .78rem; color: var(--platinum-dim); }
  .wanted span { display: inline-flex; align-items: center; gap: .3rem; cursor: default; }
  .wanted span:hover { color: var(--platinum); }
  .prog { display: flex; align-items: center; gap: 0.5rem; min-width: 9rem; }
  .prog :global(.meter) { flex: 1; }
  .prog .small { min-width: 2.6rem; text-align: right; font-variant-numeric: tabular-nums; }
  .links { display: flex; gap: 1rem; }
  /* Nothing here: quiet, but still readable (about 5:1). */
  .nil { color: var(--platinum-deep); }
</style>
