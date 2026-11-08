<script lang="ts">
  import { eraTint } from "../ui/table";
  import type { Model } from "../core/model";
  import type { MissionState } from "../core/types";
  import { squadPool, squadRelics, yourRelicIndex, type SquadRelic } from "../core/views";
  import P from "../ui/P.svelte";
  import Thumb from "../ui/Thumb.svelte";
  import GameIcon, { relicIcon as refIcon, type GameIconName } from "../ui/GameIcon.svelte";
  import { nearTraceCap, traceCap, voidTraces } from "../core/traces";
  import PageHead from "../ui/PageHead.svelte";
  import Stat from "../ui/Stat.svelte";
  import Avail from "../ui/Avail.svelte";
  import ListButton from "../ui/ListButton.svelte";
  import { shareCheck } from "../core/radshare";
  import { bestCard, resolveName, scoreCards, type PickCard, type PickWeights, type WeightKey } from "../core/pick";
  import { onWindows, type ScreenCards } from "../backend";
  import { info } from "../hover.svelte";
  import { inFissure } from "../core/mission";
  import CopyButton from "../ui/CopyButton.svelte";
  import Art from "../ui/Art.svelte";
  import { arrive, reveal } from "../motion";

  // The score weights are set in Settings → Fissures (something you set once, not look at in a
  // fissure): here they're only named, with the way there.
  let {
    model,
    // Called `ms` here: a local `state` would clash with the $state rune.
    state: ms,
    error,
    cards = null,
    weights = $bindable(),
    windowMode = null,
    tennoscopeRunning = true,
    onsettings = null,
    masteryRank = null,
  }: { model: Model; masteryRank?: number | null; state: MissionState | null; error: string | null; cards?: ScreenCards | null; weights: PickWeights; windowMode?: string | null; tennoscopeRunning?: boolean; onsettings?: (() => void) | null } = $props();

  // Relics loaded, and the log heard from lately: a squad from hours ago is the last fissure, not this one.
  let liveNow = $state(Date.now());
  $effect(() => {
    const t = setInterval(() => (liveNow = Date.now()), 60_000);
    return () => clearInterval(t);
  });
  const live = $derived(inFissure(ms, liveNow));
  const paths = $derived(ms ? (ms.relics.length ? ms.relics : ms.last_relics) : []);
  const relics = $derived(squadRelics(model, paths));
  const pool = $derived(squadPool(relics));
  /** The reward the log says you got from these relics (the screen's, or the last round's): it names your relic. */
  const gotReward = $derived.by(() => {
    const p = ms?.reward_screen_open && ms.rewards_given.length ? ms.rewards_given.at(-1) : [...(ms?.history ?? [])].reverse().find((h) => h.relics.length && h.relics.join("|") === paths.join("|"))?.rewards.at(-1);
    return p ? resolveName(model, model.nameOf(p)) : null;
  });
  /** Which of the four is your own relic, when only one of them drops what you got. */
  const mine = $derived(yourRelicIndex(relics, gotReward));
  /** With four relics: whether they're a 4b4 (one relic, one refinement), and which are off if not. */
  // A relic MyOrbiter can't name gets a placeholder ("Meso relic"): four of those aren't known to match.
  const share = $derived(relics.every((r) => r.known) ? shareCheck(relics) : null);
  const best = $derived(pool.reduce<(typeof pool)[number] | null>((b, r) => (r.price != null && (b == null || r.price > (b.price ?? 0)) ? r : b), null));
  const needed = $derived(pool.filter((r) => r.needed));
  /** On Windows nothing draws over exclusive fullscreen: TennoScope's overlay can't show. */
  const fullscreenBlocks = $derived(onWindows && windowMode === "MODE_FULLSCREEN");
  /** The reward screen is up but no cards came: why, as far as MyOrbiter can tell. */
  const noCardsWhy = $derived(
    !ms?.reward_screen_open || cards
      ? null
      : relics.length === 1
        ? "Solo: one card, so nothing to choose and no overlay."
        : !tennoscopeRunning
          ? "TennoScope isn't running, so nothing reads the cards."
          : fullscreenBlocks
            ? "Warframe is in exclusive fullscreen: set Display Mode to Borderless for the overlay."
            : "TennoScope hasn't read this screen (it started mid-mission, or couldn't read the cards). Your best card is the highest below.",
  );

  // Which reward to take. With TennoScope's reading of the screen: exactly those cards, in screen
  // order. Without it: everything the squad's relics can drop, best first, to find yours in.
  const onScreen = $derived(cards ? scoreCards(model, cards.cards, weights, cards.prices) : null);
  const pick = $derived(onScreen ? bestCard(onScreen) : null);
  const ranked = $derived(scoreCards(model, pool.map((x) => x.name), weights).map((c, i) => ({ ...c, from: pool[i].from, owned: pool[i].owned, rarity: pool[i].rarity })).sort((a, b) => b.score - a.score || (b.price ?? 0) - (a.price ?? 0)));
  /** Your own relic's reward, which the log names as soon as the screen opens. */
  const yours = $derived(new Set((ms?.reward_screen_open ? ms.rewards_given : []).map((p) => resolveName(model, model.nameOf(p)))));
  const WEIGHTS: { k: WeightKey; label: string; title: string; bar: string }[] = [
    { k: "plat", bar: "b-plat", label: "Plat", title: "Market price, as a share of the best card on the screen" },
    { k: "needed", bar: "b-need", label: "Unmastered", title: "A part for something you haven't mastered or built, that you don't have yet" },
    { k: "ducats", bar: "b-ducat", label: "Ducats", title: "Ducat value, out of 100" },
    { k: "set", bar: "b-set", label: "Complete set", title: "Finishes a set (half for leaving it one part short)" },
  ];
  // The cards with their prices, for squad chat ("Saryn Prime Systems 15p | Forma Blueprint | …").
  const chatLine = $derived((onScreen ?? []).map((c) => `${c.name}${c.price != null && !c.priceIsYours ? ` ${Math.round(c.price)}p` : ""}${c.ducats ? ` (${c.ducats} ducats)` : ""}`).join(" | "));
  /** "Meso C10 R" (a relic and its refinement's letter) → the relic, for its hover card. */
  const relicOf = (from: string) => from.replace(/ [IEFR]$/, "");
  /** The pick order shows its top few; the rest, and each relic's own table, a click away. */
  const TOP = 6;
  let showAll = $state(false);
  let showRelics = $state(false);
  /** "Meso C10 R" → the Meso relic as it looks at that refinement. */
  const REF_OF: Record<string, string> = { I: "intact", E: "exceptional", F: "flawless", R: "radiant" };
  const relicIcon = (from: string): GameIconName | null => refIcon(from.split(" ")[0] ?? "", REF_OF[from.slice(-1)] ?? "intact");
  /** When TennoScope read the cards: a time of day, which can't go stale the way "n s ago" would. */
  const readAt = (at: number) => new Date(at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  // This session's missions, newest first, with the relic rewards you got.
  const history = $derived(
    [...(ms?.history ?? [])].reverse().map((h) => {
      const rewards = h.rewards.map((p) => {
        const name = model.nameOf(p);
        return { name, price: model.price(name) };
      });
      return { ...h, rewardsNamed: rewards, value: rewards.reduce((n, x) => n + (x.price ?? 0), 0) };
    }),
  );
  const fissureCount = $derived(history.filter((h) => h.relics.length).length);
  const sessionValue = $derived(history.reduce((n, h) => n + h.value, 0));
  const sessionRewards = $derived(history.reduce((n, h) => n + h.rewards.length, 0));
  // The session at a glance: what the rewards come to in ducats, which go toward gear you haven't
  // built, and the Void Traces you're at (the cracks bring more, up to the cap).
  const sessionGot = $derived(history.flatMap((h) => h.rewardsNamed));
  const sessionDucats = $derived(sessionGot.reduce((n, x) => n + (model.partByName.get(x.name)?.[0]?.ducats ?? 0), 0));
  const sessionForGear = $derived(
    sessionGot.filter((x) => {
      const part = model.partByName.get(x.name)?.[0];
      return !!part && !model.isMastered(part.parentUnique) && model.owned(part.parentUnique) === 0;
    }),
  );
  const traces = $derived(voidTraces(model));
  const cap = $derived(traceCap(masteryRank));
  const clock = (h: { started_at: number | null; uptime: number }) =>
    h.started_at != null
      ? new Date(h.started_at * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
      : `+${Math.round(h.uptime / 60)} min`;
  /** A reward's rarity, as the squad's relics give it (the card's bar along the bottom edge). */
  const rarityOf = (name: string): string | null => pool.find((x) => x.name === name)?.rarity ?? model.sourcesByReward.get(name)?.[0]?.rarity ?? null;
  /** The four places of the reward screen while there are no cards: the squad's relics, or four empty slots. */
  const SLOT_ERAS = ["lith", "meso", "neo", "axi"];
  // The Held column only when you hold any of them.
  const anyHeld = $derived(ranked.some((x) => x.owned > 0));
</script>

{#snippet bars(c: PickCard)}
  <span class="bars" title="Plat {Math.round(c.marks.plat * 100)} · unmastered {c.marks.needed * 100} · ducats {Math.round(c.marks.ducats * 100)} · set {c.marks.set * 100}">
    <i class="b-plat" style:--v={c.marks.plat}></i><i class="b-need" style:--v={c.marks.needed}></i><i class="b-ducat" style:--v={c.marks.ducats}></i><i class="b-set" style:--v={c.marks.set}></i>
  </span>
{/snippet}

{#snippet weightControls()}
  <p class="weights dim small">
    <span class="legend" title="The score is the weighted average of the four bars, 0–100; each bar's colour is one of these">Scored by (how much each counts) {#each WEIGHTS.filter((w) => weights[w.k] > 0) as w, i (w.k)}{#if i}{" · "}{/if}<span class="lg"><i class="sw {w.bar}"></i>{w.label.toLowerCase()} {weights[w.k]}</span>{/each}</span>
    {#if onsettings}<button class="link" title="Set how much plat, unmastered parts, ducats and sets count, in Settings → Fissures" onclick={onsettings}>Change in Settings</button>{/if}
  </p>
{/snippet}

{#snippet relicCard(r: SquadRelic)}
  <article class="relic" class:era-wash={!!eraTint(r.name)} style:--tint={eraTint(r.name)} class:vaulted={r.status === "vaulted"}>
    <header>
      <div class="who" use:info={r.known ? r.name : null}>
        <Thumb file={model.imageOf(r.name)} size={44} />
        <div class="grow">
          <h3>{r.name} <span class="ref ref-{r.refinement}">{r.refinement}</span></h3>
          <div class="dim small sub">
            <span>{r.youOwn ? `You hold ${r.youOwn}` : r.ownOther ? `None ${r.refinement.toLowerCase()}; you hold ${r.ownOther} at other refinements` : "Not in your inventory"}</span>
            {#if r.ev != null}<span>avg <P v={r.ev} /> a crack</span>{/if}
          </div>
        </div>
      </div>
      {#if r.known}<Avail v={r.status} />{/if}
    </header>
    {#if r.known}
      <ul>
        {#each r.rewards as x (x.name)}
          <li class="rar-{x.rarity}" class:need={x.needed} use:info={x.name}>
            <Thumb file={model.imageOf(x.name)} size={22} />
            <span class="nmw"><span class="nm" class:done={!x.needed && x.parentMastered}>{x.name}</span>{#if x.needed}<span class="tag warn">need</span>{/if}</span>
            <span class="pc"><P v={x.price} /></span>
            <span class="pc dc" title="{x.rarity ? `${x.rarity}: ` : ''}ducats at Baro's kiosks"><P v={x.ducats} d dim /></span>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="dim small">This relic isn't in TennoScope's relic data, so its rewards can't be shown.</p>
    {/if}
  </article>
{/snippet}

{#snippet rewardCard(c: PickCard, i: number)}
  {@const rar = rarityOf(c.name)}
  {@const best = i === pick}
  <article class="rc rar-{rar}" class:best class:yours={yours.has(c.name)} aria-label="Choice {i + 1}: {c.name}{best ? ', take this' : ''}">
    <div class="rc-top">{#if best}<span class="take" title="The best card for you: highest score of the four ({c.score})">Take this</span>{:else}<span class="register lot">Choice {i + 1}</span>{/if}</div>
    <div class="rc-art" use:info={c.name}><Art file={model.imageOf(c.name)} size={136} fallback={/Blueprint$/.test(c.name) ? "foundry" : null} /></div>
    <h3 class="rc-name" title={c.name}>{c.name}</h3>
    <div class="rc-val">
      {#if c.price != null}<span title={c.priceIsYours ? "What a Forma Blueprint is worth to you (Settings → Fissures)" : cards?.prices?.[c.name] != null ? "Its price on warframe.market, as TennoScope's overlay shows it" : "Its daily median on warframe.market"}><P v={c.price} /></span>{:else}<span class="dim small" title="Not traded on warframe.market">no price</span>{/if}
      {#if c.ducats}<span title="Ducats at Baro's kiosks"><P v={c.ducats} d /></span>{/if}
    </div>
    <div class="rc-marks">
      {#if yours.has(c.name)}<span class="tag" title="The game's log names this as your own relic's reward">your relic</span>{/if}
      {#if c.needed}<span class="tag warn" title="A part for {c.neededFor}, which you haven't built or mastered, and you don't have enough of it">need · {c.neededFor}</span>{/if}
      {#if c.set === 1}<span class="tag good" title="The last part you're missing for a {c.setName} set">completes set</span>{:else if c.set}<span class="tag good" title="Leaves your {c.setName} set one part short">set · one short</span>{/if}
    </div>
    <div class="rc-foot">
      <span class="rar" title={rar ? `A ${rar.toLowerCase()} reward` : "Rarity unknown"}>{rar ?? "–"}</span>
      <span class="rc-score" title={`Its score, 0–100, from plat, unmastered, ducats and sets: ${c.reasons.join(" · ") || "nothing it's worth to you"}`}>{@render bars(c)}<b>{c.score}</b></span>
    </div>
  </article>
{/snippet}

{#snippet screen()}
  <section class="screen" aria-label={onScreen ? "The reward screen" : "The reward screen, before it opens"}>
    {#if onScreen}
      <div class="row" class:few={onScreen.length < 4} style:--n={onScreen.length}>{#each onScreen as c, i (i + c.name)}{@render rewardCard(c, i)}{/each}</div>
      <div class="screen-foot">
        <span class="dim small">Read by TennoScope at {readAt(cards!.at)} · the same pick is marked on its overlay</span>
        <CopyButton text={chatLine} label="Copy for squad chat" title="Copy the four cards with their prices, to paste in squad chat: {chatLine}" />
      </div>
      {@render weightControls()}
    {:else if relics.length}
      <div class="row">
        {#each relics as r, i (r.path + i)}
          {@const icon = refIcon(r.name.split(" ")[0] ?? "", r.refinement)}
          <div class="rc slot relic-slot" style:--tint={eraTint(r.name)} use:info={r.known ? r.name : null}>
            <div class="rc-top">{#if i === mine}<span class="register lot mine" title="Your own relic: the reward the game's log says you got ({gotReward}) drops only from this one">Your relic</span>{:else}<span class="register lot" title="A relic someone in the squad brought. It cracks into one reward card when the reward screen opens">Relic {i + 1}</span>{/if}</div>
            <div class="rc-art">{#if icon}<GameIcon name={icon} size={84} />{:else}<GameIcon name="void-tear" size={64} />{/if}</div>
            <h3 class="rc-name">{r.name}</h3>
            <span class="register ref-word">{r.refinement}</span>
          </div>
        {/each}
      </div>
      <p class="screen-foot dim small">{ms?.reward_screen_open ? "The reward screen is open." : live ? "Each relic cracks into one reward here when the reward screen opens: with the patched TennoScope, the cards stand here and the one to take is lit." : "Your squad's relics from the last fissure. The next fissure's replace them as it loads."}
        <!-- Under the relics it's about: whether they're all one relic at one refinement. -->
        {#if share}<span class="share" class:off={!share.matched} title={share.matched ? "4×4 (a 4b4): all four players brought the same relic at the same refinement, so the four reward cards are four rolls on one table" : `4×4 (a 4b4) is all four players bringing the same relic at the same refinement. ${share.allDiffer ? "Each of the squad brought a different relic or refinement" : `Most of the squad brought ${share.main}; the odd ones out (${share.off.join(", ")}) roll on a different table`}`}>{share.text}</span>{/if}</p>
    {:else}
      <div class="row">
        {#each SLOT_ERAS as e, i (e)}
          <div class="rc slot empty-slot">
            <div class="rc-top"><span class="register lot">Choice {i + 1}</span></div>
            <div class="rc-art"><GameIcon name={refIcon(e)!} size={64} /></div>
            <span class="slot-word">A squad member's reward</span>
          </div>
        {/each}
      </div>
      <p class="screen-foot dim small">When a void fissure's reward screen opens, its four rewards stand here, the one to take lit.</p>
    {/if}
  </section>
{/snippet}

<div class="page"><div class="page-inner">
  {#snippet stats()}
      <Stat keep label="Status" tone={live ? "gold" : "dim"} note={error ?? (ms ? (ms.reward_screen_open ? "Reward screen open" : live ? `${relics.length} relic${relics.length === 1 ? "" : "s"} in the squad` : paths.length ? "Last fissure round" : "Waiting for a fissure") : "EE.log not found; set it in Settings")}>
        {ms ? (live ? "Live" : "Ready") : "Idle"}
      </Stat>
      <Stat label="Most valuable" hover={best?.name ?? null} note={best?.name ?? "No fissure yet"}><P v={best?.price} big /></Stat>
      <Stat keep label="You need" tone={needed.length ? "gold" : "dim"} note={needed.map((n) => n.name).join(", ") || "Nothing on the table"}>{needed.length}</Stat>
      <Stat label="Earned this session" note={`Relic rewards you got · ${history.length} mission${history.length === 1 ? "" : "s"}${fissureCount ? ` · ${fissureCount} fissure${fissureCount === 1 ? "" : "s"}` : ""}`}><P v={sessionValue || null} big /></Stat>
  {/snippet}
  <PageHead
    title={ms?.reward_screen_open || onScreen ? "Choose a reward" : "Current fissure"}
    brief={ms?.mission && (live || ms.reward_screen_open) ? ms.mission : live || paths.length ? "The squad's relics and rewards." : "Not in a fissure right now."}
    blurb={ms?.mission && (live || ms.reward_screen_open) ? ms.mission : live || paths.length ? "The squad's relics and rewards." : "Not in a fissure. The squad's relics and rewards show here once a void fissure loads; other missions have nothing to pick."}
    band={onScreen ? undefined : stats}
    hero={screen}
  />

  {#if noCardsWhy}<p class="why dim small">{noCardsWhy}</p>
  {:else if fullscreenBlocks}<p class="why dim small" title="Warframe's display mode, from its settings file">Warframe is in exclusive fullscreen, where TennoScope's overlay can't show: set Display Mode to Borderless in its options.</p>{/if}

  {#if relics.length}
    {#if ranked.length}
      <div class="pool-head">
        <h2 class="register">{onScreen ? "Everything the squad's relics can drop" : "Possible rewards, best pick first"}</h2>
        {#if !onScreen}<span class="dim small" title="Plat is scored against the most valuable drop on this list; on the reward screen it's scored against the four cards, so close calls can change. With the patched TennoScope, MyOrbiter reads your four cards and picks for you (see the Guide).">On the reward screen, your card highest here is the likely pick.</span>{/if}
      </div>
      {#if !onScreen}{@render weightControls()}{/if}
      <table class="pool">
        <thead><tr><th title="Its place in the pick order, best first">#</th>{#if !onScreen}<th class="right" title="0–100: the weighted average of the four bars">Score</th><th class="bc" title="The four marks behind the score: plat · unmastered · ducats · completes a set">Score split</th>{/if}<th>Reward</th><th title="The squad relics that can give it. The letter after each is its refinement: I intact, E exceptional, F flawless, R radiant">From</th>{#if anyHeld}<th class="right" title="Copies you already hold">Held</th>{/if}<th class="right">Plat</th><th class="right">Ducats</th></tr></thead>
        <tbody>
          {#each showAll ? ranked : ranked.slice(0, TOP) as x, i (x.name)}
            <tr class="rar-{x.rarity}" class:need={x.needed} class:yours={yours.has(x.name)} in:arrive>
              <td class="rank" title={x.rarity ? `${x.rarity} reward` : undefined}>{i + 1}</td>
              {#if !onScreen}
                <td class="sc">{x.score}</td>
                <td class="bc">{@render bars(x)}</td>
              {/if}
              <td><div class="rw"><span class="rw-name" use:info={x.name}><Thumb file={model.imageOf(x.name)} size={24} /><span>{x.name}</span></span>{#if yours.has(x.name)}<span class="tag">your relic gave this</span>{/if}{#if x.needed}<span class="tag warn">need</span>{/if}{#if x.set === 1}<span class="tag good">completes set</span>{/if}</div></td>
              <td class="dim small from">{#each x.from as f, j (j)}{j ? ", " : ""}<span class="rl" style:--tint={eraTint(f)} use:info={relicOf(f)}>{#if relicIcon(f)}<GameIcon name={relicIcon(f)!} size={14} />{/if}{f}</span>{/each}</td>
              {#if anyHeld}<td class="dim right">{x.owned || ""}</td>{/if}
              <td class="right"><P v={x.price} /></td>
              <td class="right dc" title={x.rarity && x.ducats ? `${x.rarity}: ducats at Baro's kiosks` : undefined}><P v={x.ducats || null} d dim /></td>
            </tr>
          {/each}
        </tbody>
      </table>
      {#if ranked.length > TOP}<button class="link more" onclick={() => (showAll = !showAll)} title="Every reward the squad's relics can drop, in pick order">{showAll ? `Show the top ${TOP}` : `Show all ${ranked.length}`}</button>{/if}
    {/if}

    <!-- Each relic's own rewards, a click away: the list above already says what to take. -->
    <h2 class="register relhead"><button class="link" aria-expanded={showRelics} onclick={() => (showRelics = !showRelics)} title="Each relic in the squad with its rewards and odds"><span class="chev side" aria-hidden="true">▸</span> The squad's relics · {relics.length}</button>{#if showRelics}<span class="legend">Gold: a part you still need · dimmed: you've mastered what it builds · the edge: its rarity (bronze common, silver uncommon, gold rare)</span>{/if}</h2>
    {#if showRelics}<div class="reveal" transition:reveal><div><section class="cards">{#each relics as r, i (r.path + i)}{@render relicCard(r)}{/each}</section></div></div>{/if}
  {:else if !onScreen}
    <div class="empty" class:compact={history.length > 0}>
      <p>Start a void fissure and the squad's relics show up here as the mission loads. Warframe writes them to its log, and MyOrbiter only reads that file.</p>
      <p class="dim small">The relic picker before a mission isn't logged by the game, so the vaulted tags for choosing a relic are on <strong>Relics</strong>.</p>
    </div>
  {/if}

  {#if history.length}
    <h2 class="register">This session{sessionRewards ? ` · ${sessionRewards} relic reward${sessionRewards === 1 ? "" : "s"}` : ""}</h2>
    <p class="sum small">
      <span>{history.length} mission{history.length === 1 ? "" : "s"}{fissureCount ? ` · ${fissureCount} fissure${fissureCount === 1 ? "" : "s"}` : ""}</span>
      {#if sessionValue}<span title="What the rewards you took sell for, at daily median prices"><P v={sessionValue} /></span>{/if}
      {#if sessionDucats}<span title="What they'd fetch from Baro, in ducats"><GameIcon name="ducats" size={13} />{sessionDucats.toLocaleString("en")}</span>{/if}
      {#if sessionForGear.length}<span class="gold" title={`Parts of gear you haven't built or mastered: ${sessionForGear.map((x) => x.name).join(", ")}`}>{sessionForGear.length} toward gear you haven't built</span>{/if}
      <span class="dim" class:near={nearTraceCap(traces, cap)} title="Void Traces you hold (as of the last inventory read) and the most you can: past the cap, a crack's traces are lost"><GameIcon name="void-traces" size={13} />{traces.toLocaleString("en")}{cap != null ? ` / ${cap.toLocaleString("en")}` : ""} traces{nearTraceCap(traces, cap) ? " · near the cap: refine some" : ""}</span>
    </p>
    <table class="pool history">
      <thead><tr><th>Time</th><th>Mission</th><th>Relics</th><th>Rewards</th><th class="right" title="What the rewards are worth on warframe.market">Plat</th></tr></thead>
      <tbody>
        {#each history as h, i (h.uptime + "-" + i)}
          <tr class:current={i === 0}>
            <td class="dim time">{clock(h)}</td>
            <td><span>{h.name}</span>{#if i === 0 && live}<span class="tag ok">now</span>{/if}</td>
            <td class="dim small">
              {#if h.relics.length}{h.relics.length} relic{h.relics.length === 1 ? "" : "s"}{h.rounds ? ` · ${h.rounds} round${h.rounds === 1 ? "" : "s"}` : ""}{/if}
            </td>
            <td class="small">{#each h.rewardsNamed as x, j (j)}<span class="got" use:info={x.name}><Thumb file={model.imageOf(x.name)} size={20} />{x.name}{#if model.price(x.name) != null}<ListButton {model} name={x.name} labelled hint="Put it on warframe.market" />{/if}</span>{/each}</td>
            <td class="right">{#if h.value}<P v={h.value} />{/if}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div></div>

<style>
  h2 { margin: var(--course) 0 .6rem; }
  .sum { display: flex; flex-wrap: wrap; align-items: center; gap: .3rem 1.1rem; margin: -.2rem 0 .6rem; }
  .sum > span { display: inline-flex; align-items: center; gap: .3rem; }
  .sum .gold { color: var(--gold); }
  .sum .near { color: var(--alert); }
  /* A squad is at most four: 2×2 or one row of four, never three and a stray. */
  .why { margin: 0 0 var(--step); }
  .cards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0; border-top: 1px solid var(--rule); border-left: 1px solid var(--rule); margin-top: var(--step); }
  .relic { border-right: 1px solid var(--rule); border-bottom: 1px solid var(--rule); padding: 1rem 1.1rem 1.1rem; background: rgb(20 23 27 / 70%); }
  .relic.era-wash { background: var(--era-bg); }
  /* Page area under 640 px (App sets the flag, by the room pages actually have). */
  :global(html[data-room~="lt640"]) .cards { grid-template-columns: minmax(0, 1fr); }
  /* The bars behind the score go before the list stops fitting: the score itself stays. */
  :global(html[data-room~="lt760"]) .pool .bc { display: none; }
  :global(html[data-room~="lt760"]) .from .rl :global(.gi) { display: none; }
  /* Page area 1850 or wider px (App sets the flag, by the room pages actually have). */
  :global(html[data-room~="ge1850"]) .cards { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .relic header { display: flex; justify-content: space-between; align-items: center; gap: .8rem; margin-bottom: .8rem; }
  .who { display: flex; align-items: center; gap: .8rem; min-width: 0; flex: 1; }
  .who .grow { display: grid; gap: .3rem; min-width: 0; flex: 1 1 0; }
  .relic header > :global(:last-child:not(.who)) { flex: none; }
  /* One line each, cut short with an ellipsis rather than running under the badge beside it. */
  .sub { display: grid; gap: .1rem; min-width: 0; }
  .sub > span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  h3 { margin: 0; font-family: var(--face-mark); font-weight: 700; font-size: 1.45rem; text-transform: uppercase; letter-spacing: -.01em; line-height: 1; }
  .ref { font-family: var(--face-register); font-size: .72rem; font-weight: 600; letter-spacing: .12em; text-transform: uppercase; padding: .1rem .4rem; border: 1px solid var(--rule-bright); color: var(--platinum-dim); vertical-align: 4px; margin-left: .3rem; }
  .ref-Radiant { color: var(--platinum); border-color: var(--platinum-dim); }
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: .3rem; }
  li { display: grid; grid-template-columns: 22px 1fr 3.6rem 3.6rem; align-items: center; gap: .6rem; font-size: .84rem; padding-left: .45rem; box-shadow: inset 2px 0 0 var(--rar, var(--rule)); }
  /* A reward's rarity: the edge on its row, and its ducats in the same metal. */
  .rar-Common { --rar: var(--rarity-common); }
  .rar-Uncommon { --rar: var(--rarity-uncommon); }
  .rar-Rare { --rar: var(--rarity-rare); }
  .dc :global(.amt b) { color: color-mix(in srgb, var(--rar, var(--gold-dim)) 85%, var(--slab)); }
  li.need .nm { color: var(--gold); font-weight: 600; }
  .nm { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .nmw { display: flex; align-items: center; min-width: 0; }
  .pc { text-align: right; }
  .pool { border-collapse: collapse; width: 100%; border-top: 1px solid var(--rule); }
  .nm.done { color: var(--platinum-deep); }
  .legend { margin-left: .8rem; font-family: var(--face-text); letter-spacing: normal; text-transform: none; font-size: .74rem; color: var(--platinum-deep); }
  .pool { font-variant-numeric: tabular-nums; }
  .pool th { position: sticky; top: 0; z-index: 1; background: var(--slab); text-align: left; font-family: var(--face-register); font-weight: 500; font-size: .72rem; letter-spacing: .15em; text-transform: uppercase; color: var(--platinum-deep); padding: .55rem .6rem; border-bottom: 1px solid var(--rule); }
  .pool th:first-child { padding-left: .5rem; }
  .pool th.right { text-align: right; }
  .pool td { padding: var(--row-pad) .6rem; border-bottom: 1px solid var(--rule); font-size: .84rem; }
  .pool td:first-child { padding-left: 0; }
  .pool tr.need .rw-name { color: var(--gold); font-weight: 600; }
  .right { text-align: right; }
  .why { color: var(--platinum-dim); }
  /* The reward screen, as the game draws it: the cards side by side, each item's art large, its
     rarity a bar along the bottom edge. The one to take glows with the Void. */
  .screen { display: grid; gap: .7rem; }
  /* Always in quarters across the page, as the figures below are: a solo screen's one card keeps its place. */
  .row { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: .8rem; }
  :global(html[data-room~="lt640"]) .row { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  /* On a narrow window, fewer than four cards share the width rather than each keeping a quarter. */
  :global(html[data-room~="lt1100"]) .row.few { grid-template-columns: repeat(var(--n), minmax(0, 15rem)); }
  :global(html[data-room~="lt640"]) .row.few { grid-template-columns: repeat(min(var(--n), 2), minmax(0, 15rem)); }
  .rc {
    --rar: var(--rule-bright);
    /* One column that may be narrower than its art: the art and the bar shrink to it instead of
       pushing the card wider than its quarter. */
    position: relative; display: grid; grid-template-columns: minmax(0, 1fr); grid-template-rows: auto auto auto auto 1fr auto; justify-items: center; text-align: center; gap: .45rem;
    min-height: 19rem; padding: .7rem .8rem 0; border: 1px solid var(--rule); border-bottom: 0;
    background: linear-gradient(180deg, rgb(11 12 15 / 40%), var(--well));
    box-shadow: inset 0 -4px 0 var(--rar);
  }
  .rc.rar-Common { --rar: var(--rarity-common); }
  .rc.rar-Uncommon { --rar: var(--rarity-uncommon); }
  .rc.rar-Rare { --rar: var(--rarity-rare); }
  .rc-top { min-height: 1.3rem; display: flex; align-items: center; justify-content: center; }
  .lot { font-size: .58rem; color: var(--platinum-deep); }
  .lot.mine { color: var(--sec); }
  .rc-art { display: flex; align-items: center; justify-content: center; width: 100%; height: 8.8rem; }
  .rc-art :global(.art) { max-width: 100%; }
  .rc-name {
    margin: 0; font-family: var(--face-mark); font-weight: 700; font-size: 1.05rem; line-height: 1.08; text-transform: uppercase; letter-spacing: .005em;
    display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; min-height: 2.2em;
  }
  .rc-val { display: flex; align-items: center; justify-content: center; gap: .9rem; }
  .rc-val :global(.amt b) { font-size: 1.15rem; }
  .rc-marks { align-self: start; display: flex; flex-wrap: wrap; justify-content: center; align-content: start; gap: .3rem; min-height: 1.3rem; }
  .rc-marks .tag { margin: 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* Out to the card's edges through its padding: negative margins on a stretched item, which every
     engine places the same way (a wider centred item overflows to one side in WebKitGTK). */
  .rc-foot { align-self: end; justify-self: stretch; margin-inline: -.8rem; min-width: 0; display: flex; align-items: center; justify-content: space-between; gap: .4rem; padding: .45rem .8rem .7rem; border-top: 1px solid var(--rule); }
  .rar { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--face-register); font-size: .72rem; letter-spacing: .14em; text-transform: uppercase; color: var(--rar); }
  .rc-score { display: inline-flex; align-items: center; gap: .5rem; }
  .rc-score b { font-family: var(--face-mark); font-size: 1.2rem; line-height: 1; color: var(--platinum-dim); font-variant-numeric: tabular-nums; }
  .rc-score .bars { height: 1rem; grid-template-columns: repeat(4, .55rem); gap: 2px; }
  /* The pick: lit by the Void, the frame in the section's violet, a glow that breathes. */
  .rc.best { border-color: var(--sec); background: radial-gradient(ellipse 70% 45% at 50% 42%, color-mix(in srgb, var(--sec) 22%, transparent), transparent 70%), linear-gradient(180deg, rgb(11 12 15 / 40%), var(--well)); }
  /* The frame and a tight glow stay; the wide glow over it breathes by its opacity alone, which the
     compositor runs without redrawing the card (a breathing box-shadow repainted it every frame
     for as long as the page was open). */
  .rc.best::before, .rc.best::after { content: ""; position: absolute; inset: -1px -1px 0; pointer-events: none; }
  .rc.best::before { box-shadow: 0 0 0 1px var(--sec), 0 0 18px -8px var(--sec); }
  .rc.best::after { box-shadow: 0 0 34px -6px var(--sec); animation: void-breathe 3.2s ease-in-out infinite; }
  @keyframes void-breathe { 50% { opacity: 0; } }
  @media (prefers-reduced-motion: reduce) { .rc.best::after { animation: none; } }
  .rc.best .rc-score b { color: var(--sec); }
  .take { font-family: var(--face-register); font-size: .74rem; font-weight: 600; letter-spacing: .16em; text-transform: uppercase; color: var(--slab); background: var(--sec); padding: .18rem .6rem; }
  .rc.yours { outline: 1px dashed var(--rule-bright); outline-offset: -5px; }
  /* Before the cards: the squad's relics in their places, or four empty places. */
  .slot { min-height: 0; padding-bottom: .9rem; grid-template-rows: auto 1fr auto auto; border-bottom: 1px solid var(--rule); box-shadow: none; }
  .relic-slot { box-shadow: inset 0 -3px 0 color-mix(in srgb, var(--tint, var(--sec)) 70%, transparent); }
  .relic-slot .rc-name { min-height: 0; color: color-mix(in srgb, var(--tint, var(--platinum)) 75%, var(--platinum)); }
  .ref-word { font-size: .58rem; color: var(--platinum-deep); }
  .empty-slot { border-style: dashed; border-color: var(--rule-bright); background: none; }
  .slot .rc-art { height: 6.5rem; }
  .empty-slot .rc-art :global(.gi) { opacity: .3; filter: saturate(.4); }
  .slot-word { font-size: .76rem; color: var(--platinum-deep); }
  .screen-foot { display: flex; flex-wrap: wrap; align-items: center; gap: .4rem 1.2rem; margin: 0; }
  .bars { display: inline-grid; grid-template-columns: repeat(4, 1.1rem); gap: 3px; align-items: end; height: 1.4rem; }
  .bars i { display: block; height: calc(max(var(--v), .04) * 100%); background: var(--platinum-deep); }
  .bars .b-plat { background: var(--platinum); }
  .bars .b-need { background: var(--verdigris); }
  .bars .b-ducat { background: repeating-linear-gradient(135deg, var(--gold-dim) 0 2px, transparent 2px 4px); box-shadow: inset 0 0 0 1px var(--gold-dim); }
  /* A set: hollow verdigris, so it reads apart from the solid unmastered bar. */
  .bars .b-set { background: color-mix(in srgb, var(--verdigris) 22%, transparent); box-shadow: inset 0 0 0 1px var(--verdigris); }
  .weights { display: flex; flex-wrap: wrap; align-items: center; gap: .3rem 1rem; margin: 0; }
  .sw { display: inline-block; width: .55rem; height: .55rem; margin-right: .3rem; }
  .lg { white-space: nowrap; }
  .sw.b-plat { background: var(--platinum); }
  .sw.b-need { background: var(--verdigris); }
  .sw.b-ducat { background: repeating-linear-gradient(135deg, var(--gold-dim) 0 2px, transparent 2px 4px); box-shadow: inset 0 0 0 1px var(--gold-dim); }
  .sw.b-set { background: color-mix(in srgb, var(--verdigris) 22%, transparent); box-shadow: inset 0 0 0 1px var(--verdigris); }
  .share { color: var(--platinum-dim); }
  .share.off { color: var(--alert); }
  .pool-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: .3rem 1rem; margin: var(--course) 0 .6rem; }
  .pool-head h2 { margin: 0; }
  .pool .rank { width: 2rem; color: var(--platinum-deep); font-family: var(--face-figures); font-size: .66rem; }
  .pool:not(.history) .rank { padding-left: .5rem; box-shadow: inset 3px 0 0 var(--rar, transparent); }
  .pool .sc { width: 2.6rem; text-align: right; font-family: var(--face-mark); font-size: 1.15rem; }
  .pool .bc { width: 5.6rem; }
  .pool tr.yours td { background: var(--plate); }
  .history .time { width: 6rem; white-space: nowrap; font-family: var(--face-figures); font-size: .66rem; letter-spacing: .08em; color: var(--platinum-deep); }
  .history tr.current td { background: var(--plate); }
  .history th:first-child { padding-left: 0; }
  .got { display: inline-flex; align-items: center; gap: .4rem; margin-right: 1.1rem; }
  .rw { display: flex; align-items: center; }
  .rw-name { display: inline-flex; align-items: center; gap: .5rem; }
  .from span:hover { color: var(--platinum); }
  /* A relic's name stays whole ("Meso C10 R"); two relics may wrap between them. */
  .from span { white-space: nowrap; }
  /* Each relic in its era's colour, as on the fissure board. */
  .from .rl { display: inline-flex; align-items: center; gap: .25rem; color: color-mix(in srgb, var(--tint, var(--platinum-dim)) 80%, var(--platinum)); }
  .empty { margin-top: var(--step); max-width: 46rem; padding: 1.4rem 1.6rem; border: 1px solid var(--rule); background: rgb(20 23 27 / 70%); }
  .empty.compact p:last-child { display: none; }
  /* Details off: the score's make-up and the weights go to hover (the Score keeps it in its title). */
  :global(html:not([data-details])) .pool .bc, :global(html:not([data-details])) .weights { display: none; }
  .more { display: block; margin: .5rem 0 0; }
  .relhead .link { font: inherit; letter-spacing: inherit; text-transform: inherit; padding: 0; color: var(--platinum-dim); }
  .relhead .link:hover { color: var(--gold); }
</style>
