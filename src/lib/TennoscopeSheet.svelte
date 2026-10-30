<script lang="ts">
  // Everything orbiter can see and do about TennoScope, so its own window is rarely needed.
  import { ts } from "./tennoscopeStore.svelte";
  import { onWindows, type Health, type HealthState } from "./backend";
  import Sheet from "./ui/Sheet.svelte";
  import Switch from "./ui/Switch.svelte";

  // `onsync` is the sidebar's Sync: TennoScope reads the inventory, then orbiter reloads it.
  // `windowMode`: Warframe's display mode from its EE.cfg; `opaqueOverlay`: the Windows setting.
  let {
    open = $bindable(),
    synced,
    syncing,
    onsync,
    windowMode = null,
    opaqueOverlay = $bindable(false),
  }: { open: boolean; synced: string; syncing: boolean; onsync: () => void; windowMode?: string | null; opaqueOverlay?: boolean } = $props();
  const MODE_WORD: Record<string, string> = { MODE_BORDERLESS: "Borderless", MODE_FULLSCREEN: "Fullscreen (exclusive)", MODE_WINDOWED: "Windowed" };
  /** On Windows nothing can draw over exclusive fullscreen: the overlay can't show at all. */
  const blocksOverlay = $derived(onWindows && windowMode === "MODE_FULLSCREEN");

  // A fresh look whenever the sheet opens, and every few seconds while it is open.
  $effect(() => {
    if (!open) return;
    ts.check();
    const t = setInterval(() => ts.check(), 4000);
    return () => clearInterval(t);
  });

  const r = $derived(ts.report);
  const ROWS: { key: keyof NonNullable<typeof r>["health"]; label: string }[] = [
    { key: "game_reader", label: "Warframe" },
    { key: "log_monitor", label: "Game log" },
    { key: "capture", label: "Reward screen" },
    { key: "catalog", label: "Item data" },
    { key: "collection_prices", label: "Daily prices" },
    { key: "market_account", label: "warframe.market" },
  ];
  const STATE_WORD: Record<HealthState, string> = { ready: "OK", idle: "Waiting", degraded: "Needs attention", failed: "Not working" };

  const ACCESS: Record<string, { name: string; note: string }> = {
    full: { name: "Full", note: "Reads your inventory when the game starts, and the reward screen." },
    overlay: { name: "Overlay", note: "Reads the reward screen, but not your inventory: no automatic sync." },
    companion: { name: "Companion", note: "Never looks at the game: no overlay, no inventory sync." },
  };
  const access = $derived(r?.setup.access_mode ? ACCESS[r.setup.access_mode] : null);

  const canSync = $derived(!!r && r.setup.access_mode === "full" && r.game_running);
  const recentError = $derived(r?.last_error && Date.now() - r.last_error.at < 60_000 ? r.last_error.message : null);
  const dot = (h: Health) => h.state;
</script>

<Sheet bind:open title="TennoScope" kicker="Runs alongside orbiter">
  <section class="state">
    {#if !ts.status}
      <p class="prose">TennoScope's state is only available in the desktop app.</p>
    {:else if ts.status.supported === false}
      <p class="prose">TennoScope doesn't run on macOS, so orbiter works without your inventory here.</p>
    {:else if !ts.running}
      <div class="line"><i class="dot failed"></i><strong>Not running</strong></div>
      <p class="prose">
        {#if ts.status.binary}orbiter starts it in the background when it opens. Start it now, or check Settings if it keeps stopping.{:else}orbiter couldn't find TennoScope. Set its program in Settings.{/if}
      </p>
      {#if ts.status.binary}<div><button class="stamp" onclick={() => ts.check(true)}>Start TennoScope</button></div>{/if}
    {:else}
      <div class="line">
        <i class="dot ready"></i>
        <strong>Running{ts.status.started_by_orbiter ? " in the background" : ""}</strong>
        <span class="dim small">{ts.status.started_by_orbiter ? `orbiter started ${ts.status.bundled ? "the copy inside it" : "it"} and closes it when you close orbiter` : "you started it; orbiter leaves it running"}</span>
      </div>
      <div class="row">
        <button onclick={() => ts.show()}>Open its window</button>
      </div>
    {/if}
    {#if ts.error}<p class="err small">{ts.error}</p>{/if}
    {#if recentError}<p class="err small">TennoScope: {recentError}</p>{/if}
  </section>

  {#if ts.unpatched}
    <section class="callout">
      <h3 class="register">This TennoScope doesn't talk to orbiter</h3>
      <p class="prose">It's an unpatched build, so orbiter can't show its state, read the reward cards or run it without a window. Build the patched one (see <code>patches/README.md</code> in orbiter's folder) and point Settings at it.</p>
    </section>
  {/if}

  {#if r}
    {#if r.setup.desktop_capture_action_available}
      <section class="callout gold">
        <h3 class="register">Allow screen capture</h3>
        <p class="prose">TennoScope can't see the reward screen yet, so there's no overlay and orbiter gets no cards. Your desktop asks once which screen it may read.</p>
        <div><button class="stamp gold" disabled={ts.pending === "--authorize-capture"} onclick={() => ts.ask("--authorize-capture")}>Allow screen capture</button></div>
      </section>
    {/if}

    <section class:callout={blocksOverlay} class:gold={blocksOverlay}>
      <h3 class="register">Reward overlay</h3>
      {#if windowMode}
        <div class="kv"><span>Warframe's display mode</span><strong>{MODE_WORD[windowMode] ?? windowMode}</strong></div>
      {/if}
      {#if blocksOverlay}
        <p class="prose">In exclusive fullscreen nothing can draw over Warframe, so the overlay never shows. In Warframe's options, set <b>Display Mode</b> to <b>Borderless</b>.</p>
      {/if}
      <p class="dim small">It shows on a fissure's reward screen when there's a choice: two or more cards. Solo there's one card, so nothing shows. A screen TennoScope couldn't read, or the first one after it starts mid-mission, is missed too.</p>
      {#if onWindows}
        <Switch bind:on={opaqueOverlay} label="Solid overlay background">
          <span class="dim small">If the overlay never appears even in Borderless: some drivers draw a see-through window invisibly. This draws it on a dark background instead. From TennoScope's next start (restart orbiter).</span>
        </Switch>
      {/if}
    </section>

    <section>
      <h3 class="register">Inventory</h3>
      <div class="kv">
        <span>Last read</span><strong>{synced}</strong>
        <span>Access</span><strong>{access?.name ?? "Not set up"}</strong>
      </div>
      <p class="dim small">{access?.note ?? "Open TennoScope's window once to choose what it may read."}</p>
      <div class="row">
        <button class="stamp" disabled={!canSync || syncing} onclick={onsync}>{syncing ? "Syncing…" : "Sync inventory now"}</button>
        <span class="dim small">
          {#if r.setup.access_mode !== "full"}Needs Full access.{:else if !r.game_running}Works while Warframe is running.{:else}After trading, crafting or opening relics.{/if}
        </span>
      </div>
      {#if !r.setup.setup_complete || !r.setup.access_mode}<div><button onclick={() => ts.show()}>Choose access in TennoScope</button></div>{/if}
    </section>

    <section>
      <h3 class="register">Health</h3>
      <ul class="health">
        {#each ROWS as row (row.key)}
          {@const h = r.health[row.key]}
          <li title={h.last_success ? `Last success: ${h.last_success}` : undefined}>
            <i class="dot {dot(h)}"></i>
            <span class="hl">{row.label}</span>
            <span class="hs {h.state}">{STATE_WORD[h.state]}</span>
            <span class="hm">{h.message}</span>
          </li>
        {/each}
      </ul>
    </section>
  {/if}
</Sheet>

<style>
  section { display: grid; gap: .7rem; }
  h3 { margin: 0; color: var(--platinum-dim); }
  .line { display: flex; align-items: center; gap: .6rem; flex-wrap: wrap; }
  .line strong { font-family: var(--face-mark); font-size: 1.2rem; text-transform: uppercase; letter-spacing: .01em; }
  .row { display: flex; align-items: center; gap: .8rem; flex-wrap: wrap; }
  .kv { display: grid; grid-template-columns: max-content 1fr; gap: .35rem 1.2rem; font-size: .86rem; }
  .kv span { color: var(--platinum-deep); }
  .kv strong { font-weight: 500; }
  .dot { display: inline-block; width: .55rem; height: .55rem; flex: none; background: var(--platinum-deep); }
  .dot.ready { background: var(--verdigris); }
  .dot.degraded { background: var(--gold); }
  .dot.failed { background: var(--oxblood); }
  .callout { border: 1px solid var(--rule-bright); background: var(--well); padding: 1rem 1.1rem; }
  .callout.gold { border-color: var(--gold-dim); box-shadow: inset 3px 0 0 var(--gold); }
  .callout h3 { color: var(--platinum); }
  .health { list-style: none; margin: 0; padding: 0; display: grid; }
  .health li { display: grid; grid-template-columns: .55rem 8.5rem 7.5rem 1fr; align-items: baseline; gap: .7rem; padding: .5rem 0; border-bottom: 1px solid var(--rule); font-size: .82rem; }
  .health li:first-child { border-top: 1px solid var(--rule); }
  .health .dot { align-self: center; }
  .hl { color: var(--platinum); }
  .hs { font-family: var(--face-register); font-size: .6rem; letter-spacing: .12em; text-transform: uppercase; color: var(--platinum-deep); }
  .hs.ready { color: var(--verdigris); }
  .hs.degraded { color: var(--gold); }
  .hs.failed { color: var(--oxblood); }
  .hm { color: var(--platinum-dim); font-size: .78rem; }
  .err { color: var(--oxblood); margin: 0; }
  code { font-family: var(--face-register); font-size: .9em; color: var(--platinum); }
</style>
