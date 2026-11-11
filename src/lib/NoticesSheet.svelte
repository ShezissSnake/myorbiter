<script lang="ts">
  // The bell in the sidebar: what MyOrbiter told you lately (click one to open what it's about), and
  // what it tells you about, kind by kind, with a pause for all of them.
  import { discordConfirm, discordPost, isDiscordWebhook, type Settings } from "./backend";
  import { discordStatus, discordSent } from "./discordStatus.svelte";
  import { GROUP_NOTE, kindsFor, NOTICE_KINDS, noticeKind, outcomeText, splitTarget, TEST_WAIT_MS, type Notice, type NoticeKind, type NoticeKindInfo, type NoticeOutcome } from "./notices";
  import { pageById, type PageId } from "./pages";
  import Chip from "./ui/Chip.svelte";
  import Sheet from "./ui/Sheet.svelte";
  import HelpMark from "./ui/HelpMark.svelte";
  import Switch from "./ui/Switch.svelte";
  import Seg from "./ui/Seg.svelte";
  import GameIcon from "./ui/GameIcon.svelte";
  import ProgressButton from "./ui/ProgressButton.svelte";
  import { Job } from "./job.svelte";
  import type { Snippet } from "svelte";
  import { refocus, usable } from "./ui/refocus";

  let {
    open = $bindable(),
    view = $bindable("recent"),
    settings = $bindable(),
    console = false,
    open_,
    test,
    acts,
  }: { open: boolean; view?: "recent" | "choose"; settings: Settings; console?: boolean; open_: (id: string) => void; test: () => Promise<NoticeOutcome>; acts?: Snippet<[Notice]> } = $props();

  let now = $state(Date.now());
  // Seen once you've had Recent open and close the panel: the count on the bell starts again from zero.
  let sawRecent = false;
  $effect(() => {
    if (open && view === "recent") sawRecent = true;
    else if (!open && sawRecent) {
      sawRecent = false;
      if (settings.game.notices.some((n) => !n.read)) settings.game.notices = settings.game.notices.map((n) => (n.read ? n : { ...n, read: true }));
    }
  });

  const kinds = $derived(kindsFor(console));
  const groups = $derived([...new Set(kinds.map((k) => k.group))].map((g) => ({ g, kinds: kinds.filter((k) => k.group === g) })));
  const note = (g: keyof typeof GROUP_NOTE) => GROUP_NOTE[g][console ? "console" : "pc"];
  const quiet = (k: NoticeKind) => settings.notifyOptions.quiet.includes(k);
  function setQuiet(k: NoticeKind, on: boolean) {
    const q = settings.notifyOptions.quiet.filter((x) => x !== k);
    settings.notifyOptions.quiet = on ? [...q, k] : q;
  }
  /** Where a click on it goes, for its tooltip: "Opens Home (Baro)". */
  function opens(n: Notice) {
    const { page, card } = splitTarget(n.to ?? noticeKind[n.kind]?.to ?? "home");
    const label = pageById[page as PageId]?.label ?? "Home";
    return `Opens ${label}${card ? `, at ${CARD_NAME[card] ?? card}` : ""}`;
  }
  const CARD_NAME: Record<string, string> = { alerts: "Needs you", baro: "Baro", varzia: "Varzia", deals: "Cheap buys", fissures: "Fissures now", today: "Worth doing today", foundry: "Foundry" };

  // ---------------------------------------------------------------- pausing
  const pausedFor = $derived(settings.notifyOptions.pausedUntil != null && settings.notifyOptions.pausedUntil > now);
  const paused = $derived(settings.notifyOptions.paused || pausedFor);
  const pauseChoice = $derived(settings.notifyOptions.paused ? "on" : pausedFor ? (settings.notifyOptions.pausedHow ?? "hour") : "off");
  function pause(how: "off" | "hour" | "tomorrow" | "on") {
    const o = settings.notifyOptions;
    if (how === "off") {
      o.paused = false;
      o.pausedUntil = null;
    } else if (how === "on") {
      o.paused = true;
      o.pausedUntil = null;
    } else {
      o.paused = false;
      o.pausedHow = how;
      const d = new Date();
      if (how === "hour") o.pausedUntil = Date.now() + 3_600_000;
      else {
        d.setDate(d.getDate() + 1);
        d.setHours(8, 0, 0, 0);
        o.pausedUntil = +d;
      }
    }
  }
  const hhmm = (t: number) => new Date(t).toLocaleString(undefined, { weekday: new Date(t).toDateString() === new Date().toDateString() ? undefined : "short", hour: "2-digit", minute: "2-digit" });
  const allOn = (ks: NoticeKindInfo[]) => ks.every((k) => settings.notify[k.kind]);
  function setAll(ks: NoticeKindInfo[], on: boolean) {
    const next = { ...settings.notify };
    for (const k of ks) next[k.kind] = on;
    settings.notify = next;
  }

  // ---------------------------------------------------------------- the history, by day
  $effect(() => {
    if (!open) return;
    now = Date.now();
    const t = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(t);
  });
  const dayOf = (t: number) => new Date(t).toDateString();
  /** Recent narrowed to one kind ("" for all). */
  let only = $state<NoticeKind | "">("");
  const kindsLogged = $derived([...new Set(settings.game.notices.map((n) => n.kind))].filter((k) => noticeKind[k]));
  const days = $derived.by(() => {
    const out: { label: string; items: Notice[] }[] = [];
    const today = dayOf(now);
    const yesterday = dayOf(now - 86_400_000);
    for (const n of settings.game.notices) {
      if (only && n.kind !== only) continue;
      const d = dayOf(n.at);
      const label = d === today ? "Today" : d === yesterday ? "Yesterday" : new Date(n.at).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
      const last = out.at(-1);
      if (last?.label === label) last.items.push(n);
      else out.push({ label, items: [n] });
    }
    return out;
  });
  function when(t: number) {
    const min = Math.round((now - t) / 60_000);
    if (min < 1) return "just now";
    if (min < 60) return `${min} min ago`;
    return new Date(t).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
  let clearing = $state(false);
  // The test notification: sent after a few seconds, by the same route as the real ones, and then
  // the panel says what became of it.
  let testing = $state(false);
  /** The five seconds before it goes; after that it is the send itself that is awaited. */
  let counting = $state(false);
  let tested = $state<NoticeOutcome | null>(null);
  async function sendTest() {
    if (testing) return;
    testing = true;
    counting = true;
    setTimeout(() => (counting = false), TEST_WAIT_MS);
    tested = null;
    try {
      tested = await test();
    } catch (e) {
      tested = { how: "failed", why: String((e as Error)?.message ?? e) };
    } finally {
      testing = false;
    }
  }
  // The test: working while it posts (a second click does nothing), then "Sent" or why not.
  const discordJob = new Job(4000);
  function testDiscord() {
    void discordJob.run(async () => {
      const url = settings.notifyOptions.discord.url;
      if (!(await discordConfirm(url))) throw new Error("not confirmed: say yes in the window MyOrbiter shows");
      await discordPost(url, "**MyOrbiter**\nThis is how notifications will look here.");
      discordSent(null);
      return "Sent";
    });
  }
</script>

<Sheet bind:open title="Notifications" kicker="MyOrbiter" help="notices">
  <div class="top">
    <Seg bind:value={view} options={[{ v: "recent", label: "Recent", title: "What MyOrbiter told you, newest first" }, { v: "choose", label: "Choose", title: "What MyOrbiter tells you about" }]} />
    {#if view === "recent" && settings.game.notices.length}
    <div class="acts">
      {#if kindsLogged.length > 1}
        <select bind:value={only} aria-label="Show" title="Show one kind only">
          <option value="">All kinds</option>
          {#each kindsLogged as k (k)}<option value={k}>{noticeKind[k].label}</option>{/each}
        </select>
      {/if}
      {#if clearing}
        <span class="small">Clear all {settings.game.notices.length}?</span>
        <button class="danger" onclick={() => { settings.game.notices = []; clearing = false; }}>Clear</button>
        <button class="link quiet" onclick={(e) => { const row = e.currentTarget.parentElement; refocus(e.currentTarget, () => [...(row?.querySelectorAll<HTMLElement>("button") ?? [])].find((b) => usable(b) && b.textContent?.trim() === "Clear all")); clearing = false; }}>Keep them</button>
      {:else}
        <button class="link quiet" title="Empty the list. Nothing else changes." onclick={() => (clearing = true)}>Clear all</button>
      {/if}
    </div>
    {/if}
    {#if paused}<span class="pausedtag" title="Notifications still go in Recent, but nothing pops up. Change it under Choose.">{pausedFor && !settings.notifyOptions.paused ? `Paused until ${hhmm(settings.notifyOptions.pausedUntil!)}` : "Paused"}</span>{/if}
  </div>

  {#if view === "recent"}
    {#if !settings.game.notices.length}
      <p class="dim empty">Nothing yet. What MyOrbiter tells you shows up here, newest first, so you can catch up on what you missed. <button class="link" onclick={() => (view = "choose")}>Choose what it tells you about →</button></p>
    {:else}
      <!-- One block for the days, so the sheet's gap sits once above them, not around every heading. -->
      <div class="days">
      {#each days as d (d.label)}
        <section class="dayblock" aria-label={d.label}>
        <h3 class="register day">{d.label}</h3>
        <ul class="list">
          {#each d.items as n (n.id)}
            {@const k = noticeKind[n.kind]}
            <li>
              <button class="notice" class:unread={!n.read} title={opens(n)} onclick={() => open_(n.id)}>
                <span class="ic"><GameIcon name={k?.icon ?? "market"} size={20} /></span>
                <span class="txt">
                  <span class="t"><b>{n.title}</b><span class="dim small nowrap">{when(n.at)}</span></span>
                  {#if n.body}<span class="b">{n.body}</span>{/if}
                  <span class="k dim small">{k?.label ?? n.kind}{#if n.outcome}{" · "}<span class:bad={n.outcome.how === "failed"}>{outcomeText(n.outcome)}</span>{/if}</span>
                </span>
              </button>
              {#if acts}<div class="nacts">{@render acts(n)}</div>{/if}
            </li>
          {/each}
        </ul>
        </section>
      {/each}
      </div>
    {/if}
  {:else}
    <section class="how">
      <div class="pause">
        <span class="register">Pause</span>
        <div class="pausebtns" role="radiogroup" aria-label="Pause notifications">
          <button role="radio" aria-checked={pauseChoice === "off"} class:on={pauseChoice === "off"} title="Notifications pop up as they come" onclick={() => pause("off")}>Off</button>
          <button role="radio" aria-checked={pauseChoice === "hour"} class:on={pauseChoice === "hour"} title="Nothing pops up for an hour; they still go in Recent" onclick={() => pause("hour")}>1 hour</button>
          <button role="radio" aria-checked={pauseChoice === "tomorrow"} class:on={pauseChoice === "tomorrow"} title="Nothing pops up until 8 tomorrow morning; they still go in Recent" onclick={() => pause("tomorrow")}>Until tomorrow</button>
          <button role="radio" aria-checked={pauseChoice === "on"} class:on={pauseChoice === "on"} title="Nothing pops up until you set this back to Off; they still go in Recent" onclick={() => pause("on")}>Until I turn it off</button>
        </div>
        <span class="dim small">{pauseChoice === "hour" || pauseChoice === "tomorrow" ? `Paused until ${hhmm(settings.notifyOptions.pausedUntil!)}. ` : pauseChoice === "on" ? "Paused. " : ""}While paused, notifications still go in Recent, so you can catch up.</span>
      </div>
      <Switch bind:on={settings.notifyOptions.toasts} label="Pop-ups inside MyOrbiter">
        While you're looking at MyOrbiter: a notification shows by the sidebar for a few seconds. Click it to open what it's about.
      </Switch>
      <Switch bind:on={settings.notifyOptions.desktop} label="Desktop notifications">
        While MyOrbiter is behind other windows (or you're in the game): your desktop's notifications{console ? "" : ", where a click brings MyOrbiter up on what it's about (Linux and Windows)"}. Off: only Recent. Your desktop can still hold them back: Do Not Disturb does, and recent KDE Plasma turns it on by itself while a fullscreen window such as the game is in front (System Settings → Notifications).
      </Switch>
      {#if !console}
        <Switch bind:on={settings.notifyOptions.quietInFissure} label="Quiet while I'm in a fissure">
          Nothing pops up while you're in a fissure mission, except which reward to take. The rest waits in Recent.
        </Switch>
      {/if}
      <div class="testrow">
        <button class="stamp" disabled={testing} onclick={sendTest} title={`Sends a notification in ${TEST_WAIT_MS / 1000} seconds by the route the real ones take, and says what became of it. Nothing is saved.`}>{testing ? (counting ? `Sending in ${TEST_WAIT_MS / 1000} seconds…` : "Sending…") : "Send a test notification"}</button>
        <span class="small" class:warn-text={tested?.how === "failed"} role="status">
          {#if testing && counting}Click away to another window to try your desktop's notification; stay here and it shows in MyOrbiter.{:else if tested && !testing}{outcomeText(tested)}{tested.how === "app" ? ". MyOrbiter was in front: to try the desktop, click away from it during the countdown." : tested.how === "desktop" ? ". If nothing appeared, your desktop held it back: see Do Not Disturb under Desktop notifications." : ""}{/if}
        </span>
      </div>
      <div class="discord">
        <span class="register">Discord</span>
        <p class="dim small">Also send some notifications to a Discord channel of yours, to see them on your phone while you're away: in Discord, a channel's Edit Channel → Integrations → Webhooks → New Webhook → Copy Webhook URL, and paste it here. MyOrbiter asks once, in a window of its own, whether to send to a new address; until you say yes, nothing goes there.</p>
        <input type="url" placeholder="https://discord.com/api/webhooks/…" bind:value={settings.notifyOptions.discord.url} onchange={() => isDiscordWebhook(settings.notifyOptions.discord.url) && void discordConfirm(settings.notifyOptions.discord.url).catch(() => {})} aria-label="Discord webhook address" class:bad={!!settings.notifyOptions.discord.url && !isDiscordWebhook(settings.notifyOptions.discord.url)} />
        {#if settings.notifyOptions.discord.url && !isDiscordWebhook(settings.notifyOptions.discord.url)}<span class="small warn-text">That isn't a Discord webhook address.</span>{/if}
        {#if isDiscordWebhook(settings.notifyOptions.discord.url)}
          <span class="small dim">Send these to Discord:</span>
          <div class="dkinds">
            {#each NOTICE_KINDS.filter((k) => !(console && k.pcOnly)) as k (k.kind)}<Chip on={settings.notifyOptions.discord.kinds.includes(k.kind)} label={k.label} title={k.hint} onchange={(on: boolean) => (settings.notifyOptions.discord.kinds = on ? [...settings.notifyOptions.discord.kinds.filter((x) => x !== k.kind), k.kind] : settings.notifyOptions.discord.kinds.filter((x) => x !== k.kind))} />{/each}
          </div>
          <div class="row"><ProgressButton job={discordJob} label="Send a test to Discord" working="Sending…" doneLabel="Sent: check the channel" failLabel="Couldn't send" status title="Posts one test message to your Discord channel now, so you can see it works" onclick={testDiscord} /></div>
          {#if discordStatus.failed}<span class="small warn-text">The last notification didn't reach Discord ({discordStatus.failed}, {new Date(discordStatus.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}). If the webhook was deleted, paste a new one.</span>{/if}
        {/if}
      </div>
      <HelpMark part="notices.how" corner />
    </section>
    {#each groups as grp (grp.g)}
      <section class="grp">
        <header>
          <div class="hmark"><h3 class="register">{grp.g}</h3><HelpMark part="notices.kinds" /></div>
          <span class="dim small">{note(grp.g)}</span>
          <button class="link quiet" title={allOn(grp.kinds) ? `Turn off every kind under ${grp.g}` : `Turn on every kind under ${grp.g}`} onclick={() => setAll(grp.kinds, !allOn(grp.kinds))}>{allOn(grp.kinds) ? "All off" : "All on"}</button>
        </header>
        {#each grp.kinds as k (k.kind)}
          <div class="kind">
            <Switch bind:on={settings.notify[k.kind]} label={k.label}>{console && k.consoleHint ? k.consoleHint : k.hint}</Switch>
            {#if settings.notify[k.kind]}<Chip on={quiet(k.kind)} label="Recent only" title="Keep these in Recent without popping up" onchange={(on: boolean) => setQuiet(k.kind, on)} />{/if}
          </div>
        {/each}
      </section>
    {/each}
    {#if console}<p class="dim small">Notifications that need your inventory or the game log (mastery, whispers, the reward screen) are PC only.</p>{/if}
  {/if}
</Sheet>

<style>
  .top { display: flex; flex-wrap: wrap; align-items: center; gap: .6rem .8rem; }
  .pausedtag { font-family: var(--face-register); font-size: .74rem; letter-spacing: .14em; text-transform: uppercase; color: var(--gold); border: 1px solid var(--gold-dim); padding: .15rem .45rem; }
  .empty { line-height: 1.6; }
  .acts { display: flex; justify-content: flex-end; align-items: center; gap: .6rem; margin-left: auto; order: 2; }
  .days { display: grid; gap: 1.2rem; margin-top: -.6rem; }
  .dayblock { display: grid; gap: .45rem; }
  .day { margin: 0; font-size: 11px; color: var(--gold-dim); letter-spacing: .18em; }
  .list { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
  .notice { display: grid; grid-template-columns: 1.8rem 1fr; gap: .7rem; width: 100%; text-align: left; padding: .6rem .7rem; border: 1px solid transparent; background: transparent; color: var(--platinum-dim); font-family: var(--face-text); font-size: .85rem; font-weight: 400; letter-spacing: 0; text-transform: none; transition: background .12s, border-color .12s; }
  .notice:hover { background: rgb(241 243 246 / 4%); border-color: var(--rule); }
  .notice.unread { background: rgb(214 174 74 / 7%); box-shadow: inset 2px 0 0 var(--gold); color: var(--platinum); }
  .ic { padding-top: .1rem; }
  /* A notification's own controls (a sale's +rep), under its text and in line with it. */
  .nacts { display: flex; align-items: center; gap: .9rem; padding: 0 .7rem .6rem 3.2rem; font-size: .8rem; }
  .nacts:not(:has(*)) { display: none; }
  /* With controls under it, the whole entry is lit as new, not just its text. */
  li:has(.nacts > :global(*)):has(.notice.unread) { background: rgb(214 174 74 / 7%); box-shadow: inset 2px 0 0 var(--gold); }
  li:has(.nacts > :global(*)) .notice.unread { background: transparent; box-shadow: none; }
  .txt { display: grid; gap: .2rem; min-width: 0; }
  .t { display: flex; justify-content: space-between; gap: .8rem; align-items: baseline; }
  .t b { font-weight: 600; color: var(--platinum); }
  .b { white-space: pre-line; line-height: 1.45; display: -webkit-box; -webkit-line-clamp: 4; line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
  .k { font-size: .7rem; }
  .k .bad { color: var(--alert); }
  .how { display: grid; gap: 1rem; padding-bottom: 1.2rem; border-bottom: 1px solid var(--rule); }
  .pause { display: grid; gap: .45rem; }
  .pausebtns { display: flex; flex-wrap: wrap; gap: 0; }
  .pausebtns button { margin-left: -1px; padding: .35rem .7rem; font-size: 11px; transition: border-color var(--quick); }
  .pausebtns button.on { color: var(--slab); background: var(--platinum); border-color: var(--platinum); }
  .kind { display: grid; gap: .4rem; }
  .kind :global(.chip) { justify-self: start; font-size: 11px; padding: .2rem .5rem; }
  .row { display: flex; }
  .testrow { display: flex; flex-wrap: wrap; align-items: center; gap: .4rem .8rem; }
  .testrow span { flex: 1 1 14rem; min-width: 0; line-height: 1.45; }
  .grp { display: grid; gap: .9rem; padding: 1.1rem 0; border-bottom: 1px solid var(--rule); }
  .grp header { display: flex; align-items: baseline; gap: .7rem; flex-wrap: wrap; }
  .grp header .link { margin-left: auto; }
  .grp h3 { margin: 0; display: flex; align-items: center; gap: .5rem; }
  .grp .hmark { gap: .5rem; }
  .how { position: relative; padding-right: 2rem; }
  .nowrap { white-space: nowrap; }
  .discord { display: grid; gap: .45rem; padding-top: .8rem; border-top: 1px solid var(--rule); }
  .discord p { margin: 0; }
  .discord input.bad { border-color: var(--oxblood); }
  /* Webhook addresses are case-sensitive: shown as typed, placeholder included. */
  .discord input, .discord input::placeholder { text-transform: none; letter-spacing: normal; font-family: var(--face-text); }
  .dkinds { display: flex; flex-wrap: wrap; gap: .3rem; }
</style>
