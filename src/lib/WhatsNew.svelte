<script lang="ts">
  // The update screen: what changed since you last looked, shown once after an update the way the
  // game shows its own. The update's date as a stamp, its biggest change struck large with Show me,
  // the rest of it as rows, earlier updates folded under their dates; Take the tour steps through
  // each change on its page. "Got it", Esc or a click outside closes it, and it counts as seen.
  import { fade } from "svelte/transition";
  import { batches, newsSince, tourStops, type NewsItem } from "./whatsNew";
  import { pageById, type PageId } from "./pages";
  import { parseTarget } from "./intent.svelte";
  import { startTour } from "./tour.svelte";
  import { trap } from "./ui/trap";
  import NewsItems from "./ui/NewsItems.svelte";
  import NewsIcon from "./ui/NewsIcon.svelte";
  import Rich from "./ui/Rich.svelte";

  // go: opens a page (Show me, or a page named in the text), and closes this.
  let { open = $bindable(), seen, ondone, go = null }: { open: boolean; seen: string; ondone: () => void; go?: ((to: string) => void) | null } = $props();
  const still = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  // At most the last three entries: someone back after months doesn't need the whole history.
  const updates = $derived(batches(newsSince(seen).slice(0, 3)));
  const latest = $derived(updates[0] ?? null);
  /** The update's first change leads, if it's one with a title (older entries are plain sentences). */
  const head = $derived(latest && typeof latest.items[0] !== "string" ? (latest.items[0] as NewsItem) : null);
  const rest = $derived(latest ? (head ? latest.items.slice(1) : latest.items) : []);
  const stops = $derived(latest ? tourStops(latest.items) : []);
  const pageOf = (to: string) => pageById[parseTarget(to).page as PageId] ?? null;

  const date = (d: string) => new Date(`${d}T12:00:00Z`);
  const day = (d: string) => date(d).toLocaleDateString(undefined, { day: "numeric", month: "long" });
  const close = () => (open = false);
  const visit = (to: string) => {
    open = false;
    go?.(to);
  };
  function tour() {
    open = false;
    startTour(stops);
  }
  $effect(() => {
    // Closed any way (Esc, outside, Got it, Show me, the tour): seen.
    if (!open) return;
    return () => ondone();
  });
</script>

{#if open && latest}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="scrim" onclick={close} transition:fade={{ duration: still ? 0 : 150 }}></div>
  <!-- Modal while open; on its way out it lets go, so the tour's keys work at once. -->
  <div class="update" role="dialog" aria-modal={open ? "true" : undefined} aria-labelledby="upd-title" tabindex="-1" use:trap={{ onescape: close }} transition:fade={{ duration: still ? 0 : 150 }}>
    <header class="top">
      <!-- The update's date, stamped on. -->
      <div class="stamp-date" class:still title="This update came out on {date(latest.date).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}">
        <span class="register">Update</span>
        <b class="mark">{date(latest.date).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</b>
        <span class="register">{date(latest.date).getUTCFullYear()}</span>
      </div>
      <div class="kick">
        <h2 id="upd-title" class="register">What's new in orbiter</h2>
        <p class="dim small">Since you last opened it · {latest.items.length} {latest.items.length === 1 ? "change" : "changes"}</p>
      </div>
      <button class="close" aria-label="Close" title="Close (Esc)" onclick={close}>
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M3 3l10 10M13 3 3 13" stroke="currentColor" stroke-width="1.5" /></svg>
      </button>
    </header>

    <div class="scroll">
      {#if head}
        {@const pg = head.open ? pageOf(head.open) : null}
        <article class="head">
          <div class="art" aria-hidden="true"><NewsIcon icon={head.icon} size={100} /></div>
          <div class="words">
            <h3 class="mark">{head.title}</h3>
            <p class="line"><Rich text={head.text} go={go ? visit : null} /></p>
            {#if head.open && pg && go}<button class="stamp gold showme" title="Open {pg.label} at what changed" onclick={() => visit(head.open!)}>Show me →</button>{/if}
          </div>
        </article>
      {/if}

      {#if rest.length}
        <section class="more" aria-labelledby="upd-more">
          <h3 id="upd-more" class="register">{head ? "Also in this update" : "In this update"} · {rest.length}</h3>
          <NewsItems items={rest} go={go ? visit : null} />
        </section>
      {/if}

      {#each updates.slice(1) as u (u.ids[0])}
        <details class="older">
          <summary><span class="register">{day(u.date)}</span><span class="dim small">{u.items.length} {u.items.length === 1 ? "change" : "changes"}</span></summary>
          <NewsItems items={u.items} go={go ? visit : null} />
        </details>
      {/each}
    </div>

    <footer>
      {#if stops.length > 1 && go}<button class="stamp" title="Step through each change on its page, with a bar at the bottom of the window: arrow keys or Enter for the next, Esc to stop" onclick={tour}>Take the tour <span class="n">{stops.length}</span></button>{/if}
      <p class="dim small">The Guide keeps these, at the end.</p>
      <button class="stamp gold" onclick={close}>Got it</button>
    </footer>
  </div>
{/if}

<style>
  .scrim { position: fixed; inset: 0; z-index: 40; background: rgb(6 7 9 / 72%); }
  /* A screen of its own, the window's full height: not a side sheet. */
  .update {
    position: fixed; z-index: 41; top: 0; bottom: 0; left: 50%; transform: translateX(-50%);
    width: min(62rem, 100vw - 2rem); display: grid; grid-template-rows: auto minmax(0, 1fr) auto;
    background: var(--slab); border-inline: 1px solid var(--rule-bright); outline: none;
    box-shadow: 0 0 6rem rgb(0 0 0 / 70%);
  }
  .update::before { content: ""; position: absolute; inset: 0 0 auto; height: 2px; background: var(--gold); }

  .top { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 1.4rem; padding: 1.6rem 2rem 1.2rem; border-bottom: 1px solid var(--rule); }
  .kick h2 { margin: 0; color: var(--gold); font-size: .72rem; letter-spacing: .22em; }
  .kick p { margin: .3rem 0 0; }
  .close { align-self: start; padding: .5rem; line-height: 0; }

  /* The date as a stamp: a double-ruled plate, struck slightly askew, landing once. */
  .stamp-date {
    display: grid; justify-items: center; gap: .15rem; padding: .45rem .8rem .5rem; color: var(--gold);
    border: 2px solid var(--gold-dim); outline: 1px solid color-mix(in srgb, var(--gold-dim) 60%, transparent); outline-offset: 3px;
    transform: rotate(-3deg); animation: land .32s cubic-bezier(.2, 1.4, .4, 1) both .1s;
  }
  .stamp-date.still { animation: none; }
  .stamp-date .register { color: var(--gold-dim); font-size: .56rem; letter-spacing: .26em; }
  .stamp-date .mark { color: var(--gold); font-size: 1.7rem; line-height: .9; }
  @keyframes land { from { transform: rotate(-3deg) scale(1.6); opacity: 0; } to { transform: rotate(-3deg) scale(1); opacity: 1; } }

  .scroll { overflow: auto; padding: 0 2rem 1.6rem; display: grid; align-content: start; gap: 1.6rem; }

  /* The headline: the change's icon large, its title struck big, its line, Show me. */
  .head {
    display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 2.2rem; align-items: center;
    margin-inline: -2rem; padding: 2.4rem 2rem 2.3rem; background: var(--plate); border-bottom: 1px solid var(--rule-bright);
  }
  .head .art {
    width: 10.5rem; height: 10.5rem; background: var(--slab); display: grid; place-items: center; color: var(--platinum);
    border: 1px solid var(--rule-bright); clip-path: var(--cut);
    box-shadow: inset 0 0 0 1px rgb(0 0 0 / 50%), inset 0 -3px 0 var(--gold-dim);
  }
  .words { display: grid; gap: .9rem; justify-items: start; min-width: 0; }
  .words h3 { font-size: clamp(2.4rem, 4.4vw, 3.6rem); line-height: .9; }
  .line { margin: 0; max-width: 58ch; font-size: 1rem; line-height: 1.55; color: var(--platinum-dim); }
  .showme { margin-top: .3rem; }

  .more { display: grid; gap: .6rem; }
  .more h3 { margin: 0; }

  .older { border-top: 1px solid var(--rule); }
  .older summary { display: flex; align-items: baseline; gap: 1rem; padding: .7rem 0; cursor: pointer; list-style: none; }
  .older summary::-webkit-details-marker { display: none; }
  .older summary::before { content: "▸"; color: var(--platinum-deep); font-size: .7rem; }
  .older[open] summary::before { content: "▾"; }
  .older summary:hover .register { color: var(--platinum); }
  .older summary:focus-visible { outline: 1px solid var(--select); outline-offset: 2px; }

  footer { display: flex; align-items: center; gap: 1rem; padding: 1rem 2rem 1.2rem; border-top: 1px solid var(--rule); background: var(--plate); }
  footer p { margin: 0 auto 0 0; }
  footer .n { margin-left: .4rem; color: var(--platinum-deep); }

  /* A narrow window: the headline's icon beside a smaller title. */
  @media (max-width: 1100px) {
    .head .art { width: 8.5rem; height: 8.5rem; }
    .top, .scroll, footer, .head { padding-inline: 1.4rem; }
    .head { margin-inline: -1.4rem; }
  }
</style>
