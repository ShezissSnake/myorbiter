<script lang="ts">
  // Nox's Frame's top-voted builds for the item (at most 5, NOX_LISTED: the most voted within the age
  // limit, settings.buildsMaxAgeDays, two years unless changed), read on demand through the source in
  // nox.ts: the list when the item is opened (one request a week at most), a build's page only when
  // you open it. An opened build joins the page's tiers as a full card (the page's onopen); one
  // already opened shows from the copy kept on this computer, with no request. Credit to the
  // authors and the site stays in view.
  import { links, openUrl } from "../../links.svelte";
  import Opening from "../Opening.svelte";
  import type { CatalogItem } from "../../core/types";
  import { noxListedWithinAge, NOX_SITE, type Build, type Nox, type NoxListed, type NoxOpened } from "../../core/builds";
  import { ago, copyLine, dayOf, listedAt, savedFrom } from "../../core/buildsPage";
  import { arrive } from "../../motion";
  import ProgressButton from "../ProgressButton.svelte";
  import Icon from "../Icon.svelte";

  let {
    nox,
    item,
    catalog,
    maxAgeDays,
    showOld = $bindable(false),
    ready,
    readError = null,
    saved,
    onopen,
    onshow,
    hidden = $bindable(0),
    count = $bindable(0),
  }: {
    nox: Nox;
    item: CatalogItem;
    catalog: ReadonlyMap<string, CatalogItem>;
    /** settings.buildsMaxAgeDays (0: no limit). */
    maxAgeDays: number;
    /** The page's "N older hidden: show", for this list too. */
    showOld?: boolean;
    /** The page has read the item's sources (the list is in the week's cache now, or failed). */
    ready: boolean;
    /** What the page's read of Nox's Frame failed with: shown here, not asked again until Try again. */
    readError?: string | null;
    /** settings.builds: a listed build saved already says so. */
    saved: readonly Build[];
    /** A build opened: the page shows it in its tier. */
    onopen: (b: Build, got: NoxOpened) => void;
    /** Shows a build already on the page (by its page's address); false when it isn't there. */
    onshow: (url: string) => boolean;
    /** Listed builds hidden for their age (and not opened), for the page's count. */
    hidden?: number;
    /** Listed builds shown. */
    count?: number;
  } = $props();

  type ListState = { item: string; st: "reading" | "done" | "failed"; all: NoxListed[]; fetchedAt: number; stale: boolean; error?: string; fromCache: boolean };
  let list = $state<ListState | null>(null);
  let refreshing = $state(false);
  /** Each row's open: working, or how it went (an error, or the stale copy it showed). */
  let rows = $state<Record<string, { st: "working" | "done" | "failed"; error?: string; copy?: string | null }>>({});

  const ctx = () => ({ catalog, maxAgeDays: 0, now: Date.now() });
  const clean = (e: unknown) => String(e).replace(/^Error:\s*/, "");

  async function read(refresh: boolean) {
    const it = item;
    if (!refresh) list = { item: it.uniqueName, st: "reading", all: [], fetchedAt: 0, stale: false, fromCache: false };
    else refreshing = true;
    try {
      const r = await nox.listing(it, ctx(), { refresh });
      if (it !== item) return;
      list = { item: it.uniqueName, st: "done", all: r.entries, fetchedAt: r.fetchedAt, stale: r.stale, error: r.error, fromCache: r.fromCache };
    } catch (e) {
      if (it !== item) return;
      // A failed refresh keeps the list it had, and says why.
      if (refresh && list?.st === "done") list = { ...list, error: clean(e) };
      else list = { item: it.uniqueName, st: "failed", all: [], fetchedAt: 0, stale: false, error: clean(e), fromCache: false };
    } finally {
      if (it === item) refreshing = false;
    }
  }

  // The item's list, once the page's own read is through (so the two don't both go to the site).
  // Asked once per item and page read (the page's Try again reads afresh, and so does this).
  let askedFor: string | null = null;
  $effect(() => {
    const u = item.uniqueName;
    const err = readError;
    if (!ready) {
      askedFor = null;
      list = null;
      return;
    }
    const key = `${u}\n${err ?? ""}`;
    if (askedFor === key) return;
    askedFor = key;
    rows = {};
    if (err) list = { item: u, st: "failed", all: [], fetchedAt: 0, stale: false, error: err, fromCache: false };
    else void read(false);
  });

  const now = Date.now();
  const fresh = (l: NoxListed) => noxListedWithinAge(l, maxAgeDays, now);
  const all = $derived(list?.item === item.uniqueName ? list.all : []);
  const shown = $derived(showOld ? all : all.filter(fresh));
  $effect(() => {
    hidden = all.filter((l) => !fresh(l) && !l.opened).length;
    count = shown.length;
  });
  const old = $derived(all.filter((l) => !fresh(l)).length);

  async function open(l: NoxListed, refresh = false) {
    if (rows[l.path]?.st === "working") return;
    if (!refresh && onshow(l.url)) return;
    const it = item;
    rows[l.path] = { st: "working" };
    try {
      const got = await nox.open(it, l.path, ctx(), { refresh });
      rows[l.path] = { st: "done", copy: copyLine(got) };
      if (list) list = { ...list, all: list.all.map((x) => (x.path === l.path ? { ...x, opened: true } : x)) };
      onopen(got.build, got);
    } catch (e) {
      rows[l.path] = { st: "failed", error: clean(e) };
    }
  }

  const otherItem = (l: NoxListed) => !!l.item && l.item.toLowerCase() !== item.name.toLowerCase();
  const listCopy = $derived(list?.st === "done" ? copyLine(list) : null);
</script>

<section class="nox" data-card="nox" aria-label="Builds on {NOX_SITE}" aria-busy={!list || list.st === "reading" || refreshing}>
  <header class="hd">
    <h2 class="register">On {NOX_SITE}</h2>
    <span class="sub">Top-voted builds for {item.name}</span>
    <span class="grow"></span>
    {#if list?.st === "done" && list.fetchedAt && !listCopy}<span class="when" title="Read {dayOf(list.fetchedAt)}; MyOrbiter reads the list again after a week">Read {ago(list.fetchedAt, Date.now())}</span>{/if}
    {#if list?.st === "done"}
      <ProgressButton variant="link" label="Refresh" working="Reading…" state={refreshing ? "working" : "idle"} title="Read {item.name}'s list on {NOX_SITE} again now (MyOrbiter waits 3 s between reads)" onclick={() => read(true)} />
    {/if}
  </header>
  <p class="credit">
    Builds by their authors on <button type="button" class="link out" title="Open noxsframe.com in your browser" aria-busy={links.isOpening("https://noxsframe.com")} onclick={() => openUrl("https://noxsframe.com")}><Opening url={"https://noxsframe.com"}>{NOX_SITE}<Icon name="external" size={10} /></Opening></button>, a fan-made build planner. Open one to see it here, in its tier, with what you're missing.
  </p>

  {#if !list || list.st === "reading"}
    <p class="state" role="status"><span class="run" aria-hidden="true"></span>Reading {NOX_SITE}'s top builds for {item.name}…</p>
  {:else if list.st === "failed"}
    <p class="state bad" role="alert">{NOX_SITE} didn't answer: {list.error}. <button type="button" class="link" title="Ask again" onclick={() => read(false)}>Try again</button></p>
  {:else}
    {#if listCopy || list.error}<p class="state warn" role="status">{listCopy ?? `Couldn't read it again: ${list.error}`}</p>{/if}
    {#if !all.length}
      <p class="state">Nobody has posted a build for {item.name} on {NOX_SITE} yet.</p>
    {:else}
      <ol class="rows" in:arrive={{ y: 0 }}>
        {#each shown as l (l.path)}
          {@const r = rows[l.path]}
          {@const at = listedAt(l.date)}
          {@const kept = savedFrom(saved, l.url)}
          <li class="row" class:old={!fresh(l)}>
            <span class="votes" title="Votes on {NOX_SITE}">{#if l.votes != null}<b>{l.votes.toLocaleString("en")}</b><span class="vw">vote{l.votes === 1 ? "" : "s"}</span>{:else}<span class="vw">no votes</span>{/if}</span>
            <span class="main">
              <span class="tt">{l.title}</span>
              <span class="meta">
                {#if l.author}<span>by {l.author}</span>{/if}
                {#if at != null}<span title="Its date on {NOX_SITE}: {dayOf(at)}">{ago(at, Date.now())}</span>{/if}
                {#if otherItem(l)}<span title="The build's main item: {item.name} is part of its loadout">for {l.item}</span>{/if}
                {#if kept}<span class="kept" title="Saved to your builds">Saved</span>{/if}
              </span>
              {#if l.tags.length}<span class="tags" aria-label="Game modes">{#each l.tags as t (t)}<span class="chip" title="Tagged {t} on {NOX_SITE}">{t}</span>{/each}</span>{/if}
              {#if r?.st === "failed"}<span class="rowmsg bad" role="alert">{r.error}. <button type="button" class="link" title="Ask again" onclick={() => open(l)}>Try again</button></span>
              {:else if r?.copy}<span class="rowmsg warn">{r.copy}. <button type="button" class="link" title="Read this build's page again now" onclick={() => open(l, true)}>Refresh</button></span>{/if}
            </span>
            <span class="acts">
              {#if l.opened && r?.st !== "working"}
                <button type="button" class="opened" title="Kept on this computer: shows it in its tier at once, with no request" onclick={() => open(l)}><Icon name="check" size={11} /> Opened</button>
              {:else}
                <ProgressButton stamp={false} label="Open" working="Opening…" sizer={["Opened"]} state={r?.st === "working" ? "working" : "idle"} title="Read this build from {NOX_SITE} and show it here, in its tier, with what you're missing" onclick={() => open(l)} />
              {/if}
              <ProgressButton variant="icon" icon="external" size={12} tone="quiet" label="Open {l.title} on {NOX_SITE}" title="Open it on {NOX_SITE}, in your browser" working="Opening…" busy={links.isOpening(l.url)} onclick={() => openUrl(l.url)} />
            </span>
          </li>
        {/each}
      </ol>
      {#if old}<p class="older"><button type="button" class="link" aria-pressed={showOld} title={showOld ? "Hide them again" : `Show the builds older than ${maxAgeDays} days, this time only`} onclick={() => (showOld = !showOld)}>{showOld ? "Hide old ones" : `${old} older hidden: show`}</button></p>{/if}
    {/if}
  {/if}
</section>

<style>
  .nox { margin-top: var(--course); padding-top: var(--step); border-top: 1px solid var(--rule); }
  .hd { display: flex; flex-wrap: wrap; align-items: baseline; gap: .3rem .9rem; }
  .hd h2 { margin: 0; color: var(--sec); font-size: .7rem; }
  .sub { font-size: .82rem; color: var(--platinum-dim); }
  .grow { flex: 1; }
  .when { font-size: .74rem; color: var(--platinum-deep); }
  .hd :global(.link) { font-size: .8rem; }
  .credit { margin: .3rem 0 0; font-size: .78rem; color: var(--platinum-deep); }
  .out { display: inline-flex; align-items: center; gap: .2rem; }
  .state { display: flex; align-items: center; flex-wrap: wrap; gap: .3rem .6rem; margin: .7rem 0 0; font-size: .82rem; color: var(--platinum-dim); }
  .state.bad { color: var(--alert); }
  .state.warn { color: var(--alert); font-size: .78rem; }
  /* The band runs by transform (app.css, sweep-band), clipped to the bar. */
  .run { position: relative; overflow: hidden; width: 2.4rem; height: 2px; }
  .run::before { content: ""; position: absolute; inset: 0 auto 0 0; width: 40%; background: linear-gradient(90deg, transparent, var(--sec), transparent); animation: sweep-band 900ms linear infinite; }
  @media (prefers-reduced-motion: reduce) { .run { background: var(--sec-dim); } .run::before { display: none; } }

  .rows { list-style: none; margin: .7rem 0 0; padding: 0; display: grid; border-top: 1px solid var(--rule); }
  .row { display: grid; grid-template-columns: 4.2rem minmax(0, 1fr) auto; align-items: center; gap: .3rem 1rem; padding: .6rem .2rem .6rem 0; border-bottom: 1px solid var(--rule); }
  .row.old .tt { color: var(--platinum-dim); }
  .votes { display: grid; justify-items: center; line-height: 1.05; padding: .25rem 0; background: var(--well); border: 1px solid var(--rule); }
  .votes b { font-family: var(--face-figures); font-size: .95rem; font-weight: 600; color: var(--platinum); font-variant-numeric: tabular-nums; }
  .vw { font-family: var(--face-register); font-size: .6rem; letter-spacing: .12em; text-transform: uppercase; color: var(--platinum-deep); }
  .main { display: grid; gap: .22rem; min-width: 0; }
  .tt { font-size: .92rem; font-weight: 500; color: var(--platinum); overflow-wrap: anywhere; }
  .meta { display: flex; flex-wrap: wrap; gap: .1rem .8rem; font-size: .76rem; color: var(--platinum-deep); }
  .kept { color: var(--gold); }
  .tags { display: flex; flex-wrap: wrap; gap: .25rem; }
  .chip { padding: .02rem .4rem; border: 1px solid color-mix(in srgb, var(--sec) 40%, var(--rule)); color: var(--platinum-dim); font-size: .72rem; }
  .rowmsg { font-size: .76rem; }
  .rowmsg.bad, .rowmsg.warn { color: var(--alert); }
  .acts { display: inline-flex; align-items: center; gap: .35rem; }
  .acts :global(button.pb), .opened { padding: .32rem .7rem; font-size: .6rem; }
  .opened { display: inline-flex; align-items: center; gap: .35rem; color: var(--verdigris); border-color: color-mix(in srgb, var(--verdigris) 45%, var(--rule-control)); }
  .older { margin: .5rem 0 0; font-size: .8rem; }
  :global(html[data-room~="lt760"]) .row { grid-template-columns: 3.6rem minmax(0, 1fr); }
  :global(html[data-room~="lt760"]) .acts { grid-column: 2; }
</style>
