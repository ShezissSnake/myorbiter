<script lang="ts">
  // Development only (spares-preview.html, never in a build): the new "Put my spares on sale"
  // panel with made-up numbers, in both places it could live: folded inside Orders as now, or on
  // a page of its own in the Trade section with a line on Orders pointing at it. The query string
  // sets the state to look at: ?layout=inline|page|orders &open=mods &review=1.
  import SparesPlan from "../lib/ui/SparesPlan.svelte";
  import PlanReview from "../lib/ui/spares/PlanReview.svelte";
  import NeverSoldTag from "../lib/ui/spares/NeverSoldTag.svelte";
  import GameIcon, { type GameIconName } from "../lib/ui/GameIcon.svelte";
  import Icon from "../lib/ui/Icon.svelte";
  import Seg from "../lib/ui/Seg.svelte";
  import P from "../lib/ui/P.svelte";
  import { UndoSlots } from "../lib/undo.svelte";
  import { neverSells, withNeverSell, withoutNeverSell, type SpareCategory } from "../lib/core/sparesRules";
  import { fixtureFacts, fixturePreview, fixtureReview, fixtureRules } from "./sparesFixture";
  import type { ReviewRow } from "../lib/ui/spares/types";

  const q = new URLSearchParams(location.search);
  let layout = $state<"inline" | "page" | "orders">((q.get("layout") as "inline" | "page" | "orders") ?? "page");
  let open = $state<SpareCategory | null>((q.get("open") as SpareCategory | null) || null);
  let rules = $state(fixtureRules());
  let veiled = $state(false);
  let planned = $state(q.get("review") === "1");
  let menuOpen = $state<string | null>(q.get("menu"));
  let foldOpen = $state(true);
  const preview = $derived(fixturePreview(rules, planned));
  const on = $derived((["prime", "mods", "arcanes", "relics", "gear", "resources", "imprints"] as const).filter((c) => rules[c].on));
  const total = $derived(on.reduce((n, c) => n + (preview[c]?.listings ?? 0), 0));
  const totalPlat = $derived(on.reduce((n, c) => n + (preview[c]?.plat ?? 0), 0));

  // The review list: Skip this time and Never sell, the latter with its Undo.
  let skipped = $state<Record<string, true>>({});
  const undo = new UndoSlots();
  const rows = $derived<ReviewRow[]>(
    fixtureReview.map((r) => (r.out ? (neverSells(rules, r.id) ? r : { ...r, out: undefined, type: "create" as const, rule: "Keep 5", why: "4 copies: kept for lich weapons; listed after Sell again" }) : neverSells(rules, r.id) && !undo.has(r.key) ? { ...r, type: "skip" as const, out: "never" as const } : skipped[r.key] ? { ...r, out: "skipped" as const } : r)),
  );
  function pick(r: ReviewRow, c: "skip" | "never" | "back" | "sellAgain") {
    if (c === "skip") skipped = { ...skipped, [r.key]: true };
    else if (c === "back") {
      const { [r.key]: _, ...rest } = skipped;
      skipped = rest;
    } else if (c === "sellAgain") rules = withoutNeverSell(rules, [r.id]);
    else if (c === "never") {
      rules = withNeverSell(rules, { id: r.id, name: r.name, cat: r.cat });
      undo.hold(r.key, () => {});
    }
  }
  function unNever(r: ReviewRow) {
    undo.undo(r.key);
    rules = withoutNeverSell(rules, [r.id]);
  }
  const sellAgain = (ids: string[]) => (rules = withoutNeverSell(rules, ids));
  const TRADE: { id: string; label: string; game?: GameIconName; line?: string }[] = [
    { id: "market", label: "Orders", game: "market" },
    { id: "spares", label: "Sell spares", game: "platinum" },
    { id: "browse", label: "Browse market", line: "list" },
    { id: "sales", label: "Sales", game: "platinum" },
    { id: "stats", label: "Stats", line: "chart" },
  ];
  const compact = typeof innerWidth === "number" && innerWidth < 1180;
</script>

{#snippet planButton()}
  <button type="button" class="stamp gold" onclick={() => (planned = true)}>{planned ? "Plan again" : "Plan the changes"}</button>
{/snippet}

{#snippet review()}
  {#if planned}
    <div class="summary">
      <span><strong>7</strong> new</span><span><strong>1</strong> changed</span><span><strong>1</strong> removed</span>
      <span class="dim">Listed value +<P v={213} /></span>
      <span class="grow"></span>
      <button type="button" class="stamp gold">Apply the plan (9)</button>
      <button type="button">Cancel</button>
    </div>
    <PlanReview {rows} holding={undo.held} bind:menuOpen onpick={pick} onundo={unNever} scroll={layout !== "page"} />
  {/if}
{/snippet}

<div class="shell" class:compact>
  <aside class="rail">
    <div class="brand"><span class="mark brand-name">{compact ? "o" : "orbiter"}</span></div>
    <nav>
      <div class="sec register">{compact ? "" : "Trade"}</div>
      {#each TRADE as p (p.id)}
        {#if p.id !== "spares" || layout === "page"}
          <button type="button" class="nav" class:on={(layout === "page" && p.id === "spares") || (layout !== "page" && p.id === "market")} title={p.label}>
            <span class="ic">{#if p.game}<GameIcon name={p.game} size={18} />{:else}<Icon name={p.line ?? "list"} size={16} />{/if}</span>
            {#if !compact}<span class="lbl">{p.label}</span>{/if}
          </button>
        {/if}
      {/each}
    </nav>
  </aside>

  <main class="page">
    <div class="page-inner">
      <div class="devbar">
        <span class="register">Prototype</span>
        <Seg label="Where it lives" bind:value={layout} options={[
          { v: "inline", label: "In Orders", title: "Folded at the top of Orders, as now" },
          { v: "page", label: "Its own page", title: "Sell spares, a page in Trade after Orders" },
          { v: "orders", label: "Orders, then", title: "Orders with the plan on its own page: one line pointing at it" },
        ]} />
        <span class="dim small">Never sold in a sheet:</span>
        {#if neverSells(rules, "khra")}<NeverSoldTag name="Khra" onsellagain={() => sellAgain(["khra"])} />{:else}<span class="dim small">(Khra is sold again)</span>{/if}
      </div>

      {#if layout === "page"}
        <header class="head">
          <h1 class="mark">Sell spares</h1>
          <p class="prose">Everything you can spare, listed in one go after a look at the plan. Tick what to sell; open a row to choose how. Listings you made yourself stay up while you hold them.</p>
        </header>
        <SparesPlan bind:rules bind:veiledRivens={veiled} preview={preview} facts={fixtureFacts} bind:open page onsellagain={sellAgain} actions={planButton} />
        {@render review()}
      {:else}
        <header class="head">
          <h1 class="mark">Orders</h1>
          <p class="prose">Your warframe.market listings, kept at the cheapest in-game price.</p>
        </header>
        {#if layout === "orders"}
          <a class="sparesline" href="?layout=page" title="Sell spares: choose what to sell and how, then look over the plan">
            <GameIcon name="platinum" size={18} />
            <span class="register">Sell spares</span>
            <span class="small dim">{total} listings ready from {on.length} kinds · ~<P v={totalPlat} dim /> · {planned ? "a plan of 9 changes to look over" : "no plan made yet"}</span>
            <span class="go register">Open <Icon name="arrow-right" size={12} /></span>
          </a>
        {:else}
          <section class="sparesfold" class:open={foldOpen}>
            <button type="button" class="foldhead" aria-expanded={foldOpen} onclick={() => (foldOpen = !foldOpen)}>
              <GameIcon name="platinum" size={18} />
              <span class="register">Put my spares on sale</span>
              <span class="dim small sub">{planned ? "A plan of 9 changes, ready to look over" : "List everything you can spare in one go, after a look at the plan"}</span>
              <span class="chev" aria-hidden="true">▾</span>
            </button>
            {#if foldOpen}
              <div class="spares-in">
                <SparesPlan bind:rules bind:veiledRivens={veiled} preview={preview} facts={fixtureFacts} bind:open onsellagain={sellAgain} actions={planButton} />
                {@render review()}
              </div>
            {/if}
          </section>
        {/if}
        <div class="listings">
          <div class="bar"><input type="search" placeholder="Filter your listings" /><span class="dim small">87 listings · 2,412p</span></div>
          {#each ["Saryn Prime Set", "Arcane Energize", "Primed Continuity", "Axi A1 Relic", "Lith Z4 Relic"] as n (n)}<div class="lrow"><span class="name-mark">{n}</span><span class="dim small">×1</span></div>{/each}
        </div>
      {/if}
    </div>
  </main>
</div>

<style>
  .shell { display: grid; grid-template-columns: 14.5rem minmax(0, 1fr); min-height: 100vh; }
  .shell.compact { grid-template-columns: 4.4rem minmax(0, 1fr); }
  .rail { background: linear-gradient(180deg, #0d0f12, #090a0c); border-right: 1px solid var(--rule); box-shadow: inset -1px 0 0 rgb(214 174 74 / 12%); }
  .brand { padding: .95rem 1rem .8rem 1.1rem; border-bottom: 1px solid var(--rule); }
  .brand-name { font-size: 1.3rem; }
  nav { display: grid; gap: 1px; padding: .6rem .55rem; }
  .sec { padding: .85rem .65rem .35rem; font-size: .6rem; color: var(--gold); letter-spacing: .2em; }
  .nav { display: flex; align-items: center; gap: .75rem; width: 100%; text-align: left; border: 0; background: transparent; padding: .44rem .65rem; color: var(--platinum-dim); font-family: var(--face-text); font-size: .9rem; font-weight: 500; letter-spacing: 0; text-transform: none; }
  .nav .ic { width: 1.5rem; height: 1.5rem; display: grid; place-items: center; }
  .nav.on { color: var(--platinum); background: linear-gradient(90deg, color-mix(in srgb, var(--gold) 14%, transparent), transparent 70%); box-shadow: inset 2px 0 0 var(--gold); }
  .page { overflow: visible; }
  .devbar { display: flex; flex-wrap: wrap; align-items: center; gap: .6rem 1rem; padding: .7rem .8rem; margin-top: .8rem; border: 1px dashed var(--rule-bright); }
  .head { display: grid; grid-template-columns: minmax(0, 1fr) minmax(14rem, 26rem); align-items: end; gap: var(--course); padding: 26px 0 14px; }
  .head h1 { font-size: clamp(2.3rem, 4.2vw, 3.7rem); }
  .head .prose { margin: 0; }
  .sparesfold { margin: var(--step) 0 .4rem; border: 1px solid var(--rule-bright); background: var(--plate); }
  .foldhead { all: unset; box-sizing: border-box; width: 100%; display: flex; align-items: center; gap: .6rem; padding: .7rem .9rem; cursor: pointer; }
  .foldhead .sub { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .foldhead .chev { color: var(--platinum-deep); font-size: .75rem; }
  .spares-in { padding: 0 .9rem .9rem; display: grid; gap: .8rem; }
  .sparesline { display: flex; align-items: center; gap: .7rem; margin: var(--step) 0 .4rem; padding: .7rem .9rem; border: 1px solid var(--rule); background: var(--plate); color: inherit; text-decoration: none; }
  .sparesline:hover { border-color: var(--rule-bright); }
  .sparesline .small { flex: 1; min-width: 0; display: inline-flex; align-items: center; gap: .25rem; white-space: nowrap; overflow: hidden; }
  .sparesline .go { display: inline-flex; align-items: center; gap: .35rem; color: var(--platinum); }
  .summary { display: flex; align-items: center; flex-wrap: wrap; gap: .5rem 1.2rem; font-size: .86rem; margin-top: .4rem; }
  .summary strong { color: var(--platinum); font-family: var(--face-mark); font-size: 1.2rem; margin-right: .2rem; }
  .listings { margin-top: 1rem; opacity: .6; }
  .lrow { display: flex; justify-content: space-between; padding: .55rem 0; border-bottom: 1px solid var(--rule); }
</style>
