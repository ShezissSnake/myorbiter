<script lang="ts">
  import type { Model } from "../core/model";
  import type { MissionState } from "../core/types";
  import { squadPool, squadRelics, type SquadRelic } from "../core/views";
  import P from "../ui/P.svelte";
  import Thumb from "../ui/Thumb.svelte";
  import PageHead from "../ui/PageHead.svelte";
  import Stat from "../ui/Stat.svelte";
  import Avail from "../ui/Avail.svelte";
  import ListButton from "../ui/ListButton.svelte";
  import { bestCard, defaultPickWeights, resolveName, scoreCards, type PickCard, type PickWeights } from "../core/pick";
  import { onWindows, type ScreenCards } from "../backend";
  import { info } from "../hover.svelte";

  let {
    model,
    // Called `ms` here: a local `state` would clash with the $state rune.
    state: ms,
    error,
    cards = null,
    weights = $bindable(),
    windowMode = null,
    tennoscopeRunning = true,
  }: { model: Model; state: MissionState | null; error: string | null; cards?: ScreenCards | null; weights: PickWeights; windowMode?: string | null; tennoscopeRunning?: boolean } = $props();

  const live = $derived(!!ms && ms.relics.length > 0);
  const paths = $derived(ms ? (ms.relics.length ? ms.relics : ms.last_relics) : []);
  const relics = $derived(squadRelics(model, paths));
  const pool = $derived(squadPool(relics));
  const best = $derived(pool.reduce<(typeof pool)[number] | null>((b, r) => (r.price != null && (b == null || r.price > (b.price ?? 0)) ? r : b), null));
  const needed = $derived(pool.filter((r) => r.needed));
  /** On Windows nothing draws over exclusive fullscreen: TennoScope's overlay can't show. */
  const fullscreenBlocks = $derived(onWindows && windowMode === "MODE_FULLSCREEN");
  /** The reward screen is up but no cards came: why, as far as orbiter can tell. */
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
  const ranked = $derived(scoreCards(model, pool.map((x) => x.name), weights).map((c, i) => ({ ...c, from: pool[i].from, owned: pool[i].owned })).sort((a, b) => b.score - a.score || (b.price ?? 0) - (a.price ?? 0)));
  /** Your own relic's reward, which the log names as soon as the screen opens. */
  const yours = $derived(new Set((ms?.reward_screen_open ? ms.rewards_given : []).map((p) => resolveName(model, model.nameOf(p)))));
  const WEIGHTS: { k: keyof PickWeights; label: string; title: string; bar: string }[] = [
    { k: "plat", bar: "b-plat", label: "Plat", title: "Market price, as a share of the best card on the screen" },
    { k: "needed", bar: "b-need", label: "Unmastered", title: "A part for something you haven't mastered or built, that you don't have yet" },
    { k: "ducats", bar: "b-ducat", label: "Ducats", title: "Ducat value, out of 100" },
    { k: "set", bar: "b-set", label: "Complete set", title: "Finishes a set (half for leaving it one part short)" },
  ];
  // At least one weight stays above 0: with all four at 0 every card would score 0.
  let weightNote = $state<string | null>(null);
  function setWeight(k: keyof PickWeights, el: HTMLSelectElement) {
    const n = Number(el.value);
    if (n === 0 && WEIGHTS.every((w) => w.k === k || weights[w.k] === 0)) {
      el.value = String(weights[k]);
      weightNote = "Keep at least one weight above 0.";
      return;
    }
    weightNote = null;
    weights = { ...weights, [k]: n };
  }
  const DEFAULT_WEIGHTS = defaultPickWeights();
  const isDefault = $derived(WEIGHTS.every((w) => weights[w.k] === DEFAULT_WEIGHTS[w.k]));
  function resetWeights() {
    weights = defaultPickWeights();
    weightNote = null;
  }
  /** "Meso C10 R" (a relic and its refinement's letter) → the relic, for its hover card. */
  const relicOf = (from: string) => from.replace(/ [IEFR]$/, "");
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
  const clock = (h: { started_at: number | null; uptime: number }) =>
    h.started_at != null
      ? new Date(h.started_at * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
      : `+${Math.round(h.uptime / 60)} min`;
  // The Held column only when you hold any of them.
  const anyHeld = $derived(ranked.some((x) => x.owned > 0));
</script>

{#snippet bars(c: PickCard)}
  <span class="bars" title="Plat {Math.round(c.marks.plat * 100)} · unmastered {c.marks.needed * 100} · ducats {Math.round(c.marks.ducats * 100)} · set {c.marks.set * 100}">
    <i class="b-plat" style:--v={c.marks.plat}></i><i class="b-need" style:--v={c.marks.needed}></i><i class="b-ducat" style:--v={c.marks.ducats}></i><i class="b-set" style:--v={c.marks.set}></i>
  </span>
{/snippet}

{#snippet weightControls()}
  <div class="weights">
    <span class="register" title="The score is the weighted average of the four bars, 0–100">Score weights</span>
    {#each WEIGHTS as w (w.k)}
      <label title={w.title}><i class="sw {w.bar}"></i><span>{w.label}</span>
        <select value={weights[w.k]} onchange={(e) => setWeight(w.k, e.currentTarget)}>{#each [0, 1, 2, 3, 4, 5, 6, 8, 10] as n (n)}<option value={n}>{n}</option>{/each}</select>
      </label>
    {/each}
    {#if !isDefault}<button class="link" title="Back to plat 8, unmastered 4, ducats 2, set 1" onclick={resetWeights}>Reset</button>{/if}
    {#if weightNote}<span class="small warn-text">{weightNote}</span>{/if}
  </div>
{/snippet}

{#snippet relicCard(r: SquadRelic)}
  <article class="relic" class:vaulted={r.status === "vaulted"}>
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
          <li class:need={x.needed} use:info={x.name}>
            <Thumb file={model.imageOf(x.name)} size={22} />
            <span class="nmw"><span class="nm" class:done={!x.needed && x.parentMastered}>{x.name}</span>{#if x.needed}<span class="tag warn">need</span>{/if}</span>
            <span class="pc"><P v={x.price} /></span>
            <span class="pc"><P v={x.ducats} d dim /></span>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="dim small">This relic isn't in TennoScope's relic data, so its rewards can't be shown.</p>
    {/if}
  </article>
{/snippet}

<div class="page"><div class="page-inner">
  {#snippet stats()}
      <Stat label="Status" tone={live ? "gold" : "dim"} note={error ?? (ms ? (ms.reward_screen_open ? "Reward screen open" : live ? `${relics.length} relic${relics.length === 1 ? "" : "s"} in the squad` : paths.length ? "Last fissure round" : "Waiting for a fissure") : "EE.log not found; set it in Settings")}>
        {ms ? (live ? "Live" : "Ready") : "Idle"}
      </Stat>
      <Stat label="Most valuable" hover={best?.name ?? null} note={best?.name ?? "No fissure yet"}><P v={best?.price} big /></Stat>
      <Stat label="You need" tone={needed.length ? "gold" : "dim"} note={needed.map((n) => n.name).join(", ") || "Nothing on the table"}>{needed.length}</Stat>
      <Stat label="Earned this session" note={`Relic rewards you got · ${history.length} mission${history.length === 1 ? "" : "s"}${fissureCount ? ` · ${fissureCount} fissure${fissureCount === 1 ? "" : "s"}` : ""}`}><P v={sessionValue || null} big /></Stat>
  {/snippet}
  <PageHead
    title={ms?.reward_screen_open || onScreen ? "Choose a reward" : "In mission"}
    blurb={ms?.mission ? ms.mission : "The squad's relics and rewards, once a void fissure loads."}
    band={onScreen ? undefined : stats}
  />

  {#if noCardsWhy}<p class="why dim small">{noCardsWhy}</p>
  {:else if fullscreenBlocks}<p class="why dim small" title="Warframe's display mode, from its settings file">Warframe is in exclusive fullscreen, where TennoScope's overlay can't show: set Display Mode to Borderless in its options.</p>{/if}
  {#if onScreen}
    <section class="pick" aria-label="Which reward to take">
      <div class="pick-head">
        <h2 class="mark">Take {pick != null ? onScreen[pick].name : "—"}</h2>
        <span class="dim small">Cards read by TennoScope at {readAt(cards!.at)} · the same pick is marked on its overlay</span>
      </div>
      <div class="slips">
        {#each onScreen as c, i (i + c.name)}
          <article class="slip" class:best={i === pick} class:yours={yours.has(c.name)}>
            <div class="register lot">Choice {i + 1}{#if i === pick}<span class="take">Take this</span>{/if}{#if yours.has(c.name)}<span class="tag">your relic</span>{/if}</div>
            <div class="slip-name" use:info={c.name}><Thumb file={model.imageOf(c.name)} size={34} /><span>{c.name}</span></div>
            <div class="score"><strong>{c.score}</strong>{@render bars(c)}</div>
            <div class="why small">{c.reasons.join(" · ") || "Nothing it's worth to you"}</div>
          </article>
        {/each}
      </div>
      {@render weightControls()}
    </section>
  {/if}

  {#if relics.length}
    {#if ranked.length}
      <div class="pool-head">
        <h2 class="register">{onScreen ? "Everything the squad's relics can drop" : "Possible rewards, best pick first"}</h2>
        {#if !onScreen}<span class="dim small" title="Plat is scored against the most valuable drop on this list; on the reward screen it's scored against the four cards, so close calls can change. With the patched TennoScope, orbiter reads your four cards and picks for you (see the Guide).">On the reward screen, your card highest here is the likely pick.</span>{/if}
      </div>
      {#if !onScreen}{@render weightControls()}{/if}
      <table class="pool">
        <thead><tr><th title="Its place in the pick order, best first">#</th>{#if !onScreen}<th class="right" title="0–100: the weighted average of the four bars">Score</th><th class="bc" title="The four marks behind the score: plat · unmastered · ducats · completes a set">Score split</th>{/if}<th>Reward</th><th title="The squad relics that can give it. The letter after each is its refinement: I intact, E exceptional, F flawless, R radiant">From</th>{#if anyHeld}<th class="right" title="Copies you already hold">Held</th>{/if}<th class="right">Plat</th><th class="right">Ducats</th></tr></thead>
        <tbody>
          {#each ranked as x, i (x.name)}
            <tr class:need={x.needed} class:yours={yours.has(x.name)}>
              <td class="rank">{i + 1}</td>
              {#if !onScreen}
                <td class="sc">{x.score}</td>
                <td class="bc">{@render bars(x)}</td>
              {/if}
              <td><div class="rw"><span class="rw-name" use:info={x.name}><Thumb file={model.imageOf(x.name)} size={24} /><span>{x.name}</span></span>{#if yours.has(x.name)}<span class="tag">your relic gave this</span>{/if}{#if x.needed}<span class="tag warn">need</span>{/if}{#if x.set === 1}<span class="tag ok">completes set</span>{/if}</div></td>
              <td class="dim small from">{#each x.from as f, j (j)}{j ? ", " : ""}<span use:info={relicOf(f)}>{f}</span>{/each}</td>
              {#if anyHeld}<td class="dim right">{x.owned || ""}</td>{/if}
              <td class="right"><P v={x.price} /></td>
              <td class="right"><P v={x.ducats || null} d dim /></td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}

    <h2 class="register">The squad's relics</h2>
    <section class="cards">{#each relics as r, i (r.path + i)}{@render relicCard(r)}{/each}</section>
  {:else if !onScreen}
    <div class="empty" class:compact={history.length > 0}>
      <p>Start a void fissure and the squad's relics show up here as the mission loads. Warframe writes them to its log, and orbiter only reads that file.</p>
      <p class="dim small">The relic picker before a mission isn't logged by the game, so the vaulted tags for choosing a relic are on <strong>Relics</strong>.</p>
    </div>
  {/if}

  {#if history.length}
    <h2 class="register">This session{sessionRewards ? ` · ${sessionRewards} relic reward${sessionRewards === 1 ? "" : "s"}` : ""}</h2>
    <table class="pool history">
      <tbody>
        {#each history as h, i (h.uptime + "-" + i)}
          <tr class:current={i === 0}>
            <td class="dim time">{clock(h)}</td>
            <td><span>{h.name}</span>{#if i === 0}<span class="tag ok">now</span>{/if}</td>
            <td class="dim small">
              {#if h.relics.length}{h.relics.length} relic{h.relics.length === 1 ? "" : "s"}{h.rounds ? ` · ${h.rounds} round${h.rounds === 1 ? "" : "s"}` : ""}{/if}
            </td>
            <td class="small">{#each h.rewardsNamed as x, j (j)}<span class="got" use:info={x.name}><Thumb file={model.imageOf(x.name)} size={20} />{x.name}{#if model.price(x.name) != null}<ListButton {model} name={x.name} hint="Put it on warframe.market" />{/if}</span>{/each}</td>
            <td class="right">{#if h.value}<P v={h.value} />{/if}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div></div>

<style>
  h2 { margin: var(--course) 0 .6rem; }
  /* A squad is at most four: 2×2 or one row of four, never three and a stray. */
  .why { margin: 0 0 var(--step); }
  .cards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0; border-top: 1px solid var(--rule); border-left: 1px solid var(--rule); margin-top: var(--step); }
  .relic { border-right: 1px solid var(--rule); border-bottom: 1px solid var(--rule); padding: 1rem 1.1rem 1.1rem; background: rgb(17 19 23 / 70%); }
  /* Page area under 640 px (App sets the flag, by the room pages actually have). */
  :global(html[data-room~="lt640"]) .cards { grid-template-columns: minmax(0, 1fr); }
  /* The bars behind the score go before the list stops fitting: the score itself stays. */
  :global(html[data-room~="lt760"]) .pool .bc { display: none; }
  /* Page area 1850 or wider px (App sets the flag, by the room pages actually have). */
  :global(html[data-room~="ge1850"]) .cards { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .relic header { display: flex; justify-content: space-between; align-items: center; gap: .8rem; margin-bottom: .8rem; }
  .who { display: flex; align-items: center; gap: .8rem; min-width: 0; }
  .who .grow { display: grid; gap: .3rem; min-width: 0; }
  .sub { display: flex; flex-wrap: wrap; gap: 0 .45rem; }
  .sub > span { white-space: nowrap; }
  .sub > span + span::before { content: "·"; margin-right: .45rem; }
  h3 { margin: 0; font-family: var(--face-mark); font-weight: 700; font-size: 1.45rem; text-transform: uppercase; letter-spacing: -.01em; line-height: 1; }
  .ref { font-family: var(--face-register); font-size: .6rem; font-weight: 600; letter-spacing: .12em; text-transform: uppercase; padding: .1rem .4rem; border: 1px solid var(--rule-bright); color: var(--platinum-dim); vertical-align: 4px; margin-left: .3rem; }
  .ref-Radiant { color: var(--gold); border-color: var(--gold-dim); }
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: .3rem; }
  li { display: grid; grid-template-columns: 22px 1fr 3.6rem 3.6rem; align-items: center; gap: .6rem; font-size: .84rem; }
  li.need .nm { color: var(--gold); font-weight: 600; }
  .nm { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .nmw { display: flex; align-items: center; min-width: 0; }
  .pc { text-align: right; }
  .pool { border-collapse: collapse; width: 100%; border-top: 1px solid var(--rule); }
  .nm.done { color: var(--platinum-deep); }
  .pool { font-variant-numeric: tabular-nums; }
  .pool th { position: sticky; top: 0; z-index: 1; background: var(--slab); text-align: left; font-family: var(--face-register); font-weight: 500; font-size: .6rem; letter-spacing: .15em; text-transform: uppercase; color: var(--platinum-deep); padding: .55rem .6rem; border-bottom: 1px solid var(--rule); }
  .pool th:first-child { padding-left: 0; }
  .pool th.right { text-align: right; }
  .pool td { padding: .45rem .6rem; border-bottom: 1px solid var(--rule); font-size: .84rem; }
  .pool td:first-child { padding-left: 0; }
  .pool tr.need .rw-name { color: var(--gold); font-weight: 600; }
  .right { text-align: right; }
  .pick { margin-top: var(--step); border: 1px solid var(--rule-bright); background: var(--plate); padding: 1.1rem 1.3rem 1rem; display: grid; gap: .9rem; }
  .pick-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: .4rem 1.2rem; }
  .pick h2 { font-size: 2rem; margin: 0; color: var(--gold); }
  /* Up to four cards: one row of four, or two by two, never three and a stray. */
  .slips { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: .7rem; }
  :global(html[data-room~="lt950"]) .slips { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .slip { border: 1px solid var(--rule); padding: .8rem .9rem; display: grid; gap: .5rem; align-content: start; background: rgb(11 12 15 / 60%); }
  .slip.best { border-color: var(--gold); box-shadow: inset 0 3px 0 var(--gold); }
  .slip.yours { outline: 1px dashed var(--rule-bright); outline-offset: -4px; }
  .lot { display: flex; align-items: center; gap: .5rem; }
  .take { background: var(--gold); color: var(--slab); padding: .1rem .45rem; letter-spacing: .12em; }
  .slip-name { display: flex; align-items: center; gap: .55rem; font-family: var(--face-mark); font-weight: 700; font-size: 1.1rem; text-transform: uppercase; line-height: 1.05; }
  .score { display: flex; align-items: center; gap: .7rem; }
  .score strong { font-family: var(--face-mark); font-size: 2.2rem; line-height: 1; color: var(--platinum); }
  .slip.best .score strong { color: var(--gold); }
  .why { color: var(--platinum-dim); }
  .bars { display: inline-grid; grid-template-columns: repeat(4, 1.1rem); gap: 3px; align-items: end; height: 1.4rem; }
  .bars i { display: block; height: calc(max(var(--v), .04) * 100%); background: var(--platinum-deep); }
  .bars .b-plat { background: var(--platinum); }
  .bars .b-need { background: var(--gold); }
  .bars .b-ducat { background: repeating-linear-gradient(135deg, var(--gold-dim) 0 2px, transparent 2px 4px); box-shadow: inset 0 0 0 1px var(--gold-dim); }
  .bars .b-set { background: var(--verdigris); }
  .weights { display: flex; flex-wrap: wrap; align-items: center; gap: .4rem 1rem; font-size: .8rem; color: var(--platinum-dim); }
  .weights label { display: inline-flex; align-items: center; gap: .4rem; }
  .weights select { padding: .3rem 1.5rem .3rem .5rem; background-position: right .45rem center; min-width: 3.4rem; min-height: 28px; }
  .sw { display: inline-block; width: .55rem; height: .55rem; }
  .sw.b-plat { background: var(--platinum); }
  .sw.b-need { background: var(--gold); }
  .sw.b-ducat { background: repeating-linear-gradient(135deg, var(--gold-dim) 0 2px, transparent 2px 4px); box-shadow: inset 0 0 0 1px var(--gold-dim); }
  .sw.b-set { background: var(--verdigris); }
  .pool-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: .3rem 1rem; margin: var(--course) 0 .6rem; }
  .pool-head h2 { margin: 0; }
  .pool .rank { width: 2rem; color: var(--platinum-deep); font-family: var(--face-register); font-size: .66rem; }
  .pool .sc { width: 2.6rem; text-align: right; font-family: var(--face-mark); font-size: 1.15rem; }
  .pool .bc { width: 5.6rem; }
  .pool tr.yours td { background: var(--plate); }
  .history .time { width: 6rem; white-space: nowrap; font-family: var(--face-register); font-size: .66rem; letter-spacing: .08em; color: var(--platinum-deep); }
  .history tr.current td { background: var(--plate); }
  .got { display: inline-flex; align-items: center; gap: .4rem; margin-right: 1.1rem; }
  .rw { display: flex; align-items: center; }
  .rw-name { display: inline-flex; align-items: center; gap: .5rem; }
  .from span:hover { color: var(--platinum); }
  .empty { margin-top: var(--step); max-width: 46rem; padding: 1.4rem 1.6rem; border: 1px solid var(--rule); background: rgb(17 19 23 / 70%); }
  .empty.compact p:last-child { display: none; }
</style>
