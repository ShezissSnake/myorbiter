<script lang="ts">
  import { scrim } from "./scrim";
  // The Sell form, over whatever page you're on: priced at the cheapest seller who is
  // in game right now, with the quantity set to what you can spare.
  import type { Model } from "../core/model";
  import { listingKey, referencePrice } from "../core/market";
  import type { MarketSettings } from "../backend";
  import type { DucatOptions } from "../core/advice";
  import { relicCrackFor } from "../core/spares";
  import { minFor, mkt } from "../marketStore.svelte";
  import { MAX_PLAT, MAX_QTY, amountProblem, shown, wholeIn } from "../core/amounts";
  import Named from "./Named.svelte";
  import P from "./P.svelte";
  import GameIcon from "./GameIcon.svelte";
  import ProgressButton from "./ProgressButton.svelte";
  import { trap } from "./trap";
  import { opens, pulse, shade } from "../motion";
  import { neverSells } from "../core/sparesRules";

  // market: your Orders settings, so the form can say when a price is under the floor the
  // repricer holds listings at.
  let { model, go, market = null, advice = null, onsellagain = () => {} }: { model: Model; go: (tab: string) => void; market?: MarketSettings | null; advice?: DucatOptions | null; onsellagain?: (ids: string[]) => void } = $props();

  const open = $derived(!!(mkt.draft || mkt.draftError || mkt.drafting || mkt.draftDone));
  const d = $derived(mkt.draft);
  const existing = $derived(d ? mkt.existingFor(d) : null);
  const item = $derived(d ? mkt.item(d.itemId) : undefined);
  const median = $derived(d && item ? referencePrice(model, item, d.rank, d.subtype) : null);
  const low = $derived(d?.platinum != null && median != null && d.platinum < median * 0.5);
  /** The lowest price Orders' repricer keeps this listing at: your minimum, the share of the median, a floor you set. */
  const floor = $derived.by(() => {
    if (!market || !d) return null;
    const own = existing ? market.floors[listingKey(existing)] : null;
    return Math.max(1, item ? minFor(market, item) : market.minPrice, median != null ? Math.ceil(median * market.minShare) : 0, own ?? 0);
  });
  const underFloor = $derived(d?.platinum != null && floor != null && d.platinum < floor);
  /** A relic: what one crack at this refinement is worth, when the price is no more than that. */
  const crackBeats = $derived.by(() => {
    if (!item || d?.platinum == null) return null;
    const crack = relicCrackFor(model, item.name, d.subtype ?? d.subtypes?.[0] ?? null, advice?.platPerDucat ?? 0, advice?.squad ?? 1);
    return crack != null && d.platinum <= crack ? crack : null;
  });
  /** "An intact", "A radiant": the refinement, for the sentence that starts with it. */
  const anRefinement = $derived.by(() => {
    const ref = d?.subtype ?? "intact";
    return `${"aeiou".includes(ref.charAt(0)) ? "An" : "A"} ${ref}`;
  });
  /** A prime part's or set's ducats, when they're worth more to you (your ducat rate) than this price. */
  const ducats = $derived.by(() => {
    if (!advice || !item || d?.platinum == null) return null;
    const part = model.partByName.get(item.name)?.[0];
    const set = item.gameRef ? model.partsByParent.get(item.gameRef) : undefined;
    const n = part ? part.ducats : item.tags?.includes("set") && set?.length ? set.reduce((k, p) => k + p.ducats * p.required, 0) : 0;
    const worth = n * advice.platPerDucat;
    return n && worth >= d.platinum ? { n, worth: Math.round(worth * 10) / 10 } : null;
  });
  /** Copies already on your listing count against what you can spare. */
  const merging = $derived(!!existing && !!d?.addToExisting);
  const room = $derived(d?.available == null ? null : Math.max(0, d.available - (merging && existing ? existing.quantity : 0)));
  const tooMany = $derived(room != null && !!d && d.quantity > room);
  /** More than you hold at this rank / variant (counting what's listed already): that can't be delivered. */
  const heldHere = $derived.by(() => {
    if (!d || !d.held.length) return null;
    const def = d.subtypes?.[0] ?? null;
    return d.held.filter((h) => h.rank === d.rank && (h.subtype ?? def) === (d.subtype ?? def)).reduce((n, h) => n + h.count, 0);
  });
  const oversell = $derived(heldHere != null && !!d && d.quantity + (merging && existing ? existing.quantity : 0) > heldHere);
  /** None held at the rank or variant picked: nothing to list there. */
  const noneHere = $derived(heldHere === 0 && !merging);
  // When the form opens on something already listed, start from what's left to add: once per
  // form and rank / variant, so opening it again starts over.
  let sizedFor: object | null = null;
  let sized = "";
  $effect(() => {
    if (!d) return;
    const key = `${d.rank}:${d.subtype}`;
    if (sizedFor === d && sized === key) return;
    sizedFor = d;
    sized = key;
    if (existing && room != null) d.quantity = room;
  });
  /** Nothing left to add: the form only changes the listing's price. */
  const repriceOnly = $derived(merging && !!d && d.quantity === 0);
  /** The order book couldn't be read (offline, or warframe.market down): the price is yours to set. */
  const bookFailed = $derived(!!d && !d.priced && !!mkt.draftError);

  // The form takes the focus while it's open (so Esc closes it whatever is loading), keeps Tab
  // inside it and gives the focus back to what opened it (use:trap). The price box gets it once
  // the first price is in.
  let priceInput = $state<HTMLInputElement | null>(null);
  let focusedFor: object | null = null;
  $effect(() => {
    if (!d?.priced || !priceInput || focusedFor === d) return;
    focusedFor = d;
    priceInput.focus();
  });

  // Whole numbers only: warframe.market takes whole platinum and copies, and an empty box isn't 0.
  const badNumber = $derived(d ? amountProblem(d.quantity, d.platinum, merging ? 0 : 1) : null);
  // On the never-sell list (Sell spares): refused by the last check too; Sell again takes it off.
  const neverSold = $derived(!!d && !!market?.spares && neverSells(market.spares, d.itemId));
  function sellAgain() {
    if (!d || !market?.spares) return;
    onsellagain([d.itemId]);
    mkt.draftError = null;
  }
  const ready = $derived(
    !!d && wholeIn(d.platinum, 1, MAX_PLAT) && wholeIn(d.quantity, merging ? 0 : 1, MAX_QTY) && !oversell && !(repriceOnly && existing?.platinum === d.platinum) && !mkt.busy,
  );
  /** Enter in the quantity or price box lists it, as Save does on Orders. */
  function enter(e: KeyboardEvent) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (ready) mkt.submitDraft();
  }
  // Listed: say so for a moment, then close.
  $effect(() => {
    if (!mkt.draftDone) return;
    const t = setTimeout(() => mkt.closeDraft(), 2500);
    return () => clearTimeout(t);
  });
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="scrim" use:scrim in:shade|global out:shade|global onclick={() => mkt.closeDraft()}>
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="dialog" role="dialog" in:opens|global={{ fade: false }} out:opens|global={{ fade: false }} tabindex="-1" aria-modal="true" aria-label="Sell on warframe.market" use:trap={{ onescape: () => mkt.closeDraft() }} onclick={(e) => e.stopPropagation()}>
      <div class="register head">Sell on warframe.market</div>

      {#if mkt.draftDone && !d}
        <p class="done" role="status">{mkt.draftDone}.</p>
        <div class="row end"><button onclick={() => mkt.closeDraft()}>Close</button></div>
      {:else if mkt.drafting && !d}
        <p class="dim">Finding {mkt.drafting} on warframe.market…</p>
      {:else if !d}
        <p class="err">{mkt.draftError}</p>
        <div class="row end"><button onclick={() => mkt.closeDraft()}>Close</button></div>
      {:else}
        <Named file={model.imageOf(d.name.replace(/ Set$/, ""))} name={d.name} size={44} />

        {#if mkt.signInRefused}
          <p class="prose">warframe.market refused orbiter's sign-in (it expired, or was signed out elsewhere). Sign out on Orders, then sign in again.</p>
          <div class="row end">
            <button onclick={() => mkt.closeDraft()}>Cancel</button>
            <button class="stamp gold" onclick={() => { mkt.closeDraft(); go("market"); }}>Open Orders</button>
          </div>
        {:else if mkt.accountError}
          <p class="prose">You're signed in, but warframe.market can't be reached right now: {mkt.accountError}. orbiter tries again every minute; list it once it answers.</p>
          <div class="row end"><button onclick={() => mkt.closeDraft()}>Close</button></div>
        {:else if !mkt.linked}
          <p class="prose">Sign in to warframe.market first. orbiter keeps its own sign-in; you only do it once.</p>
          <div class="row end">
            <button onclick={() => mkt.closeDraft()}>Cancel</button>
            <button class="stamp gold" onclick={() => { mkt.closeDraft(); go("market"); }}>Sign in on Orders</button>
          </div>
        {:else}
          <div class="fields">
            {#if d.maxRank != null}
              <label><span class="register">Rank</span>
                <select bind:value={d.rank} onchange={() => mkt.retarget()}>
                  {#each Array.from({ length: d.maxRank + 1 }, (_, i) => i) as r (r)}<option value={r}>{r === d.maxRank ? `${r} (max)` : r}</option>{/each}
                </select>
              </label>
            {/if}
            {#if d.subtypes?.length}
              <label><span class="register">Variant</span>
                <select bind:value={d.subtype} onchange={() => mkt.retarget()}>{#each d.subtypes as st (st)}<option value={st}>{st}</option>{/each}</select>
              </label>
            {/if}
            {#if merging && room === 0 && existing}
              <div class="static"><span class="register">Listed</span><strong>{existing.quantity}</strong></div>
            {:else}
              <label><span class="register">{merging ? "Add" : "Quantity"}</span>
                <input type="number" min={merging ? 0 : 1} max={MAX_QTY} step="1" bind:value={d.quantity} onkeydown={enter} title={merging ? "How many more copies to add to your listing (0 changes only its price)" : "How many copies to list: a whole number"} />
              </label>
            {/if}
            <label><span class="register">Price each</span>
              <span class="pricebox"><input class="price" type="number" min="1" max={MAX_PLAT} step="1" title="Platinum for each copy: a whole number" bind:value={d.platinum} bind:this={priceInput} onkeydown={enter} placeholder={d.priced || bookFailed ? "your price" : "…"} /><GameIcon name="platinum" size={14} /></span>
            </label>
          </div>

          <div class="facts small">
            {#if bookFailed}
              <span class="warn">Couldn't read the order book: set the price yourself.</span>
            {:else if !d.priced}
              <span class="dim">Reading the order book…</span>
            {:else if d.inGame}
              <span>Matched to the cheapest seller in game: <P v={d.ladder[0]} />{#if d.ladder.length > 1}<span class="dim">{" · "}then {d.ladder.slice(1, 4).map((x) => `${x}p`).join(", ")}</span>{/if}</span>
            {:else}
              <span class="dim">Nobody is selling this in game right now: set the price yourself.</span>
            {/if}
            {#if median != null}<span class="dim">Daily median <P v={median} dim /></span>{/if}
            {#if d.available != null}<span class="dim">You can spare {d.available}</span>{/if}
          </div>

          {#if badNumber}<p class="err small">{badNumber}</p>
          {:else if noneHere}<p class="err small">You hold none at this {d.maxRank != null ? "rank" : "variant"}: pick one you have.</p>
          {:else if oversell}<p class="err small">You hold {heldHere} at this {d.maxRank != null ? "rank" : "variant"}{merging && existing ? `, ${existing.quantity} listed already` : ""}: you can't list more than that.</p>
          {:else if tooMany}<p class="warn small">{merging && existing ? `You can spare ${d.available} and ${existing.quantity} are listed already, so ${room} more at most.` : `That's more than the ${d.available} you can spare; the rest are copies orbiter keeps back for you.`}</p>{/if}
          {#if repriceOnly && existing}<p class="small dim">All you can spare is listed already ({existing.quantity} at {existing.platinum}p). This only changes the price.</p>{/if}
          {#if underFloor && market}<p class="warn small">Under your {floor}p floor{market.auto ? `: Apply automatically lifts it to at least ${floor}p while anyone in game sells it` : " (Floor and Never under, on Orders)"}.</p>
          {:else if low}<p class="warn small">Under half the daily median. Check the price before listing.</p>{/if}
          {#if crackBeats != null}<p class="warn small">{anRefinement} crack of it is worth about {crackBeats}p{(advice?.squad ?? 1) > 1 ? " in a radshare" : ""}: cracking beats selling at {d.platinum}p.</p>{/if}
          {#if ducats}<p class="warn small">Worth more as ducats: {ducats.n} ducats are about {ducats.worth}p to you (your rate, on Prime parts). Sell spares keeps it off the market.</p>{/if}
          {#if neverSold && !repriceOnly}<p class="warn small never">On your never-sell list (Sell spares), so orbiter won't list it. <button type="button" class="link" title="Take it off the never-sell list: it can be listed here, and Sell spares lists it again when it's spare" onclick={(e) => { pulse(e.currentTarget.parentElement!); sellAgain(); }}>Sell again</button></p>{/if}

          {#if existing}
            <label class="merge small">
              <input type="checkbox" bind:checked={d.addToExisting} />
              Add to your listing ({existing.quantity} at {existing.platinum}p) instead of making a second one
            </label>
          {/if}
          {#if mkt.draftError && !bookFailed}<p class="err small">{mkt.draftError}</p>{/if}

          {#if !merging}<p class="dim small foot">It joins your Orders, where Reprice (or Apply automatically) keeps it at the cheapest in-game price.</p>{/if}
          <div class="row end">
            <button onclick={() => mkt.closeDraft()}>Cancel</button>
            <ProgressButton tone="gold" busy={mkt.op === "Listing"} label={repriceOnly ? (d.platinum ? `Set price to ${d.platinum}p` : "Set the price") : `${merging ? "Add" : "Sell"} ${shown(d.quantity)}${d.platinum ? ` at ${d.platinum}p` : ""}`} working={repriceOnly ? "Setting…" : merging ? "Adding…" : "Listing…"}
              title={repriceOnly ? "Change your listing's price on warframe.market" : merging ? "Add these to your listing on warframe.market" : "Put it up for sale on warframe.market"} disabled={!ready} onclick={() => mkt.submitDraft()} />
          </div>
        {/if}
      {/if}
    </div>
  </div>
{/if}

<style>
  .scrim { position: fixed; inset: 0; z-index: 50; background: rgb(6 7 9 / 72%); display: grid; place-items: center; padding: 1rem; }
  .dialog { clip-path: var(--cut); width: min(34rem, 100%); background: var(--plate); border: 1px solid var(--rule-bright); padding: 1.3rem 1.5rem 1.1rem; display: grid; gap: .9rem; box-shadow: 0 1.5rem 4rem rgb(0 0 0 / 50%); }
  .head { color: var(--gold); }
  .fields { display: flex; flex-wrap: wrap; gap: .8rem; }
  .fields label { display: grid; gap: .3rem; }
  .fields input { width: 6.5rem; text-align: right; }
  .fields input.price { width: 8rem; }
  /* A field, not a button: the hint in plain lower case, platinum's mark beside the box. */
  .fields input.price::placeholder { font-family: inherit; font-size: .85rem; letter-spacing: 0; text-transform: none; font-style: italic; }
  .pricebox { display: inline-flex; align-items: center; gap: .4rem; }
  .static { display: grid; gap: .3rem; }
  .static strong { font-family: var(--face-mark); font-size: 1.5rem; line-height: 1.4; }
  .facts { display: flex; flex-wrap: wrap; gap: .3rem 1.1rem; color: var(--platinum-dim); }
  .row { display: flex; gap: .6rem; align-items: center; }
  .end button { padding: .65rem 1rem; }
  .end { justify-content: flex-end; }
  .merge { display: flex; gap: .5rem; align-items: center; color: var(--platinum); }
  .warn { color: var(--alert); margin: 0; }
  .warn::before { content: "! "; font-weight: 700; }
  .err { color: var(--oxblood); margin: 0; }
  .foot { margin: 0; }
  .done { margin: 0; color: var(--verdigris); }
</style>
