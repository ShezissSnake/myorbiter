<script lang="ts">
  /** A faction's colour (app.css), for an invasion's two sides. */
  const faction = (f: string) => { const k = f.toLowerCase(); return k.startsWith("grineer") ? "var(--faction-grineer)" : k.startsWith("corpus") ? "var(--faction-corpus)" : k.startsWith("infest") ? "var(--faction-infested)" : "var(--platinum-deep)"; };
  import { info } from "../hover.svelte";
  // Today at a glance: anything that needs you, your market, live fissures and your best relic for
  // each, what's ready to sell, what's worth doing today, your Foundry, cheap buys, the easiest
  // mastery, and Baro and Varzia against your collection.
  import type { Model } from "../core/model";
  import type { Live, MissionState } from "../core/types";
  import type { Settings } from "../backend";
  import { defaultAdvice } from "../backend";
  import { heldFor, overListed, type MyOrder } from "../core/market";
  import { mkt } from "../marketStore.svelte";
  import { masteryRows, relicRows, type RelicRow } from "../core/views";
  import { catOfItem, catOfTarget, minimumForItem, resolve, sellTargets, KIND_LABEL, BULK_KINDS, type BulkKind } from "../core/bulk";
  import { minimumFor, minimumsText, SPARE_CATEGORIES, type SpareCategory } from "../core/sparesRules";
  import { sellableCopies, UNKNOWN_TRADES_PER_DAY } from "../core/spares";
  import { worthSelling, type WorthKind } from "../core/worthSelling";
  import { expectedBest, worthATrade } from "../core/advice";
  import { baroFlips, baroStock, shortCredits, varziaNeeds, until } from "../core/traders";
  import { invasionNeeds, invasionRares } from "../core/invasions";
  import { alertNeeds, describeHelp } from "../core/worldNeeds";
  import GameIcon, { eraIcon, factionIcon, shardIcon, type GameIconName } from "../ui/GameIcon.svelte";
  import Foe from "../ui/Foe.svelte";
  import Mission from "../ui/Mission.svelte";
  import { tradeAllowance } from "../core/tradeLimit";
  import Icon from "../ui/Icon.svelte";
  import { isDone, setDone } from "../core/chores";
  import { nextMondayUtc } from "../core/today";
  import IconButton from "../ui/IconButton.svelte";
  import PageHead from "../ui/PageHead.svelte";
  import HelpMark from "../ui/HelpMark.svelte";
  import Chip from "../ui/Chip.svelte";
  import Effort from "../ui/Effort.svelte";
  import Thumb from "../ui/Thumb.svelte";
  import CopyButton from "../ui/CopyButton.svelte";
  import UndoSlot from "../ui/UndoSlot.svelte";
  import { UndoSlots } from "../undo.svelte";
  import P from "../ui/P.svelte";
  import Presence from "../ui/Presence.svelte";
  import { partRows, saveForSets, setSaves } from "../core/views";
  import { drops } from "../drops.svelte";
  import { decide } from "../core/advice";
  import { today } from "../core/today";
  import { foundryBuilds } from "../core/foundry";
  import { crackableFirst, crackableNow, openEras, wishItem, type WishItem } from "../core/wishlist";
  import { eventViews } from "../core/events";
  import type { RelicReward } from "../core/types";
  import { checkedWhen, cycleTimers, resetTimers, matchedFissures, planetOf, ruleLabel, sameRule, TIERS, KIND_LABEL as FISSURE_KIND, tidyRule, type FissureRule } from "../core/timers";
  import PickMany from "../ui/PickMany.svelte";
  import { details } from "../details.svelte";
  import { DEAL_MIN_REF, DEAL_SHARE } from "../core/deals";
  import { bountyBoards, missionTypes, type BountyTable } from "../core/board";
  import { scoreCards } from "../core/pick";
  import { homeCardsChosen } from "../core/homeCards";
  import FissureBoard from "../ui/FissureBoard.svelte";
  import BountyBoard from "../ui/BountyBoard.svelte";
  import { describe } from "../core/describe";
  import { tick as nextTick } from "svelte";
  import { arrive, calm, flip, fresh, leave, opens, OUT_CSS, QUICK, reveal as unfold } from "../motion";
  import Tick from "../ui/Tick.svelte";
  import { whileShown, whileShownEvery } from "../pane.svelte";
  import Segments from "../ui/Segments.svelte";

  // console: you play on a console or phone, so there's no inventory: Home is the market, the
  // world's clocks, fissures, what's worth doing and Baro, without anything measured against a collection.
  let { model, live, mission, settings = $bindable(), go, shortListings, liveAt = null, liveError = null, liveRead = true, console = false, reveal = null, bountyTables = null, sortieRewards = null }: { model: Model; live: Live; mission: MissionState | null; settings: Settings; go: (t: string) => void; shortListings: MyOrder[]; liveAt?: number | null; liveError?: string | null; liveRead?: boolean; console?: boolean; reveal?: string | null; bountyTables?: BountyTable[] | null; sortieRewards?: RelicReward[] | null } = $props();
  let sortieOpen = $state(false);
  // The worldstate: still being asked for the first time, or unreachable (api.warframestat.us).
  const liveWaiting = $derived(liveAt == null && !liveError);
  const liveNote = $derived(liveWaiting ? "Asking api.warframestat.us…" : "api.warframestat.us didn't answer; MyOrbiter asks again every few minutes.");

  // Countdowns tick once a minute.
  let now = $state(Date.now());
  $effect(() => whileShownEvery("home", 30_000, () => (now = Date.now()), () => now));

  // ------------------------------------------------------------ market
  // The heavy figures below are worked out while Home is on screen, and kept while it's hidden (lib/pane.svelte.ts).
  const orders = $derived(mkt.orders.filter((o) => o.type === "sell"));
  const listed = $derived(orders.filter((o) => o.visible).reduce((n, o) => n + o.platinum * o.quantity, 0));
  const hiddenCount = $derived(orders.filter((o) => !o.visible).length);
  /** Hidden listings for more than you hold: nobody can buy them, so they're beside the count, not in it. */
  const hiddenShort = $derived(console ? 0 : overListed(orders, (o) => { const it = mkt.item(o.itemId); return it ? heldFor(model, it, o) : null; }).hidden.length);
  const DAY = 86_400_000;
  // The daily trade limit (core/tradeLimit.ts): trades today against your rank's worth.
  const trades = $derived(tradeAllowance(settings.market.trades, settings.game.masteryRank, now));
  const dayStart = $derived.by(() => {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return +d;
  });
  const sold = (from: number) => settings.market.sales.filter((s) => s.at >= from).reduce((n, s) => n + s.quantity * s.platinum, 0);

  // ------------------------------------------------------------ ready to list
  // Prime parts, mods and arcanes: Worth selling, the items their pages count (core/worthSelling.ts),
  // so each line here and what's under your minimum add up to the page's figure.
  const WORTH_KINDS: BulkKind[] = ["part", "mod", "arcane"];
  const worth = $derived.by(whileShown("home", () => worthSelling(model, settings.advice, settings.market.sellable, drops.recent)));
  // Sets, imprints and everything else: what Sell spares would list, not what's held back for ducats
  // or never sold. Prime parts, mods and arcanes come from Worth selling above instead.
  const spares = $derived(settings.market.spares);
  const homeRules = $derived({ ...spares, prime: { ...spares.prime, on: spares.prime.on && spares.prime.sellAs !== "parts", sellAs: "sets" as const }, mods: { ...spares.mods, on: false }, arcanes: { ...spares.arcanes, on: false } });
  const targets = $derived.by(whileShown("home", () => sellTargets(model, homeRules, settings.advice, mkt.index, settings.market.sellable, drops.recent).filter((t) => !t.hold)));
  /** Whether Sell spares lists Worth selling's kind: loose prime parts, mods, arcanes. */
  const listsKind = (k: WorthKind) => (k === "part" ? spares.prime.on && spares.prime.sellAs !== "sets" : k === "mod" ? spares.mods.on : spares.arcanes.on);
  const valueOf = (kind: BulkKind, name: string) => (kind === "arcane" ? (model.priceMax(name) ?? model.price(name)) : model.price(name));
  /** Trades a day, for the month's cap: relics, whose sales warframe.market never reports, about one. */
  const paceOf = (name: string) => (/ Relic$/.test(name) ? UNKNOWN_TRADES_PER_DAY : model.tradesPerDay(name));
  // One shape for both: what it is, how many to list, each, and the platinum no more than a month of
  // sales comes to (as Worth selling and Inventory's Spare value count it). Worth a trade: "Not worth a
  // trade under Np" (Prime parts), judged on one trade of up to six copies.
  const candidates = $derived([
    // Arcanes: Sell spares lists extra maxed copies, and unranked ones only with Every spare copy
    // (counted on Arcanes' Worth selling either way).
    ...worth.filter((x) => listsKind(x.kind as WorthKind) && !(x.kind === "arcane" && x.rank === 0 && spares.arcanes.which !== "any")).map((x) => ({ kind: x.kind as BulkKind, min: minimumFor(settings.market, WORTH_CAT[x.kind as WorthKind]), own: settings.market.minByCategory?.[WORTH_CAT[x.kind as WorthKind]] != null, name: x.name, quantity: x.copies, each: x.each as number | null, plat: x.plat })),
    ...targets
      .map((t) => ({ ...t, each: t.each !== undefined ? t.each : valueOf(t.kind, t.name) }))
      .filter((t) => t.each != null && worthATrade(t.each, t.quantity, settings.advice.minPlat))
      .map((t) => ({ kind: t.kind, ...minOfTarget(t), name: t.name, quantity: t.quantity, each: t.each, plat: (t.each ?? 0) * sellableCopies(t.quantity, paceOf(t.name)) })),
  ]);
  // At least your minimum price each, as Sell spares lists them.
  const worthy = $derived(candidates.filter((t) => t.each != null && t.each >= t.min));
  /** What your minimum leaves out, so the lines here add up to the selling pages' Worth selling. */
  const under = $derived(candidates.filter((t) => t.each != null && t.each < t.min));
  const underMin = $derived(Math.round(under.reduce((n, t) => n + t.plat, 0)));
  /** "Mods 9,476p · Prime parts 893p": what the minimum leaves out of each kind. */
  const underSplit = $derived(BULK_KINDS.map((k) => [k, Math.round(under.filter((t) => t.kind === k).reduce((n, t) => n + t.plat, 0))] as const).filter(([, v]) => v >= 1).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${KIND_LABEL[k]}s ${v.toLocaleString("en")}p`).join(" · "));
  /** Worth selling's kinds by their row on Sell spares, whose minimums they're held to. */
  const WORTH_CAT: Record<WorthKind, SpareCategory> = { part: "prime", mod: "mods", arcane: "arcanes" };
  /** A target's minimum, by its item's own category as the plan judges it (its row's, before the market's list is read); `own`: its category has one of its own. */
  function minOfTarget(t: Parameters<typeof catOfTarget>[0] & Parameters<typeof resolve>[1]): { min: number; own: boolean } {
    const it = mkt.index ? resolve(mkt.index, t) : null;
    const cat = it ? catOfItem(model, it) : catOfTarget(t);
    return { min: it ? minimumForItem(settings.market, model, it) : minimumFor(settings.market, cat), own: !!cat && settings.market.minByCategory?.[cat] != null };
  }
  const byKind = $derived(
    BULK_KINDS
      .map((k) => {
        const xs = worthy.filter((t) => t.kind === k);
        return { kind: k, count: xs.reduce((n, t) => n + t.quantity, 0), plat: Math.round(xs.reduce((n, t) => n + t.plat, 0)) };
      })
      .filter((k) => k.count > 0),
  );
  const KIND_ICON: Record<BulkKind, { game?: GameIconName; line?: string }> = { set: { line: "sets" }, arcane: { game: "vosfor" }, mod: { game: "endo" }, part: { game: "ducats" }, imprint: { game: "companions" }, other: { game: "market" } };
  const ticked = $derived(SPARE_CATEGORIES.filter((c) => spares[c].on).length);
  // Listed already: what's left to put up.
  const listedNames = $derived(new Set(orders.map((o) => mkt.item(o.itemId)?.name)));
  const unlisted = $derived(worthy.filter((t) => !listedNames.has(t.name)).length);

  // ------------------------------------------------------------ fissures
  const ERAS = ["Lith", "Meso", "Neo", "Axi", "Requiem", "Omnia"] as const;
  const squad = $derived.by(whileShown("home", () => settings.advice.squad > 1 ? 4 : 1));
  const relics = $derived.by(whileShown("home", () => relicRows(model, { platPerDucat: settings.advice.platPerDucat })));
  const crackValue = (r: RelicRow) => {
    const radiant = (r.owned.Radiant ?? 0) > 0;
    const v = radiant ? (squad === 1 ? r.evRadiant : r.outRadiant.length ? expectedBest(r.outRadiant, squad) : null) : squad === 1 ? r.evIntact : r.outIntact.length ? expectedBest(r.outIntact, squad) : null;
    return { v: v == null ? null : Math.round(v * 10) / 10, refinement: radiant ? "Radiant" : "Intact" };
  };
  /** Your relics worth cracking in this era's fissures, best first (the top three). */
  const bestFor = (era: string) => {
    const out: { r: RelicRow; v: number; refinement: string }[] = [];
    for (const r of relics) {
      // Omnia fissures take Lith to Axi relics, not Requiem ones.
      if (era === "Omnia" ? r.era === "Requiem" : r.era !== era) continue;
      const c = crackValue(r);
      if (c.v != null) out.push({ r, v: c.v, refinement: c.refinement });
    }
    return out.sort((a, b) => b.v - a.v).slice(0, 3);
  };
  // Your best relic for each era, worked out once per era rather than per fissure.
  // Sets your loose parts wait for (Sell spares), by the era of the relics of yours that drop a missing part.
  const savingByEra = $derived.by(whileShown("home", () => {
    const out = new Map<string, { sets: string[]; relics: string[] }>();
    const opts = saveForSets(settings.market.sellable, settings.advice.platPerDucat, drops.recent);
    if (!opts) return out;
    for (const s of setSaves(model, opts).values()) {
      for (const x of s.missing) {
        for (const src of model.sourcesByReward.get(x.name) ?? []) {
          if (!(model.ownedRelicCount.get(src.base) ?? 0)) continue;
          // Omnia fissures take a relic of any era but Requiem.
          const era = src.base.split(" ")[0];
          for (const key of era === "Requiem" ? [era] : [era, "Omnia"]) {
            const e = out.get(key) ?? { sets: [], relics: [] };
            if (!e.sets.includes(s.set)) e.sets.push(s.set);
            if (!e.relics.includes(src.base)) e.relics.push(src.base);
            out.set(key, e);
          }
        }
      }
    }
    return out;
  }));
  const bests = $derived.by(whileShown("home", () => new Map<string, ReturnType<typeof bestFor>>(ERAS.map((era) => [era, bestFor(era)]))));
  const eraBest = (era: string) => {
    const top = console ? [] : (bests.get(era) ?? []);
    const one = (b: (typeof top)[number]) => ({ name: b.r.base, refinement: b.refinement, held: `${b.r.owned[b.refinement] ?? 0} of ${b.r.total} held`, plat: b.v, radiant: b.r.owned.Radiant ?? 0 });
    return top.length ? { ...one(top[0]), more: top.slice(1).map(one) } : null;
  };

  // ------------------------------------------------------------ bounties
  /** A reward you'd want: a part for something you haven't mastered or built. */
  const need = (name: string) => !console && (scoreCards(model, [name])[0]?.needed ?? false);
  const boards = $derived.by(whileShown("home", () => bountyBoards(live.syndicates ?? null, bountyTables, need)));
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
  const stock = $derived.by(whileShown("home", () => baroHere ? baroStock(model) : []));
  const baroNeed = $derived(stock.filter((s) => s.mark === "mastery" || s.mark === "new"));
  /** His stock that sells on warframe.market, best platinum per ducat first. */
  const flips = $derived.by(whileShown("home", () => baroHere && !console ? baroFlips(model, stock) : []));
  const heldDucats = $derived((model.inventoryByBase.get("/Lotus/Types/Items/MiscItems/PrimeBucks") ?? []).reduce((n, r) => n + r.quantity, 0));
  const rows = $derived.by(whileShown("home", () => masteryRows(model)));
  const invasions = $derived.by(whileShown("home", () => invasionNeeds(model, live.invasions)));
  const rareInvasions = $derived(invasionRares(live.invasions));
  // Running alerts worth a look: mastery you're missing (PC only: it needs your inventory), rare rewards.
  const worldAlerts = $derived.by(whileShown("home", () => alertNeeds(console ? null : model, live.alerts, now)));
  const day = $derived.by(whileShown("home", () => today(model, live, now, settings.game.gear)));

  // ------------------------------------------------------------ world clocks and fissure alerts
  const cycles = $derived(cycleTimers(live, now));
  const events = $derived(eventViews(live.events, now));
  const resets = $derived(resetTimers(live, now));
  const CYCLE_ICON: Record<string, GameIconName> = { earth: "cycles", cetus: "ostron", vallis: "solaris-united", cambion: "entrati", zariman: "holdfasts", duviri: "duviri" };
  // The Zariman's clock shows whose ground it is: the faction's sigil, not the Holdfasts'.
  const cycleIcon = (key: string, state: string): GameIconName => (key === "zariman" && factionIcon(state)) || CYCLE_ICON[key];
  const RESET_ICON: Record<string, GameIconName> = { daily: "daily-reset", weekly: "archon-hunt" };
  // The clocks' own names, short enough to fit their column whole (the tooltip has the long one).
  const CYCLE_SHORT: Record<string, string> = { cetus: "Cetus", cambion: "Cambion", vallis: "Vallis" };
  const RESET_SHORT: Record<string, string> = { daily: "Standing caps", weekly: "Archon, Circuit" };
  const watched = $derived(matchedFissures(settings.fissureRules, live.fissures, now));
  const PLANETS = ["Mercury", "Venus", "Earth", "Lua", "Mars", "Phobos", "Deimos", "Ceres", "Jupiter", "Europa", "Saturn", "Uranus", "Neptune", "Pluto", "Sedna", "Eris", "Void", "Kuva Fortress", "Zariman", "Veil Proxima", "Earth Proxima", "Venus Proxima", "Saturn Proxima", "Neptune Proxima", "Pluto Proxima"];
  const missionChoices = $derived(missionTypes(live.fissures));
  const planets = $derived([...new Set([...PLANETS, ...(live.fissures ?? []).map((f) => planetOf(f.node)).filter(Boolean)])]);
  let adding = $state(false);
  /** The alert being changed, when one was clicked: Save puts the change in its place. */
  let editing = $state<string | null>(null);
  const blank = (): Omit<FissureRule, "id"> => ({ kinds: [], tiers: [], missions: [], planets: [] });
  let draft = $state<Omit<FissureRule, "id">>(blank());
  const duplicate = $derived(settings.fissureRules.some((r) => r.id !== editing && sameRule(r, tidyRule(draft))));
  function closeRule() {
    draft = blank();
    adding = false;
    editing = null;
  }
  function editRule(r: FissureRule) {
    draft = { kinds: [...r.kinds], tiers: [...r.tiers], missions: [...r.missions], planets: [...r.planets] };
    editing = r.id;
    adding = true;
  }
  function saveRule() {
    if (duplicate) return;
    const id = editing;
    const rule = tidyRule(draft);
    settings.fissureRules = id ? settings.fissureRules.map((r) => (r.id === id ? { ...rule, id } : r)) : [...settings.fissureRules, { ...rule, id: `${Date.now()}` }];
    closeRule();
  }
  const removeRule = (id: string) => {
    settings.fissureRules = settings.fissureRules.filter((r) => r.id !== id);
    if (editing === id) closeRule();
  };
  const builds = $derived.by(whileShown("home", () => foundryBuilds(model, settings.game.foundryReady, now)));
  // Every part in hand: ready now first, then what's short on star-chart resources, then the ones
  // that need an open world or an event (Hildryn's Lazulite Toroid).
  const TIER_ORDER = { now: 0, farm: 1, hard: 2, parts: 3 } as const;
  // A modular part in hand (a chamber, a MOA's model) is every part too: assembled at its vendor.
  const buildable = $derived(rows.filter((r) => r.status === "build" || r.status === "assemble").sort((a, b) => TIER_ORDER[a.buildTier ?? "now"] - TIER_ORDER[b.buildTier ?? "now"] || b.points - a.points));
  // Your wishlist, still to get: what's left and whether a fissure for one of your relics is open now.
  // The ones you can crack a relic for now come first.
  const openNow = $derived(openEras(live.fissures, now));
  // Then modular gear with a step left (a chamber to assemble, a build to gild): nothing to collect, but still to do.
  const wishes = $derived.by(
    whileShown("home", () => {
      const all = settings.favourites.map((u) => wishItem(model, u)).filter((w): w is WishItem => !!w && !w.c.mastered);
      return [...crackableFirst(all.filter((w) => w.missing.length > 0), openNow), ...all.filter((w) => !w.missing.length && w.c.step)];
    }),
  );
  /** A modular item's next step, as far as who to see: "Assemble it at Father or Rude Zuud". */
  const stepLine = (w: WishItem) => {
    const s = (w.c.stepBrief ?? w.c.stepTag ?? "").replace(/^(Not gilded yet\? )?Rank it to 30, /, "").split(/, then |\. /)[0].replace(/\.$/, "");
    return s[0].toUpperCase() + s.slice(1);
  };
  const crackable = (w: WishItem) => crackableNow(w, openNow);
  /** The item a Foundry build makes, when it's one with details (not a part). */
  const buildUnique = (name: string) => {
    const d = describe(model, name);
    return d?.kind === "gear" ? d.item.uniqueName : null;
  };
  // Ducats your spare parts would fetch, counting only the ones better traded in than sold.
  // As Prime parts counts them: parts that go into a complete set you can sell are sold as the set.
  const spareDucats = $derived.by(whileShown("home", () => partRows(model, saveForSets(settings.market.sellable, settings.advice.platPerDucat, drops.recent)).filter((p) => p.spare > 0 && p.inSets <= 0 && decide(p.price, p.ducats, p.tradesPerDay, settings.advice, p.spare).verdict === "ducats").reduce((n, p) => n + p.ducats * p.spare, 0)));
  const varzia = $derived.by(whileShown("home", () => console ? [] : varziaNeeds(model, rows)));
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
  // Each a card: what it's about (the reward, or the problem) in bold, where and why under it, the
  // faction to fight or side with as its sigil, and how long it has.
  interface Alert {
    key: string | null;
    tone: "gold" | "red" | "info";
    icon: GameIconName;
    /** The item's artwork, when it's about one: shown instead of the kind's icon, which goes small on its corner. */
    image?: string | null;
    title: string;
    sub: string;
    /** Who the mission is against; `side`: the side to take in an invasion. */
    foe?: string;
    side?: string;
    /** How far an invasion is, 0–100. */
    progress?: number | null;
    /** An invasion's two sides, attacker first: the progress drawn as a tug of war between them. */
    sides?: [string, string] | null;
    expiry?: string;
    act: string;
    to: string;
    hint: string;
  }
  const dismissed = $derived(new Set(settings.homeDismissed));
  function dismiss(key: string) {
    settings.homeDismissed = [key, ...settings.homeDismissed.filter((k) => k !== key)].slice(0, 200);
  }
  // Kept as they were while Home is hidden (pane.svelte.ts): the list moves its cards (animate:flip),
  // and redrawing it out of sight would lay the hidden page out just to measure them.
  const alerts = $derived.by(whileShown("home", () => all().filter((a) => !a.key || !dismissed.has(a.key))));
  // Dismissing an alert or removing a price alert waits a few seconds, with Undo, before it's done.
  const undo = new UndoSlots();
  $effect(() => () => undo.flush());
  const alertKey = (a: { name: string; rank: number | null; subtype?: string | null }) => `price:${a.name}|${a.rank ?? ""}|${a.subtype ?? ""}`;
  function removePriceAlert(a: (typeof settings.market.buyAlerts)[number]) {
    undo.hold(alertKey(a), () => (settings.market.buyAlerts = settings.market.buyAlerts.filter((x) => alertKey(x) !== alertKey(a))));
  }
  // Bounties and Worth doing today start as a line each; the whole of them a click away.
  let openBounties = $state(false);
  let openToday = $state(false);
  // Chores ticked off by hand (the inventory doesn't say what's done): each clears at its own reset.
  const weekly = $derived(nextMondayUtc(now));
  const chores = $derived(
    [
      day.circuit ? { key: "circuit", resets: day.circuit.resets } : null,
      day.steelPath ? { key: "teshin", resets: day.steelPath.ends } : null,
      ...day.archimedeas.map((a) => ({ key: `archimedea-${a.kind}`, resets: a.ends })),
      day.descendia ? { key: "descendia", resets: day.descendia.ends } : null,
      day.calendar ? { key: "calendar", resets: day.calendar.ends } : null,
      day.sortie ? { key: "sortie", resets: day.sortie.ends } : null,
      day.archon ? { key: "archon", resets: day.archon.ends } : null,
      day.nightwave ? { key: "nightwave", resets: weekly } : null,
      { key: "kahl", resets: weekly },
      { key: "netracells", resets: weekly },
    ].filter((c): c is { key: string; resets: string } => !!c),
  );
  const choresDone = $derived(chores.filter((c) => isDone(settings.chores, c.key, c.resets, now)).length);
  const doneNow = (key: string, resets: string) => isDone(settings.chores, key, resets, now);
  function toggleChore(key: string, resets: string) {
    settings.chores = setDone(settings.chores, key, resets, !doneNow(key, resets));
  }
  const all = () => {
    const out: Alert[] = [];
    // Alerts and invasions rewarding a part for something you haven't mastered: they don't come back on demand.
    for (const a of worldAlerts.mastery) {
      const h = a.help!;
      out.push({ key: `alert|${a.key}`, tone: "gold", icon: "mastery", image: model?.imageOf(h.item) ?? null, title: a.reward, sub: `${h.whole ? "" : `toward ${h.item} · `}${h.points.toLocaleString("en")} mastery${h.needed > 1 ? ` · ${h.have} of ${h.needed}` : ""} · ${a.mission} on ${a.node}`, foe: a.faction, expiry: a.expiry, act: "", to: "", hint: `An alert with something you haven't mastered: ${describeHelp(a.reward, h)}. ${a.mission} on ${a.node}` });
    }
    for (const a of worldAlerts.rare) out.push({ key: `alert|${a.key}`, tone: "info", icon: "sortie", image: model?.imageOf(a.reward.replace(/^\d+ × /, "")) ?? null, title: a.reward, sub: `${a.mission} on ${a.node}`, foe: a.faction, expiry: a.expiry, act: "", to: "", hint: `An alert with a rare reward: ${a.reward}. ${a.mission} on ${a.node}` });
    if (!console) for (const n of invasions) out.push({ key: `invasion|${n.key}`, tone: "gold", icon: "invasion", image: n.itemImage, title: n.reward, sub: `toward ${n.item}${n.needed > 1 ? ` · ${n.have} of ${n.needed}` : ""} · ${n.node}`, side: n.side, progress: n.completion, sides: n.attacker && n.defender ? [n.attacker, n.defender] : null, act: "Mastery", to: "mastery", hint: `An invasion at ${n.node} rewards ${n.reward} for ${n.item}, which you haven't mastered: side with the ${n.side}` });
    for (const n of rareInvasions) out.push({ key: `invasion|${n.key}`, tone: "info", icon: "invasion", image: model?.imageOf(n.reward.replace(/^\d+ × /, "")) ?? null, title: n.reward, sub: `invasion · ${n.node}`, side: n.side, progress: n.completion, act: "", to: "", hint: `An invasion at ${n.node} pays a rare reward, ${n.reward}: side with the ${n.side}. Three runs earn it` });
    if (shortListings.length) out.push({ key: null, tone: "gold", icon: "market", title: "Listed more than you hold", sub: `${shortListings.length} listing${shortListings.length === 1 ? "" : "s"}${hiddenShort ? ` (+${hiddenShort} hidden)` : ""}: sold in game, or listed by mistake. Fix them on Orders`, act: "Open Orders", to: "market", hint: "Your visible listings on warframe.market for more copies than your inventory holds" });
    const statusError = mkt.statusError ?? mkt.status?.error;
    if (statusError) out.push({ key: null, tone: "red", icon: "market", title: "warframe.market status", sub: statusError, act: "Open Orders", to: "market", hint: `Your status on warframe.market couldn't be set: ${statusError}` });
    const urgent = varzia.filter((v) => v.onlyHere > 0 || v.regalAya != null);
    // Varzia's card says what she has; the alert is only for a rotation about to end.
    if (!console && urgent.length && live.resurgenceExpiry && Date.parse(live.resurgenceExpiry) - now < 3 * DAY) out.push({ key: `varzia|${live.resurgenceExpiry}`, tone: "gold", icon: "varzia", title: "Varzia's rotation is ending", sub: `with ${urgent.length} prime${urgent.length === 1 ? "" : "s"} you need`, expiry: live.resurgenceExpiry, act: "", to: "", hint: "Prime Resurgence: her primes go when the rotation ends" });
    return out;
  };

  // ---------------------------------------------------------------- start here
  // The few things that make the rest of MyOrbiter work, ticked as they're done.
  const startSteps = $derived([
    { label: "Sign in to warframe.market", why: "to list, reprice and see your orders", hint: "On Orders: MyOrbiter keeps its own sign-in", done: mkt.linked, go: () => go("market") },
    { label: "Set your rates", why: "what a ducat is worth to you, and the smallest sale worth a trade", hint: "Prime parts → Your rates", done: settings.advice.platPerDucat !== defaultAdvice().platPerDucat || settings.advice.minPlat !== defaultAdvice().minPlat, go: () => go("parts") },
    { label: "Star what you're after", why: "Wishlist shows the relics for each missing part", hint: "The ☆ on any card in Foundry or Mastery", done: settings.favourites.length > 0, go: () => go("foundry") },
    { label: "Add a fissure alert", why: "a notification when a fissure you want opens", hint: "Fissures now → Add alert", done: settings.fissureRules.length > 0, go: () => go("home#addalert") },
    { label: "Choose Home's cards", why: "hide what you don't use", hint: "The ⚙ at the head's right", done: homeCardsChosen(settings), go: () => (customising = true) },
  ]);

  // ---------------------------------------------------------------- what Home shows (Customise)
  const CARDS: { key: string; label: string; hint: string; consoleHint?: string }[] = [
    { key: "alerts", label: "Needs you", hint: "Alerts and invasions worth a look, listings to fix, Varzia's rotation ending", consoleHint: "Alerts and invasions with rare rewards" },
    { key: "world", label: "World clocks", hint: "Day and night on the open worlds, Duviri's mood, and the daily and weekly resets" },
    { key: "market", label: "Your orders", hint: "Your warframe.market status, what you have listed, and what sold" },
    { key: "ready", label: "Ready to list", hint: "Your spares worth listing, in the kinds ticked on Sell spares, at or over your minimum" },
    { key: "fissures", label: "Fissures now", hint: "The open fissures, one kind at a time (normal, Steel Path or Void Storms), your best relic for each era, and your fissure alerts", consoleHint: "The open fissures, one kind at a time (normal, Steel Path or Void Storms), and your fissure alerts" },
    { key: "bounties", label: "Bounties", hint: "The bounties in Cetus, Fortuna, the Necralisk, the Zariman, Cavia and Höllvania, and what each pays" },
    { key: "events", label: "Events", hint: "Events running in game (Tactical Alerts, operations, seasonal ones): where, until when, and what they pay" },
    { key: "today", label: "Worth doing today", hint: "The Duviri Circuit, Darvo's deal, Teshin, the Sortie (its missions, modifiers and reward chances), the Archon Hunt and Nightwave" },
    { key: "foundry", label: "Foundry", hint: "What's building, and what you have every part for" },
    { key: "wishes", label: "Your wishlist", hint: "What you starred and still need, with relics to crack for it" },
    { key: "deals", label: "Cheap buys", hint: "Parts and arcanes you're after, listed well under their usual price, and your price alerts" },
    { key: "mastery", label: "Easiest mastery next", hint: "What to level, and the easiest things you haven't mastered" },
    { key: "baro", label: "Baro Ki’Teer", hint: "When he comes, and what he brings that's new to you", consoleHint: "When he comes, and what he brings" },
    { key: "varzia", label: "Varzia", hint: "Prime Resurgence: the primes you still need from her rotation", consoleHint: "Prime Resurgence: what's in her rotation, and when it ends" },
  ];
  /** Cards that need your inventory: never on a console. */
  const NEEDS_INVENTORY = new Set(["ready", "foundry", "wishes", "deals", "mastery"]);
  const cards = $derived(console ? CARDS.filter((c) => !NEEDS_INVENTORY.has(c.key)).map((c) => ({ ...c, hint: c.consoleHint ?? c.hint })) : CARDS);
  let customising = $state(false);
  // Closing the panel after looking at it is a choice too, even if every card stays shown.
  function toggleCustomise() {
    if (customising) settings.homeChosen = true;
    customising = !customising;
  }
  const hidden = $derived(new Set(settings.homeHidden));
  // A card a notification opened shows even if you hid it, until you leave Home.
  const off = (key: string) => key !== reveal && (hidden.has(key) || (console && NEEDS_INVENTORY.has(key)));
  // A card you hide fades out before it goes, and one you show fades in where it lands (QUICK);
  // the chip itself turns at once. Under reduced motion, or a card off screen, it's just done.
  const fading = new Map<string, Animation>();
  function toggleCard(key: string, on: boolean) {
    const set = () => {
      settings.homeHidden = on ? settings.homeHidden.filter((k) => k !== key) : [...settings.homeHidden, key];
      settings.homeChosen = true;
    };
    fading.get(key)?.cancel();
    fading.delete(key);
    const card = () => document.querySelector<HTMLElement>(`.home [data-card="${key}"]`);
    const el = card();
    if (calm.current || !el || typeof el.animate !== "function") return set();
    if (on) {
      set();
      nextTick().then(() => {
        const shown = card();
        if (!shown?.getClientRects().length) return;
        fading.set(key, shown.animate([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], { duration: QUICK, easing: OUT_CSS }));
      });
      return;
    }
    if (!el.getClientRects().length) return set();
    const a = el.animate([{ opacity: 1 }, { opacity: 0, transform: "scale(.98)" }], { duration: QUICK, easing: OUT_CSS, fill: "forwards" });
    fading.set(key, a);
    a.onfinish = () => {
      set();
      nextTick().then(() => a.cancel());
    };
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

{#snippet tick(key: string, resets: string, what: string)}
  {@const on = doneNow(key, resets)}
  <span class="tick"><Tick {on} label="{what} done" title={on ? `${what}: done. Click to untick` : `Tick off ${what} once it's done; it clears itself at the reset, in ${until(resets, now)}`} onclick={() => toggleChore(key, resets)} /></span>
{/snippet}

{#snippet head(icon: GameIconName | null, line: string | null, title: string, to: string | null, action: string, part: string)}
  <header class="ph">
    <span class="pt">{#if icon}<GameIcon name={icon} size={22} />{:else if line}<Icon name={line} size={18} />{/if}<span class="register">{title}</span></span>
    {#if to}<button class="link" onclick={() => go(to)}>{action} →</button>{/if}
    <HelpMark {part} />
  </header>
{/snippet}

<div class="page"><div class="page-inner home">
  <!-- The shared head: no section, so no crest. The one line is today's date and how fresh the
       world's state is; Customise is the head's action. -->
  <PageHead title="Home">
    {#snippet lede()}{new Date(now).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}{#if liveAt != null}<span class="upd" class:old={!!liveError || !liveRead} title={`Fissures, the clocks, bounties, Baro, Varzia, the Sortie, events and the rest come from ${live.fromGame ? "the game's own worldstate (api.warframestat.us isn't answering)" : "api.warframestat.us"}, read every 5 minutes.${!liveRead && !liveError ? " This is the read kept from last time, until the first read since start comes in; each thing in it goes when it ends." : ""}${liveError ? " The last read failed, so this is what was read before; each thing in it goes when it ends." : ""}`}>{` · Updated ${liveError || !liveRead ? checkedWhen(liveAt, now) : new Date(liveAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`}</span>{/if}{/snippet}
    {#snippet action()}<IconButton icon="settings" tone="quiet" label="Customise Home" title="Choose what Home shows" aria-expanded={customising} onclick={toggleCustomise} />{/snippet}
  </PageHead>

  {#if startSteps.some((x) => !x.done) && !settings.startDone && !console}
    <!-- First days with MyOrbiter: the few things that make the rest of it work, each a click away. -->
    <div class="startfold reveal" out:unfold><div><section class="start" aria-label="Start here">
      <header><span class="register">Start here</span><span class="dim small">{startSteps.filter((x) => x.done).length} of {startSteps.length} done</span><button type="button" class="link quiet small" title="Put this card away (it goes on its own once every step is done)" onclick={() => (settings.startDone = true)}>Not now</button><HelpMark part="home.start" /></header>
      <ol>
        {#each startSteps as x (x.label)}
          <li class:done={x.done}><Tick on={x.done} size={1.05} /><button type="button" class="link" disabled={x.done} title={x.hint} onclick={x.go}>{x.label}</button><span class="dim small">{x.why}</span></li>
        {/each}
      </ol>
    </section></div></div>
  {/if}

  {#if customising}
    <div class="reveal" transition:unfold><div><section class="custom" aria-label="What Home shows">
      <span class="register">Show on Home</span>
      <div class="cards">
        {#each cards as c (c.key)}<Chip on={!hidden.has(c.key)} label={c.label} title={`${c.hint}. Click to ${hidden.has(c.key) ? "show" : "hide"} it.`} onchange={(on: boolean) => toggleCard(c.key, on)} />{/each}
      </div>
      {#if cards.some((c) => hidden.has(c.key))}<button class="link" onclick={() => { settings.homeHidden = []; settings.homeChosen = true; }}>Show everything</button>{/if}
      <HelpMark part="home.customise" corner />
    </section></div></div>
  {/if}

  {#if alerts.length}
    <section class="alerts" data-card="alerts" aria-label="Needs you" class:off={off("alerts")}>
      <!-- Dismissed: the Undo line, then (once its time is up) it leaves and the rest close up. -->
      {#each alerts as a (a.key ?? a.title)}
        <div class="aslot" out:leave animate:flip>
        {#if a.key && undo.has(a.key)}
          <div class="alert ghost"><UndoSlot label="Dismissed" what={a.title} onundo={() => undo.undo(a.key!)} /></div>
        {:else}
        <div class="alert t-{a.tone}" title={a.hint} in:arrive={{ y: 3 }}>
          {#if a.image}<span class="art"><Thumb file={a.image} name={a.title} size={38} /><span class="badge"><GameIcon name={a.icon} size={16} /></span></span>{:else}<span class="art"><GameIcon name={a.icon} size={30} /></span>{/if}
          <span class="tx">
            <b>{a.title}</b>
            <span class="dim small where">{a.sub}{#if a.foe}&ensp;<Foe enemy={a.foe} size={13} />{/if}{#if a.side}&ensp;<span class="side">side with <Foe enemy={a.side} size={13} /></span>{/if}</span>
            {#if a.progress != null && a.sides}
              {@const at = Math.max(0, Math.min(100, a.progress))}
              <span class="tug" title="{a.sides[0]} {Math.round(at)}% · {a.sides[1]} {Math.round(100 - at)}%: whoever fills the bar wins">
                <Foe enemy={a.sides[0]} size={12} name={false} /><span class="tb"><Segments key="invasion:{a.key ?? a.title}" max={100} cells={20} fill parts={[{ value: at, tone: faction(a.sides[0]), label: a.sides[0] }, { value: 100 - at, tone: faction(a.sides[1]), label: a.sides[1] }]} label="Invasion" /></span><Foe enemy={a.sides[1]} size={12} name={false} />
              </span>
            {:else if a.progress != null}<span class="prog" title="{Math.round(a.progress)}% through"><Segments key="alert:{a.key ?? a.title}" value={Math.max(0, Math.min(100, a.progress))} max={100} cells={20} fill label="{Math.round(a.progress)}% through" /></span>{/if}
          </span>
          <span class="end">
            {#if a.expiry}<span class="small nowrap">{until(a.expiry, now)} left</span>{/if}
            {#if a.to}<button class="link" onclick={() => go(a.to)}>{a.act} →</button>{/if}
          </span>
          {#if a.key}<IconButton icon="close" tone="quiet" size={12} label="Dismiss" title="Dismiss: it doesn't come back for this alert (you get a few seconds to undo)" onclick={() => undo.hold(a.key!, () => dismiss(a.key!))} />{/if}
        </div>
        {/if}
        </div>
      {/each}
      <HelpMark part="home.needs-you" corner />
    </section>
  {/if}

  <div class="grid">
    <!-- World clocks -->
    {#if cycles.length || resets.length}
      <section class="panel world" data-card="world" class:off={off("world")} aria-label="World clocks">
        <!-- Still asking for the world: the five clocks' places, so nothing jumps when they arrive. -->
        {#if liveWaiting && !cycles.length}
          {#each ["earth", "cetus", "vallis", "cambion", "zariman", "duviri"] as k (k)}
            <div class="clock wait" aria-hidden="true"><GameIcon name={CYCLE_ICON[k]} size={26} /><div><span class="register clip1">{CYCLE_SHORT[k] ?? { earth: "Earth", vallis: "Orb Vallis", zariman: "Zariman", duviri: "Duviri" }[k]}</span><b class="mark st">Loading…</b><span class="dim small nowrap">&nbsp;</span></div></div>
          {/each}
        {/if}
        {#each cycles as c (c.key)}
          <div class="clock" title="{c.key === 'duviri' ? `Duviri's mood: ${c.state}, which sets the Spiral's look and what its missions and enemies are like` : `${c.label}: ${c.state}`}{c.next ? `, ${c.next} in ${until(c.ends, now)}` : ''}">
            <GameIcon name={cycleIcon(c.key, c.state)} size={26} title={c.key === "zariman" ? `The Zariman is held by the ${c.state}` : undefined} />
            <div><span class="register clip1">{CYCLE_SHORT[c.key] ?? c.label}</span><b class="mark st st-{c.state}">{c.state}</b><span class="dim small nowrap">{until(c.ends, now).replace("under a minute", "<1 min")}<span class="lft">{" left"}</span></span></div>
          </div>
        {/each}
        {#each resets.filter((r) => r.key !== "sortie") as r (r.key)}
          <div class="clock reset" title={r.state}>
            <span class="rk">{#if RESET_ICON[r.key]}<GameIcon name={RESET_ICON[r.key]} size={22} title={r.label} />{/if}</span>
            {#if r.key === "sortie"}<GameIcon name="sortie" size={22} />{/if}
            <div><span class="register">{#if RESET_ICON[r.key]}<span class="rk-sm"><GameIcon name={RESET_ICON[r.key]} size={11} /></span>{/if}{r.label}</span><b class="mark">{until(r.ends, now)}</b><span class="dim small clip1">{RESET_SHORT[r.key] ?? r.state}</span></div>
          </div>
        {/each}
        <HelpMark part="home.world" corner />
      </section>
    {/if}

    <!-- Market -->
    <section class="panel market" data-card="market" class:off={off("market")} class:full={alone("market")} style:grid-row={rowSpan("market")}>
      {@render head("market", null, "Your orders", "market", "Orders", "home.market")}
      {#if mkt.linked}
        <div class="presence"><Presence settings={settings.market} quiet tradesLeft={trades.left} resets={trades.resets} /></div>
        <div class="figs">
          <div title="Your visible listings on warframe.market: price × quantity, and how many{hiddenCount ? ` (${hiddenCount} hidden ones not counted)` : ''}"><P v={listed} /><span class="register">In {orders.length - hiddenCount} listing{orders.length - hiddenCount === 1 ? "" : "s"}</span></div>
          {#if !console}<div title="Listed more than you hold: visible listings for more copies than you hold now (sold, or used in game). Fix them on Orders, or a buyer finds you can't deliver{hiddenShort ? `. ${hiddenShort} hidden listing${hiddenShort === 1 ? '' : 's'} too, which nobody can buy` : ''}"><b class="mark" class:amber={shortListings.length}>{shortListings.length}</b><span class="register">Listed more than you hold</span></div>{/if}
          <div title="Platinum from what you sold today, from Sales: since your local midnight (Trades left counts from 00:00 UTC)"><P v={sold(dayStart)} /><span class="register">Sold today</span></div>
          <div title="Platinum from what you sold in the last 7 days"><P v={sold(now - 7 * DAY)} /><span class="register">Last 7 days</span></div>
          {#if !console && trades.limit != null}<div title="Trades a day are your Mastery Rank ({trades.limit}; extra trades from Founder status are not added), each one counting whatever it carried (up to 6 items). {trades.used} since 00:00 UTC, from the game's log while MyOrbiter was reading it. Refreshes in {until(new Date(trades.resets).toISOString(), now)}"><b class="mark" class:amber={trades.left != null && trades.left <= 3}>{trades.left}<small class="dim">/{trades.limit}</small></b><span class="register">Trades left</span></div>{/if}
        </div>
        {#if shortListings.length || hiddenShort}
          <ul class="mini">
            {#each shortListings.slice(0, 3) as o (o.id)}
              {@const it = mkt.item(o.itemId)}
              <li><Thumb file={model.imageOf(it?.name ?? "")} name={it?.name ?? ""} size={22} /><span>{it?.name ?? "?"}</span><span class="amber small" title="Listed more than you hold: sold in game, or used">! listed {o.quantity}, you hold {it ? (heldFor(model, it, o) ?? "?") : "?"}</span></li>
            {/each}
            {#if hiddenShort}<li class="dim small" title="Hidden listings for more than you hold: nobody can buy them, so they're not in the count above. Fix them on Orders">+{hiddenShort} hidden listing{hiddenShort === 1 ? "" : "s"} for more than you hold</li>{/if}
          </ul>
        {/if}
        <div class="foot"><button class="link" onclick={() => go("sales")}>Sales log →</button></div>
      {:else if mkt.signInRefused}
        <p class="dim">warframe.market refused MyOrbiter's sign-in. Sign out on <button class="link" onclick={() => go("market")}>Orders</button>, then sign in again.</p>
      {:else if mkt.accountError}
        <p class="dim">Signed in, but warframe.market can't be reached right now. MyOrbiter tries again every minute; see <button class="link" onclick={() => go("market")}>Orders</button>.</p>
      {:else}
        <p class="dim">Not signed in to warframe.market. Sign in on <button class="link" onclick={() => go("market")}>Orders</button> to list, reprice and go online from here.</p>
      {/if}
    </section>

    <!-- Ready to list -->
    <section class="panel ready" class:off={off("ready")} class:half={orphan("ready")} class:lone={lone("ready")} style:--n={share("ready")} data-card="ready">
      {@render head("platinum", null, "Ready to list", "spares", "Sell spares", "home.ready")}
      {#if !ticked}
        <p class="dim">Nothing ticked on <b>Sell spares</b>.</p>
      {:else if !byKind.length}
        <p class="dim" title="Your minimum prices (Sell spares): {minimumsText(settings.market)}">Nothing spare worth your minimum or more in what you ticked.</p>
      {:else}
        <div class="big"><P v={byKind.reduce((n, k) => n + k.plat, 0)} big /><span class="dim small" title="Ready to list: the kinds ticked on Sell spares (arcanes: extra maxed copies, and unranked ones with Every spare copy, as it lists them), at or over your minimum price ({minimumsText(settings.market)}), at the daily median and no more of each than the market sells in a month. Prime parts, mods and arcanes are their pages' Worth selling (not worth a trade under {settings.advice.minPlat}p, ducat and Vosfor picks left out) less what's under your minimum. Everything you could spare, of every kind, is Spare value on Inventory">if you list your spares{unlisted ? ` · ${unlisted} not listed yet` : ""}</span></div>
        <ul class="kinds">
          {#each byKind as k (k.kind)}
            <li>
              {#if KIND_ICON[k.kind].game}<GameIcon name={KIND_ICON[k.kind].game!} size={20} />{:else}<Icon name={KIND_ICON[k.kind].line!} size={18} />{/if}
              <span>{KIND_LABEL[k.kind]}s</span><span class="dim">{k.count}</span><P v={k.plat} />
            </li>
          {/each}
        </ul>
        {#if underMin >= 1}<p class="dim small note" title="Spares in the kinds you ticked that are worth a trade but priced under your minimum (Sell spares): counted in Worth selling on their pages, but not listed. {underSplit}">+<P v={underMin} /> under your {under.some((t) => t.own) ? "minimums" : `${settings.market.minPrice}p minimum`}</p>{/if}
        {#if !console && !listsKind("part")}<p class="dim small note">Loose prime parts aren't sold on Sell spares: <button class="link" onclick={() => go("parts?best=Sell")}>Prime parts</button> has them.</p>{/if}
      {/if}
    </section>

    <!-- Fissures -->
    <section class="panel fissures" data-card="fissures" class:off={off("fissures")}>
      {@render head("void-tear", null, "Fissures now", console ? null : "relics", "Relics", "home.fissures")}
      {#if live.fissures == null}
        <p class="dim" class:waiting={liveWaiting}>{liveWaiting ? "Loading fissures…" : liveNote}</p>
      {:else}
        {#if liveError && liveAt != null}<p class="dim small fromgame">The worldstate can't be read right now: these are from the last read ({checkedWhen(liveAt, now)}), each gone once it ends. MyOrbiter asks again every few minutes.</p>
        {:else if live.fromGame}<p class="dim small fromgame">Read from the game's own worldstate: api.warframestat.us isn't answering, so Nightwave and the Circuit may be out of date, and alerts, invasions and Darvo's deal can't be read.</p>{/if}
        <FissureBoard fissures={live.fissures} bind:mode={settings.homeFissures} bind:only={settings.homeFissuresOnly} alerts={settings.fissureRules.length} {now} best={eraBest} watched={new Set(watched.map((w) => w.fissure.id))} onera={console ? null : (era) => go(`relics?era=${era}`)} saving={(era) => savingByEra.get(era) ?? null} />
      {/if}
      <div class="watch">
        <span class="register"><Icon name="bell" size={12} /> Fissure alerts</span>
        {#each settings.fissureRules as r (r.id)}
          <span class="rule" class:editing={editing === r.id} in:opens={{ scale: 0.8 }} out:leave animate:flip><button class="rl" title="Change this alert" onclick={() => editRule(r)}>{ruleLabel(r)}</button><IconButton icon="close" tone="quiet" size={12} label="Remove this alert" onclick={() => removeRule(r.id)} /></span>
        {/each}
        {#if adding}
          <span class="addfold" in:unfold><span class="addrule">
            <PickMany bind:value={draft.kinds} label="Kind" any="Normal or SP" noun="kinds" options={(["normal", "steel", "storm"] as const).map((k) => ({ v: k, label: FISSURE_KIND[k] }))} />
            <PickMany bind:value={draft.tiers} label="Era" any="Any era" noun="eras" options={TIERS.map((t) => ({ v: t, label: t }))} />
            <PickMany bind:value={draft.missions} label="Mission" any="Any mission" noun="missions" options={missionChoices.map((m) => ({ v: m, label: m }))} />
            <PickMany bind:value={draft.planets} label="Planet" any="Any planet" noun="planets" options={planets.map((p) => ({ v: p, label: p }))} />
            <IconButton icon={editing ? "check" : "plus"} tone="gold" label={editing ? "Save this alert" : "Add this alert"} disabled={duplicate} onclick={saveRule} />
            <IconButton icon="close" tone="quiet" label="Cancel" onclick={closeRule} />
            {#if duplicate}<span class="dim small">You already have that alert.</span>{/if}
          </span></span>
        {:else}
          <button class="link add" data-card="addalert" onclick={() => (adding = true)}><Icon name="plus" size={11} />Add alert</button>
        {/if}
      </div>
      {#if watched.length && !(settings.homeFissuresOnly && settings.fissureRules.length)}
        <ul class="hits">
          {#each watched as w (w.fissure.id)}
            <li><GameIcon name={eraIcon(w.fissure.tier)} size={18} /><Mission type={w.fissure.missionType} storm={w.fissure.isStorm} size={14} /><b class="mark">{w.fissure.tier} {w.fissure.missionType}</b>{#if w.fissure.isHard}<GameIcon name="steel-essence" size={13} title="Steel Path" />{:else if w.fissure.isStorm}<GameIcon name="railjack" size={13} title="Void Storm" />{/if}<span class="dim small">{w.fissure.node} ·</span><span class="dim small"><Foe enemy={w.fissure.enemy} size={13} /></span><span class="grow"></span><span class="small nowrap">{until(w.fissure.expiry, now)} left</span></li>
          {/each}
        </ul>
      {:else if settings.fissureRules.length && !watched.length}
        <p class="dim small">Nothing matching open right now{settings.notify.fissures ? "; you'll get a notification when one opens" : ""}.</p>
      {/if}
    </section>

    <!-- Bounties -->
    <section class="panel bounties" data-card="bounties" class:off={off("bounties")}>
      {@render head("bounty", null, "Bounties", null, "", "home.bounties")}
      {#if live.syndicates == null && !bountyTables}
        <p class="dim">{liveNote}</p>
      {:else if openBounties}
        <div class="bboard" in:arrive={{ y: 0 }}><BountyBoard {boards} {now} imageOf={(n) => model.imageOf(n)} {need} opens={rewardOpens} /></div>
        <button class="link fold" aria-expanded="true" onclick={() => (openBounties = false)}>Fewer</button>
      {:else}
        <!-- One line a place: its wanted reward, else its rarest; the boards a click away. -->
        <ul class="bsum" in:arrive={{ y: 0 }}>
          {#each boards as b (b.label)}
            {@const j = b.jobs.find((x) => x.wanted) ?? b.jobs.reduce((best, x) => ((x.headline?.chance ?? 101) < (best.headline?.chance ?? 101) ? x : best), b.jobs[0])}
            <li><b>{b.label}</b><span class:gold={j?.wanted} use:info={j?.headline?.name ?? null}>{j?.headline?.name ?? "—"}</span>{#if j?.headline?.chance != null}<span class="dim small" title={j.wanted ? "A reward you need, and its chance per run" : "Its rarest reward, and its chance per run"}>{Math.round(j.headline.chance * 10) / 10}%</span>{/if}</li>
          {/each}
        </ul>
        <button class="link fold" aria-expanded="false" onclick={() => (openBounties = true)} title="Every bounty in each place: levels, rewards and standing">Every bounty →</button>
      {/if}
    </section>

    <!-- Events -->
    {#if events.length}
      <section class="panel events" data-card="events" class:off={off("events")}>
        {@render head(null, "event", "Events", null, "", "home.events")}
        <ul class="ev">
          {#each events as e (e.id)}
            <li>
              <div class="eh"><b class="mark">{e.name}</b><span class="dim small">{e.where ? `${e.where} · ` : ""}ends in {until(e.ends, now)}</span></div>
              {#if e.note}<p class="dim small">{e.note}</p>{/if}
              {#if e.progress}<div class="eprog" title="{e.progress.at.toLocaleString('en')} of {e.progress.of.toLocaleString('en')} toward its goal"><Segments key="event:{e.id}" value={e.progress.at} max={e.progress.of} cells={20} fill label="{e.progress.at.toLocaleString('en')} of {e.progress.of.toLocaleString('en')} toward its goal" /></div>{/if}
              {#if e.rewards.length}<p class="small erw"><span class="dim">Pays</span>{" "}{#each e.rewards as r, i (r)}{i ? " · " : ""}<span use:info={r.replace(/^[\d,]+ × /, "")}>{r}</span>{/each}</p>{/if}
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <!-- Worth doing today -->
    <!-- Folded, each task is its heading line (what and how long); open, its missions, offers and challenges. -->
    <section class="panel today" class:open={openToday} use:fresh={openToday} data-card="today" class:off={off("today")} class:full={alone("today")} style:grid-row={rowSpan("today")}>
      {@render head("nightwave", null, "Worth doing today", null, "", "home.today")}
      <p class="dim small chorecount" title="Tick each one once it's done: the game doesn't say. Every tick clears itself at that chore's own reset (daily for the Sortie, Monday 00:00 UTC for the weeklies)">{choresDone} of {chores.length} done · tick each when it's done</p>
      <div class="tgrid">
        {#if day.circuit}
          <div class="tblock">
            <div class="th" class:done={doneNow("circuit", day.circuit.resets)}><GameIcon name="duviri" size={18} /><b class="mark">Duviri Circuit</b><span class="dim small">{#if !console}<GameIcon name="mastery" size={11} /> not mastered · {/if}new picks in {until(day.circuit.resets, now)}</span>{@render tick("circuit", day.circuit.resets, "This week's Circuit picks")}</div>
            <div class="chips">
              {#each day.circuit.frames as c (c.name)}<span class="pick" class:want={c.wanted && !console} use:info={c.name}><Thumb file={c.image} size={22} />{c.name}{#if c.wanted && !console}<em title="Not mastered: worth taking" aria-label="not mastered, worth taking"><GameIcon name="mastery" size={11} /></em>{/if}</span>{/each}
            </div>
            <div class="th sub"><span class="register">Steel Path: Incarnon</span>{#if !console}<span class="dim small"><em class="want">+</em> a weapon you have, with no adapter yet</span>{/if}</div>
            <div class="chips">
              {#each day.circuit.incarnons as c (c.name)}<span class="pick" class:want={c.wanted && !console} use:info={c.name}><Thumb file={c.image} size={22} />{c.name}{#if c.wanted && !console}<em class="want" title="A weapon you have, with no adapter yet: worth taking" aria-label="worth taking">+</em>{/if}</span>{/each}
            </div>
            {#if !console && day.circuit.incarnons.some((c) => c.unseen)}<p class="dim small">MyOrbiter can't see installed Incarnons yet, so it marks none to take: a weapon you have may already have its Genesis.</p>{/if}
          </div>
        {/if}
        {#if day.darvo}
          {@const dv = day.darvo}
          <div class="tblock">
            <div class="th"><GameIcon name="market" size={18} /><b class="mark">Darvo's deal</b><span class="dim small">{dv.left != null ? `${dv.left} left · ` : ""}ends in {until(dv.ends, now)}</span></div>
            <p class="tline" title="Darvo's daily deal in the in-game Market (Market → Darvo's Deal), limited stock">
              <b use:info={dv.item}>{dv.item}</b> <span class="dim">for {dv.price}p ({dv.discount}% off {dv.was}p)</span>
              {#if dv.note && !console}<span class="dim small">{" · "}{dv.note}</span>{#if dv.wanted}<em class="want" title="Worth taking" aria-label="worth taking">+</em>{/if}{/if}
            </p>
          </div>
        {/if}
        {#if day.steelPath}
          <div class="tblock">
            <div class="th" class:done={doneNow("teshin", day.steelPath.ends)}><GameIcon name="steel-essence" size={18} /><b class="mark">Teshin's offer</b><span class="dim small">changes in {until(day.steelPath.ends, now)}</span>{@render tick("teshin", day.steelPath.ends, "Teshin's offer")}</div>
            <p class="tline"><b>{day.steelPath.reward}</b> <span class="dim inl">for {day.steelPath.cost} <GameIcon name="steel-essence" size={13} title="Steel Essence" /> Steel Essence</span></p>
            {#if day.steelPath.umbraIn != null && day.steelPath.umbraIn > 0}{@const w = day.steelPath.umbraIn}<p class="tline dim small" title="Teshin's weekly offer runs through an 8-week rotation; Umbra Forma (150 Steel Essence) is its rarest. It changes on Mondays, 00:00 UTC">Umbra Forma in {w} week{w === 1 ? "" : "s"}</p>{/if}
          </div>
        {/if}
        {#if day.archimedeas.length || day.calendar || day.descendia}
          <div class="tblock">
            {#each day.archimedeas as a (a.kind)}
              <div class="th" class:done={doneNow(`archimedea-${a.kind}`, a.ends)}><GameIcon name={a.kind === "Deep" ? "cavia" : "faction-scaldra"} size={18} /><b class="mark" title={a.kind === "Deep" ? "Deep Archimedea, in the Sanctum Anatomica (rank 5 with Cavia): three hard missions, each with its risks and a deviation, new each Monday" : "Temporal Archimedea, in Höllvania: three hard missions, each with its risks and a deviation, new each Monday"}>{a.kind} Archimedea</b><span class="dim small">{until(a.ends, now)} left</span>{@render tick(`archimedea-${a.kind}`, a.ends, `${a.kind} Archimedea`)}</div>
              <p class="tline dim small arch">{#each a.missions as x, i (i)}{#if i}{" · "}{/if}<span title={x.deviation ? `Deviation: ${x.deviation}` : x.type}><Mission type={x.type} size={12} />{x.type}</span>{/each}</p>
              <!-- What decides whether to run it: each mission's deviation and risks (the hard ones marked). -->
              <ol class="tline small archx">
                {#each a.missions as x, i (i)}
                  {#if x.deviation || x.risks.length}
                    <li><span class="dim">{i + 1}. {x.type}</span>{#if x.deviation}{" · "}<b title={x.deviationDesc || undefined}>{x.deviation}</b>{/if}{#if x.risks.length}<span class="dim">{" · "}{#each x.risks as rk, j (j)}{#if j}{", "}{/if}<span class:hard={rk.hard} title={`${rk.desc}${rk.hard ? " (one of the harder risks)" : ""}` || undefined}>{rk.name}{#if rk.hard}<sup aria-label="hard">!</sup>{/if}</span>{/each}</span>{/if}</li>
                  {/if}
                {/each}
              </ol>
            {/each}
            {#if day.calendar}
              {@const cal = day.calendar}
              {@const best = cal.prizes.filter((p) => p.notable)}
              <div class="th" class:done={doneNow("calendar", cal.ends)}><GameIcon name="faction-techrot" size={18} /><b class="mark" title="The 1999 Calendar in Höllvania: each season lasts a week, with two prizes to choose between each month">1999 Calendar</b><span class="dim small">{cal.season ? `${cal.season} · ` : ""}{until(cal.ends, now)} left</span>{@render tick("calendar", cal.ends, "This week's 1999 Calendar")}</div>
              <p class="tline dim small" title="The prize days worth a look (hover for the lot). Every prize day this season, one of each pair to pick: {cal.prizes.map((p) => `${p.day}: ${p.choices.join(' or ')}`).join('; ')}">{#if best.length}{best.map((p) => `${p.day} ${p.pick}`).join(" · ")}{:else}{cal.prizes.length} prize day{cal.prizes.length === 1 ? "" : "s"}, nothing rare{/if}</p>
            {/if}
            {#if day.descendia}
              <div class="th" class:done={doneNow("descendia", day.descendia.ends)}><GameIcon name="faction-orokin" size={18} /><b class="mark" title="The Descendia: a tower of {day.descendia.floors} floors (Infernums), new challenges each Monday; each floor's reward comes once a week, and Infernum 21 always drops an Uriel or Vinquibus part">Descendia</b><span class="dim small">{day.descendia.floors} Infernums · {until(day.descendia.ends, now)} left</span>{@render tick("descendia", day.descendia.ends, "The Descendia")}</div>
            {/if}
          </div>
        {/if}
        {#if day.sortie || day.archon}
          <div class="tblock">
            {#if day.sortie}
              <div class="th" class:done={doneNow("sortie", day.sortie.ends)}><GameIcon name="sortie" size={18} /><b class="mark">Sortie</b><span class="dim small">{day.sortie.boss}{day.sortie.faction ? ` (${day.sortie.faction})` : ""} · {until(day.sortie.ends, now)} left</span>{@render tick("sortie", day.sortie.ends, "Today's Sortie")}</div>
              <ol class="stages">
                {#each day.sortie.stages as st, i (i)}
                  <li title={st.desc || undefined}><span class="sn">{i + 1}</span><Mission type={st.mission} size={13} /><span class="nt"><span>{st.mission}<span class="dim">{" · "}{st.node}</span></span>{#if st.modifier}<span class="mod">{st.modifier}</span>{/if}</span></li>
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
              <div class="th" class:done={doneNow("archon", day.archon.ends)}><GameIcon name="archon-hunt" size={18} /><b class="mark">Archon Hunt</b><span class="dim small inl">{day.archon.boss}{#if day.archon.shard}{" · "}<GameIcon name={shardIcon(day.archon.shard)} size={13} title="{day.archon.shard} Archon Shard" />{day.archon.shard} shard{/if} · {until(day.archon.ends, now)} left</span>{@render tick("archon", day.archon.ends, "This week's Archon Hunt")}</div>
              <ol class="tline dim small archon">{#each day.archon.missions as m, i (i)}<li><Mission type={m.split(":")[0]} size={12} />{m}</li>{/each}</ol>
            {/if}
          </div>
        {/if}
        <!-- Weekly, with nothing in the worldstate to show: there to tick off. -->
        <div class="tblock">
          <div class="th" class:done={doneNow("kahl", weekly)}><GameIcon name="kahl" size={18} /><b class="mark" title="Kahl's weekly mission at Drifter's Camp in Duviri: it raises your Kahl's Garrison rank (Shelter, Encampment, Fort, Settlement, Home) and pays Stock">Kahl's Garrison</b><span class="dim small">Break Narmer · {until(weekly, now)} left</span>{@render tick("kahl", weekly, "Kahl's weekly mission")}</div>
          <div class="th" class:done={doneNow("netracells", weekly)}><GameIcon name="cavia" size={18} /><b class="mark" title="Netracells in Sanctum Anatomica (from Tagfer): five a week, each with a chance at an Archon Shard">Netracells</b><span class="dim small">5 a week · {until(weekly, now)} left</span>{@render tick("netracells", weekly, "This week's Netracells")}</div>
        </div>
        {#if day.nightwave}
          <div class="tblock">
            <div class="th" class:done={doneNow("nightwave", weekly)}><GameIcon name="nightwave" size={18} /><b class="mark">Nightwave</b><span class="dim small inl" title="What the challenges still open give, all of them done">up to <GameIcon name="nightwave" size={13} title="Nightwave standing" />{day.nightwave.standing.toLocaleString("en")} standing</span>{@render tick("nightwave", weekly, "This week's Nightwave challenges")}</div>
            <ul class="nw">
              {#each day.nightwave.challenges.slice(0, 6) as c (c.title)}<li><span class="k k-{c.kind}">{c.kind}</span><span class="nt">{c.title}{#if c.desc && !c.desc.startsWith("[PH]")}<small class="dim nwd">{c.desc}{c.expiry ? ` · ${until(c.expiry, now)} left` : ""}</small>{/if}</span><span class="dim small inl"><GameIcon name="nightwave" size={11} title="Nightwave standing" />{c.reputation.toLocaleString("en")}</span></li>{/each}
            </ul>
            {#if day.nightwave.challenges.length > 6}{@const rest = day.nightwave.challenges.slice(6)}<p class="dim small more">+{rest.length} more, {rest.reduce((n, c) => n + c.reputation, 0).toLocaleString("en")} standing (soonest to go first above)</p>{/if}
          </div>
        {/if}
        {#if !day.circuit && !day.steelPath && !day.nightwave && !day.sortie && !day.darvo}<p class="dim">{liveNote}</p>{/if}
      </div>
      <button class="link fold" aria-expanded={openToday} onclick={() => (openToday = !openToday)} title="The Sortie's missions and modifiers, the Archon Hunt's, Nightwave's challenges, Darvo's deal and the rest">{openToday ? "Fewer" : "Everything →"}</button>
    </section>

    <!-- Foundry -->
    <section class="panel foundry" class:off={off("foundry")} class:half={orphan("foundry")} class:lone={lone("foundry")} style:--n={share("foundry")} data-card="foundry">
      {@render head("foundry", null, "Foundry", null, "", "home.foundry")}
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
        <div class="register sub" title="Everything you can make now, or nearly: built in the Foundry, or revived with Son for a captured infested companion">Every part in hand</div>
        <ul class="fb">
          {#each buildable.slice(0, 4) as r (r.unique)}
            <li><button class="row" data-opens aria-label="{r.name}: details" onclick={() => details.open(r.unique)}><Thumb file={model.imageOf(r.name)} name={r.name} size={26} /><span class="fn"><b class="mark">{r.name}</b><span class="small" class:dim={r.buildTier !== "now"} class:good={r.buildTier === "now"} title={r.step ? r.acq.how : r.buildShort ? `Still to get before building: ${r.buildShort}` : undefined}>{r.revive ? "Captured: revive it with Son, in the Necralisk" : r.stepTag ? r.stepTag : r.buildTier === "now" ? "Build now: everything in hand" : r.buildTier === "hard" ? `Needs ${r.buildShort}` : r.buildTier === "farm" ? `Farm ${r.buildShort}` : "every part in hand"}</span></span><span class="pts"><GameIcon name="mastery" size={13} />{r.points.toLocaleString("en")}</span></button></li>
          {/each}
        </ul>
      {/if}
    </section>

    <!-- Wishlist -->
    <section class="panel wishes" class:off={off("wishes")} class:half={orphan("wishes")} class:lone={lone("wishes")} style:--n={share("wishes")} data-card="wishes">
      {@render head(null, "star", "Your wishlist", "wishlist", "Wishlist", "home.wishes")}
      {#if wishes.length}
        <ul class="fb">
          {#each wishes.slice(0, 4) as w (w.c.unique)}
            {@const now2 = crackable(w)}
            <li><button class="row" data-opens aria-label="{w.c.name}: details" onclick={() => details.open(w.c.unique)}>
              <Thumb file={w.c.image} name={w.c.name} size={26} />
              <span class="fn"><b class="mark">{w.c.name}</b>{#if !w.missing.length && w.c.step}<span class="small gold" title={w.c.stepHow}>{stepLine(w)}</span>{:else if now2.length}<span class="small gold">Crack {now2.slice(0, 2).join(" or ")} now</span>{:else}<span class="dim small">{w.missing.length} part{w.missing.length === 1 ? "" : "s"} to get{w.odds ? ` · ${Math.round(w.odds * 100)}% from your relics` : ""}</span>{/if}</span>
              {#if w.buyCost != null}<span class="when2" title="Buying what's missing at the daily median"><P v={w.buyCost} /></span>{/if}
            </button></li>
          {/each}
        </ul>
        {#if wishes.length > 4}<p class="dim small more">+{wishes.length - 4} more on your wishlist{wishes.slice(4).some((w) => w.c.step) ? `, ${wishes.slice(4).filter((w) => w.c.step).length} with a next step` : ""}</p>{/if}
      {:else}
        <p class="dim small">{settings.favourites.length ? "Everything you starred is built or ready to build." : "Star a warframe or weapon in Foundry or Mastery and it shows here, with the relics to crack for it."}</p>
      {/if}
    </section>

    <!-- Cheap buys -->
    <section class="panel deals" class:off={off("deals")} class:half={orphan("deals")} class:lone={lone("deals")} style:--n={share("deals")} data-card="deals">
      {@render head("platinum", null, "Cheap buys", null, "", "home.deals")}
      {#if mkt.deals.length}
        <ul class="dl">
          {#each mkt.deals.slice(0, 6) as d (d.key)}
            <li>
              <Thumb file={model.imageOf(d.name)} name={d.name} size={26} />
              <span class="fn"><b class="mark">{d.name}</b><span class="dim small">{d.seller} · {d.why}</span></span>
              <span class="pr"><P v={d.price} /><s class="dim small">{d.usual}</s></span>
              <CopyButton text={d.whisper} label="Copy whisper" title="Copy the whisper to {d.seller}, to paste in game chat: {d.whisper}" />
            </li>
          {/each}
        </ul>
      {:else}
        <p class="dim small">{mkt.dealsAt && !mkt.dealsChecked ? "Couldn't reach warframe.market; it tries again in 10 minutes." : mkt.dealsAt ? `Nothing listed at ${Math.round(DEAL_SHARE * 100)}% or less of its usual (daily median) price right now, among the parts you're missing for nearly complete sets and the arcanes you've started collecting. Medians under ${DEAL_MIN_REF}p are skipped; a price alert goes by your own price.` : "Checking warframe.market…"}</p>
      {/if}
      <!-- Price alerts you set from Post a buy order (Alert me): watched with the rest. -->
      {#if settings.market.buyAlerts.length}
        <div class="alertlist">
          <span class="register" title="Set with Alert me in Post a buy order (the Buy order buttons on Wishlist, Mastery, Browse market…): MyOrbiter tells you when someone lists one at your price or less">Your price alerts</span>
          {#each settings.market.buyAlerts as a (alertKey(a))}
            <span class="paslot" out:leave animate:flip>
            {#if undo.has(alertKey(a))}<UndoSlot label="Removed" what={a.name} onundo={() => undo.undo(alertKey(a))} />
            {:else}<span class="pa" use:info={a.name} in:arrive={{ y: 3 }}>{a.name}{a.rank != null ? ` R${a.rank}` : ""} <span class="dim">≤</span><P v={a.maxPrice} /><IconButton icon="close" tone="quiet" size={10} label="Remove alert" title="Stop watching {a.name} (you get a few seconds to undo)" onclick={() => removePriceAlert(a)} /></span>{/if}
            </span>
          {/each}
        </div>
      {/if}
      <p class="live small" title={mkt.feed?.error ?? "Every new listing on warframe.market is checked as it goes up"}>
        {#if mkt.feed?.connected}<i class="dot" aria-hidden="true"></i>Watching new listings live{mkt.liveDeals ? ` · ${mkt.liveDeals} caught` : ""}{:else if mkt.feed?.running}Connecting to the live feed…{/if}
      </p>
    </section>

    <section class="panel mastery" data-card="mastery" class:off={off("mastery")} class:full={alone("mastery")} style:grid-row={rowSpan("mastery")}>
      {@render head("mastery", null, "Easiest mastery next", "mastery", "Mastery", "home.mastery")}
      {#if toLevel.length}
        <button class="levelrow" onclick={() => go("mastery")} title="Things you own that aren't at max rank yet">
          <GameIcon name="mastery" size={26} />
          <span><b class="mark" title="Things you own that aren't at max rank yet: ranking them up is mastery you already have">{toLevel.length} to rank up</b><span class="dim small">{toLevel.slice(0, 4).map((r) => r.name).join(", ")}{toLevel.length > 4 ? "…" : ""}</span></span>
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
      {@render head("baro", null, "Baro Ki’Teer", console ? null : "parts?best=Ducats", "Spares for ducats", "home.baro")}
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
                <span class="cr dim small" title={s.credits ? `${s.credits.toLocaleString("en")} credits, on top of the ducats` : undefined}>{#if s.credits}<GameIcon name="credits" size={11} />{shortCredits(s.credits)}{/if}</span>
              </li>
            {/each}
          </ul>
          {#if !console && !baroNeed.length}<p class="dim small">Nothing in his stock you don't already have.</p>{/if}
          {#if !console && stock.length > baroNeed.length}<p class="dim small">+{stock.length - baroNeed.length} more you have or that give no mastery (cosmetics and the like).</p>{/if}
          {#if flips.length}
            <div class="register sub" title="What he sells that trades on warframe.market, by the platinum each ducat turns into when you sell it (its daily median price over his ducat cost). Buy from him, list it, and the ducats become platinum">Best ducats to plat</div>
            <ul class="stock flips">
              {#each flips as f (f.unique)}
                <li title="{f.name}: sells for about {Math.round(f.price)}p, {f.ducats} ducats{f.credits ? ` and ${f.credits.toLocaleString('en')} credits` : ''} from Baro{f.tradesPerDay != null ? `; about ${f.tradesPerDay < 1 ? f.tradesPerDay.toFixed(1) : Math.round(f.tradesPerDay)} trades a day` : ''}">
                  <span class="sn" use:info={f.name}>{f.name}</span>
                  <span class="mk dim small">{f.perDucat.toFixed(2)}p/ducat · {f.tradesPerDay != null ? `${f.tradesPerDay < 1 ? f.tradesPerDay.toFixed(1) : Math.round(f.tradesPerDay)}/day` : "?/day"}</span>
                  <P v={f.price} />
                  <span class="cr dim small">{#if f.credits}<GameIcon name="credits" size={11} />{shortCredits(f.credits)}{/if}</span>
                </li>
              {/each}
            </ul>
          {/if}
        {/if}
      {/if}
    </section>

    <!-- Varzia -->
    <section class="panel varzia" class:off={off("varzia")} class:half={orphan("varzia")} class:lone={lone("varzia")} style:--n={share("varzia")} data-card="varzia" class:slim={!!live.resurgence && !varzia.length && !console}>
      {@render head("varzia", null, "Varzia: Prime Resurgence", console ? null : "relics?vault=resurgence", "Her relics", "home.varzia")}
      {#if !live.resurgence}
        <p class="dim">{liveWaiting || liveError ? liveNote : "Varzia's rotation isn't in the worldstate right now."}</p>
      {:else if console}
        <div class="when"><b class="mark">{varziaWhole.length} for Regal Aya</b><span class="dim">{varziaRelics ? `and ${varziaRelics} relics for Aya · ` : ""}rotation ends in {until(live.resurgenceExpiry, now)}</span></div>
        <ul class="vz">
          {#each varziaWhole.slice(0, 8) as v (v.uniqueName)}
            <li>
              <Thumb file={model.imageOf(v.item)} size={26} name={v.item} />
              <span class="sn"><b class="mark" use:info={v.item}>{v.item.replace(/^M P V /, "")}</b><span class="dim small">{v.ducats} Regal Aya</span></span>
              <GameIcon name="regal-aya" size={16} title="Regal Aya" />
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
              <GameIcon name={v.regalAya != null ? "regal-aya" : "aya"} size={16} title={v.regalAya != null ? "Whole for Regal Aya" : "Her relics, for Aya"} />
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  </div>
</div></div>

<style>
  /* Needs you: a card each, as many to a row as fit. */
  .alerts { position: relative; padding-right: 2rem; display: grid; grid-template-columns: repeat(auto-fill, minmax(min(24rem, 100%), 1fr)); gap: .5rem; margin-bottom: var(--step); }
  .alert { display: flex; align-items: center; gap: .75rem; padding: .55rem .6rem .55rem .85rem; border: 1px solid var(--rule); background: var(--plate); box-shadow: inset 3px 0 0 var(--platinum-deep); min-width: 0; clip-path: var(--cut); }
  /* Dismissed, waiting out its Undo: just the collapsed line. */
  .aslot { display: grid; min-width: 0; }
  .alert.ghost { background: none; border-color: transparent; box-shadow: none; clip-path: none; padding: .3rem 0; }
  .alert .art { position: relative; flex: none; display: inline-flex; width: 38px; justify-content: center; }
  .alert .badge { position: absolute; right: -6px; bottom: -5px; display: inline-flex; padding: 1px; background: var(--plate); border: 1px solid var(--rule); }
  .alert .tx { flex: 1; display: grid; gap: .12rem; min-width: 0; }
  .alert .tx b { font-weight: 600; color: var(--platinum); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .alert .where { display: flex; flex-wrap: wrap; align-items: center; gap: 0 .1rem; }
  .alert .side { display: inline-flex; align-items: center; gap: .3rem; color: var(--gold); }
  .alert .prog { display: flex; margin-top: .3rem; max-width: 20rem; }
  /* An invasion as a tug of war: the attackers' colour from the left, the defenders' from the right. */
  .alert .tug { display: flex; align-items: center; gap: .35rem; margin-top: .25rem; max-width: 20rem; }
  .alert .tb { flex: 1; display: flex; min-width: 0; }
  .alert .end { display: grid; justify-items: end; gap: .15rem; flex: none; }
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
  .custom { position: relative; display: flex; align-items: center; flex-wrap: wrap; gap: .6rem 1rem; padding: .8rem 2.4rem .8rem 1rem; margin-bottom: var(--step); border: 1px solid var(--rule); background: var(--plate); }
  .custom .cards { display: flex; flex-wrap: wrap; gap: .4rem; flex: 1; }
  .panel { border: 1px solid var(--rule); background: var(--plate); padding: 1rem 1.2rem 1.1rem; min-width: 0; display: flex; flex-direction: column; gap: .8rem; }
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
  .eprog { display: flex; max-width: 24rem; }
  .stages { list-style: none; margin: .1rem 0 .2rem; padding: 0; display: grid; gap: .3rem; font-size: .85rem; }
  .stages li { display: flex; gap: .55rem; align-items: baseline; }
  .stages .sn { color: var(--gold); font-size: .75rem; }
  .stages li > :global(.mi) { align-self: center; color: var(--platinum-dim); }
  .stages .nt { display: grid; }
  .stages .mod { font-size: .75rem; color: var(--platinum-dim); }
  .srl { list-style: none; margin: 0 0 .2rem; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr)); gap: .15rem 1rem; font-size: .8rem; }
  .srl li { display: flex; justify-content: space-between; gap: .5rem; }
  /* Fresh from the last read, or older (the last read failed): the line says which, on hover why. */
  .upd.old { color: var(--alert); }
  .st-joy { color: var(--cycle-warm); }
  .st-anger { color: var(--mood-anger); }
  .st-envy { color: var(--mood-envy); }
  .st-sorrow { color: var(--mood-sorrow); }
  .st-fear { color: var(--mood-fear); }
  .fromgame { margin: 0; }
  /* The same 7 + 5 split as the rows above, so the panel edges line up down the page. */
  .mastery { grid-column: span 7; grid-row: span 2; }
  .baro { grid-column: span 5; }
  .world { position: relative; grid-column: span 12; display: grid; grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr)); gap: 0; padding: 0 1.9rem 0 0; }
  .clock { display: flex; gap: .6rem; align-items: center; padding: .8rem 1rem; border-left: 1px solid var(--rule); min-width: 0; }
  .clock:first-child { border-left: 0; }
  .clock > div { display: grid; gap: .2rem; min-width: 0; }
  .clock .register { font-size: 11px; }
  .clock b { font-size: 1.15rem; }
  .st-day, .st-warm, .st-fass { color: var(--cycle-warm); }
  .st-night, .st-cold, .st-vome { color: var(--cycle-cold); }
  .st-corpus { color: var(--faction-corpus); }
  .st-grineer { color: var(--faction-grineer); }
  .clock.reset b { color: var(--platinum); }
  /* …and slimmer columns, so all eight share a row where seven otherwise would, leaving one alone. */
  .world:has(> .clock:nth-child(8)) { grid-template-columns: repeat(auto-fit, minmax(7.4rem, 1fr)); }
  /* Eight clocks to a row: a reset's icon moves up beside its name, leaving room for the time. */
  .rk-sm { display: none; margin-right: .3rem; vertical-align: -1px; }
  .world:has(> .clock:nth-child(8)) .clock.reset > .rk { display: none; }
  .world:has(> .clock:nth-child(8)) .rk-sm { display: inline-flex; }
  .world:has(> .clock:nth-child(8)) .clock { padding-left: .7rem; padding-right: .6rem; gap: .5rem; }
  .rk { display: inline-flex; width: 22px; justify-content: center; opacity: .85; }
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
  .paslot { display: inline-flex; min-width: 0; }
  .addfold { min-width: 0; }
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
  .alertlist { display: flex; flex-wrap: wrap; align-items: center; gap: .35rem .6rem; margin-top: .7rem; padding-top: .6rem; border-top: 1px solid var(--rule); }
  .pa { display: inline-flex; align-items: center; gap: .3rem; padding: .05rem .1rem .05rem .45rem; border: 1px solid var(--gold-dim); font-size: .8rem; }
  .live { margin: .6rem 0 0; color: var(--platinum-deep); display: flex; align-items: center; gap: .45rem; }
  .live:empty { display: none; }
  .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--verdigris); box-shadow: 0 0 0 3px color-mix(in srgb, var(--verdigris) 25%, transparent); }
  .varzia { grid-column: span 5; }
  /* Narrower: the clocks keep their icons and drop their names to stay on one row. */
  /* Page area under 1100 px (App sets the flag, by the room pages actually have). */
  :global(html[data-room~="lt1100"]) .clock { padding: .7rem .75rem; }
  /* The names stay (two "Night" clocks told apart only by their icons won't do), shortened. */
  :global(html[data-room~="lt1100"]) .clock :global(.gi) { width: 22px; height: 22px; }
  :global(html[data-room~="lt1100"]) .rk { width: auto; }
  :global(html[data-room~="lt1100"]) .clock .lft { display: none; }
  /* Page area under 930 px (App sets the flag, by the room pages actually have). */
  /* Under 1100 px, four to a row, two rows: never seven on one and the last alone on the next. */
  :global(html[data-room~="lt1100"]) .world, :global(html[data-room~="lt1100"]) .world:has(> .clock:nth-child(8)) { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  :global(html[data-room~="lt1100"]) .clock:nth-child(4n + 1) { border-left: 0; }
  :global(html[data-room~="lt1100"]) .clock:nth-child(n + 5) { border-top: 1px solid var(--rule); }
  :global(html[data-room~="lt930"]) .clock { padding: .6rem .55rem; }
  /* Page area under 900 px (App sets the flag, by the room pages actually have). */
  :global(html[data-room~="lt900"]) .market, :global(html[data-room~="lt900"]) .ready, :global(html[data-room~="lt900"]) .fissures, :global(html[data-room~="lt900"]) .mastery, :global(html[data-room~="lt900"]) .baro, :global(html[data-room~="lt900"]) .varzia, :global(html[data-room~="lt900"]) .today, :global(html[data-room~="lt900"]) .foundry, :global(html[data-room~="lt900"]) .deals, :global(html[data-room~="lt900"]) .wishes , :global(html[data-room~="lt900"]) .panel.half { grid-column: span 12; }
  /* Half a small screen: the clocks go four to a row. */
  :global(html[data-room~="lt760"]) .world { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  :global(html[data-room~="lt760"]) .clock:nth-child(4n + 1) { border-left: 0; }
  :global(html[data-room~="lt760"]) .clock:nth-child(n + 5) { border-top: 1px solid var(--rule); }
  .tgrid { display: grid; gap: .9rem; }
  .tblock { display: grid; gap: .35rem; }
  .start { margin: 0 0 var(--step); padding: .8rem 1rem; border: 1px solid var(--rule-bright); border-left: 2px solid var(--gold); background: var(--plate); }
  .start header { display: flex; align-items: baseline; gap: .8rem; margin-bottom: .5rem; }
  .start header .link { margin-left: auto; }
  .start ol { list-style: none; margin: 0; padding: 0; display: grid; gap: .35rem; }
  .start li { display: flex; align-items: center; gap: .6rem; flex-wrap: wrap; }
  .start li.done .link { color: var(--platinum-deep); text-decoration: line-through; }
  .th { display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; }
  /* The chore tick at the end of each heading: an empty box, a green tick once done. */
  /* A chore's box (Tick: the check draws in as you tick it), at the row's end. */
  .tick { margin-left: auto; flex: none; display: inline-flex; }
  .th.done .mark { color: var(--platinum-deep); text-decoration: line-through; text-decoration-color: color-mix(in srgb, var(--verdigris) 70%, transparent); }
  .chorecount { margin: -.2rem 0 .6rem; }
  .archx { list-style: none; margin: .25rem 0 0; padding: 0; display: grid; gap: .2rem; }
  .archx .hard { color: var(--alert); }
  .archx sup { font-size: .6rem; margin-left: .05rem; }
  .nwd { display: block; font-size: .74rem; line-height: 1.3; white-space: normal; }
  .nw li .nt { white-space: normal; }
  .th b { font-size: 1rem; }
  .th.sub { margin-top: .2rem; }
  .tline { margin: 0; }
  /* The Archon Hunt's three missions, in order, each its glyph and node. */
  .arch span { display: inline-flex; align-items: center; gap: .3rem; }
  .archon { list-style: none; padding: 0; display: flex; flex-wrap: wrap; gap: .2rem .9rem; }
  .archon li { display: inline-flex; align-items: center; gap: .3rem; }
  .archon li + li::before { content: "→"; margin-right: .5rem; color: var(--rule-control); }
  .tline b { color: var(--platinum); font-weight: 600; }
  .chips { display: flex; flex-wrap: wrap; gap: .35rem; }
  .pick { display: inline-flex; align-items: center; gap: .4rem; padding: .2rem .55rem .2rem .25rem; border: 1px solid var(--rule); font-size: .82rem; color: var(--platinum-dim); }
  .pick.want { border-color: var(--gold-dim); color: var(--platinum); }
  .pick em, em.want { font-style: normal; display: inline-flex; font-size: .78rem; font-weight: 700; color: var(--verdigris); margin-left: .25rem; }
  .inl { display: inline-flex; align-items: center; gap: .3rem; flex-wrap: wrap; }
  .nw { list-style: none; margin: 0; padding: 0; display: grid; gap: .25rem; }
  .nw li { display: grid; grid-template-columns: 4.2rem 1fr auto; gap: .5rem; align-items: center; font-size: .84rem; }
  .k { font-family: var(--face-register); font-size: .72rem; letter-spacing: .1em; text-transform: uppercase; color: var(--platinum-deep); }
  .k-elite { color: var(--platinum); font-weight: 600; }
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
  .pr { display: inline-flex; align-items: center; gap: .4rem; }

  .ph { display: flex; justify-content: space-between; align-items: center; gap: 1rem; padding-bottom: .6rem; border-bottom: 1px solid var(--rule); }
  .pt { display: inline-flex; align-items: center; gap: .55rem; }
  .pt .register { color: var(--platinum); font-size: 11px; }
  .ph .link { font-size: .78rem; }
  .ph > .pt + :global(.helpmark) { margin-left: auto; }

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
  /* all: unset drops the outline every other button has: put it back, beside the gold edge. */
  .levelrow:focus-visible { border-color: var(--gold); outline: 1px solid var(--select); outline-offset: 2px; }
  .levelrow:active { background: var(--well); }
  .levelrow > span:nth-child(2) { display: grid; min-width: 0; }
  .levelrow .small { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pts.big { font-family: var(--face-mark); font-size: 1.3rem; color: var(--platinum); }
  .figs { display: grid; grid-template-columns: repeat(auto-fit, minmax(5.2rem, 1fr)); gap: .8rem; }
  .figs > div { display: grid; grid-template-rows: 1.75rem auto; gap: .3rem; align-content: start; align-items: center; }
  .figs > div :global(.amt b) { font-size: 1.5rem; }
  .figs b.mark { font-size: 1.5rem; line-height: 1; }
  .figs b.amber { color: var(--alert); }
  .figs .register { font-size: 11px; color: var(--platinum-deep); }
  .mini { list-style: none; margin: 0; padding: 0; display: grid; gap: .3rem; }
  .mini li { display: flex; align-items: center; gap: .6rem; }
  .amber { color: var(--alert); }

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
  .stock li { display: grid; grid-template-columns: 24px minmax(0, 1fr) auto 4rem 3rem; gap: .6rem; align-items: center; }
  .stock.flips li { grid-template-columns: minmax(0, 1fr) auto 3.5rem 3rem; }
  .stock .cr { display: inline-flex; align-items: center; gap: .2rem; justify-self: end; white-space: nowrap; }
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
  /* One tile a place, as many across as the panel has room for (three, then two, then one). */
  .bsum { list-style: none; margin: .6rem 0 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); gap: .5rem; }
  .bsum li { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: baseline; column-gap: .6rem; row-gap: .15rem; min-width: 0; padding: .55rem .8rem .6rem; background: var(--well); border: 1px solid var(--rule); }
  .bsum li b { grid-column: 1 / -1; font-weight: 600; color: var(--platinum-dim); font-size: .8rem; }
  .bsum li span:not(.dim) { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fold { display: block; margin: .6rem 0 0; }
  .today:not(.open) .tblock > :not(.th) { display: none; }
  /* Everything: the lines that were folded away fade up as they show (--quick, motion.ts). */
  .today.open:global([data-fresh]) .tblock > :not(.th) { animation: today-in var(--quick) var(--out); }
  @keyframes today-in { from { opacity: 0; transform: translateY(4px); } }
  /* Every bounty: the boards keep the panel's spacing. */
  .bboard { display: flex; flex-direction: column; gap: .8rem; min-width: 0; }
  .today:not(.open) .tgrid { gap: .45rem; }
</style>
