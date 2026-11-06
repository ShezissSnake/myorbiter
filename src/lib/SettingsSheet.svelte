<script lang="ts">
  import { PLATFORM_LABEL, logFolders, onWindows, openLogFolder, type Platform, type Settings } from "./backend";
  import { ts } from "./tennoscopeStore.svelte";
  import { refocus } from "./ui/refocus";
  import { bugReport } from "./bugReport.svelte";
  import Sheet from "./ui/Sheet.svelte";
  import Switch from "./ui/Switch.svelte";
  import Chip from "./ui/Chip.svelte";
  import { grouped, movePage, moveSection, orderPages, pagesFor } from "./pages";
  import Icon from "./ui/Icon.svelte";
  import { flip, pulse, reveal } from "./motion";
  import WeightSliders from "./ui/WeightSliders.svelte";
  import { NOX_SETTING } from "./core/builds/noxsframe";
  import FullMode from "./FullMode.svelte";
  import Seg from "./ui/Seg.svelte";
  import ProgressButton from "./ui/ProgressButton.svelte";
  import { openUrl } from "./backend";
  import { updates } from "./updates.svelte";
  import { CHANNELS, CHANNEL_LABEL, checkedAgo, installChecks, installInstalls, installNote, noteLines, releasePage, versionLine } from "./core/updates";
  import RenderingSetting from "./ui/RenderingSetting.svelte";

  let {
    open = $bindable(),
    settings = $bindable(),
    defaultDir,
    eeFound,
    onpaths,
    onnotices,
    rivenKeyError = null,
    focus = $bindable(null),
    ongo = () => {},
  }: { open: boolean; settings: Settings; defaultDir: string; eeFound: string | null; onpaths: () => void; onnotices: () => void; rivenKeyError?: string | null; focus?: string | null; ongo?: (to: string) => void } = $props();

  // Show me (What's New) opens the panel at a section: scrolled to and ringed briefly.
  $effect(() => {
    if (!open || !focus) return;
    const id = focus;
    focus = null;
    const t = setTimeout(() => {
      const el = document.getElementById(`settings-${id}`);
      if (!el) return;
      el.scrollIntoView({ block: "start", behavior: "smooth" });
      pulse(el);
    }, 260);
    return () => clearTimeout(t);
  });

  // Updates: this copy's version and channel, and what the chosen channel offers.
  const info = $derived(updates.info);
  const checks = $derived(!!info && installChecks(info.install));
  const installs = $derived(!!info && installInstalls(info.install));
  const offer = $derived(updates.offer);
  /** Ages "Last checked" while the panel is open. */
  let now = $state(Date.now());
  $effect(() => {
    if (!open) return;
    now = Date.now();
    const t = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(t);
  });

  let logError = $state<string | null>(null);
  // Paths are edited as drafts and applied together, because changing them reloads everything.
  let dataDir = $state("");
  let eeLog = $state("");
  // Follow the saved values (when settings load or are applied). Closing the panel keeps an
  // unsaved edit, so it's still there, with Apply, when the panel opens again.
  // The program is kept by orbiter itself (not in these settings) and chosen only in the native
  // file dialog it opens, which takes only a file named like TennoScope: the page can't name one.
  let tsError = $state<string | null>(null);
  let choosing = $state(false);
  async function chooseProgram() {
    choosing = true;
    try {
      await ts.chooseProgram();
      tsError = null;
      void ts.check();
    } catch (e) {
      tsError = String(e).replace(/^Error: /, "");
    } finally {
      choosing = false;
    }
  }
  async function forgetProgram() {
    try {
      await ts.forgetProgram();
      tsError = null;
      void ts.check();
    } catch (e) {
      tsError = String(e).replace(/^Error: /, "");
    }
  }
  $effect(() => {
    dataDir = settings.dataDir;
    eeLog = settings.eeLog;
  });
  const dirty = $derived(dataDir.trim() !== settings.dataDir || eeLog.trim() !== settings.eeLog);
  async function apply() {
    settings.dataDir = dataDir.trim();
    settings.eeLog = eeLog.trim();
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
    tsError = null;
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
    <Switch bind:on={settings.details} label="Show details">
      The sentence under every figure, each page's full description and every table column. Off, pages keep to the essentials and the rest is on hover. The Details button by each page's title (every page but Home, which has its own folds) is the same switch.
    </Switch>
    <p class="hint">The sidebar as it shows: untick a page to take it out (it still opens from links on other pages, and nothing on it is lost); the arrows move a page within its section, or a whole section. Ctrl+1…9 follow this order. Home stays first and the Guide stays by the gear. What Home itself shows is under the gear on Home.</p>
    <!-- A page or section moved: the others slide into their new places (flip). -->
    {#each groups as g, gi (g.group)}
      <div class="sec" animate:flip>
      <div class="secrow">
        <span class="register">{g.group}</span>
        {#if groups.length > 1}
          <button class="mv" aria-label="Move the {g.group} section up" title="Move the whole section up" disabled={gi === 0} onclick={() => moveSec(g.group, -1)}><Icon name="arrow-right" size={11} /></button>
          <button class="mv down" aria-label="Move the {g.group} section down" title="Move the whole section down" disabled={gi === groups.length - 1} onclick={() => moveSec(g.group, 1)}><Icon name="arrow-right" size={11} /></button>
        {/if}
      </div>
      <ol class="pagelist">
        {#each g.pages as p, i (p.id)}
          <li class:out={settings.pagesHidden.includes(p.id)} animate:flip>
            <Chip on={!settings.pagesHidden.includes(p.id)} label={p.label} title={`${p.hint}. Click to ${settings.pagesHidden.includes(p.id) ? "put it back in" : "take it out of"} the sidebar.`} onchange={(on: boolean) => togglePage(p.id, on)} />
            <button class="mv" aria-label="Move {p.label} up" title="Move up within {g.group}" disabled={i === 0} onclick={() => move(p.id, -1)}><Icon name="arrow-right" size={11} /></button>
            <button class="mv down" aria-label="Move {p.label} down" title="Move down within {g.group}" disabled={i === g.pages.length - 1} onclick={() => move(p.id, 1)}><Icon name="arrow-right" size={11} /></button>
          </li>
        {/each}
      </ol>
      </div>
    {/each}
    {#if settings.pagesHidden.length || settings.pageOrder.length}<div class="row">{#if settings.pagesHidden.length}<button class="link" onclick={() => (settings.pagesHidden = [])}>Show every page</button>{/if}{#if settings.pageOrder.length}<button class="link" onclick={() => (settings.pageOrder = [])}>Back to the usual order</button>{/if}</div>{/if}
  </section>

  {#if !onConsole}
  <section>
    <h3 class="register">TennoScope</h3>
    <Switch bind:on={settings.tennoscope.launch} label="Start TennoScope with orbiter">
      In the background, with no window of its own, and closed again when you close orbiter. A TennoScope you start yourself is left alone.
    </Switch>
    <FullMode kind="switch" />
    <div class="field" role="group" aria-labelledby="ts-program">
      <span class="register" id="ts-program">Program</span>
      <div class="row">
        <span class="path program" title={ts.status?.custom ?? ts.status?.binary ?? undefined}>{#if ts.status?.custom}{ts.status.custom}{:else if ts.status?.binary}<span class="dim">Found:</span> {ts.status.binary}{:else}<span class="dim">Not found</span>{/if}</span>
        <button type="button" class="stamp" disabled={choosing} title="Pick the TennoScope program in your system's file picker" onclick={chooseProgram}>{choosing ? "Choosing…" : "Choose…"}</button>
        {#if ts.status?.custom}<button type="button" class="stamp" title="Forget the chosen program: orbiter finds TennoScope itself again" onclick={forgetProgram}>Find it</button>{/if}
      </div>
      <span class="hint">Unless you choose one, orbiter finds it: the copy inside orbiter, then (in a development build) one built in orbiter's tennoscope/ folder or an older checkout in your home folder, then an installed one. Choose opens your system's file picker and takes only a program named tennoscope or tennoscope.exe, or a TennoScope AppImage. orbiter runs the program you choose as TennoScope each time it starts: use only a TennoScope you built or downloaded yourself.</span>
      {#if tsError}<span class="hint err">Not changed: {tsError}</span>{/if}
    </div>
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
      <input class="path" bind:value={eeLog} title={eeLog || undefined} placeholder={eeFound ? `Found: ${eeFound}` : onWindows ? "Found in %LOCALAPPDATA%\\Warframe" : "Found in your Steam libraries"} spellcheck="false" />
      <span class="hint">Read only, never written. Empty finds it {onWindows ? "in %LOCALAPPDATA%\\Warframe" : "in your Steam libraries (under the Proton prefix)"}.</span>
    </label>
  </section>

  <section>
    <h3 class="register">Fissures</h3>
    <Switch bind:on={settings.jumpToPick} label="Show Current fissure when the reward screen opens">
      orbiter switches to the reward pick by itself, so it's on screen when you need it.
    </Switch>
    <h4 class="sub">How orbiter picks a reward</h4>
    <p class="hint">How much each counts in the score that picks the card to take (the share is its part of the score). Slide one to 0 to leave it out, say ducats while you farm platinum.</p>
    <WeightSliders bind:weights={settings.pick} />
  </section>

  <section>
    <h3 class="register">Overlays</h3>
    <p class="hint">What TennoScope draws over the game. orbiter keeps reading the reward screen with an overlay off, so its pick still shows on Current fissure.</p>
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
    <Switch bind:on={settings.overlay.riven} label="Cycling a riven">
      When orbiter reads a riven waiting for keep-or-take (Sync at the cycle screen, or the riven key below): both rolls graded side by side, and which to keep.
    </Switch>
    {#if settings.overlay.riven}
      <label class="field">
        <span class="register">Riven key</span>
        <input type="text" placeholder="None (e.g. Ctrl+Shift+R or F9)" value={settings.overlay.rivenKey} onchange={(e) => (settings.overlay.rivenKey = e.currentTarget.value.trim())} aria-label="Riven key" />
      </label>
      <p class="dim small">Pressed in game at the cycle screen, TennoScope reads your inventory (it needs Full mode) and the two rolls show over the game a few seconds later, no switching windows. On Linux it works while the game has focus; a key another app holds can't be had.{#if rivenKeyError}{" "}<span class="err">Couldn't set it: {rivenKeyError}</span>{/if}</p>
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
    {#if !onConsole}<Switch bind:on={settings.market.autoRep} label="Give +rep by itself after a trade">
      Each player you trade with in game gets +rep on warframe.market with the message above, once per player, without you leaving the game. If orbiter was closed during the trade, it catches up when it opens, while the game is still running. Needs you signed in to warframe.market on Orders. Off: a +rep button shows after each trade instead.
    </Switch>{/if}
    {#if !onConsole}<Switch bind:on={settings.market.autoTrades} label="Mark sales sold from the game">
      When a trade goes through where you gave items and got platinum, orbiter reads it from Warframe's log, marks your listing sold on warframe.market (recorded on your profile) and logs the sale with the platinum you actually got. Usually within half a minute: the game writes its log in bursts.
    </Switch>{/if}
    {#if !onConsole}<Switch bind:on={settings.market.lastCopy.optIn} label="Hide last copies while someone whispers you">
      When anyone whispers you in game (a buyer, a friend, or you whispering a seller), orbiter hides every listing you have one copy of, so a second buyer doesn't message you for one that's already promised. The game's log says who whispered, not what about, so that's usually most of your listings. Each comes back after the time below unless it sold; a later whisper doesn't make the wait longer.
    </Switch>
    {#if settings.market.lastCopy.optIn}<label class="field minutes">
      <span class="register">Hidden for</span>
      <span class="row"><input type="number" min="1" max="120" step="1" bind:value={settings.market.lastCopy.minutes} aria-label="Minutes hidden" /> <span class="hint">minutes</span></span>
    </label>{/if}{/if}
  </section>

  <section>
    <h3 class="register">Selling</h3>
    <Switch bind:on={settings.market.sellable.saveForSets} label="Save prime parts for sets">
      A loose prime part waits for its set instead of being sold on its own when the set sells for clearly more than its parts one by one (at least 10% and 5p more, each part at its price or its ducats at your rate, whichever is more), and you can still get every part it's missing: from a relic you own, a relic that still drops, Varzia, or a part you've been getting lately (Stats, Parts you got). When you put your spares on sale, your listing for a part comes down if every copy you hold is waiting (one you also keep copies of to build stays as you listed it). Sets → Saving up shows what's waiting and what's left to get.
    </Switch>
    {#if !onConsole}
    <Switch bind:on={settings.market.sellable.veiledRivens} label="Sell veiled rivens">
      Off keeps every veiled riven to unveil yourself: never counted as spare on Inventory, and never put up by Sell spares (where it's the Veiled rivens line under Resources and more).
    </Switch>
    <p class="hint">Relics: which ones to sell, and how many of each to keep, is the Relics row on <button type="button" class="link" title="Sell spares, the Relics row" onclick={() => { open = false; ongo("spares?open=relics#cat-relics"); }}>Sell spares</button>. A relic counts as spare only when it sells for more than a crack is worth, and one that drops a part you still need is always kept.</p>
    {/if}
  </section>

  <section>
    <h3 class="register">Builds</h3>
    <Switch bind:on={settings.buildsFromNox} label={NOX_SETTING.label}>
      {NOX_SETTING.help} Off: Builds lists none, and its Nox's Frame link still opens the site in your browser.
    </Switch>
  </section>

  <section>
    <h3 class="register">Notifications</h3>
    <p class="hint">They have their own panel: the bell at the bottom of the sidebar. What orbiter told you lately, and a switch for each kind ({onConsole ? "your listings, rivens, rare alerts, Baro, fissures" : "sales, listings, alerts and invasions with mastery you're missing, Baro, fissures"}…), with a pause for all of them.</p>
    <div class="row"><button class="stamp" onclick={() => { open = false; onnotices(); }}>Open notifications</button></div>
  </section>

  <section id="settings-updates" data-card="updates">
    <h3 class="register">Updates</h3>
    <p class="ver"><span class="register">This is orbiter</span> <b class="mono" title="The version, and the channel it came from">{info ? versionLine(info.version, settings.updates) : "…"}</b></p>
    {#if info && installNote(info.install)}<p class="hint">{installNote(info.install)}</p>{/if}
    <Seg label="Channel" value={settings.updates.channel} options={CHANNELS.map((c) => ({ ...c }))} onchange={(c) => updates.setChannel(c)} />
    <p class="hint">{CHANNELS.find((c) => c.v === settings.updates.channel)?.title}. Switching to a more stable channel never steps back by itself: if its build is older than this one, orbiter offers it here and installs it only when you click.</p>
    <div class="row">
      <ProgressButton job={updates.checkJob} label="Check now" disabled={!checks} sizer={["Up to date · 0.1.9999", "Experimental has 0.1.9999", "Couldn't check"]} title={checks ? `Look for a newer build on ${CHANNEL_LABEL[settings.updates.channel]} now. orbiter also looks when it starts and every 6 hours; nothing installs without your click.` : (info ? (installNote(info.install) ?? "") : "")} status />
      <button type="button" class="link out" title="Open this build's release page on GitHub, in your browser: what changed, and its downloads" onclick={() => openUrl(releasePage(info?.version ?? "0.1.0"))}>Release notes<Icon name="external" size={11} /></button>
    </div>
    {#if checks}<p class="hint">Last checked {checkedAgo(settings.updates.lastCheck, now)}{#if updates.error}{" "}· <span title={updates.error}>couldn't check for updates</span>{/if}.</p>{/if}
    {#if offer}
      <div class="offer" transition:reveal>
        <div class="offer-in">
          {#if offer.older}
            <p class="small">{CHANNEL_LABEL[offer.channel]}'s build is <b class="mono">{offer.version}</b>, older than this one ({info?.version}). Switching installs it: a step back, so only when you click.</p>
          {:else}
            <p class="small"><b class="mono">{offer.version}</b> is out on {CHANNEL_LABEL[offer.channel]}.</p>
          {/if}
          {#if noteLines(offer.notes).length}<ul class="notes">{#each noteLines(offer.notes) as line, i (i)}<li>{line}</li>{/each}</ul>{/if}
          <div class="row">
            <ProgressButton job={updates.installJob} tone="gold" label={offer.older ? `Switch to ${CHANNEL_LABEL[offer.channel]}'s ${offer.version}` : "Update and restart"} disabled={!installs} sizer={["Downloading 100%", "Restarting", "Not installed"]} title={installs ? `Download ${offer.version}, check its signature, install it and restart orbiter into it` : (info ? (installNote(info.install) ?? "") : "")} onclick={() => updates.install()} status />
          </div>
        </div>
      </div>
    {/if}
  </section>

  <div id="settings-display"><RenderingSetting /></div>

  <section>
    <h3 class="register">Logs</h3>
    <p class="hint">What orbiter did and what went wrong, one line each, for when something misbehaves: TennoScope starting or failing, every change it made to your listings and every request warframe.market turned down, and errors in this window. Never your warframe.market sign-in. TennoScope keeps its own. Send both when you report a problem.</p>
    {#await logFolders(settings.dataDir) then f}
      <div class="row">
        <button class="stamp" disabled={!f.orbiter} title={f.orbiter ?? "Only in the desktop app"} onclick={() => openLogFolder("orbiter", settings.dataDir).catch((e) => (logError = String(e)))}>Open orbiter's log folder</button>
        <button class="stamp" disabled={!f.tennoscope} title={f.tennoscope ?? "TennoScope hasn't written a log here yet"} onclick={() => openLogFolder("tennoscope", settings.dataDir).catch((e) => (logError = String(e)))}>Open TennoScope's log folder</button>
      </div>
      {#if f.orbiter}<p class="hint path-note">{f.orbiter}</p>{/if}
    {/await}
    {#if logError}<p class="hint err">{logError}</p>{/if}
  </section>

  <section id="settings-report">
    <h3 class="register">Report a bug</h3>
    <p class="hint">Something not working? Say what happened, and orbiter fills in an issue on GitHub for you to check and submit, or copies the report if you'd rather send it another way. The technical details it can add (version, system, the log's last lines, with sign-ins and players' names hidden) are yours to read first. orbiter never sends anything itself.</p>
    <div class="row"><button class="stamp" title="Open Report a bug (Shift+F1): nothing is sent until you press Submit on GitHub" onclick={() => { open = false; bugReport.show(); }}>Report a bug</button></div>
  </section>


  {#if dirty}
    <div class="unsaved">
      <span class="small">The program or folder paths changed. They apply together, then everything reloads.</span>
      <div class="row">
        <button class="stamp gold" onclick={apply}>Apply and reload</button>
        <button onclick={(e) => { const sheet = e.currentTarget.closest("section, aside, [role=dialog]")?.parentElement ?? null; refocus(e.currentTarget, () => sheet?.querySelector<HTMLElement>("input.path")); revert(); }}>Undo</button>
      </div>
    </div>
  {/if}
</Sheet>

<style>
  section { display: grid; gap: 1rem; padding-bottom: 1.4rem; border-bottom: 1px solid var(--rule); }
  section:last-child { border-bottom: 0; }
  .sec { display: grid; gap: 1rem; }
  h3 { margin: 0; color: var(--gold); }
  .sub { margin: .4rem 0 0; font-size: .88rem; font-weight: 600; color: var(--platinum); }
  .minutes input { width: 5rem; }
  .shows { display: flex; flex-wrap: wrap; gap: .4rem; margin: -.3rem 0 .2rem; }
  .field { display: grid; gap: .4rem; }
  .path { font-family: var(--face-register); font-size: .74rem; }
  /* What's used when the field is empty: dimmer and slanted, so it doesn't read as typed in. */
  .path::placeholder { text-transform: none; letter-spacing: 0; font-size: .74rem; font-style: italic; color: var(--platinum-deep); opacity: .7; }
  .hint { font-size: .76rem; color: var(--platinum-deep); }
  .path-note { word-break: break-all; margin: .3rem 0 0; }
  .program { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--platinum-dim); }
  .hint.err { color: var(--oxblood); }
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
  .ver { margin: 0; display: flex; align-items: baseline; gap: .6rem; flex-wrap: wrap; }
  .ver b { color: var(--platinum); font-weight: 600; }
  .mono { font-family: var(--face-register); font-variant-numeric: tabular-nums; }
  .link.out { display: inline-flex; align-items: center; gap: .35rem; }
  .offer-in { display: grid; gap: .7rem; padding: .9rem 1rem; background: var(--raised); border: 1px solid var(--gold-dim); box-shadow: inset 3px 0 0 var(--gold); }
  .offer-in p { margin: 0; }
  .notes { margin: 0; padding-left: 1.1rem; display: grid; gap: .2rem; font-size: .8rem; color: var(--platinum-dim); }
  .unsaved { position: sticky; bottom: -2rem; display: grid; gap: .7rem; padding: 1rem 1.1rem; background: var(--raised); border: 1px solid var(--gold-dim); box-shadow: inset 3px 0 0 var(--gold); }
</style>
