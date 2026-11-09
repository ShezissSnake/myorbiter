<script lang="ts">
  import { mkt } from "../marketStore.svelte";
  // The things you starred, and the quickest way to each missing part: crack a relic you hold
  // (lit when a fissure of its era is open right now), farm a relic that still drops, or buy it.
  import { ERAS, type Model } from "../core/model";
  import type { Settings } from "../backend";
  import { openEras, wishItem, wishlistEras, type FarmSpot, type WishItem } from "../core/wishlist";
  import { details } from "../details.svelte";
  import { info } from "../hover.svelte";
  import { placeName } from "../core/describe";
  import { until } from "../core/traders";
  import PageHead from "../ui/PageHead.svelte";
  import Stat from "../ui/Stat.svelte";
  import Art from "../ui/Art.svelte";
  import PartChip from "../ui/PartChip.svelte";
  import P from "../ui/P.svelte";
  import GameIcon, { eraIcon, type GameIconName } from "../ui/GameIcon.svelte";
  import { eraTint } from "../ui/table";
  import Icon from "../ui/Icon.svelte";
  import IconButton from "../ui/IconButton.svelte";
  import UndoSlot from "../ui/UndoSlot.svelte";
  import { UndoSlots } from "../undo.svelte";
  import CodexRings from "../ui/CodexRings.svelte";
  import { codexRings, starredBy } from "../core/codex";
  import type { Group } from "../core/collection";
  import { arrive, calm, flip, leave, pulse, reveal } from "../motion";
  import Count from "../ui/Count.svelte";
  import { whileShown } from "../pane.svelte";
  import { inView, progressive } from "../progress.svelte";
  import { untrack } from "svelte";

  let { model, settings = $bindable(), go = null }: { model: Model; settings: Settings; go?: ((to: string) => void) | null } = $props();

  let now = $state(Date.now());
  $effect(() => {
    const t = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(t);
  });

  const items = $derived.by(whileShown("wishlist", () => settings.favourites.map((u) => wishItem(model, u)).filter((w): w is WishItem => !!w)));
  // Taking something off the wishlist waits a few seconds, with Undo, before it's done.
  const undo = new UndoSlots();
  $effect(() => () => undo.flush());
  // What stays on the list: something taken off is counted no more while its Undo runs (the band,
  // the rings' stars, the relics to crack), though its card keeps its place until the time is up.
  const starred = $derived(settings.favourites.filter((u) => !undo.has(u)));
  const staying = $derived(items.filter((w) => !undo.has(w.c.unique)));
  // A card that comes in a later slice (below) was on the list already, and comes in as it is: only
  // one new to the list arrives (motion.ts, arrive). Worked out before the slices are.
  let listed = new Set(untrack(() => items.map((w) => w.c.unique)));
  let fresh = new Set<string>();
  $effect.pre(() => {
    const keys = items.map((w) => w.c.unique);
    untrack(() => {
      fresh = new Set(keys.filter((k) => !listed.has(k)));
      listed = new Set(keys);
    });
  });
  const arriveNew = (node: Element, unique: string) => (fresh.has(unique) ? arrive(node) : { duration: 0 });
  // The cards in sight drawn at once, the rest a few at a time after (lib/progress.svelte.ts): each
  // card is a table of parts, relics and drops, and thirty of them at once held up the page's opening.
  let listBox = $state<HTMLElement | null>(null);
  const listView = inView(() => listBox, { min: 3, guess: 240 });
  const drawn = $derived.by(progressive(() => items, (w) => w.c.unique, { first: listView.count, step: 3, measure: listView.measure, hidden: listView.hidden, onShow: listView.onShow }));
  const open = $derived(openEras(model.live.fissures, now));
  const byEra = $derived.by(whileShown("wishlist", () => wishlistEras(model, starred)));
  // Every era with relics (Omnia fissures take any of them).
  // Eras with a fissure open now where a relic you hold drops something you want (Omnia takes any).
  const crackIn = (eras: Map<string, ReturnType<typeof byEra.get> & {}>) =>
    ERAS.map((e) => ({ era: e, fissures: [...(open[e] ?? []), ...(open.Omnia ?? [])], relics: eras.get(e) ?? [] })).filter((x) => x.relics.length && x.fissures.length);
  const crackNow = $derived(crackIn(byEra));
  // The cards keep their place while an Undo runs, as the item cards do (the band's figures above
  // leave the item out at once): from everything still starred, Undo pending or not.
  const byEraShown = $derived.by(whileShown("wishlist", () => wishlistEras(model, settings.favourites)));
  const crackCards = $derived(crackIn(byEraShown));
  const missingCount = $derived(staying.reduce((n, w) => n + w.missing.length, 0));
  const relicsHeld = $derived(new Set([...byEra.values()].flat().map((x) => x.relic)).size);

  // Adding by name.
  let adding = $state("");
  const names = $derived(
    [...model.catalogByUnique.values()].filter((c) => c.masterable && !c.excludeFromCodex && ["Warframes", "Primary", "Secondary", "Melee", "Sentinels", "Pets", "Archwing", "Arch-Gun", "Arch-Melee", "Misc"].includes(c.category)),
  );
  /**
   * The field's suggestions, drawn the first time it's focused: hundreds of options drawn with the
   * page made its first open slower, for a list most visits never open.
   */
  let namesWanted = $state(false);
  /** Each name once for the list (a few items share one). */
  const listNames = $derived([...new Set(names.map((c) => c.name))].sort((a, b) => a.localeCompare(b)));
  // Of items that share a name, the one already starred.
  const pick = $derived.by(() => {
    const same = names.filter((c) => c.name.toLowerCase() === adding.trim().toLowerCase());
    return same.find((c) => settings.favourites.includes(c.uniqueName)) ?? same[0] ?? null;
  });
  const already = $derived(!!pick && settings.favourites.includes(pick.uniqueName));
  // What you just added: its card comes in with a gold edge for a second, and is brought into view.
  let added = $state<string | null>(null);
  let addedTimer: ReturnType<typeof setTimeout> | undefined;
  function add() {
    if (!pick || already) return;
    const u = pick.uniqueName;
    settings.favourites = [u, ...settings.favourites];
    adding = "";
    added = u;
    clearTimeout(addedTimer);
    addedTimer = setTimeout(() => added === u && (added = null), 1100);
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`.wish[data-unique="${CSS.escape(u)}"]`)?.scrollIntoView({ block: "nearest", behavior: calm.current ? "auto" : "smooth" }));
  }
  const remove = (u: string) => undo.hold(u, () => (settings.favourites = settings.favourites.filter((x) => x !== u)));
  const pct = (x: number) => (x >= 0.995 ? "99%+" : x < 0.005 && x > 0 ? "<1%" : `${Math.round(x * 100)}%`);
  /** Missing parts that come from relics, but none you hold. */
  const uncovered = (w: WishItem) => w.missing.filter((p) => !p.yours.length && model.sourcesByReward.get(p.name)?.length).length;
  /** The best farm spots, one heading per relic. */
  function farmByRelic(spots: FarmSpot[]) {
    const out: { relic: string; spots: FarmSpot[] }[] = [];
    for (const f of spots.slice(0, 2)) {
      const g = out.find((x) => x.relic === f.relic);
      if (g) g.spots.push(f);
      else out.push({ relic: f.relic, spots: [f] });
    }
    return out;
  }
  // The rings: mastered of all in each category, as on Mastery and Foundry, each marked with how
  // many you starred in it. A click goes to the first of those, or, with none starred there, to
  // Foundry's not-mastered ones in that category, where you star them.
  const rings = $derived.by(whileShown("wishlist", () => codexRings(model)));
  const marks = $derived.by(whileShown("wishlist", () => starredBy(model, starred)));
  const pickRing = (g: Group) => (marks[g] ? jump(g) : go?.(`foundry?group=${g}&show=todo`));
  /**
   * A ring's click: to the first thing you starred in that category, which flashes gold (motion.ts,
   * pulse) so you see which it is: at once when it's already on screen, else once the scroll lands.
   * The All ring (g null): the first thing on the list.
   */
  function jump(g: Group | null) {
    const el = document.querySelector<HTMLElement>(g ? `.wish[data-groups~="${g}"]` : ".wish[data-unique]");
    if (!el) return;
    el.querySelector<HTMLElement>("button.nm")?.focus({ preventScroll: true });
    const r = el.getBoundingClientRect();
    const page = el.closest<HTMLElement>(".page")?.getBoundingClientRect();
    const seen = r.top >= (page?.top ?? 0) && r.top + Math.min(r.height, 160) <= (page?.bottom ?? innerHeight);
    if (seen || calm.current) {
      if (!seen) el.scrollIntoView({ block: "start" });
      pulse(el);
      return;
    }
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    // Once the scroll lands (scrollend, or a moment for a window without it).
    const scroller = el.closest<HTMLElement>(".page") ?? window;
    let done = false;
    const land = () => {
      if (done) return;
      done = true;
      scroller.removeEventListener("scrollend", land);
      pulse(el);
    };
    scroller.addEventListener("scrollend", land, { once: true });
    setTimeout(land, 700);
  }
  // The next thing to do: what's ready to build, else what's closest (fewest parts missing).
  const nextLine = $derived.by(() => {
    const todo = items.filter((w) => !w.c.mastered && !w.c.owned && !w.c.building && !w.c.step && !undo.has(w.c.unique));
    const ready = todo.filter((w) => !w.missing.length);
    if (ready.length) return `Can build now: ${ready.map((w) => w.c.name).join(", ")}`;
    const [w] = [...todo].sort((a, b) => a.missing.length - b.missing.length || (b.odds ?? 0) - (a.odds ?? 0));
    if (!w) return "Everything you starred is built or mastered";
    const how = w.odds ? ` · ${pct(w.odds)} from your relics` : w.buyCost != null ? ` · ${Math.round(w.buyCost)}p to buy` : "";
    return `Closest: ${w.c.name}, ${w.missing.length} part${w.missing.length === 1 ? "" : "s"} missing${how}`;
  });
  /** What to do next once nothing's left to collect: assemble, gild, level or build. Null when mastered. */
  const nextStep = (w: WishItem): string | null => {
    if (w.c.mastered) return null;
    if (w.c.stepHow) return w.c.stepHow;
    if (w.c.owned) return "In your arsenal: rank it to max for the mastery.";
    if (w.c.building) return "Building in your Foundry: claim it once it's done, then rank it to max.";
    if (!w.missing.length) return "Every part in hand: build it in your Foundry.";
    return null;
  };
  const liveFor = (era: string) => (open[era]?.length ?? 0) + (open.Omnia?.length ?? 0);
  /** As Relics and Home say it: this era's normal fissures + Steel Path, then Omnia ones apart. */
  const fissureCount = (era: string) => {
    const own = open[era] ?? [];
    const sp = own.filter((f) => f.isHard).length;
    const om = open.Omnia?.length ?? 0;
    return [own.length - sp ? `${own.length - sp} open` : "", sp ? `${sp} Steel Path` : "", om ? `${om} Omnia` : ""].filter(Boolean).join(" · ");
  };
</script>

<!-- The band only once something is starred: four zeros say nothing. -->
{#snippet band()}
  <Stat label="Wished for" note="Star anything in Foundry, Mastery or its details"><Count value={staying.length} /></Stat>
  <Stat label="Parts missing" tone="dim" note="Across everything you starred"><Count value={missingCount} /></Stat>
  <Stat extra label="Relics you hold" note="That drop one of those parts"><Count value={relicsHeld} /></Stat>
  <Stat keep label="Crack now" tone="gold" note={crackNow.length ? crackNow.map((c) => c.era).join(", ") + " fissures open" : "No matching fissure open"}><Count value={crackNow.length} /></Stat>
{/snippet}

{#snippet codex()}<CodexRings {rings} {marks} jumps onpick={pickRing} all={{ onpick: () => (items.length ? jump(null) : go?.("foundry?show=todo")), action: items.length ? "Click to go to the first thing you starred" : "Nothing starred yet: click to pick from everything you haven't mastered, on Foundry" }} action={(r) => (marks[r.group] ? `Click to go to the first one you starred` : `Nothing starred here: click to pick from the ${r.label.toLowerCase()} you haven't mastered, on Foundry`)} line={items.length ? nextLine : "Click a category to pick from what you haven't mastered in it, on Foundry"} />{/snippet}

<div class="page"><div class="page-inner">
  <PageHead title="Wishlist" brief="What you starred, and how to get each part." blurb="What you've starred, and the quickest way to each missing part: a relic you hold, where to farm one, or what it costs." band={items.length ? band : undefined} hero={codex} />

  <div class="bar">
    <input list="wish-names" placeholder="Add something to your wishlist…" bind:value={adding} onfocus={() => (namesWanted = true)} onkeydown={(e) => e.key === "Enter" && add()} aria-label="Item to add" />
    {#if namesWanted}<datalist id="wish-names">{#each listNames as n (n)}<option value={n}></option>{/each}</datalist>{/if}
    <IconButton icon="plus" tone="gold" label="Add to your wishlist" disabled={!pick || already} onclick={add} />
    {#if adding && !pick}<span class="dim small">Pick a warframe, weapon or companion from the list.</span>
    {:else if already}<span class="dim small">Already on your wishlist.</span>{/if}
  </div>

  {#if crackCards.length}
    <section class="now" aria-label="Crack now">
      {#each crackCards as c (c.era)}
        <div class="era era-wash" style:--tint={eraTint(c.era)}>
          <div class="eh"><GameIcon name={eraIcon(c.era)} size={26} /><b class="mark">{c.era}</b><span class="dim small">{fissureCount(c.era)} · next closes in {until([...c.fissures].sort((a, b) => Date.parse(a.expiry) - Date.parse(b.expiry))[0].expiry, now)}</span></div>
          <ul>
            {#each c.relics.slice(0, 4) as r, i (i)}<li><b class="name-mark" use:info={r.relic}>{r.relic}</b><span class="dim small">for</span><span use:info={r.part}>{r.part.replace(`${r.item} `, "")}</span><span class="dim small">· {r.item}</span></li>{/each}
            {#if c.relics.length > 4}<li class="dim small">+{c.relics.length - 4} more</li>{/if}
          </ul>
        </div>
      {/each}
    </section>
  {/if}

  {#if !items.length}
    <section class="panel empty">
      <h2 class="mark">Nothing starred yet</h2>
      <p class="prose">Star an item with ☆ on Foundry, Mastery or its details to track it here, or add it above. You'll see the relics for each missing part, and what buying them costs.</p>
    </section>
  {:else}
    <div class="list" bind:this={listBox} use:listView.watch>
      <!-- Each card in a slot that arrives when you add it and, once its Undo runs out, leaves while
           the cards below close up (motion.ts). Removing it folds the card down to its Undo line
           and Undo unfolds it again (reveal), so the cards below slide rather than jump. -->
      {#each drawn as w (w.c.unique)}
        <div class="wslot" in:arriveNew={w.c.unique} out:leave animate:flip>
        {#if undo.has(w.c.unique)}
          <div class="reveal" transition:reveal><div><article class="wish ghost"><UndoSlot label="Removed from your wishlist" what={w.c.name} onundo={() => undo.undo(w.c.unique)} /></article></div></div>
        {:else}
        {@const next = nextStep(w)}
        <div class="reveal" transition:reveal><div>
        <article class="wish" class:done={!w.missing.length && !next} class:new={added === w.c.unique} data-unique={w.c.unique} data-groups={w.c.groups.join(" ")}>
          <div class="who">
            <button class="art" onclick={() => details.open(w.c.unique)} aria-label="{w.c.name}: details" use:info={w.c.name}><Art file={w.c.image} size={96} fallback="foundry" /></button>
            <div class="wt">
              <button class="nm" onclick={() => details.open(w.c.unique)}><b class="mark">{w.c.name}</b></button>
              <span class="register">{w.c.type}</span>
              <!-- A chamber or model already built: its blueprint is spent, so no chip says it's missing. -->
              {#if !w.c.partBuilt}<div class="chips">{#each w.c.parts.filter((p) => !p.resource) as p (p.name)}<PartChip part={p} size={30} />{/each}</div>{/if}
              <div class="sum">
                {#if w.c.mastered}<span class="tag good">✓ Mastered</span><button class="link quiet" title="You've mastered it: take it off your wishlist" onclick={() => remove(w.c.unique)}>Done: remove it</button>
                {:else if w.c.step === "level"}<span class="tag mastery" title={w.c.stepHow}>{w.c.stepTag}</span>
                {:else if w.c.step}<span class="tag ok" title={w.c.stepHow}>{w.c.stepTag}</span>
                {:else if w.c.owned}<span class="tag mastery">Owned · level it</span>
                {:else if w.c.building}<span class="tag">Building</span>
                {:else if !w.missing.length}<span class="tag ok" title="Every part in hand: build it in your foundry">Can build now</span>
                {:else}
                  {#if w.odds != null && w.odds > 0}<span class="odds" title="Chance your relics give every missing part if you crack each of them once">{pct(w.odds)} <span class="dim small">from your relics</span></span>
                  {:else if uncovered(w)}<span class="dim small">{uncovered(w) === w.missing.length ? "None of the missing parts are in your relics" : `${uncovered(w)} of ${w.missing.length} missing parts aren't in your relics`}</span>{/if}
                  {#if w.buyCost != null}<span class="buy"><span class="dim small">{w.odds ? "or buy for" : "Buy what's missing for"}</span><P v={w.buyCost} /></span>{/if}
                {/if}
              </div>
            </div>
            <button class="unstar" title="Remove from your wishlist (you get a few seconds to undo)" aria-label="Remove {w.c.name} from your wishlist" onclick={() => remove(w.c.unique)}><Icon name="star" size={15} /></button>
          </div>
          {#if !w.missing.length && next}
            <!-- Nothing left to collect: what to do next, and where, in the room the parts table would take. -->
            <div class="next">
              <span class="register">Next step</span>
              <p class="prose">{next}</p>
            </div>
          {/if}
          {#if w.missing.length}
            <table>
              <colgroup><col style="width: 30%" /><col style="width: 35%" /><col style="width: 35%" /><col style="width: 6.8rem" /></colgroup>
              <thead><tr><th>Missing</th><th>Your relics</th><th>Farm</th><th class="r">Buy</th></tr></thead>
              <tbody>
                {#each w.missing as p (p.name)}
                  <tr>
                    <td><span class="part"><PartChip part={{ label: p.label, name: p.name, image: p.image, required: p.required, have: p.have, resource: false, building: p.building, price: p.price, ducats: null, tradable: true, blueprint: p.label === "Blueprint" }} size={28} /><b class="name-mark" use:info={p.name}>{p.label}</b></span></td>
                    <td>
                      {#if p.yours.length}
                        <span class="relics">
                          {#each p.yours.slice(0, 3) as r (r.base)}
                            <span class="relic" class:live={liveFor(r.era) > 0} use:info={r.base}><GameIcon name={eraIcon(r.era)} size={15} />{r.base}<em>×{r.total}</em><span class="dim">{Math.round(r.best)}%</span></span>
                          {/each}
                          {#if p.yours.length > 3}<span class="dim small">+{p.yours.length - 3}</span>{/if}
                        </span>
                        <span class="dim small">{pct(p.odds)} to get {p.required - p.have > 1 ? `the ${p.required - p.have} you need` : "it"} cracking each once</span>
                      {:else if p.drops.length}<span class="dim small">Not from relics</span>
                      {:else}<span class="dim small">none held</span>{/if}
                    </td>
                    <td>
                      {#if p.farm.length}
                        {#each farmByRelic(p.farm) as g (g.relic)}<div class="farm"><b use:info={g.relic}>{g.relic}</b>{#each g.spots as f, i (i)}<span class="dim small">{placeName(f.location)} · {Math.round(f.chance * 10) / 10}%</span>{/each}</div>{/each}
                      {:else if p.drops.length}
                        <div class="farm">{#each p.drops as d, i (i)}<span class="small">{placeName(d.location)} <span class="dim">· {Math.round(d.chance * 100) / 100}%</span></span>{/each}</div>
                      {:else if p.how}<span class="small" title={p.how}>{p.how}</span>
                      {:else if p.resurgence}<span class="tag ok">Varzia has it</span>
                      {:else if p.vaulted}<span class="dim small">Vaulted</span>
                      {:else}<span class="dim small">–</span>{/if}
                    </td>
                    <td class="r"><span class="buycell"><P v={p.price == null ? null : Math.round(p.price)} /><button class="link buyo" title="Post a buy order on warframe.market for {p.name}: sellers whisper you" onclick={() => mkt.startBuy(p.name, { quantity: Math.max(1, p.required - p.have), known: p.price })}>Buy order</button></span></td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}
        </article>
        </div></div>
        {/if}
        </div>
      {/each}
    </div>
  {/if}
</div></div>

<style>
  /* A part's price over its Buy order button, right-aligned in its cell: the button may wrap, never cut. */
  .buycell { display: inline-grid; justify-items: end; gap: .15rem; max-width: 100%; }
  .buyo { font-size: 11px; white-space: nowrap; padding: 0; }
  .bar input[list] { min-width: 22rem; }
  .now { align-items: start; display: grid; grid-template-columns: repeat(auto-fit, minmax(17rem, 1fr)); gap: .8rem; margin: 0 0 var(--step); }
  /* Each era a plate washed in its relic's colour (app.css, .era-wash), as on Home's fissure board. */
  .era { border: 1px solid color-mix(in srgb, var(--tint) 22%, var(--rule)); padding: .7rem .9rem; display: grid; gap: .5rem; clip-path: var(--cut); }
  .eh { display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; }
  .eh b { font-size: 1.15rem; color: color-mix(in srgb, var(--tint) 70%, var(--platinum)); }
  .era ul { list-style: none; margin: 0; padding: 0; display: grid; gap: .25rem; font-size: .82rem; }
  .era li { display: flex; gap: .35rem; align-items: baseline; flex-wrap: wrap; }
  .list { display: grid; gap: .9rem; }
  .wish { border: 1px solid var(--rule); background: var(--plate-sheen), var(--plate); box-shadow: var(--plate-light); clip-path: var(--cut); padding: .9rem 1rem; display: grid; grid-template-columns: minmax(18rem, 24rem) 1fr; gap: 1.2rem; align-items: start; }
  .wslot { min-width: 0; }
  /* Just added: a gold edge that fades over a second. A colour, so it shows with reduced motion too. */
  /* The edge is drawn once on a layer of its own that fades by opacity, which the compositor runs
     without redrawing the card (fading the shadow itself repainted it every frame). */
  .wish.new { position: relative; }
  .wish.new::after { content: ""; position: absolute; inset: 0; pointer-events: none; box-shadow: inset 0 0 0 2px var(--gold), inset 0 0 24px rgb(214 174 74 / 14%); opacity: 0; animation: wish-new 1s ease-out; }
  @keyframes wish-new { 0%, 45% { opacity: 1; } 100% { opacity: 0; } }
  @media (prefers-reduced-motion: reduce) { .wish.new::after { animation-duration: 1s !important; } }
  .wish.ghost { display: block; padding: .4rem 0; border-color: transparent; background: none; clip-path: none; }
  .wish.done { grid-template-columns: 1fr; }
  /* Page area under 950 px (App sets the flag, by the room pages actually have). */
  :global(html[data-room~="lt950"]) .wish { grid-template-columns: 1fr; }
  .who { display: grid; grid-template-columns: auto 1fr auto; gap: .8rem; align-items: start; }
  .art, .nm { padding: 0; border: 0; background: none; text-align: left; }
  .nm b { font-size: 1.3rem; }
  .nm:hover b { color: var(--gold); }
  .wt { display: grid; gap: .35rem; min-width: 0; }
  .chips { display: flex; gap: .35rem; flex-wrap: wrap; margin-top: .2rem; }
  .sum { display: flex; gap: .8rem; align-items: baseline; flex-wrap: wrap; margin-top: .2rem; }
  .sum .tag { margin: 0; }
  .odds { font-family: var(--face-mark); font-size: 1.2rem; color: var(--gold); }
  .buy { display: inline-flex; gap: .35rem; align-items: center; }
  .unstar { border: 0; background: none; padding: .2rem; color: var(--gold); line-height: 0; }
  /* The icon draws its path with fill="none": the rule has to reach the path itself. */
  .unstar :global(svg path) { fill: var(--gold); }
  .unstar:hover { color: var(--oxblood); }
  .unstar:hover :global(svg path) { fill: none; }
  table { width: 100%; table-layout: fixed; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  th { text-align: left; font-family: var(--face-register); font-weight: 500; font-size: .72rem; letter-spacing: .14em; text-transform: uppercase; color: var(--platinum-deep); padding: 0 .5rem .45rem; border-bottom: 1px solid var(--rule); }
  td { padding: var(--row-pad) .5rem; border-bottom: 1px solid var(--rule); vertical-align: middle; }
  tr:last-child td { border-bottom: 0; }
  .r { text-align: right; }
  .part { display: inline-flex; align-items: center; gap: .55rem; max-width: 100%; min-width: 0; }
  /* A long part name ("Neuroptics Blueprint") wraps between words rather than ending in … or running into the next column. */
  .part b { min-width: 0; overflow-wrap: normal; }
  .next { display: grid; gap: .35rem; align-content: start; padding: .1rem 0 0 1.2rem; border-left: 1px solid var(--rule); max-width: 46rem; }
  .next .prose { margin: 0; font-size: .88rem; line-height: 1.45; color: var(--platinum); }
  :global(html[data-room~="lt950"]) .next { padding: .7rem 0 0; border-left: 0; border-top: 1px solid var(--rule); }
  .relics { display: flex; gap: .35rem; flex-wrap: wrap; margin-bottom: .2rem; }
  .relic { display: inline-flex; align-items: center; gap: .3rem; padding: .12rem .45rem .12rem .25rem; border: 1px solid var(--rule-bright); font-size: .78rem; }
  .relic em { font-style: normal; color: var(--gold); font-weight: 600; }
  .relic.live { border-color: var(--gold); box-shadow: 0 0 10px -4px rgb(214 174 74 / 70%); }
  .farm { display: grid; font-size: .8rem; }
  .farm + .farm { margin-top: .3rem; }
  .farm b { font-weight: 600; }
</style>
