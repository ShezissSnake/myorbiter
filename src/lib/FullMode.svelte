<script lang="ts" module>
  /** What Full mode does and what it risks, shown beside every switch that turns it on
   *  (FullModeWarning.svelte, where the page it names is a control that opens it). */
  export const FULL_MODE_WARNING =
    "Full mode reads Warframe's memory to fetch your inventory. Digital Extremes publishes no list of allowed or forbidden third-party programs and leaves using them at your own risk: Full mode could put your account at risk. Nothing is written to the game's memory; the login session found there goes to Digital Extremes, for your inventory. Everything MyOrbiter and TennoScope read and send is listed on the page What MyOrbiter reads and sends.";
</script>

<script lang="ts">
  // Full mode: TennoScope reads your inventory from the running game. Off until you turn it on,
  // here (first-run setup, the TennoScope panel, Settings), with the warning beside the switch.
  // Turning it off leaves the reward overlay (Overlay mode). MyOrbiter passes the choice to the
  // TennoScope it runs (`--access=…`), which makes the same change as choosing in its own window.
  import { ts } from "./tennoscopeStore.svelte";
  import Switch from "./ui/Switch.svelte";
  import FullModeWarning from "./FullModeWarning.svelte";

  let { kind = "button" }: { kind?: "button" | "switch" } = $props();
  // The warning under the switch describes it, so it's read out with the switch it warns about.
  const uid = $props.id();
  const warningId = `full-mode-warning-${uid}`;

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
    <Switch name="settings.full-mode" bind:on={() => shown, flip} label="Read my inventory (Full mode)" describedby={warningId}>
      {#if !ready}<span class="state">TennoScope has to be running to change it.</span>{:else if busy}<span class="state">Changing…</span>{:else if mode && mode !== "full"}<span class="state">{mode === "overlay" ? "Off: in Overlay mode TennoScope watches for the game and reads its log and its screen (through a void fissure mission and at Baro's kiosk), not your inventory." : "Off: in Companion mode TennoScope reads nothing of the game."}</span>{/if}
    </Switch>
    <!-- Under the switch, not in its label: the page's control inside the label would leave the
         switch without a name of its own. It describes the switch instead (aria-describedby). -->
    <p class="warn under" id={warningId}><FullModeWarning /></p>
  </div>
{:else}
  <div class="full block">
    {#if on}
      <p class="prose small">Full mode is on: TennoScope reads your inventory from the running game.</p>
      <div><button disabled={!ready || busy} onclick={() => set(false)}>{busy ? "Turning it off…" : "Turn Full mode off"}</button></div>
    {:else}
      <div class="choice">
        <button class="stamp gold" disabled={!ready || busy} onclick={() => set(true)} title={ready ? "TennoScope then reads your inventory from the game" : "TennoScope has to be running first"}>{busy ? "Turning it on…" : "Read my inventory (Full mode)"}</button>
        <p class="warn small"><FullModeWarning /></p>
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
  /* As the switch's own note (Switch.svelte), in the column left of the switch. */
  .under { font-size: .78rem; margin: .35rem calc(2.3rem + 1rem) 0 0; }
  .small { font-size: .8rem; }
  .dim { color: var(--platinum-deep); }
  @media (max-width: 700px) { .choice { grid-template-columns: 1fr; } }
</style>
