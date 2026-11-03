<script lang="ts">
  // Your status on warframe.market, which decides whether buyers see your listings. orbiter holds
  // it on its own connection (see presence.rs); while it does, a patched TennoScope keeps out of it.
  import { mkt } from "../marketStore.svelte";
  import type { MarketSettings, Presence } from "../backend";
  import Seg from "./Seg.svelte";

  // quiet: no explanatory line under it (Home); errors and warnings still show.
  let { settings, quiet = false }: { settings: MarketSettings; quiet?: boolean } = $props();

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
    mkt.setStatus("offline");
  }
</script>

<div class="row">
  <span class="seen">Seen as <strong class:live={visible} class:hidden={!visible && !connecting}>{seen}</strong></span>
  <Seg
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
{#if mkt.statusError || s?.error}
  <p class="note warn">{mkt.statusError ?? s?.error}</p>
{:else if !s?.wanted && !quiet}
  <p class="note">Offline: buyers don't see your listings. Pick a status and orbiter holds it while it's open; closing orbiter takes you offline.</p>
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
