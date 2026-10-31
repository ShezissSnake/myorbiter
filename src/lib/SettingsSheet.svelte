<script lang="ts">
  import { PLATFORM_LABEL, type Platform, type Settings } from "./backend";
  import { ts } from "./tennoscopeStore.svelte";
  import Sheet from "./ui/Sheet.svelte";
  import Switch from "./ui/Switch.svelte";
  import Chip from "./ui/Chip.svelte";
  import { grouped, movePage, moveSection, orderPages, pagesFor } from "./pages";
  import Icon from "./ui/Icon.svelte";
  import WeightSliders from "./ui/WeightSliders.svelte";

  let {
    open = $bindable(),
    settings = $bindable(),
    defaultDir,
    eeFound,
    onpaths,
    onnotices,
  }: { open: boolean; settings: Settings; defaultDir: string; eeFound: string | null; onpaths: () => void; onnotices: () => void } = $props();

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
  /** A console or phone: only the settings for what works there (no TennoScope, no game log). */
  const onConsole = $derived(settings.market.platform !== "pc");
  // Pages: all of them for where you play, but Home and the Guide, which always stay.
  const all = $derived(orderPages(pagesFor(onConsole), settings.pageOrder));
  const optional = $derived(all.filter((p) => p.id !== "home" && p.id !== "guide"));
  const shown = $derived(all.filter((p) => !settings.pagesHidden.includes(p.id)));
  const groups = $derived(grouped(optional));
  function move(id: string, step: -1 | 1) {
    settings.pageOrder = movePage(groups, id, step);
  }
  function moveSec(group: string, step: -1 | 1) {
    settings.pageOrder = moveSection(groups, group, step);
  }
  function togglePage(id: string, on: boolean) {
    settings.pagesHidden = on ? settings.pagesHidden.filter((x) => x !== id) : [...settings.pagesHidden, id];
    if (!on && settings.startPage === id) settings.startPage = "last";
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
    <p class="dim small">The warframe.market orbiter reads and lists on. Signing in sets it from your account. Prices count sellers on other platforms too when you and they have cross-play on, since Warframe trades across platforms. On a console orbiter can't read your game, so it keeps to what works without it: your listings and their prices, sales, the riven finder, fissures and Baro. Everything built on your inventory is PC only.</p>
  </section>

  <section>
    <h3 class="register">Pages</h3>
    <label class="field">
      <span class="register">Open on</span>
      <select bind:value={settings.startPage}>
        <option value="last">The page you left it on</option>
        {#each shown as p (p.id)}<option value={p.id}>{p.label}</option>{/each}
      </select>
    </label>
    <p class="hint">The sidebar as it shows: untick a page to take it out (it still opens from links on other pages, and nothing on it is lost); the arrows move a page within its section, or a whole section. Ctrl+1…9 follow this order. Home stays first and the Guide stays by the gear. What Home itself shows is under the gear on Home.</p>
    {#each groups as g, gi (g.group)}
      <div class="secrow">
        <span class="register">{g.group}</span>
        {#if groups.length > 1}
          <button class="mv" aria-label="Move the {g.group} section up" title="Move the whole section up" disabled={gi === 0} onclick={() => moveSec(g.group, -1)}><Icon name="arrow-right" size={11} /></button>
          <button class="mv down" aria-label="Move the {g.group} section down" title="Move the whole section down" disabled={gi === groups.length - 1} onclick={() => moveSec(g.group, 1)}><Icon name="arrow-right" size={11} /></button>
        {/if}
      </div>
      <ol class="pagelist">
        {#each g.pages as p, i (p.id)}
          <li class:out={settings.pagesHidden.includes(p.id)}>
            <Chip on={!settings.pagesHidden.includes(p.id)} label={p.label} title={`${p.hint}. Click to ${settings.pagesHidden.includes(p.id) ? "put it back in" : "take it out of"} the sidebar.`} onchange={(on: boolean) => togglePage(p.id, on)} />
            <button class="mv" aria-label="Move {p.label} up" title="Move up within {g.group}" disabled={i === 0} onclick={() => move(p.id, -1)}><Icon name="arrow-right" size={11} /></button>
            <button class="mv down" aria-label="Move {p.label} down" title="Move down within {g.group}" disabled={i === g.pages.length - 1} onclick={() => move(p.id, 1)}><Icon name="arrow-right" size={11} /></button>
          </li>
        {/each}
      </ol>
    {/each}
    {#if settings.pagesHidden.length || settings.pageOrder.length}<div class="row">{#if settings.pagesHidden.length}<button class="link" onclick={() => (settings.pagesHidden = [])}>Show every page</button>{/if}{#if settings.pageOrder.length}<button class="link" onclick={() => (settings.pageOrder = [])}>Back to the usual order</button>{/if}</div>{/if}
  </section>

  {#if !onConsole}
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
    <h4 class="sub">How orbiter picks a reward</h4>
    <p class="hint">How much each counts in the score that picks the card to take (the share is its part of the score). Slide one to 0 to leave it out, say ducats while you farm platinum.</p>
    <WeightSliders bind:weights={settings.pick} />
  </section>

  <section>
    <h3 class="register">Overlays</h3>
    <p class="hint">What TennoScope draws over the game. orbiter keeps reading the reward screen with an overlay off, so its pick still shows on In mission.</p>
    <Switch bind:on={settings.overlay.reward} label="Fissure reward screen">
      Under each reward card: what it's worth and whether to take it.
    </Switch>
    {#if settings.overlay.reward}
      <div class="shows" role="group" aria-label="What the reward cards show">
        <Chip bind:on={settings.overlay.show.mastered} label="Mastered" title="A green seal by the name when the item it builds is mastered, an empty ring when not" />
        <Chip bind:on={settings.overlay.show.vault} label="Vaulted / Resurgence / Farmable" title="Where it can still be had: only vaulted relics, Prime Resurgence (Varzia) right now, or relics still in the drop tables" />
        <Chip bind:on={settings.overlay.show.set} label="Set parts" title="The parts of its set: the ones you hold solid, the rest faint, this card's underlined. A card that finishes a set (a first one, or an extra to sell) is double-framed" />
        <Chip bind:on={settings.overlay.show.plat} label="Plat" title="What it sells for on warframe.market" />
        <Chip bind:on={settings.overlay.show.ducats} label="Ducats" title="What Baro gives for it" />
        <Chip bind:on={settings.overlay.show.pick} label="orbiter's pick" title="Each card's score, and the card to take outlined in gold" />
      </div>
    {/if}
    <Switch bind:on={settings.overlay.kiosk} label="Baro's Ducat Kiosk">
      On each Prime part in the kiosk: its plat, or how many more you need while its item isn't mastered.
    </Switch>
  </section>

  {/if}

  <section>
    <h3 class="register">Trades</h3>
    <label class="field">
      <span class="register">+rep message</span>
      <input bind:value={settings.market.repText} maxlength="300" placeholder=":)" />
      <span class="hint">What goes with +rep on a trade partner's warframe.market profile (reputation there is a positive review, one per player).</span>
    </label>
    {#if !onConsole}<Switch bind:on={settings.market.autoTrades} label="Mark sales sold from the game">
      When a trade goes through where you gave items and got platinum, orbiter reads it from Warframe's log, marks your listing sold on warframe.market (recorded on your profile) and logs the sale with the platinum you actually got. Usually within half a minute: the game writes its log in bursts.
    </Switch>{/if}
  </section>

  {#if !onConsole}<section>
    <h3 class="register">Selling</h3>
    <p class="hint">Off: never counted as spare on Inventory, and never put up by "Everything else I don't need" on Orders.</p>
    <Switch bind:on={settings.market.sellable.veiledRivens} label="Sell veiled rivens">
      Off keeps every veiled riven to unveil yourself.
    </Switch>
    <Switch bind:on={settings.market.sellable.relicsWorthSelling} label="Sell relics worth more sold than cracked">
      A relic counts as spare only when it sells for more than a crack is worth, each refinement on its own: a radiant one's odds against what radiant ones sell for (Solo or Radshare, as set on Relics). It's never listed at or under that. Relics that drop a part you still need are always kept. Off keeps every relic.
    </Switch>
  </section>{/if}

  <section>
    <h3 class="register">Notifications</h3>
    <p class="hint">They have their own panel: the bell at the bottom of the sidebar. What orbiter told you lately, and a switch for each kind ({onConsole ? "your listings, rivens, rare alerts, Baro, fissures" : "sales, listings, alerts and invasions with mastery you're missing, Baro, fissures"}…), with a pause for all of them.</p>
    <div class="row"><button class="stamp" onclick={() => { open = false; onnotices(); }}>Open notifications</button></div>
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
  .sub { margin: .4rem 0 0; font-size: .88rem; font-weight: 600; color: var(--platinum); }
  .shows { display: flex; flex-wrap: wrap; gap: .4rem; margin: -.3rem 0 .2rem; }
  .field { display: grid; gap: .4rem; }
  .path { font-family: var(--face-register); font-size: .74rem; }
  /* What's used when the field is empty: dimmer and slanted, so it doesn't read as typed in. */
  .path::placeholder { text-transform: none; letter-spacing: 0; font-size: .74rem; font-style: italic; color: var(--platinum-deep); opacity: .7; }
  .hint { font-size: .76rem; color: var(--platinum-deep); }
  .row { display: flex; align-items: center; gap: .6rem; }
  .pagelist { list-style: none; margin: 0; padding: 0; display: grid; gap: .3rem; }
  .pagelist li { display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: .5rem; }
  .secrow { display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: .5rem; margin-top: .3rem; }
  .secrow .register { color: var(--gold-dim); }
  .pagelist :global(.chip) { justify-self: stretch; justify-content: flex-start; }
  .mv { width: 32px; height: 32px; padding: 0; line-height: 0; display: inline-flex; align-items: center; justify-content: center; }
  .mv :global(svg) { transform: rotate(-90deg); }
  .mv.down :global(svg) { transform: rotate(90deg); }
  /* Unsaved paths: pinned to the bottom of the panel, so it can't be missed whichever field changed. */
  .unsaved { position: sticky; bottom: -2rem; display: grid; gap: .7rem; padding: 1rem 1.1rem; background: var(--raised); border: 1px solid var(--gold-dim); box-shadow: inset 3px 0 0 var(--gold); }
</style>
