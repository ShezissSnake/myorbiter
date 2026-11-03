<script lang="ts">
  // +rep for a trade partner, from your warframe.market account: their market name is their
  // in-game name. Reputation there is a positive review, one per player, with your message
  // (Settings, Trades). If it can't be given here, their profile is a click away.
  import { openUrl, profileUrl } from "../backend";
  import { mkt } from "../marketStore.svelte";
  import IconButton from "./IconButton.svelte";

  // label: the button's words ("+rep" where the partner is named beside it; "+rep Bob" on a notification).
  let { partner, text, given = false, ongiven, label = "+rep" }: { partner: string; text: string; given?: boolean; ongiven?: () => void; label?: string } = $props();

  let busy = $state(false);
  let error = $state<string | null>(null);
  let reported = $state(false);
  const known = $derived(mkt.users[partner.toLowerCase()]);

  async function give() {
    busy = true;
    error = null;
    try {
      // No account under that name: nothing to give it to.
      if (!(await mkt.user(partner))) return;
      const r = await mkt.giveRep(partner, text);
      if (r === "reported") reported = true;
      else ongiven?.();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
  /** The reason, short enough to sit beside the button (the whole of it is in the tooltip). */
  const why = $derived(error ? error.replace(/[:;(].*$/, "").trim() : null);
  async function profile() {
    const u = await mkt.user(partner).catch(() => null);
    openUrl(u ? profileUrl(u) : `https://warframe.market/profile/${encodeURIComponent(partner)}`);
  }
</script>

{#if known === null}
  <span class="note" title="Nobody on warframe.market goes by {partner}">Not on warframe.market</span>
{:else if given}
  <span class="note done" title="{partner} has your +rep on warframe.market">+rep given ✓</span>
{:else if reported}
  <span class="note" title="Your review of {partner} on warframe.market is a report: left as it is">You reported them</span>
{:else}
  <span class="rep">
    <button class="link" disabled={busy || !mkt.linked} title={!mkt.linked ? "Sign in to warframe.market on Orders first" : error ? `Couldn't give +rep: ${error}` : `Give ${partner} +rep on warframe.market, with "${text}"${known ? ` (they have ${known.reputation})` : ""}`} onclick={give}>{busy ? "Giving…" : error ? "Try again" : label}</button>
    {#if why}<span class="why" role="status" title={error}>{why}</span>{/if}
    {#if error || !mkt.linked}<IconButton icon="external" tone="quiet" size={12} label="Their profile" title={error ?? "Their warframe.market profile, to give +rep there"} onclick={profile} />{/if}
  </span>
{/if}

<style>
  .rep { display: inline-flex; align-items: center; gap: .5rem; white-space: nowrap; }
  .rep :global(.ib) { --ib: 24px; }
  .note { font-family: var(--face-register); font-size: .6rem; letter-spacing: .1em; text-transform: uppercase; color: var(--platinum-deep); white-space: nowrap; }
  .done { color: var(--verdigris); }
  /* Why +rep didn't go through: in oxblood beside the button. */
  .why { font-size: .74rem; color: var(--oxblood); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 22rem; }
</style>
