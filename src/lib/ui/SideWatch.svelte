<script lang="ts">
  // The column on the right of a wide window: the things you keep an eye on whatever page you're
  // on (the fissures, alerts worth a look, the open worlds' clocks, your Foundry, the bounties),
  // each one you choose, in a column you can fold away.
  import type { Model } from "../core/model";
  import type { Live } from "../core/types";
  import type { Settings } from "../backend";
  import { bountyBoards, fissureCounts, fissuresByEra, type BountyTable } from "../core/board";
  import { cycleTimers, matchedFissures } from "../core/timers";
  import { foundryBuilds } from "../core/foundry";
  import { invasionNeeds } from "../core/invasions";
  import { alertNeeds, describeHelp } from "../core/worldNeeds";
  import { until } from "../core/traders";
  import { scoreCards } from "../core/pick";
  import { mkt } from "../marketStore.svelte";
  import GameIcon, { type GameIconName } from "./GameIcon.svelte";
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
    { key: "fissures", label: "Fissures", hint: "Every open fissure of the kind Home shows (normal, Steel Path or Void Storms)" },
    { key: "clocks", label: "Clocks", hint: "Day and night on the open worlds" },
    { key: "foundry", label: "Foundry", hint: "What's building and when it's ready", pc: true },
    { key: "bounties", label: "Bounties", hint: "Each place's best bounty reward" },
    { key: "market", label: "Market", hint: "Your listings and today's sales on warframe.market" },
  ];
  let choosing = $state(false);
  const on = (k: string) => settings.side.cards.includes(k) && !(console && SIDE_CARDS.find((c) => c.key === k)?.pc);
  const toggle = (k: string, v: boolean) => (settings.side.cards = v ? [...settings.side.cards.filter((x) => x !== k), k] : settings.side.cards.filter((x) => x !== k));

  const mode = $derived(settings.homeFissures);
  const eras = $derived(fissuresByEra(live.fissures, mode, now));
  const counts = $derived(fissureCounts(live.fissures, now));
  const watched = $derived(matchedFissures(settings.fissureRules, live.fissures, now));
  const world = $derived(alertNeeds(console ? null : model, live.alerts, now));
  const invasions = $derived(model && !console ? invasionNeeds(model, live.invasions) : []);
  const cycles = $derived(cycleTimers(live, now));
  const builds = $derived(model && !console ? foundryBuilds(model, settings.game.foundryReady, now).slice(0, 6) : []);
  const need = (name: string) => !!model && !console && (scoreCards(model, [name])[0]?.needed ?? false);
  const boards = $derived(bountyBoards(live.syndicates ?? null, bountyTables, need));
  const CYCLE_ICON: Record<string, GameIconName> = { earth: "cycles", cetus: "ostron", vallis: "solaris-united", cambion: "entrati", zariman: "holdfasts" };
  const eraIcon = (era: string): GameIconName => (era === "Omnia" ? "void-tear" : (`relic-${era.toLowerCase()}-intact` as GameIconName));
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

  {#each settings.side.cards as k (k)}
    {#if on(k) && k === "alerts"}
      <section>
        <h3 class="register"><Icon name="bell" size={11} /> Alerts</h3>
        {#if !watched.length && !world.mastery.length && !world.rare.length && !invasions.length && !shortListings.length}<p class="dim small">Nothing that needs you right now.</p>{/if}
        <ul>
          {#if shortListings.length}<li><GameIcon name="market" size={16} /><span class="tx wrap"><button class="link" onclick={() => go("market")}>{shortListings.length} listing{shortListings.length === 1 ? "" : "s"} for more than you hold</button><span class="dim small">sold, or fix them on Orders</span></span></li>{/if}
          {#each watched as w (w.fissure.id)}<li><GameIcon name={eraIcon(w.fissure.tier)} size={16} /><span class="tx"><b>{w.fissure.isHard ? "SP " : ""}{w.fissure.tier} {w.fissure.missionType}</b><span class="dim small">{w.fissure.node}</span></span><span class="t">{left(w.fissure.expiry)}</span></li>{/each}
          {#each world.mastery as a (a.key)}<li><GameIcon name="mastery" size={16} /><span class="tx"><b>{a.reward}</b><span class="dim small">{a.node} · {describeHelp(a.reward, a.help!)}</span></span><span class="t">{left(a.expiry)}</span></li>{/each}
          {#each world.rare as a (a.key)}<li><GameIcon name="sortie" size={16} /><span class="tx"><b>{a.reward}</b><span class="dim small">{a.node} · {a.mission}</span></span><span class="t">{left(a.expiry)}</span></li>{/each}
          {#each invasions as n (n.key)}<li><GameIcon name="invasion" size={16} /><span class="tx"><b>{n.reward}</b><span class="dim small">{n.node} · side with {n.side}</span></span></li>{/each}
        </ul>
      </section>
    {:else if on(k) && k === "fissures"}
      <section>
        <h3 class="register"><GameIcon name="void-tear" size={13} /> {mode === "steel" ? "Steel Path" : mode === "storm" ? "Void Storms" : "Fissures"} · {counts[mode]}</h3>
        {#each eras as e (e.era)}
          <div class="era"><GameIcon name={eraIcon(e.era)} size={16} /><b>{e.era}</b></div>
          <ul class="fs">{#each e.list as f (f.id)}<li title="{f.node} · {f.enemy}"><span class="tx"><span>{f.missionType} <span class="dim small">{f.node.replace(/ \(.*\)$/, "")}</span></span></span><span class="t">{left(f.expiry)}</span></li>{/each}</ul>
        {:else}<p class="dim small">{live.fissures == null ? (liveError ? "The worldstate can't be read right now." : "Reading the worldstate…") : live.fissures.length && counts.normal + counts.steel + counts.storm === 0 ? "Out of date: the worldstate can't be read right now." : "None open right now."}</p>{/each}
      </section>
    {:else if on(k) && k === "clocks" && cycles.length}
      <section>
        <h3 class="register"><GameIcon name="cycles" size={13} /> Clocks</h3>
        <ul>{#each cycles as c (c.key)}<li><GameIcon name={CYCLE_ICON[c.key]} size={16} /><span class="tx"><b class="st-{c.state}">{c.state}</b><span class="dim small">{c.label}</span></span><span class="t">{left(c.ends)}</span></li>{/each}</ul>
      </section>
    {:else if on(k) && k === "foundry"}
      <section>
        <h3 class="register"><GameIcon name="foundry" size={13} /> Foundry</h3>
        {#if !builds.length}<p class="dim small">Nothing building.</p>{/if}
        <ul>{#each builds as b (b.key)}<li><Thumb file={b.image} name={b.name} size={20} /><span class="tx"><b>{b.name}</b></span><span class="t" class:ready={b.ready}>{b.ready ? "Ready" : left(new Date(b.readyAt).toISOString())}</span></li>{/each}</ul>
      </section>
    {:else if on(k) && k === "bounties" && boards.length}
      <section>
        <h3 class="register"><GameIcon name="ostron" size={13} /> Bounties</h3>
        <ul>
          {#each boards as b (b.key)}
            {@const j = b.jobs.find((x) => x.wanted) ?? b.jobs.reduce((best, x) => ((x.headline?.chance ?? 101) < (best.headline?.chance ?? 101) ? x : best), b.jobs[0])}
            <li title="{b.label}: {j?.name}"><Thumb file={j?.headline ? model?.imageOf(j.headline.name) : null} name={j?.headline?.name} size={20} /><span class="tx"><b class:want={j?.wanted}>{j?.headline?.name ?? "—"}</b><span class="dim small">{b.label}{j && !b.rotating ? ` · ${j.name}` : ""}</span></span></li>
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
  li { display: grid; grid-template-columns: 20px minmax(0, 1fr) auto; gap: .45rem; align-items: center; font-size: .82rem; }
  .fs li { grid-template-columns: minmax(0, 1fr) auto; padding-left: 1.4rem; }
  .tx { display: grid; min-width: 0; }
  .tx > * { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tx b { font-weight: 600; color: var(--platinum); }
  .tx.wrap > * { white-space: normal; }
  .tx .link { text-align: left; }
  .tx b.want { color: var(--gold); }
  .t { font-variant-numeric: tabular-nums; color: var(--platinum-dim); font-size: .76rem; white-space: nowrap; }
  .t.ready { color: var(--verdigris); }
  .era { display: flex; align-items: center; gap: .4rem; margin-top: .2rem; font-size: .8rem; }
  .era b { font-family: var(--face-mark); color: var(--platinum); }
  .st-day, .st-warm, .st-fass { color: var(--gold) !important; }
  .st-night, .st-cold, .st-vome { color: #8fb3e0 !important; }
  .figs { display: flex; gap: 1.2rem; }
  .figs > span { display: grid; }
  .figs b { font-family: var(--face-mark); font-size: 1.2rem; color: var(--platinum); }
</style>
