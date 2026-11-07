<script lang="ts">
  // Modular gear's recipes: every combination of the other parts for this chamber, strike, prism,
  // model or subspecies, ranked for a goal from the bundled part stats (MyOrbiter's own ranking, and
  // labelled so), with each part held, as a blueprint, or missing, and where to get it.
  import type { Model } from "../../core/model";
  import { recipesFor, type KitgunSlot, type RecipePart, type Stat } from "../../core/recipes";
  import Seg from "../Seg.svelte";

  let { model, unique }: { model: Model; unique: string } = $props();

  let goal = $state<string | null>(null);
  let slot = $state<KitgunSlot | "both">("both");
  let all = $state(false);
  $effect(() => {
    void unique;
    goal = null;
    slot = "both";
    all = false;
  });
  const LIMIT = 8;
  const r = $derived(recipesFor(unique, goal, model, slot === "both" ? {} : { slot }));
  const combos = $derived(r ? (all ? r.combos.slice(0, 60) : r.combos.slice(0, LIMIT)) : []);
  const fmt = (s: Stat) => (typeof s.value === "string" ? s.value : s.unit === "%" ? `${Math.round(s.value * 1000) / 10}%` : s.unit === "x" ? `${s.value.toFixed(1)}×` : s.unit === "s" ? `${s.value}s` : s.unit === "/s" ? `${s.value}/s` : Math.round(s.value).toLocaleString("en"));
  const STATUS: Record<RecipePart["status"], string> = { held: "Held", blueprint: "Blueprint", missing: "To get" };
  const ROLE: Record<string, string> = { chamber: "Chamber", grip: "Grip", loader: "Loader", strike: "Strike", link: "Link", prism: "Prism", scaffold: "Scaffold", brace: "Brace", model: "Model", core: "Core", gyro: "Gyro", bracket: "Bracket", stabilizer: "Stabilizer", subspecies: "Subspecies", mutagen: "Mutagen", antigen: "Antigen" };
</script>

{#if r}
  <section class="recipes" data-card="recipes" aria-label="Recipes">
    <div class="rh">
      <h2 class="register">Recipes · {r.item}</h2>
      <span class="label" title={r.goal.explain}>{r.label}</span>
    </div>
    <div class="bar">
      <Seg label="Rank by" bind:value={() => goal ?? r.goal.id, (v) => (goal = v)} options={r.goals.map((g) => ({ v: g.id, label: g.label, title: g.explain }))} />
      {#if r.family === "kitgun"}<Seg label="As a" bind:value={slot} options={[{ v: "both", label: "Both", title: "Primary and secondary kitguns, ranked together" }, { v: "secondary", label: "Secondary", title: "Only secondary kitguns" }, { v: "primary", label: "Primary", title: "Only primary kitguns" }]} />{/if}
    </div>
    <p class="dim small explain">{r.goal.explain}{#if r.fit} {r.fit}{/if}{#if r.precepts?.length} Precepts: {r.precepts.join(", ")}.{/if}{#if r.role} {r.role}{/if}</p>
    <ol class="combos">
      {#each combos as c (c.key)}
        <li class:built={c.built}>
          <span class="rank">{c.rank}</span>
          <div class="cmain">
            <div class="cname">
              <b class="name-mark">{c.name}</b>
              {#if c.slot}<span class="register">{c.slot}</span>{/if}
              {#if c.built}<span class="tag good" title="You have a copy of exactly this combination">Yours</span>{:else if c.missing === 0}<span class="tag ok" title="Every part in hand: assemble it">All parts held</span>{/if}
              <span class="score">{c.scoreLabel}</span>
            </div>
            <div class="parts">
              {#each c.parts as p (p.role)}
                <span class="part {p.status}" title="{ROLE[p.role] ?? p.role}: {p.name} · {STATUS[p.status]}{p.status !== 'held' ? `\n${p.where}` : ''}">
                  <span class="pr">{ROLE[p.role] ?? p.role}</span>{p.name}<span class="st">{p.status === "held" ? "✓" : p.status === "blueprint" ? "BP" : "·"}</span>
                </span>
              {/each}
            </div>
            <div class="stats">{#each c.stats as s (s.id)}<span><span class="sl">{s.label}</span> {fmt(s)}</span>{/each}</div>
          </div>
        </li>
      {/each}
    </ol>
    {#if r.combos.length > LIMIT}
      <button type="button" class="link more" aria-expanded={all} title={all ? `Back to the top ${LIMIT}` : `Every combination, ranked (${r.combos.length})`} onclick={() => (all = !all)}>{all ? `Top ${LIMIT} only` : `Show all ${r.combos.length}`}</button>
    {/if}
    {#if r.gaps.length}<p class="dim small gaps">{r.gaps.join(" ")} Stats: the Warframe Wiki, CC BY-NC-SA.</p>{/if}
    {#if r.how}<p class="dim small how">{r.how}</p>{/if}
  </section>
{/if}

<style>
  .recipes { margin-top: var(--course); padding-top: var(--step); border-top: 1px solid var(--rule); }
  .rh { display: flex; align-items: baseline; gap: 1rem; flex-wrap: wrap; }
  .rh h2 { margin: 0; color: var(--sec); font-size: .7rem; }
  .label { font-size: .78rem; color: var(--platinum-deep); font-style: italic; }
  .bar { display: flex; flex-wrap: wrap; gap: .6rem 1.4rem; margin: .7rem 0 .4rem; }
  .explain { margin: 0 0 .6rem; max-width: 80ch; }
  .combos { list-style: none; margin: 0; padding: 0; display: grid; gap: .35rem; }
  .combos li { display: grid; grid-template-columns: 2rem minmax(0, 1fr); gap: .6rem; padding: .55rem .7rem; background: var(--plate); border: 1px solid var(--rule); }
  .combos li.built { border-color: color-mix(in srgb, var(--verdigris) 45%, var(--rule)); }
  .rank { font-family: var(--face-mark); font-weight: 700; font-size: 1.3rem; color: var(--platinum-deep); line-height: 1; }
  .combos li:first-child .rank { color: var(--sec); }
  .cmain { display: grid; gap: .35rem; min-width: 0; }
  .cname { display: flex; flex-wrap: wrap; align-items: baseline; gap: .3rem .7rem; }
  .cname .name-mark { font-size: 1rem; }
  .score { margin-left: auto; font-family: var(--face-register); font-size: .74rem; color: var(--platinum); font-variant-numeric: tabular-nums; }
  .parts { display: flex; flex-wrap: wrap; gap: .3rem; }
  .part { display: inline-flex; align-items: center; gap: .35rem; padding: .12rem .45rem; border: 1px solid var(--rule-bright); font-size: .8rem; }
  .part .pr { font-family: var(--face-register); font-size: .52rem; letter-spacing: .12em; text-transform: uppercase; color: var(--platinum-deep); }
  .part .st { font-family: var(--face-register); font-size: .6rem; color: var(--platinum-deep); }
  .part.held { border-color: color-mix(in srgb, var(--gold) 45%, transparent); }
  .part.held .st { color: var(--gold); }
  .part.blueprint .st { color: var(--platinum-dim); }
  .stats { display: flex; flex-wrap: wrap; gap: .1rem 1rem; font-size: .76rem; color: var(--platinum-dim); font-variant-numeric: tabular-nums; }
  .sl { color: var(--platinum-deep); }
  .more { margin-top: .5rem; }
  .gaps, .how { margin: .6rem 0 0; max-width: 90ch; }
</style>
