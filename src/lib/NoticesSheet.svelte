<script lang="ts">
  // The bell in the sidebar: what orbiter told you lately (click one to open what it's about), and
  // what it tells you about, kind by kind, with a pause for all of them.
  import type { Settings } from "./backend";
  import { kindsFor, noticeKind, type Notice, type NoticeKindInfo } from "./notices";
  import Sheet from "./ui/Sheet.svelte";
  import Switch from "./ui/Switch.svelte";
  import Seg from "./ui/Seg.svelte";
  import GameIcon from "./ui/GameIcon.svelte";

  let {
    open = $bindable(),
    settings = $bindable(),
    console = false,
    open_,
    test,
  }: { open: boolean; settings: Settings; console?: boolean; open_: (id: string) => void; test: () => void } = $props();

  let view = $state<"recent" | "choose">("recent");
  // Seen once the panel closes: the count on the bell starts again from zero.
  let wasOpen = false;
  $effect(() => {
    if (open) wasOpen = true;
    else if (wasOpen) {
      wasOpen = false;
      if (settings.game.notices.some((n) => !n.read)) settings.game.notices = settings.game.notices.map((n) => (n.read ? n : { ...n, read: true }));
    }
  });

  const kinds = $derived(kindsFor(console));
  const groups = $derived([...new Set(kinds.map((k) => k.group))].map((g) => ({ g, kinds: kinds.filter((k) => k.group === g) })));
  const GROUP_NOTE: Record<string, string> = {
    Trading: "warframe.market, buyers and bargains.",
    Mastery: "Chances at mastery you're missing, from the world as it is right now.",
    Fissures: "Relics and the reward screen.",
    orbiter: "orbiter itself.",
  };
  const allOn = (ks: NoticeKindInfo[]) => ks.every((k) => settings.notify[k.kind]);
  function setAll(ks: NoticeKindInfo[], on: boolean) {
    const next = { ...settings.notify };
    for (const k of ks) next[k.kind] = on;
    settings.notify = next;
  }

  // ---------------------------------------------------------------- the history, by day
  let now = $state(Date.now());
  $effect(() => {
    if (!open) return;
    now = Date.now();
    const t = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(t);
  });
  const dayOf = (t: number) => new Date(t).toDateString();
  const days = $derived.by(() => {
    const out: { label: string; items: Notice[] }[] = [];
    const today = dayOf(now);
    const yesterday = dayOf(now - 86_400_000);
    for (const n of settings.game.notices) {
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
</script>

<Sheet bind:open title="Notifications" kicker="orbiter">
  <div class="top">
    <Seg bind:value={view} options={[{ v: "recent", label: "Recent", title: "What orbiter told you, newest first" }, { v: "choose", label: "Choose", title: "What orbiter tells you about" }]} />
    {#if settings.notifyOptions.paused}<span class="pausedtag" title="Notifications still go in Recent, but nothing pops up. Turn it off under Choose.">Paused</span>{/if}
  </div>

  {#if view === "recent"}
    {#if !settings.game.notices.length}
      <p class="dim empty">Nothing yet. What orbiter tells you shows up here, newest first, so you can catch up on what you missed. <button class="link" onclick={() => (view = "choose")}>Choose what it tells you about →</button></p>
    {:else}
      <div class="acts">
        {#if clearing}
          <span class="small">Clear all {settings.game.notices.length}?</span>
          <button class="danger" onclick={() => { settings.game.notices = []; clearing = false; }}>Clear</button>
          <button class="link quiet" onclick={() => (clearing = false)}>Keep them</button>
        {:else}
          <button class="link quiet" title="Empty the list. Nothing else changes." onclick={() => (clearing = true)}>Clear all</button>
        {/if}
      </div>
      {#each days as d (d.label)}
        <h3 class="register day">{d.label}</h3>
        <ul class="list">
          {#each d.items as n (n.id)}
            {@const k = noticeKind[n.kind]}
            <li>
              <button class="notice" class:unread={!n.read} title="Open {k?.to === 'home' && !n.to ? 'Home' : 'the page it is about'}" onclick={() => open_(n.id)}>
                <span class="ic"><GameIcon name={k?.icon ?? "market"} size={20} /></span>
                <span class="txt">
                  <span class="t"><b>{n.title}</b><span class="dim small nowrap">{when(n.at)}</span></span>
                  {#if n.body}<span class="b">{n.body}</span>{/if}
                  <span class="k dim small">{k?.label ?? n.kind}</span>
                </span>
              </button>
            </li>
          {/each}
        </ul>
      {/each}
    {/if}
  {:else}
    <section class="how">
      <Switch bind:on={settings.notifyOptions.paused} label="Pause notifications">
        Nothing pops up until you turn this off. They still go in Recent, so you can catch up later.
      </Switch>
      <Switch bind:on={settings.notifyOptions.toasts} label="Pop-ups inside orbiter">
        While you're looking at orbiter, a notification shows in a corner of its window (for a few seconds; click it to open what it's about). Off: only Recent. When orbiter is behind other windows, they go to your desktop's notifications.
      </Switch>
      <div class="row"><button class="stamp" onclick={test} title="Sends one notification now, the way the others will look">Send a test notification</button></div>
    </section>
    {#each groups as grp (grp.g)}
      <section class="grp">
        <header>
          <h3 class="register">{grp.g === "orbiter" ? "orbiter" : grp.g}</h3>
          <span class="dim small">{GROUP_NOTE[grp.g]}</span>
          <button class="link quiet" onclick={() => setAll(grp.kinds, !allOn(grp.kinds))}>{allOn(grp.kinds) ? "All off" : "All on"}</button>
        </header>
        {#each grp.kinds as k (k.kind)}
          <Switch bind:on={settings.notify[k.kind]} label={k.label}>{k.hint}</Switch>
        {/each}
      </section>
    {/each}
    {#if console}<p class="dim small">Notifications that need your inventory or the game log (mastery, whispers, the reward screen) are PC only.</p>{/if}
  {/if}
</Sheet>

<style>
  .top { display: flex; align-items: center; gap: .8rem; margin-bottom: 1rem; }
  .pausedtag { font-family: var(--face-register); font-size: .62rem; letter-spacing: .14em; text-transform: uppercase; color: var(--gold); border: 1px solid var(--gold-dim); padding: .15rem .45rem; }
  .empty { line-height: 1.6; }
  .acts { display: flex; justify-content: flex-end; align-items: center; gap: .6rem; margin-bottom: .3rem; }
  .day { margin: 1rem 0 .4rem; font-size: .62rem; color: var(--gold-dim); letter-spacing: .18em; }
  .list { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
  .notice { display: grid; grid-template-columns: 1.8rem 1fr; gap: .7rem; width: 100%; text-align: left; padding: .6rem .7rem; border: 1px solid transparent; background: transparent; color: var(--platinum-dim); font-family: var(--face-text); font-size: .85rem; letter-spacing: 0; text-transform: none; transition: background .12s, border-color .12s; }
  .notice:hover { background: rgb(230 233 238 / 4%); border-color: var(--rule); }
  .notice.unread { background: rgb(214 174 74 / 7%); box-shadow: inset 2px 0 0 var(--gold); color: var(--platinum); }
  .ic { padding-top: .1rem; }
  .txt { display: grid; gap: .2rem; min-width: 0; }
  .t { display: flex; justify-content: space-between; gap: .8rem; align-items: baseline; }
  .t b { font-weight: 600; color: var(--platinum); }
  .b { white-space: pre-line; line-height: 1.45; display: -webkit-box; -webkit-line-clamp: 4; line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
  .k { font-size: .7rem; }
  .how { display: grid; gap: 1rem; padding-bottom: 1.2rem; border-bottom: 1px solid var(--rule); }
  .row { display: flex; }
  .grp { display: grid; gap: .9rem; padding: 1.1rem 0; border-bottom: 1px solid var(--rule); }
  .grp header { display: flex; align-items: baseline; gap: .7rem; flex-wrap: wrap; }
  .grp header .link { margin-left: auto; }
  .grp h3 { margin: 0; }
  .nowrap { white-space: nowrap; }
</style>
