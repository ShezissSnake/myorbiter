<script lang="ts">
  // Your rivens, read from the game: each stat as the game shows it, how good each roll is, and
  // what comparable rivens sell for. Below, a finder for rivens on warframe.market, and alerts for
  // the ones you want at your price.
  import type { Model } from "../core/model";
  import type { RivenWatch, Settings } from "../backend";
  import { marketUrl, openUrl } from "../backend";
  import { tradesFor, type RivenTrade } from "../core/rivens";
  import { auctionItemFor, auctionOf, cycleCost, gradeAuction, kuvaSpent, lastCycle, parseRiven, priceCheck, rivenTables, rollChoice, cycleKey, searchFor, type MyAuction, type Riven, type RivenAuction, type RivenChange, type RollChoice } from "../core/rivens";
  import { mkt } from "../marketStore.svelte";
  import { rivens } from "../rivenStore.svelte";
  import PageHead from "../ui/PageHead.svelte";
  import Stat from "../ui/Stat.svelte";
  import CardGrid from "../ui/CardGrid.svelte";
  import Art from "../ui/Art.svelte";
  import P from "../ui/P.svelte";
  import GameIcon from "../ui/GameIcon.svelte";
  import Seg from "../ui/Seg.svelte";
  import Chip from "../ui/Chip.svelte";
  import IconButton from "../ui/IconButton.svelte";
  import Icon from "../ui/Icon.svelte";
  import Thumb from "../ui/Thumb.svelte";
  import { matches } from "../ui/table";

  // console: you play on a console or phone, where orbiter can't read your rivens: the finder and
  // alerts only.
  let { model, settings = $bindable(), console = false }: { model: Model; settings: Settings; console?: boolean } = $props();

  const tables = $derived(rivenTables(model.catalogByUnique.values()));
  const mine = $derived((settings.game.rivens ?? []).map((r) => parseRiven(model, tables, r)).filter((r): r is Riven => !!r));
  const veiled = $derived([...model.inventoryByBase.entries()].filter(([u]) => /\/Randomized\/Raw/.test(u)).reduce((n, [, rows]) => n + rows.reduce((k, r) => k + r.quantity, 0), 0));
  // What the last cycle orbiter saw did to each riven.
  // Rivens mid-cycle: the roll each has and the one on offer, and which to keep.
  const choices = $derived((settings.game.rivens ?? []).filter((raw) => raw.pending).map((raw) => ({ key: cycleKey(raw), c: rollChoice(model, tables, raw) })).filter((x): x is { key: string; c: RollChoice } => !!x.c));
  // What similar rivens are listed for, each roll, to settle a close call: per cycle, not per riven.
  let rollPrices = $state<Record<string, { current: number | null; next: number | null }>>({});
  $effect(() => {
    const m = meta;
    if (!m) return;
    for (const { key, c } of choices) {
      if (rollPrices[key]) continue;
      rollPrices[key] = { current: null, next: null };
      void (async () => {
        const price = async (r: Riven) => {
          const q = searchFor(m, r);
          if (!q.weapon) return null;
          return priceCheck(await rivens.search(q.weapon, q.positive.slice(0, 2), null).catch(() => [])).typical;
        };
        rollPrices[key] = { current: await price(c.current), next: await price(c.next) };
      })();
    }
  });
  const cycles = $derived.by(() => {
    const out: Record<string, RivenChange> = {};
    for (const raw of settings.game.rivens ?? []) {
      const c = lastCycle(model, tables, raw, settings.game.rivenHistory ?? {});
      if (c) out[raw.id] = c;
    }
    return out;
  });
  let sort = $state<"grade" | "weapon" | "rank" | "traded">("grade");
  // Filters: the riven's kind (Rifle, Melee…), spliced ones only, and a weapon or name.
  let kind = $state("all");
  let splicedOnly = $state(false);
  let query = $state("");
  // Companions' weapons take the usual riven kinds (a sentinel's rifle takes a rifle riven): they're
  // a kind of their own here, and Rifle, Melee… are your own weapons'.
  const kindOf = (r: Riven) => (r.companion ? "companion" : r.kind);
  const kinds = $derived([...new Set(mine.filter((r) => !r.companion).map((r) => r.kind))].sort().map((k) => ({ k, n: mine.filter((r) => !r.companion && r.kind === k).length })));
  const companions = $derived(mine.filter((r) => r.companion).length);
  const splicedCount = $derived(mine.filter((r) => r.spliced).length);
  const best = $derived(mine.reduce<Riven | null>((b, r) => (r.quality != null && (b?.quality == null || r.quality > b.quality) ? r : b), null));
  const shown = $derived(mine.filter((r) => (kind === "all" || (kind === "regular" ? !r.companion : kindOf(r) === kind)) && (!splicedOnly || r.spliced) && matches(query, r.weapon, r.name, ...r.stats.map((x) => x.label))));
  const sorted = $derived(
    [...shown].sort((a, b) =>
      sort === "grade" ? (b.quality ?? -1) - (a.quality ?? -1)
      : sort === "rank" ? b.rank - a.rank
      : sort === "traded" ? (tradeValue(b) ?? -1) - (tradeValue(a) ?? -1) || a.weapon.localeCompare(b.weapon)
      : a.weapon.localeCompare(b.weapon),
    ),
  );

  $effect(() => {
    void rivens.loadMeta();
  });
  // The page stays open once opened: a list that failed to load is asked for again each minute.
  $effect(() => {
    if (!rivens.metaError) return;
    const t = setInterval(() => void rivens.loadMeta(), 60_000);
    return () => clearInterval(t);
  });
  // What rivens traded for in game last week, per weapon (DE's weekly figures).
  $effect(() => {
    void rivens.loadTrades(settings.market.platform);
  });
  const traded = (r: Riven) => (rivens.trades ? tradesFor(rivens.trades, r.kind, r.weapon, r.rerolls > 0) : null);
  const tradeValue = (r: Riven) => traded(r)?.same?.median ?? null;
  const fmtP = (v: number) => `${Math.round(v).toLocaleString("en")}p`;
  const tradeTitle = (r: Riven, t: RivenTrade) =>
    `Riven trades completed in game ${rivens.tradesWeek ?? "last week"} for ${t.weapon} rivens that were ${t.rerolled ? "cycled" : "never cycled"}: median ${t.median == null ? "?" : fmtP(t.median)}, average ${fmtP(t.avg)}, from ${fmtP(t.min)} to ${fmtP(t.max)} (Digital Extremes' weekly figures, 1p trades left out). They don't say which stats sold, so a great roll goes well over the median and a poor one under it.`;
  const meta = $derived(rivens.meta);

  // Price checks, per riven: rivens listed with its two best stats ("similar"), and any riven for
  // its weapon at all, whose cheapest is the floor anyone can buy one at. Both are asking prices:
  // warframe.market keeps no record of what rivens sold for.
  let checks = $state<Record<string, { loading: boolean; error?: string; auctions?: RivenAuction[]; any?: RivenAuction[] }>>({});
  const SLOW = /slow down/;
  async function check(r: Riven, fresh = false) {
    if (!meta) return;
    const q = searchFor(meta, r);
    if (!q.weapon) {
      checks[r.id] = { loading: false, error: "warframe.market doesn't list rivens for this weapon" };
      return;
    }
    checks[r.id] = { loading: true };
    try {
      const auctions = await rivens.search(q.weapon, q.positive.slice(0, 2), null, fresh ? 0 : undefined);
      // The weapon's own search is shared by every riven for it, and kept a while.
      const any = await rivens.search(q.weapon, [], null).catch(() => undefined);
      checks[r.id] = { loading: false, auctions, any };
    } catch (e) {
      checks[r.id] = { loading: false, error: String(e).replace(/^Error: /, "") };
    }
  }
  // Price check every riven, one after another (warframe.market is asked at its own pace), skipping
  // ones already checked. Stop halts after the one in progress. Ones that fail on the way (turned
  // away, timed out) are tried once more at the end, after a pause; what still fails is said.
  let checkingAll = $state<{ done: number; total: number; paused?: boolean; retry?: boolean } | null>(null);
  let checkedAll = $state<{ ok: number; failed: Riven[]; reason: string } | null>(null);
  let stopAll = false;
  const failedCheck = (r: Riven) => !!checks[r.id]?.error && !checks[r.id]?.auctions;
  /** Of the last run's failures, the ones still failing (one checked by hand since drops out). */
  const stillFailed = $derived(checkedAll?.failed.filter(failedCheck) ?? []);
  async function checkAll(only?: Riven[]) {
    const listed = meta ? (only ?? sorted).filter((r) => searchFor(meta, r).weapon) : [];
    // Everything checked already: check them all again (prices move).
    const fresh = listed.filter((r) => !checks[r.id]?.auctions);
    const again = !only && !fresh.length;
    const todo = again ? listed : fresh;
    checkedAll = null;
    if (!meta || !todo.length) return;
    stopAll = false;
    checkingAll = { done: 0, total: todo.length };
    const wait = async () => {
      checkingAll = { ...checkingAll!, paused: true };
      await new Promise((res) => setTimeout(res, 30_000));
      checkingAll = { ...checkingAll!, paused: false };
    };
    for (const r of todo) {
      if (stopAll) break;
      await check(r, again);
      // Still turned away after orbiter's own retries: a longer pause, then once more.
      if (SLOW.test(checks[r.id]?.error ?? "") && !stopAll) {
        await wait();
        if (!stopAll) await check(r, again);
      }
      checkingAll = { ...checkingAll, done: checkingAll.done + 1, total: todo.length };
    }
    // A second go at the ones that failed, after a pause.
    const failed = todo.filter(failedCheck);
    if (failed.length && !stopAll) {
      checkingAll = { done: 0, total: failed.length, retry: true };
      await wait();
      for (const r of failed) {
        if (stopAll) break;
        await check(r, true);
        checkingAll = { ...checkingAll, done: checkingAll.done + 1 };
      }
    }
    const still = todo.filter(failedCheck);
    checkedAll = { ok: todo.filter((r) => checks[r.id]?.auctions).length, failed: still, reason: still.length ? checks[still[0].id]!.error! : "" };
    checkingAll = null;
  }
  // Selling: your riven auctions on warframe.market, and the form to put one up.
  $effect(() => {
    if (mkt.linked && meta) void rivens.loadMine();
  });
  let sell = $state<Record<string, { buyout: number | null; bids: boolean; starting: number | null; busy: boolean; error: string | null }>>({});
  function openSell(r: Riven, suggest: number | null) {
    sell[r.id] = { buyout: suggest, bids: false, starting: null, busy: false, error: null };
  }
  async function list(r: Riven) {
    const f = sell[r.id];
    if (!meta || !f || !f.buyout) return;
    const made = auctionItemFor(meta, r);
    if ("error" in made) {
      f.error = made.error;
      return;
    }
    const buyout = Math.round(f.buyout);
    const starting = f.bids && f.starting ? Math.min(Math.round(f.starting), buyout) : buyout;
    f.busy = true;
    f.error = null;
    try {
      await rivens.sell(made.item, buyout, starting);
      delete sell[r.id];
    } catch (e) {
      f.error = String(e).replace(/^Error:\s*/, "");
    } finally {
      if (sell[r.id]) sell[r.id].busy = false;
    }
  }
  let reprice = $state<Record<string, { buyout: number | null; busy: boolean; error: string | null }>>({});
  async function savePrice(a: MyAuction) {
    const f = reprice[a.id];
    if (!f?.buyout) return;
    f.busy = true;
    f.error = null;
    try {
      const buyout = Math.round(f.buyout);
      // A bid auction keeps its starting price unless the buyout goes under it.
      await rivens.reprice(a, buyout, a.starting < (a.buyout ?? a.starting) ? Math.min(a.starting, buyout) : buyout);
      delete reprice[a.id];
    } catch (e) {
      f.error = String(e).replace(/^Error:\s*/, "");
      f.busy = false;
    }
  }
  let closing = $state<string | null>(null);
  let closeError = $state<Record<string, string>>({});
  async function takeDown(a: MyAuction) {
    closing = a.id;
    try {
      await rivens.close(a);
    } catch (e) {
      closeError[a.id] = String(e).replace(/^Error:\s*/, "");
    } finally {
      closing = null;
    }
  }

  const tradedSum = $derived.by(() => {
    let total = 0;
    let n = 0;
    for (const r of mine) {
      const v = tradeValue(r);
      if (v != null) {
        total += v;
        n++;
      }
    }
    return { total, n };
  });
  const priced = $derived(mine.map((r) => checks[r.id]?.auctions).filter((a): a is RivenAuction[] => !!a).map((a) => priceCheck(a)));
  const worth = $derived(priced.reduce((n, p) => n + (p.typical ?? 0), 0));
  // Rivens for weapons warframe.market doesn't list can't be checked: they don't count as left to do.
  // Price check all goes through the rivens the filters show.
  const unchecked = $derived(meta ? shown.filter((r) => !checks[r.id]?.auctions && searchFor(meta, r).weapon).length : shown.length);

  const searchUrl = (r: Riven) => {
    const q = meta ? searchFor(meta, r) : null;
    return q?.weapon ? `https://warframe.market/auctions/search?type=riven&weapon_url_name=${q.weapon}&positive_stats=${q.positive.slice(0, 2).join(",")}&polarity=any&sort_by=price_asc` : marketUrl(r.weapon);
  };

  // ---------------------------------------------------------------- finder and alerts
  let weaponName = $state("");
  let pos = $state<string[]>(["", "", ""]);
  let neg = $state("");
  let maxPrice = $state<number | null>(null);
  const weapon = $derived(meta?.weapons.find((w) => w.name.toLowerCase() === weaponName.trim().toLowerCase()) ?? null);
  const attrsFor = $derived(
    meta && weapon
      ? meta.attributes.filter((a) => !a.exclusiveTo?.length || a.exclusiveTo.includes(weapon.group === "archgun" ? "archgun" : weapon.group === "kitgun" ? "kitgun" : weapon.group === "zaw" ? "zaw" : weapon.rivenType))
      : (meta?.attributes ?? []),
  );
  const attrName = (slug: string) => meta?.attributes.find((a) => a.slug === slug)?.name ?? slug;
  /** A stat picked in another box (wanted or curse) isn't offered again: a riven can't roll it twice. */
  const takenBut = (keep: string) => new Set([...pos, neg].filter((s) => s && s !== keep));
  // The results keep the weapon they were searched for, whatever the box says now.
  let found = $state<{ key: string; weapon: { slug: string; name: string }; auctions?: RivenAuction[]; error?: string; loading: boolean } | null>(null);
  async function find() {
    if (!weapon) return;
    const positive = pos.filter(Boolean);
    const key = `${weapon.slug}|${positive.join(",")}|${neg}`;
    const w = { slug: weapon.slug, name: weapon.name };
    found = { key, weapon: w, loading: true };
    try {
      const auctions = await rivens.search(w.slug, positive, neg || null, 60_000);
      if (found?.key === key) found = { key, weapon: w, loading: false, auctions };
    } catch (e) {
      if (found?.key === key) found = { key, weapon: w, loading: false, error: String(e).replace(/^Error: /, "") };
    }
  }
  let watchNote = $state<string | null>(null);
  // A changed form is a new alert: the note was about the last one.
  $effect(() => {
    void [weaponName, neg, maxPrice, ...pos];
    watchNote = null;
  });
  function watch() {
    if (!weapon || !maxPrice) return;
    const w: RivenWatch = { id: `${Date.now()}`, weapon: weapon.slug, weaponName: weapon.name, positive: pos.filter(Boolean), negative: neg || null, maxPrice: Math.round(maxPrice) };
    const same = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();
    if (settings.rivenWatch.some((x) => x.weapon === w.weapon && same(x.positive, w.positive) && x.negative === w.negative && x.maxPrice === w.maxPrice)) {
      watchNote = "You're already watching for that.";
      return;
    }
    watchNote = null;
    settings.rivenWatch = [...settings.rivenWatch, w];
  }
  const unwatch = (id: string) => (settings.rivenWatch = settings.rivenWatch.filter((w) => w.id !== id));
  const shownAuctions = $derived((found?.auctions ?? []).filter((a) => !maxPrice || (a.price ?? Infinity) <= maxPrice));
  const statusLabel: Record<string, string> = { ingame: "In game", online: "Online", offline: "Offline" };
</script>

{#snippet grade(g: string, big = false)}<span class="grade g-{g.replace('+', 'p').replace('−', 'm')}" class:big>{g}</span>{/snippet}

<div class="page"><div class="page-inner">
  <PageHead title="Rivens" blurb={console ? "Find rivens for sale, each roll graded, what each weapon's rivens traded for last week, and alerts when one you want is listed at your price." : "Your rivens graded stat by stat, and what each weapon's rivens sold for last week."}>
    {#snippet band()}
      {#if !console}
      <Stat label="Unveiled" note="Read from your inventory">{mine.length}</Stat>
      <Stat label="Veiled" tone="dim" note="Challenges still to do">{veiled}</Stat>
      <Stat label="Best roll" tone="gold" note={best ? `${best.weapon} ${best.name}` : "–"}>{best?.grade ?? "–"}</Stat>
      {#if tradedSum.n}<Stat label="Traded around" tone="gold" note={`Last week's in-game median for each weapon, ${tradedSum.n} of ${mine.length} rivens`}><P v={Math.round(tradedSum.total)} big /></Stat>{:else if priced.length}<Stat label="Listed around" tone="gold" note={`What similar ones are listed for (asking, not sold), ${priced.length} of ${mine.length} checked`}><P v={worth} big /></Stat>{/if}
      {/if}
      <Stat label="Alerts" note="Rivens you're watching for">{settings.rivenWatch.length}</Stat>
    {/snippet}
  </PageHead>

  {#if choices.length}
    <section class="cycling" aria-label="Cycling now">
      {#each choices as { key, c } (key)}
        {@const pc = rollPrices[key]}
        <article class="choice">
          <header><Thumb file={c.current.image} name={c.current.weapon} size={30} /><b class="mark">Cycling {c.current.weapon}</b><span class="verdict v-{c.verdict}">{c.verdict === "take" ? "Take the new roll" : c.verdict === "keep" ? "Keep the one it has" : "Too close to call"}</span></header>
          <p class="small">{c.why}{#if pc?.current != null && pc?.next != null}{" "}Similar rivens are listed around <b>{pc.current}p</b> for the one it has and <b>{pc.next}p</b> for the new roll.{/if}</p>
          <div class="rolls">
            {#each [{ r: c.current, label: "It has", win: c.verdict === "keep" }, { r: c.next, label: "New roll", win: c.verdict === "take" }] as x (x.label)}
              <div class="roll" class:win={x.win}>
                <span class="register">{x.label}</span>
                <span class="rn"><b>{x.r.name}</b>{@render grade(x.r.grade)}</span>
                <ul>{#each x.r.stats as s, i (i)}<li class:curse={!s.buff}><b>{s.display}</b> {s.label} {@render grade(s.grade)}</li>{/each}</ul>
              </div>
            {/each}
          </div>
        </article>
      {/each}
      <p class="dim small">Read while you're choosing in game (press Sync at the cycle screen if it doesn't show). The stats are weighed by what players look for on a riven: crit, multishot, damage and elements first; a curse on zoom or recoil costs nothing.</p>
    </section>
  {/if}

  {#if console}
    <!-- No rivens of your own to show on a console: straight to the finder. -->
  {:else if settings.game.rivens == null}
    <section class="panel note">
      <h2 class="mark">Your rivens show up after TennoScope's next read</h2>
      <p class="prose">orbiter gets your rivens' stats through TennoScope, which needs three things:</p>
      <ol class="prose steps">
        <li>TennoScope rebuilt with orbiter's current patch (<code>patches/README.md</code> has the commands).</li>
        <li>Full access, chosen in TennoScope's own window.</li>
        <li>A read of your inventory: press <b>Sync</b> while Warframe is running.</li>
      </ol>
      <p class="prose dim">Find a riven and alerts, below, work without any of this.</p>
    </section>
  {:else if !mine.length}
    <p class="dim">No unveiled rivens in your inventory.</p>
  {:else}
    <div class="bar">
      <input type="search" placeholder="Filter rivens…" bind:value={query} aria-label="Filter rivens by weapon, name or stat" title="A weapon, a riven's name or a stat" />
      <select bind:value={kind} aria-label="Riven kind" title="Only rivens for one kind of weapon: your own weapons by type, or your companions' (a sentinel's or MOA's gun, a hound's claws)">
        <option value="all">All kinds ({mine.length})</option>
        {#if companions}<option value="regular">Your weapons ({mine.length - companions})</option>{/if}
        {#each kinds as x (x.k)}<option value={x.k}>{x.k} ({x.n})</option>{/each}
        {#if companions}<option value="companion">Companion weapons ({companions})</option>{/if}
      </select>
      {#if splicedCount}<Chip bind:on={splicedOnly} label="Spliced ({splicedCount})" title="Only rivens with a stat from Riven Splicing (Gas, Corrosive, Weak Point Damage…), which can't roll by cycling" />{/if}
      <Seg label="Sort" bind:value={sort} options={[{ v: "grade", label: "Best rolls", title: "The best overall grade first" }, { v: "weapon", label: "Weapon", title: "By weapon, A to Z" }, { v: "rank", label: "Rank", title: "The highest rank first" }, { v: "traded", label: "Trade value", title: "What rivens for the weapon (cycled or not, like yours) traded for in game last week, highest first: the ones worth selling, whatever their stats" }]} />
      {#if checkingAll}
        <span class="checking"><span class="dim small">{checkingAll.paused ? `${checkingAll.retry ? "Some checks failed" : "warframe.market asked to slow down"}: waiting half a minute, then ${checkingAll.retry ? "trying those again" : `${checkingAll.done + 1} of ${checkingAll.total}`}…` : `${checkingAll.retry ? "Trying again" : "Checking"} ${checkingAll.done + 1} of ${checkingAll.total}…`}</span><button class="link" onclick={() => (stopAll = true)}>Stop</button></span>
      {:else}
        {#if stillFailed.length}
          <span class="checking"><span class="dim small" title={checkedAll!.reason}>Checked {checkedAll!.ok}; {stillFailed.length} couldn't be ({checkedAll!.reason.replace(/(; |\. ).*$/, "")})</span><button class="link" title="Check the ones that failed again" onclick={() => checkAll(stillFailed)}>Try those again</button></span>
        {/if}
        <button class="stamp" disabled={!meta} title={!meta ? "Waiting for warframe.market's riven list" : !unchecked ? "Check every riven's price again" : "Find similar rivens for sale for each of yours, one after another"} onclick={() => checkAll()}>{!unchecked ? "Check prices again" : unchecked === shown.length ? (shown.length === mine.length ? "Price check all" : `Price check these ${unchecked}`) : `Price check the other ${unchecked}`}</button>
      {/if}
      <span class="dim small explain">Grades compare each roll with its range: S is the top of it, B the middle, F the bottom. A smaller curse grades higher. Dispositions are 1.2 for every weapon since the 22 October 2026 hotfix.</span>
    </div>
    <CardGrid min="23rem">
      {#each sorted as r (r.id)}
        {@const c = checks[r.id]}
        {@const pc = c?.auctions ? priceCheck(c.auctions) : null}
        <article class="riven">
          <header>
            <Art file={r.image} size={74} />
            <div class="t">
              <span class="register">{r.kind} riven · {r.weapon}{r.companion ? " · companion" : ""}</span>
              <h3 class="mark" title="{r.weapon} {r.name}">{r.weapon} {r.name}</h3>
              <span class="meta dim small">
                {#if r.polarity}<img src="/game/pol/{r.polarity}.png" alt={r.polarity} title={r.polarity} class="pol" />{/if}
                Rank {r.rank}/8 · MR {r.mastery} · {r.rerolls ? `${r.rerolls} cycle${r.rerolls === 1 ? "" : "s"}` : "never cycled"}
              </span>
              {#if r.rerolls}<span class="meta dim small" title="Kuva its cycles have cost (counting any before it was yours), and what the next cycle costs"><GameIcon name="kuva" size={13} />{kuvaSpent(r.rerolls).toLocaleString("en")} in · next {cycleCost(r.rerolls).toLocaleString("en")}</span>{/if}
            </div>
            {@render grade(r.grade, true)}
          </header>
          <ul class="stats">
            {#each r.stats as s, i (i)}
              <li class:curse={!s.buff}>
                <b class="val">{s.display}</b><span class="lbl">{s.label}{#if s.spliced}<span class="tag ok" title="From Riven Splicing: it stays locked through cycles">spliced</span>{/if}</span>
                <span class="rbar" title="Roll {s.quality == null ? '?' : Math.round(s.quality * 100)}% of its range"><i style:width="{(s.quality ?? 0) * 100}%"></i></span>
                {@render grade(s.grade)}
              </li>
            {/each}
          </ul>
          {#if cycles[r.id]}
            {@const ch = cycles[r.id]}
            {#if ch.kept}
              <p class="cycle dim small">You cycled it and kept this roll.</p>
            {:else}
              <div class="cycle">
                <span class="register">Your previous roll</span>
                <span class="was"><span class="dim">{ch.prev.name}</span>{@render grade(ch.prev.grade)}<span class="arrow" class:up={(r.quality ?? 0) > (ch.prev.quality ?? 0)} class:down={(r.quality ?? 0) < (ch.prev.quality ?? 0)}>{(r.quality ?? 0) > (ch.prev.quality ?? 0) ? "▲ better roll" : (r.quality ?? 0) < (ch.prev.quality ?? 0) ? "▼ worse roll" : "same quality"}</span></span>
                <ul class="prev">{#each ch.prev.stats as s, i (i)}<li class:curse={!s.buff}><b>{s.display}</b> {s.label}</li>{/each}</ul>
              </div>
            {/if}
          {/if}
          {#if meta}
            {@const listed = auctionOf(meta, r, rivens.mine)}
            {@const f = sell[r.id]}
            {#if listed}
              {@const rp = reprice[listed.id]}
              <div class="selling on">
                <span class="register">On warframe.market</span>
                {#if rp}
                  <span class="plat"><input type="number" min="1" bind:value={rp.buyout} aria-label="New buyout price" /><GameIcon name="platinum" size={14} /></span>
                  <IconButton icon="check" tone="gold" label={rp.busy ? "Saving…" : "Save the new price"} disabled={rp.busy || !rp.buyout} onclick={() => savePrice(listed)} />
                  <IconButton icon="close" tone="quiet" label="Cancel" onclick={() => delete reprice[listed.id]} />
                  {#if rp.error}<span class="err small">{rp.error}</span>{/if}
                {:else}
                  <span>{#if listed.buyout != null}buyout <P v={listed.buyout} />{/if}{#if listed.starting < (listed.buyout ?? Infinity)}<span class="dim small"> · bids from {listed.starting}p</span>{/if}{#if listed.topBid != null}<span class="small"> · top bid <b>{listed.topBid}p</b></span>{/if}</span>
                  <span class="grow"></span>
                  <IconButton icon="pencil" tone="quiet" label="Change price" onclick={() => (reprice[listed.id] = { buyout: listed.buyout, busy: false, error: null })} />
                  <IconButton icon="stop" tone="danger quiet" label={closing === listed.id ? "Taking down…" : "Take down"} title="Take down: close the auction (it stays in your profile's closed auctions)" disabled={closing === listed.id} onclick={() => takeDown(listed)} />
                  {#if closeError[listed.id]}<span class="err small">{closeError[listed.id]}</span>{/if}
                {/if}
              </div>
            {:else if f}
              <form class="selling" onsubmit={(e) => { e.preventDefault(); void list(r); }}>
                <label><span class="register">Buyout</span><span class="plat"><input type="number" min="1" bind:value={f.buyout} aria-label="Buyout price" /><GameIcon name="platinum" size={14} /></span></label>
                <Chip bind:on={f.bids} label="Take bids from" title="Let buyers bid below the buyout, from a starting price" />
                {#if f.bids}<span class="plat"><input type="number" min="1" bind:value={f.starting} aria-label="Starting bid" /><GameIcon name="platinum" size={14} /></span>{/if}
                <button class="stamp gold" disabled={f.busy || !f.buyout}>{f.busy ? "Listing…" : "List it"}</button>
                <IconButton icon="close" tone="quiet" label="Cancel" onclick={() => delete sell[r.id]} />
                {#if pc?.lowest != null}<span class="dim small hint">Cheapest similar: {pc.lowest}p{pc.typical != null ? `, typical ${pc.typical}p` : ""}</span>{/if}
                {#if f.error}<span class="err small">{f.error}</span>{/if}
              </form>
            {/if}
          {/if}
          {#if rivens.trades}
            {@const tr = traded(r)}
            <p class="traded small">
              {#if tr?.same}<span title={tradeTitle(r, tr.same)}><span class="dim">Traded in game {rivens.tradesWeek ?? "last week"}</span> <b>~{tr.same.median == null ? "?" : fmtP(tr.same.median)}</b> <span class="dim">· {fmtP(tr.same.min)}–{fmtP(tr.same.max)}</span></span>{#if tr.other?.median != null}<span class="dim" title={tradeTitle(r, tr.other)}>{" · "}{tr.other.rerolled ? "cycled" : "never cycled"} ~{fmtP(tr.other.median)}</span>{/if}
              {:else if tr?.other}<span class="dim" title={tradeTitle(r, tr.other)}>No {r.rerolls ? "cycled" : "uncycled"} {r.weapon} rivens traded in game last week; {tr.other.rerolled ? "cycled" : "never cycled"} ones went for ~{tr.other.median == null ? "?" : fmtP(tr.other.median)}</span>
              {:else}<span class="dim" title="Digital Extremes' weekly figures list no in-game trade of a riven for this weapon last week: little demand">No {r.weapon} rivens traded in game last week</span>{/if}
            </p>
          {/if}
          <footer>
            {#if pc}
              {@const fl = c?.any ? priceCheck(c.any) : null}
              <span class="pcs">
                {#if fl}<span class="pc" title={fl.count ? `The cheapest ${r.weapon} riven listed right now, whatever its stats: what anyone can buy one for` : undefined}>{#if fl.count}<span class="dim small">Any {r.weapon} riven from</span><P v={fl.lowest} />{:else}<span class="dim small">No {r.weapon} rivens listed</span>{/if}</span>{/if}
                <span class="pc" title={pc.count ? `${pc.count} rivens with the same two best stats listed: the cheapest at ${pc.lowest}p, most around ${pc.typical}p. Asking prices: what they sell for isn't published` : undefined}>{#if pc.count}<span class="dim small">{pc.count} similar listed from</span><P v={pc.lowest} /><span class="dim small">· ~</span><P v={pc.typical} />{:else}<span class="dim small">None like it listed right now</span>{/if}</span>
              </span>
            {:else if c?.error}<span class="dim small">{c.error}</span>
            {:else if c?.loading}<span class="dim small">Checking prices…</span>
            {:else}<span class="dim small">Not price checked yet</span>{/if}
            <span class="grow"></span>
            <!-- The same three places on every card: check prices, sell, open on warframe.market. -->
            <IconButton icon={pc || c?.error ? "refresh" : "search"} tone="quiet" label={c?.loading ? "Checking…" : pc ? "Check again" : c?.error ? "Try again" : "Price check"} title={pc ? "Check again: find similar rivens for sale now" : "Price check: find similar rivens for sale"} disabled={!meta || c?.loading} onclick={() => check(r)} />
            {#if meta && auctionOf(meta, r, rivens.mine)}<span class="slot"></span>
            {:else}<IconButton icon="list" tone={sell[r.id] ? "gold" : "quiet"} label="Sell" title={!mkt.linked ? "Sign in to warframe.market on Orders first" : "Sell: put it up as an auction on warframe.market"} disabled={!meta || !mkt.linked || !!sell[r.id]} onclick={() => openSell(r, pc?.typical ?? pc?.lowest ?? null)} />{/if}
            <IconButton icon="external" tone="quiet" label="Similar rivens on warframe.market" onclick={() => openUrl(searchUrl(r))} />
          </footer>
        </article>
      {/each}
    </CardGrid>
    {#if !sorted.length}<p class="dim">No rivens match these filters. <button class="link" onclick={() => { kind = "all"; splicedOnly = false; query = ""; }}>Clear them</button></p>{/if}
  {/if}

  <section class="finder">
    <h2 class="register lead">Find a riven</h2>
    {#if !meta}
      <p class="dim small">{#if rivens.metaError}Couldn't load warframe.market's riven list ({rivens.metaError}); orbiter tries again each minute. <button class="link" onclick={() => void rivens.loadMeta()}>Try now</button>{:else}Loading warframe.market's riven list…{/if}</p>
    {:else}
      <div class="form">
        <input list="riven-weapons" placeholder="Weapon" bind:value={weaponName} aria-label="Weapon" />
        <datalist id="riven-weapons">{#each meta.weapons as w (w.slug)}<option value={w.name}></option>{/each}</datalist>
        {#each [0, 1, 2] as i (i)}
          {@const taken = takenBut(pos[i])}
          <select bind:value={pos[i]} aria-label="Wanted stat {i + 1}"><option value="">{i === 0 ? "Stat you want" : i === 1 ? "2nd stat (any)" : "3rd stat (any)"}</option>{#each attrsFor.filter((a) => !a.negativeOnly && !taken.has(a.slug)) as a (a.slug)}<option value={a.slug}>{a.name}</option>{/each}</select>
        {/each}
        <select bind:value={neg} aria-label="Curse"><option value="">Any curse or none</option>{#each attrsFor.filter((a) => !a.positiveOnly && !takenBut(neg).has(a.slug)) as a (a.slug)}<option value={a.slug}>−{a.name}</option>{/each}</select>
        <span class="plat"><input type="number" min="1" placeholder="Max price" bind:value={maxPrice} aria-label="Most you'd pay" /><GameIcon name="platinum" size={14} /></span>
        <span class="go">
          <button class="stamp" disabled={!weapon} onclick={find}><Icon name="search" />Search</button>
          <button class="stamp gold" disabled={!weapon || !maxPrice} title={!weapon || !maxPrice ? "Pick a weapon and the most you'd pay first" : "Get a notification when one is listed at or under your price (checked every 5 minutes)"} onclick={watch}><Icon name="bell" />Alert me</button>
        </span>
      </div>
      {#if weaponName && !weapon}<p class="dim small">Pick a weapon from the list.</p>{/if}
      {#if weapon && rivens.trades}
        {@const k = weapon.group === "archgun" ? "Archgun" : weapon.group === "kitgun" ? "Kitgun" : weapon.group === "zaw" ? "Zaw" : weapon.rivenType.charAt(0).toUpperCase() + weapon.rivenType.slice(1)}
        {@const t = tradesFor(rivens.trades, k, weapon.name, false)}
        <p class="small traded">
          {#if t.same || t.other}<span class="dim">{weapon.name} rivens traded in game last week:</span>
            {#each [t.same, t.other].filter((x): x is RivenTrade => !!x) as x, i (i)}{i ? " · " : " "}<span title="Digital Extremes' weekly figures for trades completed in game (1p trades left out); they don't say which stats sold"><span class="dim">{x.rerolled ? "cycled" : "never cycled"}</span> <b>~{x.median == null ? "?" : fmtP(x.median)}</b> <span class="dim">({fmtP(x.min)}–{fmtP(x.max)})</span></span>{/each}
          {:else}<span class="dim">No {weapon.name} rivens traded in game last week.</span>{/if}
        </p>
      {/if}
      {#if watchNote}<p class="dim small">{watchNote}</p>{/if}

      {#if settings.rivenWatch.length}
        <div class="watching">
          <span class="register">Watching</span>
          {#each settings.rivenWatch as w (w.id)}
            <span class="rule">{w.weaponName}{w.positive.length ? ` · ${w.positive.map(attrName).join(", ")}` : ""}{w.negative ? ` · −${attrName(w.negative)}` : ""} · ≤ {w.maxPrice}p<IconButton icon="close" tone="quiet" size={12} label="Stop watching" onclick={() => unwatch(w.id)} /></span>
          {/each}
        </div>
      {/if}

      {#if found}
        {#if found.loading}<p class="dim small">Searching…</p>
        {:else if found.error}<p class="dim small">{found.error}</p>
        {:else if !shownAuctions.length}<p class="dim small">Nothing listed{maxPrice ? ` at ${maxPrice}p or less` : ""} right now.</p>
        {:else}
          <table class="results">
            <thead><tr><th>Riven</th><th>Stats</th><th class="right">Roll</th><th class="right">Rank · rerolls</th><th>Seller</th><th class="right">Price</th></tr></thead>
            <tbody>
              {#each shownAuctions.slice(0, 30) as a (a.id)}
                {@const g = gradeAuction(meta, tables, found.weapon.slug, a)}
                <tr>
                  <td class="nowrap"><b class="name-mark">{found.weapon.name} {a.name}</b></td>
                  <td>{#each a.attributes as x, i (i)}<span class="att" class:curse={!x.positive}>{x.value > 0 && x.positive ? "+" : ""}{x.value}{meta.attributes.find((m) => m.slug === x.url_name)?.unit === "percent" ? "%" : ""} {attrName(x.url_name)}{#if g}<em>{g.grades[i]}</em>{/if}</span>{/each}</td>
                  <td class="right">{#if g}{@render grade(g.grade)}{/if}</td>
                  <td class="right dim small nowrap">R{a.rank} · {a.rerolls}</td>
                  <td class="nowrap"><span class="st st-{a.status}">{statusLabel[a.status] ?? a.status}</span> {a.seller}</td>
                  <td class="right"><P v={a.price} /></td>
                </tr>
              {/each}
            </tbody>
          </table>
          <p class="dim small">Rolls are worked out from the numbers sellers typed in; "?" means a number the riven couldn't have rolled (often a listing from before the disposition change).</p>
        {/if}
      {/if}
    {/if}
  </section>
</div></div>

<style>
  .selling { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem .8rem; padding: .6rem .7rem; margin-top: .6rem; border: 1px solid var(--rule-bright); background: var(--well); }
  .selling.on { border-color: color-mix(in srgb, var(--verdigris) 45%, transparent); box-shadow: inset 2px 0 0 var(--verdigris); }
  .selling label { display: inline-flex; align-items: center; gap: .45rem; }
  .selling input[type="number"] { width: 6.5rem; }
  /* One height for the form's fields and buttons. */
  .selling input, .selling :global(button:not(.link)) { height: 34px; }
  .selling .stamp { padding-top: 0; padding-bottom: 0; }
  .selling :global(.ib) { --ib: 34px; }
  .selling .plat { display: inline-flex; align-items: center; gap: .3rem; }
  .selling .hint { flex-basis: 100%; }
  .err { color: var(--oxblood); flex-basis: 100%; }
  .note { margin: var(--step) 0; }
  .riven { display: flex; flex-direction: column; border: 1px solid var(--rule); background: linear-gradient(180deg, #17141d, var(--plate) 45%); clip-path: var(--cut); padding: .8rem .9rem .6rem; gap: .6rem; }
  .explain { max-width: 75ch; }
  .riven header { display: grid; grid-template-columns: auto 1fr auto; gap: .7rem; align-items: start; }
  .t { display: grid; gap: .25rem; min-width: 0; }
  .t .register { font-size: .6rem; color: #a78bd4; }
  .t h3 { font-size: 1.15rem; line-height: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .meta { display: inline-flex; align-items: center; gap: .35rem; }
  .pol { width: 14px; height: 14px; opacity: .85; }
  .stats { list-style: none; margin: 0; padding: 0; display: grid; gap: .3rem; }
  .stats li { display: grid; grid-template-columns: 4.6rem 1fr 4rem 2rem; gap: .5rem; align-items: center; font-size: .84rem; }
  .val { font-family: var(--face-mark); font-size: 1rem; color: var(--verdigris); font-variant-numeric: tabular-nums; }
  .curse .val { color: var(--oxblood); }
  .lbl { color: var(--platinum-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rbar { height: 4px; background: var(--rule); border-radius: 2px; overflow: hidden; }
  .rbar i { display: block; height: 100%; background: var(--platinum-dim); }
  .cycle { margin: 0; padding: .5rem .6rem; border: 1px dashed var(--rule-bright); display: grid; gap: .3rem; }
  .cycle .register { font-size: .6rem; }
  .was { display: flex; align-items: center; gap: .45rem; font-size: .84rem; }
  .arrow { margin-left: auto; font-family: var(--face-register); font-size: .6rem; letter-spacing: .1em; text-transform: uppercase; color: var(--platinum-deep); }
  .arrow.up { color: var(--verdigris); }
  .arrow.down { color: var(--oxblood); }
  .prev { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: .15rem .8rem; font-size: .76rem; color: var(--platinum-dim); }
  .prev b { color: var(--platinum); font-weight: 600; }
  .prev .curse b { color: var(--oxblood); }
  /* Cards in a row share a height; the footer sits at the bottom of each. */
  .riven footer { margin-top: auto; display: flex; align-items: center; gap: .35rem; padding-top: .5rem; border-top: 1px solid var(--rule); min-height: 1.6rem; }
  .riven footer .slot { width: 30px; }
  .traded { margin: 0; line-height: 1.4; }
  .traded b { color: var(--platinum); font-family: var(--face-mark); font-size: .95rem; }
  .pcs { display: grid; gap: .15rem; min-width: 0; }
  .pc { display: inline-flex; align-items: center; gap: .35rem; flex-wrap: wrap; }
  .grow { flex: 1; }
  .grade { font-family: var(--face-mark); font-weight: 700; font-size: .9rem; text-align: center; min-width: 1.8rem; color: var(--platinum-dim); }
  .grade.big { font-size: 1.9rem; min-width: 2.6rem; }
  .g-S { color: var(--gold); }
  .g-Ap, .g-A, .g-Am { color: var(--verdigris); }
  .g-Cp, .g-C, .g-Cm, .g-F { color: var(--oxblood); }
  .finder { margin-top: var(--course); }
  .finder h2 { margin: 0 0 .8rem; }
  /* Four even columns, so the second row lines up under the first. */
  .form { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: .5rem; align-items: center; }
  .form > input, .form > select { width: 100%; min-height: 36px; }
  /* The platinum mark sits inside the field, so this column is as wide as the one above it. */
  .form .plat { position: relative; }
  .form .plat input { flex: 1; min-width: 0; width: auto; min-height: 36px; padding-right: 2rem; }
  .form .plat > :global(:last-child) { position: absolute; right: .7rem; pointer-events: none; }
  .form .go { grid-column: span 2; display: flex; gap: .5rem; justify-content: flex-end; }
  .form .go .stamp { display: inline-flex; align-items: center; gap: .5rem; height: 36px; }
  /* Page area under 760 px (App sets the flag, by the room pages actually have). */
  :global(html[data-room~="lt760"]) .form { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .plat { display: inline-flex; align-items: center; gap: .35rem; }
  .watching { display: flex; flex-wrap: wrap; gap: .45rem; align-items: center; margin-top: .9rem; }
  .rule { display: inline-flex; align-items: center; gap: .3rem; padding: .1rem .1rem .1rem .55rem; border: 1px solid var(--gold-dim); font-size: .8rem; }
  .rule :global(.ib) { --ib: 22px; }
  .results { width: 100%; border-collapse: collapse; margin-top: 1rem; font-variant-numeric: tabular-nums; }
  .results th { text-align: left; font-family: var(--face-register); font-weight: 500; font-size: .6rem; letter-spacing: .14em; text-transform: uppercase; color: var(--platinum-deep); padding: .45rem .5rem; border-bottom: 1px solid var(--rule); }
  .results td { padding: .5rem; border-bottom: 1px solid var(--rule); vertical-align: middle; }
  .right { text-align: right; }
  .nowrap { white-space: nowrap; }
  .att { display: inline-flex; gap: .25rem; align-items: baseline; margin-right: .7rem; font-size: .8rem; color: var(--verdigris); white-space: nowrap; }
  .att.curse { color: var(--oxblood); }
  .att em { font-style: normal; font-family: var(--face-register); font-size: .6rem; color: var(--platinum-deep); }
  .st { font-family: var(--face-register); font-size: .6rem; letter-spacing: .1em; text-transform: uppercase; color: var(--platinum-deep); }
  .st-ingame { color: var(--verdigris); }
  .st-online { color: var(--gold); }
  .checking { display: inline-flex; align-items: center; gap: .6rem; }
  .steps { margin: .2rem 0 .6rem; padding-left: 1.2rem; display: grid; gap: .2rem; }
  /* A riven mid-cycle: the two rolls side by side, the one to keep lit. */
  .cycling { display: grid; gap: .8rem; margin-bottom: var(--step); }
  .choice { border: 1px solid var(--gold-dim); background: var(--plate); padding: .9rem 1rem; display: grid; gap: .6rem; }
  .choice header { display: flex; align-items: center; gap: .6rem; flex-wrap: wrap; }
  .choice header b { font-size: 1.1rem; }
  .choice p { margin: 0; color: var(--platinum-dim); }
  .verdict { margin-left: auto; padding: .2rem .55rem; font-family: var(--face-register); font-size: .62rem; letter-spacing: .12em; text-transform: uppercase; border: 1px solid var(--rule-bright); }
  .verdict.v-take { color: var(--slab); background: var(--gold); border-color: var(--gold); }
  .verdict.v-keep { color: var(--verdigris); border-color: color-mix(in srgb, var(--verdigris) 55%, transparent); }
  .rolls { display: grid; grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr)); gap: .8rem; }
  .roll { display: grid; gap: .35rem; padding: .6rem .7rem; border: 1px solid var(--rule); background: var(--well); }
  .roll.win { border-color: var(--gold); box-shadow: inset 3px 0 0 var(--gold); }
  .roll .rn { display: flex; align-items: center; gap: .5rem; }
  .roll ul { list-style: none; margin: 0; padding: 0; display: grid; gap: .2rem; font-size: .84rem; color: var(--platinum-dim); }
  .roll li b { color: var(--platinum); font-weight: 600; }
  .roll li.curse b { color: var(--oxblood); }
</style>
