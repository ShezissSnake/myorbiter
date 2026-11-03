<script lang="ts">
  // The column on the right of a wide window: the things you keep an eye on whatever page you're
  // on (the fissures, alerts worth a look, the open worlds' clocks, your Foundry, the bounties),
  // each one you choose, in a column you can fold away.
  import type { Model } from "../core/model";
  import type { Fissure, Live } from "../core/types";
  import { eraTint } from "./table";
  import type { Settings } from "../backend";
  import { bountyBoards, fissureCounts, fissuresByEra, type BountyTable } from "../core/board";
  import { cycleTimers, matchedFissures } from "../core/timers";
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

  let { model, live, settings = $bindable(), console = false, bountyTables = null, go, shortListings = [], liveError = null }: { model: Model | null; live: Live; settings: Settings; console?: boolean; bountyTables?: BountyTable[] | null; go: (t: string) => void; shortListings?: { id: string; itemId: string }[]; liveError?: string | null } = $props();

  let now = $state(Date.now());
  $effect(() => {
    const t = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(t);
  });

  const SIDE_CARDS: { key: string; label: string; hint: string; pc?: boolean }[] = [
    { key: "alerts", label: "Alerts", hint: "Fissures matching your alerts, alerts and invasions with something you need" },
    { key: "fissures", label: "Fissures", hint: "Every open fissure of the kind Home shows (normal, Steel Path or Void Storms); with Only my alerts on there, just the ones your alerts match" },
    { key: "clocks", label: "Clocks", hint: "Day and night on the open worlds" },
    { key: "foundry", label: "Foundry", hint: "What's building and when it's ready", pc: true },
    { key: "bounties", label: "Bounties", hint: "Each place's best bounty reward" },
    { key: "market", label: "Market", hint: "Your listings and today's sales on warframe.market" },
  ];
  let choosing = $state(false);
  const on = (k: string) => settings.side.cards.includes(k) && !(console && SIDE_CARDS.find((c) => c.key === k)?.pc);
  const toggle = (k: string, v: boolean) => (settings.side.cards = v ? [...settings.side.cards.filter((x) => x !== k), k] : settings.side.cards.filter((x) => x !== k));

  const mode = $derived(settings.homeFissures);
  const counts = $derived(fissureCounts(live.fissures, now));
  const watched = $derived(matchedFissures(settings.fissureRules, live.fissures, now));
  // As Home's board: with Only my alerts, just the matches, of every kind.
  const mine = $derived(settings.homeFissuresOnly && settings.fissureRules.length > 0);
  const eras = $derived(fissuresByEra(live.fissures, mode, now));
  /** With Only my alerts: the matches of every kind, soonest to close first. */
  const soonest = $derived(watched.map((w) => w.fissure).sort((a, b) => Date.parse(a.expiry) - Date.parse(b.expiry)));
  const watchedIds = $derived(new Set(watched.map((w) => w.fissure.id)));
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
        <span class="dim small where">{at.node}{at.planet ? ` · ${at.planet}` : ""}&ensp;<Foe enemy={f.enemy} size={12} name={false} /></span>
      </span>
      <span class="end"><GameIcon name={eraIcon(f.tier)} size={16} title={f.tier} /><span class="t">{left(f.expiry)}</span></span>
    </li>
  {/snippet}

  {#each settings.side.cards as k (k)}
    {#if on(k) && k === "alerts"}
      <section>
        <h3 class="register"><Icon name="bell" size={11} /> Alerts</h3>
        {#if !watched.length && !world.mastery.length && !world.rare.length && !invasions.length && !rareInvasions.length && !shortListings.length}<p class="dim small">Nothing that needs you right now.</p>{/if}
        <ul class="cards">
          {#if shortListings.length}<li class="card era-wash" style:--tint="var(--gold)"><GameIcon name="market" size={20} /><span class="tx wrap"><button class="link" onclick={() => go("market")}>{shortListings.length} listing{shortListings.length === 1 ? "" : "s"} for more than you hold</button><span class="dim small">Sold, or fix them on Orders</span></span></li>{/if}
          {#each watched as w (w.fissure.id)}{@render fissureCard(w.fissure)}{/each}
          {#each world.mastery as a (a.key)}<li class="card era-wash" style:--tint="var(--verdigris)" title="Mastery you're missing"><GameIcon name="mastery" size={20} /><span class="tx"><b>{a.reward}</b><span class="dim small">{a.node} · {describeHelp(a.reward, a.help!)}</span></span><span class="t">{left(a.expiry)}</span></li>{/each}
          {#each world.rare as a (a.key)}<li class="card era-wash" style:--tint="var(--gold)" title="A rare reward"><GameIcon name="sortie" size={20} /><span class="tx"><b>{a.reward}</b><span class="dim small where">{a.mission} · {place(a.node).node}{#if a.faction}&ensp;<Foe enemy={a.faction} size={12} name={false} />{/if}</span></span><span class="t">{left(a.expiry)}</span></li>{/each}
          {#each invasions as n (n.key)}<li class="card era-wash" style:--tint="var(--verdigris)" title="An invasion with a part you need"><GameIcon name="invasion" size={20} /><span class="tx"><b>{n.reward}</b><span class="dim small">{n.node}</span></span><span class="t sd" title="Side with the {n.side} to earn it"><span class="register">side</span><Foe enemy={n.side} size={12} /></span></li>{/each}
          {#each rareInvasions as n (n.key)}<li class="card era-wash" style:--tint="var(--gold)" title="An invasion paying a rare reward: {n.reward}"><GameIcon name="invasion" size={20} /><span class="tx"><b>{n.reward}</b><span class="dim small">{n.node}</span></span><span class="t sd" title="Side with the {n.side} to earn it"><span class="register">side</span><Foe enemy={n.side} size={12} /></span></li>{/each}
        </ul>
      </section>
    {:else if on(k) && k === "fissures"}
      <section>
        <h3 class="register"><GameIcon name="void-tear" size={13} /> {mine ? `My alerts · ${watched.length}` : `${mode === "steel" ? "Steel Path" : mode === "storm" ? "Void Storms" : "Fissures"} · ${counts[mode]}`}</h3>
        {#if mine}
          <!-- Just your alerts' matches: few enough to read as one list, soonest to close first. -->
          {#if soonest.length}<ul class="cards">{#each soonest as f (f.id)}{@render fissureCard(f)}{/each}</ul>{/if}
        {:else}
          {#each eras as e (e.era)}
            <div class="eh" style:--tint={eraTint(e.era)}><GameIcon name={eraIcon(e.era)} size={16} /><b>{e.era}</b><span class="dim small">{e.list.length}</span></div>
            <ul class="cards">{#each e.list as f (f.id)}{@render fissureCard(f)}{/each}</ul>
          {/each}
        {/if}
        {#if !(mine ? soonest.length : eras.length)}<p class="dim small">{live.fissures == null ? (liveError ? "The worldstate can't be read right now." : "Reading the worldstate…") : live.fissures.length && counts.normal + counts.steel + counts.storm === 0 ? "Out of date: the worldstate can't be read right now." : mine ? "None of the fissures open right now match your alerts." : "None open right now."}</p>{/if}
      </section>
    {:else if on(k) && k === "clocks" && cycles.length}
      <section>
        <h3 class="register"><GameIcon name="cycles" size={13} /> Clocks</h3>
        <ul class="tiles">{#each cycles as c (c.key)}<li class="tile" title="{c.label}: {c.state} for {left(c.ends)}"><GameIcon name={(c.key === "zariman" && factionIcon(c.state)) || CYCLE_ICON[c.key]} size={18} /><span class="tx"><b class="st-{c.state}">{c.state}</b><span class="dim small">{c.label}</span><span class="t">{left(c.ends)}</span></span></li>{/each}</ul>
      </section>
    {:else if on(k) && k === "foundry"}
      <section>
        <h3 class="register"><GameIcon name="foundry" size={13} /> Foundry</h3>
        {#if !builds.length}<p class="dim small">Nothing building.</p>{/if}
        <ul class="cards">{#each builds as b (b.key)}<li class="card" class:era-wash={b.ready} style:--tint={b.ready ? "var(--verdigris)" : null}><Thumb file={b.image} name={b.name} size={26} /><span class="tx"><b>{b.name}</b>{#if b.points}<span class="dim small">{b.points.toLocaleString()} mastery</span>{/if}</span><span class="t" class:ready={b.ready}>{b.ready ? "Ready" : left(new Date(b.readyAt).toISOString())}</span></li>{/each}</ul>
      </section>
    {:else if on(k) && k === "bounties" && boards.length}
      <section>
        <h3 class="register"><GameIcon name="bounty" size={13} /> Bounties</h3>
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
        <h3 class="register"><GameIcon name="market" size={13} /> Market</h3>
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
  h3 { display: flex; align-items: center; gap: .35rem; margin: 0; font-size: .58rem; color: var(--platinum-dim); }
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: .3rem; }
  li { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: .5rem; align-items: center; font-size: .82rem; }
  /* One thing per card: an Orokin plate, the wash of its era or kind (app.css, .era-wash). */
  .card { padding: .42rem .55rem .42rem .6rem; background: var(--plate); border: 1px solid var(--rule); clip-path: var(--cut); }
  .card.era-wash { background: var(--era-bg); border-color: color-mix(in srgb, var(--tint) 20%, var(--rule)); }
  .card .tx { gap: .05rem; }
  .card.soon { opacity: .72; }
  .card.soon .t { color: var(--oxblood); }
  .top { display: flex; align-items: center; gap: .35rem; }
  .kind { display: inline-flex; align-items: center; gap: .18rem; font-family: var(--face-register); font-size: .55rem; letter-spacing: .1em; color: var(--gold); border: 1px solid var(--gold-dim); padding: 0 .22rem; line-height: 1.35; }
  /* Where, then the faction's sigil and name: one line, the name giving way first. */
  .tx .where { display: flex; align-items: center; gap: .2rem; }
  /* A fissure card's mission glyph, in a well edged in its era's colour. */
  .fz .glyph { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; flex: none; color: color-mix(in srgb, var(--tint) 70%, var(--platinum)); border: 1px solid color-mix(in srgb, var(--tint) 45%, var(--rule)); background: color-mix(in srgb, var(--tint) 10%, var(--well)); }
  .fz .end { display: grid; justify-items: end; align-content: space-between; gap: .2rem; align-self: stretch; }
  .t.sd { display: grid; justify-items: end; gap: .1rem; }
  .t.sd .register { font-size: .5rem; }
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
