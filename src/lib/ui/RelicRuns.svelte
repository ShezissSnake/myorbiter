<script lang="ts">
  // Relic runs: what your fissure rounds came to, per hour, session by session. Every reward
  // screen TennoScope read, with the card you took once an inventory read shows it arriving.
  import type { Model } from "../core/model";
  import { resolveName } from "../core/pick";
  import { refinementOf, summarize, type RelicRun, type ScoredRun } from "../core/relicRuns";
  import { rewardPlat } from "../core/views";
  import { info } from "../hover.svelte";
  import P from "./P.svelte";
  import Stat from "./Stat.svelte";
  import Thumb from "./Thumb.svelte";

  let { model, runs, since, platPerDucat = 0 }: { model: Model; runs: RelicRun[]; since: number; platPerDucat?: number } = $props();

  // Names as read are resolved once each (an OCR'd name can be a near miss of the real one). A
  // card is worth its price, or its ducats at your rate when that's more (you'd trade it to Baro).
  const price = $derived.by(() => {
    const memo = new Map<string, number | null>();
    return (n: string) => {
      if (!memo.has(n)) {
        const name = resolveName(model, n);
        const v = rewardPlat(model, name, platPerDucat);
        memo.set(n, v || model.price(name));
      }
      return memo.get(n)!;
    };
  });
  const shown = $derived(runs.filter((r) => r.at >= since));
  const sum = $derived(summarize(shown, price));
  const known = $derived(sum.screens - sum.estimated - sum.unread);

  let open = $state<number | null>(null);
  // The last few sessions first: older ones a click away.
  let limit = $state(6);
  const toggle = (start: number) => (open = open === start ? null : start);

  const day = (t: number) => new Date(t).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  const hm = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const duration = (min: number) => (min < 60 ? `${Math.round(min)} min` : `${Math.floor(min / 60)} h ${String(Math.round(min % 60)).padStart(2, "0")}`);
  const round = (n: number) => Math.round(n);
  const LETTER = { Intact: "I", Exceptional: "E", Flawless: "F", Radiant: "R" } as const;
  const squad = (r: RelicRun) => r.relics.map((p) => refinementOf(p)).filter((x) => x != null);
  const BASIS: Record<ScoredRun["basis"], { label: string; title: string }> = {
    took: { label: "Took", title: "An inventory read after the mission showed this card arriving" },
    own: { label: "Your relic's", title: "Your own relic's reward, from the game log. Which card you took isn't confirmed yet: the next inventory read after the mission settles it" },
    average: { label: "Not known", title: "Which card you took isn't known (history from TennoScope's log, or two cards arrived at once): the average card stands in" },
    unread: { label: "Not read", title: "TennoScope couldn't read this screen: it counts as an average screen" },
  };
  const img = (n: string) => model.imageOf(resolveName(model, n));
</script>

<section class="runs">
  <div class="hh">
    <h2 class="register">Relic runs</h2>
    {#if sum.screens}<span class="dim small">Each card at today's warframe.market price, or its ducats at your rate ({platPerDucat}p each) when that's more</span>{/if}
  </div>

  {#if sum.screens}
    <div class="figs">
      <Stat label="Per hour" tone="gold" note={`${sum.screens} screen${sum.screens === 1 ? "" : "s"} over ${duration(sum.hours * 60)}`}><P v={round(sum.perHour)} big /></Stat>
      <Stat label="Per screen" note="What each reward came to"><P v={Math.round(sum.perScreen * 10) / 10} big /></Stat>
      <Stat label="Screens an hour" note={`About one every ${Math.round(sum.typical / 60_000)} min`}>{Math.round(sum.screensPerHour * 10) / 10}</Stat>
      <Stat label="Best card every time" tone="dim" note={known ? `${round(sum.bestPerHour - sum.perHour)} an hour more than ${known === sum.screens ? "you got" : "your picks and the average card"}` : `${round(sum.bestPerHour - sum.perHour)} an hour over an average card (which you took isn't known yet)`}><P v={round(sum.bestPerHour)} big dim /></Stat>
    </div>
    {#if sum.estimated || sum.unread}
      <p class="dim small basis">
        {#if known}Which card you took is known for {known} of {sum.screens} screens.
          {#if sum.estimated}{sum.estimated} more, mostly older history, count as their average card.{/if}
        {:else}Which card you took isn't known yet for any of these screens, so each counts as its average card.{/if}
        {#if sum.unread}{sum.unread} couldn't be read at all and count as an average screen.{/if}
      </p>
    {/if}

    <table>
      <thead>
        <tr><th>Session</th><th class="right">Screens</th><th class="right">Time</th><th class="right">Came to</th><th class="right">Per hour</th><th class="right" title="Taking the most valuable card on every screen">Best card every time</th></tr>
      </thead>
      <tbody>
        {#each sum.sessions.slice(0, limit) as s (s.start)}
          <tr class="session" class:open={open === s.start} tabindex="0" aria-expanded={open === s.start} onclick={() => toggle(s.start)} onkeydown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), toggle(s.start))}>
            <td><span class="when"><span class="chev" aria-hidden="true">{open === s.start ? "▾" : "▸"}</span>{day(s.start)}<span class="dim">{s.runs.length === 1 ? hm(s.start) : `${hm(s.start)}–${hm(s.end)}`}</span></span></td>
            <td class="right">{s.runs.length}</td>
            <!-- One screen has no length of its own: it counts as a typical round, and a rate from one card says little. -->
            <td class="right" title={s.runs.length === 1 ? "One screen: counted as one typical round" : undefined}>{s.runs.length === 1 ? "1 round" : duration(s.minutes)}</td>
            <td class="right"><P v={round(s.plat)} /></td>
            <td class="right">{#if s.runs.length === 1}<span class="dim" title="One screen: too short for a rate (it still counts in the totals above)">–</span>{:else}<b class="ph">{round(s.perHour)}</b>{/if}</td>
            <td class="right"><P v={round(s.best)} dim /></td>
          </tr>
          {#if open === s.start}
            <tr class="detail">
              <td colspan="6">
                <ol>
                  {#each s.runs as r (r.run.at)}
                    {@const top = r.values.length ? r.values.indexOf(r.best) : -1}
                    <li>
                      <span class="t">{hm(r.run.at)}</span>
                      <span class="sq" title={r.run.relics.length ? `${r.run.relics.length} relic${r.run.relics.length === 1 ? "" : "s"} in the squad` : "Squad not recorded"}>
                        {#each squad(r.run) as f, i (i)}<i class="ref r-{LETTER[f]}" title={f}>{LETTER[f]}</i>{/each}
                      </span>
                      <span class="cards">
                        {#each r.run.cards as c, i (i)}
                          {@const counted = r.card != null && resolveName(model, c) === resolveName(model, r.card)}
                          <span class="card" class:counted class:top={i === top && !counted && r.best > 0} use:info={resolveName(model, c)} title={i === top && r.best > 0 ? "The best card on this screen" : undefined}>
                            <Thumb file={img(c)} size={26} />
                            <span class="cn">{resolveName(model, c)}</span>
                            <P v={price(c)} dim={!counted} />
                          </span>
                        {/each}
                        {#if !r.run.cards.length}<span class="dim small">Cards not read</span>{/if}
                      </span>
                      <!-- History from the log never knows: the note above says so once, not on every row. -->
                      {#if !(r.basis === "average" && r.run.imported)}<span class="basis-tag b-{r.basis}" title={BASIS[r.basis].title}>{BASIS[r.basis].label}</span>{:else}<span></span>{/if}
                    </li>
                  {/each}
                </ol>
              </td>
            </tr>
          {/if}
        {/each}
      </tbody>
    </table>
    {#if sum.sessions.length > limit}
      <button class="link more" title="List 40 more of your older fissure sessions" onclick={() => (limit += 40)}>Show older sessions ({sum.sessions.length - limit} more)</button>
    {/if}
  {:else}
    <p class="dim small">
      {runs.length ? "No relic reward screens in this span." : "Every relic reward screen TennoScope reads shows up here, with the card you took and what your fissure runs come to per hour. It needs the patched TennoScope with screen capture allowed."}
    </p>
  {/if}
</section>

<style>
  .runs { margin: 0 0 var(--course); }
  .hh { display: flex; justify-content: space-between; align-items: center; gap: 1rem; min-height: 2rem; margin-bottom: .4rem; }
  h2 { margin: 0; }
  .figs { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule); margin-bottom: .6rem; }
  /* Page area under 760 px (App sets the flag, by the room pages actually have). */
  :global(html[data-room~="lt760"]) .figs { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .basis { margin: 0 0 .8rem; max-width: 80ch; }
  table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  th { text-align: left; font-family: var(--face-register); font-weight: 500; font-size: .72rem; letter-spacing: .14em; text-transform: uppercase; color: var(--platinum-deep); padding: .45rem .5rem; border-bottom: 1px solid var(--rule); }
  td { padding: var(--row-pad) .5rem; border-bottom: 1px solid var(--rule); }
  .right { text-align: right; }
  .session { cursor: pointer; }
  .session:hover td, .session.open td { background: rgb(26 30 35 / 70%); }
  .session:focus-visible { outline: 1px solid var(--gold); outline-offset: -1px; }
  .when { display: inline-flex; align-items: center; gap: .55rem; }
  .chev { color: var(--gold-dim); width: .8rem; }
  .ph { font-family: var(--face-mark); font-size: .98rem; color: var(--gold); }
  .detail td { padding: .2rem .5rem .8rem 1.9rem; background: rgb(12 14 17 / 60%); }
  ol { list-style: none; margin: 0; padding: 0; display: grid; gap: .25rem; }
  li { display: grid; grid-template-columns: 3.4rem 5.2rem 1fr auto; gap: .7rem; align-items: center; padding: .3rem 0; border-bottom: 1px solid rgb(36 39 45 / 50%); }
  li:last-child { border-bottom: 0; }
  .t { font-family: var(--face-register); font-size: .84rem; color: var(--platinum-deep); }
  .sq { display: inline-flex; gap: 3px; }
  .ref { font-style: normal; font-family: var(--face-register); font-size: .7rem; width: 1.05rem; height: 1.05rem; display: inline-grid; place-items: center; border: 1px solid var(--rule-bright); color: var(--platinum-deep); }
  .r-R { color: var(--gold); border-color: var(--gold-dim); }
  .r-F, .r-E { color: var(--platinum-dim); }
  .cards { display: flex; flex-wrap: wrap; gap: .35rem .5rem; min-width: 0; }
  .card { display: inline-flex; align-items: center; gap: .4rem; padding: .15rem .45rem .15rem .15rem; border: 1px solid var(--rule); min-width: 0; }
  .card.counted { border-color: var(--gold-dim); box-shadow: inset 2px 0 0 var(--gold); }
  .card.top { border-style: dashed; border-color: var(--rule-control); }
  .cn { font-size: .78rem; color: var(--platinum-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 16rem; }
  .counted .cn { color: var(--platinum); }
  .basis-tag { font-family: var(--face-register); font-size: .7rem; letter-spacing: .12em; text-transform: uppercase; padding: .15rem .4rem; border: 1px solid var(--rule-bright); color: var(--platinum-deep); white-space: nowrap; }
  .b-took { color: var(--verdigris); border-color: color-mix(in srgb, var(--verdigris) 45%, transparent); }
  .b-own { color: var(--gold); border-color: var(--gold-dim); }
  .more { margin-top: .7rem; }
</style>
