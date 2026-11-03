<script lang="ts">
  // The one hover card: placed beside whatever the pointer rests on, kept inside the window.
  import type { Model } from "./core/model";
  import { describe, effectLines, placeName } from "./core/describe";
  import { hover, hide } from "./hover.svelte";
  // Pages scroll inside their own pane, and scroll events don't bubble: catch them on the way down.
  $effect(() => {
    const off = () => hover.target && hide();
    document.addEventListener("scroll", off, { capture: true, passive: true });
    return () => document.removeEventListener("scroll", off, { capture: true });
  });
  // Esc closes the card first, and only the card: a sheet under it stays open for the next Esc.
  $effect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !hover.target) return;
      hide();
      e.stopImmediatePropagation();
    };
    window.addEventListener("keydown", esc, { capture: true });
    return () => window.removeEventListener("keydown", esc, { capture: true });
  });
  import { imageUrl } from "./backend";
  import { expectedBest } from "./core/advice";
  import Thumb from "./ui/Thumb.svelte";
  import ModCard from "./ui/ModCard.svelte";
  import Art from "./ui/Art.svelte";
  import P from "./ui/P.svelte";
  import PartChip from "./ui/PartChip.svelte";
  import GameIcon, { eraIcon } from "./ui/GameIcon.svelte";
  import Avail from "./ui/Avail.svelte";

  // squad: solo (1) or a radshare (4), as set on Relics: a crack's worth follows it, as the pages do.
  let { model, platPerDucat = 0, squad = 1 }: { model: Model; platPerDucat?: number; squad?: number } = $props();
  const perCrack = (outs: { chance: number; value: number }[], solo: number | null) => (squad > 1 ? (outs.length ? Math.round(expectedBest(outs, 4) * 10) / 10 : null) : solo);

  const t = $derived(hover.target);
  const d = $derived(t ? describe(model, t.name, t.unique, platPerDucat) : null);

  let w = $state(0);
  let h = $state(0);
  const GAP = 10;
  // Beside the thing (right, else left); below it when neither side has room. Always on screen.
  const pos = $derived.by(() => {
    if (!t) return { x: 0, y: 0 };
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const r = t.rect;
    let x = r.right + GAP;
    let y = r.top - 6;
    if (x + w > vw - 8) x = r.left - GAP - w;
    if (x < 8) {
      x = Math.min(Math.max(8, r.left), vw - w - 8);
      y = r.bottom + GAP;
      if (y + h > vh - 8) y = r.top - GAP - h;
    }
    y = Math.min(Math.max(8, y), vh - h - 8);
    return { x, y };
  });

  const pct = (x: number | undefined) => (x == null ? "–" : `${Math.round(x * 10) / 10}%`);
  const RAR: Record<string, string> = { Common: "c", Uncommon: "u", Rare: "r" };
</script>

<svelte:window onwheel={hide} />

{#if t && d}
  <div class="hc" role="tooltip" bind:clientWidth={w} bind:clientHeight={h} style:left="{pos.x}px" style:top="{pos.y}px" style:visibility={w ? "visible" : "hidden"}>
    {#if d.kind === "relic"}
      {@const r = d.row}
      <header>
        <Thumb file={d.image} size={40} />
        <div class="ht"><b class="mark">{d.base} Relic</b><span class="sub">{#if r}{r.total ? `${r.total} held` : "none held"}{:else}not in the relic list yet{/if}</span></div>
        <Avail v={r?.resurgence ? "resurgence" : d.vaulted ? "vaulted" : "farmable"} />
      </header>
      {#if r}
        {#if r.total}<div class="refs">{#each Object.entries(r.owned).filter(([, n]) => n > 0) as [ref, n] (ref)}<span><b>{n}</b> {ref}</span>{/each}</div>{/if}
        <table class="rw">
          <thead><tr><th></th><th>Reward</th><th class="r">Intact</th><th class="r">Radiant</th><th class="r">Price</th></tr></thead>
          <tbody>
            {#each r.rewards as x, i (i)}
              <tr class:need={x.needed} class:done={x.parentMastered && !x.needed}>
                <td><i class="rar rar-{RAR[x.rarity] ?? 'c'}" title={x.rarity}></i></td>
                <td class="nm"><Thumb file={model.imageOf(x.name)} size={20} /><span>{x.name}</span>{#if x.needed}<em>need</em>{:else if x.owned}<span class="dim">×{x.owned}</span>{/if}</td>
                <td class="r dim">{pct(x.chance)}</td>
                <td class="r">{pct(x.chanceRadiant)}</td>
                <td class="r">{#if x.price != null}<P v={Math.round(x.price)} />{:else}<span class="dim">–</span>{/if}</td>
              </tr>
            {/each}
          </tbody>
        </table>
        <footer><span class="register" title={squad > 1 ? "The best of four rewards in a radshare, on average (set on Relics)" : "What one crack gives you on average, cracking alone (set on Relics)"}>{squad > 1 ? "Per crack, radshare" : "Per crack"}</span><span>intact <P v={perCrack(r.outIntact, r.evIntact)} /></span><span>radiant <P v={perCrack(r.outRadiant, r.evRadiant)} /></span>{#if r.relicPrice != null}<span class="dim">· sells for</span><P v={r.relicPrice} />{/if}</footer>
      {/if}
    {:else if d.kind === "part"}
      <header>
        <Thumb file={d.image} size={40} />
        <div class="ht"><b class="mark">{d.name}</b><span class="sub">{d.parent}{d.parentMastered ? " · mastered" : ""}</span></div>
        <Avail v={d.availability} />
      </header>
      <div class="figs">
        <span><span class="register">Held</span><b>{d.held}</b></span>
        <span><span class="register">Price</span><P v={d.price} /></span>
        <span><span class="register">Ducats</span><P v={d.ducats} d /></span>
        {#if d.tradesPerDay != null}<span><span class="register">Sells</span><b>{Math.round(d.tradesPerDay * 10) / 10}<small>/day</small></b></span>{/if}
      </div>
      {#if d.relics.length}
        <div class="register lbl">Drops from</div>
        <ul class="srcs">
          {#each d.relics.slice(0, 6) as s, i (i)}
            <li class:held={s.owned > 0} class:vaulted={s.vaulted}><GameIcon name={eraIcon(s.base.split(" ")[0])} size={16} /><b>{s.base}</b><span class="dim">{s.rarity}</span><span class="grow"></span><span class="dim">{pct(s.chanceIntact)} → {pct(s.chanceRadiant)}</span><span class="tail">{#if s.owned}<em>×{s.owned}</em>{:else if s.vaulted}<span class="vt">vaulted</span>{/if}</span></li>
          {/each}
        </ul>
        {#if d.relics.length > 6}<p class="more dim">+{d.relics.length - 6} more relics</p>{/if}
      {/if}
    {:else if d.kind === "set"}
      <header>
        <Thumb file={d.image} size={40} />
        <div class="ht"><b class="mark">{d.name}</b><span class="sub">{d.parts.filter((p) => p.have >= p.required).length} of {d.parts.length} parts in hand</span></div>
        <P v={d.price} />
      </header>
      <ul class="parts">
        {#each d.parts as p, i (i)}<li><PartChip part={p} size={26} /><span>{p.label}</span><span class="grow"></span><P v={p.price == null ? null : Math.round(p.price)} /></li>{/each}
      </ul>
    {:else if d.kind === "gear"}
      {@const it = d.item}
      {@const c = d.c}
      <header class="gear">
        <Art file={c.image} size={78} />
        <div class="ht">
          <b class="mark">{it.name}</b>
          <span class="sub">{c.type}{c.masteryReq ? ` · MR ${c.masteryReq}` : ""}</span>
          <span class="tags">{#if c.mastered}<span class="tag good">✓ Mastered</span>{:else if c.owned}<span class="tag ok">Owned</span>{:else if c.building}<span class="tag">Building</span>{:else if c.buildable}<span class="tag ok">Ready to build</span>{/if}{#if c.resurgence}<Avail v="resurgence" />{:else if c.vaulted}<Avail v="vaulted" />{/if}</span>
        </div>
      </header>
      {#if it.health != null}
        <div class="figs"><span><span class="register">Health</span><b>{it.health}</b></span><span><span class="register">Shield</span><b>{it.shield}</b></span><span><span class="register">Armor</span><b>{it.armor}</b></span><span><span class="register">Energy</span><b>{it.power}</b></span></div>
      {:else if it.criticalChance != null && (it.totalDamage ?? 0) > 0}
        <div class="figs"><span><span class="register">Damage</span><b>{Math.round((it.totalDamage ?? 0) * 10) / 10}</b></span><span><span class="register">Crit</span><b>{Math.round(it.criticalChance * 100)}% ×{it.criticalMultiplier}</b></span><span><span class="register">Status</span><b>{Math.round((it.procChance ?? 0) * 100)}%</b></span><span><span class="register">Rate</span><b>{Math.round((it.fireRate ?? 0) * 100) / 100}</b></span></div>
      {/if}
      {#if c.parts.length}<div class="chips">{#each c.parts as p, i (i)}<PartChip part={p} size={30} />{/each}</div>{/if}
      <footer><span class="pts"><GameIcon name="mastery" size={13} />{c.points.toLocaleString("en")} mastery</span>{#if c.setPrice != null}<span class="grow"></span><span class="dim">set</span><P v={Math.round(c.setPrice)} />{/if}{#if t.opens}<span class="hint">click for details</span>{/if}</footer>
    {:else if d.kind === "mod" || d.kind === "arcane"}
      {@const it = d.item}
      {@const lines = effectLines(it)}
      <header>
        <ModCard arcane={d.kind === "arcane"} name={d.name} image={d.image} rarity={it?.rarity ?? ""} polarity={it?.polarity && it.polarity !== "aura" ? it.polarity : null} drain={it?.baseDrain ?? null} maxRank={it?.maxRank ?? null} rank={d.kind === "mod" ? Math.max(0, ...(d.row?.ranks ?? []).map((x) => x.rank)) : (d.row?.highestRank ?? 0)} label={it?.compatName ?? ""} width={70} />
        <div class="ht"><b class="mark">{d.name}</b><span class="sub">{it?.type ?? (d.kind === "mod" ? "Mod" : "Arcane")}{it?.rarity ? ` · ${it.rarity}` : ""}</span></div>
      </header>
      {#if lines.length}<div class="effect"><span class="register">At max rank{it?.maxRank ? ` (${it.maxRank})` : ""}</span>{#each lines as l, i (i)}<p>{l}</p>{/each}</div>{/if}
      <div class="figs">
        {#if d.kind === "mod"}
          <span><span class="register">Held</span><b>{d.row?.total ?? 0}</b></span>
          <span><span class="register">Unranked</span><P v={d.price} /></span>
          <span><span class="register">Maxed</span><P v={d.priceMax} /></span>
          {#if d.row?.extras}<span><span class="register">Spare</span><b>{d.row.extras}</b></span>{/if}
        {:else}
          <span><span class="register">Copies</span><b>{d.row ? `${d.row.copies}/${d.row.needed}` : "0"}</b></span>
          <span><span class="register">R0</span><P v={d.row?.price ?? model.price(d.name)} /></span>
          <span><span class="register">Maxed</span><P v={d.row?.priceMax ?? model.priceMax(d.name)} /></span>
        {/if}
      </div>
      {#if d.kind === "mod" && d.row?.ranks.some((x) => x.rank > 0)}<div class="ranks">{#each d.row.ranks as x (x.rank)}<span>{x.rank ? `R${x.rank}` : "R0"}{x.count > 1 ? ` ×${x.count}` : ""}</span>{/each}</div>{/if}
      {#if it?.drops?.length && !(d.row && (d.kind === "mod" ? d.row.total : d.row.copies))}
        <div class="register lbl">Drops from</div>
        <ul class="srcs">{#each it.drops.slice(0, 3) as x, i (i)}<li><span>{placeName(x.location)}</span><span class="grow"></span><span class="dim">{pct(x.chance)}</span></li>{/each}</ul>
      {/if}
    {:else}
      <header>
        <Thumb file={d.image} size={40} />
        <div class="ht"><b class="mark">{d.name}</b><span class="sub">{d.held ? `${d.held.toLocaleString("en")} held` : "none held"}</span></div>
        {#if d.price != null}<P v={d.price} />{/if}
      </header>
      {#if d.tradesPerDay != null}<p class="more dim">Sells about {Math.round(d.tradesPerDay * 10) / 10} a day on warframe.market.</p>{/if}
    {/if}
  </div>
{/if}

<style>
  .hc {
    position: fixed; z-index: 60; width: 23rem; max-width: calc(100vw - 16px); pointer-events: none;
    background: linear-gradient(180deg, #1c1e24, #14161a); border: 1px solid var(--rule-bright);
    box-shadow: 0 1.2rem 3rem rgb(0 0 0 / 60%), inset 0 2px 0 var(--gold-dim);
    padding: .75rem .85rem .7rem; display: grid; gap: .55rem; font-size: .8rem;
    animation: pop .12s ease-out;
  }
  @keyframes pop { from { opacity: 0; transform: translateY(3px); } }
  header { display: grid; grid-template-columns: auto 1fr auto; gap: .6rem; align-items: center; }
  header.gear { grid-template-columns: auto 1fr; }
  .ht { display: grid; gap: .2rem; min-width: 0; }
  .ht b { font-size: 1.05rem; line-height: 1; }
  .sub { color: var(--platinum-dim); font-size: .74rem; }
  .tags { display: flex; gap: .3rem; flex-wrap: wrap; margin-top: .15rem; }
  .tags .tag { margin: 0; }
  .refs { display: flex; gap: .8rem; color: var(--platinum-dim); font-size: .74rem; }
  .refs b { color: var(--platinum); }
  table.rw { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  .rw th { font-family: var(--face-register); font-weight: 500; font-size: .6rem; letter-spacing: .12em; text-transform: uppercase; color: var(--platinum-deep); text-align: left; padding: 0 .3rem .25rem; }
  .rw td { padding: .2rem .3rem; border-top: 1px solid var(--rule); }
  .rw .r { text-align: right; white-space: nowrap; }
  .rw .nm { display: flex; align-items: center; gap: .35rem; min-width: 0; }
  .rw .nm span:first-of-type { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 10.5rem; }
  .rw tr.need .nm { color: var(--gold); }
  .rw tr.done .nm span { color: var(--platinum-deep); }
  .rw em, .srcs em { font-style: normal; font-family: var(--face-register); font-size: .6rem; letter-spacing: .1em; text-transform: uppercase; color: var(--gold); }
  .rar { display: inline-block; width: 7px; height: 7px; transform: rotate(45deg); }
  .rar-c { background: var(--rarity-common); }
  .rar-u { background: var(--rarity-uncommon); }
  .rar-r { background: var(--rarity-rare); }
  footer { display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; padding-top: .45rem; border-top: 1px solid var(--rule); }
  footer > span { display: inline-flex; align-items: center; gap: .3rem; }
  .figs { display: flex; gap: 1rem; flex-wrap: wrap; }
  .figs > span { display: grid; gap: .1rem; }
  .figs .register, .lbl, .effect .register { font-size: .6rem; }
  .figs b { font-family: var(--face-mark); font-size: 1rem; font-variant-numeric: tabular-nums; }
  .figs small { font-family: var(--face-text); font-weight: 400; color: var(--platinum-dim); margin-left: 1px; }
  .lbl { margin-bottom: -.25rem; }
  .srcs, .parts { list-style: none; margin: 0; padding: 0; display: grid; gap: .25rem; }
  .srcs li, .parts li { display: flex; align-items: center; gap: .4rem; }
  .parts li { gap: .7rem; }
  .srcs li.held b { color: var(--gold); }
  .srcs li.vaulted { opacity: .65; }
  /* Held count or "vaulted": one width, so the chances above it line up. */
  .tail { flex: none; width: 3.4rem; text-align: right; }
  .vt { font-family: var(--face-register); font-size: .6rem; letter-spacing: .1em; text-transform: uppercase; color: var(--platinum-deep); }
  .grow { flex: 1; }
  .chips { display: flex; flex-wrap: wrap; gap: .4rem; }
  .pts { color: var(--platinum-dim); }
  .hint { margin-left: auto; font-family: var(--face-register); font-size: .6rem; letter-spacing: .12em; text-transform: uppercase; color: var(--platinum-deep); }
  .effect { display: grid; gap: .25rem; padding: .5rem .6rem; background: var(--well); border: 1px solid var(--rule); }
  .effect p { margin: 0; white-space: pre-line; color: var(--platinum); line-height: 1.4; }
  .ranks { display: flex; gap: .3rem; flex-wrap: wrap; }
  .ranks span { font-family: var(--face-register); font-size: .6rem; padding: .08rem .32rem; border: 1px solid var(--rule-bright); color: var(--platinum-dim); }
  .pol { width: 18px; height: 18px; opacity: .85; }
  .more { margin: 0; font-size: .74rem; }
</style>
