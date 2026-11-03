<script lang="ts">
  import { daysToTrade } from "../core/tradeLimit";
  import { planTax } from "../core/tradeTax";
  import { shortCredits } from "../core/traders";
  import GameIcon from "./GameIcon.svelte";
  // "Put my spares on sale": tick what to sell, look over the changes, apply them in one go.
  // Only the ticked categories are touched; listings you set to be left alone, or hid, never are.
  import { tick } from "svelte";
  import type { Model } from "../core/model";
  import type { AdviceSettings, MarketSettings } from "../backend";
  import { AS_LISTED, KIND_LABEL, LIMIT_WHY, LIMIT_WHY_TRADES, LISTING_LIMIT, type BulkAction } from "../core/bulk";
  import { mkt } from "../marketStore.svelte";
  import Seg from "./Seg.svelte";
  import Chip from "./Chip.svelte";
  import P from "./P.svelte";
  import Named from "./Named.svelte";
  import { info } from "../hover.svelte";
  import ProgressButton from "./ProgressButton.svelte";
  import { Job, JobError } from "../job.svelte";

  let { model, settings, advice, masteryRank = null, credits = null }: { model: Model; settings: MarketSettings; advice: AdviceSettings; masteryRank?: number | null; credits?: number | null } = $props();

  const r = $derived(settings.bulk);
  const anyTicked = $derived(r.sets || r.arcanes || r.mods || r.parts || r.imprints || r.other);

  // A plan made with other ticks or another minimum no longer says what Apply would do: it stays
  // on screen, marked, until you plan again.
  let plannedWith = $state("");
  const rulesKey = $derived(JSON.stringify([r, settings.minPrice, settings.minRelicPrice, settings.minShare, settings.sellable]));
  const stale = $derived(!!mkt.bulk && rulesKey !== plannedWith);
  // Waiting for the relic prices orbiter reads on start: the button says so, rather than nothing.
  let waiting = $state(false);
  // Plan, Apply and Remove all fill as they go (mkt.progress) and say how they ended.
  const planJob = new Job();
  const applyJob = new Job();
  const removeJob = new Job();
  const fill = (op: string) => (mkt.op === op && mkt.progress?.total ? mkt.progress.done / mkt.progress.total : null);
  const count = (op: string, verb: string) => (mkt.op === op && mkt.progress ? `${verb} ${mkt.progress.done}/${mkt.progress.total}` : `${verb}…`);
  /** The store's error from this run: said on the button, so not at the top of the page as well. */
  const failure = () => {
    const e = mkt.error;
    mkt.error = null;
    return e;
  };
  function plan() {
    void planJob.run(async () => {
      await makePlan();
      const e = failure();
      if (e) throw new JobError("Couldn't plan", e);
      const n = (mkt.bulk?.actions ?? []).filter((a) => a.type !== "skip").length;
      return n ? `${n} to change` : "Nothing to change";
    });
  }
  function apply() {
    void applyJob.run(async () => {
      const r = await mkt.applyBulk(model, settings, advice);
      if (!r) return null;
      if (r.outcome === "changed") throw new JobError("Plan changed", "Your inventory or listings changed since the plan: look over the updated plan and apply again");
      if (r.outcome === "replanned") throw new JobError("Plan refreshed", "That plan was over 10 minutes old, so its prices were read again: look it over and apply again");
      if (r.outcome === "stopped") throw new JobError("Stopped", failure() ?? `Stopped after ${r.sent} changes`);
      if (r.failed) throw new JobError(`${r.failed} failed`, `${r.sent} change${r.sent === 1 ? "" : "s"} made, ${r.failed} refused: the Activity log above says why`);
      return `${r.sent} done`;
    });
  }
  function removeAll() {
    void removeJob.run(async () => {
      const r = await mkt.removeAll();
      if (!r) return null;
      const e = failure();
      if (e) throw new JobError("Stopped", e);
      if (r.failed) throw new JobError(`${r.failed} failed`, `${r.done} removed, ${r.failed} couldn't be: the Activity log above says why`);
      return `${r.done} removed`;
    });
  }

  async function makePlan() {
    plannedWith = rulesKey;
    // Relic prices still being read (orbiter just started): plan with them, not before them.
    if (mkt.relicRead) {
      waiting = true;
      try {
        await mkt.relicRead;
        await tick();
      } finally {
        waiting = false;
      }
    }
    await mkt.planBulk(model, settings, advice);
  }

  const actions = $derived(mkt.bulk?.actions ?? []);
  const changes = $derived(actions.filter((a) => a.type !== "skip"));
  // warframe.market's 100-listing cap: what the plan left out, or took down, to stay under it.
  const overLimit = $derived(actions.filter((a) => a.type === "skip" && (a.why === LIMIT_WHY || a.why === LIMIT_WHY_TRADES)).length);
  const madeRoom = $derived(actions.filter((a) => a.type === "remove" && a.why.startsWith("Makes room")).length);
  // Left out, the ones you can do something about first: prices that didn't load, the listing cap,
  // then your own listings the plan leaves as they are.
  const UNREAD = "Couldn't load its prices";
  const unread = $derived(actions.filter((a) => a.type === "skip" && a.why === UNREAD).length);
  const order = (why: string) => (why === UNREAD ? 0 : why === LIMIT_WHY || why === LIMIT_WHY_TRADES ? 1 : why.endsWith(AS_LISTED) ? 2 : why.includes("minimum") ? 4 : 3);
  const skipped = $derived(actions.filter((a) => a.type === "skip").sort((a, b) => order(a.why) - order(b.why)));
  const kinds = (t: BulkAction["type"]) => actions.filter((a) => a.type === t).length;
  const gain = $derived(
    changes.reduce((n, a) => n + (a.type === "create" ? a.quantity * a.platinum : a.type === "update" ? a.quantity * a.platinum - a.order.quantity * a.order.platinum : a.type === "remove" ? -a.order.quantity * a.order.platinum : 0), 0),
  );
  let showSkipped = $state(false);
  /** The trading tax for selling every copy in the plan's new and resized listings (the seller pays it, in credits). */
  const tax = $derived(planTax(model, actions));

  let confirmRemoveAll = $state(false);
  // The confirm takes the focus on its safe choice, so Esc (or Enter) keeps your listings.
  const focusIt = (node: HTMLElement) => node.focus();
  const keepOnEsc = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    confirmRemoveAll = false;
  };
  const rank = (n: number | null) => (n != null ? ` R${n}` : "");
  const image = (name: string) => model.imageOf(name.replace(/ Set$/, ""));
  const nameOf = (a: BulkAction) => (a.type === "skip" ? a.name : a.item.name);
  const rankOf = (a: BulkAction) => (a.type === "create" || a.type === "skip" ? a.rank : a.order.rank);
  /** A relic's refinement, so two lines for one relic say which is which. */
  const refinementOf = (a: BulkAction) => {
    const sub = a.type === "create" ? a.subtype : a.type === "skip" ? a.subtype : a.order.subtype;
    return sub && / Relic$/.test(nameOf(a)) ? sub.charAt(0).toUpperCase() + sub.slice(1) : null;
  };
  const WORD: Record<BulkAction["type"], string> = { create: "New", update: "Change", remove: "Remove", skip: "Skip" };
  const whole = (v: string, min: number) => Math.max(min, Math.round(Number(v)) || min);
</script>

<section class="spares">
  <header>
    <div>
      <h3 class="register">Put my spares on sale</h3>
      <p class="small dim">Lists what you can spare in the ticked categories at the cheapest in-game price, resizes listings you already have, and takes down the ones you have nothing left for. Listings you made yourself stay up while you hold them, unless warframe.market's {LISTING_LIMIT}-listing limit needs their place. Nothing else on your profile is touched.</p>
    </div>
    <div class="danger-zone">
      {#if confirmRemoveAll}
        <span class="small warn">Take all {mkt.orders.length} listings off warframe.market?</span>
        <button class="danger" disabled={!!mkt.busy} onclick={() => { confirmRemoveAll = false; removeAll(); }} onkeydown={keepOnEsc}>Remove all</button>
        <button onclick={() => (confirmRemoveAll = false)} onkeydown={keepOnEsc} use:focusIt>Keep them</button>
      {:else}
        <ProgressButton variant="link" tone="dim" class="removeall" job={removeJob} label="Remove all my listings" working={count("Removing every listing", "Removing")} progress={fill("Removing every listing")} sizer={["Removing 000/000"]} title="Take every one of your sell listings off warframe.market" disabled={!!mkt.busy || !mkt.orders.length} onclick={() => (confirmRemoveAll = true)} />
      {/if}
    </div>
  </header>

  <div class="ticks">
    <Chip bind:on={settings.bulk.sets} line="sets" label="Sets I don't need" title="Every complete set of what you've mastered or built; for anything else, all but the one you keep to build and master" />
    <Chip bind:on={settings.bulk.arcanes} game="vosfor" label="Extra maxed arcanes" title="Maxed arcanes beyond the one you keep, at max rank (never ones worth more dissolved for Vosfor)" />
    <Chip bind:on={settings.bulk.mods} game="endo" label="Extra mods" title="Copies beyond the two you keep (your best one, and one to give a new player), for mods that sell at least once a day" />
    <span class="partrule">
      <Chip bind:on={settings.bulk.parts} game="ducats" label="Spare prime parts" title="The spares Prime parts counts (everything beyond what you need to build and master), as loose parts: never ones going out in a set, never one that's a better deal as ducats" />
      <label class="keepn" title="Copies of each part to hold on to whatever the advice; 0 sells every spare"><span class="register">keep</span><input type="number" min="0" inputmode="numeric" value={settings.bulk.partsKeep} disabled={!settings.bulk.parts} aria-label="Copies of each prime part to keep" onchange={(e) => (settings.bulk.partsKeep = whole(e.currentTarget.value, 0))} onwheel={(e) => e.currentTarget.blur()} /></label>
    </span>
    <Chip bind:on={settings.bulk.imprints} game="companions" label="Imprints" title="Every Kubrow, Kavat and other companion imprint you hold, listed by breed (an imprint only hatches a companion: untick, or take the listing down, for ones you'll breed)" />
    <Chip bind:on={settings.bulk.other} game="market" label="Everything else I don't need" title="Weapon parts and blueprints, gems, fish, Captura scenes and Ayatan sculptures beyond what your unbuilt items need (Inventory, Spare only, shows each one and why), plus veiled rivens and relics if you sell them (Settings, Selling). Only what sells at least once a day, and never a relic worth more cracked" />
    <span class="prio" title="Only matters when there's more to list than warframe.market's {LISTING_LIMIT} listings allow: which ones get the slots. Either way only what the ticks and your minimum price let through">
      <Seg label="More than {LISTING_LIMIT} listings? Keep" bind:value={settings.bulk.priority} options={[
        { v: "plat", label: "Most plat", title: "The listings worth the most platinum (quantity × price)" },
        { v: "trades", label: "Sells most often", title: "The listings that sell most often (most trades a day on warframe.market), so your slots keep turning over" },
      ]} />
    </span>
    <span class="dim small minnote" title="Your minimum price, set next to Floor above your listings: nothing cheaper is listed">Skips anything under {settings.minPrice}p{settings.bulk.other ? `, relics under ${settings.minRelicPrice}p` : ""}</span>
    <ProgressButton class="planbtn" job={planJob} label={mkt.bulk ? "Plan again" : "Plan the changes"} working={waiting ? "Waiting for relics" : count("Working out what to list", "Pricing")} progress={fill("Working out what to list")} sizer={["Waiting for relics", "000 to change"]}
      title={!anyTicked ? "Tick at least one kind of thing to sell first" : "Read the prices of everything you can spare in the ticked categories and work out the changes, for you to look over before anything is sent"} disabled={!anyTicked || !!mkt.op} onclick={plan} />
  </div>
  <!-- Why the last plan, apply or remove-all failed, here by its buttons rather than at the top of the page. -->
  {#each [planJob, applyJob, removeJob].filter((j) => j.state === "failed" && j.error) as j (j)}<p class="small err" role="status">{j.error}</p>{/each}

  {#if mkt.bulk}
    {#if overLimit || madeRoom}{@const fast = r.priority === "trades"}<p class="small warn">warframe.market allows {LISTING_LIMIT} listings, so the plan keeps the ones {fast ? "that sell most often" : "worth the most platinum"}{overLimit ? `: ${overLimit} ${fast ? "slower-selling" : "cheaper"} thing${overLimit === 1 ? " is" : "s are"} left out` : ""}{madeRoom ? `${overLimit ? " and" : ":"} ${madeRoom} ${fast ? "slower-selling" : "cheaper"} listing${madeRoom === 1 ? " comes" : "s come"} down to make room` : ""}.</p>{/if}
    {#if unread}<p class="small warn">warframe.market didn't answer for {unread} item{unread === 1 ? "" : "s"}, so {unread === 1 ? "it isn't" : "they aren't"} in this plan. Plan again to retry.</p>{/if}
    {#if stale}<p class="small warn">You changed what to sell since this plan: plan again before applying.</p>{/if}
    {#if !changes.length}
      <p class="small">{unread ? "Nothing to change among what could be priced." : "Your listings already match: nothing to change."}{skipped.length ? ` ${skipped.length} thing${skipped.length === 1 ? " was" : "s were"} left out (below).` : ""}</p>
    {:else}
      <div class="summary">
        <span><strong>{kinds("create")}</strong> new</span>
        <span><strong>{kinds("update")}</strong> changed</span>
        <span><strong>{kinds("remove")}</strong> removed</span>
        <span class="dim">Listed value {gain >= 0 ? "+" : "−"}<P v={Math.abs(gain)} /></span>
        <div class="grow"></div>
        <ProgressButton tone="gold" job={applyJob} label="Apply the plan ({changes.length})" working={count("Updating your listings", "Applying")} progress={fill("Updating your listings")} sizer={["Applying 000/000"]}
          title={stale ? "You changed what to sell since this plan: plan again first" : "Send these changes to warframe.market, one at a time"} disabled={!!mkt.busy || stale} onclick={apply} />
        <button disabled={!!mkt.busy} onclick={() => (mkt.bulk = null)}>Cancel</button>
      </div>
      {#if masteryRank != null && masteryRank >= 2}
        {@const copies = changes.reduce((n, a) => n + (a.type === "remove" ? 0 : a.quantity), 0)}
        {@const days = daysToTrade(copies, masteryRank)}
        {#if days != null && days > 1}<p class="dim small" title="Trades a day are your Mastery Rank ({masteryRank}), each carrying up to 6 items; buyers often take just one, so it's usually longer">{copies.toLocaleString("en")} copies in new or changed listings: at {masteryRank} trades a day, 6 items each at best, selling them all takes {days} days or more.</p>{/if}
      {/if}
      {#if tax.credits > 0}
        {@const short = credits != null && tax.credits > credits}
        <p class="small" class:warn={short} class:dim={!short} title="Warframe charges the one handing an item over a credit tax for it: by kind and rarity (2,000 a prime part, a set per part, mods 2,000–1,000,000 by rarity, arcanes by rarity and rank, relics 2,000 or 4,000 by era). This is the base tax for selling every copy listed; Maroo's Bazaar adds 10%, a clan dojo up to 100%{tax.unknown.length ? `. Not counted, tax unknown: ${tax.unknown.join(', ')}` : ''}"><GameIcon name="credits" size={12} /> Selling all of it costs about {shortCredits(tax.credits)} credits in trade tax ({shortCredits(tax.maroo)} in Maroo's Bazaar){#if short}: more than the {shortCredits(credits!)} you have, so some trades won't go through until you farm credits{:else if credits != null}; you have {shortCredits(credits)}{/if}{tax.unknown.length ? `, plus ${tax.unknown.length} item${tax.unknown.length === 1 ? "" : "s"} orbiter can't price the tax of` : ""}.</p>
      {/if}
      <div class="planbox">
      <table class="plan">
        <thead><tr><th></th><th>Item</th><th>Kind</th><th class="right">Quantity</th><th class="right">Price</th><th class="why">Why</th></tr></thead>
        <tbody>
          {#each changes as a, i (i)}
            <tr class={a.type}>
              <td><span class="what">{WORD[a.type]}</span></td>
              <td><Named file={image(nameOf(a))} name={nameOf(a)} size={26}>{#if rankOf(a) != null}<span class="tag">R{rankOf(a)}</span>{/if}{#if refinementOf(a)}<span class="tag" class:ok={refinementOf(a) === "Radiant"}>{refinementOf(a)}</span>{/if}</Named></td>
              <td class="dim small">{KIND_LABEL[a.kind]}</td>
              <td class="right">
                {#if a.type === "create"}{a.quantity}{:else if a.type === "update"}{#if a.order.quantity !== a.quantity}<span class="dim">{a.order.quantity} →</span> {/if}{a.quantity}{:else if a.type === "remove"}<s class="dim">{a.order.quantity}</s>{/if}
              </td>
              <td class="right">
                {#if a.type === "create"}<P v={a.platinum} />{:else if a.type === "update"}{#if a.order.platinum !== a.platinum}<span class="dim">{a.order.platinum} →</span> {/if}<P v={a.platinum} />{:else if a.type === "remove"}<s class="dim"><P v={a.order.platinum} dim /></s>{/if}
              </td>
              <td class="dim small why">{a.type === "remove" ? a.why : `${a.why} · ${a.priceWhy}`}</td>
            </tr>
          {/each}
        </tbody>
      </table>
      </div>
    {/if}
    {#if skipped.length}
      <button class="link more" onclick={() => (showSkipped = !showSkipped)}>{showSkipped ? "Hide" : "Show"} {skipped.length} left out</button>
      {#if showSkipped}
        <ul class="skipped">
          {#each skipped as a, i (i)}<li><span class="sk" use:info={nameOf(a)}>{nameOf(a)}{rank(rankOf(a))}</span><span class="dim small">{a.why}</span></li>{/each}
        </ul>
      {/if}
    {/if}
  {/if}
</section>

<style>
  .spares { border: 1px solid var(--rule); background: rgb(17 19 23 / 70%); padding: 1.1rem 1.3rem; margin: var(--step) 0; display: grid; gap: .9rem; box-shadow: inset 3px 0 0 var(--gold-dim); }
  header { display: flex; justify-content: space-between; gap: 1.5rem; align-items: flex-start; }
  h3 { margin: 0 0 .35rem; color: var(--gold); }
  header p { margin: 0; max-width: 70ch; }
  .danger-zone { display: flex; align-items: center; gap: .6rem; flex-wrap: wrap; justify-content: flex-end; }
  .danger-zone :global(.removeall:not(.done):not(.failed)) { color: var(--platinum-deep); white-space: nowrap; }
  .danger-zone :global(.removeall:not(.done):not(.failed):hover:not(:disabled)) { color: var(--oxblood); }
  .err { color: var(--oxblood); margin: 0; }
  .warn { color: var(--alert); }
  .warn::before { content: "! "; font-weight: 700; }
  .ticks { display: flex; flex-wrap: wrap; align-items: center; gap: .6rem 1rem; }
  .partrule { display: inline-flex; align-items: center; gap: .45rem; }
  .keepn { display: inline-flex; align-items: center; gap: .35rem; }
  .keepn .register { font-size: .6rem; }
  .ticks input[type="number"] { width: 4.2rem; padding: .4rem .5rem; height: 32px; }
  .ticks :global(.planbtn) { margin-left: auto; }
  .summary { display: flex; align-items: center; flex-wrap: wrap; gap: .5rem 1.2rem; font-size: .86rem; }
  .summary strong { color: var(--platinum); font-family: var(--face-mark); font-size: 1.2rem; margin-right: .2rem; }
  .grow { flex: 1; }
  .plan { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  .plan th { text-align: left; font-family: var(--face-register); font-weight: 500; font-size: .6rem; letter-spacing: .14em; text-transform: uppercase; color: var(--platinum-deep); padding: .4rem .6rem; border-bottom: 1px solid var(--rule); }
  .plan td { padding: .45rem .6rem; border-bottom: 1px solid var(--rule); font-size: .84rem; }
  .plan th:first-child, .plan td:first-child { padding-left: 0; width: 1%; }
  .plan .right { text-align: right; white-space: nowrap; }
  .plan th.right { text-align: right; }
  .plan td { vertical-align: middle; }
  .plan .why { padding-left: 1.4rem; }
  .what { font-family: var(--face-register); font-size: .6rem; letter-spacing: .12em; text-transform: uppercase; padding: .15rem .4rem; border: 1px solid var(--rule-bright); white-space: nowrap; }
  tr.create .what { color: var(--verdigris); border-color: var(--verdigris); }
  tr.update .what { color: var(--gold); border-color: var(--gold-dim); }
  tr.remove .what { color: var(--oxblood); border-color: var(--oxblood); }
  tr.remove :global(.name-mark) { color: var(--platinum-dim); }
  .more { justify-self: start; }
  .planbox { max-height: 60vh; overflow: auto; border-bottom: 1px solid var(--rule); }
  .planbox th { position: sticky; top: 0; background: var(--plate); z-index: 1; }
  .minnote { white-space: nowrap; }
  .skipped { max-height: 40vh; overflow: auto; margin: 0; padding: 0; list-style: none; display: grid; gap: .3rem; font-size: .84rem; }
  .skipped li { display: flex; align-items: baseline; gap: .8rem; }
  .sk { font-family: var(--face-mark); font-weight: 700; text-transform: uppercase; color: var(--platinum-dim); white-space: nowrap; cursor: default; }
  .sk:hover { color: var(--platinum); }
</style>
