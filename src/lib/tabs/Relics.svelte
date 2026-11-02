<script lang="ts">
  import { info } from "../hover.svelte";
  import { takeIntent } from "../intent.svelte";
  import { dropSpots, wishlistRelics } from "../core/wishlist";
  import { placeName } from "../core/describe";
  import { ERAS, type Model } from "../core/model";
  import { relicRows, unknownRelics, type RelicRow } from "../core/views";
  import type { Fissure } from "../core/types";
  import { marketUrl, openUrl } from "../backend";
  import Browse from "../ui/Browse.svelte";
  import ItemCard from "../ui/ItemCard.svelte";
  import { imageUrl } from "../backend";
  import P from "../ui/P.svelte";
  import Named from "../ui/Named.svelte";
  import Thumb from "../ui/Thumb.svelte";
  import Avail from "../ui/Avail.svelte";
  import Chip from "../ui/Chip.svelte";
  import Seg from "../ui/Seg.svelte";
  import Stat from "../ui/Stat.svelte";
  import PageHead from "../ui/PageHead.svelte";
  import { eraTint, matches, type Column } from "../ui/table";
  import Owned from "../ui/Owned.svelte";
  import { expectedBest } from "../core/advice";
  import ListButton from "../ui/ListButton.svelte";
  import GameIcon, { eraIcon, type GameIconName } from "../ui/GameIcon.svelte";
  import Foe from "../ui/Foe.svelte";

  import type { AdviceSettings } from "../backend";
  // Solo or radshare is one setting, shared with the Planner.
  // wishlist: what you starred; relics that drop a part for it are marked.
  let { model, advice = $bindable(), wishlist = [] }: { model: Model; advice: AdviceSettings; wishlist?: string[] } = $props();
  const forWish = $derived(wishlistRelics(model, wishlist));
  const wishTitle = (base: string) => `For your wishlist: ${(forWish.get(base) ?? []).map((x) => x.part).join(", ")}`;

  let era = $state<string>("all");
  let vault = $state<"all" | "vaulted" | "farmable" | "resurgence">("all");
  // A link that asked for an era or Varzia's relics (Home's fissures, Varzia's card).
  $effect(() => {
    const want = takeIntent("relics");
    if (!want) return;
    query = "";
    neededOnly = false;
    era = want.era ?? "all";
    vault = want.vault === "resurgence" || want.vault === "vaulted" || want.vault === "farmable" ? want.vault : "all";
  });
  let neededOnly = $state(false);
  let query = $state("");
  let sort = $state({ key: "evI", desc: true });
  /** Solo: one crack, your own reward. Radshare: four of the same relic, you pick the best of four. */
  const squad = $derived(advice.squad > 1 ? 4 : 1);

  const r1 = (x: number) => Math.round(x * 10) / 10;
  const evI = (r: RelicRow) => (r.evIntact == null ? null : squad === 1 ? r.evIntact : r1(expectedBest(r.outIntact, squad)));
  const evR = (r: RelicRow) => (r.evRadiant == null ? null : squad === 1 ? r.evRadiant : r1(expectedBest(r.outRadiant, squad)));
  const gain = (r: RelicRow) => {
    const i = evI(r);
    const g = evR(r);
    return i == null || g == null ? null : r1(g - i);
  };
  const pctFmt = (x: number | undefined) => (x == null ? "—" : `${Math.round(x * 10) / 10}%`);

  const all = $derived(relicRows(model, { platPerDucat: advice.platPerDucat }));
  const rows = $derived(
    all.filter(
      (r) =>
        (era === "all" || r.era === era) &&
        (vault === "all" || (vault === "resurgence" ? r.resurgence : vault === "vaulted" ? r.vaulted : !r.vaulted)) &&
        (!neededOnly || r.neededCount > 0) &&
        matches(query, r.base, ...r.rewards.map((x) => x.name)),
    ),
  );

  // Active fissures, grouped by era, from api.warframestat.us. The feed can lag and still list
  // fissures that have closed, so only the ones still open count, against a clock that ticks.
  let now = $state(Date.now());
  $effect(() => {
    const t = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(t);
  });
  const feed = $derived(model.live.fissures);
  const fissures = $derived((feed ?? []).filter((f) => new Date(f.expiry).getTime() > now));
  /** Omnia fissures take a Lith, Meso, Neo or Axi relic, so they're listed under each of those. */
  const omnia = $derived(fissures.filter((f) => f.tier === "Omnia"));
  /** Void Storms (Railjack): in the total of open fissures, on no era's card. */
  const stormCount = $derived(fissures.filter((f) => f.isStorm).length);
  const byEra = $derived.by(() => {
    const out = new Map<string, Fissure[]>();
    for (const f of fissures) {
      if (f.tier === "Omnia") continue;
      const list = out.get(f.tier) ?? [];
      list.push(f);
      out.set(f.tier, list);
    }
    return out;
  });
  /** Relics TennoScope's relic data doesn't know yet: counted, but with no rewards to show. */
  const unknown = $derived(unknownRelics(model).filter((u) => matches(query, u.base)));
  const filtering = $derived(era !== "all" || vault !== "all" || neededOnly || !!query.trim());
  function clearFilters() {
    era = "all";
    vault = "all";
    neededOnly = false;
    query = "";
  }
  const ownedEra = (e: string) => all.filter((r) => r.era === e).reduce((n, r) => n + r.total, 0) + unknown.filter((u) => u.era === e).reduce((n, u) => n + u.total, 0);
  const minutesLeft = (f: Fissure) => Math.max(0, Math.round((new Date(f.expiry).getTime() - now) / 60000));
  const left = (f: Fissure) => {
    const m = minutesLeft(f);
    return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
  };
  /** An era's fissures for its hover list: normal ones, then Omnia, Steel Path, Void Storms; soonest to close first. */
  const fissureOrder = (list: Fissure[]) =>
    [...list].sort((a, b) => Number(a.isStorm) - Number(b.isStorm) || Number(a.isHard) - Number(b.isHard) || Number(a.tier === "Omnia") - Number(b.tier === "Omnia") || a.expiry.localeCompare(b.expiry));
  const rareOf = (r: RelicRow) => r.rewards.find((x) => x.rarity === "Rare")?.name;

  const columns: Column<RelicRow>[] = $derived([
    { key: "base", label: "Relic", value: (r) => r.base, sortValue: (r) => {
      // "Axi A22" → era order, then letter, then the number padded: A2 < A10 < A22 < B1.
      const [, letter = "", num = "0"] = r.base.split(" ")[1]?.match(/^([A-Za-z]*)(\d*)$/) ?? [];
      return `${ERAS.indexOf(r.era as (typeof ERAS)[number])}${letter}${num.padStart(3, "0")}`;
    }, defaultDesc: false, cell: baseCell },
    { key: "owned", label: "Owned", value: (r) => r.total, cell: ownedCell, align: "right" },
    { key: "vault", label: "Vault", value: (r) => (r.resurgence ? "resurgence" : r.vaulted ? "vaulted" : "farmable"), cell: vaultCell, defaultDesc: false },
    { key: "need", label: "Parts you need", value: (r) => r.neededCount || null, align: "right", title: "Rewards that are parts of something you haven't built or mastered, and you don't have yet" },
    { key: "evI", label: squad === 1 ? "Intact" : "Intact ×4", value: evI, align: "right", cell: evICell, title: squad === 1 ? "Average platinum from one crack of the intact relic" : "Average platinum of the best of four intact cracks (a radshare where everyone brings this relic)" },
    { key: "evR", label: squad === 1 ? "Radiant" : "Radiant ×4", value: evR, align: "right", cell: evRCell, title: squad === 1 ? "Average platinum from one crack of the radiant relic" : "Average platinum of the best of four radiant cracks" },
    { key: "gain", label: "Radiant gain", value: gain, align: "right", cell: gainCell, title: "How much more a radiant crack is worth than an intact one, on average. Refining costs 100 Void Traces." },
    { key: "ducats", minor: true, label: "Avg ducats", value: (r) => r.evDucatsIntact || null, align: "right", cell: ducatCell },
    { key: "relicPrice", minor: true, label: "Sell relic", value: (r) => r.relicPrice, align: "right", cell: relicPriceCell, title: "warframe.market price of the intact relic" },
    { key: "list", label: "", value: () => null, cell: listCell, sortable: false, align: "right" },
  ]);
</script>

{#snippet baseCell(r: RelicRow)}<Named file={model.imageOf(r.base)} name={r.base} tint={eraTint(r.base)}>{#if forWish.has(r.base)}<span class="tag ok" title={wishTitle(r.base)}>wishlist</span>{/if}</Named>{/snippet}
{#snippet ownedCell(r: RelicRow)}<Owned owned={r.owned} />{/snippet}
{#snippet vaultCell(r: RelicRow)}<Avail v={r.resurgence ? "resurgence" : r.vaulted ? "vaulted" : "farmable"} />{/snippet}
{#snippet evICell(r: RelicRow)}<P v={evI(r)} />{/snippet}
{#snippet evRCell(r: RelicRow)}<P v={evR(r)} />{/snippet}
{#snippet gainCell(r: RelicRow)}{@const g = gain(r)}{@const i = evI(r)}{#if g != null}<span class="gain" class:big={g >= 2}>+<P v={g} dim={g < 2} />{#if i}<span class="pct">{Math.round((g / i) * 100)}%</span>{/if}</span>{/if}{/snippet}
{#snippet listCell(r: RelicRow)}<ListButton {model} name="{r.base} Relic" />{/snippet}
{#snippet ducatCell(r: RelicRow)}<P v={r.evDucatsIntact || null} d dim />{/snippet}
{#snippet relicPriceCell(r: RelicRow)}<P v={r.relicPrice} dim />{/snippet}
{#snippet card(r: RelicRow, open: () => void)}
  <ItemCard hover={r.base} title={r.base} sub={rareOf(r) ? `Rare · ${rareOf(r)}` : undefined} image={model.imageOf(r.base)} fallback={eraIcon(r.base.split(" ")[0])} artSize={78} owned={r.neededCount > 0} tint={eraTint(r.base)} onopen={open}>
    <div class="rw">
      {#each r.rewards as x, i (i)}
        <span class="rwc rar-{x.rarity}" class:need={x.needed} class:done={x.parentMastered && !x.needed} use:info={x.name}>
          {#if model.imageOf(x.name)}<img src={imageUrl(model.imageOf(x.name) ?? "")} alt="" loading="lazy" onerror={(e) => ((e.currentTarget as HTMLImageElement).style.visibility = "hidden")} />{/if}
          {#if x.needed}<i></i>{/if}
        </span>
      {/each}
    </div>
    <div class="ev">
      <span><span class="register">{squad === 1 ? "Intact" : "Intact ×4"}</span><P v={evI(r)} /></span>
      <span><span class="register">{squad === 1 ? "Radiant" : "Radiant ×4"}</span><P v={evR(r)} /></span>
    </div>
    {#snippet foot()}
      <Avail v={r.resurgence ? "resurgence" : r.vaulted ? "vaulted" : "farmable"} />
      <Owned owned={r.owned} />
      <span class="grow"></span>
      {#if forWish.has(r.base)}<span class="tag ok" title={wishTitle(r.base)}>wishlist</span>{:else if r.neededCount}<span class="tag warn" title="Rewards you still need">{r.neededCount} you need</span>{/if}
      <ListButton {model} name="{r.base} Relic" />
    {/snippet}
  </ItemCard>
{/snippet}

{#snippet detail(r: RelicRow)}
  {@const spots = dropSpots(model.relicGroups.get(r.base)?.byRefinement.Intact?.drops ?? [])}
  <div class="dhead">
    <Avail v={r.resurgence ? "resurgence" : r.vaulted ? "vaulted" : "farmable"} />
    {#if r.total}<span class="refs">{#each Object.entries(r.owned).filter(([, n]) => n > 0) as [ref, n] (ref)}<span><b>{n}</b> {ref}</span>{/each}</span>{:else}<span class="dim small">None held</span>{/if}
    {#if r.relicPrice != null}<span class="dim small">sells for</span><P v={r.relicPrice} />{/if}
    <span class="grow"></span>
    {#if r.total}<ListButton {model} name="{r.base} Relic" />{/if}
  </div>
  {#if spots.length}
    <p class="small farm"><span class="register">Farm it</span>{#each spots as sp, i (sp.location)}{i ? " · " : ""}{placeName(sp.location)} <span class="dim">{pctFmt(sp.chance)}</span>{/each}</p>
  {:else if r.resurgence}
    <p class="small farm"><span class="register">Get it</span>From Varzia this rotation, for Aya or Regal Aya</p>
  {:else if r.vaulted}
    <p class="small farm dim">Vaulted: it drops nowhere now. Buy it, or wait for Varzia to bring it back.</p>
  {/if}
  <table class="rewards">
    <thead>
      <tr>
        <th>Reward</th><th>Rarity</th>
        <th class="right" title="Chance from an intact relic">Intact</th><th class="right" title="Chance from a radiant relic">Radiant</th>
        <th class="right" title="How many you hold">Held</th><th class="right">Price</th><th class="right">Ducats</th>
      </tr>
    </thead>
    <tbody>
      {#each r.rewards as x (x.name)}
        <tr class:need={x.needed} class:done={x.parentMastered && !x.needed}>
          <td><div class="rn"><span class="rn-name" use:info={x.name}><Thumb file={model.imageOf(x.name)} size={22} /><span>{x.name}</span></span>{#if x.needed}<span class="tag warn">need</span>{:else if x.parentMastered}<span class="register mastered" title="You've mastered what this builds">mastered</span>{/if}</div></td>
          <td class="rar rar-{x.rarity}">{x.rarity}</td>
          <td class="dim right">{pctFmt(x.chance)}</td>
          <td class="right r-chance">{pctFmt(x.chanceRadiant)}</td>
          <td class="dim right">{x.owned || ""}</td>
          <td class="right"><P v={x.price} /></td>
          <td class="right"><P v={x.ducats} d dim /></td>
        </tr>
      {/each}
    </tbody>
  </table>
  <div class="detail-foot">
    <p class="small dim">
      Average per crack, solo: intact <P v={r.evIntact} />, radiant <P v={r.evRadiant} />. Best of a four-relic radshare:
      intact <P v={r.evIntact == null ? null : r1(expectedBest(r.outIntact, 4))} />, radiant <P v={r.evRadiant == null ? null : r1(expectedBest(r.outRadiant, 4))} />.
      Kuva, Riven Slivers and Forma count as nothing.
    </p>
    <button class="link" onclick={() => openUrl(marketUrl(`${r.base} Relic`))}>warframe.market ↗</button>
  </div>
{/snippet}

<div class="page"><div class="page-inner">
  <PageHead title="Relics" blurb="Your relics, and what one crack of each is worth: each reward at its price, or its ducats at your rate (Prime parts) when that's more.">
    {#snippet band()}
      {@const filtered = rows.length !== all.length}
      <Stat label="Relics" note={filtered ? "Matching the filters" : unknown.length ? `All refinements, with ${unknown.reduce((n, u) => n + u.total, 0)} not in the relic list` : "Across all refinements"}>
        {(rows.reduce((n, r) => n + r.total, 0) + (filtered ? 0 : unknown.reduce((n, u) => n + u.total, 0))).toLocaleString("en")}
      </Stat>
      <Stat label="Vaulted kinds" tone="gold" note="No new copies drop">{rows.filter((r) => r.vaulted).length}</Stat>
      <Stat label="With parts you need" note="Worth cracking">{rows.filter((r) => r.neededCount).length}</Stat>
    {/snippet}
  </PageHead>
  <div class="era-head">
    <h2 class="register">Eras</h2>
    <span class="dim small">{fissures.length ? "Pick an era to see the relics you can crack in its fissures right now. Hover for the missions." : feed ? "No fissures are open right now (the feed may be catching up); pick an era to filter." : "Live fissures are unavailable (api.warframestat.us didn't answer); pick an era to filter."}</span>
  </div>
  <section class="eras" aria-label="Eras">
    <button class="era all" class:on={era === "all"} aria-pressed={era === "all"} onclick={() => (era = "all")}>
      <strong><GameIcon name="void-tear" size={22} />All</strong>
      <span class="dim small" title={stormCount ? "The era cards count normal and Steel Path fissures; Void Storms are Railjack missions" : undefined}>{fissures.length ? `${fissures.length} fissure${fissures.length === 1 ? "" : "s"} open${stormCount ? `, ${stormCount} of them Void Storms` : ""}` : "every era"}</span>
      <span class="small">you have {(all.reduce((n, r) => n + r.total, 0) + unknown.reduce((n, u) => n + u.total, 0)).toLocaleString("en")}</span>
    </button>
    {#each ERAS.filter((e) => ownedEra(e) > 0 || byEra.has(e)) as e (e)}
      {@const list = [...(byEra.get(e) ?? []), ...(e === "Requiem" ? [] : omnia)]}
      <div class="era-cell">
        <button class="era" class:on={era === e} aria-pressed={era === e} style:--tint={eraTint(e)} onclick={() => (era = era === e ? "all" : e)}>
          <strong><GameIcon name={eraIcon(e)} size={22} />{e}</strong>
          <span class="dim small counts">
            {#if list.length}
              <!-- As Home counts them: this era's own fissures, normal + Steel Path; Omnia ones apart. -->
              {@const own = (byEra.get(e) ?? []).filter((f) => !f.isStorm)}
              {@const sp = own.filter((f) => f.isHard).length}
              {@const om = e === "Requiem" ? 0 : omnia.filter((f) => !f.isStorm).length}
              <span>{own.length - sp}{#if sp}<span class="sp" title="Steel Path">&nbsp;+&nbsp;{sp}&nbsp;<GameIcon name="steel-essence" size={11} /></span>{/if} open</span>
              {#if om}<span title="Omnia fissures take a Lith, Meso, Neo or Axi relic (not Requiem)">{om} Omnia</span>{/if}
            {:else}<span title={feed == null ? "The fissure list (api.warframestat.us) hasn't answered" : undefined}>{feed == null ? "fissures unknown" : "no fissure now"}</span>{/if}
          </span>
          <span class="small">you have {ownedEra(e).toLocaleString("en")}</span>
        </button>
        {#if list.length}
          <div class="fz" role="tooltip">
            <div class="register">{e} fissures now</div>
            {#each fissureOrder(list) as f (f.id)}
              <div class="fz-row">
                <span class="fz-type">{f.missionType}</span>
                <span class="fz-node">{f.node} <Foe enemy={f.enemy} size={12} name={false} /></span>
                <span class="fz-kind">{#if f.isStorm}<span class="tag"><GameIcon name="railjack" size={11} /> Void Storm</span>{:else if f.isHard}<span class="tag ok"><GameIcon name="steel-essence" size={11} /> Steel Path</span>{/if}{#if f.tier === "Omnia"}<span class="tag" title="Takes a Lith, Meso, Neo or Axi relic">Omnia</span>{/if}</span>
                <span class="fz-t">{left(f)}</span>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/each}
  </section>
  <div class="bar">
  <Seg bind:value={vault} options={[{ v: "all", label: "All", title: "Every relic you hold" }, { v: "vaulted", label: "Vaulted", title: "Relics that drop nowhere now: no new copies, so they tend to sell for more" }, { v: "farmable", label: "Farmable", title: "Relics that still drop in missions" }, { v: "resurgence", label: "Varzia", title: "Relics Varzia sells this rotation (Prime Resurgence), for Aya or Regal Aya" }]} />
  <Chip bind:on={neededOnly} label="Has parts I need" title="Only relics that drop a part for something you haven't built or mastered" />
  <Seg bind:value={advice.squad} options={[{ v: 1, label: "Solo", title: "One crack, your own reward" }, { v: 4, label: "Radshare", title: "Four players crack the same relic and you pick the best of the four rewards" }]} />
  <input type="search" placeholder="Relic or reward…" bind:value={query} />
  </div>

  <Browse id="relics" {rows} {columns} key={(r) => r.base} tint={(r) => eraTint(r.base)} bind:sort {detail} {card} title={(r) => `${r.base} Relic`} min="21rem" empty={filtering ? "No relics match these filters." : "No relics yet."} />
  {#if filtering && !rows.length}<p class="clear"><button class="link" onclick={clearFilters}>Clear the filters</button></p>{/if}
  {#if unknown.length}
    <div class="unknown">
      <div class="register">Not in the relic data yet</div>
      <p class="small">
        {unknown.reduce((n, u) => n + u.total, 0)} of your relics aren't in the drop tables or TennoScope's relic list yet, so their rewards
        and value can't be worked out. They move up into the table once either has them.
      </p>
      <p class="small names">{#each unknown as u, i (u.base)}{i ? " · " : ""}<span class="unk" use:info={u.base}>{u.base}</span>&nbsp;<span class="dim">×{u.total}</span>{/each}</p>
    </div>
  {/if}
</div></div>

<style>
  .clear { margin: .4rem 0 0; }
  .dhead { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem 1rem; margin-bottom: .6rem; }
  .refs { display: inline-flex; gap: .8rem; font-size: .82rem; color: var(--platinum-dim); }
  .refs b { color: var(--platinum); font-family: var(--face-mark); font-size: 1rem; }
  .farm { margin: 0 0 .7rem; display: flex; flex-wrap: wrap; align-items: baseline; gap: .1rem .4rem; }
  .farm .register { font-size: .6rem; color: var(--gold-dim); margin-right: .3rem; }
  .era-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: .3rem 1rem; margin-top: var(--step); }
  .era-head h2 { margin: 0; }
  .eras { display: grid; grid-template-columns: repeat(auto-fit, minmax(9.5rem, 1fr)); gap: .5rem; padding: .7rem 0 0; }
  /* Six eras: one row, or three by two, never five and a stray. */
  :global(html[data-room~="lt1100"]) .eras { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .era-cell { position: relative; display: grid; }
  .era { display: grid; align-content: start; text-align: left; gap: .15rem; padding: .6rem .9rem .7rem; font-family: var(--face-text); font-weight: 400; letter-spacing: 0; text-transform: none; clip-path: var(--cut); background: var(--plate); box-shadow: inset 3px 0 0 var(--tint, var(--rule-control)); }
  .era strong { display: inline-flex; align-items: center; gap: .45rem; font-family: var(--face-mark); font-size: 1.15rem; letter-spacing: .01em; color: var(--platinum); }
  .era:hover:not(:disabled) { background: var(--raised); }
  .era:focus-visible { outline: none; box-shadow: inset 3px 0 0 var(--tint, var(--rule-control)), inset 0 0 0 1px var(--gold); }
  .era.on { border-color: var(--gold); background: var(--raised); box-shadow: inset 3px 0 0 var(--tint, var(--gold)), inset 0 2px 0 var(--gold); }
  /* One fact a line: the era's own fissures, then the Omnia ones. */
  .counts { display: grid; }
  /* An era's live fissures, on hover: which missions, which are Steel Path or storms, how long they're open. */
  .fz {
    position: absolute; z-index: 30; top: calc(100% + 6px); left: 0; width: max-content; min-width: 100%; max-width: 34rem; pointer-events: none;
    display: none; gap: .3rem; padding: .7rem .8rem .6rem; font-size: .8rem;
    background: linear-gradient(180deg, #1c1e24, #14161a); border: 1px solid var(--rule-bright);
    box-shadow: 0 1.2rem 3rem rgb(0 0 0 / 60%), inset 0 2px 0 var(--tint, var(--gold-dim));
  }
  /* Keyboard focus shows it too, but not the focus a click leaves behind. */
  .era-cell:hover .fz, .era-cell:has(.era:focus-visible) .fz { display: grid; animation: pop .12s ease-out; }
  .era-cell:nth-last-child(-n + 2) .fz { left: auto; right: 0; }
  @keyframes pop { from { opacity: 0; transform: translateY(3px); } }
  .fz .register { font-size: .6rem; margin-bottom: .15rem; }
  .fz-row { display: grid; grid-template-columns: 7.5rem 1fr auto 3.4rem; align-items: center; gap: .7rem; padding-top: .3rem; border-top: 1px solid var(--rule); }
  .fz-type { color: var(--platinum); }
  .fz-node { color: var(--platinum-dim); white-space: nowrap; }
  .fz-kind { display: inline-flex; gap: .3rem; }
  .fz-kind .tag { margin: 0; }
  .fz-t { text-align: right; font-family: var(--face-register); font-size: .66rem; color: var(--platinum-deep); white-space: nowrap; }
  .rewards { border-collapse: collapse; margin-bottom: 0.6rem; min-width: 34rem; font-variant-numeric: tabular-nums; }
  .rewards td { padding: 0.25rem 1rem 0.25rem 0; border: 0; border-top: 1px solid var(--rule); }
  .rewards tbody tr:first-child td { border-top: 0; }
  .rn { display: flex; align-items: center; white-space: nowrap; }
  .rn-name { display: inline-flex; align-items: center; gap: .5rem; }
  .rewards tr.need .rn-name { color: var(--gold); font-weight: 600; }
  .rewards tr.done .rn-name span { color: var(--platinum-deep); }
  .rn .tag { margin-left: .5rem; vertical-align: 0; }
  .mastered { margin-left: .6rem; font-size: .6rem; color: var(--platinum-deep); }
  .rar { font-size: 0.75rem; }
  .rar-Rare { color: var(--gold); }
  .rar-Uncommon { color: var(--platinum); }
  .rar-Common { color: var(--platinum-dim); }
  .right { text-align: right; }
  .unknown { margin-top: var(--step); padding: 1rem 1.2rem; border: 1px solid var(--rule); background: var(--well); box-shadow: inset 3px 0 0 var(--gold-dim); display: grid; gap: .45rem; }
  .unknown .register { color: var(--gold); }
  .unknown p { margin: 0; }
  .unknown .names { color: var(--platinum-dim, var(--platinum)); line-height: 1.7; }
  .detail-foot { display: flex; flex-wrap: wrap; align-items: baseline; gap: .4rem 1.4rem; }
  .detail-foot p { margin: 0; flex: 1 1 30rem; }
  .unk { color: var(--platinum); }
  .rewards th { font-family: var(--face-register); font-weight: 500; font-size: .6rem; letter-spacing: .14em; text-transform: uppercase; color: var(--platinum-deep); padding: 0 .8rem .3rem 0; text-align: left; }
  .rewards th.right { text-align: right; }
  .r-chance { color: var(--gold); }
  .gain { display: inline-flex; align-items: center; white-space: nowrap; color: var(--platinum-dim); }
  .gain.big { color: var(--gold); }
  .pct { margin-left: .45rem; font-size: .72rem; color: var(--platinum-deep); }
  .rw { display: grid; grid-template-columns: repeat(6, 30px); gap: .35rem; }
  .rwc { position: relative; width: 30px; height: 30px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; background: radial-gradient(circle at 50% 35%, #1d2026, var(--well)); box-shadow: inset 0 0 0 1.5px var(--rule-bright); }
  .rwc img { width: 76%; height: 76%; object-fit: contain; border-radius: 50%; }
  .rwc.rar-Common { box-shadow: inset 0 0 0 1.5px #8a6a4a; }
  .rwc.rar-Uncommon { box-shadow: inset 0 0 0 1.5px #a9b0ba; }
  .rwc.rar-Rare { box-shadow: inset 0 0 0 1.5px var(--gold); }
  .rwc.done img { opacity: .45; }
  .rwc i { position: absolute; right: -2px; top: -2px; width: 8px; height: 8px; background: var(--gold); transform: rotate(45deg); box-shadow: 0 0 0 2px var(--plate); }
  .ev { display: flex; gap: 1.1rem; }
  .ev > span { display: grid; gap: .15rem; }
  .ev .register { font-size: .6rem; }
  .grow { flex: 1; }
</style>
