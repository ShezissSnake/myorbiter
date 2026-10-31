<script lang="ts">
  // The bounties on offer in each open world and hub, one place at a time: each bounty's level,
  // the reward worth naming (something you need, else the rarest), and the standing it pays.
  // Hovering or focusing a bounty lists everything it can pay, rarest first, with the chances.
  import type { BountyBoard } from "../core/board";
  import { until } from "../core/traders";
  import Seg from "./Seg.svelte";
  import Thumb from "./Thumb.svelte";

  let { boards, now, imageOf = () => null, need = () => false }: { boards: BountyBoard[]; now: number; imageOf?: (name: string) => string | null; need?: (name: string) => boolean } = $props();

  let picked = $state<string | null>(null);
  const board = $derived(boards.find((b) => b.key === picked) ?? boards[0] ?? null);
  const pct = (c: number | null) => (c == null ? "" : c >= 10 ? `${Math.round(c)}%` : `${c.toFixed(1)}%`);
</script>

{#if !boards.length}
  <p class="dim small">Bounties show once the worldstate and the drop tables have been read.</p>
{:else if board}
  <Seg value={board.key} onchange={(v) => (picked = v)} label="Where" options={boards.map((b) => ({ v: b.key, label: b.label, title: `${b.label}: ${b.where}` }))} />
  <p class="sub dim small">
    {[board.where, board.expiry ? `new bounties in ${until(board.expiry, now)}` : "", board.rotating ? "the missions rotate in game; each level pays from the table shown" : ""].filter(Boolean).join(" · ")}
  </p>
  <ul class="jobs">
    {#each board.jobs as j, i (i)}
      <!-- Focusable so the rewards show from the keyboard too: they're what the row is about. -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <li class="job" tabindex="0" aria-describedby="pool-{board.key}-{i}">
        <span class="jn"><b>{j.name}</b><span class="dim small">{[j.levels && !board.rotating ? `Level ${j.levels}` : "", j.minMR ? `MR ${j.minMR}` : "", j.when ? `${j.when} only` : "", j.vault ? "vault" : ""].filter(Boolean).join(" · ")}</span></span>
        {#if j.headline}<span class="hl" class:want={j.wanted} title={j.wanted ? "You need this" : "The rarest reward"}><Thumb file={imageOf(j.headline.name)} name={j.headline.name} size={22} /><span class="hn">{j.headline.name}</span>{#if j.headline.chance != null}<span class="dim small">{pct(j.headline.chance)}</span>{/if}</span>{/if}
        <span class="st dim small">{j.standing ? `${j.standing.toLocaleString("en")} standing` : ""}</span>
        <div class="pool" role="tooltip" id="pool-{board.key}-{i}">
          <span class="register">Can pay · rarest first</span>
          <ul>
            {#each j.rewards as r (r.name)}
              <li class:want={need(r.name)}><Thumb file={imageOf(r.name)} name={r.name} size={18} /><span>{r.name}</span><span class="dim small">{pct(r.chance)}</span></li>
            {/each}
          </ul>
          <span class="dim small">A chance is the best it has at any stage{board.rotating ? "" : "; the last stage pays the rare ones most"}.</span>
        </div>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .sub { margin: 0; }
  .jobs { list-style: none; margin: 0; padding: 0; display: grid; gap: .2rem; }
  .job { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr) 7rem; gap: .7rem; align-items: center; padding: .35rem .4rem; border-top: 1px solid var(--rule); outline: none; }
  .job:hover, .job:focus-visible { background: var(--raised); }
  .job:focus-visible { box-shadow: inset 0 0 0 1px var(--gold-dim); }
  .jn { display: grid; min-width: 0; }
  .jn b { font-weight: 600; color: var(--platinum); font-size: .9rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .hl { display: inline-flex; align-items: center; gap: .45rem; min-width: 0; font-size: .86rem; }
  .hn { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .hl.want .hn, li.want span:nth-child(2) { color: var(--gold); }
  .st { text-align: right; white-space: nowrap; }
  .pool { display: none; position: absolute; z-index: 20; top: calc(100% - 2px); left: 30%; width: min(24rem, 70vw); padding: .7rem .8rem; background: var(--plate); border: 1px solid var(--rule-bright); box-shadow: 0 10px 28px rgb(0 0 0 / 55%); gap: .4rem; }
  .job:hover .pool, .job:focus-visible .pool { display: grid; }
  .pool ul { list-style: none; margin: 0; padding: 0; display: grid; gap: .2rem; }
  .pool li { display: grid; grid-template-columns: 18px minmax(0, 1fr) auto; gap: .5rem; align-items: center; font-size: .84rem; }
  :global(html[data-room~="lt640"]) .job { grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr); }
  :global(html[data-room~="lt640"]) .st { display: none; }
</style>
