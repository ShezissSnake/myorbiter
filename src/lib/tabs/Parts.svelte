<script lang="ts">
  import PTick from "../ui/PTick.svelte";
  import Fold from "../ui/Fold.svelte";
  import { partsWorthSelling, worthTotal } from "../core/worthSelling";
  import GameIcon, { kindIcon } from "../ui/GameIcon.svelte";
  import Icon from "../ui/Icon.svelte";
  import type { Model } from "../core/model";
  import { partRows, saveForSets, savedLine, setRows, type PartRow } from "../core/views";
  import type { SellChoices } from "../core/spares";
  import { drops } from "../drops.svelte";
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
  import Showcase, { type Exhibit } from "../ui/Showcase.svelte";
  import { pickShowcase } from "../core/showcase";
  import { whileShown } from "../pane.svelte";
  import { typed } from "../typed.svelte";

  // The ducat rate and smallest sale worth a trade are yours to set here; the bulk sale uses them too.
  // Settings → Selling: whether loose parts wait for a set worth more whole.
  let { model, advice = $bindable(), sell }: { model: Model; advice: AdviceSettings; sell: SellChoices } = $props();

  let query = $state("");

  /** What the list is filtered on: the box, a moment later while you type (typed.svelte.ts). */

  const q = $derived.by(typed(() => query));
  let parent = $state<"all" | "mastered" | "unmastered">("mastered");
  let spareOnly = $state(false);
  let avail = $state<"all" | "farmable" | "vaulted">("all");
  let best = $state<"all" | Verdict>("all");
  let sort = $state({ key: "value", desc: true });
  const filtered = $derived(!!q.trim() || best !== "all" || spareOnly || parent !== "mastered" || avail !== "all");
  function clear() {
    query = "";
    best = "all";
    spareOnly = false;
    parent = "mastered";
    avail = "all";
  }
  // A link that asked for one kind of advice (Baro's card: Spares for ducats).
  $effect(() => {
    const want = takeIntent("parts");
    if (!want) return;
    query = "";
    if (want.best === "Keep" || want.best === "Save" || want.best === "Set" || want.best === "Sell" || want.best === "Ducats") best = want.best;
    if (want.best) parent = "all";
  });

  const all = $derived.by(whileShown("parts", () => partRows(model, saveForSets(sell, advice.platPerDucat, drops.recent))));
  /** Copies kept to build and master the item (the rest of `keep` waits for a set). */
  const built = (r: PartRow) => r.keep - r.forSet;
  const rows = $derived.by(whileShown("parts", () =>
    all.filter(
      (r) =>
        (parent === "all" || (parent === "mastered" ? r.parentMastered : !r.parentMastered)) &&
        (!spareOnly || !spareMatters || r.spare > 0) &&
        (best === "all" || verdict(r) === best) &&
        (avail === "all" || (avail === "farmable" ? r.availability === "farmable" : r.availability === "vaulted" || r.availability === "resurgence")) &&
        matches(q, r.name, r.parentName),
    ),
  ));
  // Parts of mastered items are all spare: "Spare" and "Spare only" only mean something otherwise.
  const spareMatters = $derived(parent !== "mastered");
  const qty = (r: PartRow) => (spareOnly && spareMatters ? r.spare : r.quantity);

  // What every spare is worth the way it's best sold: plat on warframe.market, or ducats at Baro.
  const spares = $derived(all.filter((r) => r.spare > 0));
  // Worth selling, counted as Mods, Arcanes and Home's Ready to list count it (core/worthSelling.ts):
  // the loose spares best sold for platinum, no more of each than the market sells in a month.
  const selling = $derived.by(whileShown("parts", () => partsWorthSelling(all, advice)));
  const asPlat = $derived(worthTotal(selling));
  const asDucats = $derived(spares.filter((r) => verdict(r) === "Ducats").reduce((n, r) => n + r.ducats * r.spare, 0));
  const heldDucats = $derived((model.inventoryByBase.get("/Lotus/Types/Items/MiscItems/PrimeBucks") ?? []).reduce((n, r) => n + r.quantity, 0));
  const baro = $derived(model.live.baro ?? null);
  const baroHere = $derived(!!baro && Date.now() >= Date.parse(baro.activation) && Date.now() < Date.parse(baro.expiry));
  const RATES = [0.05, 0.08, 0.1, 0.12, 0.15, 0.2];
  const buys = $derived.by(whileShown("parts", () => ducatBuys(model, { limit: 12 })));

  // The showcase: the five parts worth most in Worth selling, each on the item it builds; with none
  // to sell, the dearest parts you hold.
  let opened = $state<PartRow | null>(null);
  const sellingBy = $derived(new Map(selling.map((x) => [x.name, x])));
  const shelf = $derived(pickShowcase(all, { spare: (r) => sellingBy.get(r.name)?.plat, held: (r) => (r.quantity > 0 ? r.price : null), name: (r) => r.name }));
  const exhibits = $derived(
    shelf.items.map(({ row: r, value }): Exhibit => {
      const w = sellingBy.get(r.name);
      const part = r.name.replace(`${r.parentName} `, "");
      return {
        key: r.name,
        name: r.parentName,
        sub: w ? `${part} · ×${w.copies}` : `${part} · ×${r.quantity} held`,
        value: Math.round(value),
        title: w ? `${r.name}: ${w.copies} loose to sell at about ${Math.round(w.each)}p, ${Math.round(value).toLocaleString("en")}p in all (no more than the market sells in a month: its part of Worth selling). Click for its details` : `${r.name}: ${Math.round(value)}p each, ${r.quantity} held. Click for its details`,
        open: () => (opened = r),
        image: model.catalogByUnique.get(r.parentUnique)?.imageName ?? model.imageOf(r.parentName),
        badge: model.imageOf(r.name),
        look: "art",
        fallback: "foundry",
      };
    }),
  );

  // Complete sets you can sell, by item: their parts are better sold as a set.
  const setsFor = $derived.by(whileShown("parts", () => new Map(setRows(model).filter((s) => s.sellable > 0).map((s) => [s.name, s.sellable]))));

  // Keep: copies you need to build and master the item. Save: waiting for a set worth more whole.
  // Set: part of a complete set you can sell. Otherwise plat or ducats, at your ducat rate and
  // smallest sale worth a trade.
  type Verdict = "Keep" | "Save" | "Set" | "Sell" | "Ducats";
  const verdict = (r: PartRow): Verdict => {
    if (r.spare <= 0) return r.forSet > 0 && built(r) <= 0 ? "Save" : "Keep";
    if (r.inSets > 0) return "Set";
    return decide(r.price, r.ducats, r.tradesPerDay, advice, r.spare).verdict === "ducats" ? "Ducats" : "Sell";
  };
  const VERDICT_TITLE: Record<Verdict, string> = {
    Keep: "You need these to build and master the item",
    Save: "Waiting for its set: the set sells for more than its parts one by one, and you can still get the parts it's missing",
    Set: "Part of a complete set you can sell: sell the set",
    Sell: "Worth more on warframe.market than its ducats",
    Ducats: "Worth more to you as ducats at Baro Ki’Teer",
  };
  const LABEL: Record<Verdict, string> = { Keep: "Keep", Save: "Save for set", Set: "Sell as set", Sell: "Sell", Ducats: "Ducats" };

  const allColumns: Column<PartRow>[] = [
    { key: "name", label: "Part", value: (r) => r.name, defaultDesc: false, cell: nameCell, width: "min(26rem, 32%)" },
    { key: "qty", label: "Have", value: (r) => r.quantity, align: "right" },
    { key: "spare", minor: true, label: "Spare", value: (r) => r.spare, align: "right", title: "Copies beyond what you'd need to build an item you haven't mastered or built" },
    { key: "price", spare: true, label: "Price", value: (r) => r.price, align: "right", cell: priceCell },
    { key: "value", label: "Total", value: (r) => (r.price ?? 0) * qty(r), align: "right", cell: totalCell },
    { key: "ducats", spare: true, label: "Ducats", value: (r) => r.ducats, align: "right", cell: ducatCell },
    { key: "ratio", minor: true, label: "Duc/plat", value: (r) => (r.ducatsPerPlat == null ? null : Math.round(r.ducatsPerPlat * 10) / 10), align: "right", muted: true, title: "Ducats you get per platinum of market value" },
    { key: "verdict", label: "Best as", value: verdict, cell: verdictCell, defaultDesc: false },
    { key: "got", minor: true, label: "Got (30d)", value: (r) => drops.recent.get(r.name) ?? 0, align: "right", muted: true, title: "Copies that turned up in your inventory in the last 30 days, from relics or anything else; trades left out" },
    { key: "trades", minor: true, label: "Sold/day", value: (r) => (r.tradesPerDay == null ? null : Math.round(r.tradesPerDay * 10) / 10), align: "right", muted: true },
    { key: "avail", spare: true, label: "Vault", value: (r) => r.availability, cell: availCell, align: "center", defaultDesc: false },
    { key: "list", label: "", value: () => null, cell: listCell, sortable: false, align: "right" },
  ];
  const columns = $derived(spareMatters ? allColumns : allColumns.filter((c) => c.key !== "spare"));
  const pctOf = (x: number | null | undefined) => (x == null ? "–" : `${Math.round(x * 10) / 10}%`);
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
</script>

{#snippet nameCell(r: PartRow)}
  <Named file={model.imageOf(r.name)} name={r.name}>
    {#if built(r) > 0}<span class="tag" title="Held back so you can build {r.keptFor === r.parentName ? `and master ${r.parentName}` : `${r.parentName} for ${r.keptFor}`}">keep {built(r)}</span>{/if}
    {#if r.saving}<span class="tag good" title={savedLine(r.forSet, r.saving)}>for set {r.forSet}</span>{/if}
    {#if parent === "all" && !r.parentMastered}<span class="tag warn" title="{r.parentName} isn't mastered">{r.parentOwned ? "built" : "need"}</span>{/if}
  </Named>
{/snippet}
{#snippet priceCell(r: PartRow)}<P v={r.price} />{/snippet}
{#snippet totalCell(r: PartRow)}<P v={r.price == null ? null : r.price * qty(r)} />{/snippet}
{#snippet ducatCell(r: PartRow)}<P v={r.ducats} d dim />{/snippet}
{#snippet verdictCell(r: PartRow)}{@const v = verdict(r)}<span class="v-{v}" title={VERDICT_TITLE[v]}>{LABEL[v]}</span>{/snippet}
{#snippet listCell(r: PartRow, labelled = false)}
  {#if r.spare > 0 && r.inSets > 0}
    <ListButton {model} {labelled} name="{r.parentName} Set" label="Sell set" req={{ quantity: setsFor.get(r.parentName) ?? 1 }} />
  {:else if r.spare > 0}
    <ListButton {model} {labelled} name={r.name} req={{ quantity: r.spare }} />
  {/if}
{/snippet}
{#snippet availCell(r: PartRow)}<Avail v={r.availability} />{/snippet}
{#snippet card(r: PartRow, open: () => void)}
  {@const v = verdict(r)}
  {@const parentItem = model.catalogByUnique.get(r.parentUnique)}
  <ItemCard hover={r.name} title={r.parentName} sub={r.name.replace(`${r.parentName} `, "")} kind={kindIcon(parentItem?.category ?? null, r.parentName)} image={parentItem?.imageName ?? model.imageOf(r.parentName)} artSize={84} owned={r.spare > 0 && v !== "Keep"} ownedNote={v === "Ducats" ? `${r.spare} spare for Baro` : v === "Set" ? `${r.spare} spare, best sold in its set` : v === "Save" ? `${r.spare} spare, saved for its set` : `${r.spare} spare to sell`} onopen={open}>
    <span class="verdict v-{v}" title={VERDICT_TITLE[v]}>{#if v === "Sell"}<GameIcon name="platinum" size={14} />{:else if v === "Ducats"}<GameIcon name="ducats" size={14} />{:else if v === "Keep"}<Icon name="lock" size={13} />{:else}<Icon name="sets" size={13} />{/if}{LABEL[v]}</span>
    <div class="have">
      <Thumb file={model.imageOf(r.name)} name={r.name} size={26} />
      <b class="mark qty" title={spareOnly && spareMatters ? `${r.spare} spare (of ${r.quantity} held)` : `${r.quantity} held${r.keep ? `, ${r.spare} of them spare` : ""}`}>×{qty(r)}</b>
      {#if built(r)}<span class="dim small" title={r.keptFor === r.parentName ? `Held back to build ${r.parentName}, which you haven't mastered or built` : `Held back to build ${r.parentName} for ${r.keptFor}, which you haven't built`}>{built(r)} kept</span>{/if}
      {#if r.saving}<span class="dim small" title={savedLine(r.forSet, r.saving)}>{r.forSet} for the set</span>{/if}
    </div>
    <div class="vline"><P v={r.price} /><P v={r.ducats} d dim /></div>
    {#snippet foot()}
      <Avail v={r.availability} />
      {#if parent === "all" && !r.parentMastered}<span class="tag warn">{r.parentOwned ? "built" : "need"}</span>{/if}
      <span class="grow"></span>
      <button class="link" title="Open {r.parentName}'s set" aria-label="Open {r.parentName}'s set" onclick={() => details.open(r.parentUnique)}>Set ›</button>
      {@render listCell(r, true)}
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
    <span title="Copies that turned up in your inventory in the last 30 days, from relics or anything else; trades left out"><span class="register">Got (30d)</span><b>{drops.recent.get(r.name) ?? 0}</b></span>
    {#if r.tradesPerDay != null}<span title="How many sell on warframe.market in a day, on average"><span class="register">Sold/day</span><b>{Math.round(r.tradesPerDay * 10) / 10}</b></span>{/if}
    <span title={VERDICT_TITLE[v]}><span class="register">Best as</span><b class="v-{v}">{LABEL[v]}</b></span>
  </div>
  <p class="small dim">
    {built(r) ? `${built(r)} kept to build ${r.parentName}${r.keptFor === r.parentName ? "" : ` for ${r.keptFor}`}` : r.parentMastered ? `${r.parentName} is mastered: every copy is spare` : `${r.parentName} is built: every copy is spare`}{r.inSets ? ` · ${r.inSets} go into ${setsFor.get(r.parentName) ?? 0} complete set${setsFor.get(r.parentName) === 1 ? "" : "s"}` : ""}{r.spare - r.inSets > 0 ? ` · ${r.spare - r.inSets} loose ${v === "Ducats" ? "for ducats" : "to sell"}` : ""}
  </p>
  {#if r.saving}<p class="small saving">{savedLine(r.forSet, r.saving)}. Still to get: {r.saving.missing.map((x) => `${x.count > 1 ? `${x.count}× ` : ""}${x.name.replace(`${r.parentName} `, "")}`).join(", ")}.</p>{/if}
  {#if (r.tradesPerDay ?? 1) > 0}<div class="hist"><PriceHistory name={r.name} height={130} known={r.price != null || r.tradesPerDay != null} /></div>{/if}
  {#if src.length}
    <div class="odds">
      <span class="register">Drops from (intact → radiant)</span>
      {#each src.slice(0, 8) as s (s.base)}<span class="src" class:vaulted={s.vaulted && !s.resurgence} use:info={s.base}>{s.base} <span class="dim">{s.rarity} · {pctOf(s.chanceIntact)} → {pctOf(s.chanceRadiant)}</span></span>{/each}
      {#if src.length > 8}<span class="dim small">+{src.length - 8} more</span>{/if}
    </div>
  {/if}
  <div class="actions">
    {@render listCell(r, true)}
    {#if r.inSets > 0 && r.spare > r.inSets}<button class="stamp" onclick={(e) => { e.stopPropagation(); mkt.startListing(model, r.name, { quantity: r.spare - r.inSets }); }}>Or list {r.spare - r.inSets} loose</button>{/if}
    <button class="link" onclick={() => details.open(r.parentUnique)}>{r.parentName} ›</button>
    <button class="link" onclick={() => openUrl(marketUrl(r.name))}>warframe.market ↗</button>
  </div>
{/snippet}

<div class="page"><div class="page-inner">
  <PageHead title="Prime parts" brief="Each prime part's best use." blurb="Every prime part you hold and its best use: keep, save for its set, sell, sell as a set, or trade to Baro.">
    {#snippet hero()}
      <Showcase items={exhibits} caption={shelf.mode === "held" ? "Nothing to sell: your dearest parts" : "Your most valuable parts to sell"} note={shelf.mode === "held" ? "Each, at the daily median · click one for its details" : "By Worth selling · click one for its details"} empty="No prime parts yet: they turn up here from your relics once orbiter has read your inventory (press Sync)." />
    {/snippet}
    {#snippet band()}
      <Stat label="Worth selling" note={`${plural(selling.reduce((n, x) => n + x.copies, 0), "part")} · daily median, no more of each than sells in a month`} title="Worth selling: your spare parts best sold for platinum (Best as Sell), at the daily median, no more of each than the market sells in a month. Parts that go out inside a whole set are left out (sell the set, on Sets), as are the ones better traded to Baro for ducats or not worth a trade. Counted the same way on Mods, Arcanes and Home"><PTick v={asPlat} /></Stat>
      <Stat label="Spares for ducats" tone="gold" note={`${plural(spares.filter((r) => verdict(r) === "Ducats").reduce((n, r) => n + r.spare, 0), "part")}, better traded in`}><PTick v={asDucats} d /></Stat>
      <Stat keep label="Ducats held" tone="gold" note={baro ? (baroHere ? `Baro is here · leaves in ${until(baro.expiry)}` : `Baro arrives in ${until(baro.activation)}`) : "Baro's schedule unavailable"}><PTick v={heldDucats} d /></Stat>
    {/snippet}
  </PageHead>

  <!-- The filter box, what each part is best as, spares: what most visits need. The rest folds. -->
  <div class="bar">
    <input type="search" title="Shows only what matches what you type" placeholder="Filter parts…" bind:value={query} />
    <Seg label="Best as" bind:value={best} options={[{ v: "all", label: "All", title: "Whatever is best for each part" }, { v: "Sell", label: "Sell", title: "Worth more sold on its own" }, { v: "Set", label: "Set", title: "Worth more sold in a complete set" }, { v: "Ducats", label: "Ducats", title: "Worth more traded to Baro, at your ducat rate" }, { v: "Save", label: "Save", title: "Waiting for its set, which sells for more than its parts and whose missing parts you can still get (Settings → Selling)" }, { v: "Keep", label: "Keep", title: "You need it to build something you haven't mastered" }]} />
    {#if spareMatters}<Chip bind:on={spareOnly} label="Spare only" title="Leave out the copies you need to build something you haven't mastered" />{/if}
    <Fold on={[parent === "mastered" ? "mastered items" : parent === "unmastered" ? "not mastered" : "", avail !== "all" ? avail : ""].filter(Boolean).join(", ")} active={(parent !== "mastered" ? 1 : 0) + (avail !== "all" ? 1 : 0)} reset={() => { parent = "mastered"; avail = "all"; }}>
      <Seg
        label="Item"
        bind:value={parent}
        options={[
          { v: "all", label: "All", title: "Every prime part you hold" },
          { v: "mastered", label: "Mastered", title: "Parts of things you've already mastered: safe to sell or trade for ducats" },
          { v: "unmastered", label: "Not mastered", title: "Parts of things you haven't mastered: orbiter keeps what building them takes" },
        ]}
      />
      <Seg label="Relics" bind:value={avail} options={[{ v: "all", label: "All", title: "Farmable and vaulted alike" }, { v: "vaulted", label: "Vaulted", title: "Only vaulted relics drop it: no new copies, so prices tend to rise" }, { v: "farmable", label: "Farmable", title: "A relic that drops it can still be farmed: its price may drop" }]} />
    </Fold>
  </div>

  <Browse id="parts" bind:opened {rows} {columns} key={(r) => r.name} bind:sort {detail} {card} title={(r) => r.name} min="18rem" clear={filtered ? clear : null} empty="No prime parts of mastered items.">
    {#snippet tools()}
      <!-- Not filters: how Best as weighs platinum against ducats (Sell spares uses them too), so they sit at the end of the sort row rather than wrapping alone under the filters. -->
      <Fold label="Your rates" title="What a ducat is worth to you and the smallest sale worth a trade: how Best as weighs platinum against ducats (Sell spares uses the same)">
        <select bind:value={advice.platPerDucat} aria-label="What a ducat is worth to you" title="What a ducat is worth to you, from what you'd buy with them at Baro">
          {#each [...new Set([...RATES, advice.platPerDucat])].sort((a, b) => a - b) as r (r)}<option value={r}>1 ducat ≈ {r}p ({Math.round(1 / r)}:1)</option>{/each}
        </select>
        {#if advice.baroRate && advice.baroRate.rate !== advice.platPerDucat}
          {@const b = advice.baroRate}
          <button class="baro" title="On Baro's visit of {new Date(b.visit).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}, the best he had that sells daily was {b.item}: {b.ducats} ducats for something that sells for {b.price}p. Click to use {b.rate}p a ducat." onclick={() => (advice.platPerDucat = b.rate)}><GameIcon name="ducats" size={13} />Baro: {b.rate}p</button>
        {/if}
        <select bind:value={advice.minPlat} aria-label="Smallest sale worth a trade" title="Judged on the whole trade: up to 6 copies go in one, so five barrels at 3p are a 15p trade">
          {#each [0, 3, 5, 8, 10, 15] as n (n)}<option value={n}>{n ? `Not worth a trade under ${n}p a trade` : "Any price is worth a trade"}</option>{/each}
        </select>
      </Fold>
    {/snippet}
  </Browse>

  <!-- Baro week: parts that turn platinum into ducats cheapest, beyond the ones you hold. -->
  <section class="dbuy" id="ducat-buys">
    <header>
      <h2 class="register lead">Ducats for less</h2>
      <span class="dim small">{baro ? (baroHere ? `Baro is here: leaves in ${until(baro.expiry)}` : `Baro arrives in ${until(baro.activation)}`) : ""}{baro ? " · " : ""}parts that sell daily, most ducats per platinum at the daily median. Gold: at least {Math.round(1 / advice.platPerDucat)} ducats a platinum, your rate (above).</span>
    </header>
    <table class="dt">
      <thead><tr><th>Part</th><th class="r">Ducats</th><th class="r">Price</th><th class="r" title="Ducats per platinum at the daily median">Per plat</th><th class="r" title="How many sell a day on warframe.market">Sold/day</th><th></th></tr></thead>
      <tbody>
        {#each buys as b (b.name)}
          <tr>
            <td><Named file={model.imageOf(b.name)} name={b.name} size={24} /></td>
            <td class="r"><P v={b.ducats} d /></td>
            <td class="r"><P v={b.price} /></td>
            <td class="r"><b class:good={b.rate >= 1 / advice.platPerDucat}>{Math.round(b.rate * 10) / 10}</b></td>
            <td class="r dim">{b.tradesPerDay == null ? "–" : Math.round(b.tradesPerDay * 10) / 10}</td>
            <td class="r"><button class="link" title="Post a buy order on warframe.market for {b.name}: sellers whisper you" onclick={() => mkt.startBuy(b.name, { quantity: 5, known: b.price })}>Buy order</button></td>
          </tr>
        {/each}
      </tbody>
    </table>
  </section>
</div></div>

<style>
  .baro { display: inline-flex; align-items: center; gap: .4rem; color: var(--gold); border-color: var(--gold-dim); background: transparent; }
  .baro:hover:not(:disabled) { background: var(--gold); border-color: var(--gold); color: var(--slab); }
  .v-Keep, .v-Save, .v-Set, .v-Sell, .v-Ducats { white-space: nowrap; }
  .have { display: flex; align-items: center; gap: .55rem; }
  .qty { font-size: 1.05rem; color: var(--platinum-dim); }
  .vline { display: flex; align-items: center; gap: .9rem; font-size: .84rem; }
  /* A card leads with what to do with the part: a word and its icon, its colour as in the table.
     No border: the card's Sell button is the only thing on it that looks pressable. */
  .verdict {
    justify-self: start; display: inline-flex; align-items: center; gap: .4rem; padding: .1rem 0 .1rem .5rem;
    border-left: 2px solid currentColor;
    font-family: var(--face-register); font-size: .66rem; font-weight: 600; letter-spacing: .12em; text-transform: uppercase;
  }
  .grow { flex: 1; }
  .filters { padding-bottom: .6rem; }
  .second { padding-top: 0; }
  .v-Keep { color: var(--platinum-deep); }
  .v-Save { color: var(--verdigris); }
  .v-Set { color: var(--platinum); font-weight: 600; }
  .saving { color: var(--verdigris); margin: .2rem 0 .6rem; }
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
