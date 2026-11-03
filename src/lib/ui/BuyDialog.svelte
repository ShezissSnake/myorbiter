<script lang="ts">
  // The "Post a buy order" form, over whatever page you're on: for a part or item you're after,
  // priced one over the best buyer in game and never up to the cheapest seller.
  import { tick } from "svelte";
  import type { Model } from "../core/model";
  import { mkt } from "../marketStore.svelte";
  import Named from "./Named.svelte";
  import P from "./P.svelte";
  import type { BuyAlert } from "../core/deals";
  import ProgressButton from "./ProgressButton.svelte";
  import { Job } from "../job.svelte";

  let { model, go, onalert = null }: { model: Model; go: (tab: string) => void; onalert?: ((a: BuyAlert) => void) | null } = $props();
  // Alert me: no order posted; Cheap buys tells you when someone lists it at or under the price.
  let alerted = $state(false);
  function alertMe() {
    if (!d || !d.platinum || !onalert) return;
    onalert({ name: d.name, rank: d.rank, subtype: d.subtype, maxPrice: Math.round(d.platinum), at: Date.now() });
    alerted = true;
    // A tick for a moment, so you see it was set, then the form goes.
    later(1500);
  }

  const open = $derived(!!(mkt.buyDraft || mkt.buyError));
  const d = $derived(mkt.buyDraft);
  // Paying the cheapest seller's price or more: just buy from them.
  const overSeller = $derived(!!d && d.platinum != null && d.cheapestSell != null && d.platinum >= d.cheapestSell);
  // At or over the cheapest seller, a buy order only overpays: buy from them instead.
  const ready = $derived(!!d && !d.loading && d.platinum != null && d.platinum >= 1 && d.quantity >= 1 && !overSeller && !mkt.busy && mkt.linked);
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
  function onKey(e: KeyboardEvent) {
    if (!open) return;
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    } else if (e.key === "Enter" && (e.target as HTMLElement)?.tagName === "INPUT") {
      e.preventDefault();
      void place();
    }
  }
</script>

<svelte:window onkeydown={onKey} />

{#snippet alertButton(d: NonNullable<typeof mkt.buyDraft>)}
  <ProgressButton stamp={false} state={alerted ? "done" : "idle"} label="Alert me at {d.platinum ?? '…'}p" doneLabel="Alert set" sizer={["Alert me at 0000p"]} disabled={!d.platinum || d.loading}
    title="Don't post anything: orbiter watches warframe.market (Cheap buys, on Home) and tells you when someone lists it at {d.platinum ?? '…'}p or less" onclick={alertMe} />
{/snippet}

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="scrim" onclick={close}>
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="dialog" role="dialog" tabindex="-1" aria-modal="true" aria-label="Post a buy order on warframe.market" bind:this={dialog} onclick={(e) => e.stopPropagation()}>
      <div class="register head">Post a buy order</div>
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
            <label><span class="register">How many</span><input type="number" min="1" max="999" bind:value={d.quantity} onwheel={(e) => e.currentTarget.blur()} /></label>
            <label><span class="register">Price each</span><input class="price" type="number" min="1" bind:value={d.platinum} placeholder={d.loading ? "…" : "price"} onwheel={(e) => e.currentTarget.blur()} /></label>
          </div>
          <div class="facts small">
            {#if d.loading}<span>Reading the order book…</span>
            {:else}
              <span title="The highest buy order from someone you can trade with">Best buyer <P v={d.topBuy} /></span>
              <span title="The cheapest seller you can trade with, online now">Cheapest seller <P v={d.cheapestSell} /></span>
              <span title="What it sold for over the last 30 days (median), so it can differ from the daily price elsewhere">Sold for <P v={d.median == null ? null : Math.round(d.median)} /></span>
            {/if}
          </div>
          {#if overSeller}<p class="warn small">That's the cheapest seller's price or more: whisper them and buy it now instead, or lower your price.</p>{/if}
          {#if mkt.error && mkt.op == null}<p class="err small" role="status">{mkt.error}</p>{/if}
          {#if !mkt.linked}
          <p class="prose small">To post a buy order, sign in to warframe.market first (orbiter keeps its own sign-in; you only do it once). An alert needs no sign-in.</p>
          <div class="row end">
            <button onclick={close}>Cancel</button>
            {#if onalert}{@render alertButton(d)}{/if}
            <button class="stamp gold" onclick={() => { close(); go("market"); }}>Sign in on Orders</button>
          </div>
          {:else}
          <div class="row end">
            <button onclick={close}>Cancel</button>
            {#if onalert}{@render alertButton(d)}{/if}
            <ProgressButton tone="gold" job={buyJob} label="Buy {d.quantity}{d.platinum ? ` at ${d.platinum}p` : ''}" working="Posting…" doneLabel="Posted" failLabel="Not posted" title="Post this buy order on warframe.market" disabled={!ready || buyJob.state === "done"} onclick={place} />
          </div>
          <p class="dim small foot">Sellers see it on warframe.market and whisper you in game. Your buy orders are on Orders, to change or take down.</p>
        {/if}
      {/if}
    </div>
  </div>
{/if}

<style>
  .scrim { position: fixed; inset: 0; z-index: 50; background: rgb(6 7 9 / 72%); display: grid; place-items: center; padding: 1rem; }
  .dialog { clip-path: var(--cut); width: min(32rem, 100%); background: var(--plate); border: 1px solid var(--rule-bright); padding: 1.3rem 1.5rem 1.1rem; display: grid; gap: .9rem; box-shadow: 0 1.5rem 4rem rgb(0 0 0 / 50%); }
  .head { color: var(--gold); }
  .fields { display: flex; flex-wrap: wrap; gap: .8rem; }
  .fields label { display: grid; gap: .3rem; }
  .fields input { width: 6.5rem; text-align: right; }
  .fields input.price { width: 8rem; }
  .facts { display: flex; flex-wrap: wrap; gap: .3rem 1.1rem; color: var(--platinum-dim); }
  .facts span { display: inline-flex; align-items: center; gap: .35rem; }
  .row { display: flex; gap: .6rem; align-items: center; }
  .end button { padding: .65rem 1rem; }
  .end { justify-content: flex-end; }
  .warn { color: var(--gold); margin: 0; }
  .err { color: var(--oxblood); margin: 0; }
  .foot { margin: 0; }
</style>
