<script lang="ts">
  // Your status on warframe.market, which decides whether buyers see your listings. orbiter holds
  // it on its own connection (see presence.rs); while it does, a patched TennoScope keeps out of it.
  import { mkt } from "../marketStore.svelte";
  import type { MarketSettings, Presence } from "../backend";
  import Seg from "./Seg.svelte";

  // quiet: no explanatory line under it (Home); errors and warnings still show.
  // tradesLeft / resets: today's trades (core/tradeLimit), for the out-of-trades offer.
  let { settings, quiet = false, tradesLeft = null, resets = null }: { settings: MarketSettings; quiet?: boolean; tradesLeft?: number | null; resets?: number | null } = $props();

  const WORD: Record<Presence, string> = { invisible: "Invisible", online: "Online", ingame: "Online in game" };
  const s = $derived(mkt.status);
  /** The switch shows what you clicked until warframe.market confirms it, then what it confirmed. */
  // "Online in game" chosen shows as chosen while it's Online for want of the game (App.svelte).
  const waiting = $derived(settings.presence === "ingame" && (s?.wanted === "online" || mkt.statusAsked === "online"));
  const shown = $derived<Presence | null>(waiting ? "ingame" : mkt.statusAsked && mkt.statusAsked !== "offline" ? mkt.statusAsked : (s?.committed ?? s?.wanted ?? null));
  const connecting = $derived(!!s?.wanted && !s.committed);
  const seen = $derived(s?.committed ? WORD[s.committed] : connecting ? "Connecting…" : "Offline");
  const visible = $derived(s?.committed === "online" || s?.committed === "ingame");
  // The choice on its way to warframe.market: underlined on the switch until it's confirmed.
  const chosen = $derived((s?.wanted || mkt.statusAsked ? (shown ?? "offline") : "offline") as Presence | "offline");
  const pending = $derived(mkt.statusAsked || connecting ? chosen : null);

  function pick(p: Presence) {
    settings.presence = p;
    mkt.setStatus(mkt.presenceFor(p));
  }
  function offline() {
    settings.presence = null;
    settings.presenceBack = null;
    mkt.setStatus("offline");
  }

  // Out of trades while buyers can see you: they'd whisper for trades you can't make until the
  // reset. Going invisible until then remembers what you had, and puts it back at 00:00 UTC.
  const outOfTrades = $derived(tradesLeft === 0 && visible && resets != null);
  function invisibleUntilReset() {
    if (!settings.presence || settings.presence === "invisible" || resets == null) return;
    const back = { p: settings.presence, until: resets };
    pick("invisible");
    settings.presenceBack = back;
  }
  // Back at the reset (checked every minute while orbiter runs, and on start).
  let clock = $state(Date.now());
  $effect(() => {
    const t = setInterval(() => (clock = Date.now()), 60_000);
    return () => clearInterval(t);
  });
  $effect(() => {
    const b = settings.presenceBack;
    if (!b || clock < b.until) return;
    settings.presenceBack = null;
    // Only if you're still on the invisible orbiter set: a status you chose since stands.
    if (settings.presence === "invisible") pick(b.p);
  });
</script>

<div class="row">
  <span class="seen">Seen as <strong class:live={visible} class:hidden={!visible && !connecting}>{seen}</strong></span>
  <!-- Manual: by keyboard, arrows move along and Enter picks, so Offline → Online in game doesn't
       send Invisible and Online on the way. -->
  <Seg
    manual
    value={chosen}
    onchange={(v: Presence | "offline") => (v === "offline" ? offline() : pick(v))}
    {pending}
    options={[
      { v: "offline", label: "Offline", title: "No connection: buyers see you as offline" },
      { v: "invisible", label: "Invisible", title: "Connected, but buyers don't see you or your listings" },
      { v: "online", label: "Online", title: "Buyers see you and your listings" },
      { v: "ingame", label: "Online in game", title: "Online, and shown as in game while Warframe runs (Online when it doesn't): buyers who want to trade now look for this" },
    ]}
  />
</div>
{#if outOfTrades}
  <p class="note warn out">No trades left today: buyers who whisper can't be served until 00:00 UTC. <button type="button" class="link" title="Invisible until the daily trade reset (00:00 UTC), then back to {WORD[settings.presence ?? 'online']}" onclick={invisibleUntilReset}>Go invisible until then</button></p>
{:else if settings.presenceBack && s?.committed === "invisible"}
  <p class="note">Invisible until 00:00 UTC (your trades ran out), then back to {WORD[settings.presenceBack.p]}. <button type="button" class="link" title="Stay as you are: don't change back at the reset" onclick={() => (settings.presenceBack = null)}>Stay invisible</button></p>
{:else if mkt.statusError || s?.error}
  <p class="note warn">{mkt.statusError ?? s?.error}</p>
{:else if !s?.wanted && !quiet}
  <p class="note" title="Pick a status and orbiter holds it while it's open; closing orbiter takes you offline">Buyers can't see your listings while you're offline.</p>
{:else if waiting}
  <p class="note">Online until TennoScope sees Warframe running, then Online in game: buyers who look for that expect an answer in game.</p>
{:else if s?.committed === "invisible"}
  <p class="note warn">Invisible: buyers don't see your listings until you're online.</p>
{/if}

<style>
  .row { display: flex; flex-wrap: wrap; align-items: center; gap: .6rem 1rem; }
  .seen { font-size: .84rem; color: var(--platinum-dim); }
  .seen strong { font-weight: 600; color: var(--platinum); }
  .seen strong.live { color: var(--verdigris); }
  .seen strong.hidden { color: var(--gold); }
  .note { margin: .4rem 0 0; font-size: .8rem; color: var(--platinum-deep); }
  .note.warn { color: var(--gold); }
</style>
