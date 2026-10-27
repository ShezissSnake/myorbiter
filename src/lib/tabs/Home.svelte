<script lang="ts">
  import { info } from "../hover.svelte";
  // Today at a glance: anything that needs you, your market, live fissures and your best relic for
  // each, what's ready to sell, what's worth doing today, your Foundry, cheap buys, the easiest
  // mastery, and Baro and Varzia against your collection.
  import type { Model } from "../core/model";
  import type { Fissure, Live, MissionState } from "../core/types";
  import type { Settings } from "../backend";
  import type { MyOrder } from "../core/market";
  import { mkt } from "../marketStore.svelte";
  import { masteryRows, relicRows, type RelicRow } from "../core/views";
  import { sellTargets, KIND_LABEL, BULK_KINDS, RULE_OF, type BulkKind } from "../core/bulk";
  import { expectedBest } from "../core/advice";
  import { baroStock, varziaNeeds, until } from "../core/traders";
  import { invasionNeeds } from "../core/invasions";
  import GameIcon, { type GameIconName } from "../ui/GameIcon.svelte";
  import Icon from "../ui/Icon.svelte";
  import IconButton from "../ui/IconButton.svelte";
  import Effort from "../ui/Effort.svelte";
  import Thumb from "../ui/Thumb.svelte";
  import P from "../ui/P.svelte";
  import Presence from "../ui/Presence.svelte";
  import { partRows } from "../core/views";
  import { decide } from "../core/advice";
  import { today } from "../core/today";
  import { foundryBuilds } from "../core/foundry";
  import { crackableFirst, crackableNow, openEras, wishItem, type WishItem } from "../core/wishlist";
  import { cycleTimers, resetTimers, matchedFissures, planetOf, ruleLabel, sameRule, TIERS, type FissureRule } from "../core/timers";
  import { details } from "../details.svelte";
  import { describe } from "../core/describe";

  let { model, live, mission, settings = $bindable(), go, shortListings, liveAt = null, liveError = null }: { model: Model; live: Live; mission: MissionState | null; settings: Settings; go: (t: string) => void; shortListings: MyOrder[]; liveAt?: number | null; liveError?: string | null } = $props();
  // The worldstate: still being asked for the first time, or unreachable (api.warframestat.us).
  const liveWaiting = $derived(liveAt == null && !liveError);
  const liveNote = $derived(liveWaiting ? "Asking api.warframestat.us…" : "api.warframestat.us didn't answer; orbiter asks again every few minutes.");

  // Countdowns tick once a minute.
  let now = $state(Date.now());
  $effect(() => {
    const t = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(t);
  });

  // ------------------------------------------------------------ market
  const orders = $derived(mkt.orders.filter((o) => o.type === "sell"));
  const listed = $derived(orders.filter((o) => o.visible).reduce((n, o) => n + o.platinum * o.quantity, 0));
  const DAY = 86_400_000;
  const dayStart = $derived.by(() => {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return +d;
  });
  const sold = (from: number) => settings.market.sales.filter((s) => s.at >= from).reduce((n, s) => n + s.quantity * s.platinum, 0);

  // ------------------------------------------------------------ ready to sell
  // What would go on sale: not what's held back for ducats.
  const targets = $derived(sellTargets(model, settings.market.bulk, settings.advice, mkt.index, settings.market.sellable).filter((t) => !t.hold));
  const valueOf = (kind: BulkKind, name: string) => (kind === "arcane" ? (model.priceMax(name) ?? model.price(name)) : model.price(name));
  const worthy = $derived(targets.map((t) => ({ ...t, each: t.each !== undefined ? t.each : valueOf(t.kind, t.name) })).filter((t) => t.each != null && t.each >= settings.market.minPrice));
  const byKind = $derived(
    BULK_KINDS
      .map((k) => {
        const xs = worthy.filter((t) => t.kind === k);
        return { kind: k, count: xs.reduce((n, t) => n + t.quantity, 0), plat: Math.round(xs.reduce((n, t) => n + t.quantity * (t.each ?? 0), 0)) };
      })
      .filter((k) => k.count > 0),
  );
  const KIND_ICON: Record<BulkKind, { game?: GameIconName; line?: string }> = { set: { line: "sets" }, arcane: { game: "vosfor" }, mod: { game: "endo" }, part: { game: "ducats" }, other: { game: "market" } };
  const ticked = $derived(BULK_KINDS.filter((k) => settings.market.bulk[RULE_OF[k]]).length);
  // Listed already: what's left to put up.
  const listedNames = $derived(new Set(orders.map((o) => mkt.item(o.itemId)?.name)));
  const unlisted = $derived(worthy.filter((t) => !listedNames.has(t.name)).length);

  // ------------------------------------------------------------ fissures
  const ERAS = ["Lith", "Meso", "Neo", "Axi", "Requiem", "Omnia"] as const;
  const squad = $derived(settings.advice.squad > 1 ? 4 : 1);
  const relics = $derived(relicRows(model, { platPerDucat: settings.advice.platPerDucat }));
  const crackValue = (r: RelicRow) => {
    const radiant = (r.owned.Radiant ?? 0) > 0;
    const v = radiant ? (squad === 1 ? r.evRadiant : r.outRadiant.length ? expectedBest(r.outRadiant, squad) : null) : squad === 1 ? r.evIntact : r.outIntact.length ? expectedBest(r.outIntact, squad) : null;
    return { v: v == null ? null : Math.round(v * 10) / 10, refinement: radiant ? "Radiant" : "Intact" };
  };
  const bestFor = (era: string) => {
    let best: { r: RelicRow; v: number; refinement: string } | null = null;
    for (const r of relics) {
      if (era !== "Omnia" && r.era !== era) continue;
      const c = crackValue(r);
      if (c.v != null && (!best || c.v > best.v)) best = { r, v: c.v, refinement: c.refinement };
    }
    return best;
  };
  const fissures = $derived((live.fissures ?? []).filter((f) => !f.isStorm && Date.parse(f.expiry) > now));
  const eras = $derived(
    ERAS.map((era) => {
      const fs = fissures.filter((f) => f.tier === era);
      const normal = fs.filter((f) => !f.isHard);
      const hard = fs.filter((f) => f.isHard);
      const next = [...fs].sort((a, b) => Date.parse(b.expiry) - Date.parse(a.expiry))[0] ?? null;
      const owned = relics.filter((r) => era === "Omnia" || r.era === era).reduce((n, r) => n + r.total, 0);
      return { era, normal, hard, next, owned, best: bestFor(era) };
    }).filter((e) => e.normal.length + e.hard.length > 0 || (e.era !== "Omnia" && e.owned > 0)),
  );
  const eraIcon = (era: string): GameIconName => (era === "Omnia" ? "void-tear" : (`relic-${era.toLowerCase()}-intact` as GameIconName));
  const missionList = (fs: Fissure[]) => [...new Set(fs.map((f) => f.missionType))].join(" · ");

  // ------------------------------------------------------------ Baro & Varzia
  const baro = $derived(live.baro ?? null);
  const baroHere = $derived(!!baro && now >= Date.parse(baro.activation) && now < Date.parse(baro.expiry));
  const stock = $derived(baroHere ? baroStock(model) : []);
  const baroNeed = $derived(stock.filter((s) => s.mark === "mastery" || s.mark === "new"));
  const heldDucats = $derived((model.inventoryByBase.get("/Lotus/Types/Items/MiscItems/PrimeBucks") ?? []).reduce((n, r) => n + r.quantity, 0));
  const rows = $derived(masteryRows(model));
  const invasions = $derived(invasionNeeds(model, live.invasions));
  const day = $derived(today(model, live, now));

  // ------------------------------------------------------------ world clocks and fissure alerts
  const cycles = $derived(cycleTimers(live, now));
  const resets = $derived(resetTimers(live, now));
  const CYCLE_ICON: Record<string, GameIconName> = { earth: "cycles", cetus: "ostron", vallis: "solaris-united", cambion: "entrati", zariman: "holdfasts" };
  // The clocks' own names, short enough to fit their column whole (the tooltip has the long one).
  const CYCLE_SHORT: Record<string, string> = { cetus: "Cetus", cambion: "Cambion" };
  const RESET_SHORT: Record<string, string> = { daily: "Standing caps", weekly: "Archon, Circuit" };
  const watched = $derived(matchedFissures(settings.fissureRules, live.fissures, now));
  const MISSIONS = ["Capture", "Defense", "Disruption", "Excavation", "Extermination", "Hijack", "Interception", "Mobile Defense", "Rescue", "Sabotage", "Spy", "Survival", "Void Cascade", "Void Flood", "Void Armageddon", "Alchemy", "Skirmish", "Volatile", "Orphix"];
  const PLANETS = ["Mercury", "Venus", "Earth", "Lua", "Mars", "Phobos", "Deimos", "Ceres", "Jupiter", "Europa", "Saturn", "Uranus", "Neptune", "Pluto", "Sedna", "Eris", "Void", "Kuva Fortress", "Zariman", "Veil Proxima", "Earth Proxima", "Venus Proxima", "Saturn Proxima", "Neptune Proxima", "Pluto Proxima"];
  const missionTypes = $derived([...new Set([...MISSIONS, ...(live.fissures ?? []).map((f) => f.missionType)])].sort());
  const planets = $derived([...new Set([...PLANETS, ...(live.fissures ?? []).map((f) => planetOf(f.node)).filter(Boolean)])]);
  let adding = $state(false);
  /** The alert being changed, when one was clicked: Save puts the change in its place. */
  let editing = $state<string | null>(null);
  let draft = $state<Omit<FissureRule, "id">>({ tier: "any", mission: "any", planet: "any", mode: "any" });
  const duplicate = $derived(settings.fissureRules.some((r) => r.id !== editing && sameRule(r, draft)));
  function closeRule() {
    draft = { tier: "any", mission: "any", planet: "any", mode: "any" };
    adding = false;
    editing = null;
  }
  function editRule(r: FissureRule) {
    draft = { tier: r.tier, mission: r.mission, planet: r.planet, mode: r.mode };
    editing = r.id;
    adding = true;
  }
  function saveRule() {
    if (duplicate) return;
    const id = editing;
    settings.fissureRules = id ? settings.fissureRules.map((r) => (r.id === id ? { ...draft, id } : r)) : [...settings.fissureRules, { ...draft, id: `${Date.now()}` }];
    closeRule();
  }
  const removeRule = (id: string) => {
    settings.fissureRules = settings.fissureRules.filter((r) => r.id !== id);
    if (editing === id) closeRule();
  };
  const builds = $derived(foundryBuilds(model, settings.game.foundryReady, now));
  const buildable = $derived(rows.filter((r) => r.status === "build").sort((a, b) => b.points - a.points));
  // Your wishlist, still to get: what's left and whether a fissure for one of your relics is open now.
  // The ones you can crack a relic for now come first.
  const openNow = $derived(openEras(live.fissures, now));
  const wishes = $derived(crackableFirst(settings.favourites.map((u) => wishItem(model, u)).filter((w): w is WishItem => !!w && w.missing.length > 0), openNow));
  const crackable = (w: WishItem) => crackableNow(w, openNow);
  /** The item a Foundry build makes, when it's one with details (not a part). */
  const buildUnique = (name: string) => {
    const d = describe(model, name);
    return d?.kind === "gear" ? d.item.uniqueName : null;
  };
  // The button says how the copy went; a failed one shows the whisper to copy by hand.
  let copied = $state<{ key: string; ok: boolean } | null>(null);
  async function copy(d: { key: string; whisper: string }) {
    let ok = true;
    try {
      await navigator.clipboard.writeText(d.whisper);
    } catch {
      ok = false;
    }
    const mark = { key: d.key, ok };
    copied = mark;
    setTimeout(() => copied === mark && (copied = null), ok ? 2500 : 15_000);
  }
  // Ducats your spare parts would fetch, counting only the ones better traded in than sold.
  const spareDucats = $derived(partRows(model).filter((p) => p.spare > 0 && decide(p.price, p.ducats, p.tradesPerDay, settings.advice).verdict === "ducats").reduce((n, p) => n + p.ducats * p.spare, 0));
  const varzia = $derived(varziaNeeds(model, rows));

  // ------------------------------------------------------------ mastery
  const toLevel = $derived(rows.filter((r) => r.acq.difficulty === 0).sort((a, b) => b.points - a.points));
  const easiest = $derived(
    rows
      .filter((r) => r.acq.available && r.acq.difficulty > 0)
      .sort((a, b) => a.acq.difficulty - b.acq.difficulty || b.points - a.points)
      .slice(0, 6),
  );

  // ------------------------------------------------------------ alerts
  interface Alert { tone: "gold" | "red" | "info"; icon: GameIconName; text: string; act: string; to: string }
  const alerts = $derived.by(() => {
    const out: Alert[] = [];
    // Invasions rewarding a part for something you haven't mastered: they don't come back on demand.
    for (const n of invasions) out.push({ tone: "gold", icon: "invasion", text: `Invasion at ${n.node}: ${n.reward} for ${n.item} (side with ${n.side})${n.needed > 1 ? `, you have ${n.have} of ${n.needed}` : ""}`, act: "Mastery", to: "mastery" });
    if (shortListings.length) out.push({ tone: "gold", icon: "market", text: `${shortListings.length} listing${shortListings.length === 1 ? "" : "s"} for more than you hold: sold, or fix them`, act: "Open Orders", to: "market" });
    const statusError = mkt.statusError ?? mkt.status?.error;
    if (statusError) out.push({ tone: "red", icon: "market", text: `warframe.market status: ${statusError}`, act: "Open Orders", to: "market" });
    const urgent = varzia.filter((v) => v.onlyHere > 0 || v.regalAya != null);
    // Varzia's card says what she has; the alert is only for a rotation about to end.
    if (urgent.length && live.resurgenceExpiry && Date.parse(live.resurgenceExpiry) - now < 3 * DAY) out.push({ tone: "gold", icon: "varzia", text: `Varzia's rotation ends in ${until(live.resurgenceExpiry, now)}, with ${urgent.length} prime${urgent.length === 1 ? "" : "s"} you need`, act: "", to: "" });
    return out;
  });
</script>

{#snippet head(icon: GameIconName | null, line: string | null, title: string, to: string | null, action: string)}
  <header class="ph">
    <span class="pt">{#if icon}<GameIcon name={icon} size={22} />{:else if line}<Icon name={line} size={18} />{/if}<span class="register">{title}</span></span>
    {#if to}<button class="link" onclick={() => go(to)}>{action} →</button>{/if}
  </header>
{/snippet}

<div class="page"><div class="page-inner home">
  <header class="hello">
    <div>
      <span class="orn" aria-hidden="true"><i></i></span>
      <h1 class="mark">Home</h1>
    </div>
    <p class="dim">{new Date(now).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}</p>
  </header>

  {#if alerts.length}
    <section class="alerts" aria-label="Needs you">
      {#each alerts as a (a.text)}
        <div class="alert t-{a.tone}"><GameIcon name={a.icon} size={20} /><span>{a.text}</span>{#if a.to}<button class="link" onclick={() => go(a.to)}>{a.act} →</button>{/if}</div>
      {/each}
    </section>
  {/if}

  <div class="grid">
    <!-- World clocks -->
    {#if cycles.length || resets.length}
      <section class="panel world" aria-label="World clocks">
        {#each cycles as c (c.key)}
          <div class="clock" title="{c.label}: {c.state}{c.next ? `, ${c.next} in ${until(c.ends, now)}` : ''}">
            <GameIcon name={CYCLE_ICON[c.key]} size={26} />
            <div><span class="register clip1">{CYCLE_SHORT[c.key] ?? c.label}</span><b class="mark st st-{c.state}">{c.state}</b><span class="dim small nowrap">{until(c.ends, now)} left</span></div>
          </div>
        {/each}
        {#each resets.filter((r) => r.key !== "sortie") as r (r.key)}
          <div class="clock reset" title={r.state}>
            <span class="rk">{r.key === "sortie" ? "" : "↻"}</span>
            {#if r.key === "sortie"}<GameIcon name="sortie" size={22} />{/if}
            <div><span class="register">{r.label}</span><b class="mark">{until(r.ends, now)}</b><span class="dim small clip1">{RESET_SHORT[r.key] ?? r.state}</span></div>
          </div>
        {/each}
      </section>
    {/if}

    <!-- Market -->
    <section class="panel market">
      {@render head("market", null, "Market", "market", "Orders")}
      {#if mkt.linked}
        <div class="presence"><Presence settings={settings.market} quiet /></div>
        <div class="figs">
          <div><P v={listed} /><span class="register">Listed · {orders.length}</span></div>
          <div><b class="mark" class:warn={shortListings.length}>{shortListings.length}</b><span class="register">Can't deliver</span></div>
          <div><P v={sold(dayStart)} /><span class="register">Sold today</span></div>
          <div><P v={sold(now - 7 * DAY)} /><span class="register">Last 7 days</span></div>
        </div>
        {#if shortListings.length}
          <ul class="mini">
            {#each shortListings.slice(0, 3) as o (o.id)}
              {@const it = mkt.item(o.itemId)}
              <li><Thumb file={model.imageOf(it?.name ?? "")} name={it?.name ?? ""} size={22} /><span>{it?.name ?? "?"}</span><span class="warn small">listed {o.quantity}, sold some?</span></li>
            {/each}
          </ul>
        {/if}
        <div class="foot"><button class="link" onclick={() => go("sales")}>Sales log →</button></div>
      {:else if mkt.signInRefused}
        <p class="dim">warframe.market refused orbiter's sign-in. Sign out on <button class="link" onclick={() => go("market")}>Orders</button>, then sign in again.</p>
      {:else if mkt.accountError}
        <p class="dim">Signed in, but warframe.market can't be reached right now. orbiter tries again every minute; see <button class="link" onclick={() => go("market")}>Orders</button>.</p>
      {:else}
        <p class="dim">Not signed in to warframe.market. Sign in on <button class="link" onclick={() => go("market")}>Orders</button> to list, reprice and go online from here.</p>
      {/if}
    </section>

    <!-- Ready to sell -->
    <section class="panel ready">
      {@render head("platinum", null, "Ready to sell", "market", "Put them on sale")}
      {#if !ticked}
        <p class="dim">Nothing ticked in <b>Put my spares on sale</b> on Orders.</p>
      {:else if !byKind.length}
        <p class="dim">Nothing spare worth {settings.market.minPrice}p or more in what you ticked.</p>
      {:else}
        <div class="big"><P v={byKind.reduce((n, k) => n + k.plat, 0)} big /><span class="dim small">about, at daily median prices{unlisted ? ` · ${unlisted} not listed yet` : ""}</span></div>
        <ul class="kinds">
          {#each byKind as k (k.kind)}
            <li>
              {#if KIND_ICON[k.kind].game}<GameIcon name={KIND_ICON[k.kind].game!} size={20} />{:else}<Icon name={KIND_ICON[k.kind].line!} size={18} />{/if}
              <span>{KIND_LABEL[k.kind]}s</span><span class="dim">{k.count}</span><P v={k.plat} />
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <!-- Fissures -->
    <section class="panel fissures">
      {@render head("void-tear", null, "Fissures now", "relics", "Relics")}
      {#if live.fissures == null}
        <p class="dim">{liveNote}</p>
      {:else}
        <table class="eras">
          <thead><tr><th>Era</th><th class="right" title="Normal fissures, plus Steel Path">Open</th><th>Missions</th><th class="right ends" title="When the longest-running one closes">Ends in</th><th title={squad === 1 ? "The relic you hold whose crack is worth most, cracking alone" : "The relic you hold whose crack is worth most, best of four in a radshare"}>Your best relic</th><th class="right" title="Average platinum of the reward you'd take ({squad === 1 ? 'solo' : 'radshare'}; switch on Relics)">Plat / crack</th></tr></thead>
          <tbody>
            {#each eras as e (e.era)}
              <tr>
                <td><span class="era"><GameIcon name={eraIcon(e.era)} size={24} /><b class="mark">{e.era}</b></span></td>
                <td class="right nowrap">{e.normal.length}{#if e.hard.length}<span class="sp" title="Steel Path fissures">&nbsp;+&nbsp;{e.hard.length}&nbsp;SP</span>{/if}</td>
                <td class="dim small"><span class="clip" title={missionList([...e.normal, ...e.hard])}>{e.normal.length + e.hard.length ? missionList([...e.normal, ...e.hard]) : "none open"}</span></td>
                <td class="right dim small nowrap ends">{e.next ? until(e.next.expiry, now) : ""}</td>
                <td class="nowrap">{#if e.best}<span class="relic" use:info={e.best.r.base}><b class="mark">{e.best.r.base}</b><span class="dim small">{e.best.refinement} · {e.best.r.total} held</span></span>{:else}<span class="dim small">{e.era === "Omnia" ? "any relic" : "none held"}</span>{/if}</td>
                <td class="right">{#if e.best}<P v={e.best.v} />{/if}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
      <div class="watch">
        <span class="register"><Icon name="bell" size={12} /> Fissure alerts</span>
        {#each settings.fissureRules as r (r.id)}
          <span class="rule" class:editing={editing === r.id}><button class="rl" title="Change this alert" onclick={() => editRule(r)}>{ruleLabel(r)}</button><IconButton icon="close" tone="quiet" size={12} label="Remove this alert" onclick={() => removeRule(r.id)} /></span>
        {/each}
        {#if adding}
          <span class="addrule">
            <select bind:value={draft.mode} aria-label="Kind"><option value="any">Normal or SP</option><option value="normal">Normal</option><option value="steel">Steel Path</option><option value="storm">Void Storm</option></select>
            <select bind:value={draft.tier} aria-label="Era"><option value="any">Any era</option>{#each TIERS as t (t)}<option value={t}>{t}</option>{/each}</select>
            <select bind:value={draft.mission} aria-label="Mission"><option value="any">Any mission</option>{#each missionTypes as m (m)}<option value={m}>{m}</option>{/each}</select>
            <select bind:value={draft.planet} aria-label="Planet"><option value="any">Any planet</option>{#each planets as p (p)}<option value={p}>{p}</option>{/each}</select>
            <IconButton icon={editing ? "check" : "plus"} tone="gold" label={editing ? "Save this alert" : "Add this alert"} disabled={duplicate} onclick={saveRule} />
            <IconButton icon="close" tone="quiet" label="Cancel" onclick={closeRule} />
            {#if duplicate}<span class="dim small">You already have that alert.</span>{/if}
          </span>
        {:else}
          <button class="link add" onclick={() => (adding = true)}><Icon name="plus" size={11} />Add alert</button>
        {/if}
      </div>
      {#if watched.length}
        <ul class="hits">
          {#each watched as w (w.fissure.id)}
            <li><GameIcon name={eraIcon(w.fissure.tier)} size={18} /><b class="mark">{w.fissure.isHard ? "SP " : ""}{w.fissure.tier} {w.fissure.missionType}</b><span class="dim small">{w.fissure.node} · {w.fissure.enemy}</span><span class="grow"></span><span class="small nowrap">{until(w.fissure.expiry, now)} left</span></li>
          {/each}
        </ul>
      {:else if settings.fissureRules.length}
        <p class="dim small">Nothing matching open right now{settings.notify.fissures ? "; you'll get a notification when one opens" : ""}.</p>
      {/if}
    </section>

    <!-- Easiest mastery -->
    <!-- Worth doing today -->
    <section class="panel today">
      {@render head("nightwave", null, "Worth doing today", null, "")}
      <div class="tgrid">
        {#if day.circuit}
          <div class="tblock">
            <div class="th"><GameIcon name="mastery" size={18} /><b class="mark">Duviri Circuit</b><span class="dim small">◆ not mastered · new picks in {until(day.circuit.resets, now)}</span></div>
            <div class="chips">
              {#each day.circuit.frames as c (c.name)}<span class="pick" class:want={c.wanted} use:info={c.name}><Thumb file={c.image} size={22} />{c.name}{#if c.wanted}<em aria-label="worth taking">◆</em>{/if}</span>{/each}
            </div>
            <div class="th sub"><span class="register">Steel Path: Incarnon</span><span class="dim small">◆ a weapon you have, with no adapter yet</span></div>
            <div class="chips">
              {#each day.circuit.incarnons as c (c.name)}<span class="pick" class:want={c.wanted} use:info={c.name}><Thumb file={c.image} size={22} />{c.name}{#if c.wanted}<em aria-label="worth taking">◆</em>{/if}</span>{/each}
            </div>
          </div>
        {/if}
        {#if day.steelPath}
          <div class="tblock">
            <div class="th"><GameIcon name="steel-essence" size={18} /><b class="mark">Teshin's offer</b><span class="dim small">changes in {until(day.steelPath.ends, now)}</span></div>
            <p class="tline"><b>{day.steelPath.reward}</b> <span class="dim">for {day.steelPath.cost} Steel Essence</span></p>
          </div>
        {/if}
        {#if day.sortie || day.archon}
          <div class="tblock">
            {#if day.sortie}
              <div class="th"><GameIcon name="sortie" size={18} /><b class="mark">Sortie</b><span class="dim small">{day.sortie.boss} · {until(day.sortie.ends, now)} left</span></div>
              <p class="tline dim small">{day.sortie.missions.join(" · ")}</p>
            {/if}
            {#if day.archon}
              <div class="th"><GameIcon name="archon-shard" size={18} /><b class="mark">Archon Hunt</b><span class="dim small">{day.archon.boss}{day.archon.shard ? ` · ${day.archon.shard} shard` : ""} · {until(day.archon.ends, now)} left</span></div>
              <p class="tline dim small">{day.archon.missions.join(" · ")}</p>
            {/if}
          </div>
        {/if}
        {#if day.nightwave}
          <div class="tblock">
            <div class="th"><GameIcon name="nightwave" size={18} /><b class="mark">Nightwave</b><span class="dim small">{day.nightwave.standing.toLocaleString("en")} standing up for grabs</span></div>
            <ul class="nw">
              {#each day.nightwave.challenges.slice(0, 6) as c (c.title)}<li title={c.desc}><span class="k k-{c.kind}">{c.kind}</span><span class="nt">{c.title}</span><span class="dim small">{c.reputation.toLocaleString("en")}</span></li>{/each}
            </ul>
          </div>
        {/if}
        {#if !day.circuit && !day.steelPath && !day.nightwave && !day.sortie}<p class="dim">{liveNote}</p>{/if}
      </div>
    </section>

    <!-- Foundry -->
    <section class="panel foundry">
      {@render head("dojo", null, "Foundry", null, "")}
      {#if builds.length}
        <ul class="fb">
          {#each builds as b (b.key)}
            {@const u = buildUnique(b.name)}
            {#snippet body()}
              <Thumb file={b.image} size={26} name={b.name} />
              <span class="fn"><b class="mark">{b.name}</b>{#if b.points}<span class="dim small">+{b.points.toLocaleString("en")} mastery</span>{/if}</span>
              <span class="when2">{b.ready ? "Ready" : until(new Date(b.readyAt).toISOString(), now)}</span>
            {/snippet}
            <li class:done={b.ready}>{#if u}<button class="row" data-opens aria-label="{b.name}: details" onclick={() => details.open(u)}>{@render body()}</button>{:else}{@render body()}{/if}</li>
          {/each}
        </ul>
      {:else}
        <p class="dim small">{settings.game.masteryRank != null ? "Nothing building." : "Shows once the patched TennoScope reads your inventory."}</p>
      {/if}
      {#if buildable.length}
        <div class="register sub">You can build now</div>
        <ul class="fb">
          {#each buildable.slice(0, 4) as r (r.unique)}
            <li><button class="row" data-opens aria-label="{r.name}: details" onclick={() => details.open(r.unique)}><Thumb file={model.imageOf(r.name)} name={r.name} size={26} /><span class="fn"><b class="mark">{r.name}</b><span class="dim small">every part in hand</span></span><span class="pts"><GameIcon name="mastery" size={13} />{r.points.toLocaleString("en")}</span></button></li>
          {/each}
        </ul>
      {/if}
    </section>

    <!-- Wishlist -->
    <section class="panel wishes">
      {@render head(null, "star", "Your wishlist", "wishlist", "Wishlist")}
      {#if wishes.length}
        <ul class="fb">
          {#each wishes.slice(0, 4) as w (w.c.unique)}
            {@const now2 = crackable(w)}
            <li><button class="row" data-opens aria-label="{w.c.name}: details" onclick={() => details.open(w.c.unique)}>
              <Thumb file={w.c.image} name={w.c.name} size={26} />
              <span class="fn"><b class="mark">{w.c.name}</b>{#if now2.length}<span class="small gold">Crack {now2.slice(0, 2).join(" or ")} now</span>{:else}<span class="dim small">{w.missing.length} part{w.missing.length === 1 ? "" : "s"} to get{w.odds ? ` · ${Math.round(w.odds * 100)}% from your relics` : ""}</span>{/if}</span>
              {#if w.buyCost != null}<span class="when2" title="Buying what's missing at the daily median"><P v={w.buyCost} /></span>{/if}
            </button></li>
          {/each}
        </ul>
        {#if wishes.length > 4}<p class="dim small more">+{wishes.length - 4} more on your wishlist</p>{/if}
      {:else}
        <p class="dim small">{settings.favourites.length ? "Everything you starred is built or ready to build." : "Star a warframe or weapon in Foundry or Mastery and it shows here, with the relics to crack for it."}</p>
      {/if}
    </section>

    <!-- Cheap buys -->
    <section class="panel deals">
      {@render head("platinum", null, "Cheap buys", null, "")}
      {#if mkt.deals.length}
        <ul class="dl">
          {#each mkt.deals.slice(0, 6) as d (d.key)}
            <li>
              <Thumb file={model.imageOf(d.name)} name={d.name} size={26} />
              <span class="fn"><b class="mark">{d.name}</b><span class="dim small">{d.seller} · {d.why}</span></span>
              <span class="pr"><P v={d.price} /><s class="dim small">{d.usual}</s></span>
              <button class="link" class:failed={copied?.key === d.key && !copied.ok} onclick={() => copy(d)} title="Copy the whisper to paste in game chat">{copied?.key === d.key ? (copied.ok ? "Copied" : "Couldn't copy") : "Copy whisper"}</button>
              {#if copied?.key === d.key && !copied.ok}<input class="whisper" readonly value={d.whisper} aria-label="Whisper to copy by hand" onfocus={(e) => e.currentTarget.select()} />{/if}
            </li>
          {/each}
        </ul>
      {:else}
        <p class="dim small">{mkt.dealsAt && !mkt.dealsChecked ? "Couldn't reach warframe.market; it tries again in 10 minutes." : mkt.dealsAt ? `Nothing under ${Math.round(0.6 * 100)}% of its usual price right now, among the parts you're missing for nearly complete sets and the arcanes you tiered S to B.` : "Checking warframe.market…"}</p>
      {/if}
      <p class="live small" title={mkt.feed?.error ?? "Every new listing on warframe.market is checked as it goes up"}>
        {#if mkt.feed?.connected}<i class="dot" aria-hidden="true"></i>Watching new listings live{mkt.liveDeals ? ` · ${mkt.liveDeals} caught` : ""}{:else if mkt.feed?.running}Connecting to the live feed…{/if}
      </p>
    </section>

    <section class="panel mastery">
      {@render head("mastery", null, "Easiest mastery next", "mastery", "Mastery")}
      {#if toLevel.length}
        <button class="levelrow" onclick={() => go("mastery")} title="Things you own that aren't at max rank yet">
          <GameIcon name="mastery" size={26} />
          <span><b class="mark">{toLevel.length} to level</b><span class="dim small">{toLevel.slice(0, 4).map((r) => r.name).join(", ")}{toLevel.length > 4 ? "…" : ""}</span></span>
          <span class="pts big" title="Mastery points at max rank"><GameIcon name="mastery" size={18} />{toLevel.reduce((n, r) => n + r.points, 0).toLocaleString("en")}</span>
        </button>
      {/if}
      <ul class="mr">
        {#each easiest as r (r.unique)}
          <li><button class="row" data-opens aria-label="{r.name}: details" onclick={() => details.open(r.unique)}>
            <Thumb file={model.imageOf(r.name)} name={r.name} size={30} />
            <span class="mrname" title={r.acq.how}><b class="mark">{r.name}</b></span>
            <Effort acq={r.acq} />
            <span class="pts"><GameIcon name="mastery" size={13} />{r.points.toLocaleString("en")}</span>
          </button></li>
        {/each}
      </ul>
    </section>

    <!-- Baro -->
    <section class="panel baro">
      {@render head("baro", null, "Baro Ki’Teer", "parts", "Spares for ducats")}
      {#if !baro}
        <p class="dim">Schedule unavailable.</p>
      {:else}
        <div class="when">
          {#if baroHere}<b class="mark gold">Here now</b><span class="dim">{baro.location} · leaves in {until(baro.expiry, now)}</span>
          {:else}<b class="mark">In {until(baro.activation, now)}</b><span class="dim">{baro.location} · {new Date(baro.activation).toLocaleString(undefined, { weekday: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>{/if}
        </div>
        <div class="ducats"><P v={heldDucats} d /><span class="dim small">ducats held</span>{#if spareDucats}<span class="dim">·</span><P v={spareDucats} d dim /><span class="dim small">more from spare parts</span>{/if}</div>
        {#if baroHere}
          <ul class="stock">
            {#each baroNeed as s (s.unique)}
              <li>
                <Thumb file={s.image} size={24} name={s.name} />
                <span class="sn" use:info={s.name}>{s.name}</span>
                <span class="mk">{#if s.mark === "mastery"}<span class="tag gold" title="You haven't mastered it">+{s.points?.toLocaleString("en")} mastery</span>{:else if s.mark === "new"}<span class="tag gold">new to you</span>{:else if s.mark === "have"}<span class="tag">you have it</span>{/if}</span>
                <P v={s.ducats} d dim={s.mark === "have"} />
              </li>
            {/each}
          </ul>
          {#if !baroNeed.length}<p class="dim small">Nothing in his stock you don't already have.</p>{/if}
          {#if stock.length > baroNeed.length}<p class="dim small">+{stock.length - baroNeed.length} more you have or that give no mastery (cosmetics and the like).</p>{/if}
        {/if}
      {/if}
    </section>

    <!-- Varzia -->
    <section class="panel varzia" class:slim={!!live.resurgence && !varzia.length}>
      {@render head("varzia", null, "Varzia: Prime Resurgence", "relics", "Relics")}
      {#if !live.resurgence}
        <p class="dim">Rotation unavailable.</p>
      {:else}
        <div class="when"><b class="mark">{varzia.length ? `${varzia.length} you need` : "Nothing you need"}</b><span class="dim">{varzia.length ? "" : "every prime she has, you've mastered or can build · "}rotation ends in {until(live.resurgenceExpiry, now)}</span></div>
        <ul class="vz">
          {#each varzia.slice(0, 8) as v (v.name)}
            <li>
              <Thumb file={v.image} size={26} name={v.name} />
              <span class="sn"><b class="mark" use:info={v.name}>{v.name}</b><span class="dim small">{v.regalAya != null ? `whole for ${v.regalAya} Regal Aya` : ""}{v.regalAya != null && v.relics.length ? " · " : ""}{v.relics.length ? `${v.relics.slice(0, 3).join(", ")}${v.relics.length > 3 ? "…" : ""} for ${v.missing === 1 ? "the last part" : `${v.missing} parts`}` : ""}</span></span>
              {#if v.onlyHere}<span class="tag gold" title="Missing parts that drop only from Varzia's relics right now">only here</span>{/if}
              <GameIcon name="aya" size={16} />
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  </div>
</div></div>

<style>
  .hello { display: flex; justify-content: space-between; align-items: flex-end; padding: clamp(24px, 4vh, 44px) 0 var(--step); gap: 1rem; }
  .hello h1 { font-size: clamp(2.4rem, 4.6vw, 3.8rem); }
  .hello p { margin: 0 0 .6rem; }
  .orn { display: flex; align-items: center; width: 4.5rem; margin-bottom: .9rem; }
  .orn i { width: .5rem; height: .5rem; flex: none; background: var(--gold); transform: rotate(45deg); }
  .orn::after { content: ""; flex: 1; height: 1px; margin-left: .35rem; background: linear-gradient(90deg, var(--gold-dim), transparent); }

  .alerts { display: grid; gap: .5rem; margin-bottom: var(--step); }
  .alert { display: flex; align-items: center; gap: .8rem; padding: .65rem 1rem; border: 1px solid var(--rule); background: var(--plate); box-shadow: inset 3px 0 0 var(--platinum-deep); }
  .alert span { flex: 1; }
  .t-gold { box-shadow: inset 3px 0 0 var(--gold); }
  .t-red { box-shadow: inset 3px 0 0 var(--oxblood); }

  .grid { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: var(--step); padding-bottom: var(--course); }
  .panel { border: 1px solid var(--rule); background: rgb(17 19 23 / 72%); padding: 1rem 1.2rem 1.1rem; min-width: 0; display: flex; flex-direction: column; gap: .8rem; }
  .market { grid-column: span 7; }
  .ready { grid-column: span 5; }
  .fissures { grid-column: span 12; }
  /* The same 7 + 5 split as the rows above, so the panel edges line up down the page. */
  .mastery { grid-column: span 7; grid-row: span 2; }
  .baro { grid-column: span 5; }
  .world { grid-column: span 12; display: grid; grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr)); gap: 0; padding: 0; }
  .clock { display: flex; gap: .6rem; align-items: center; padding: .8rem 1rem; border-left: 1px solid var(--rule); min-width: 0; }
  .clock:first-child { border-left: 0; }
  .clock > div { display: grid; gap: .2rem; min-width: 0; }
  .clock .register { font-size: .6rem; }
  .clock b { font-size: 1.15rem; }
  .st-day, .st-warm, .st-fass, .st-corpus { color: var(--gold); }
  .st-night, .st-cold, .st-vome, .st-grineer { color: #8fb3e0; }
  .clock.reset b { color: var(--platinum); }
  .rk { font-size: 1.2rem; color: var(--gold-dim); width: 22px; text-align: center; }
  .rk:empty { display: none; }
  .clip1 { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .watch { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem .7rem; margin-top: 1rem; padding-top: .9rem; border-top: 1px solid var(--rule); }
  .watch > .register { display: inline-flex; align-items: center; gap: .35rem; }
  .rule { display: inline-flex; align-items: center; gap: .3rem; padding: .1rem .1rem .1rem .55rem; border: 1px solid var(--gold-dim); font-size: .8rem; }
  .rule :global(.ib) { --ib: 22px; }
  .add { display: inline-flex; align-items: center; gap: .35rem; }
  .rl { padding: 0; border: 0; background: none; font: inherit; letter-spacing: normal; text-transform: none; color: var(--platinum); }
  .rl:hover:not(:disabled) { color: var(--gold); background: none; }
  .rule.editing { border-color: var(--gold); }
  .addrule { display: inline-flex; flex-wrap: wrap; gap: .4rem; align-items: center; }
  .hits { list-style: none; margin: .7rem 0 0; padding: 0; display: grid; gap: .35rem; }
  .hits li { display: flex; align-items: center; gap: .55rem; }
  .hits b { font-size: .98rem; }
  .today { grid-column: span 7; grid-row: span 3; }
  .wishes { grid-column: span 5; }
  .gold { color: var(--gold); }
  .more { margin: .5rem 0 0; }
  .foundry { grid-column: span 5; }
  .deals { grid-column: span 5; }
  .live { margin: .6rem 0 0; color: var(--platinum-deep); display: flex; align-items: center; gap: .45rem; }
  .live:empty { display: none; }
  .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--verdigris); box-shadow: 0 0 0 3px color-mix(in srgb, var(--verdigris) 25%, transparent); }
  .varzia { grid-column: span 5; }
  /* Narrower: the clocks drop their icons to stay on one row. */
  /* Page area under 1100 px (App sets the flag, by the room pages actually have). */
  :global(html[data-room~="lt1100"]) .clock { padding: .7rem .75rem; }
  :global(html[data-room~="lt1100"]) .clock > :global(:first-child:not(div)) { display: none; }
  /* Page area under 930 px (App sets the flag, by the room pages actually have). */
  :global(html[data-room~="lt930"]) .world { grid-template-columns: repeat(auto-fit, minmax(6.3rem, 1fr)); }
  :global(html[data-room~="lt930"]) .clock { padding: .6rem .55rem; }
  /* Page area under 900 px (App sets the flag, by the room pages actually have). */
  :global(html[data-room~="lt900"]) .market, :global(html[data-room~="lt900"]) .ready, :global(html[data-room~="lt900"]) .fissures, :global(html[data-room~="lt900"]) .mastery, :global(html[data-room~="lt900"]) .baro, :global(html[data-room~="lt900"]) .varzia, :global(html[data-room~="lt900"]) .today, :global(html[data-room~="lt900"]) .foundry, :global(html[data-room~="lt900"]) .deals, :global(html[data-room~="lt900"]) .wishes { grid-column: span 12; }
  /* Half a small screen: the fissure table loses "Ends in" (the missions' own times are on hover), and the clocks go four to a row. */
  :global(html[data-room~="lt760"]) .ends { display: none; }
  :global(html[data-room~="lt760"]) .world { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  :global(html[data-room~="lt760"]) .clock:nth-child(4n + 1) { border-left: 0; }
  :global(html[data-room~="lt760"]) .clock:nth-child(n + 5) { border-top: 1px solid var(--rule); }
  .tgrid { display: grid; gap: .9rem; }
  .tblock { display: grid; gap: .35rem; }
  .th { display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; }
  .th b { font-size: 1rem; }
  .th.sub { margin-top: .2rem; }
  .tline { margin: 0; }
  .tline b { color: var(--platinum); font-weight: 600; }
  .chips { display: flex; flex-wrap: wrap; gap: .35rem; }
  .pick { display: inline-flex; align-items: center; gap: .4rem; padding: .2rem .55rem .2rem .25rem; border: 1px solid var(--rule); font-size: .82rem; color: var(--platinum-dim); }
  .pick.want { border-color: var(--gold-dim); color: var(--platinum); }
  .pick em { font-style: normal; font-size: .6rem; color: var(--gold); }
  .nw { list-style: none; margin: 0; padding: 0; display: grid; gap: .25rem; }
  .nw li { display: grid; grid-template-columns: 4.2rem 1fr auto; gap: .5rem; align-items: center; font-size: .84rem; }
  .k { font-family: var(--face-register); font-size: .6rem; letter-spacing: .1em; text-transform: uppercase; color: var(--platinum-deep); }
  .k-elite { color: var(--gold); }
  .nt { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fb, .dl { list-style: none; margin: 0; padding: 0; display: grid; gap: .45rem; }
  .fb li { display: grid; grid-template-columns: 26px minmax(0, 1fr) auto; gap: .6rem; align-items: center; }
  /* A row that opens the item's details: the whole row is the button, laid out as the row was. */
  .fb li:has(> .row), .mr li:has(> .row) { display: block; }
  .row { all: unset; box-sizing: border-box; width: 100%; display: grid; align-items: center; cursor: pointer; }
  .fb .row { grid-template-columns: 26px minmax(0, 1fr) auto; gap: .6rem; }
  .mr .row { grid-template-columns: 30px minmax(0, 1fr) 8.5rem 4.8rem; gap: .7rem; }
  .row:hover .mark { color: var(--gold); }
  .row:focus-visible { outline: 1px solid var(--gold); outline-offset: 2px; }
  .fb li.done .when2 { color: var(--verdigris); font-weight: 600; }
  .fn { display: grid; min-width: 0; }
  .fn b { font-size: .98rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fn .small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .when2 { font-variant-numeric: tabular-nums; color: var(--platinum-dim); white-space: nowrap; }
  .sub { margin-top: .4rem; color: var(--platinum-deep); }
  .dl li { display: grid; grid-template-columns: 26px minmax(0, 1fr) auto auto; gap: .6rem; align-items: center; }
  /* The clipboard refused: the whisper, selected, to copy by hand. */
  .dl .failed { color: var(--oxblood); }
  .dl .whisper { grid-column: 2 / -1; font-size: .78rem; padding: .3rem .5rem; }
  .pr { display: inline-flex; align-items: center; gap: .4rem; }

  .ph { display: flex; justify-content: space-between; align-items: center; gap: 1rem; padding-bottom: .6rem; border-bottom: 1px solid var(--rule); }
  .pt { display: inline-flex; align-items: center; gap: .55rem; }
  .pt .register { color: var(--platinum); font-size: .66rem; }
  .ph .link { font-size: .78rem; }

  .presence { padding-bottom: .2rem; }
  .foot { margin-top: auto; }
  .note { margin: 0; }
  .nowrap { white-space: nowrap; }
  .clip { display: block; max-width: 30rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .relic { display: grid; }
  .relic b { font-size: 1rem; }
  .relic .small { font-family: var(--face-text); }
  .mk { min-width: 7.5rem; display: flex; justify-content: flex-end; }
  .levelrow { all: unset; cursor: pointer; display: grid; grid-template-columns: 30px minmax(0, 1fr) auto; gap: .7rem; align-items: center; padding: .55rem .7rem; border: 1px solid var(--rule-bright); background: var(--raised); }
  .levelrow:hover { border-color: var(--platinum-deep); }
  .levelrow:focus-visible { border-color: var(--gold); }
  .levelrow:active { background: var(--well); }
  .levelrow > span:nth-child(2) { display: grid; min-width: 0; }
  .levelrow .small { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pts.big { font-family: var(--face-mark); font-size: 1.3rem; color: var(--platinum); }
  .figs { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 1rem; }
  .figs > div { display: grid; gap: .3rem; align-content: start; }
  .figs > div :global(.amt b) { font-size: 1.5rem; }
  .figs b.mark { font-size: 1.5rem; line-height: 1; }
  .figs b.warn { color: var(--gold); }
  .figs .register { font-size: .6rem; color: var(--platinum-deep); }
  .mini { list-style: none; margin: 0; padding: 0; display: grid; gap: .3rem; }
  .mini li { display: flex; align-items: center; gap: .6rem; }
  .warn { color: var(--gold); }

  .big { display: flex; align-items: baseline; gap: .8rem; font-size: 2.2rem; flex-wrap: wrap; }
  .kinds { list-style: none; margin: 0; padding: 0; display: grid; gap: .45rem; }
  .kinds li { display: grid; grid-template-columns: 22px 1fr auto 5rem; align-items: center; gap: .7rem; }
  .kinds li :global(.amt) { justify-self: end; }

  .eras { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  .eras th { text-align: left; font-family: var(--face-register); font-weight: 500; font-size: .6rem; letter-spacing: .14em; text-transform: uppercase; color: var(--platinum-deep); padding: 0 .5rem .4rem; }
  .eras td { padding: .4rem .5rem; border-top: 1px solid var(--rule); }
  .right, .eras th.right { text-align: right; }
  .era { display: inline-flex; align-items: center; gap: .5rem; }
  .era b { font-size: 1.05rem; }
  .sp { color: var(--platinum-deep); font-size: .8rem; }
  .slim { gap: .5rem; }
  .slim .when b { font-size: 1.15rem; }
  .left { color: var(--platinum-deep); }

  .mr { list-style: none; margin: 0; padding: 0; display: grid; gap: .55rem; }
  .mr li { display: grid; grid-template-columns: 30px minmax(0, 1fr) 8.5rem 4.8rem; align-items: center; gap: .7rem; }
  .mrname { display: grid; min-width: 0; }
  .mrname b { font-size: 1rem; }
  .how { font-size: .74rem; color: var(--platinum-deep); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pts { display: inline-flex; align-items: center; gap: .25rem; justify-content: flex-end; font-variant-numeric: tabular-nums; color: var(--platinum-dim); font-size: .85rem; }

  .when { display: flex; align-items: baseline; gap: .8rem; flex-wrap: wrap; }
  .when b { font-size: 1.5rem; }
  .gold { color: var(--gold); }
  .ducats { display: flex; align-items: center; gap: .5rem; }
  .stock, .vz { list-style: none; margin: 0; padding: 0; display: grid; gap: .4rem; }
  .stock li { display: grid; grid-template-columns: 24px minmax(0, 1fr) auto 4rem; gap: .6rem; align-items: center; }
  .stock li :global(.amt) { justify-self: end; }
  .sn { min-width: 0; display: grid; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sn .small { overflow: hidden; text-overflow: ellipsis; }
  .vz { grid-template-columns: repeat(auto-fill, minmax(min(26rem, 100%), 1fr)); column-gap: 1.6rem; }
  .vz li { display: grid; grid-template-columns: 26px minmax(0, 1fr) auto 16px; gap: .6rem; align-items: center; }
  .tag.gold { color: var(--gold); border-color: var(--gold-dim); }
</style>
