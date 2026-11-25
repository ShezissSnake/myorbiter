<script lang="ts">
  // Settings, Notifications: a switch for every kind, in their groups, then how they reach you (the
  // pause, pop-ups, the desktop, quiet in a fissure, a test, Discord). Every switch here is the
  // setting itself: the same state wherever else it shows (the pause under the bell).
  import { discordAsk, discordFieldAction, discordForget, discordPost, isDiscordWebhook, type Settings } from "./backend";
  import { discordStatus, discordSent } from "./discordStatus.svelte";
  import { GROUP_NOTE, kindsFor, NOTICE_KINDS, outcomeText, TEST_WAIT_MS, type NoticeKind, type NoticeKindInfo, type NoticeOutcome } from "./notices";
  import Chip from "./ui/Chip.svelte";
  import HelpMark from "./ui/HelpMark.svelte";
  import Switch from "./ui/Switch.svelte";
  import NoticePause from "./ui/NoticePause.svelte";
  import ProgressButton from "./ui/ProgressButton.svelte";
  import { Job } from "./job.svelte";

  let { settings = $bindable(), console = false, open, test }: { settings: Settings; console?: boolean; open: boolean; test: () => Promise<NoticeOutcome> } = $props();

  // Ages the pause's "until" while Settings is open.
  let now = $state(Date.now());
  $effect(() => {
    if (!open) return;
    now = Date.now();
    const t = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(t);
  });

  const kinds = $derived(kindsFor(console));
  const groups = $derived([...new Set(kinds.map((k) => k.group))].map((g) => ({ g, kinds: kinds.filter((k) => k.group === g) })));
  const note = (g: keyof typeof GROUP_NOTE) => GROUP_NOTE[g][console ? "console" : "pc"];
  const quiet = (k: NoticeKind) => settings.notifyOptions.quiet.includes(k);
  function setQuiet(k: NoticeKind, on: boolean) {
    const q = settings.notifyOptions.quiet.filter((x) => x !== k);
    settings.notifyOptions.quiet = on ? [...q, k] : q;
  }
  const allOn = (ks: NoticeKindInfo[]) => ks.every((k) => settings.notify[k.kind]);
  function setAll(ks: NoticeKindInfo[], on: boolean) {
    const next = { ...settings.notify };
    for (const k of ks) next[k.kind] = on;
    settings.notify = next;
  }

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
  // An emptied field removes the confirmed address MyOrbiter kept as soon as it is empty; a webhook
  // address is asked about when the field is left. The event's own value is read, so this doesn't
  // rest on when the binding writes the setting. Whether the confirmation dialog holds MyOrbiter's
  // window is not shown by the dialog's code (on Linux it has no parent window but is modal; on
  // Windows it has a parent), so `discordAsk` removes a yes that comes back after the field was
  // emptied either way. A failed removal is logged on the Rust side.
  const discordUrlNow = () => settings.notifyOptions.discord.url;
  function discordField(event: "input" | "change" | "blur", value: string) {
    const action = discordFieldAction(value, event);
    if (action === "forget") void discordForget(value).catch(() => {});
    else if (action === "confirm") void discordAsk(value, discordUrlNow).catch(() => {});
  }
  // The test: working while it posts (a second click does nothing), then "Sent" or why not.
  const discordJob = new Job(4000);
  function testDiscord() {
    void discordJob.run(async () => {
      const url = settings.notifyOptions.discord.url;
      const answer = await discordAsk(url, discordUrlNow);
      if (answer === "emptied") throw new Error("not sent: the address field was emptied");
      if (answer === "no") throw new Error("not confirmed: say yes in the window MyOrbiter shows");
      await discordPost(url, "**MyOrbiter**\nThis is how notifications will look here.");
      discordSent(null);
      return "Sent";
    });
  }
</script>

<div class="choices">
  <p class="hint lead">What MyOrbiter tells you about. The kinds about your own listings and sales{console ? "" : ", whispers, the reward to take"} and what you set up to watch for start on; the rest start off: turn on the ones you want. What it tells you goes in Recent, under the envelope at the bottom of the sidebar.</p>
  {#each groups as grp (grp.g)}
    <section class="grp">
      <header>
        <div class="hmark"><h3 class="register">{grp.g}</h3><HelpMark part="notices.kinds" /></div>
        <span class="dim small">{note(grp.g)}</span>
        <button class="link quiet" title={allOn(grp.kinds) ? `Turn off every kind under ${grp.g}` : `Turn on every kind under ${grp.g}`} onclick={() => setAll(grp.kinds, !allOn(grp.kinds))}>{allOn(grp.kinds) ? "All off" : "All on"}</button>
      </header>
      {#each grp.kinds as k (k.kind)}
        <div class="kind">
          <Switch name="notices.kind.{k.kind}" bind:on={settings.notify[k.kind]} label={k.label}>{console && k.consoleHint ? k.consoleHint : k.hint}</Switch>
          {#if settings.notify[k.kind]}<Chip on={quiet(k.kind)} label="Recent only" title="Keep these in Recent without popping up" onchange={(on: boolean) => setQuiet(k.kind, on)} />{/if}
        </div>
      {/each}
    </section>
  {/each}
  {#if console}<p class="dim small">Notifications that need your inventory or the game log (mastery, whispers, the reward screen) are PC only.</p>{/if}

  <section class="how">
    <div class="hmark"><h3 class="register">How they reach you</h3><HelpMark part="notices.how" /></div>
    <NoticePause bind:settings {now} />
    <Switch name="notices.toasts" bind:on={settings.notifyOptions.toasts} label="Pop-ups inside MyOrbiter">
      While you're looking at MyOrbiter: a notification shows by the sidebar for a few seconds. Click it to open what it's about.{console ? "" : " Which reward to take doesn't while Current fissure is on screen with nothing over it: that page marks the card itself."}
    </Switch>
    <Switch name="notices.desktop" bind:on={settings.notifyOptions.desktop} label="Desktop notifications">
      While MyOrbiter is behind other windows (or you're in the game): your desktop's notifications{console ? "" : ", where a click brings MyOrbiter up on what it's about (Linux and Windows)"}. Off: only Recent. Your desktop can still hold them back: Do Not Disturb does, and recent KDE Plasma turns it on by itself while a fullscreen window such as the game is in front (System Settings → Notifications).
    </Switch>
    {#if !console}
      <Switch name="notices.quiet-in-fissure" bind:on={settings.notifyOptions.quietInFissure} label="Quiet while I'm in a fissure">
        Nothing pops up while you're in a fissure mission, except which reward to take (not over Current fissure, which marks the card itself). The rest waits in Recent.
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
      <p class="dim small">Also send some notifications to a Discord channel of yours, to see them on your phone while you're away: in Discord, a channel's Edit Channel → Integrations → Webhooks → New Webhook → Copy Webhook URL, and paste it here. MyOrbiter asks once, in a window of its own, whether to send to a new address; until you say yes, nothing goes there. No notification goes to Discord either while notifications are paused (even for a kind you picked here), or for a kind that is switched off above.</p>
      <input type="url" placeholder="https://discord.com/api/webhooks/…" bind:value={settings.notifyOptions.discord.url} oninput={(e) => discordField("input", e.currentTarget.value)} onchange={(e) => discordField("change", e.currentTarget.value)} onblur={(e) => discordField("blur", e.currentTarget.value)} aria-label="Discord webhook address" class:bad={!!settings.notifyOptions.discord.url && !isDiscordWebhook(settings.notifyOptions.discord.url)} />
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
  </section>
</div>

<style>
  .choices { display: grid; grid-template-columns: minmax(0, 1fr); gap: 0; }
  .lead { margin: 0 0 .2rem; }
  .hint { font-size: .76rem; color: var(--platinum-deep); }
  h3 { margin: 0; color: var(--gold); display: flex; align-items: center; gap: .5rem; }
  .hmark { display: flex; align-items: center; gap: .5rem; }
  .kind { display: grid; gap: .4rem; }
  .kind :global(.chip) { justify-self: start; font-size: 11px; padding: .2rem .5rem; }
  .row { display: flex; }
  .grp { display: grid; gap: .9rem; padding: 1.1rem 0; border-bottom: 1px solid var(--rule); }
  .grp header { display: flex; align-items: baseline; gap: .7rem; flex-wrap: wrap; }
  .grp header .link { margin-left: auto; }
  .how { display: grid; gap: 1rem; padding: 1.1rem 0 0; }
  .how > .hmark > :global(.helpmark) { margin-left: auto; }
  .testrow { display: flex; flex-wrap: wrap; align-items: center; gap: .4rem .8rem; }
  .testrow span { flex: 1 1 14rem; min-width: 0; line-height: 1.45; }
  .discord { display: grid; gap: .45rem; padding-top: .8rem; border-top: 1px solid var(--rule); }
  .discord p { margin: 0; }
  .discord input.bad { border-color: var(--oxblood); }
  /* Webhook addresses are case-sensitive: shown as typed, placeholder included. */
  .discord input, .discord input::placeholder { text-transform: none; letter-spacing: normal; font-family: var(--face-text); }
  .dkinds { display: flex; flex-wrap: wrap; gap: .3rem; }
</style>
