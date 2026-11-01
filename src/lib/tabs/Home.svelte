<script lang="ts">
  import { info } from "../hover.svelte";
  // Today at a glance: anything that needs you, your market, live fissures and your best relic for
  // each, what's ready to sell, what's worth doing today, your Foundry, cheap buys, the easiest
  // mastery, and Baro and Varzia against your collection.
  import type { Model } from "../core/model";
  import type { Live, MissionState } from "../core/types";
  import type { Settings } from "../backend";
  import type { MyOrder } from "../core/market";
  import { mkt } from "../marketStore.svelte";
  import { masteryRows, relicRows, type RelicRow } from "../core/views";
  import { sellTargets, KIND_LABEL, BULK_KINDS, RULE_OF, type BulkKind } from "../core/bulk";
  import { expectedBest } from "../core/advice";
  import { baroStock, varziaNeeds, until } from "../core/traders";
  import { invasionNeeds } from "../core/invasions";
  import { alertNeeds, describeHelp } from "../core/worldNeeds";
  import GameIcon, { type GameIconName } from "../ui/GameIcon.svelte";
  import Icon from "../ui/Icon.svelte";
  import IconButton from "../ui/IconButton.svelte";
  import Chip from "../ui/Chip.svelte";
  import Effort from "../ui/Effort.svelte";
  import Thumb from "../ui/Thumb.svelte";
  import P from "../ui/P.svelte";
  import Presence from "../ui/Presence.svelte";
  import { partRows } from "../core/views";
  import { decide } from "../core/advice";
  import { today } from "../core/today";
  import { foundryBuilds } from "../core/foundry";
  import { crackableFirst, crackableNow, openEras, wishItem, type WishItem } from "../core/wishlist";
  import { eventViews } from "../core/events";
  import type { RelicReward } from "../core/types";
  import { checkedWhen, cycleTimers, resetTimers, matchedFissures, planetOf, ruleLabel, sameRule, TIERS, type FissureRule } from "../core/timers";
  import { details } from "../details.svelte";
  import { bountyBoards, type BountyTable } from "../core/board";
  import { scoreCards } from "../core/pick";
  import FissureBoard from "../ui/FissureBoard.svelte";
  import BountyBoard from "../ui/BountyBoard.svelte";
  import { describe } from "../core/describe";

  // console: you play on a console or phone, so there's no inventory: Home is the market, the
  // world's clocks, fissures, what's worth doing and Baro, without anything measured against a collection.
  let { model, live, mission, settings = $bindable(), go, shortListings, liveAt = null, liveError = null, console = false, reveal = null, bountyTables = null, sortieRewards = null }: { model: Model; live: Live; mission: MissionState | null; settings: Settings; go: (t: string) => void; shortListings: MyOrder[]; liveAt?: number | null; liveError?: string | null; console?: boolean; reveal?: string | null; bountyTables?: BountyTable[] | null; sortieRewards?: RelicReward[] | null } = $props();
  let sortieOpen = $state(false);
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
  const hiddenCount = $derived(orders.filter((o) => !o.visible).length);
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
  const KIND_ICON: Record<BulkKind, { game?: GameIconName; line?: string }> = { set: { line: "sets" }, arcane: { game: "vosfor" }, mod: { game: "endo" }, part: { game: "ducats" }, imprint: { game: "companions" }, other: { game: "market" } };
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
      // Omnia fissures take Lith to Axi relics, not Requiem ones.
      if (era === "Omnia" ? r.era === "Requiem" : r.era !== era) continue;
      const c = crackValue(r);
      if (c.v != null && (!best || c.v > best.v)) best = { r, v: c.v, refinement: c.refinement };
    }
    return best;
  };
  // Your best relic for each era, worked out once per era rather than per fissure.
  const bests = $derived(new Map<string, ReturnType<typeof bestFor>>(ERAS.map((era) => [era, bestFor(era)])));
  const eraBest = (era: string) => {
    const b = console ? null : bests.get(era);
    return b ? { name: b.r.base, refinement: b.refinement, held: `${b.r.owned[b.refinement] ?? 0} of ${b.r.total} held`, plat: b.v } : null;
  };
  const eraIcon = (era: string): GameIconName => (era === "Omnia" ? "void-tear" : (`relic-${era.toLowerCase()}-intact` as GameIconName));

  // ------------------------------------------------------------ bounties
  /** A reward you'd want: a part for something you haven't mastered or built. */
  const need = (name: string) => !console && (scoreCards(model, [name])[0]?.needed ?? false);
  const boards = $derived(bountyBoards(live.syndicates ?? null, bountyTables, need));
  /** A bounty reward that's a part or a whole item opens that item's details. */
  const masterables = $derived(new Map([...model.catalogByUnique.values()].filter((i) => i.masterable).map((i) => [i.name, i.uniqueName])));
  const rewardOpens = (name: string) => {
    // "Gara Neuroptics Blueprint" → Gara: the longest item name it starts with.
    const words = name.replace(/ Blueprint$/, "").split(" ");
    let u: string | undefined;
    for (let n = words.length; n > 0 && !u; n--) u = masterables.get(words.slice(0, n).join(" "));
    return u ? () => details.open(u!) : null;
  };

  // ------------------------------------------------------------ Baro & Varzia
  const baro = $derived(live.baro ?? null);
  const baroHere = $derived(!!baro && now >= Date.parse(baro.activation) && now < Date.parse(baro.expiry));
  const stock = $derived(baroHere ? baroStock(model) : []);
  const baroNeed = $derived(stock.filter((s) => s.mark === "mastery" || s.mark === "new"));
  const heldDucats = $derived((model.inventoryByBase.get("/Lotus/Types/Items/MiscItems/PrimeBucks") ?? []).reduce((n, r) => n + r.quantity, 0));
  const rows = $derived(masteryRows(model));
  const invasions = $derived(invasionNeeds(model, live.invasions));
  // Running alerts worth a look: mastery you're missing (PC only: it needs your inventory), rare rewards.
  const worldAlerts = $derived(alertNeeds(console ? null : model, live.alerts, now));
  const day = $derived(today(model, live, now));

  // ------------------------------------------------------------ world clocks and fissure alerts
  const cycles = $derived(cycleTimers(live, now));
  const events = $derived(eventViews(live.events, now));
  const resets = $derived(resetTimers(live, now));
  const CYCLE_ICON: Record<string, GameIconName> = { earth: "cycles", cetus: "ostron", vallis: "solaris-united", cambion: "entrati", zariman: "holdfasts", duviri: "mastery" };
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
  // Every part in hand: ready now first, then what's short on star-chart resources, then the ones
  // that need an open world or an event (Hildryn's Lazulite Toroid).
  const TIER_ORDER = { now: 0, farm: 1, hard: 2, parts: 3 } as const;
  const buildable = $derived(rows.filter((r) => r.status === "build").sort((a, b) => TIER_ORDER[a.buildTier ?? "now"] - TIER_ORDER[b.buildTier ?? "now"] || b.points - a.points));
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
  // As Prime parts counts them: parts that go into a complete set you can sell are sold as the set.
  const spareDucats = $derived(partRows(model).filter((p) => p.spare > 0 && p.inSets <= 0 && decide(p.price, p.ducats, p.tradesPerDay, settings.advice).verdict === "ducats").reduce((n, p) => n + p.ducats * p.spare, 0));
  const varzia = $derived(console ? [] : varziaNeeds(model, rows));
  // On a console, her stock as it is: the primes she sells whole, and how many relics.
  const varziaWhole = $derived((live.resurgence ?? []).filter((v) => v.ducats != null && !/ Relic$/.test(v.item)).sort((a, b) => (b.ducats ?? 0) - (a.ducats ?? 0)));
  const varziaRelics = $derived((live.resurgence ?? []).filter((v) => / Relic$/.test(v.item)).length);

  // ------------------------------------------------------------ mastery
  const toLevel = $derived(rows.filter((r) => r.acq.difficulty === 0).sort((a, b) => b.points - a.points));
  const easiest = $derived(
    rows
      .filter((r) => r.acq.available && r.acq.difficulty > 0)
      .sort((a, b) => a.acq.difficulty - b.acq.difficulty || b.points - a.points)
      .slice(0, 6),
  );

  // ------------------------------------------------------------ alerts
  // key: what dismissing it remembers (the text changes as time passes). Problems that need fixing
  // (listings, the status connection) can't be dismissed: they go when they're fixed.
  interface Alert { key: string | null; tone: "gold" | "red" | "info"; icon: GameIconName; text: string; act: string; to: string }
  const dismissed = $derived(new Set(settings.homeDismissed));
  function dismiss(key: string) {
    settings.homeDismissed = [key, ...settings.homeDismissed.filter((k) => k !== key)].slice(0, 200);
  }
  const alerts = $derived.by(() => all().filter((a) => !a.key || !dismissed.has(a.key)));
  const all = () => {
    const out: Alert[] = [];
    // Invasions rewarding a part for something you haven't mastered: they don't come back on demand.
    for (const a of worldAlerts.mastery) out.push({ key: `alert|${a.key}`, tone: "gold", icon: "mastery", text: `Alert at ${a.node} (${a.mission}): ${describeHelp(a.reward, a.help!)}, ${until(a.expiry, now)} left`, act: "", to: "" });
    for (const a of worldAlerts.rare) out.push({ key: `alert|${a.key}`, tone: "info", icon: "sortie", text: `Alert at ${a.node} (${a.mission}): ${a.reward}, ${until(a.expiry, now)} left`, act: "", to: "" });
    if (!console) for (const n of invasions) out.push({ key: `invasion|${n.key}`, tone: "gold", icon: "invasion", text: `Invasion at ${n.node}: ${n.reward} for ${n.item} (side with ${n.side})${n.needed > 1 ? `, you have ${n.have} of ${n.needed}` : ""}`, act: "Mastery", to: "mastery" });
    if (shortListings.length) out.push({ key: null, tone: "gold", icon: "market", text: `${shortListings.length} listing${shortListings.length === 1 ? "" : "s"} for more than you hold: sold, or fix them`, act: "Open Orders", to: "market" });
    const statusError = mkt.statusError ?? mkt.status?.error;
    if (statusError) out.push({ key: null, tone: "red", icon: "market", text: `warframe.market status: ${statusError}`, act: "Open Orders", to: "market" });
    const urgent = varzia.filter((v) => v.onlyHere > 0 || v.regalAya != null);
    // Varzia's card says what she has; the alert is only for a rotation about to end.
    if (!console && urgent.length && live.resurgenceExpiry && Date.parse(live.resurgenceExpiry) - now < 3 * DAY) out.push({ key: `varzia|${live.resurgenceExpiry}`, tone: "gold", icon: "varzia", text: `Varzia's rotation ends in ${until(live.resurgenceExpiry, now)}, with ${urgent.length} prime${urgent.length === 1 ? "" : "s"} you need`, act: "", to: "" });
    return out;
  };

  // ---------------------------------------------------------------- what Home shows (Customise)
  const CARDS: { key: string; label: string; hint: string; consoleHint?: string }[] = [
    { key: "alerts", label: "Needs you", hint: "Alerts and invasions worth a look, listings to fix, Varzia's rotation ending", consoleHint: "Alerts with rare rewards" },
    { key: "world", label: "World clocks", hint: "Day and night on the open worlds, Duviri's mood, and the daily and weekly resets" },
    { key: "market", label: "Market", hint: "Your warframe.market status, what you have listed, and what sold" },
    { key: "ready", label: "Ready to sell", hint: "Your spares worth listing, in the kinds ticked on Orders" },
    { key: "fissures", label: "Fissures now", hint: "Every open fissure (normal, Steel Path or Void Storms), your best relic for each era, and your fissure alerts", consoleHint: "Every open fissure (normal, Steel Path or Void Storms), and your fissure alerts" },
    { key: "bounties", label: "Bounties", hint: "The bounties in Cetus, Fortuna, the Necralisk, the Zariman, Cavia and Höllvania, and what each pays" },
    { key: "events", label: "Events", hint: "Events running in game (Tactical Alerts, operations, seasonal ones): where, until when, and what they pay" },
    { key: "today", label: "Worth doing today", hint: "The Duviri Circuit, Darvo's deal, Teshin, the Sortie (its missions, modifiers and reward chances), the Archon Hunt and Nightwave" },
    { key: "foundry", label: "Foundry", hint: "What's building, and what you have every part for" },
    { key: "wishes", label: "Your wishlist", hint: "What you starred and still need, with relics to crack for it" },
    { key: "deals", label: "Cheap buys", hint: "Parts and arcanes you're after, listed well under their usual price" },
    { key: "mastery", label: "Easiest mastery next", hint: "What to level, and the easiest things you haven't mastered" },
    { key: "baro", label: "Baro Ki’Teer", hint: "When he comes, and what he brings that's new to you", consoleHint: "When he comes, and what he brings" },
    { key: "varzia", label: "Varzia", hint: "Prime Resurgence: the primes you still need from her rotation", consoleHint: "Prime Resurgence: what's in her rotation, and when it ends" },
  ];
  /** Cards that need your inventory: never on a console. */
  const NEEDS_INVENTORY = new Set(["ready", "foundry", "wishes", "deals", "mastery"]);
  const cards = $derived(console ? CARDS.filter((c) => !NEEDS_INVENTORY.has(c.key)).map((c) => ({ ...c, hint: c.consoleHint ?? c.hint })) : CARDS);
  let customising = $state(false);
  const hidden = $derived(new Set(settings.homeHidden));
  // A card a notification opened shows even if you hid it, until you leave Home.
  const off = (key: string) => key !== reveal && (hidden.has(key) || (console && NEEDS_INVENTORY.has(key)));
  function toggleCard(key: string, on: boolean) {
    settings.homeHidden = on ? settings.homeHidden.filter((k) => k !== key) : [...settings.homeHidden, key];
  }
  // The wide card on the left of each row and the narrow ones beside it. With all of one side
  // off, the other takes the whole width, so no row is left half empty.
  const BESIDE: Record<string, string[]> = { market: ["ready"], today: ["foundry", "wishes", "deals"], mastery: ["baro", "varzia"] };
  const shownBeside = (key: string) => BESIDE[key].filter((k) => !off(k)).length;
  const alone = (key: string) => shownBeside(key) === 0;
  const rowSpan = (key: string) => (alone(key) ? "auto" : `span ${shownBeside(key)}`);
  const orphan = (key: string) => off(Object.keys(BESIDE).find((l) => BESIDE[l].includes(key))!);
  /** Cards left beside a wide one you hid share its row: 12 columns between however many there are. */
  const lone = (key: string) => {
    const lead = Object.keys(BESIDE).find((l) => BESIDE[l].includes(key))!;
    return !off(lead) && shownBeside(lead) === 1;
  };
  const share = (key: string) => {
    const lead = Object.keys(BESIDE).find((l) => BESIDE[l].includes(key))!;
    return Math.round(12 / Math.max(1, shownBeside(lead)));
  };
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
    <div class="hr">
      <div class="dt"><p class="dim">{new Date(now).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}</p>
      {#if liveAt != null}<p class="dim small upd" class:old={!!liveError} title={`Fissures, the clocks, bounties, Baro, Varzia, the Sortie, events and the rest come from ${live.fromGame ? "the game's own worldstate (api.warframestat.us isn't answering)" : "api.warframestat.us"}, read every 5 minutes.${liveError ? " The last read failed, so this is what was read before; each thing in it goes when it ends." : ""}`}>{liveError ? `World from ${checkedWhen(liveAt, now)}` : `World read ${new Date(liveAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`}</p>{/if}</div>
      <IconButton icon="settings" tone="quiet" label="Customise Home" title="Choose what Home shows" aria-expanded={customising} onclick={() => (customising = !customising)} />
    </div>
  </header>

  {#if customising}
    <section class="custom" aria-label="What Home shows">
      <span class="register">Show on Home</span>
      <div class="cards">
        {#each cards as c (c.key)}<Chip on={!hidden.has(c.key)} label={c.label} title={`${c.hint}. Click to ${hidden.has(c.key) ? "show" : "hide"} it.`} onchange={(on: boolean) => toggleCard(c.key, on)} />{/each}
      </div>
      {#if cards.some((c) => hidden.has(c.key))}<button class="link" onclick={() => (settings.homeHidden = [])}>Show everything</button>{/if}
    </section>
  {/if}

  {#if alerts.length}
    <section class="alerts" data-card="alerts" aria-label="Needs you" class:off={off("alerts")}>
      {#each alerts as a (a.text)}
        <div class="alert t-{a.tone}"><GameIcon name={a.icon} size={20} /><span>{a.text}</span>{#if a.to}<button class="link" onclick={() => go(a.to)}>{a.act} →</button>{/if}{#if a.key}<IconButton icon="close" tone="quiet" size={12} label="Dismiss" title="Dismiss: it doesn't come back for this alert" onclick={() => dismiss(a.key!)} />{/if}</div>
      {/each}
    </section>
  {/if}

  <div class="grid">
    <!-- World clocks -->
    {#if cycles.length || resets.length}
      <section class="panel world" class:off={off("world")} aria-label="World clocks">
        <!-- Still asking for the world: the five clocks' places, so nothing jumps when they arrive. -->
        {#if liveWaiting && !cycles.length}
          {#each ["earth", "cetus", "vallis", "cambion", "zariman", "duviri"] as k (k)}
            <div class="clock wait" aria-hidden="true"><GameIcon name={CYCLE_ICON[k]} size={26} /><div><span class="register clip1">{CYCLE_SHORT[k] ?? { earth: "Earth", vallis: "Orb Vallis", zariman: "Zariman", duviri: "Duviri" }[k]}</span><b class="mark st">—</b><span class="dim small nowrap">&nbsp;</span></div></div>
          {/each}
        {/if}
        {#each cycles as c (c.key)}
          <div class="clock" title="{c.key === 'duviri' ? `Duviri's mood: ${c.state}, which sets the Spiral's look and what its missions and enemies are like` : `${c.label}: ${c.state}`}{c.next ? `, ${c.next} in ${until(c.ends, now)}` : ''}">
            <GameIcon name={CYCLE_ICON[c.key]} size={26} />
            <div><span class="register clip1">{CYCLE_SHORT[c.key] ?? c.label}</span><b class="mark st st-{c.state}">{c.state}</b><span class="dim small nowrap">{until(c.ends, now).replace("under a minute", "<1 min")}<span class="lft">{" left"}</span></span></div>
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
    <section class="panel market" data-card="market" class:off={off("market")} class:full={alone("market")} style:grid-row={rowSpan("market")}>
      {@render head("market", null, "Market", "market", "Orders")}
      {#if mkt.linked}
        <div class="presence"><Presence settings={settings.market} quiet /></div>
        <div class="figs">
          <div title="Your visible listings on warframe.market: price × quantity, and how many{hiddenCount ? ` (${hiddenCount} hidden ones not counted)` : ''}"><P v={listed} /><span class="register">Listed · {orders.length - hiddenCount}</span></div>
          {#if !console}<div title="Listings for more than you hold now: sold, or used in game. Fix them on Orders, or a buyer finds you can't deliver"><b class="mark" class:warn={shortListings.length}>{shortListings.length}</b><span class="register">Can't deliver</span></div>{/if}
          <div title="Platinum from what you sold today, from Sales"><P v={sold(dayStart)} /><span class="register">Sold today</span></div>
          <div title="Platinum from what you sold in the last 7 days"><P v={sold(now - 7 * DAY)} /><span class="register">Last 7 days</span></div>
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
    <section class="panel ready" class:off={off("ready")} class:half={orphan("ready")} class:lone={lone("ready")} style:--n={share("ready")} data-card="ready">
      {@render head("platinum", null, "Ready to sell", "market#spares", "Put my spares on sale")}
      {#if !ticked}
        <p class="dim">Nothing ticked in <b>Put my spares on sale</b> on Orders.</p>
      {:else if !byKind.length}
        <p class="dim">Nothing spare worth {settings.market.minPrice}p or more in what you ticked.</p>
      {:else}
        <div class="big"><P v={byKind.reduce((n, k) => n + k.plat, 0)} big /><span class="dim small" title="Only the kinds ticked under Put my spares on sale, on Orders, and only what's worth at least your minimum price there">at daily median prices: what Put my spares on sale covers, {settings.market.minPrice}p and up{unlisted ? ` · ${unlisted} not listed yet` : ""}</span></div>
        <ul class="kinds">
          {#each byKind as k (k.kind)}
            <li>
              {#if KIND_ICON[k.kind].game}<GameIcon name={KIND_ICON[k.kind].game!} size={20} />{:else}<Icon name={KIND_ICON[k.kind].line!} size={18} />{/if}
              <span>{KIND_LABEL[k.kind]}s</span><span class="dim">{k.count}</span><P v={k.plat} />
            </li>
          {/each}
        </ul>
        {#if !console && !settings.market.bulk.parts}<p class="dim small note">Spare prime parts aren't ticked: <button class="link" onclick={() => go("parts?best=Sell")}>Prime parts</button> has them.</p>{/if}
      {/if}
    </section>

    <!-- Fissures -->
    <section class="panel fissures" data-card="fissures" class:off={off("fissures")}>
      {@render head("void-tear", null, "Fissures now", console ? null : "relics", "Relics")}
      {#if live.fissures == null}
        <p class="dim" class:waiting={liveWaiting}>{liveNote}</p>
      {:else}
        {#if liveError && liveAt != null}<p class="dim small fromgame">The worldstate can't be read right now: these are from the last read ({checkedWhen(liveAt, now)}), each gone once it ends. orbiter asks again every few minutes.</p>
        {:else if live.fromGame}<p class="dim small fromgame">Read from the game's own worldstate: api.warframestat.us isn't answering, so Nightwave and the Circuit may be out of date, and alerts, invasions and Darvo's deal can't be read.</p>{/if}
        <FissureBoard fissures={live.fissures} bind:mode={settings.homeFissures} {now} best={eraBest} watched={new Set(watched.map((w) => w.fissure.id))} onera={console ? null : (era) => go(`relics?era=${era}`)} />
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

    <!-- Bounties -->
    <section class="panel bounties" data-card="bounties" class:off={off("bounties")}>
      {@render head("ostron", null, "Bounties", null, "")}
      {#if live.syndicates == null && !bountyTables}
        <p class="dim">{liveNote}</p>
      {:else}
        <BountyBoard {boards} {now} imageOf={(n) => model.imageOf(n)} {need} opens={rewardOpens} />
      {/if}
    </section>

    <!-- Events -->
    {#if events.length}
      <section class="panel events" data-card="events" class:off={off("events")}>
        {@render head(null, "star", "Events", null, "")}
        <ul class="ev">
          {#each events as e (e.id)}
            <li>
              <div class="eh"><b class="mark">{e.name}</b><span class="dim small">{e.where ? `${e.where} · ` : ""}ends in {until(e.ends, now)}</span></div>
              {#if e.note}<p class="dim small">{e.note}</p>{/if}
              {#if e.progress}<div class="eprog" title="{e.progress.at.toLocaleString('en')} of {e.progress.of.toLocaleString('en')} toward its goal"><i style:width="{(e.progress.at / e.progress.of) * 100}%"></i></div>{/if}
              {#if e.rewards.length}<p class="small erw"><span class="dim">Pays</span>{" "}{#each e.rewards as r, i (r)}{i ? " · " : ""}<span use:info={r.replace(/^[\d,]+ × /, "")}>{r}</span>{/each}</p>{/if}
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <!-- Worth doing today -->
    <section class="panel today" data-card="today" class:off={off("today")} class:full={alone("today")} style:grid-row={rowSpan("today")}>
      {@render head("nightwave", null, "Worth doing today", null, "")}
      <div class="tgrid">
        {#if day.circuit}
          <div class="tblock">
            <div class="th"><GameIcon name="mastery" size={18} /><b class="mark">Duviri Circuit</b><span class="dim small">{console ? "" : "◆ not mastered · "}new picks in {until(day.circuit.resets, now)}</span></div>
            <div class="chips">
              {#each day.circuit.frames as c (c.name)}<span class="pick" class:want={c.wanted && !console} use:info={c.name}><Thumb file={c.image} size={22} />{c.name}{#if c.wanted && !console}<em aria-label="worth taking">◆</em>{/if}</span>{/each}
            </div>
            <div class="th sub"><span class="register">Steel Path: Incarnon</span>{#if !console}<span class="dim small">◆ a weapon you have, with no adapter yet</span>{/if}</div>
            <div class="chips">
              {#each day.circuit.incarnons as c (c.name)}<span class="pick" class:want={c.wanted && !console} use:info={c.name}><Thumb file={c.image} size={22} />{c.name}{#if c.wanted && !console}<em aria-label="worth taking">◆</em>{/if}</span>{/each}
            </div>
          </div>
        {/if}
        {#if day.darvo}
          {@const dv = day.darvo}
          <div class="tblock">
            <div class="th"><GameIcon name="platinum" size={18} /><b class="mark">Darvo's deal</b><span class="dim small">{dv.left != null ? `${dv.left} left · ` : ""}ends in {until(dv.ends, now)}</span></div>
            <p class="tline" title="Darvo's daily deal in the in-game Market (Market → Darvo's Deal), limited stock">
              <b use:info={dv.item}>{dv.item}</b> <span class="dim">for {dv.price}p ({dv.discount}% off {dv.was}p)</span>
              {#if dv.note && !console}<span class="dim small">{" · "}{dv.note}</span>{#if dv.wanted}<em class="want" aria-label="worth taking">◆</em>{/if}{/if}
            </p>
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
              <div class="th"><GameIcon name="sortie" size={18} /><b class="mark">Sortie</b><span class="dim small">{day.sortie.boss}{day.sortie.faction ? ` (${day.sortie.faction})` : ""} · {until(day.sortie.ends, now)} left</span></div>
              <ol class="stages">
                {#each day.sortie.stages as st, i (i)}
                  <li title={st.desc || undefined}><span class="sn">{i + 1}</span><span class="nt"><span>{st.mission}<span class="dim">{" · "}{st.node}</span></span>{#if st.modifier}<span class="mod">{st.modifier}</span>{/if}</span></li>
                {/each}
              </ol>
              {#if sortieRewards?.length}
                <p class="tline dim small"><button class="link" aria-expanded={sortieOpen} title="What the Sortie pays when you finish all three missions: one reward from this table (the official drop tables)" onclick={() => (sortieOpen = !sortieOpen)}>{sortieOpen ? "Hide rewards" : "Reward chances"}</button>{#if !sortieOpen}{" · "}{sortieRewards.slice(0, 3).map((r) => `${r.name} ${r.chance}%`).join(" · ")}…{/if}</p>
                {#if sortieOpen}
                  <ul class="srl">{#each sortieRewards as r (r.name)}<li><span class="nt" use:info={r.name}>{r.name}</span><span class="dim small">{r.chance}%</span></li>{/each}</ul>
                {/if}
              {/if}
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
        {#if !day.circuit && !day.steelPath && !day.nightwave && !day.sortie && !day.darvo}<p class="dim">{liveNote}</p>{/if}
      </div>
    </section>

    <!-- Foundry -->
    <section class="panel foundry" class:off={off("foundry")} class:half={orphan("foundry")} class:lone={lone("foundry")} style:--n={share("foundry")} data-card="foundry">
      {@render head("foundry", null, "Foundry", null, "")}
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
        <div class="register sub">Every part in hand</div>
        <ul class="fb">
          {#each buildable.slice(0, 4) as r (r.unique)}
            <li><button class="row" data-opens aria-label="{r.name}: details" onclick={() => details.open(r.unique)}><Thumb file={model.imageOf(r.name)} name={r.name} size={26} /><span class="fn"><b class="mark">{r.name}</b><span class="small" class:dim={r.buildTier !== "now"} class:good={r.buildTier === "now"} title={r.buildShort ? `Still to get before building: ${r.buildShort}` : undefined}>{r.buildTier === "now" ? "Build now: everything in hand" : r.buildTier === "hard" ? `Needs ${r.buildShort}` : r.buildTier === "farm" ? `Farm ${r.buildShort}` : "every part in hand"}</span></span><span class="pts"><GameIcon name="mastery" size={13} />{r.points.toLocaleString("en")}</span></button></li>
          {/each}
        </ul>
      {/if}
    </section>

    <!-- Wishlist -->
    <section class="panel wishes" class:off={off("wishes")} class:half={orphan("wishes")} class:lone={lone("wishes")} style:--n={share("wishes")} data-card="wishes">
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
    <section class="panel deals" class:off={off("deals")} class:half={orphan("deals")} class:lone={lone("deals")} style:--n={share("deals")} data-card="deals">
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

    <section class="panel mastery" data-card="mastery" class:off={off("mastery")} class:full={alone("mastery")} style:grid-row={rowSpan("mastery")}>
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
    <section class="panel baro" class:off={off("baro")} class:half={orphan("baro")} class:lone={lone("baro")} style:--n={share("baro")} data-card="baro">
      {@render head("baro", null, "Baro Ki’Teer", console ? null : "parts?best=Ducats", "Spares for ducats")}
      {#if !baro}
        <p class="dim">{liveWaiting || liveError ? liveNote : "Baro's schedule isn't in the worldstate right now."}</p>
      {:else}
        <div class="when">
          {#if baroHere}<b class="mark gold">Here now</b><span class="dim">{baro.location} · leaves in {until(baro.expiry, now)}</span>
          {:else}<b class="mark">In {until(baro.activation, now)}</b><span class="dim">{baro.location} · {new Date(baro.activation).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>{/if}
        </div>
        {#if !console}<div class="ducats"><P v={heldDucats} d /><span class="dim small">ducats held</span>{#if spareDucats}<span class="dim">·</span><P v={spareDucats} d dim /><span class="dim small">more from spare parts</span>{/if}</div>{/if}
        {#if baroHere}
          <ul class="stock">
            {#each console ? stock : baroNeed as s (s.unique)}
              <li>
                <Thumb file={s.image} size={24} name={s.name} />
                <span class="sn" use:info={s.name}>{s.name}</span>
                <span class="mk">{#if console}{:else if s.mark === "mastery"}<span class="tag gold" title="You haven't mastered it">+{s.points?.toLocaleString("en")} mastery</span>{:else if s.mark === "new"}<span class="tag gold">new to you</span>{:else if s.mark === "have"}<span class="tag">you have it</span>{/if}</span>
                <P v={s.ducats} d dim={s.mark === "have"} />
              </li>
            {/each}
          </ul>
          {#if !console && !baroNeed.length}<p class="dim small">Nothing in his stock you don't already have.</p>{/if}
          {#if !console && stock.length > baroNeed.length}<p class="dim small">+{stock.length - baroNeed.length} more you have or that give no mastery (cosmetics and the like).</p>{/if}
        {/if}
      {/if}
    </section>

    <!-- Varzia -->
    <section class="panel varzia" class:off={off("varzia")} class:half={orphan("varzia")} class:lone={lone("varzia")} style:--n={share("varzia")} data-card="varzia" class:slim={!!live.resurgence && !varzia.length && !console}>
      {@render head("varzia", null, "Varzia: Prime Resurgence", console ? null : "relics?vault=resurgence", "Her relics")}
      {#if !live.resurgence}
        <p class="dim">{liveWaiting || liveError ? liveNote : "Varzia's rotation isn't in the worldstate right now."}</p>
      {:else if console}
        <div class="when"><b class="mark">{varziaWhole.length} for Regal Aya</b><span class="dim">{varziaRelics ? `and ${varziaRelics} relics for Aya · ` : ""}rotation ends in {until(live.resurgenceExpiry, now)}</span></div>
        <ul class="vz">
          {#each varziaWhole.slice(0, 8) as v (v.uniqueName)}
            <li>
              <Thumb file={model.imageOf(v.item)} size={26} name={v.item} />
              <span class="sn"><b class="mark" use:info={v.item}>{v.item.replace(/^M P V /, "")}</b><span class="dim small">{v.ducats} Regal Aya</span></span>
              <GameIcon name="aya" size={16} />
            </li>
          {/each}
        </ul>
        {#if varziaWhole.length > 8}<p class="dim small">and {varziaWhole.length - 8} more</p>{/if}
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
  /* The same header as every other page (PageHead), so the title doesn't move switching pages. */
  .hello { display: flex; justify-content: space-between; align-items: flex-end; padding: clamp(28px, 5vh, 56px) 0 var(--step); gap: 1rem; }
  .hello h1 { font-size: clamp(2.6rem, 5.4vw, 4.6rem); }
  @media (max-height: 860px) {
    .hello { padding: 18px 0 .6rem; }
    .hello h1 { font-size: clamp(2.2rem, 4vw, 3.2rem); }
    .hello .orn { margin-bottom: .5rem; }
  }
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
  .off { display: none !important; }
  .panel.full { grid-column: span 12; }
  .panel.half { grid-column: span var(--n, 6); }
  .clock.wait { opacity: .45; }
  /* About the height of the table it's waiting for, so the cards below don't jump. */
  .fissures .waiting { min-height: 15rem; margin: 0; }
  /* The only small card left beside a tall one: as tall as what's in it, not stretched to the row. */
  .panel.lone { align-self: start; }
  .hr { display: flex; align-items: center; gap: .8rem; }
  .custom { display: flex; align-items: center; flex-wrap: wrap; gap: .6rem 1rem; padding: .8rem 1rem; margin-bottom: var(--step); border: 1px solid var(--rule); background: var(--plate); }
  .custom .cards { display: flex; flex-wrap: wrap; gap: .4rem; flex: 1; }
  .panel { border: 1px solid var(--rule); background: rgb(17 19 23 / 72%); padding: 1rem 1.2rem 1.1rem; min-width: 0; display: flex; flex-direction: column; gap: .8rem; }
  .market { grid-column: span 7; }
  .ready { grid-column: span 5; }
  .fissures { grid-column: span 12; }
  .bounties { grid-column: span 12; }
  .events { grid-column: span 12; }
  .ev { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr)); gap: .9rem 1.6rem; }
  .ev li { display: grid; gap: .3rem; min-width: 0; }
  .eh { display: flex; flex-wrap: wrap; align-items: baseline; gap: .2rem .6rem; }
  .ev p { margin: 0; }
  .erw { color: var(--platinum); }
  .eprog { height: 4px; background: var(--rule); }
  .eprog i { display: block; height: 100%; background: var(--gold); }
  .stages { list-style: none; margin: .1rem 0 .2rem; padding: 0; display: grid; gap: .3rem; font-size: .85rem; }
  .stages li { display: flex; gap: .55rem; align-items: baseline; }
  .stages .sn { color: var(--gold); font-size: .75rem; }
  .stages .nt { display: grid; }
  .stages .mod { font-size: .75rem; color: var(--platinum-dim); }
  .srl { list-style: none; margin: 0 0 .2rem; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr)); gap: .15rem 1rem; font-size: .8rem; }
  .srl li { display: flex; justify-content: space-between; gap: .5rem; }
  .dt { display: grid; justify-items: end; gap: .1rem; }
  .dt p { margin: 0; }
  .upd { font-size: .72rem; }
  .upd.old { color: var(--gold); }
  .st-joy { color: var(--gold); }
  .st-anger { color: #e07a6a; }
  .st-envy { color: #7fc79a; }
  .st-sorrow { color: #8fb3e0; }
  .st-fear { color: #b49ae0; }
  .fromgame { margin: 0; }
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
  /* Eight clocks to a row: the resets' ↻ makes room for their names. */
  .world:has(> .clock:nth-child(8)) .clock.reset > .rk { display: none; }
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
  .good { color: var(--verdigris); }
  .more { margin: .5rem 0 0; }
  .foundry { grid-column: span 5; }
  .deals { grid-column: span 5; }
  .live { margin: .6rem 0 0; color: var(--platinum-deep); display: flex; align-items: center; gap: .45rem; }
  .live:empty { display: none; }
  .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--verdigris); box-shadow: 0 0 0 3px color-mix(in srgb, var(--verdigris) 25%, transparent); }
  .varzia { grid-column: span 5; }
  /* Narrower: the clocks keep their icons and drop their names to stay on one row. */
  /* Page area under 1100 px (App sets the flag, by the room pages actually have). */
  :global(html[data-room~="lt1100"]) .clock { padding: .7rem .75rem; }
  /* The open worlds' icons say where; their names go (in the tooltip), the resets lose their ↻. */
  :global(html[data-room~="lt1100"]) .clock:not(.reset) .register { display: none; }
  :global(html[data-room~="lt1100"]) .clock.reset > .rk { display: none; }
  :global(html[data-room~="lt1100"]) .clock .lft { display: none; }
  /* Page area under 930 px (App sets the flag, by the room pages actually have). */
  :global(html[data-room~="lt930"]) .world { grid-template-columns: repeat(auto-fit, minmax(6.3rem, 1fr)); }
  :global(html[data-room~="lt930"]) .clock { padding: .6rem .55rem; }
  /* Page area under 900 px (App sets the flag, by the room pages actually have). */
  :global(html[data-room~="lt900"]) .market, :global(html[data-room~="lt900"]) .ready, :global(html[data-room~="lt900"]) .fissures, :global(html[data-room~="lt900"]) .mastery, :global(html[data-room~="lt900"]) .baro, :global(html[data-room~="lt900"]) .varzia, :global(html[data-room~="lt900"]) .today, :global(html[data-room~="lt900"]) .foundry, :global(html[data-room~="lt900"]) .deals, :global(html[data-room~="lt900"]) .wishes , :global(html[data-room~="lt900"]) .panel.half { grid-column: span 12; }
  /* Half a small screen: the clocks go four to a row. */
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
  .pick em, em.want { font-style: normal; font-size: .6rem; color: var(--gold); margin-left: .25rem; }
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
  .figs > div { display: grid; grid-template-rows: 1.75rem auto; gap: .3rem; align-content: start; align-items: center; }
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

  .right { text-align: right; }
  .era { display: inline-flex; align-items: center; gap: .5rem; }
  .era b { font-size: 1.05rem; }
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
  .good { color: var(--verdigris); }
  .ducats { display: flex; align-items: center; gap: .5rem; }
  .stock, .vz { list-style: none; margin: 0; padding: 0; display: grid; gap: .4rem; }
  .stock li { display: grid; grid-template-columns: 24px minmax(0, 1fr) auto 4rem; gap: .6rem; align-items: center; }
  .stock li :global(.amt) { justify-self: end; }
  .sn { min-width: 0; display: grid; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sn > * { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sn .small { overflow: hidden; text-overflow: ellipsis; }
  /* Baro's names are bare text: a block, so they end in an ellipsis rather than being cut. */
  .stock .sn { display: block; }
  .vz { grid-template-columns: repeat(auto-fill, minmax(min(26rem, 100%), 1fr)); column-gap: 1.6rem; }
  /* Which relics, and for how many parts: worth a second line rather than an ellipsis. */
  .vz .sn .small { white-space: normal; }
  .vz li { display: grid; grid-template-columns: 26px minmax(0, 1fr) auto 16px; gap: .6rem; align-items: center; }
  .tag.gold { color: var(--gold); border-color: var(--gold-dim); }
</style>
