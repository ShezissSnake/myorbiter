<script lang="ts">
  import { PLATFORM_LABEL, type Platform, type Settings } from "./backend";
  import { ts } from "./tennoscopeStore.svelte";
  import Sheet from "./ui/Sheet.svelte";
  import Switch from "./ui/Switch.svelte";

  let {
    open = $bindable(),
    settings = $bindable(),
    defaultDir,
    eeFound,
    onpaths,
  }: { open: boolean; settings: Settings; defaultDir: string; eeFound: string | null; onpaths: () => void } = $props();

  // Paths are edited as drafts and applied together, because changing them reloads everything.
  let dataDir = $state("");
  let eeLog = $state("");
  let tsPath = $state("");
  // Follow the saved values (when settings load or are applied). Closing the panel keeps an
  // unsaved edit, so it's still there, with Apply, when the panel opens again.
  $effect(() => {
    dataDir = settings.dataDir;
    eeLog = settings.eeLog;
    tsPath = settings.tennoscope.path;
  });
  const dirty = $derived(dataDir.trim() !== settings.dataDir || eeLog.trim() !== settings.eeLog || tsPath.trim() !== settings.tennoscope.path);
  function apply() {
    settings.dataDir = dataDir.trim();
    settings.eeLog = eeLog.trim();
    settings.tennoscope.path = tsPath.trim();
    onpaths();
  }
  function revert() {
    dataDir = settings.dataDir;
    eeLog = settings.eeLog;
    tsPath = settings.tennoscope.path;
  }
</script>

<Sheet bind:open title="Settings" kicker="orbiter">
  <section>
    <h3 class="register">Platform</h3>
    <label class="field">
      <span class="register">Where you play</span>
      <select value={settings.market.platform} onchange={(e) => { settings.market.platform = e.currentTarget.value as Platform; settings.market.relicPrices = {}; }}>
        {#each Object.entries(PLATFORM_LABEL) as [v, label] (v)}<option value={v}>{label}</option>{/each}
      </select>
    </label>
    <p class="dim small">The warframe.market orbiter reads and lists on. Signing in sets it from your account. Off PC there's no inventory: TennoScope only reads Warframe on a PC, so orbiter doesn't start it, and your listings, prices, sales, fissures, Baro and the riven finder are what's left.</p>
  </section>

  <section>
    <h3 class="register">TennoScope</h3>
    <Switch bind:on={settings.tennoscope.launch} label="Start TennoScope with orbiter">
      In the background, with no window of its own, and closed again when you close orbiter. A TennoScope you start yourself is left alone.
    </Switch>
    <label class="field">
      <span class="register">Program</span>
      <input class="path" bind:value={tsPath} title={tsPath || undefined} placeholder={ts.status?.binary ? `Found: ${ts.status.binary}` : "Not found"} spellcheck="false" />
      <span class="hint">Empty finds it: your patched build in ~/dev/projects/tennoscope, then an installed one.</span>
    </label>
  </section>

  <section>
    <h3 class="register">Where things are</h3>
    <label class="field">
      <span class="register">TennoScope's data folder</span>
      <input class="path" bind:value={dataDir} title={dataDir || undefined} placeholder={defaultDir ? `Default: ${defaultDir}` : "TennoScope's default"} spellcheck="false" />
      <span class="hint">Read only. Empty uses TennoScope's default.</span>
    </label>
    <label class="field">
      <span class="register">Warframe's EE.log</span>
      <input class="path" bind:value={eeLog} title={eeLog || undefined} placeholder={eeFound ? `Found: ${eeFound}` : "Found in your Steam libraries"} spellcheck="false" />
      <span class="hint">Read only, never written. Empty finds it in your Steam libraries.</span>
    </label>
  </section>

  <section>
    <h3 class="register">Fissures</h3>
    <Switch bind:on={settings.jumpToPick} label="Show In mission when the reward screen opens">
      orbiter switches to the reward pick by itself, so it's on screen when you need it.
    </Switch>
    <p class="hint">The reward score weights are on In mission, above the list of rewards.</p>
  </section>

  <section>
    <h3 class="register">Trades</h3>
    <label class="field">
      <span class="register">+rep message</span>
      <input bind:value={settings.market.repText} maxlength="300" placeholder=":)" />
      <span class="hint">What goes with +rep on a trade partner's warframe.market profile (reputation there is a positive review, one per player).</span>
    </label>
    <Switch bind:on={settings.market.autoTrades} label="Mark sales sold from the game">
      When a trade goes through where you gave items and got platinum, orbiter reads it from Warframe's log, marks your listing sold on warframe.market (recorded on your profile) and logs the sale with the platinum you actually got. Usually within half a minute: the game writes its log in bursts.
    </Switch>
  </section>

  <section>
    <h3 class="register">Selling</h3>
    <p class="hint">Off: never counted as spare on Inventory, and never put up by "Everything else I don't need" on Orders.</p>
    <Switch bind:on={settings.market.sellable.veiledRivens} label="Sell veiled rivens">
      Off keeps every veiled riven to unveil yourself.
    </Switch>
    <Switch bind:on={settings.market.sellable.relicsWorthSelling} label="Sell relics worth more sold than cracked">
      A relic counts as spare only when it sells for more than a crack is worth, each refinement on its own: a radiant one's odds against what radiant ones sell for (Solo or Radshare, as set on Relics). It's never listed at or under that. Relics that drop a part you still need are always kept. Off keeps every relic.
    </Switch>
  </section>

  <section>
    <h3 class="register">Notifications</h3>
    <p class="hint">Through your desktop's notifications, and only while you're not looking at orbiter.</p>
    <Switch bind:on={settings.notify.reward} label="Which reward to take">
      When the reward screen opens: the card with the best score, and why.
    </Switch>
    <Switch bind:on={settings.notify.market} label="warframe.market">
      Listings Auto-match repriced, a listing for more than you now hold, and anything that went wrong.
    </Switch>
    <Switch bind:on={settings.notify.invasions} label="Invasions with a part you need">
      A running invasion rewards a part for something you haven't mastered or built, and you don't have it yet. Once per invasion.
    </Switch>
    <Switch bind:on={settings.notify.whispers} label="Someone whispers you">
      A private chat opens in game: usually a buyer from warframe.market. Their name, and how many listings you have up.
    </Switch>
    <Switch bind:on={settings.notify.foundry} label="Foundry builds ready">
      Something you're building is ready to claim, with how much mastery it gives if you haven't mastered it.
    </Switch>
    <Switch bind:on={settings.notify.deals} label="Cheap parts and arcanes">
      Someone in game lists a part you're missing, or an arcane you're collecting, well under its usual price.
    </Switch>
    <Switch bind:on={settings.notify.fissures} label="Fissures you watch for">
      A fissure opens that matches one of your fissure alerts (set them on Home, at the foot of Fissures now).
    </Switch>
    <Switch bind:on={settings.notify.siteChat} label="Messages on warframe.market">
      A buyer writes to you on the website's chat rather than whispering in game (read each minute while you're signed in).
    </Switch>
    <Switch bind:on={settings.notify.wishlist} label="Fissures for your wishlist">
      An era that had no fissure open gets one, and you hold relics of it for something on your wishlist. Most of the time every era has fissures open; the Wishlist page shows what to crack.
    </Switch>
    <Switch bind:on={settings.notify.rivens} label="Rivens you watch for">
      A riven matching one of your riven alerts is listed at or under your price (checked every 15 minutes).
    </Switch>
    <Switch bind:on={settings.notify.tennoscope} label="TennoScope trouble">
      It couldn't be started, or something orbiter asked of it failed.
    </Switch>
  </section>


  {#if dirty}
    <div class="unsaved">
      <span class="small">The program or folder paths changed. They apply together, then everything reloads.</span>
      <div class="row">
        <button class="stamp gold" onclick={apply}>Apply and reload</button>
        <button onclick={revert}>Undo</button>
      </div>
    </div>
  {/if}
</Sheet>

<style>
  section { display: grid; gap: 1rem; padding-bottom: 1.4rem; border-bottom: 1px solid var(--rule); }
  section:last-child { border-bottom: 0; }
  h3 { margin: 0; color: var(--gold); }
  .field { display: grid; gap: .4rem; }
  .path { font-family: var(--face-register); font-size: .74rem; }
  /* What's used when the field is empty: dimmer and slanted, so it doesn't read as typed in. */
  .path::placeholder { text-transform: none; letter-spacing: 0; font-size: .74rem; font-style: italic; color: var(--platinum-deep); opacity: .7; }
  .hint { font-size: .76rem; color: var(--platinum-deep); }
  .row { display: flex; align-items: center; gap: .6rem; }
  /* Unsaved paths: pinned to the bottom of the panel, so it can't be missed whichever field changed. */
  .unsaved { position: sticky; bottom: -2rem; display: grid; gap: .7rem; padding: 1rem 1.1rem; background: var(--raised); border: 1px solid var(--gold-dim); box-shadow: inset 3px 0 0 var(--gold); }
</style>
