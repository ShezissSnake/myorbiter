<script lang="ts">
  import { links, openUrl } from "./links.svelte";
  import Opening from "./ui/Opening.svelte";
  import { untrack } from "svelte";
  import { info } from "./hover.svelte";
  import { placeName } from "./core/describe";
  // One item, everything about it: artwork, stats and abilities, what it's built from with where
  // each piece comes from (the relics you hold first), how to get it, and what it's worth now.
  import type { Model } from "./core/model";
  import type { Settings } from "./backend";
  import { imageUrl, marketUrl, wikiUrl } from "./backend";
  import { collectionItem, type PartState } from "./core/collection";
  import { masteryRow, partAvailability } from "./core/views";
  import { vendorBlueprint } from "./core/acquire";
  import { familyOf } from "./core/modular";
  import { competitor, findItem, type BookOrder } from "./core/market";
  import { details } from "./details.svelte";
  import { wishItem } from "./core/wishlist";
  import { mkt } from "./marketStore.svelte";
  import PriceHistory from "./ui/PriceHistory.svelte";
  import Sheet from "./ui/Sheet.svelte";
  import HelpMark from "./ui/HelpMark.svelte";
  import Art from "./ui/Art.svelte";
  import PartChip from "./ui/PartChip.svelte";
  import Thumb from "./ui/Thumb.svelte";
  import { buildPlan, buildTag, TIER_LABEL, TIER_TIP } from "./core/buildPlan";
  import P from "./ui/P.svelte";
  import Effort from "./ui/Effort.svelte";
  import Avail from "./ui/Avail.svelte";
  import GameIcon, { eraIcon, kindIcon } from "./ui/GameIcon.svelte";
  import Metal from "./ui/Metal.svelte";
  import ListButton from "./ui/ListButton.svelte";
  import NeverSoldTag from "./ui/spares/NeverSoldTag.svelte";
  import { neverSells, withoutNeverSell } from "./core/sparesRules";
  import { pop } from "./motion";
  import { gearKindOf } from "./core/builds/gear";
  import { setIntent } from "./intent.svelte";

  let { model, settings = $bindable() }: { model: Model; settings: Settings } = $props();

  const item = $derived(details.unique ? (model.catalogByUnique.get(details.unique) ?? null) : null);
  // Another item opened while the sheet is up: start at its top, not where the last one was scrolled to.
  let anchor = $state<HTMLElement | null>(null);
  $effect(() => {
    void details.unique;
    for (let p = untrack(() => anchor)?.parentElement; p; p = p.parentElement) {
      if (/auto|scroll/.test(getComputedStyle(p).overflowY)) {
        p.scrollTop = 0;
        break;
      }
    }
  });
  const c = $derived(item ? collectionItem(model, item) : null);
  // What building it still takes from where you are, parts' own blueprints included.
  const plan = $derived(item && c && !c.owned && !c.mastered && !c.building && !c.partBuilt && c.parts.some((p) => !p.resource) ? buildPlan(model, item, model.recipes) : null);
  /** Nothing left to collect for it: owned, mastered, or a modular part already built (a chamber in hand). */
  const done = $derived(!!c && (c.owned || c.mastered || c.partBuilt));
  // A vendor's blueprint (a zaw strike's at Hok): the vendor, never the drop tables (Conclave's twin's).
  const vendor = $derived(item ? vendorBlueprint(item.name, item.uniqueName) : null);
  const wish = $derived(item ? wishItem(model, item.uniqueName) : null);
  const row = $derived(item && !model.isMastered(item.uniqueName) && item.masterable ? masteryRow(model, item) : null);
  const fav = $derived(!!item && settings.favourites.includes(item.uniqueName));
  // Anything that takes mods has builds: the Builds page, opened on it.
  const buildable = $derived(!!item && (item.type === "Exalted Weapon" || (gearKindOf(item) ?? "kdrive") !== "kdrive"));
  function openBuilds() {
    if (!item) return;
    setIntent("builds", { item: item.uniqueName });
    settings.tab = "builds";
    details.close();
  }
  function toggleFav() {
    if (!item) return;
    settings.favourites = fav ? settings.favourites.filter((u) => u !== item.uniqueName) : [item.uniqueName, ...settings.favourites];
  }

  // The game's markup in descriptions: colour tags and value placeholders.
  // The values themselves aren't in the data ("last |VAL|% longer"): the sentence reads without
  // them ("last longer") rather than with a stand-in.
  /** Ability icons that didn't load (no copy here, or offline): the ability's number instead. */
  let noIcon = $state<Record<string, boolean>>({});
  const clean = (s: string | undefined) =>
    (s ?? "")
      .replace(/<[A-Z_]+>/g, "")
      .replace(/\s*\b(by|of|up to)?\s*[+-]?\|[A-Z_0-9]+\|\s*(%|m|s|seconds?|meters?)?/gi, " ")
      .replace(/\b(within|up to|for|by|to|of)\s*(?=[.,;:]|$)/gi, "")
      .replace(/\s+([.,;:])/g, "$1")
      .replace(/,+\./g, ".")
      .replace(/\s+/g, " ")
      .trim();
  const pct = (v: number | undefined) => (v == null ? "–" : `${Math.round(v * 1000) / 10}%`);
  const num = (v: number | undefined, d = 2) => (v == null ? "–" : (Math.round(v * 10 ** d) / 10 ** d).toLocaleString("en"));
  const days = (s: number | undefined) => {
    if (!s) return "";
    const h = s / 3600;
    return h >= 24 ? `${Math.round((h / 24) * 10) / 10} day${h === 24 ? "" : "s"}` : h >= 1 ? `${Math.round(h)} h` : `${Math.round(s / 60)} min`;
  };

  const isFrame = $derived(!!item && item.health != null);
  const isWeapon = $derived(!!item && item.criticalChance != null && (item.totalDamage ?? 0) > 0);
  const DAMAGE: Record<string, string> = { impact: "Impact", puncture: "Puncture", slash: "Slash", heat: "Heat", cold: "Cold", electricity: "Electricity", toxin: "Toxin", blast: "Blast", corrosive: "Corrosive", gas: "Gas", magnetic: "Magnetic", radiation: "Radiation", viral: "Viral", void: "Void", tau: "Tau", true: "True" };

  // Where each piece comes from.
  function where(p: PartState) {
    if (p.resource) return { kind: "resource" as const };
    const relics = (model.sourcesByReward.get(p.name) ?? [])
      .map((s) => ({ ...s, owned: model.ownedRelicCount.get(s.base) ?? 0 }))
      .sort((a, b) => b.owned - a.owned || Number(a.vaulted) - Number(b.vaulted) || b.chanceRadiant - a.chanceRadiant);
    if (relics.length) return { kind: "relics" as const, relics, availability: partAvailability(model, p.name) };
    if (vendor && p.label === "Blueprint") return { kind: "vendor" as const, who: vendor.who, step: vendor.step };
    const comp = item?.components?.find((x) => x.name === p.label);
    const drops = (comp?.drops ?? []).slice(0, 4);
    return { kind: "drops" as const, drops };
  }

  // Live prices: the set (or the item) on warframe.market, cheapest seller in game and best buyer.
  // The name it trades under (the set for a prime), and its order book once fetched.
  let tradeName = $state<string | null>(null);
  let book = $state<{ slug: string; sell: number | null; buy: number | null; sellers: number; buyers: number } | null>(null);
  let bookState = $state<"loading" | "ok" | "missing" | "failed">("loading");
  $effect(() => {
    const it = item;
    const name = it && c ? (c.isPrime && c.parts.some((p) => p.tradable) ? `${it.name} Set` : it.tradable ? it.name : null) : null;
    if (name === tradeName) return;
    tradeName = name;
    book = null;
    bookState = "loading";
    if (!name) return;
    void (async () => {
      try {
        await mkt.ensureItems();
        const mi = findItem(mkt.index, name, null);
        if (tradeName !== name) return;
        if (!mi) {
          bookState = "missing";
          return;
        }
        const orders: BookOrder[] = await mkt.book(mi.slug);
        if (tradeName !== name) return;
        const me = mkt.me ?? { id: "" };
        const sell = competitor({ rank: null, subtype: null }, orders, me, mi.subtypes?.[0] ?? null);
        const buyers = orders.filter((o) => o.type === "buy" && o.visible && (o.user.status === "ingame" || o.user.status === "online") && o.user.id !== me.id);
        book = { slug: mi.slug, sell: sell.lowest?.platinum ?? null, sellers: sell.sellers, buy: buyers.length ? Math.max(...buyers.map((o) => o.platinum)) : null, buyers: buyers.length };
        bookState = "ok";
      } catch {
        if (tradeName === name) bookState = "failed";
      }
    })();
  });
  /** Complete sets of a prime you hold: what its Sell button offers, as the Sets card's does. */
  const setsHeld = $derived.by(() => {
    const parts = c?.isPrime ? c.parts.filter((p) => p.tradable) : [];
    return parts.length ? Math.min(...parts.map((p) => Math.floor(p.have / Math.max(1, p.required)))) : 0;
  });
  /** The set (or the item) on the never-sell list, if it is: "Never sold · Sell again" among the actions. */
  const neverItem = $derived.by(() => {
    const it = tradeName && mkt.index ? findItem(mkt.index, tradeName, null) : null;
    return it && neverSells(settings.market.spares, it.id) ? it : null;
  });
  const bookNote = $derived(bookState === "failed" ? "warframe.market didn't answer" : bookState === "missing" ? "not listed on warframe.market" : "Checking…");

  const open = { get v() { return !!details.unique; }, set v(x: boolean) { if (!x) details.close(); } };
</script>

{#if item && c}
  <Sheet bind:open={open.v} title={item.name} kind={c.type} kicker={`${c.type}${c.masteryReq ? ` · Mastery rank ${c.masteryReq}` : ""}`} wide help="item-sheet">
    <span class="anchor" bind:this={anchor} hidden></span>
    <section class="hero">
      <Art file={c.image} size={230} alt={item.name} fallback={kindIcon(c.type, item.name) ?? "foundry"} />
      <div class="intro">
        <div class="tags">
          {#if c.mastered}<span class="tag good">Mastered</span>{:else if c.owned}<span class="tag mastery">Owned, not mastered</span>{/if}
          {#if c.building}<span class="tag">Building</span>{/if}
          {#if c.partBuilt && !c.owned && c.stepTag}<span class="tag ok" title={c.stepHow}>{c.stepTag}</span>{/if}
          {#if c.buildable}{@const t = buildTag(plan?.tier ?? "now", [], "sheet")}<span class="tag {t.tone}" title={plan ? TIER_TIP[plan.tier] : undefined}>{t.label}</span>{/if}
          {#if c.resurgence}<Avail v="resurgence" />{:else if c.vaulted}<Avail v="vaulted" />{/if}
          {#if c.unobtainable}<span class="tag">No longer available</span>{/if}
        </div>
        {#if item.description}<p class="prose">{clean(item.description)}</p>{/if}
        <div class="facts">
          <span><GameIcon name="mastery" size={16} /> {c.points.toLocaleString("en")} mastery</span>
          {#if item.releaseDate}<span class="dim">Released {new Date(item.releaseDate).getFullYear()}</span>{/if}
        </div>
        <div class="detail-acts">
          {#if neverItem}<NeverSoldTag name={neverItem.name} onsellagain={() => (settings.market.spares.neverSell = withoutNeverSell(settings.market.spares, [neverItem!.id]).neverSell)} />
          {:else if tradeName && setsHeld > 0 && bookState !== "missing"}<ListButton {model} labelled name={tradeName} req={{ quantity: setsHeld }} />{/if}
          <button class="star" class:on={fav} title={fav ? "On your wishlist: click to take it off" : "Add it to your wishlist (Wishlist, and ★ on Foundry)"} onclick={toggleFav}><span class="glyph" aria-hidden="true" use:pop={{ on: fav, of: item.uniqueName }}>{fav ? "★" : "☆"}</span> {fav ? "On your wishlist" : "Add to wishlist"}</button>
          {#if buildable}<button title="Builds for {item.name}: yours, MyOrbiter's suggestion, and what you're missing for each" onclick={openBuilds}>Builds</button>{/if}
          <button title="Its page on the official wiki" aria-busy={links.isOpening(item.wikiaUrl ?? wikiUrl(item.name))} onclick={() => openUrl(item.wikiaUrl ?? wikiUrl(item.name))}><Opening url={item.wikiaUrl ?? wikiUrl(item.name)}>Wiki</Opening></button>
          {#if tradeName && bookState !== "missing"}<button title="Its page on warframe.market: orders and price history" aria-busy={links.isOpening(marketUrl(tradeName ?? item.name))} onclick={() => openUrl(marketUrl(tradeName ?? item.name))}><Opening url={marketUrl(tradeName ?? item.name)}>warframe.market</Opening></button>{/if}
        </div>
      </div>
    </section>

    {#if tradeName}
      <section class="market">
        <div class="cell"><span class="register">Daily median{c.isPrime ? ", set" : ""}</span><P v={c.setPrice ?? model.price(item.name)} big /></div>
        <div class="cell sell"><span class="register">Buy now</span>{#if book}<P v={book.sell} big /><span class="dim small">{book.sellers ? `cheapest of ${book.sellers} seller${book.sellers === 1 ? "" : "s"} in game` : "nobody in game selling"}</span>{:else}<span class="dim small">{bookNote}</span>{/if}</div>
        <div class="cell buy"><span class="register">Sell now</span>{#if book}<P v={book.buy} big /><span class="dim small">{book.buyers ? `best of ${book.buyers} buyer${book.buyers === 1 ? "" : "s"} online` : "no buyers online"}</span>{:else}<span class="dim small">{bookNote}</span>{/if}</div>
        {#if c.isPrime}
          {@const loose = c.parts.filter((p) => p.tradable).reduce((n, p) => (n == null || p.price == null ? null : n + p.price * p.required), 0 as number | null)}
          <div class="cell"><span class="register">Parts sold loose</span><P v={loose == null ? null : Math.round(loose)} big /></div>
        {/if}
        <HelpMark part="item-sheet.prices" corner />
      </section>
      {#if bookState !== "missing"}<section class="history"><PriceHistory name={tradeName} known={(c.setPrice ?? model.price(item.name)) != null} /></section>{/if}
    {/if}

    {#if row && !row.unobtainable}
      <section class="how">
        <div class="hmark"><h3 class="register lead">How to get it</h3><HelpMark part="item-sheet.how" /></div>
        <div class="howrow"><Effort acq={row.acq} /><p class="prose">{row.acq.how}{#if row.acq.players}<span class="players">{row.acq.players}</span>{/if}</p></div>
        {#if wish && wish.missing.length && ((wish.odds != null && wish.odds > 0) || wish.buyCost != null)}
          {@const odds = wish.odds != null && wish.odds > 0 ? wish.odds : null}
          <p class="finish">
            {#if odds != null}<b class="mark">{odds >= 0.995 ? "99%+" : odds < 0.005 ? "<1%" : `${Math.round(odds * 100)}%`}</b><span class="dim">chance your relics give every missing part, cracking each once</span>{/if}
            {#if wish.buyCost != null}<span class="dim">{odds != null ? "· or buy them for" : "Buy the missing parts for"}</span><P v={wish.buyCost} />{/if}
          </p>
        {/if}
      </section>
    {/if}

    {#if c.parts.length}
      <section>
        <div class="hmark"><h3 class="register lead">Built from{#if c.partBuilt} <span class="built" title="You hold the {familyOf(item.uniqueName)?.part ?? 'part'} already, or it's in a build: its blueprint and resources are spent">Built ✓</span>{:else if item.buildPrice} <span class="dim cost"><GameIcon name="credits" size={13} /> {item.buildPrice.toLocaleString("en")} · {days(item.buildTime)}</span>{/if}</h3><HelpMark part="item-sheet.built-from" /></div>
        <ul class="bom">
          {#each c.parts as p (p.name)}
            {@const w = where(p)}
            <li>
              <PartChip part={p} size={40} />
              <div class="pname">
                <b class="name-mark">{p.resource ? p.label : p.label === "Blueprint" ? "Blueprint" : p.label}</b>
                <span class="small" class:missing={p.have < p.required && !p.building && !done} class:inhand={!p.resource && p.have >= p.required && !done} class:dim={done || (p.resource && p.have >= p.required)}>
                  {#if p.building}Building now{:else if p.resource}{p.have.toLocaleString("en")} held · {p.required} needed{:else if p.have >= p.required}In hand{p.have > p.required ? ` (${p.have})` : ""}{:else if c.partBuilt}Used{:else if done}{p.have ? `${p.have} held` : "None held"}{:else}Missing{p.required > 1 ? ` ${p.required - p.have} of ${p.required}` : ""}{/if}
                </span>
              </div>
              <div class="src">
                {#if w.kind === "relics"}
                  <Avail v={w.availability} />
                  {#each w.relics.slice(0, 4) as r, j (j)}
                    <span class="relic" class:held={r.owned > 0} class:vaulted={r.vaulted} use:info={r.base}>
                      <GameIcon name={eraIcon(r.base.split(" ")[0])} size={15} />{r.base}{#if r.owned}<em>×{r.owned}</em>{/if}
                    </span>
                  {/each}
                  {#if w.relics.length > 4}<span class="dim small">+{w.relics.length - 4}</span>{/if}
                {:else if w.kind === "vendor"}
                  <span class="drop vendor" title={w.step}>{w.who}</span>
                {:else if w.kind === "drops"}
                  {#each w.drops as d, j (j)}<span class="drop" title="{Math.round(d.chance * 100) / 100}% a run">{placeName(d.location)}</span>{:else}<span class="dim small">{p.label === "Blueprint" && (item.bpCost || item.marketCost) ? "Market" : ""}</span>{/each}
                {/if}
              </div>
              <div class="pval">
                {#if p.price != null}<P v={Math.round(p.price)} />{/if}
                {#if p.ducats}<P v={p.ducats} d dim />{/if}
              </div>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if plan && plan.resources.length}
      <section class="plan">
        <div class="hmark"><h3 class="register lead">What building it takes now <span class="tier t-{plan.tier}" title={TIER_TIP[plan.tier]}>{TIER_LABEL[plan.tier]}</span>{#if plan.credits} <span class="dim cost"><GameIcon name="credits" size={13} /> {plan.credits.toLocaleString("en")}</span>{/if}</h3><HelpMark part="item-sheet.plan" /></div>
        {#if plan.parts.some((p) => p.state === "blueprint" || p.state === "missing")}
          <ul class="steps">
            {#each plan.parts.filter((p) => p.state !== "built") as p (p.label)}
              <li class="s-{p.state}">
                <PartChip part={{ label: p.label, name: p.name, image: p.image, required: 1, have: p.state === "missing" ? 0 : 1, resource: false, building: p.state === "building", price: null, ducats: null, tradable: false }} size={30} />
                <span><b>{p.label}</b> <span class="dim small">{p.state === "missing" ? "still to get, blueprint and all" : p.state === "building" ? "building now" : p.needs.length ? `blueprint in hand; building it takes ${p.needs.map((n) => `${n.need.toLocaleString("en")} ${n.name}`).join(", ")}` : "blueprint in hand"}</span></span>
              </li>
            {/each}
          </ul>
        {/if}
        <ul class="needs">
          {#each plan.resources as r (r.path)}
            <li class:short={r.have < r.need} title="{r.name}: for {r.for.join(', ')}{r.kind === 'world' ? ' · from an open world, an event, fishing or mining' : ''}">
              <Thumb file={r.image} name={r.name} size={30} />
              <span class="rn"><b>{r.name}</b><span class="dim small">for {r.for.join(", ")}</span></span>
              <span class="rq"><b>{r.have.toLocaleString("en")}</b><span class="dim">/ {r.need.toLocaleString("en")}</span></span>
            </li>
          {/each}
        </ul>
        {#if !plan.complete}<p class="dim small">The parts' own recipes haven't been read yet (they're fetched once a week), so only {item.name}'s own blueprint is counted.</p>{/if}
      </section>
    {/if}

    {#if isFrame}
      <section>
        <div class="hmark"><h3 class="register lead">Base stats</h3><HelpMark part="item-sheet.base-stats" /></div>
        <div class="stats">
          <div><span class="register">Health</span><b>{num(item.health, 0)}</b></div>
          <div><span class="register">Shield</span><b>{num(item.shield, 0)}</b></div>
          <div><span class="register">Armor</span><b>{num(item.armor, 0)}</b></div>
          <div><span class="register">Energy</span><b>{num(item.power, 0)}</b></div>
          <div><span class="register">Sprint</span><b>{num(item.sprintSpeed)}</b></div>
          {#if item.aura || item.polarities?.length}
            <div class="pols"><span class="register">Polarities</span><span>{#if item.aura}<img src="/game/pol/{item.aura}.png" alt={item.aura} title="Aura: {item.aura}" class="pol aura" />{/if}{#each item.polarities ?? [] as pol, i (i)}<img src="/game/pol/{pol}.png" alt={pol} title={pol} class="pol" />{/each}</span></div>
          {/if}
        </div>
        {#if item.passiveDescription}<p class="prose passive"><span class="register">Passive</span> {clean(item.passiveDescription)}</p>{/if}
        {#if item.abilities?.length}
          <ol class="abilities">
            {#each item.abilities as a, i (i)}
              <li>
                <span class="ab">{#if a.imageName && !noIcon[a.imageName]}<img src={imageUrl(a.imageName)} alt="" loading="lazy" onerror={() => (noIcon[a.imageName!] = true)} />{:else}{i + 1}{/if}</span>
                <div><b class="name-mark">{a.name}</b><p class="dim small">{clean(a.description)}</p></div>
              </li>
            {/each}
          </ol>
        {/if}
      </section>
    {:else if isWeapon}
      <section>
        <div class="hmark"><h3 class="register lead">Stats</h3><HelpMark part="item-sheet.stats" /></div>
        <div class="stats">
          <div><span class="register">Damage</span><b>{num(item.totalDamage, 1)}</b></div>
          <div><span class="register">Critical</span><b>{pct(item.criticalChance)} <span class="dim">×{num(item.criticalMultiplier, 1)}</span></b></div>
          <div><span class="register">Status</span><b>{pct(item.procChance)}</b></div>
          <div><span class="register">Fire rate</span><b>{num(item.fireRate)}</b></div>
          {#if item.magazineSize}<div><span class="register">Magazine</span><b>{item.magazineSize}</b></div>{/if}
          {#if item.reloadTime}<div><span class="register">Reload</span><b>{num(item.reloadTime, 1)} s</b></div>{/if}
          {#if item.multishot && item.multishot !== 1}<div><span class="register">Multishot</span><b>{num(item.multishot, 1)}</b></div>{/if}
          {#if item.range}<div><span class="register">Range</span><b>{num(item.range, 1)} m</b></div>{/if}
          {#if item.trigger}<div><span class="register">Trigger</span><b>{item.trigger}</b></div>{/if}
        </div>
        {#if item.damage}
          <div class="damage">
            {#each Object.entries(item.damage).sort((a, b) => b[1] - a[1]) as [k, v] (k)}<span class="dmg"><span class="register">{DAMAGE[k] ?? k}</span> {num(v, 1)}</span>{/each}
          </div>
        {/if}
      </section>
    {/if}
  </Sheet>
{/if}

<style>
  .hero { display: grid; grid-template-columns: auto 1fr; gap: 1.4rem; align-items: center; }
  @media (max-width: 720px) { .hero { grid-template-columns: 1fr; justify-items: center; } }
  .intro { display: grid; gap: .8rem; align-content: center; }
  .tags { display: flex; flex-wrap: wrap; gap: .35rem; }
  .tags .tag { margin: 0; }
  .facts { display: flex; gap: 1.2rem; align-items: center; font-size: .86rem; }
  .facts span { display: inline-flex; align-items: center; gap: .35rem; }
  .star.on { color: var(--gold); border-color: var(--gold-dim); }
  /* The ★ itself pops as it fills (motion.ts, pop). */
  .star .glyph { display: inline-block; }
  .history { margin-top: .8rem; }
  .market { position: relative; padding-right: 2rem; display: grid; grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr)); border: 1px solid var(--rule); background: var(--well); }
  .cell { display: grid; gap: .35rem; padding: .8rem 1rem; align-content: start; }
  .cell + .cell { border-left: 1px solid var(--rule); }
  .cell.buy .register { color: var(--verdigris); }
  .cell.sell .register { color: var(--gold); }
  h3 { margin: 0 0 .7rem; display: flex; align-items: center; gap: .6rem; }
  .hmark { margin: 0 0 .7rem; gap: .6rem; }
  .hmark > h3 { margin: 0; }
  .hmark > :global(.helpmark) { margin-left: auto; }
  /* The part's already built: said once, in the heading, rather than "Missing" down the list. */
  .built { margin-left: .4rem; color: var(--verdigris); letter-spacing: .1em; }
  .cost { display: inline-flex; align-items: center; gap: .3rem; letter-spacing: .06em; text-transform: none; font-family: var(--face-text); font-size: .78rem; }
  .finish { display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; margin: .7rem 0 0; }
  .finish b { font-size: 1.25rem; color: var(--gold); }
  .howrow { display: grid; grid-template-columns: auto 1fr; gap: 1rem; align-items: start; }
  .bom { list-style: none; margin: 0; padding: 0; display: grid; gap: .1rem; }
  .bom li { display: grid; grid-template-columns: 44px minmax(8rem, 12rem) 1fr auto; gap: .8rem; align-items: center; padding: .5rem 0; border-bottom: 1px solid var(--rule); }
  .pname { display: grid; gap: .15rem; }
  .src { display: flex; flex-wrap: wrap; gap: .3rem .45rem; align-items: center; }
  .relic { display: inline-flex; align-items: center; gap: .25rem; padding: .12rem .4rem .12rem .25rem; border: 1px solid var(--rule); font-size: .76rem; color: var(--platinum-dim); }
  .relic.held { border-color: var(--gold-dim); color: var(--platinum); }
  .relic.vaulted { opacity: .6; }
  .relic em { font-style: normal; color: var(--gold); font-weight: 600; }
  .drop { font-size: .76rem; color: var(--platinum-dim); padding: .12rem .4rem; border: 1px solid var(--rule); }
  .pval { display: grid; justify-items: end; gap: .15rem; }
  .stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(8.5rem, 1fr)); gap: .1rem; border: 1px solid var(--rule); background: var(--well); }
  .stats > div { display: grid; gap: .3rem; padding: .7rem .9rem; }
  .stats b { font-family: var(--face-mark); font-size: 1.25rem; font-variant-numeric: tabular-nums; }
  .pols span:last-child { display: flex; gap: .3rem; align-items: center; }
  .pol { width: 18px; height: 18px; opacity: .85; }
  .pol.aura { outline: 1px solid var(--gold-dim); outline-offset: 2px; margin-right: .3rem; }
  .passive { margin-top: .8rem; max-width: none; }
  .passive .register { margin-right: .4rem; color: var(--gold-dim); }
  .abilities { list-style: none; margin: .9rem 0 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(20rem, 1fr)); gap: .8rem 1.2rem; }
  .abilities li { display: grid; grid-template-columns: 40px 1fr; gap: .7rem; align-items: start; }
  .ab { width: 40px; height: 40px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--rule-bright); background: var(--well); font-family: var(--face-mark); color: var(--gold); }
  .ab img { width: 30px; height: 30px; object-fit: contain; }
  .abilities p { margin: .2rem 0 0; }
  .damage { display: flex; flex-wrap: wrap; gap: .4rem .9rem; margin-top: .7rem; font-variant-numeric: tabular-nums; }
  .dmg { display: inline-flex; gap: .4rem; align-items: baseline; }
  .players { display: block; margin-top: .35rem; font-size: .82rem; color: var(--platinum-deep); }
  .missing { color: var(--platinum-deep); }
  .inhand { color: var(--gold); }
  /* What building takes now: each part still to build or get, then every resource, short ones first. */
  .tier { margin-left: .5rem; padding: .1rem .45rem; border: 1px solid var(--rule-bright); font-size: 11px; color: var(--platinum); }
  .tier.t-now { color: var(--verdigris); border-color: color-mix(in srgb, var(--verdigris) 50%, transparent); }
  .tier.t-farm { color: var(--gold); border-color: var(--gold-dim); }
  .tier.t-hard, .tier.t-parts { color: var(--oxblood); border-color: color-mix(in srgb, var(--oxblood) 70%, transparent); }
  .steps { list-style: none; margin: 0 0 .8rem; padding: 0; display: grid; gap: .45rem; }
  .steps li { display: flex; align-items: center; gap: .7rem; }
  .steps b { color: var(--platinum); }
  .needs { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr)); gap: .5rem 1.2rem; }
  .needs li { display: grid; grid-template-columns: 30px minmax(0, 1fr) auto; gap: .6rem; align-items: center; }
  .rn { display: grid; min-width: 0; }
  .rn b { font-weight: 600; color: var(--platinum); font-size: .88rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .rn .small { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .rq { font-variant-numeric: tabular-nums; white-space: nowrap; display: inline-flex; gap: .3rem; align-items: baseline; }
  .needs li.short .rq b { color: var(--gold); }
  .needs li:not(.short) .rq b { color: var(--verdigris); }
</style>
