<script lang="ts">
  import HelpMark from "./HelpMark.svelte";
  import { scrim } from "./scrim";
  // The "Post a buy order" form, over whatever page you're on: for a part or item you're after,
  // priced one over the best buyer in game and never up to the cheapest seller.
  import { tick } from "svelte";
  import type { Model } from "../core/model";
  import { mkt } from "../marketStore.svelte";
  import Named from "./Named.svelte";
  import P from "./P.svelte";
  import GameIcon from "./GameIcon.svelte";
  import type { BuyAlert } from "../core/deals";
  import ProgressButton from "./ProgressButton.svelte";
  import { Job } from "../job.svelte";
  import { trap } from "./trap";
  import { opens, shade } from "../motion";
  import { MAX_PLAT, MAX_QTY, amountProblem, shown, wholeIn } from "../core/amounts";

  let { model, go, onalert = null }: { model: Model; go: (tab: string) => void; onalert?: ((a: BuyAlert) => void) | null } = $props();
  // Alert me: no order posted; Cheap buys tells you when someone lists it at or under the price.
  let alerted = $state(false);
  function alertMe() {
    if (!d || !wholeIn(d.platinum, 1, MAX_PLAT) || !onalert) return;
    onalert({ name: d.name, rank: d.rank, subtype: d.subtype, maxPrice: Math.round(d.platinum), at: Date.now() });
    alerted = true;
    // A tick for a moment, so you see it was set, then the form goes.
    later(1500);
  }

  const open = $derived(!!(mkt.buyDraft || mkt.buyError));
  const d = $derived(mkt.buyDraft);
  /** The order book couldn't be read (offline, or warframe.market down): the price is yours to set. */
  const bookFailed = $derived(!!d && !d.loading && !!mkt.buyError);
  /** Read, but nobody is buying or selling it and it hasn't sold lately. */
  const bookEmpty = $derived(!!d && !d.loading && !mkt.buyError && d.topBuy == null && d.cheapestSell == null && d.median == null);
  /** Sold for: the last 30 days' median, or the price the card showed when there isn't one. */
  const soldFor = $derived(d ? (d.median ?? d.known ?? null) : null);
  // Paying the cheapest seller's price or more: just buy from them.
  const overSeller = $derived(!!d && d.platinum != null && d.cheapestSell != null && d.platinum >= d.cheapestSell);
  // At or over the cheapest seller, a buy order only overpays: buy from them instead.
  // Whole numbers only: warframe.market takes whole platinum and copies, and an alert at -5p never fires.
  const priceOk = $derived(!!d && wholeIn(d.platinum, 1, MAX_PLAT));
  const badNumber = $derived(d ? amountProblem(d.quantity, d.platinum) : null);
  const ready = $derived(!!d && !d.loading && priceOk && wholeIn(d.quantity, 1, MAX_QTY) && !overSeller && !mkt.busy && mkt.linked);
  let dialog = $state<HTMLDivElement | null>(null);
  $effect(() => {
    if (open) void tick().then(() => dialog?.querySelector<HTMLInputElement>("input.price")?.focus());
  });
  // The form closing itself after Posted or Alert me: one timer, cleared on close, so it can't
  // shut a draft opened in the meantime.
  let closing: ReturnType<typeof setTimeout> | null = null;
  function later(ms: number) {
    if (closing) clearTimeout(closing);
    closing = setTimeout(close, ms);
  }
  const close = () => {
    if (closing) clearTimeout(closing);
    closing = null;
    buyJob.reset();
    mkt.buyDraft = null;
    mkt.buyError = null;
    alerted = false;
  };
  // Buy: working while it posts, "Posted" with a tick for a moment, then the form closes.
  const buyJob = new Job();
  function place() {
    // Not while it posts or just posted; after a failure, pressing again tries again.
    if (!ready || buyJob.working || buyJob.state === "done") return;
    void buyJob.run(async () => {
      if (!(await mkt.placeBuy(true))) throw new Error(mkt.error ?? "warframe.market didn't take it");
      later(1200);
      return "Posted";
    });
  }
  // Esc, Tab kept inside and the focus back to what opened it: use:trap.
  function onKey(e: KeyboardEvent) {
    if (!open) return;
    if (e.key === "Enter" && (e.target as HTMLElement)?.tagName === "INPUT") {
      e.preventDefault();
      void place();
    }
  }
</script>

<svelte:window onkeydown={onKey} />

{#snippet alertButton(d: NonNullable<typeof mkt.buyDraft>)}
  <ProgressButton stamp={false} state={alerted ? "done" : "idle"} label="Alert me at this price" doneLabel="Alert set" sizer={["Alert me at this price"]} disabled={!priceOk || d.loading}
    title="Don't post anything: MyOrbiter watches warframe.market (Cheap buys, on Home) and tells you when someone lists it at {shown(d.platinum)}p or less" onclick={alertMe} />
{/snippet}

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="scrim" use:scrim in:shade|global out:shade|global onclick={close}>
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="dialog" role="dialog" in:opens|global={{ fade: false }} out:opens|global={{ fade: false }} tabindex="-1" aria-modal="true" aria-label="Post a buy order on warframe.market" bind:this={dialog} use:trap={{ onescape: close }} onclick={(e) => e.stopPropagation()}>
      <div class="register head"><span>Post a buy order</span><HelpMark part="buy" /></div>
      {#if !d}
        <p class="err">{mkt.buyError}</p>
        <div class="row end"><button onclick={close}>Close</button></div>
      {:else}
        <Named file={model.imageOf(d.name.replace(/ Set$/, "")) ?? mkt.index.byName.get(d.name.toLowerCase())?.thumb} name={d.name} size={44} />
        <!-- Signed in or not, the price can be set: an alert only reads the public order book. -->
          <div class="fields">
            {#if d.maxRank != null}
              <label><span class="register">Rank</span>
                <select value={d.rank} onchange={(e) => mkt.startBuy(d.name, { rank: Number(e.currentTarget.value), subtype: d.subtype, quantity: d.quantity })}>{#each Array.from({ length: d.maxRank + 1 }, (_, i) => i) as r (r)}<option value={r}>{r === d.maxRank ? `${r} (max)` : r}</option>{/each}</select>
              </label>
            {/if}
            {#if d.subtypes && d.subtypes.length > 1}
              <label><span class="register">{d.subtypes.includes("radiant") ? "Refinement" : "Variant"}</span>
                <select value={d.subtype} onchange={(e) => mkt.startBuy(d.name, { rank: d.rank, subtype: e.currentTarget.value, quantity: d.quantity })}>{#each d.subtypes as v (v)}<option value={v}>{v.charAt(0).toUpperCase() + v.slice(1)}</option>{/each}</select>
              </label>
            {/if}
            <label><span class="register">How many</span><input type="number" min="1" max={MAX_QTY} step="1" title="How many copies you want: a whole number" bind:value={d.quantity} onwheel={(e) => e.currentTarget.blur()} /></label>
            <label><span class="register">Price each</span><span class="pricebox"><input class="price" type="number" min="1" max={MAX_PLAT} step="1" title="Platinum you'd pay for each copy: a whole number" bind:value={d.platinum} placeholder={d.loading ? "…" : "your price"} onwheel={(e) => e.currentTarget.blur()} /><GameIcon name="platinum" size={14} /></span></label>
          </div>
          <div class="facts small">
            {#if d.loading}<span>Reading the order book…</span>
            {:else if bookFailed || bookEmpty}
              <span class="warn">{bookFailed ? "Couldn't read the order book" : "Nobody is buying or selling it right now"}: set the price yourself.</span>
              {#if soldFor != null}<span title={d.median == null ? "The price the page you came from showed for it" : "What it sold for over the last 30 days (median)"}>Sold for <P v={Math.round(soldFor)} /></span>{/if}
            {:else}
              <span title="The highest buy order from someone you can trade with">Best buyer <P v={d.topBuy} /></span>
              <span title="The cheapest seller you can trade with, online now">Cheapest seller <P v={d.cheapestSell} /></span>
              <span title={d.median == null && d.known != null ? "No sales on record for the last 30 days: the price the page you came from showed" : "What it sold for over the last 30 days (median), so it can differ from the daily price elsewhere"}>Sold for <P v={soldFor == null ? null : Math.round(soldFor)} /></span>
            {/if}
          </div>
          {#if badNumber}<p class="err small">{badNumber}</p>
          {:else if overSeller}<p class="warn small">That's the cheapest seller's price or more: whisper them and buy it now instead, or lower your price.</p>{/if}
          {#if mkt.error && mkt.op == null}<p class="err small" role="status">{mkt.error}</p>{/if}
          {#if !mkt.linked}
          <p class="prose small">To post a buy order, sign in to warframe.market first (MyOrbiter keeps its own sign-in; you only do it once). An alert needs no sign-in.</p>
          <div class="row end">
            <button onclick={close}>Cancel</button>
            {#if onalert}{@render alertButton(d)}{/if}
            <button class="stamp gold" onclick={() => { close(); go("market"); }}>Sign in on Orders</button>
          </div>
          {:else}
          <p class="dim small foot">Sellers see it on warframe.market and whisper you in game. Your buy orders are on Orders, to take down.</p>
          <div class="row end">
            <button onclick={close}>Cancel</button>
            {#if onalert}{@render alertButton(d)}{/if}
            <ProgressButton tone="gold" job={buyJob} label="Post buy order ({shown(d.quantity)})" working="Posting…" doneLabel="Posted" failLabel="Not posted" title={`Post this buy order on warframe.market: ${d.quantity} at ${d.platinum ?? "…"}p each`} disabled={!ready || buyJob.state === "done"} onclick={place} />
          </div>
        {/if}
      {/if}
    </div>
  </div>
{/if}

<style>
  .scrim { position: fixed; inset: 0; z-index: 50; background: rgb(6 7 9 / 72%); display: grid; place-items: center; padding: 1rem; }
  .dialog { clip-path: var(--cut); width: min(32rem, 100%); background: var(--plate); border: 1px solid var(--rule-bright); padding: 1.3rem 1.5rem 1.1rem; display: grid; gap: .9rem; box-shadow: 0 1.5rem 4rem rgb(0 0 0 / 50%); }
  .head { display: flex; align-items: center; justify-content: space-between; gap: 1rem; color: var(--gold); }
  .fields { display: flex; flex-wrap: wrap; gap: .8rem; }
  .fields label { display: grid; gap: .3rem; }
  .fields input { width: 6.5rem; text-align: right; }
  .fields input.price { width: 8rem; }
  /* A field, not a button: the hint in plain lower case, platinum's mark beside the box. */
  .fields input.price::placeholder { font-family: inherit; font-size: .85rem; letter-spacing: 0; text-transform: none; font-style: italic; }
  .pricebox { display: inline-flex; align-items: center; gap: .4rem; }
  .facts { display: flex; flex-wrap: wrap; gap: .3rem 1.1rem; color: var(--platinum-dim); }
  .facts span { display: inline-flex; align-items: center; gap: .35rem; }
  .row { display: flex; gap: .6rem; align-items: center; }
  .end button { padding: .65rem 1rem; }
  .end { justify-content: flex-end; }
  .warn { color: var(--gold); margin: 0; }
  .facts .warn { flex-basis: 100%; }
  .err { color: var(--oxblood); margin: 0; }
  .foot { margin: 0; }
</style>
