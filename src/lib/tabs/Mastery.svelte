<script lang="ts">
  import Fold from "../ui/Fold.svelte";
  import Tabs from "../ui/Tabs.svelte";
  import { info } from "../hover.svelte";
  import type { Model } from "../core/model";
  import { masteryRows, type MasteryRow } from "../core/views";
  import { METHOD_LABEL, rankLabel, rankThreshold } from "../core/acquire";
  import Effort from "../ui/Effort.svelte";
  import GameIcon, { kindIcon } from "../ui/GameIcon.svelte";
  import Browse from "../ui/Browse.svelte";
  import ItemCard from "../ui/ItemCard.svelte";
  import PartChip from "../ui/PartChip.svelte";
  import { collectionItem } from "../core/collection";
  import { details } from "../details.svelte";
  import { finishOdds } from "../core/wishlist";
  import P from "../ui/P.svelte";
  import Named from "../ui/Named.svelte";
  import Thumb from "../ui/Thumb.svelte";
  import Avail from "../ui/Avail.svelte";
  import Chip from "../ui/Chip.svelte";
  import Seg from "../ui/Seg.svelte";
  import Stat from "../ui/Stat.svelte";
  import PageHead from "../ui/PageHead.svelte";
  import { matches, type Column } from "../ui/table";
  import { marketUrl, openUrl, wikiUrl } from "../backend";
  import { itemReadyTimes, levelStage } from "../core/foundry";
  import { until } from "../core/traders";
  import PlatMastery from "../ui/PlatMastery.svelte";
  import CodexRings from "../ui/CodexRings.svelte";
  import { codexRings, rowGroup, someNames } from "../core/codex";
  import type { Group } from "../core/collection";
  import { keepWhile, shownPage, whenIdle, whileShown } from "../pane.svelte";

  let { model, masteryRank = null, wishlist = $bindable([]), foundryReady = [] }: { model: Model; masteryRank?: number | null; wishlist?: string[]; foundryReady?: [string, number][] } = $props();
  // Things you only have to level: in your arsenal, built and waiting in the Foundry, or building.
  let now = $state(Date.now());
  $effect(() => {
    const t = setInterval(() => (now = Date.now()), 60_000);
    return () => clearInterval(t);
  });
  const readyAt = $derived.by(whileShown("mastery", () => itemReadyTimes(model, foundryReady)));
  const stageOf = (r: MasteryRow) => levelStage(model, r.unique, readyAt, now);
  const stageTag = (r: MasteryRow) => {
    const s = stageOf(r);
    return s.stage === "claim" ? "Built · claim it in the Foundry" : s.stage === "building" ? `Building${s.readyAt ? ` · ready in ${until(new Date(s.readyAt).toISOString(), now)}` : ""}` : "Owned · level it";
  };
  const rankTo = (r: MasteryRow) => (r.points === 4000 || r.points === 8000 ? 40 : 30);
  const stageText = (r: MasteryRow) => {
    const s = stageOf(r);
    return s.stage === "claim" ? `Built and waiting in your Foundry: claim it, then rank it to ${rankTo(r)} for the mastery.` : s.stage === "building" ? `Building in your Foundry${s.readyAt ? `, ready in ${until(new Date(s.readyAt).toISOString(), now)}` : ""}: then rank it to ${rankTo(r)}.` : `In your arsenal: rank it to ${rankTo(r)} for the mastery.`;
  };
  const wished = $derived.by(whileShown("mastery", () => new Set(wishlist)));
  const toggleWish = (u: string) => (wishlist = wished.has(u) ? wishlist.filter((x) => x !== u) : [u, ...wishlist]);
  /** Chance of every missing part from the relics you hold (primes whose parts all come from relics). */
  const odds = (r: MasteryRow) => (r.isPrime && r.missingParts.length && r.missingParts.every((p) => p.sources.length) ? finishOdds(model, r.missingParts) : null);
  const pct = (x: number) => (x >= 0.995 ? "99%+" : x > 0 && x < 0.005 ? "<1%" : `${Math.round(x * 100)}%`);

  let query = $state("");
  let category = $state("all");
  let kind = $state<"all" | "prime" | "normal">("all");
  let effort = $state<"all" | "2" | "3" | "4">("all");
  let showUnavailable = $state(false);
  /** A Codex ring picked above: one category, its kinds together (Archwing with arch-guns and arch-melee). */
  let ring = $state<Group | null>(null);
  let sort = $state({ key: "effort", desc: false });
  /** Easiest first, or what platinum buys, cheapest first. */
  let view = $state<"effort" | "plat">("effort");

  // Show unavailable only adds, so on its own it hides nothing.
  const filtered = $derived(!!query.trim() || category !== "all" || ring != null || kind !== "all" || effort !== "all");
  function clear() {
    query = "";
    category = "all";
    ring = null;
    kind = "all";
    effort = "all";
    showUnavailable = false;
  }

  const all = $derived.by(whileShown("mastery", () => masteryRows(model)));
  const categories = $derived([...new Set(all.map((r) => r.category))].sort());
  const rows = $derived(
    all.filter(
      (r) =>
        (showUnavailable || r.acq.available) &&
        (category === "all" || r.category === category) &&
        (ring == null || rowGroup(model, r.unique, r.category) === ring) &&
        (kind === "all" || (kind === "prime") === r.isPrime) &&
        (effort === "all" || r.acq.difficulty <= Number(effort)) &&
        matches(query, r.name, r.type, METHOD_LABEL[r.acq.method]),
    ),
  );
  // The two views (tabs): both stay drawn once drawn (the other too, once the page is on screen and
  // idle), the one not chosen hidden and keeping its rows until it's shown again; switching is then
  // only showing it.
  let drawnPlat = $state(false);
  let drawnEffort = $state(false);
  $effect.pre(() => {
    if (view === "plat") drawnPlat = true;
    else drawnEffort = true;
  });
  $effect(() => {
    if (shownPage("mastery") && !(drawnPlat && drawnEffort)) return whenIdle(() => (drawnPlat = drawnEffort = true));
  });
  const platRows = $derived.by(keepWhile(() => view === "plat", () => rows));
  const effortRows = $derived.by(keepWhile(() => view !== "plat", () => rows));
  const open = $derived(all.filter((r) => r.acq.available));
  const pts = (rs: MasteryRow[]) => rs.reduce((n, r) => n + r.points, 0);
  const levelRows = $derived(open.filter((r) => r.acq.difficulty === 0));
  const easyRows = $derived(open.filter((r) => r.acq.difficulty >= 1 && r.acq.difficulty <= 2));
  /** Easiest first; among equally easy things, the one you're closest to having, then the most mastery. */
  const effortOrder = (r: MasteryRow) => r.acq.difficulty * 100_000 + (r.partsTotal ? (1 - r.partsOwned / r.partsTotal) * 50_000 : 50_000) - r.points;


  const columns: Column<MasteryRow>[] = [
    { key: "name", label: "Item", value: (r) => r.name, defaultDesc: false, cell: nameCell, width: "min(19rem, 24%)" },
    // Easiest first; among equally easy things, the one you're closest to having (Saryn with 3 of
    // 4 parts before Loki with 1), then the one worth the most mastery.
    { key: "effort", label: "Effort", value: (r) => r.acq.difficulty, sortValue: effortOrder, cell: effortCell, defaultDesc: false, title: "How hard it is to get: 0 you have it, 1 buy and build … 5 Liches and the like" },
    { key: "points", label: "Mastery", value: (r) => r.points, align: "right", cell: pointsCell, title: "Mastery points at max rank" },
    { key: "how", label: "How to get it", value: (r) => r.acq.how, cell: howCell, sortable: false },
    { key: "buy", spare: true, label: "Buy parts", value: (r) => r.buyFor, align: "right", cell: buyCell, title: "Primes: what the parts you're missing cost on warframe.market (daily median)" },
    { key: "parts", minor: true, label: "Parts", value: (r) => (r.status === "level" || !r.partsTotal ? null : `${r.partsOwned}/${r.partsTotal}`), sortValue: (r) => (r.partsTotal ? r.partsOwned / r.partsTotal : null), align: "right" },
    { key: "category", minor: true, label: "Type", value: (r) => r.category, muted: true, defaultDesc: false },
    { key: "star", label: "", value: () => null, cell: starCell, sortable: false, align: "right" },
  ];
  const things = (n: number, one = "thing", many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const rings = $derived.by(whileShown("mastery", () => codexRings(model)));
  /** A kind picked in the list lights its ring, when it falls in one. */
  const KIND_RING: Record<string, Group> = { Warframe: "warframes", Primary: "primary", Secondary: "secondary", Melee: "melee", Companion: "companions", Archwing: "archwing", "Arch-Gun": "archwing", "Arch-Melee": "archwing" };
  const lit = $derived(ring ?? KIND_RING[category] ?? null);
  function pickRing(g: Group) {
    ring = lit === g ? null : g;
    category = "all";
  }
  // What the figures don't say: which things, by name, in the category picked on the rings. What
  // you own to rank up (the most mastery first), then the easiest thing to get next.
  const nextLine = $derived.by(() => {
    const inRing = (r: MasteryRow) => lit == null || rowGroup(model, r.unique, r.category) === lit;
    const scope = lit == null ? "" : `${rings.find((x) => x.group === lit)?.label ?? ""}: `;
    const level = levelRows.filter(inRing).sort((a, b) => b.points - a.points || a.name.localeCompare(b.name)).map((r) => r.name);
    const [easiest] = open.filter((r) => r.acq.difficulty > 0 && inRing(r)).sort((a, b) => effortOrder(a) - effortOrder(b));
    const said = [level.length ? `rank up ${someNames(level)}` : "", easiest ? `easiest to get next: ${easiest.name}` : ""].filter(Boolean).join(" · ") || "nothing left you can get here";
    return scope ? `${scope}${said}` : said[0].toUpperCase() + said.slice(1);
  });
</script>

{#snippet nameCell(r: MasteryRow)}<Named file={model.imageOf(r.name)} name={r.name} />{/snippet}
{#snippet starCell(r: MasteryRow)}
  {#if model.catalogByUnique.has(r.unique)}
    {@const on = wished.has(r.unique)}
    <button class="star" class:on aria-pressed={on} aria-label={on ? `Remove ${r.name} from your wishlist` : `Add ${r.name} to your wishlist`} title={on ? "On your wishlist (click to remove)" : "Add to your wishlist"} onclick={(e) => { e.stopPropagation(); toggleWish(r.unique); }}>
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 1.6l1.9 4.1 4.5.5-3.4 3 1 4.4L8 11.4l-4 2.2 1-4.4-3.4-3 4.5-.5z" /></svg>
    </button>
  {/if}
{/snippet}
{#snippet effortCell(r: MasteryRow)}<span class="ecell"><Effort acq={r.acq} /></span>{/snippet}
{#snippet pointsCell(r: MasteryRow)}<span class="pts"><GameIcon name="mastery" size={14} />{r.points.toLocaleString("en")}</span>{/snippet}
{#snippet buyCell(r: MasteryRow)}{#if r.buyFor != null}<P v={r.buyFor} />{:else}<span class="dim" title={r.isPrime ? "No price for the parts you're missing" : "Only primes' parts are priced here"}>–</span>{/if}{/snippet}
{#snippet howCell(r: MasteryRow)}
  <span class="how" title={r.acq.how}>
    {#if r.isPrime && r.missingParts.length}
      {@const worst = r.missingParts.some((p) => p.availability === "vaulted") ? "vaulted" : r.missingParts.some((p) => p.availability === "resurgence") ? "resurgence" : "farmable"}
      <Avail v={worst} />
    {/if}
    {r.acq.difficulty === 0 ? (stageOf(r).stage === "level" ? "You have it: level it to max rank." : stageTag(r)) : r.acq.how}
  </span>
{/snippet}

{#snippet card(r: MasteryRow, open: () => void)}
  {@const item = model.catalogByUnique.get(r.unique)}
  {@const parts = item && r.status !== "level" ? collectionItem(model, item).parts.filter((p) => !p.resource) : []}
  <ItemCard hover={r.name} title={r.name} sub={r.category} fallback={kindIcon(r.category, r.name)} image={item?.imageName ?? model.imageOf(r.name)} markPrime onopen={open} fav={wished.has(r.unique)} onfav={item ? () => toggleWish(r.unique) : undefined}>
    {#if r.acq.difficulty > 0}<Effort acq={r.acq} />{:else}<p class="chow">{stageText(r)}</p>{/if}
    {#if parts.length}<div class="chips">{#each parts as p, i (i)}<PartChip part={p} size={32} />{/each}</div>{/if}
    {#if r.acq.difficulty > 0}<p class="chow" title={r.acq.players ? `${r.acq.how}\n\n${r.acq.players}` : r.acq.how}>{r.acq.how}</p>{/if}
    {#snippet foot()}
      {#if r.status === "level"}<span class="tag" class:ok={stageOf(r).stage !== "building"}>{stageTag(r)}</span>{:else if r.status === "build" && r.buildTier === "hard"}<span class="tag bad" title="Every part in hand, but building needs {r.buildShort}, from an open world or an event">Parts ready · rare resources</span>{:else if r.status === "build" && r.buildTier === "farm"}<span class="tag ok" title="Every part in hand; still to farm: {r.buildShort}">Parts ready · farm</span>{:else if r.status === "build"}<span class="tag ok">Can build now</span>{/if}
      {#if r.isPrime && r.missingParts.length}
        {@const worst = r.missingParts.some((p) => p.availability === "vaulted") ? "vaulted" : r.missingParts.some((p) => p.availability === "resurgence") ? "resurgence" : "farmable"}
        <Avail v={worst} />
      {/if}
      <span class="grow"></span>
      {@const o = odds(r)}
      {#if o != null && o > 0}<span class="odds" title="Chance the relics you hold give every missing part, cracking each once">{pct(o)}</span>{/if}
      {#if r.buyFor != null}<span class="dim small">{o != null && o > 0 ? "or" : "parts"}</span><P v={r.buyFor} />{/if}
      <span class="pts"><GameIcon name="mastery" size={13} />{r.points.toLocaleString("en")}</span>
    {/snippet}
  </ItemCard>
{/snippet}

{#snippet detail(r: MasteryRow)}
  <p class="fullhow"><Effort acq={r.acq} /> <span>{r.acq.how}{#if r.acq.players}<span class="players">{r.acq.players}</span>{/if}</span></p>
  {#if !r.acq.available}<p class="small warn">Can't be obtained right now.</p>{/if}
  {#if r.missingParts.length}
    <p class="small dim legend">Relics that drop each missing part; yours first, vaulted ones dashed.</p>
    <div class="missing">
      {#each r.missingParts as p (p.name)}
        <div class="mp">
          <div class="mp-head"><Thumb file={model.imageOf(p.name)} name={p.name} size={24} /><strong>{p.name}</strong> <Avail v={p.availability} /> <P v={model.price(p.name)} /></div>
          <div class="relics">
            {#each p.sources.slice(0, 10) as s (s.base)}
              <span class="relic" class:have={s.owned > 0} class:vaulted={s.vaulted && !s.resurgence} use:info={s.base}>
                {s.base}<small>{s.rarity}</small>{#if s.owned}<em>you have {s.owned}</em>{/if}{#if s.vaulted && !s.resurgence}<i>vaulted</i>{/if}
              </span>
            {/each}
            {#if p.sources.length > 10}<span class="dim small">+{p.sources.length - 10} more</span>{/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}
  <div class="links">
    <button class="link" onclick={() => openUrl(r.wiki ?? wikiUrl(r.name))}>Wiki ↗</button>
    {#if r.isPrime}<button class="link" onclick={() => openUrl(marketUrl(`${r.name} Set`))}>warframe.market ↗</button>{/if}
  </div>
{/snippet}

<div class="page"><div class="page-inner">
  <PageHead title="Mastery" brief={view === "plat" ? "What platinum buys toward mastery." : "What's left to master, easiest first."} blurb={view === "plat" ? "What platinum gets you that you haven’t mastered, cheapest first." : "Everything you haven’t mastered, easiest first."}>
    {#snippet band()}
      {#if masteryRank != null}
        <Stat label="Your rank" tone="gold" note={`${rankLabel(masteryRank)} from ${rankThreshold(masteryRank).toLocaleString("en")} · ${rankLabel(masteryRank + 1)} at ${rankThreshold(masteryRank + 1).toLocaleString("en")} total mastery`} title={`${rankLabel(masteryRank + 1)} takes ${(rankThreshold(masteryRank + 1) - rankThreshold(masteryRank)).toLocaleString("en")} mastery more than ${rankLabel(masteryRank)}. The game doesn't say how far into the rank you are, so the figures below are what's left to earn, not what's left to the next rank.`}>{rankLabel(masteryRank)}</Stat>
      {/if}
      <Stat label="Rank up what you own" note={`${things(levelRows.length)} in your arsenal, not yet at max rank`}><GameIcon name="mastery" size={30} />{pts(levelRows).toLocaleString("en")}</Stat>
      <Stat label="Easy to get" note={`${things(easyRows.length)}: buy and build, or an easy boss`}><GameIcon name="mastery" size={30} />{pts(easyRows).toLocaleString("en")}</Stat>
      <Stat label="Left to master" tone="dim" note={`${things(open.length)} you can still get`}><GameIcon name="mastery" size={30} />{pts(open).toLocaleString("en")}</Stat>
    {/snippet}
    {#snippet hero()}<CodexRings {rings} {lit} onpick={pickRing} all={{ onpick: () => { ring = null; category = "all"; }, action: "Click to show every kind" }} action={(r) => (lit === r.group ? "Click to show every kind" : `Click to show only ${r.label.toLowerCase()} left to master`)} line={nextLine} />{/snippet}
  </PageHead>

  <!-- The page's two modes as tabs, then the filters: the box first, the kind, the rest folded. -->
  <div class="views"><Tabs bind:value={view} label="Mastery view" options={[{ v: "effort", label: "Easiest first", title: "Everything you haven't mastered, by how hard it is to get" }, { v: "plat", label: "Buy with plat", title: "What platinum gets you, cheapest first: the parts or items to buy, with a buy order a click away" }]} /></div>
  <div class="bar">
  <input type="search" placeholder="Filter items…" bind:value={query} />
  <select bind:value={category} onchange={() => (ring = null)} aria-label="Kind" title="Which kind of item">
    <option value="all">All kinds</option>
    {#each categories as c (c)}<option value={c}>{c}</option>{/each}
  </select>
  <Seg label="Prime" bind:value={kind} options={[{ v: "all", label: "All", title: "Everything you haven't mastered" }, { v: "prime", label: "Prime", title: "Primes only: parts from relics or other players" }, { v: "normal", label: "Non-prime", title: "Everything else: the Market, drops, syndicates, the dojo…" }]} />
  <Fold active={(effort !== "all" ? 1 : 0) + (showUnavailable ? 1 : 0)} reset={() => { effort = "all"; showUnavailable = false; }}>
    <Seg label="Effort" bind:value={effort} options={[{ v: "all", label: "All" }, { v: "2", label: "Easy", title: "Level it, buy and build, easy bosses" }, { v: "3", label: "Moderate", title: "Up to relics, quests, bounties and low syndicate ranks" }, { v: "4", label: "Hard", title: "Everything but Liches, Sisters, Coda and the nearly unobtainable" }]} />
    <Chip bind:on={showUnavailable} label="Show unavailable" title="Founders items, past events and the like: things you can't get right now" />
  </Fold>
  </div>

  <!-- Both views stay drawn once drawn, the other hidden (see the script). -->
  {#if drawnPlat}
    <div class="view" class:off={view !== "plat"}><PlatMastery {model} rows={platRows} {wished} onwish={toggleWish} clear={filtered ? clear : null} /></div>
  {/if}
  {#if drawnEffort}
    <div class="view" class:off={view === "plat"}><Browse id="mastery" rows={effortRows} {columns} key={(r) => r.unique} bind:sort {detail} {card} title={(r) => r.name} onopen={(r) => (model.catalogByUnique.has(r.unique) ? details.open(r.unique) : null)} clear={filtered ? clear : null} empty="Nothing left to master here." /></div>
  {/if}
</div></div>

<style>
  /* The view not chosen: kept laid out but not drawn, so showing it again is quick (where
     content-visibility isn't known, simply not there). */
  .view.off { display: none; }
  @supports (content-visibility: hidden) {
    .view.off { display: block; content-visibility: hidden; }
  }
  .views { margin-bottom: .8rem; }
  .missing { display: grid; gap: .9rem; }
  .mp-head { display: flex; gap: .6rem; align-items: center; margin-bottom: .4rem; }
  .relics { display: flex; flex-wrap: wrap; gap: .3rem; padding-left: calc(24px + .6rem); }
  .relic { font-family: var(--face-register); font-size: .64rem; letter-spacing: .06em; padding: .18rem .45rem; border: 1px solid var(--rule-bright); color: var(--platinum-dim); }
  .relic small { margin-left: .3rem; color: var(--platinum-deep); }
  .legend { margin: 0 0 .5rem; }
  .relic em { font-style: normal; margin-left: .35rem; color: var(--gold); font-weight: 600; }
  .relic.have { border-color: var(--gold-dim); color: var(--platinum); }
  .relic.vaulted { opacity: .7; border-style: dashed; }
  .relic i { font-style: normal; font-family: var(--face-register); font-size: .6rem; letter-spacing: .1em; text-transform: uppercase; color: var(--gold-dim); margin-left: .4rem; }
  .chips { display: flex; flex-wrap: wrap; gap: .4rem; }
  .chow { margin: 0; display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; font-size: .78rem; line-height: 1.35; color: var(--platinum-dim); }
  .grow { flex: 1; }
  .odds { font-family: var(--face-mark); font-weight: 700; color: var(--gold); }
  .pts { display: inline-flex; align-items: center; gap: .3rem; font-variant-numeric: tabular-nums; }
  .how { display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; font-size: .8rem; line-height: 1.35; color: var(--platinum-dim); min-width: 18rem; max-width: 46rem; }
  :global(html[data-room~="lt760"]) .how { min-width: 10rem; }
  /* Little room: in the list, the pips and the icon say how hard (the word is in the tooltip). */
  :global(html[data-room~="lt760"]) .ecell :global(.word) { display: none; }
  /* Half a screen: the table fits without scrolling sideways (the star column stays in view). */
  :global(html[data-room~="lt1100"]) .how { min-width: 12rem; }
  :global(html[data-room~="lt950"]) .how { min-width: 8rem; }
  .fullhow { display: flex; gap: 1rem; align-items: baseline; margin: 0 0 .8rem; max-width: 80ch; line-height: 1.45; }
  .warn { color: var(--gold); }
  .links { display: flex; gap: 1.2rem; margin-top: .9rem; }
  .star { display: inline-grid; place-items: center; width: 28px; height: 28px; padding: 0; border: 0; background: none; line-height: 0; color: var(--platinum-deep); }
  .star:active:not(:disabled) { background: none; }
  .star svg { fill: none; stroke: currentColor; stroke-width: 1.2; }
  .star:hover, .star.on { color: var(--gold); }
  .star.on svg { fill: var(--gold); }
  .players { display: block; margin-top: .35rem; font-size: .82rem; color: var(--platinum-deep); }
</style>
