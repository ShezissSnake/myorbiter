<script lang="ts">
  import GameIcon from "../ui/GameIcon.svelte";
  import type { Model } from "../core/model";
  import { partRows, setRows, type PartRow } from "../core/views";
  import ListButton from "../ui/ListButton.svelte";
  import Browse from "../ui/Browse.svelte";
  import ItemCard from "../ui/ItemCard.svelte";
  import Thumb from "../ui/Thumb.svelte";
  import { details } from "../details.svelte";
  import { decide, ducatBuys } from "../core/advice";
  import type { AdviceSettings } from "../backend";
  import { mkt } from "../marketStore.svelte";
  import P from "../ui/P.svelte";
  import Named from "../ui/Named.svelte";
  import { until } from "../core/traders";
  import Avail from "../ui/Avail.svelte";
  import Chip from "../ui/Chip.svelte";
  import Seg from "../ui/Seg.svelte";
  import Stat from "../ui/Stat.svelte";
  import PageHead from "../ui/PageHead.svelte";
  import { matches, type Column } from "../ui/table";
  import { marketUrl, openUrl } from "../backend";
  import { info } from "../hover.svelte";
  import PriceHistory from "../ui/PriceHistory.svelte";
  import { takeIntent } from "../intent.svelte";

  // The ducat rate and smallest sale worth a trade are yours to set here; the bulk sale uses them too.
  let { model, advice = $bindable() }: { model: Model; advice: AdviceSettings } = $props();

  let query = $state("");
  let parent = $state<"all" | "mastered" | "unmastered">("mastered");
  let spareOnly = $state(false);
  let avail = $state<"all" | "farmable" | "vaulted">("all");
  let best = $state<"all" | "Keep" | "Set" | "Sell" | "Ducats">("all");
  let sort = $state({ key: "value", desc: true });
  // A link that asked for one kind of advice (Baro's card: Spares for ducats).
  $effect(() => {
    const want = takeIntent("parts");
    if (!want) return;
    query = "";
    if (want.best === "Keep" || want.best === "Set" || want.best === "Sell" || want.best === "Ducats") best = want.best;
    if (want.best) parent = "all";
  });

  const all = $derived(partRows(model));
  const rows = $derived(
    all.filter(
      (r) =>
        (parent === "all" || (parent === "mastered" ? r.parentMastered : !r.parentMastered)) &&
        (!spareOnly || !spareMatters || r.spare > 0) &&
        (best === "all" || verdict(r) === best) &&
        (avail === "all" || (avail === "farmable" ? r.availability === "farmable" : r.availability === "vaulted" || r.availability === "resurgence")) &&
        matches(query, r.name, r.parentName),
    ),
  );
  // Parts of mastered items are all spare: "Spare" and "Spare only" only mean something otherwise.
  const spareMatters = $derived(parent !== "mastered");
  const qty = (r: PartRow) => (spareOnly && spareMatters ? r.spare : r.quantity);

  // What every spare is worth the way it's best sold: plat on warframe.market, or ducats at Baro.
  const spares = $derived(all.filter((r) => r.spare > 0));
  const asPlat = $derived(spares.filter((r) => verdict(r) !== "Ducats").reduce((n, r) => n + (r.price ?? 0) * r.spare, 0));
  const asDucats = $derived(spares.filter((r) => verdict(r) === "Ducats").reduce((n, r) => n + r.ducats * r.spare, 0));
  const heldDucats = $derived((model.inventoryByBase.get("/Lotus/Types/Items/MiscItems/PrimeBucks") ?? []).reduce((n, r) => n + r.quantity, 0));
  const baro = $derived(model.live.baro ?? null);
  const baroHere = $derived(!!baro && Date.now() >= Date.parse(baro.activation) && Date.now() < Date.parse(baro.expiry));
  const RATES = [0.05, 0.08, 0.1, 0.12, 0.15, 0.2];
  const buys = $derived(ducatBuys(model, { limit: 12 }));

  // Complete sets you can sell, by item: their parts are better sold as a set.
  const setsFor = $derived(new Map(setRows(model).filter((s) => s.sellable > 0).map((s) => [s.name, s.sellable])));

  // Keep: copies you need to build and master the item. Set: part of a complete set you can sell.
  // Otherwise plat or ducats, at your ducat rate and smallest sale worth a trade.
  type Verdict = "Keep" | "Set" | "Sell" | "Ducats";
  const verdict = (r: PartRow): Verdict => {
    if (r.spare <= 0) return "Keep";
    if (r.inSets > 0) return "Set";
    return decide(r.price, r.ducats, r.tradesPerDay, advice).verdict === "ducats" ? "Ducats" : "Sell";
  };
  const VERDICT_TITLE: Record<Verdict, string> = {
    Keep: "You need these to build and master the item",
    Set: "Part of a complete set you can sell: sell the set",
    Sell: "Worth more on warframe.market than its ducats",
    Ducats: "Worth more to you as ducats at Baro Ki’Teer",
  };

  const allColumns: Column<PartRow>[] = [
    { key: "name", label: "Part", value: (r) => r.name, defaultDesc: false, cell: nameCell, width: "min(26rem, 32%)" },
    { key: "qty", label: "Have", value: (r) => r.quantity, align: "right" },
    { key: "spare", minor: true, label: "Spare", value: (r) => r.spare, align: "right", title: "Copies beyond what you'd need to build an item you haven't mastered or built" },
    { key: "price", spare: true, label: "Price", value: (r) => r.price, align: "right", cell: priceCell },
    { key: "value", label: "Total", value: (r) => (r.price ?? 0) * qty(r), align: "right", cell: totalCell },
    { key: "ducats", spare: true, label: "Ducats", value: (r) => r.ducats, align: "right", cell: ducatCell },
    { key: "ratio", minor: true, label: "Duc/plat", value: (r) => (r.ducatsPerPlat == null ? null : Math.round(r.ducatsPerPlat * 10) / 10), align: "right", muted: true, title: "Ducats you get per platinum of market value" },
    { key: "verdict", label: "Best as", value: verdict, cell: verdictCell, defaultDesc: false },
    { key: "trades", minor: true, label: "Trades/day", value: (r) => (r.tradesPerDay == null ? null : Math.round(r.tradesPerDay * 10) / 10), align: "right", muted: true },
    { key: "avail", spare: true, label: "Vault", value: (r) => r.availability, cell: availCell, align: "center", defaultDesc: false },
    { key: "list", label: "", value: () => null, cell: listCell, sortable: false, align: "right" },
  ];
  const columns = $derived(spareMatters ? allColumns : allColumns.filter((c) => c.key !== "spare"));
  const pctOf = (x: number | null | undefined) => (x == null ? "–" : `${Math.round(x * 10) / 10}%`);
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
</script>

{#snippet nameCell(r: PartRow)}
  <Named file={model.imageOf(r.name)} name={r.name}>
    {#if r.keep > 0}<span class="tag" title="Held back so you can build {r.keptFor === r.parentName ? `and master ${r.parentName}` : `${r.parentName} for ${r.keptFor}`}">keep {r.keep}</span>{/if}
    {#if parent === "all" && !r.parentMastered}<span class="tag warn" title="{r.parentName} isn't mastered">{r.parentOwned ? "built" : "need"}</span>{/if}
  </Named>
{/snippet}
{#snippet priceCell(r: PartRow)}<P v={r.price} />{/snippet}
{#snippet totalCell(r: PartRow)}<P v={r.price == null ? null : r.price * qty(r)} />{/snippet}
{#snippet ducatCell(r: PartRow)}<P v={r.ducats} d dim />{/snippet}
{#snippet verdictCell(r: PartRow)}{@const v = verdict(r)}<span class="v-{v}" title={VERDICT_TITLE[v]}>{v === "Set" ? "Sell as set" : v}</span>{/snippet}
{#snippet listCell(r: PartRow)}
  {#if r.spare > 0 && r.inSets > 0}
    <ListButton {model} name="{r.parentName} Set" label="List set" req={{ quantity: setsFor.get(r.parentName) ?? 1 }} />
  {:else if r.spare > 0}
    <ListButton {model} name={r.name} req={{ quantity: r.spare }} />
  {/if}
{/snippet}
{#snippet availCell(r: PartRow)}<Avail v={r.availability} />{/snippet}
{#snippet card(r: PartRow, open: () => void)}
  {@const v = verdict(r)}
  {@const parentItem = model.catalogByUnique.get(r.parentUnique)}
  <ItemCard hover={r.name} title={r.parentName} sub={r.name.replace(`${r.parentName} `, "")} image={parentItem?.imageName ?? model.imageOf(r.parentName)} artSize={84} owned={r.spare > 0 && v !== "Keep"} onopen={open}>
    <div class="have">
      <Thumb file={model.imageOf(r.name)} name={r.name} size={30} />
      <b class="mark qty" title={spareOnly && spareMatters ? `${r.spare} spare (of ${r.quantity} held)` : `${r.quantity} held${r.keep ? `, ${r.spare} of them spare` : ""}`}>×{qty(r)}</b>
      {#if r.keep}<span class="dim small" title={r.keptFor === r.parentName ? `Held back to build ${r.parentName}, which you haven't mastered or built` : `Held back to build ${r.parentName} for ${r.keptFor}, which you haven't built`}>{r.keep} kept</span>{/if}
    </div>
    <div class="vline"><span class="v-{v}" title={VERDICT_TITLE[v]}>{v === "Set" ? "Sell as set" : v}</span><span class="grow"></span><P v={r.price} /><P v={r.ducats} d dim /></div>
    {#snippet foot()}
      <Avail v={r.availability} />
      {#if parent === "all" && !r.parentMastered}<span class="tag warn">{r.parentOwned ? "built" : "need"}</span>{/if}
      <span class="grow"></span>
      <button class="link" use:info={{ name: r.parentName, unique: r.parentUnique }} onclick={() => details.open(r.parentUnique)}>{r.parentName.replace(/ Prime$/, "")} ›</button>
      {@render listCell(r)}
    {/snippet}
  </ItemCard>
{/snippet}

{#snippet detail(r: PartRow)}
  {@const v = verdict(r)}
  {@const src = model.sourcesByReward.get(r.name) ?? []}
  <div class="figs">
    <span title="Copies you hold"><span class="register">Held</span><b class="mark">{r.quantity}</b></span>
    <span title="Daily median on warframe.market"><span class="register">Price</span><P v={r.price} /></span>
    <span title="What Baro Ki'Teer gives for one"><span class="register">Ducats</span><P v={r.ducats} d /></span>
    {#if r.tradesPerDay != null}<span title="How many sell on warframe.market in a day, on average"><span class="register">Sells</span><b>{Math.round(r.tradesPerDay * 10) / 10}<small class="dim">/day</small></b></span>{/if}
    <span title={VERDICT_TITLE[v]}><span class="register">Best as</span><b class="v-{v}">{v === "Set" ? "Sell as set" : v}</b></span>
  </div>
  <p class="small dim">
    {r.keep ? `${r.keep} kept to build ${r.parentName}${r.keptFor === r.parentName ? "" : ` for ${r.keptFor}`}` : r.parentMastered ? `${r.parentName} is mastered: every copy is spare` : `${r.parentName} is built: every copy is spare`}{r.inSets ? ` · ${r.inSets} go into ${setsFor.get(r.parentName) ?? 0} complete set${setsFor.get(r.parentName) === 1 ? "" : "s"}` : ""}{r.spare - r.inSets > 0 ? ` · ${r.spare - r.inSets} loose ${v === "Ducats" ? "for ducats" : "to sell"}` : ""}
  </p>
  {#if (r.tradesPerDay ?? 1) > 0}<div class="hist"><PriceHistory name={r.name} height={130} /></div>{/if}
  {#if src.length}
    <div class="odds">
      <span class="register">Drops from (intact → radiant)</span>
      {#each src.slice(0, 8) as s (s.base)}<span class="src" class:vaulted={s.vaulted && !s.resurgence} use:info={s.base}>{s.base} <span class="dim">{s.rarity} · {pctOf(s.chanceIntact)} → {pctOf(s.chanceRadiant)}</span></span>{/each}
      {#if src.length > 8}<span class="dim small">+{src.length - 8} more</span>{/if}
    </div>
  {/if}
  <div class="actions">
    {@render listCell(r)}
    {#if r.inSets > 0 && r.spare > r.inSets}<button class="stamp" onclick={(e) => { e.stopPropagation(); mkt.startListing(model, r.name, { quantity: r.spare - r.inSets }); }}>Or list {r.spare - r.inSets} loose</button>{/if}
    <button class="link" onclick={() => details.open(r.parentUnique)}>{r.parentName} ›</button>
    <button class="link" onclick={() => openUrl(marketUrl(r.name))}>warframe.market ↗</button>
  </div>
{/snippet}

<div class="page"><div class="page-inner">
  <PageHead title="Prime parts" blurb="Every prime part you hold and its best use: keep, sell, sell as a set, or trade to Baro.">
    {#snippet band()}
      <Stat label="Spares to sell" note={`${plural(spares.filter((r) => verdict(r) !== "Ducats").reduce((n, r) => n + r.spare, 0), "part")} · daily median`}><P v={asPlat} big /></Stat>
      <Stat label="Spares for ducats" tone="gold" note={`${plural(spares.filter((r) => verdict(r) === "Ducats").reduce((n, r) => n + r.spare, 0), "part")}, better traded in`}><P v={asDucats} d big /></Stat>
      <Stat label="Ducats held" tone="gold" note={baro ? (baroHere ? `Baro is here · leaves in ${until(baro.expiry)}` : `Baro arrives in ${until(baro.activation)}`) : "Baro's schedule unavailable"}><P v={heldDucats} d big /></Stat>
    {/snippet}
  </PageHead>

  <div class="bar filters">
    <Seg
      label="Item"
      bind:value={parent}
      options={[
        { v: "mastered", label: "Item mastered", title: "Parts of things you've already mastered: safe to sell or trade for ducats" },
        { v: "unmastered", label: "Not mastered", title: "Parts of things you haven't mastered: orbiter keeps what building them takes" },
        { v: "all", label: "All", title: "Every prime part you hold" },
      ]}
    />
    <Seg label="Relics" bind:value={avail} options={[{ v: "all", label: "Any", title: "Farmable and vaulted alike" }, { v: "farmable", label: "Farmable", title: "A relic that drops it can still be farmed: its price may drop" }, { v: "vaulted", label: "Vaulted", title: "Only vaulted relics drop it: no new copies, so prices tend to rise" }]} />
    <Seg label="Best as" bind:value={best} options={[{ v: "all", label: "Any", title: "Whatever is best for each part" }, { v: "Sell", label: "Sell", title: "Worth more sold on its own" }, { v: "Set", label: "Set", title: "Worth more sold in a complete set" }, { v: "Ducats", label: "Ducats", title: "Worth more traded to Baro, at your ducat rate" }, { v: "Keep", label: "Keep", title: "You need it to build something you haven't mastered" }]} />
  </div>
  <div class="bar second">
    <input type="search" placeholder="Filter parts…" bind:value={query} />
    {#if spareMatters}<Chip bind:on={spareOnly} label="Spare only" title="Leave out the copies you need to build something you haven't mastered" />{/if}
    <span class="grow"></span>
    <span class="register" title="How Best as weighs platinum against ducats; Put my spares on sale uses the same rates">Your rates</span>
    <select bind:value={advice.platPerDucat} aria-label="What a ducat is worth to you" title="What a ducat is worth to you, from what you'd buy with them at Baro">
      {#each [...new Set([...RATES, advice.platPerDucat])].sort((a, b) => a - b) as r (r)}<option value={r}>1 ducat ≈ {r}p ({Math.round(1 / r)}:1)</option>{/each}
    </select>
    {#if advice.baroRate && advice.baroRate.rate !== advice.platPerDucat}
      {@const b = advice.baroRate}
      <button class="baro" title="On Baro's visit of {new Date(b.visit).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}, the best he had that sells daily was {b.item}: {b.ducats} ducats for something that sells for {b.price}p. Click to use {b.rate}p a ducat." onclick={() => (advice.platPerDucat = b.rate)}><GameIcon name="ducats" size={13} />Baro: {b.rate}p</button>
    {/if}
    <select bind:value={advice.minPlat} aria-label="Smallest sale worth a trade">
      {#each [0, 3, 5, 8, 10, 15] as n (n)}<option value={n}>{n ? `Not worth a trade under ${n}p` : "Any price is worth a trade"}</option>{/each}
    </select>
  </div>

  <Browse id="parts" {rows} {columns} key={(r) => r.name} bind:sort {detail} {card} title={(r) => r.name} min="18rem" />

  <!-- Baro week: parts that turn platinum into ducats cheapest, beyond the ones you hold. -->
  <section class="dbuy" id="ducat-buys">
    <header>
      <h2 class="register lead">Ducats for less</h2>
      <span class="dim small">{baro ? (baroHere ? `Baro is here: leaves in ${until(baro.expiry)}` : `Baro arrives in ${until(baro.activation)}`) : ""}{baro ? " · " : ""}parts that sell daily, most ducats per platinum at the daily median. Gold: at least {Math.round(1 / advice.platPerDucat)} ducats a platinum, your rate (above).</span>
    </header>
    <table class="dt">
      <thead><tr><th>Part</th><th class="r">Ducats</th><th class="r">Price</th><th class="r" title="Ducats per platinum at the daily median">Per plat</th><th class="r">Sells/day</th><th></th></tr></thead>
      <tbody>
        {#each buys as b (b.name)}
          <tr>
            <td><Named file={model.imageOf(b.name)} name={b.name} size={24} /></td>
            <td class="r"><P v={b.ducats} d /></td>
            <td class="r"><P v={b.price} /></td>
            <td class="r"><b class:good={b.rate >= 1 / advice.platPerDucat}>{Math.round(b.rate * 10) / 10}</b></td>
            <td class="r dim">{b.tradesPerDay == null ? "–" : Math.round(b.tradesPerDay * 10) / 10}</td>
            <td class="r"><button class="link" title="Post a buy order on warframe.market for {b.name}: sellers whisper you" onclick={() => mkt.startBuy(b.name, { quantity: 5 })}>Buy order</button></td>
          </tr>
        {/each}
      </tbody>
    </table>
  </section>
</div></div>

<style>
  .baro { display: inline-flex; align-items: center; gap: .4rem; color: var(--gold); border-color: var(--gold-dim); background: transparent; }
  .baro:hover:not(:disabled) { background: var(--gold); border-color: var(--gold); color: var(--slab); }
  .v-Keep, .v-Set, .v-Sell, .v-Ducats { white-space: nowrap; }
  .have { display: flex; align-items: center; gap: .55rem; }
  .qty { font-size: 1.45rem; }
  .vline { display: flex; align-items: center; gap: .6rem; font-size: .84rem; }
  .grow { flex: 1; }
  .filters { padding-bottom: .6rem; }
  .second { padding-top: 0; }
  .v-Keep { color: var(--platinum-deep); }
  .v-Set { color: var(--platinum); font-weight: 600; }
  .v-Sell { color: var(--platinum); }
  .v-Ducats { color: var(--gold); }
  .figs { display: flex; flex-wrap: wrap; gap: 1.4rem; align-items: end; margin-bottom: .6rem; }
  .figs > span { display: grid; gap: .2rem; }
  .figs .register { font-size: .6rem; }
  .figs b.mark { font-size: 1.2rem; line-height: 1; }
  .hist { max-width: 46rem; margin: .4rem 0 .8rem; }
  .odds { display: flex; flex-wrap: wrap; align-items: center; gap: .3rem .45rem; margin: 0 0 .7rem; font-size: .8rem; }
  .odds .register { flex-basis: 100%; font-size: .6rem; }
  .src { padding: .12rem .45rem; border: 1px solid var(--rule-bright); }
  .src.vaulted { opacity: .7; border-style: dashed; }
  .actions { display: flex; flex-wrap: wrap; align-items: center; gap: .6rem 1.2rem; }
  .dbuy { margin-top: var(--course); display: grid; gap: .6rem; }
  .dbuy header { display: grid; gap: .25rem; }
  .dt { width: 100%; max-width: 56rem; border-collapse: collapse; font-size: .84rem; }
  .dt th { text-align: left; font-family: var(--face-register); font-size: .6rem; letter-spacing: .12em; text-transform: uppercase; color: var(--platinum-deep); font-weight: 500; padding: .3rem .5rem; border-bottom: 1px solid var(--rule); }
  .dt td { padding: .3rem .5rem; border-bottom: 1px solid var(--rule); }
  .dt .r { text-align: right; }
  .dt b.good { color: var(--gold); }
</style>
