<script lang="ts" module>
  /** What Full mode does and what it risks, shown beside every switch that turns it on. */
  export const FULL_MODE_WARNING =
    "Full mode reads Warframe's memory to fetch your inventory. Warframe's EULA forbids unauthorised third-party programs, so using it could put your account at risk. orbiter only reads, and only sends your login session to Digital Extremes.";
</script>

<script lang="ts">
  // Full mode: TennoScope reads your inventory from the running game. Off until you turn it on,
  // here (first-run setup, the TennoScope panel, Settings), with the warning beside the switch.
  // Turning it off leaves the reward overlay (Overlay mode). orbiter passes the choice to the
  // TennoScope it runs (`--access=…`), which makes the same change as choosing in its own window.
  import { ts } from "./tennoscopeStore.svelte";
  import Switch from "./ui/Switch.svelte";

  let { kind = "button" }: { kind?: "button" | "switch" } = $props();

  const mode = $derived(ts.report?.setup.access_mode ?? null);
  const on = $derived(mode === "full");
  /** Asked, and TennoScope's report doesn't show the change yet. */
  const busy = $derived((ts.pending === "--access=full" && !on) || (ts.pending === "--access=overlay" && on));
  const ready = $derived(ts.running && !!ts.report);

  function set(full: boolean) {
    if (!ready || busy || full === on) return;
    void ts.ask(full ? "--access=full" : "--access=overlay");
  }
  // The switch shows what TennoScope reports, or the side you just flipped it to while that's
  // pending; a refused or failed change flips back once nothing is pending.
  let flipped = $state<boolean | null>(null);
  const shown = $derived(busy && flipped !== null ? flipped : on);
  function flip(v: boolean) {
    flipped = v;
    set(v);
  }
</script>

{#if kind === "switch"}
  <div class="full" class:off={!ready}>
    <Switch bind:on={() => shown, flip} label="Read my inventory (Full mode)">
      <span class="warn">{FULL_MODE_WARNING}</span>
      {#if !ready}<span class="state">TennoScope has to be running to change it.</span>{:else if busy}<span class="state">Changing…</span>{:else if mode && mode !== "full"}<span class="state">Off: TennoScope reads the reward screen ({mode === "overlay" ? "Overlay" : "Companion"} mode), not your inventory.</span>{/if}
    </Switch>
  </div>
{:else}
  <div class="full block">
    {#if on}
      <p class="prose small">Full mode is on: TennoScope reads your inventory from the running game.</p>
      <div><button disabled={!ready || busy} onclick={() => set(false)}>{busy ? "Turning it off…" : "Turn Full mode off"}</button></div>
    {:else}
      <div class="choice">
        <button class="stamp gold" disabled={!ready || busy} onclick={() => set(true)} title={ready ? "TennoScope then reads your inventory from the game" : "TennoScope has to be running first"}>{busy ? "Turning it on…" : "Read my inventory (Full mode)"}</button>
        <p class="warn small">{FULL_MODE_WARNING}</p>
      </div>
      {#if !ready}<p class="dim small">TennoScope has to be running first.</p>{/if}
    {/if}
  </div>
{/if}

<style>
  /* Nothing to change until TennoScope runs and reports. */
  .full.off { opacity: .7; pointer-events: none; }
  .block { display: grid; gap: .6rem; }
  .choice { display: grid; grid-template-columns: auto 1fr; gap: .9rem; align-items: start; }
  .choice button { white-space: nowrap; }
  .warn { display: block; color: var(--platinum-deep); line-height: 1.5; border-left: 2px solid var(--gold-dim); padding-left: .7rem; margin: 0; }
  .state { display: block; margin-top: .35rem; }
  .small { font-size: .8rem; }
  .dim { color: var(--platinum-deep); }
  @media (max-width: 700px) { .choice { grid-template-columns: 1fr; } }
</style>
