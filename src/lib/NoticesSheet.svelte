<script lang="ts">
  // The bell in the sidebar: what MyOrbiter told you lately (click one to open what it's about),
  // with the pause for all of them. Which kinds it tells you about, and how they reach you, are in
  // Settings, Notifications (NoticeChoices.svelte), which Choose opens.
  import type { Settings } from "./backend";
  import { noticeKind, outcomeText, splitTarget, type Notice, type NoticeKind } from "./notices";
  import { pageById, type PageId } from "./pages";
  import Sheet from "./ui/Sheet.svelte";
  import GameIcon from "./ui/GameIcon.svelte";
  import NoticePause from "./ui/NoticePause.svelte";
  import type { Snippet } from "svelte";
  import { refocus, usable } from "./ui/refocus";

  let {
    open = $bindable(),
    settings = $bindable(),
    open_,
    onchoose,
    acts,
  }: { open: boolean; settings: Settings; open_: (id: string) => void; onchoose: () => void; acts?: Snippet<[Notice]> } = $props();

  let now = $state(Date.now());
  // Seen once you've had the panel open and close it: the count on the bell starts again from zero.
  let saw = false;
  $effect(() => {
    if (open) saw = true;
    else if (saw) {
      saw = false;
      if (settings.game.notices.some((n) => !n.read)) settings.game.notices = settings.game.notices.map((n) => (n.read ? n : { ...n, read: true }));
    }
  });

  /** Where a click on it goes, for its tooltip: "Opens Home (Baro)". */
  function opens(n: Notice) {
    const { page, card } = splitTarget(n.to ?? noticeKind[n.kind]?.to ?? "home");
    const label = pageById[page as PageId]?.label ?? "Home";
    return `Opens ${label}${card ? `, at ${CARD_NAME[card] ?? card}` : ""}`;
  }
  const CARD_NAME: Record<string, string> = { alerts: "Needs you", baro: "Baro", varzia: "Varzia", deals: "Cheap buys", fissures: "Fissures now", today: "Worth doing today", foundry: "Foundry" };

  const pausedFor = $derived(settings.notifyOptions.pausedUntil != null && settings.notifyOptions.pausedUntil > now);
  const paused = $derived(settings.notifyOptions.paused || pausedFor);
  const hhmm = (t: number) => new Date(t).toLocaleString(undefined, { weekday: new Date(t).toDateString() === new Date().toDateString() ? undefined : "short", hour: "2-digit", minute: "2-digit" });

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
</script>

<Sheet bind:open title="Notifications" kicker="MyOrbiter" help="notices">
  <div class="top">
    <button class="stamp choose" title="Settings, Notifications: a switch for every kind, and how they reach you" onclick={onchoose}>Choose what it tells you about</button>
    {#if settings.game.notices.length}
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
    {#if paused}<span class="pausedtag" title="Notifications still go in Recent, but nothing pops up. Change it under Pause, below.">{pausedFor && !settings.notifyOptions.paused ? `Paused until ${hhmm(settings.notifyOptions.pausedUntil!)}` : "Paused"}</span>{/if}
  </div>
  <NoticePause bind:settings {now} />

  {#if !settings.game.notices.length}
    <p class="dim empty">Nothing yet. What MyOrbiter tells you shows up here, newest first, so you can catch up on what you missed. Most kinds start off: <button class="link" onclick={onchoose}>choose what it tells you about →</button></p>
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
  .nowrap { white-space: nowrap; }
</style>
