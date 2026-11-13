<script lang="ts">
  // The column on the right of a wide window: the things you keep an eye on whatever page you're
  // on (the fissures, alerts worth a look, the open worlds' clocks, your Foundry, the bounties),
  // each one you choose, in a column you can fold away.
  import type { Model } from "../core/model";
  import type { Fissure, Live } from "../core/types";
  import { eraTint } from "./table";
  import type { Settings } from "../backend";
  import { bountyBoards, chosenFissures, fissureCounts, FISSURE_MODES, missionTypes, MODE_LABEL, type BountyTable, type FissureMode } from "../core/board";
  import { cycleTimers, matchedFissures, TIERS } from "../core/timers";
  import PickMany from "./PickMany.svelte";
  import { foundryBuilds } from "../core/foundry";
  import { invasionNeeds, invasionRares } from "../core/invasions";
  import { alertNeeds, describeHelp } from "../core/worldNeeds";
  import { until } from "../core/traders";
  import { scoreCards } from "../core/pick";
  import { mkt } from "../marketStore.svelte";
  import GameIcon, { eraIcon, factionIcon, type GameIconName } from "./GameIcon.svelte";
  import Foe from "./Foe.svelte";
  import Mission from "./Mission.svelte";
  import Thumb from "./Thumb.svelte";
  import Icon from "./Icon.svelte";
  import Chip from "./Chip.svelte";
  import P from "./P.svelte";
  import HelpMark from "./HelpMark.svelte";

  let { model, live, settings = $bindable(), console = false, bountyTables = null, go, shortListings = [], liveError = null }: { model: Model | null; live: Live; settings: Settings; console?: boolean; bountyTables?: BountyTable[] | null; go: (t: string) => void; shortListings?: { id: string; itemId: string }[]; liveError?: string | null } = $props();

  let now = $state(Date.now());
  $effect(() => {
    const t = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(t);
  });

  const SIDE_CARDS: { key: string; label: string; hint: string; pc?: boolean }[] = [
    { key: "alerts", label: "Alerts", hint: "Fissures matching your alerts, alerts and invasions with something you need" },
    { key: "fissures", label: "Fissures", hint: "The open fissures of the kinds, eras and missions you choose with its funnel (Normal, Steel Path, Void Storms; Home's board keeps its own choice), or with Only my alerts just the ones your alerts match" },
    { key: "clocks", label: "Clocks", hint: "Day and night on the open worlds" },
    { key: "foundry", label: "Foundry", hint: "What's building and when it's ready", pc: true },
    { key: "bounties", label: "Bounties", hint: "Each place's bounty reward you need, else its rarest" },
    { key: "market", label: "Market", hint: "How many listings you show on warframe.market, and today's sales from the sales MyOrbiter has recorded" },
  ];
  let choosing = $state(false);
  const on = (k: string) => settings.side.cards.includes(k) && !(console && SIDE_CARDS.find((c) => c.key === k)?.pc);
  const toggle = (k: string, v: boolean) => (settings.side.cards = v ? [...settings.side.cards.filter((x) => x !== k), k] : settings.side.cards.filter((x) => x !== k));

  const counts = $derived(fissureCounts(live.fissures, now));
  const watched = $derived(matchedFissures(settings.fissureRules, live.fissures, now));
  // The Fissures card's own choice (settings.side.fissures), apart from Home's board: kinds, eras
  // and mission types, or with Only my alerts just the matches, of every kind (core/board.ts).
  const fz = $derived(settings.side.fissures);
  const listed = $derived(chosenFissures(live.fissures, fz, settings.fissureRules, now));
  const mine = $derived(listed.mine);
  const watchedIds = $derived(new Set(watched.map((w) => w.fissure.id)));
  /** The choices are open under the card's heading (a fold of the column's own, not a setting). */
  let choosingFissures = $state(false);
  let funnel = $state<HTMLButtonElement>();
  /** What the heading says is listed: "Fissures", "Steel Path", "Normal + Void Storms", "All fissures", "My alerts". */
  const listedName = $derived(
    mine ? "My alerts" : fz.kinds.length === 3 ? "All fissures" : fz.kinds.length === 1 ? (fz.kinds[0] === "normal" ? "Fissures" : MODE_LABEL[fz.kinds[0]]) : fz.kinds.map((k) => MODE_LABEL[k]).join(" + "),
  );
  /** "Lith, Axi · Capture", for the titles: what narrows the list. */
  const narrowedBy = $derived([fz.eras.join(", "), fz.missions.length > 2 ? `${fz.missions.length} missions` : fz.missions.join(", ")].filter(Boolean).join(" · "));
  /** Ticks a kind on or off, in Home's order; the last one on stays on. */
  const setKind = (k: FissureMode, v: boolean) => {
    const kinds = FISSURE_MODES.filter((x) => (x === k ? v : fz.kinds.includes(x)));
    if (kinds.length) settings.side.fissures.kinds = kinds;
  };
  const setEra = (e: string, v: boolean) => (settings.side.fissures.eras = TIERS.filter((t) => (t === e ? v : fz.eras.includes(t))));
  const everyEraAndMission = () => {
    settings.side.fissures.eras = [];
    settings.side.fissures.missions = [];
    // The × goes with the narrowing: focus to the funnel beside the heading, not lost to the page.
    funnel?.focus();
  };
  /** "Augustus (Mars)" → its node and planet. */
  const place = (node: string) => {
    const m = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(node);
    return m ? { node: m[1], planet: m[2] } : { node, planet: "" };
  };
  const world = $derived(alertNeeds(console ? null : model, live.alerts, now));
  const invasions = $derived(model && !console ? invasionNeeds(model, live.invasions) : []);
  const rareInvasions = $derived(invasionRares(live.invasions));
  const cycles = $derived(cycleTimers(live, now));
  const builds = $derived(model && !console ? foundryBuilds(model, settings.game.foundryReady, now).slice(0, 6) : []);
  const need = (name: string) => !!model && !console && (scoreCards(model, [name])[0]?.needed ?? false);
  const boards = $derived(bountyBoards(live.syndicates ?? null, bountyTables, need));
  const CYCLE_ICON: Record<string, GameIconName> = { earth: "cycles", cetus: "ostron", vallis: "solaris-united", cambion: "entrati", zariman: "holdfasts", duviri: "duviri" };
  const left = (iso: string) => until(iso, now).replace("under a minute", "<1 min");
  const soldToday = $derived.by(() => {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return settings.market.sales.filter((s) => s.at >= +d).reduce((n, s) => n + s.quantity * s.platinum, 0);
  });
</script>

<aside class="side" aria-label="Watching">
  <header>
    <span class="register">Watching</span>
    <span class="grow"></span>
    <button class="ib" aria-expanded={choosing} title="Choose what this column shows" onclick={() => (choosing = !choosing)}><Icon name="settings" size={13} /></button>
    <button class="ib" title="Fold this column away (the tab on the right brings it back)" onclick={() => (settings.side.on = false)}>»</button>
  </header>
  {#if choosing}
    <div class="choose">
      {#each SIDE_CARDS.filter((c) => !(console && c.pc)) as c (c.key)}<Chip on={settings.side.cards.includes(c.key)} label={c.label} title={c.hint} onchange={(v: boolean) => toggle(c.key, v)} />{/each}
    </div>
  {/if}

  <!-- A fissure as a card: its era's colour washed in, the mission, where and against whom, and how long it has left. -->
  {#snippet fissureCard(f: Fissure)}
    {@const at = place(f.node)}
    <!-- Told apart by shape, not just colour: the mission's glyph on the left, the era's relic on the right. -->
    <li class="card fz era-wash" class:soon={Date.parse(f.expiry) - now < 10 * 60_000} style:--tint={eraTint(f.tier)} title="{f.tier}{f.isHard ? ' Steel Path' : f.isStorm ? ' Void Storm' : ''} {f.missionType} on {f.node}, against the {f.enemy}">
      <span class="glyph"><Mission type={f.missionType} storm={f.isStorm} size={17} /></span>
      <span class="tx">
        <span class="top"><b>{f.missionType}</b>{#if f.isHard}<span class="kind"><GameIcon name="steel-essence" size={10} />SP</span>{:else if f.isStorm}<span class="kind"><GameIcon name="railjack" size={10} />Storm</span>{/if}{#if watchedIds.has(f.id) && !mine}<span class="bell" title="One of your fissure alerts matches it"><Icon name="bell" size={10} /></span>{/if}</span>
        <span class="dim small where"><span class="loc" title="{at.node}{at.planet ? ` · ${at.planet}` : ''}">{at.node}{at.planet ? ` · ${at.planet}` : ""}</span><span class="dot"><Foe enemy={f.enemy} size={12} name={false} /></span></span>
      </span>
      <span class="end"><GameIcon name={eraIcon(f.tier)} size={16} title={f.tier} /><span class="t">{left(f.expiry)}</span></span>
    </li>
  {/snippet}

  {#each settings.side.cards as k (k)}
    {#if on(k) && k === "alerts"}
      <section>
        <div class="hmark"><h3 class="register"><Icon name="bell" size={11} /> Alerts</h3><HelpMark part="watching.alerts" /></div>
        {#if !watched.length && !world.mastery.length && !world.rare.length && !invasions.length && !rareInvasions.length && !shortListings.length}<p class="dim small">Nothing that needs you right now.</p>{/if}
        <ul class="cards">
          {#if shortListings.length}<li class="card era-wash" style:--tint="var(--gold)"><GameIcon name="market" size={20} /><span class="tx wrap"><button class="link" onclick={() => go("market")} title="Visible listings on warframe.market for more copies than you hold now">Listed more than you hold: {shortListings.length} listing{shortListings.length === 1 ? "" : "s"}</button><span class="dim small">Sold, or fix them on Orders</span></span></li>{/if}
          {#each watched as w (w.fissure.id)}{@render fissureCard(w.fissure)}{/each}
          {#each world.mastery as a (a.key)}<li class="card era-wash" style:--tint="var(--verdigris)" title="Mastery you're missing"><GameIcon name="mastery" size={20} /><span class="tx"><b>{a.reward}</b><span class="dim small">{a.node} · {describeHelp(a.reward, a.help!)}</span></span><span class="t">{left(a.expiry)}</span></li>{/each}
          {#each world.rare as a (a.key)}<li class="card era-wash" style:--tint="var(--gold)" title="A rare reward"><GameIcon name="sortie" size={20} /><span class="tx"><b>{a.reward}</b><span class="dim small where"><span class="loc">{a.mission} · {place(a.node).node}</span>{#if a.faction}<span class="dot"><Foe enemy={a.faction} size={12} name={false} /></span>{/if}</span></span><span class="t">{left(a.expiry)}</span></li>{/each}
          {#each invasions as n (n.key)}<li class="card era-wash" style:--tint="var(--verdigris)" title="An invasion with a part you need"><GameIcon name="invasion" size={20} /><span class="tx"><b>{n.reward}</b><span class="dim small">{n.node}</span></span><span class="t sd" title="Side with the {n.side} to earn it"><span class="register">side</span><Foe enemy={n.side} size={12} /></span></li>{/each}
          {#each rareInvasions as n (n.key)}<li class="card era-wash" style:--tint="var(--gold)" title="An invasion paying a rare reward: {n.reward}"><GameIcon name="invasion" size={20} /><span class="tx"><b>{n.reward}</b><span class="dim small">{n.node}</span></span><span class="t sd" title="Side with the {n.side} to earn it"><span class="register">side</span><Foe enemy={n.side} size={12} /></span></li>{/each}
        </ul>
      </section>
    {:else if on(k) && k === "fissures"}
      <section>
        <!-- What is listed and how many; narrowed by era or mission, the funnel is lit and × puts every era and mission back. -->
        <div class="hmark fzhead">
          <h3 class="register" title="{listedName}: {listed.count} listed{listed.narrowed ? `, only ${narrowedBy}` : ''}"><GameIcon name="void-tear" size={13} /><span class="what">{listedName} · {listed.count}</span></h3>
          <button class="ib" bind:this={funnel} class:lit={listed.narrowed} aria-expanded={choosingFissures} aria-controls={choosingFissures ? "side-fissure-choice" : undefined} aria-label="Choose this column's fissures{listed.narrowed ? `: narrowed to ${narrowedBy}` : ''}" title="Choose which fissures this column lists: kinds, eras, missions{settings.fissureRules.length ? ', or only your alerts' : ''}. Home's board keeps its own choice" onclick={() => (choosingFissures = !choosingFissures)}><Icon name="filter" size={13} /></button>
          <HelpMark part="watching.fissures" />
        </div>
        {#if listed.narrowed}
          <div class="narrow"><Icon name="filter" size={11} /><span class="by" title="Only {narrowedBy}">Only {narrowedBy}</span><button class="ib" aria-label="Show every era and mission in this column's fissures" title="Show every era and mission again; the kinds stay as they are" onclick={everyEraAndMission}><Icon name="close" size={11} /></button></div>
        {/if}
        {#if choosingFissures}
          <div class="fzpick" id="side-fissure-choice" role="group" aria-label="This column's fissures (Home's board keeps its own)">
            {#if settings.fissureRules.length}<Chip on={fz.only} label="Only my alerts" title="Only the fissures your fissure alerts (on Home) match, every kind together, soonest to close first; kind, era and mission don't apply while it's on" onchange={(v: boolean) => (settings.side.fissures.only = v)} />{/if}
            <fieldset disabled={mine} title={mine ? "Not used while Only my alerts is on" : undefined}>
              <legend class="register">Kind</legend>
              <div class="opts">{#each FISSURE_MODES as k (k)}{@const last = fz.kinds.length === 1 && fz.kinds[0] === k}<Chip on={fz.kinds.includes(k)} locked={last} label="{MODE_LABEL[k]} · {counts[k]}" title="{MODE_LABEL[k]} fissures in this column{last ? ' (one kind stays on: tick another to drop this one)' : ''}" onchange={(v: boolean) => setKind(k, v)} />{/each}</div>
            </fieldset>
            <fieldset disabled={mine} title={mine ? "Not used while Only my alerts is on" : undefined}>
              <legend class="register">Era <span class="any">{fz.eras.length ? "" : "· every era"}</span></legend>
              <div class="opts">{#each TIERS as t (t)}<Chip on={fz.eras.includes(t)} label={t} title="{t} fissures in this column; no era ticked is every era" onchange={(v: boolean) => setEra(t, v)} />{/each}</div>
            </fieldset>
            <fieldset disabled={mine} title={mine ? "Not used while Only my alerts is on" : undefined}>
              <legend class="register">Mission</legend>
              <PickMany bind:value={settings.side.fissures.missions} label="This column's fissures, mission" any="Any mission" noun="missions" options={missionTypes(live.fissures, fz.missions).map((m) => ({ v: m, label: m }))} />
            </fieldset>
            {#if mine}<p class="dim small">Only my alerts is on: kind, era and mission don't apply.</p>{/if}
          </div>
        {/if}
        {#if mine}
          <!-- Just your alerts' matches: few enough to read as one list, soonest to close first. -->
          {#if listed.soonest.length}<ul class="cards">{#each listed.soonest as f (f.id)}{@render fissureCard(f)}{/each}</ul>{/if}
        {:else}
          {#each listed.eras as e (e.era)}
            <div class="eh" style:--tint={eraTint(e.era)}><GameIcon name={eraIcon(e.era)} size={16} /><b>{e.era}</b><span class="dim small">{e.list.length}</span></div>
            <ul class="cards">{#each e.list as f (f.id)}{@render fissureCard(f)}{/each}</ul>
          {/each}
        {/if}
        {#if !listed.count}<p class="dim small">{live.fissures == null ? (liveError ? "The worldstate can't be read right now." : "Reading the worldstate…") : live.fissures.length && counts.normal + counts.steel + counts.storm === 0 ? "Out of date: the worldstate can't be read right now." : mine ? "None of the fissures open right now match your alerts." : counts.normal + counts.steel + counts.storm === 0 ? "None open right now." : "No open fissure matches what's chosen here."}</p>{/if}
      </section>
    {:else if on(k) && k === "clocks" && cycles.length}
      <section>
        <div class="hmark"><h3 class="register"><GameIcon name="cycles" size={13} /> Clocks</h3><HelpMark part="watching.clocks" /></div>
        <ul class="tiles">{#each cycles as c (c.key)}<li class="tile" title="{c.label}: {c.state} for {left(c.ends)}"><GameIcon name={(c.key === "zariman" && factionIcon(c.state)) || CYCLE_ICON[c.key]} size={18} /><span class="tx"><b class="st-{c.state}">{c.state}</b><span class="dim small">{c.label}</span><span class="t">{left(c.ends)}</span></span></li>{/each}</ul>
      </section>
    {:else if on(k) && k === "foundry"}
      <section>
        <div class="hmark"><h3 class="register"><GameIcon name="foundry" size={13} /> Foundry</h3><HelpMark part="watching.foundry" /></div>
        {#if !builds.length}<p class="dim small">Nothing building.</p>{/if}
        <ul class="cards">{#each builds as b (b.key)}<li class="card" class:era-wash={b.ready} style:--tint={b.ready ? "var(--verdigris)" : null}><Thumb file={b.image} name={b.name} size={26} /><span class="tx"><b>{b.name}</b>{#if b.points}<span class="dim small">{b.points.toLocaleString()} mastery</span>{/if}</span><span class="t" class:ready={b.ready}>{b.ready ? "Ready" : left(new Date(b.readyAt).toISOString())}</span></li>{/each}</ul>
      </section>
    {:else if on(k) && k === "bounties" && boards.length}
      <section>
        <div class="hmark"><h3 class="register"><GameIcon name="bounty" size={13} /> Bounties</h3><HelpMark part="watching.bounties" /></div>
        <ul class="cards">
          {#each boards as b (b.key)}
            {@const j = b.jobs.find((x) => x.wanted) ?? b.jobs.reduce((best, x) => ((x.headline?.chance ?? 101) < (best.headline?.chance ?? 101) ? x : best), b.jobs[0])}
            <li class="card" class:era-wash={j?.wanted} style:--tint={j?.wanted ? "var(--gold)" : null} title="{b.label}: {j?.name}"><Thumb file={j?.headline ? model?.imageOf(j.headline.name) : null} name={j?.headline?.name} size={26} /><span class="tx"><b class:want={j?.wanted}>{j?.headline?.name ?? "—"}</b><span class="dim small">{b.label}{j && !b.rotating ? ` · ${j.name}` : ""}</span></span></li>
          {/each}
        </ul>
        <button class="link small" onclick={() => go("home#bounties")}>Every bounty →</button>
      </section>
    {:else if on(k) && k === "market"}
      <section>
        <div class="hmark"><h3 class="register"><GameIcon name="market" size={13} /> Market</h3><HelpMark part="watching.market" /></div>
        {#if mkt.linked}
          <div class="figs">
            <span><b>{mkt.orders.filter((o) => o.type === "sell" && o.visible).length}</b><span class="dim small">listed</span></span>
            <span><P v={soldToday} /><span class="dim small">sold today</span></span>
          </div>
        {:else}<p class="dim small">Not signed in to warframe.market.</p>{/if}
      </section>
    {/if}
  {/each}
</aside>

<style>
  .side { height: 100%; overflow-y: auto; border-left: 1px solid var(--rule); background: rgb(13 15 18 / 92%); padding: .7rem .8rem 1.4rem; display: grid; align-content: start; gap: .9rem; }
  header { display: flex; align-items: center; gap: .3rem; padding-bottom: .4rem; border-bottom: 1px solid var(--rule); }
  .grow { flex: 1; }
  .ib { display: grid; place-items: center; width: 26px; height: 26px; padding: 0; border: 1px solid transparent; background: none; color: var(--platinum-deep); font-size: .9rem; }
  .ib:hover { color: var(--gold); border-color: var(--rule); }
  .choose { display: flex; flex-wrap: wrap; gap: .3rem; }
  section { display: grid; gap: .35rem; }
  .hmark { gap: .35rem; }
  .hmark > :global(.helpmark) { margin-left: auto; }
  h3 { display: flex; align-items: center; gap: .35rem; margin: 0; font-size: 11px; color: var(--platinum-dim); }
  /* The Fissures card's heading: what is listed (ending in … rather than wrapping), then its two buttons and the "?". */
  .fzhead { gap: .15rem; }
  /* Spaced a little closer than the other headings, so two kinds' names fit ("Steel Path + Void Storms · 12"). */
  .fzhead h3 { flex: 1; min-width: 0; letter-spacing: .07em; }
  /* Narrowed: by what, and × to list every era and mission again. */
  .narrow { display: flex; align-items: center; gap: .35rem; color: var(--gold); font-size: .76rem; }
  .narrow .by { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--platinum-dim); }
  .narrow .ib { width: 20px; height: 20px; flex: none; font-size: .8rem; }
  .fzhead .what { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fzhead .ib { width: 22px; height: 22px; flex: none; }
  /* Narrowed by era or mission: the funnel lit, as a chosen menu is. */
  .ib.lit { color: var(--gold); border-color: var(--gold-dim); }
  /* The card's own choices, folded under its heading. */
  .fzpick { display: grid; gap: .45rem; padding: .5rem .55rem; background: var(--well); border: 1px solid var(--rule); }
  .fzpick > :global(.chip), .opts :global(.chip) { padding: .28rem .45rem; gap: .35rem; font-size: 10.5px; letter-spacing: .08em; }
  .fzpick > :global(.chip) { justify-self: start; }
  fieldset { margin: 0; padding: 0; border: 0; min-width: 0; display: grid; gap: .25rem; }
  fieldset:disabled { opacity: .5; }
  legend { padding: 0; font-size: 11px; margin-bottom: .2rem; }
  legend .any { color: var(--platinum-deep); text-transform: none; letter-spacing: normal; }
  .opts { display: flex; flex-wrap: wrap; gap: .25rem; }
  fieldset :global(.pm) { justify-self: start; max-width: 100%; }
  fieldset :global(.pmb) { padding: .35rem 1.7rem .35rem .55rem; font-size: 10.5px; max-width: 100%; }
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: .3rem; }
  li { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: .5rem; align-items: center; font-size: .82rem; }
  /* One thing per card: an Orokin plate, the wash of its era or kind (app.css, .era-wash). */
  .card { padding: .42rem .55rem .42rem .6rem; background: var(--plate-sheen), var(--plate); box-shadow: var(--plate-light); border: 1px solid var(--rule); clip-path: var(--cut); }
  .card.era-wash { background: var(--era-bg); border-color: color-mix(in srgb, var(--tint) 20%, var(--rule)); }
  .card .tx { gap: .05rem; }
  .card.soon { opacity: .72; }
  .card.soon .t { color: var(--oxblood); }
  .top { display: flex; align-items: center; gap: .35rem; }
  .kind { display: inline-flex; align-items: center; gap: .18rem; font-family: var(--face-register); font-size: 11px; letter-spacing: .1em; color: var(--gold); border: 1px solid var(--gold-dim); padding: 0 .22rem; line-height: 1.35; }
  /* Where, then the faction's sigil and name: one line, the name giving way first. */
  .tx .where { display: flex; align-items: center; gap: .4rem; min-width: 0; }
  /* A long place ("Taveuni · Kuva Fortress") ends in … and the faction's sigil always shows. */
  .where .loc { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .where .dot { flex: none; display: inline-flex; }
  /* A fissure card's mission glyph, in a well edged in its era's colour. */
  .fz .glyph { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; flex: none; color: color-mix(in srgb, var(--tint) 70%, var(--platinum)); border: 1px solid color-mix(in srgb, var(--tint) 45%, var(--rule)); background: color-mix(in srgb, var(--tint) 10%, var(--well)); }
  .fz .end { display: grid; justify-items: end; align-content: space-between; gap: .2rem; align-self: stretch; }
  .t.sd { display: grid; justify-items: end; gap: .1rem; }
  .t.sd .register { font-size: 11px; }
  .bell { color: var(--gold); display: inline-flex; }
  /* An era's heading: its icon and name in its own colour, and how many are open. */
  .eh { display: flex; align-items: center; gap: .4rem; margin-top: .35rem; font-size: .8rem; }
  .eh b { font-family: var(--face-mark); letter-spacing: .02em; color: color-mix(in srgb, var(--tint) 75%, var(--platinum)); }
  .eh .dim { margin-left: auto; font-variant-numeric: tabular-nums; }
  /* The open worlds' clocks, two to a row. */
  .tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .3rem; }
  .tile { grid-template-columns: auto minmax(0, 1fr); align-items: start; padding: .38rem .45rem; background: var(--plate); border: 1px solid var(--rule); }
  .tile b { text-transform: capitalize; }
  .tile .t { font-size: .7rem; }
  .tx { display: grid; min-width: 0; }
  .tx > * { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tx b { font-weight: 600; color: var(--platinum); }
  .tx.wrap > * { white-space: normal; }
  /* A title that opens a page: set like the other titles, not as a spaced-out caps link. */
  .tx .link { padding: 0; font: inherit; font-weight: 600; letter-spacing: normal; text-transform: none; text-align: left; color: var(--platinum); text-decoration: none; }
  .tx .link { text-align: left; }
  .tx b.want { color: var(--gold); }
  .t { font-variant-numeric: tabular-nums; color: var(--platinum-dim); font-size: .76rem; white-space: nowrap; }
  .t.ready { color: var(--verdigris); }
  .st-day, .st-warm, .st-fass { color: var(--cycle-warm) !important; }
  .st-night, .st-cold, .st-vome { color: var(--cycle-cold) !important; }
  .st-corpus { color: var(--faction-corpus) !important; }
  .st-grineer { color: var(--faction-grineer) !important; }
  .st-joy { color: var(--cycle-warm) !important; }
  .st-anger { color: var(--mood-anger) !important; }
  .st-envy { color: var(--mood-envy) !important; }
  .st-sorrow { color: var(--mood-sorrow) !important; }
  .st-fear { color: var(--mood-fear) !important; }
  .figs { display: flex; gap: 1.2rem; }
  .figs > span { display: grid; }
  .figs b { font-family: var(--face-mark); font-size: 1.2rem; color: var(--platinum); }
</style>
