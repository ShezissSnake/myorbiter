<script lang="ts">
  import HelpMark from "../ui/HelpMark.svelte";
  import { links, openUrl } from "../links.svelte";
  import Opening from "../ui/Opening.svelte";
  import Count from "../ui/Count.svelte";
  import PTick from "../ui/PTick.svelte";
  import Fold from "../ui/Fold.svelte";
  // Everything you own, the way TennoScope's collection shows it: gear, parts, relics, mods,
  // arcanes, resources and blueprints, with what each is worth and a way to list it.
  import { splitRelicName, type Model } from "../core/model";
  import { info } from "../hover.svelte";
  import { inventoryRows, type InventoryItem, type InventoryKind } from "../core/views";
  import { inventoryValue, spareRows, valueTotals, type SellChoices, type SpareRow } from "../core/spares";
  import { drops } from "../drops.svelte";
  import { mkt } from "../marketStore.svelte";
  import { marketUrl, wikiUrl } from "../backend";
  import Browse from "../ui/Browse.svelte";
  import ItemCard from "../ui/ItemCard.svelte";
  import ModCard from "../ui/ModCard.svelte";
  import Art from "../ui/Art.svelte";
  import { details } from "../details.svelte";
  import PageHead from "../ui/PageHead.svelte";
  import Stat from "../ui/Stat.svelte";
  import Named from "../ui/Named.svelte";
  import P from "../ui/P.svelte";
  import Seg from "../ui/Seg.svelte";
  import Chip from "../ui/Chip.svelte";
  import ListButton from "../ui/ListButton.svelte";
  import Icon from "../ui/Icon.svelte";
  import GameIcon, { kindIcon } from "../ui/GameIcon.svelte";
  import PriceHistory from "../ui/PriceHistory.svelte";
  import { matches, type Column } from "../ui/table";
  import NotNeeded from "../ui/NotNeeded.svelte";
  import { notNeeded, type GearCopy } from "../core/notNeeded";
  import Showcase, { type Exhibit } from "../ui/Showcase.svelte";
  import { pickShowcase } from "../core/showcase";
  import { reveal } from "../motion";
  import { whileShown } from "../pane.svelte";
  import { typed } from "../typed.svelte";
  import Kind from "../ui/Kind.svelte";

  let { model, sell, platPerDucat = 0, squad = 1, gear = null, keepGear = $bindable([]) }: { model: Model; sell: SellChoices; platPerDucat?: number; squad?: number; gear?: GearCopy[] | null; keepGear?: string[] } = $props();
  // Gear you no longer need and can't trade (core/notNeeded.ts), shown above the list when asked.
  let letGo = $state(false);
  const unneeded = $derived.by(whileShown("inventory", () => notNeeded(model, gear, new Set(keepGear))));
  const goCount = $derived(unneeded.go.length);

  let kind = $state<"all" | InventoryKind>("all");
  let tradableOnly = $state(false);
  /** Only what trades at least this often on warframe.market, and is worth at least this much a copy. Empty: any. */
  let minTrades = $state<number | null>(null);
  let minEach = $state<number | null>(null);
  let spareOnly = $state(false);
  let query = $state("");
  /** What the list is filtered on: the box, a moment later while you type (typed.svelte.ts). */
  const q = $derived.by(typed(() => query));
  // What selling would bring first: 532 Thumpers at 4p each aren't where to start.
  let sort = $state({ key: "sellable", desc: true });

  // What you can spare of everything tradable, and why the rest is kept: a set's parts for
  // anything unbuilt, your best copy of each mod and one to give away, one maxed arcane, the parts,
  // blueprints and resources your unbuilt things take, one of each Captura scene (core/spares.ts).
  // The market's item list names things the game knows by internal names ("Tn Concrete Archgun Barrel").
  // While hidden, kept as last drawn: the squad or ducat rate changed on another page waits for a visit (lib/pane.svelte.ts).
  const ledger = $derived.by(whileShown("inventory", () => new Map(spareRows(model, mkt.index, sell, platPerDucat, squad, drops.recent).map((x) => [x.key, x]))));
  const spareOf = (r: InventoryItem): SpareRow | undefined => ledger.get(r.key);
  const spare = (r: InventoryItem) => spareOf(r)?.spare ?? 0;
  /** The market's name, where the game's own is an internal one; a built kitgun, zaw, amp, MOA, hound or K-Drive by its family. */
  const shown = (r: InventoryItem) => r.builtAs ?? (spareOf(r)?.heldAs ? spareOf(r)!.name : r.name);
  /** The kind line: "Built" for built modular gear, else the spare's kind or the row's. */
  const kindLine = (r: InventoryItem) => (r.builtAs ? "Built" : (spareOf(r)?.type ?? r.type));
  /** Priced under the market's name where the game's own isn't one the market knows. */
  // Built gear can't be traded (only some unranked copies can, and those show as spare): no price.
  const priceOf = (r: InventoryItem) => (r.kind === "gear" && !spareOf(r) ? null : (spareOf(r)?.price ?? r.price));
  const worthOf = (r: InventoryItem) => {
    const p = priceOf(r);
    return p == null ? null : p * r.quantity;
  };
  const perDay = (r: InventoryItem) => spareOf(r)?.tradesPerDay ?? r.tradesPerDay;
  // Every row's share of the figures, worked out over everything held: an item's rows (a mod at two
  // ranks, a relic's refinements) share one month of sales, so the rows add up to the figures above.
  const all = $derived.by(whileShown("inventory", () => inventoryRows(model)));
  const full = $derived(inventoryValue(all, ledger));
  /** The row's spare copies' share of Spare value: no more of the item than the market sells in a month. */
  const sellable = (r: InventoryItem) => Math.round(full.rows.get(r.key)?.spare ?? 0) || null;
  /** Mods and arcanes by name, each rank a row of its own. */
  const byName = $derived.by(() => {
    const out = new Map<string, InventoryItem[]>();
    for (const x of all) if (x.rank != null) out.set(`${x.kind}|${x.name}`, [...(out.get(`${x.kind}|${x.name}`) ?? []), x]);
    return out;
  });
  /** "+1 at R3": the same mod or arcane held at other ranks, so ×193 here and ×194 on Mods both add up. */
  const otherRanks = (r: InventoryItem) =>
    r.rank == null ? "" : (byName.get(`${r.kind}|${r.name}`) ?? []).filter((x) => x.rank !== r.rank).map((x) => `+${x.quantity.toLocaleString("en")} at R${x.rank}`).join(", ");
  /** The item's page, by the market's own slug when its item list is loaded ("…_(veiled)"). */
  const itemUrl = (name: string) => {
    const it = mkt.index.byName.get(name.toLowerCase());
    return it ? `https://warframe.market/items/${it.slug}` : marketUrl(name);
  };

  // Spare only and the folded filters, the kind and a search: what Clear puts back.
  const filtered = $derived(!!q.trim() || kind !== "all" || tradableOnly || minTrades != null || minEach != null || spareOnly);
  function clear() {
    query = "";
    kind = "all";
    tradableOnly = spareOnly = false;
    minTrades = minEach = null;
  }

  /** The kind the list is filtered on: the select shows a pick at once, the list a frame later (typed.svelte.ts). */
  const kindNow = $derived.by(typed(() => kind));
  const rows = $derived(all.filter((r) => (kindNow === "all" || r.kind === kindNow) && (!tradableOnly || spareOf(r)) && (minTrades == null || (perDay(r) ?? 0) >= minTrades) && (minEach == null || (priceOf(r) ?? 0) >= minEach) && (!spareOnly || spare(r) > 0) && matches(q, r.name, r.type, shown(r), spareOf(r)?.type ?? "")));
  const pctOf = (x: number | null | undefined) => (x == null ? "–" : `${Math.round(x * 10) / 10}%`);
  const why = (r: InventoryItem) => spareOf(r)?.why ?? "Nothing to spare";

  const KINDS: { v: "all" | InventoryKind; label: string }[] = [
    { v: "all", label: "All" },
    { v: "gear", label: "Gear" },
    { v: "part", label: "Prime parts" },
    { v: "relic", label: "Relics" },
    { v: "mod", label: "Mods" },
    { v: "arcane", label: "Arcanes" },
    { v: "resource", label: "Resources" },
    { v: "blueprint", label: "Blueprints" },
    { v: "imprint", label: "Imprints" },
  ];
  const count = (k: "all" | InventoryKind) => (k === "all" ? all.length : all.filter((r) => r.kind === k).length);

  // The three figures, worked out as Stats does (core/spares.ts, inventoryValue): the rows shown,
  // added up, so the kind and filters above narrow them too.
  const value = $derived(valueTotals(rows, full.rows));
  const KIND_WORD: Record<string, string> = { gear: "gear", part: "prime parts", relic: "relics", mod: "mods", arcane: "arcanes", resource: "resources", blueprint: "blueprints", imprint: "imprints", other: "other" };
  /** "mods 9,033 · prime parts 1,210 · …": where the spare figure comes from, biggest first. */
  const spareSplit = $derived([...value.byKind].filter(([, v]) => v >= 1).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${KIND_WORD[k] ?? k} ${Math.round(v).toLocaleString("en")}p`).join(" · "));

  // The showcase: the kind you're looking at, its five most valuable spares by Spare value (every
  // rank or refinement of one item in one place); with none spare, the dearest things you hold.
  let opened = $state<InventoryItem | null>(null);
  const shelfRows = $derived(kindNow === "all" ? all : all.filter((r) => r.kind === kindNow));
  const shelfKey = (r: InventoryItem) => `${r.kind}|${shown(r)}`;
  // Spare copies, and how many items with copies to spare sell every day: the shown rows, as the figures above them.
  const spareCopies = $derived(rows.reduce((n, r) => n + spare(r), 0));
  const spareItems = $derived(new Set(rows.filter((r) => spare(r) > 0).map(shelfKey)));
  const sellDaily = $derived(new Set(rows.filter((r) => spare(r) > 0 && (perDay(r) ?? 0) >= 1).map(shelfKey)).size);
  /** With nothing spare, what a thing you hold is worth: its price, or for built gear (which can't be traded) its set's. */
  const heldWorth = (r: InventoryItem) => priceOf(r) ?? (r.kind === "gear" ? model.price(`${r.name} Set`) : null);
  const shelf = $derived(pickShowcase(shelfRows, { spare: (r) => full.rows.get(r.key)?.spare ?? null, held: heldWorth, name: shown, key: shelfKey }));
  const imageFor = (r: InventoryItem) => model.imageOf(r.kind === "relic" ? (r.marketName ?? r.name).replace(/ Relic$/, "") : r.name) ?? model.imageOf(shown(r));
  const exhibits = $derived(
    shelf.items.map(({ row: r, value }): Exhibit => {
      const c = model.catalogByUnique.get(r.unique);
      const same = shelfRows.filter((x) => shelfKey(x) === shelfKey(r));
      const spareN = same.reduce((n, x) => n + spare(x), 0);
      const heldN = same.reduce((n, x) => n + x.quantity, 0);
      const spares = shelf.mode === "spares";
      return {
        key: shelfKey(r),
        name: shown(r),
        sub: spares ? `×${spareN.toLocaleString("en")} spare · ${spareOf(r)?.type ?? r.type}` : priceOf(r) == null ? `${r.type} · its set` : `×${heldN.toLocaleString("en")} held · each`,
        value: Math.round(value),
        title: spares ? `${shown(r)}: ${spareN.toLocaleString("en")} spare, about ${Math.round(value).toLocaleString("en")}p (no more than the market sells in a month: its part of Spare value). Click for its details` : priceOf(r) == null ? `${shown(r)}: built gear can't be traded; its set sells for ${Math.round(value).toLocaleString("en")}p. Click for its details` : `${shown(r)}: ${Math.round(value).toLocaleString("en")}p each, ${heldN.toLocaleString("en")} held. Click for its details`,
        open: () => (r.kind === "gear" && r.levels && c ? details.open(r.unique) : (opened = r)),
        image: imageFor(r),
        look: r.kind === "mod" ? "mod" : r.kind === "arcane" ? "arcane" : "art",
        fallback: kindIcon(r.kind === "relic" ? "relic" : (spareOf(r)?.type ?? r.type), r.name) ?? "foundry",
        card: { rarity: c?.rarity ?? "", polarity: c?.polarity ?? null, drain: c?.baseDrain ?? null, maxRank: r.maxRank ?? c?.maxRank ?? null, rank: r.rank ?? 0, label: c?.compatName ?? "", does: c?.maxStats?.[0] ?? "" },
      };
    }),
  );
  const KIND_LABEL = $derived(KINDS.find((k) => k.v === kind)?.label.toLowerCase() ?? "");

  const columns: Column<InventoryItem>[] = [
    { key: "name", label: "Item", value: (r) => r.name, cell: nameCell, defaultDesc: false, width: "min(26rem, 40%)" },
    { key: "type", label: "Kind", value: kindLine, muted: true, defaultDesc: false, minor: true, cell: kindCell },
    { key: "qty", label: "Have", value: (r) => r.quantity, align: "right", cell: qtyCell },
    { key: "spare", label: "Spare", value: (r) => (spareOf(r) ? spare(r) : null), align: "right", cell: spareCell, title: "What you can sell: what you hold beyond what you keep (hover a number for why)" },
    { key: "price", label: "Each", value: (r) => priceOf(r), align: "right", cell: priceCell },
    { key: "worth", label: "Worth", value: (r) => worthOf(r), align: "right", cell: worthCell },
    { key: "sellable", label: "Spare sells for", value: (r) => sellable(r), align: "right", cell: sellableCell, title: "What your spare copies would bring: no more of each item than the market sells in a month, shared between its ranks or refinements (Spare value, row by row: the rows add up to it)" },
    { key: "ducats", label: "Ducats (all)", value: (r) => (r.ducats == null ? null : r.ducats * r.quantity), align: "right", cell: ducatCell, minor: true, title: "Ducats for every copy you hold: ducats each × copies" },
    { key: "trades", spare: true, label: "Sold/day", value: (r) => { const t = perDay(r); return t == null ? null : Math.round(t * 10) / 10; }, align: "right", muted: true, title: "How quickly it sells on warframe.market" },
    { key: "list", label: "", value: () => null, cell: listCell, sortable: false, align: "right" },
  ];
</script>

{#snippet spareCell(r: InventoryItem)}
  {@const s = spareOf(r)}
  {#if s}<span class="sp" class:none={!s.spare} title={s.keep ? `Keeps ${s.keep}: ${s.why}` : s.why}>{s.spare.toLocaleString("en")}</span>{/if}
{/snippet}
{#snippet kindCell(r: InventoryItem)}<Kind kind={kindLine(r)} />{/snippet}
{#snippet nameCell(r: InventoryItem)}
  <Named file={model.imageOf(r.name) ?? model.imageOf(shown(r))} name={shown(r)}>
    {#if r.rank && r.maxRank}<span class="tag" class:ok={r.rank >= r.maxRank}>{r.rank >= r.maxRank ? "maxed" : `R${r.rank}`}</span>{/if}
    {#if r.kind === "gear" && r.levels}{#if r.mastered}<span class="tag good">✓ mastered</span>{:else}<span class="tag mastery" title="Not mastered: rank it up for its mastery">level it</span>{/if}{/if}
  </Named>
{/snippet}
{#snippet qtyCell(r: InventoryItem)}{r.quantity.toLocaleString("en")}{#if otherRanks(r)}<span class="dim small ranks" title="The same {r.kind} held at other ranks: each rank is a row of its own"> {otherRanks(r)}</span>{/if}{/snippet}
{#snippet priceCell(r: InventoryItem)}<P v={priceOf(r)} dim />{/snippet}
{#snippet worthCell(r: InventoryItem)}<P v={worthOf(r)} />{/snippet}
{#snippet sellableCell(r: InventoryItem)}<P v={sellable(r)} />{/snippet}
{#snippet ducatCell(r: InventoryItem)}<P v={r.ducats == null ? null : r.ducats * r.quantity} d dim />{/snippet}
{#snippet listCell(r: InventoryItem, labelled = false)}
  {@const s = spareOf(r)}
  {#if s}
    {#if s.spare > 0}
      <ListButton {model} {labelled} name={s.name} req={{ unique: r.kind === "relic" || s.type === "Veiled riven" ? null : r.unique, rank: r.rank, subtype: r.subtype, quantity: s.spare }} />
    {:else}
      <span class="kept" role="img" aria-label="Kept" title={`Kept: ${why(r)}`}><Icon name="lock" /></span>
    {/if}
  {/if}
{/snippet}
{#snippet card(r: InventoryItem, open: () => void)}
  <!-- No footer at all when there's nothing for it: a resource with no market data. -->
  {#snippet foot()}
    {#if r.kind === "gear" && r.levels}{#if r.mastered}<span class="tag good flush">✓ mastered</span>{:else}<span class="tag mastery flush" title="Not mastered: rank it up for its mastery">level it</span>{/if}{/if}
    {#if perDay(r) != null}<span class="dim small" title="How many times a day it trades on warframe.market">{Math.round(perDay(r)! * 10) / 10} sold/day</span>{:else if r.kind !== "gear"}<span class="dim small" title="warframe.market's daily statistics have no trades of it">no recent sales</span>{/if}
    <span class="grow"></span>
    {@render listCell(r, true)}
  {/snippet}
  <ItemCard hover={r.name} title={shown(r)} sub={kindLine(r)} fallback={kindIcon(r.kind === "relic" ? "relic" : (spareOf(r)?.type ?? r.type), r.name)} image={model.imageOf(r.kind === "relic" ? (r.marketName ?? r.name).replace(/ Relic$/, "") : r.name) ?? model.imageOf(shown(r))} artSize={64} owned={r.kind === "gear" && r.levels && !r.mastered} ownedNote="Not mastered" onopen={open} foot={(r.kind === "gear" && r.levels) || perDay(r) != null || spareOf(r) ? foot : undefined}>
    {#snippet art()}
      {#if r.kind === "mod" || r.kind === "arcane"}
        {@const c = model.catalogByUnique.get(r.unique)}
        <ModCard arcane={r.kind === "arcane"} name={r.name} image={model.imageOf(r.name)} rarity={c?.rarity ?? ""} polarity={c?.polarity ?? null} drain={c?.baseDrain ?? null} maxRank={r.maxRank ?? c?.maxRank ?? null} rank={r.rank ?? 0} label={c?.compatName ?? ""} width={84} />
      {:else}
        <Art file={model.imageOf(r.kind === "relic" ? (r.marketName ?? r.name).replace(/ Relic$/, "") : r.name) ?? model.imageOf(shown(r))} size={64} alt="" name={shown(r)} fallback={kindIcon(r.kind === "relic" ? "relic" : (spareOf(r)?.type ?? r.type), r.name) ?? "foundry"} />
      {/if}
    {/snippet}
    <!-- As on Mods: what you hold, how many of those are spare, then what the spares sell for. -->
    <div class="have"><b class="mark qty">×{r.quantity.toLocaleString("en")}</b>{#if spareOf(r) && spare(r) > 0}<span class="dim small" title={why(r)}>{spare(r) === r.quantity ? "all spare" : `${spare(r).toLocaleString("en")} spare`}</span>{/if}{#if otherRanks(r)}<span class="dim small" title="The same {r.kind} held at other ranks: each rank is a card of its own">at R{r.rank}, {otherRanks(r)}</span>{/if}{#if r.rank && r.maxRank}<span class="tag" class:ok={r.rank >= r.maxRank}>{r.rank >= r.maxRank ? "maxed" : `R${r.rank}`}</span>{/if}</div>
    {#if priceOf(r) != null || r.ducats}
      <div class="vals">
        {#if priceOf(r) != null}<span><span class="register">Each</span><P v={priceOf(r)} dim /></span>{/if}
        <!-- One total: what the spares sell for, or with none spare, what every copy is worth. -->
        {#if sellable(r) != null}<span title="What your spare copies would bring: no more of the item than the market sells in a month, shared between its ranks or refinements (its part of Spare value; the order the cards are in)"><span class="register">Spares</span><P v={sellable(r)} /></span>
        {:else if r.quantity > 1 && worthOf(r) != null}<span title="Every copy you hold, at the daily median. Shown instead of Spares when none of your spare copies count toward Spare value: none are spare, or the market sells none of them"><span class="register">All</span><P v={worthOf(r)} /></span>{/if}
        {#if r.ducats}<span title="Ducats for every copy you hold: ducats each × copies"><span class="register">Ducats (all)</span><P v={r.ducats * r.quantity} d dim /></span>{/if}
      </div>
    {/if}
  </ItemCard>
{/snippet}

{#snippet detail(r: InventoryItem)}
  {@const s = spareOf(r)}
  {@const price = s?.price ?? r.price}
  <p class="small dim">
    {r.quantity} held{r.rank != null ? ` at rank ${r.rank}` : ""}{price != null ? ` · ${price}p each on warframe.market` : " · no market price"}{#if s}{" · "}you keep {s.keep}, can spare {s.spare}{/if}{#if s?.heldAs}{" · "}listed as {s.name} (the game calls it {s.heldAs}){/if}
  </p>
  {#if s && (s.tradesPerDay ?? 1) > 0}<div class="hist"><PriceHistory name={s.name} unique={r.kind === "relic" || s.type === "Veiled riven" ? null : r.unique} rank={r.rank} subtype={r.subtype} height={130} known={price != null || perDay(r) != null} /></div>{/if}
  {#if s}<p class="small why">{s.keep ? `Kept: ${s.why}.` : `${s.why}.`}{#if s.crack != null && r.kind === "relic"}{" "}A crack is worth about {Math.round(s.crack * 10) / 10}p on average.{/if}</p>{/if}
  {#if s && s.needs.length > 1 && r.kind !== "relic"}
    <div class="odds">
      <span class="register">What it's kept for</span>
      {#each s.needs as n (n.item)}<span class="src" use:info={n.item}>{n.item}{#if n.count > 1}<span class="dim">{" "}×{n.count}</span>{/if}</span>{/each}
    </div>
  {/if}
  {#if r.kind === "part"}
    {@const src = model.sourcesByReward.get(r.name) ?? []}
    {#if src.length}
      <div class="odds">
        <span class="register">Drops from (intact → radiant)</span>
        {#each src.slice(0, 8) as s (s.base)}<span class="src" class:vaulted={s.vaulted && !s.resurgence} use:info={s.base}>{s.base} <span class="dim">{s.rarity} · {pctOf(s.chanceIntact)} → {pctOf(s.chanceRadiant)}</span></span>{/each}
        {#if src.length > 8}<span class="dim small">+{src.length - 8} more</span>{/if}
      </div>
    {/if}
  {:else if r.kind === "relic"}
    {@const rel = splitRelicName(r.name)}
    {@const entry = rel ? model.relicGroups.get(rel.base)?.byRefinement[rel.refinement] : undefined}
    {#if rel && entry?.rewards.length}
      <div class="odds">
        <span class="register">{rel.refinement} odds</span>
        {#each entry.rewards as x, i (i)}<span class="src" use:info={x.name}>{x.name} <span class="dim">{pctOf(x.chance)}</span></span>{/each}
      </div>
    {/if}
  {/if}
  <!-- The same buttons as an item's own details sheet. -->
  <div class="detail-acts">
    {@render listCell(r, true)}
    <button title="Its page on the official wiki" aria-busy={links.isOpening(wikiUrl(r.kind === "relic" ? r.marketName ?? r.name : r.name))} onclick={() => openUrl(wikiUrl(r.kind === "relic" ? r.marketName ?? r.name : r.name))}><Opening url={wikiUrl(r.kind === "relic" ? r.marketName ?? r.name : r.name)}>Wiki</Opening></button>
    {#if spareOf(r)}<button title="Its page on warframe.market: orders and price history" aria-busy={links.isOpening(itemUrl(spareOf(r)!.name))} onclick={() => openUrl(itemUrl(spareOf(r)!.name))}><Opening url={itemUrl(spareOf(r)!.name)}>warframe.market</Opening></button>{/if}
  </div>
{/snippet}

<div class="page"><div class="page-inner">
  <PageHead help={{ band: "inventory.band", hero: "inventory.showcase" }} title="Inventory" brief="Everything you own, and what it's worth." blurb="Everything you own, with what it's worth on warframe.market.">
    {#snippet hero()}
      <Showcase
        items={exhibits}
        caption={shelf.mode === "empty" ? (kind === "all" ? "Your inventory" : `Your ${KIND_LABEL}`) : shelf.mode === "held" ? (kind === "all" ? "Nothing spare: your dearest" : `No spare ${KIND_LABEL}: your dearest`) : kind === "all" ? "Your most valuable spares" : `Your most valuable spare ${KIND_LABEL}`}
        note={shelf.mode === "empty" ? "" : shelf.mode === "held" ? (kind === "gear" ? "By what its set sells for · click one for its details" : "Each, at the daily median · click one for its details") : "By what they'd sell for (Spare value) · click one for its details"}
        empty={all.length ? `Nothing here with a market price: ${KIND_LABEL} that trade on warframe.market go on display.` : "Nothing read yet: press Sync while Warframe is running, and your gear goes on display here."}
      />
    {/snippet}
    {#snippet band()}
      <Stat label="Spare value" tone="gold" note="Beyond what you keep, no more of each than the market sells in a month" title={`Spare value: every copy beyond what you keep, ${filtered ? "of what the filters show" : "of every kind"}, at the daily median, no more of each item than the market sells in a month (slow sellers count only that; unranked arcanes as their share of a maxed one).${spareSplit ? ` By kind: ${spareSplit}.` : ""} Worth selling, on Prime parts, Mods and Arcanes, is the narrower figure: it leaves out what's better as ducats or Vosfor, what isn't worth a trade and mods that don't sell daily.`}><PTick v={value.spare} /></Stat>
      <Stat label="Spare copies" note={`Of ${spareItems.size.toLocaleString("en")} items, beyond what you keep`} title="Every copy you hold beyond what you keep: what your unbuilt items take, your best copy and one to give away of each mod (five of each Requiem or Antivirus mod while a lich weapon is left to master; installed copies count as kept), one maxed arcane, one of each Captura scene"><Count value={spareCopies} /></Stat>
      <Stat label="Sell daily" note="Items with copies to spare that trade every day on warframe.market: where to start" title="Items you have copies to spare of that trade at least once a day on warframe.market (their daily statistics): the ones that sell quickly"><Count value={sellDaily} /></Stat>
      <Stat extra label="Quick-sale value" note="Everything you hold of what trades daily, kept copies too, no more of each than the market sells in a month"><PTick v={value.easy} /></Stat>
      <Stat extra label="Market value" tone="dim" note="Every copy at the daily median, slow sellers included"><PTick v={value.market} /></Stat>
    {/snippet}
  </PageHead>

  {#snippet filters()}
    <input type="search" aria-label="Filter your inventory by name" title="Shows only what matches what you type" placeholder="Filter items…" bind:value={query} />
    <select bind:value={kind} aria-label="Kind" class="kinds" title="Only one kind of item">
      {#each KINDS as k (k.v)}<option value={k.v}>{k.label} ({count(k.v).toLocaleString("en")})</option>{/each}
    </select>
    <Chip bind:on={spareOnly} label="Spare only" title="Only what you hold more of than you need: beyond what your unbuilt items take, your best copy and one to give away of each mod (five of each Requiem or Antivirus mod while a lich weapon is left to master; installed copies count as kept), one maxed arcane, one of each Captura scene" />
    <Fold active={(tradableOnly ? 1 : 0) + (minTrades != null ? 1 : 0) + (minEach != null ? 1 : 0)} reset={() => { tradableOnly = false; minTrades = null; minEach = null; }}>
      <Chip bind:on={tradableOnly} label="Tradable" title="Only things warframe.market trades" />
      <label class="min" title="Only what trades at least this many times a day on warframe.market (1: it actually sells). Empty: any.">
        <span class="register">Sold/day ≥</span>
        <input type="number" min="0" step="any" placeholder="any" bind:value={minTrades} aria-label="Minimum sold a day" />
      </label>
      <label class="min" title="Only what's worth at least this much a copy, at the daily median. Empty: any.">
        <span class="register">Each ≥</span>
        <input type="number" min="0" step="1" placeholder="any" bind:value={minEach} aria-label="Minimum platinum each" />
        <GameIcon name="platinum" size={14} />
      </label>
    </Fold>
    <span class="grow"></span>
    <!-- Not a filter: it opens the list of gear you can sell to the game for credits. -->
    <button type="button" class="letgo" class:on={letGo} aria-pressed={letGo} onclick={() => (letGo = !letGo)} title="Gear you can't trade and no longer need: a weapon, frame or companion once you've mastered it and own a better version of it (the Dual Decurion once you have Prisma Dual Decurions), and extra copies of something mastered. Sell them for credits in game">Gear to sell for credits · <Count value={goCount} /></button>
    <HelpMark part="inventory.filters" />
  {/snippet}

  {#if letGo}<div class="reveal" transition:reveal><div><NotNeeded {model} out={unneeded} incarnons={!!gear} bind:keep={keepGear} /></div></div>{/if}

  <Browse {filters} id="inventory" bind:opened {rows} {columns} key={(r) => r.key} bind:sort {detail} {card} title={(r) => shown(r)} kicker={kindLine} onopen={(r) => (r.kind === "gear" && r.levels && model.catalogByUnique.has(r.unique) ? details.open(r.unique) : null)} min="16rem" clear={filtered ? clear : null} empty="Nothing in your inventory yet: press Sync while Warframe is running, and everything you own goes on display here." />
</div></div>

<style>
  .kinds { min-width: 12rem; }
  .sp { font-variant-numeric: tabular-nums; color: var(--gold); font-weight: 600; cursor: help; }
  .sp.none { color: var(--platinum-deep); font-weight: 400; }
  .hist { max-width: 46rem; margin: 0 0 .8rem; }
  .why { margin: -.3rem 0 .7rem; color: var(--platinum-dim); max-width: 80ch; }
  /* Kept: a padlock where the List button would be, the same size so the column lines up. */
  .kept { display: inline-grid; place-items: center; width: 30px; height: 30px; color: var(--platinum-deep); }
  .flush { margin-left: 0; }
  .have { display: flex; flex-wrap: wrap; align-items: baseline; gap: .1rem .5rem; }
  .have .tag { margin-left: 0; }
  .qty { font-size: 1.3rem; }
  /* Each figure in a column of its own width, so cards side by side line up and wrap the same way. */
  /* Two columns, always: "Sells for" never wraps onto a line of its own. */
  .vals { display: grid; grid-template-columns: repeat(2, minmax(0, max-content)); gap: .4rem 1.1rem; }
  .vals > span { display: grid; gap: .15rem; }
  .vals .register { font-size: 11px; white-space: nowrap; }
  .grow { flex: 1; }
  .odds { display: flex; flex-wrap: wrap; align-items: center; gap: .3rem .45rem; margin: 0 0 .7rem; font-size: .8rem; }
  .odds .register { flex-basis: 100%; font-size: 11px; }
  .src { padding: .12rem .45rem; border: 1px solid var(--rule-bright); }
  .src.vaulted { opacity: .7; border-style: dashed; }
  .min { display: inline-flex; align-items: center; gap: .45rem; }
  .min .register { font-size: 11px; white-space: nowrap; }
  .min input { width: 4.6rem; }
  .letgo.on { border-color: var(--gold-dim); color: var(--platinum); }
</style>
