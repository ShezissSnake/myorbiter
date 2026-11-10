<script lang="ts">
  // Sell spares: choose what to sell and how, row by row (SparesPlan), look over the plan with the
  // rule behind each line (PlanReview), then list it in one go. Only the ticked rows are touched;
  // listings you set to be left alone, or hid, never are. Each row's numbers are worked out in a
  // quiet moment after a change (core/bulk.ts, sparesPreview) and the last ones shown meanwhile, so
  // a click only redraws the choices.
  import { tick } from "svelte";
  import type { Model } from "../core/model";
  import type { AdviceSettings, MarketSettings } from "../backend";
  import { actionItemId, actionKey, LIMIT_WHY, LIMIT_WHY_TRADES, LISTING_LIMIT, planTally, sparesPreview, toApply, type BulkAction, type SparesTally } from "../core/bulk";
  import { SPARE_CATEGORIES, withNeverSell, withoutNeverSell, type SpareCategory, type SparesRules } from "../core/sparesRules";
  import { lichWeaponsLeft } from "../core/views";
  import { daysToTrade } from "../core/tradeLimit";
  import { planTax } from "../core/tradeTax";
  import { shortCredits } from "../core/traders";
  import { mkt } from "../marketStore.svelte";
  import { drops } from "../drops.svelte";
  import { sparesSummary } from "../sparesSummary.svelte";
  import { takeIntent } from "../intent.svelte";
  import { whenIdle, whileShown } from "../pane.svelte";
  import { UndoSlots } from "../undo.svelte";
  import { Job, JobError } from "../job.svelte";
  import PageHead from "../ui/PageHead.svelte";
  import SparesPlan from "../ui/SparesPlan.svelte";
  import PlanReview from "../ui/spares/PlanReview.svelte";
  import ProgressButton from "../ui/ProgressButton.svelte";
  import GameIcon from "../ui/GameIcon.svelte";
  import P from "../ui/P.svelte";
  import Count from "../ui/Count.svelte";
  import type { ReviewRow, SparesFacts, SparesPreview } from "../ui/spares/types";

  let { model, settings = $bindable(), advice, masteryRank = null, credits = null, go }: { model: Model; settings: MarketSettings; advice: AdviceSettings; masteryRank?: number | null; credits?: number | null; go: (to: string) => void } = $props();

  // The row whose options are open: one at a time. A link can open one ("spares?open=mods").
  let open = $state<SpareCategory | null>(null);
  $effect(() => {
    const want = takeIntent("spares");
    if (want?.open && (SPARE_CATEGORIES as readonly string[]).includes(want.open)) open = want.open as SpareCategory;
  });

  const rules = $derived(settings.spares);
  const anyTicked = $derived(SPARE_CATEGORIES.some((c) => rules[c].on));
  const never = $derived(new Set(rules.neverSell.map((n) => n.id)));

  // ------------------------------------------------------------ each row's numbers

  /** What the numbers depend on, ticks aside: every row is counted as if ticked. */
  const shape = (r: SparesRules) => JSON.stringify([SPARE_CATEGORIES.map((c) => ({ ...r[c], on: null })), r.neverSell]);
  const previewKey = $derived(JSON.stringify([shape(rules), settings.minPrice, settings.minByCategory, settings.sellable, advice.platPerDucat, advice.squad, advice.minPlat, advice.vosforLens]));
  let estimate = $state.raw<{ key: string; model: Model; index: unknown; drops: unknown; tally: SparesTally } | null>(null);
  $effect(() => {
    const key = previewKey;
    const m = model;
    const index = mkt.index;
    const recent = drops.recent;
    if (estimate && estimate.key === key && estimate.model === m && estimate.index === index && estimate.drops === recent) return;
    // In a quiet moment, never on the click: the last numbers stay up, faded, meanwhile.
    return whenIdle(() => {
      const ctx = { model: m, index, sell: $state.snapshot(settings.sellable), advice: $state.snapshot(advice), drops: recent, minPrice: settings.minPrice, minByCategory: $state.snapshot(settings.minByCategory) };
      estimate = { key, model: m, index, drops: recent, tally: sparesPreview(ctx, $state.snapshot(settings.spares) as SparesRules) };
    });
  });
  const current = $derived(!!estimate && estimate.key === previewKey && estimate.model === model && estimate.index === mkt.index);

  // ------------------------------------------------------------ the plan

  // A plan made with other choices or another minimum no longer says what Apply would do: it stays
  // on screen, marked, until you plan again. Never sell and Sell again don't count: the plan already
  // leaves out what you put on the list while looking it over.
  let plannedWith = $state("");
  const rulesKey = $derived(JSON.stringify([{ ...rules, neverSell: [] }, settings.minPrice, settings.minByCategory, settings.minShare, settings.sellable]));
  const stale = $derived(!!mkt.bulk && rulesKey !== plannedWith);
  const sendable = $derived(mkt.bulk ? toApply(mkt.bulk.actions, mkt.bulk.skipped, never) : []);
  const planned = $derived(mkt.bulk && !stale ? planTally(sendable) : null);

  const preview: SparesPreview = $derived(
    Object.fromEntries(
      SPARE_CATEGORIES.map((c) => {
        if (planned && rules[c].on) return [c, { ...planned[c], estimate: false }];
        const t = estimate?.tally[c];
        // Imprints come from a patched TennoScope: until it has passed any, none can be counted.
        const note = c === "imprints" && !model.imprints ? "TennoScope hasn't passed your imprints yet (it takes a patched TennoScope): none can be counted or listed until it does." : undefined;
        return [c, t ? { ...t, estimate: true, stale: !current, note } : undefined];
      }),
    ),
  );
  // The line Orders shows for this page: the ticked rows' numbers.
  $effect(() => {
    const on = SPARE_CATEGORIES.filter((c) => rules[c].on && preview[c]);
    if (!on.length && !estimate) return;
    sparesSummary.listings = on.reduce((n, c) => n + (preview[c]?.listings ?? 0), 0);
    sparesSummary.plat = on.reduce((n, c) => n + (preview[c]?.plat ?? 0), 0);
    sparesSummary.kinds = on.length;
    sparesSummary.estimate = on.some((c) => preview[c]?.estimate);
    sparesSummary.at = Date.now();
  });
  $effect(() => {
    sparesSummary.changes = changes.length;
  });
  const lich = $derived(lichWeaponsLeft(model));
  const facts: SparesFacts = $derived({ lichLeft: { requiem: lich.known.requiem ? lich.requiem.length : 1, antivirus: lich.known.antivirus ? lich.antivirus.length : 1 }, platPerDucat: advice.platPerDucat, minPrice: settings.minPrice, minByCategory: settings.minByCategory, squad: advice.squad ?? 1 });

  // Waiting for the relic prices MyOrbiter reads on start: the button says so, rather than nothing.
  let waiting = $state(false);
  // Plan and Apply fill as they go (mkt.progress) and say how they ended.
  const planJob = new Job();
  const applyJob = new Job();
  const fill = (op: string) => (mkt.op === op && mkt.progress?.total ? mkt.progress.done / mkt.progress.total : null);
  const count = (op: string, verb: string) => (mkt.op === op && mkt.progress ? `${verb} ${mkt.progress.done}/${mkt.progress.total}` : `${verb}…`);
  // This page's own failures (by the store's label for the work), not whatever else last failed.
  const failure = (label: string) => mkt.errorOf(label);
  function plan() {
    void planJob.run(async () => {
      if (!(await makePlan())) return null;
      const e = failure("Working out what to list");
      if (e) throw new JobError("Couldn't plan", e);
      const n = (mkt.bulk?.actions ?? []).filter((a) => a.type !== "skip").length;
      return n ? `${n} to change` : "Nothing to change";
    });
  }
  async function makePlan() {
    plannedWith = rulesKey;
    // Relic prices still being read (MyOrbiter just started): plan with them, not before them.
    if (mkt.relicRead) {
      waiting = true;
      try {
        await mkt.relicRead;
        await tick();
      } finally {
        waiting = false;
      }
    }
    return mkt.planBulk(model, settings, advice);
  }
  function apply() {
    void applyJob.run(async () => {
      const r = await mkt.applyBulk(model, settings, advice);
      if (!r) return null;
      if (r.outcome === "changed") throw new JobError("Plan changed", "Your inventory or listings changed since the plan: look over the updated plan and apply again");
      if (r.outcome === "replanned") throw new JobError("Plan refreshed", "That plan was over 10 minutes old, so its prices were read again: look it over and apply again");
      if (r.outcome === "stopped") throw new JobError("Stopped", failure("Updating your listings") ?? `Stopped after ${r.sent} changes`);
      if (r.failed) throw new JobError(`${r.failed} failed`, `${r.sent} change${r.sent === 1 ? "" : "s"} made, ${r.failed} refused or held back: Activity, on Orders, says why`);
      return `${r.sent} done`;
    });
  }

  const actions = $derived(mkt.bulk?.actions ?? []);
  const changes = $derived(sendable.filter((a) => a.type !== "skip"));
  // warframe.market's 100-listing cap: what the plan left out, or took down, to stay under it.
  const overLimit = $derived(actions.filter((a) => a.type === "skip" && (a.why === LIMIT_WHY || a.why === LIMIT_WHY_TRADES)).length);
  const madeRoom = $derived(actions.filter((a) => a.type === "remove" && a.rule === "plan.room").length);
  const unread = $derived(actions.filter((a) => a.type === "skip" && a.rule === "plan.unread").length);
  const kinds = (t: BulkAction["type"]) => changes.filter((a) => a.type === t).length;
  const gain = $derived(changes.reduce((n, a) => n + (a.type === "create" ? a.quantity * a.platinum : a.type === "update" ? a.quantity * a.platinum - a.order.quantity * a.order.platinum : a.type === "remove" ? -a.order.quantity * a.order.platinum : 0), 0));
  /** The seller's trading tax for selling every copy in the plan's new and resized listings: 500 credits a platinum. */
  const tax = $derived.by(whileShown("spares", () => planTax(model, sendable)));

  // ------------------------------------------------------------ the review list

  // While applying, each line ticks off as it's sent and then leaves the list. `gone`: sent lines
  // whose tick has been seen. One timer a line, kept outside the effect.
  let gone = $state.raw<ReadonlySet<BulkAction>>(new Set());
  const leaving = new Map<BulkAction, ReturnType<typeof setTimeout>>();
  $effect(() => {
    const ap = mkt.applying;
    if (!ap) {
      for (const t of leaving.values()) clearTimeout(t);
      leaving.clear();
      gone = new Set();
      return;
    }
    for (const a of ap.sent) {
      if (leaving.has(a)) continue;
      leaving.set(a, setTimeout(() => (gone = new Set([...gone, a])), 650));
    }
  });
  $effect(() => () => {
    for (const t of leaving.values()) clearTimeout(t);
  });

  // Never sell, from a line: on the list at once; the line holds an Undo for a few seconds.
  const undo = new UndoSlots();
  $effect(() => () => undo.flush());
  let menuOpen = $state<string | null>(null);
  // In the order Apply sends them: removals first (room under the 100-listing limit), then changes,
  // then new listings. Left out: what you can do something about first, your minimum last.
  const APPLY_ORDER = { remove: 0, update: 1, create: 2, skip: 3 } as const;
  const LEFT_ORDER = (r: string | undefined) => (r === "plan.unread" ? 0 : r === "plan.limit" ? 1 : r === "never" ? 2 : r === "plan.listed" ? 3 : r === "plan.min" ? 5 : 4);
  const word = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  function rowOf(a: BulkAction, skipped: ReadonlySet<string>): ReviewRow {
    const key = actionKey(a);
    const id = actionItemId(a) ?? "";
    const name = a.type === "skip" ? a.name : a.item.name;
    const sub = a.type === "create" || a.type === "skip" ? (a.subtype ?? null) : a.order.subtype;
    const ap = mkt.applying;
    const mine = (a.type === "create" || a.type === "update" || a.rule === "never") && never.has(id) && !undo.has(key);
    return {
      key,
      id,
      name,
      image: model.imageOf(name.replace(/ Set$/, "")),
      rank: a.type === "create" || a.type === "skip" ? a.rank : a.order.rank,
      variant: sub && / Relic$/.test(name) ? word(sub) : null,
      cat: a.cat ?? null,
      type: a.type,
      quantity: a.type === "remove" ? 0 : a.type === "skip" ? (a.quantity ?? 0) : a.quantity,
      was: a.type === "update" || a.type === "remove" ? { quantity: a.order.quantity, platinum: a.order.platinum } : undefined,
      platinum: a.type === "create" || a.type === "update" ? a.platinum : a.type === "skip" && a.each != null ? Math.round(a.each) : null,
      rule: a.ruleText ?? "",
      why: a.type === "create" || a.type === "update" ? `${a.why} · ${a.priceWhy}` : a.why,
      out: skipped.has(key) ? "skipped" : mine ? "never" : undefined,
      state: ap ? (ap.sent.has(a) ? "sent" : ap.failed.has(a) ? "refused" : ap.now === a ? "now" : undefined) : undefined,
    };
  }
  const rows = $derived.by(whileShown("spares", () => {
    const b = mkt.bulk;
    if (!b) return [];
    const going = b.actions.filter((a) => a.type !== "skip" && !gone.has(a)).sort((x, y) => APPLY_ORDER[x.type] - APPLY_ORDER[y.type]);
    const left = b.actions.filter((a) => a.type === "skip").sort((x, y) => LEFT_ORDER(x.rule) - LEFT_ORDER(y.rule));
    return [...going, ...left].map((a) => rowOf(a, b.skipped));
  }));
  function pick(r: ReviewRow, choice: "skip" | "never" | "back" | "sellAgain") {
    if (choice === "skip") mkt.skipLine(r.key, true);
    else if (choice === "back") mkt.skipLine(r.key, false);
    else if (choice === "sellAgain") sellAgain([r.id]);
    else {
      settings.spares.neverSell = withNeverSell(settings.spares, { id: r.id, name: r.name, cat: r.cat }).neverSell;
      undo.hold(r.key, () => {});
    }
  }
  function unNever(r: ReviewRow) {
    undo.undo(r.key);
    sellAgain([r.id]);
  }
  const sellAgain = (ids: string[]) => (settings.spares.neverSell = withoutNeverSell(settings.spares, ids).neverSell);
</script>

{#snippet planButton()}
  <ProgressButton class="planbtn" job={planJob} label={mkt.bulk ? "Plan again" : "Plan the changes"} working={waiting ? "Waiting for relics" : count("Working out what to list", "Pricing")} progress={fill("Working out what to list")} sizer={["Waiting for relics", "000 to change"]}
    title={!mkt.linked ? "Sign in to warframe.market on Orders first" : !anyTicked ? "Tick at least one kind of thing to sell first" : "Read the prices of everything you can spare in the ticked rows and work out the changes, for you to look over before anything is sent"} disabled={!mkt.linked || !anyTicked || !!mkt.op} onclick={plan} />
{/snippet}

<div class="page"><div class="page-inner">
  <PageHead title="Sell spares" brief="Choose what to sell, look it over, list it in one go." blurb="Everything you can spare, listed on warframe.market in one go after a look at the plan. Tick what to sell; open a row to choose how. Listings you made yourself stay up while you hold them." />

  {#if !mkt.linked}
    <p class="signin small"><GameIcon name="market" size={14} /> Plans are made against your listings on warframe.market: <button type="button" class="link" title="Orders: sign in to warframe.market" onclick={() => go("market")}>sign in on Orders</button>. The choices below are kept either way.</p>
  {/if}

  <SparesPlan bind:rules={settings.spares} bind:veiledRivens={settings.sellable.veiledRivens} bind:saveForSets={settings.sellable.saveForSets} bind:minPrice={settings.minPrice} bind:minByCategory={settings.minByCategory} {preview} {facts} bind:open page onsellagain={sellAgain} actions={planButton} />
  <!-- Why the last plan or apply failed, here by its buttons rather than at the top of the page. -->
  {#each [planJob, applyJob].filter((j) => j.state === "failed" && j.error) as j (j)}<p class="small err" role="status">{j.error}</p>{/each}

  {#if mkt.bulk}
    <section class="planned" aria-label="The plan">
      {#if overLimit || madeRoom}{@const fast = rules.priority === "trades"}<p class="small warn">warframe.market allows {LISTING_LIMIT} listings, so the plan keeps the ones {fast ? "that sell most often" : "worth the most platinum"}{overLimit ? `: ${overLimit} ${fast ? "slower-selling" : "cheaper"} thing${overLimit === 1 ? " is" : "s are"} left out` : ""}{madeRoom ? `${overLimit ? " and" : ":"} ${madeRoom} ${fast ? "slower-selling" : "cheaper"} listing${madeRoom === 1 ? " comes" : "s come"} down to make room` : ""}.</p>{/if}
      {#if unread}<p class="small warn">warframe.market didn't answer for {unread} item{unread === 1 ? "" : "s"}, so {unread === 1 ? "it isn't" : "they aren't"} in this plan. Plan again to retry.</p>{/if}
      {#if stale}<p class="small warn">You changed what to sell since this plan: plan again before applying.</p>{/if}
      <div class="summary">
        {#if changes.length}
          <span title="New listings"><strong><Count value={kinds("create")} /></strong> new</span>
          <span title="Listings of yours changed: copies or price"><strong><Count value={kinds("update")} /></strong> changed</span>
          <span title="Listings of yours taken down"><strong><Count value={kinds("remove")} /></strong> removed</span>
          <span class="dim" title="What your listings are worth after the plan, against before: copies × price">Listed value {gain >= 0 ? "+" : "−"}<P v={Math.abs(gain)} /></span>
        {:else}
          <span class="small">{unread ? "Nothing to change among what could be priced." : "Your listings already match: nothing to change."}</span>
        {/if}
        <span class="grow"></span>
        {#if changes.length}
          <ProgressButton tone="primary" job={applyJob} label="Apply the plan ({changes.length})" working={count("Updating your listings", "Applying")} progress={fill("Updating your listings")} sizer={["Applying 000/000"]}
            title={stale ? "You changed what to sell since this plan: plan again first" : "Send these changes to warframe.market, one at a time"} disabled={!!mkt.busy || stale} onclick={apply} />
        {/if}
        <button type="button" disabled={!!mkt.busy} title="Put this plan away: nothing is sent" onclick={() => (mkt.bulk = null)}>Cancel</button>
      </div>
      {#if masteryRank != null && masteryRank >= 2}
        {@const copies = changes.reduce((n, a) => n + (a.type === "remove" ? 0 : a.quantity), 0)}
        {@const days = daysToTrade(copies, masteryRank)}
        {#if days != null && days > 1}<p class="dim small" title="Trades a day are your Mastery Rank ({masteryRank}), each carrying up to 6 items; buyers often take just one, so it's usually longer">{copies.toLocaleString("en")} copies in new or changed listings: at {masteryRank} trades a day, 6 items each at best, selling them all takes {days} days or more.</p>{/if}
      {/if}
      {#if tax.credits > 0}
        {@const short = credits != null && tax.credits > credits}
        <p class="small" class:warn={short} class:dim={!short} title="Warframe charges each player a credit tax for what they receive: selling, that's 500 credits for each platinum you're paid. This is for selling every copy at its listed price ({tax.platinum.toLocaleString('en')}p); Maroo's Bazaar adds 10%, a clan dojo up to 100%. Your buyers pay the items' own tax{tax.buyers ? ` (about ${shortCredits(tax.buyers)} between them)` : ''}, not you"><GameIcon name="credits" size={12} /> Selling all of it costs you about {shortCredits(tax.credits)} credits in trade tax ({shortCredits(tax.maroo)} in Maroo's Bazaar){#if short}: more than the {shortCredits(credits!)} you have, so some trades won't go through until you farm credits{:else if credits != null}; you have {shortCredits(credits)}{/if}.</p>
      {/if}
      <PlanReview {rows} holding={undo.held} bind:menuOpen onpick={pick} onundo={unNever} scroll={false} locked={!!mkt.applying} />
    </section>
  {/if}
</div></div>

<style>
  .signin { display: flex; align-items: center; gap: .45rem; margin: 0 0 .8rem; padding: .55rem .8rem; border: 1px solid var(--rule); border-left: 2px solid var(--gold-dim); color: var(--platinum-dim); }
  .err { color: var(--oxblood); margin: .4rem 0 0; }
  .warn { color: var(--alert); margin: 0; }
  .warn::before { content: "! "; font-weight: 700; }
  .planned { display: grid; gap: .6rem; margin-top: 1.2rem; }
  .summary { display: flex; align-items: center; flex-wrap: wrap; gap: .5rem 1.2rem; font-size: .86rem; padding-top: .6rem; border-top: 1px solid var(--rule-bright); }
  .summary strong { color: var(--platinum); font-family: var(--face-mark); font-size: 1.2rem; margin-right: .2rem; }
  .grow { flex: 1; }
  .planned > p { margin: 0; }
</style>
