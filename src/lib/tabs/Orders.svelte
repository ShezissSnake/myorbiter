<script lang="ts">
  import type { Model } from "../core/model";
  import type { AdviceSettings, MarketSettings } from "../backend";
  import { heldFor, holdings, listingKey, overAsked, wtsLines, type MyOrder, type Plan } from "../core/market";
  import { LISTING_LIMIT } from "../core/bulk";
  import { arcaneRows, spareOf } from "../core/views";
  import { aboveCrack, relicCrackFor } from "../core/spares";
  import { mkt } from "../marketStore.svelte";
  import PageHead from "../ui/PageHead.svelte";
  import Stat from "../ui/Stat.svelte";
  import Named from "../ui/Named.svelte";
  import P from "../ui/P.svelte";
  import Chip from "../ui/Chip.svelte";
  import Seg from "../ui/Seg.svelte";
  import Presence from "../ui/Presence.svelte";
  import Toggle from "../ui/Toggle.svelte";
  import SpareSale from "../ui/SpareSale.svelte";
  import Metal from "../ui/Metal.svelte";
  import Icon from "../ui/Icon.svelte";
  import IconButton from "../ui/IconButton.svelte";
  import PriceHistory from "../ui/PriceHistory.svelte";
  import { rivens } from "../rivenStore.svelte";
  import { openUrl } from "../backend";
  import type { MyAuction } from "../core/rivens";

  // console: you play on a console or phone, so orbiter can't see what you hold. New listing then
  // finds anything warframe.market trades, and what needs your inventory (spares, "Can't deliver") is left out.
  let { model, settings = $bindable(), advice, console = false }: { model: Model; settings: MarketSettings; advice: AdviceSettings; console?: boolean } = $props();
  // Arcanes you're still collecting copies of to max: an unranked listing of one works against that.
  const collecting = $derived(console ? new Map<string, { copies: number; needed: number }>() : new Map(arcaneRows(model).filter((a) => !a.complete && a.copies > 0).map((a) => [a.name, { copies: a.copies, needed: a.needed }])));

  let email = $state("");
  let password = $state("");
  let token = $state("");
  let how = $state<"password" | "token">("password");
  let search = $state("");

  const orders = $derived([...mkt.orders].sort((a, b) => (mkt.item(a.itemId)?.name ?? "").localeCompare(mkt.item(b.itemId)?.name ?? "")));
  const listed = $derived(orders.filter((o) => o.visible).reduce((n, o) => n + o.platinum * o.quantity, 0));
  const plans = $derived(new Map(orders.map((o) => [o.id, mkt.planFor(model, settings, o)])));
  const hiddenOrders = $derived(orders.filter((o) => !o.visible));
  const pending = $derived(orders.filter((o) => o.visible && !settings.paused[listingKey(o)] && plans.get(o.id)?.change).length);
  const nextPass = $derived((settings.auto || settings.autoCheck) && mkt.lastPass ? new Date(mkt.lastPass + settings.every * 60_000) : null);
  /** Oldest order book behind what's on screen, so you know how fresh "Cheapest in game" is. */
  const checkedAt = $derived.by(() => {
    const times = orders.map((o) => mkt.books[mkt.item(o.itemId)?.slug ?? ""]?.at).filter((t): t is number => t != null);
    return times.length ? Math.min(...times) : null;
  });

  // New listing: anything tradable you hold, searchable. On a console: anything tradable.
  const sellable = $derived.by(() => {
    if (!mkt.items.length) return [];
    if (console) return mkt.items.map((it) => ({ it, held: 0 }));
    return mkt.items
      .map((it) => ({ it, held: (holdings(model, it) ?? []).reduce((n, h) => n + h.count, 0) }))
      .filter((x) => x.held > 0)
      .sort((a, b) => a.it.name.localeCompare(b.it.name));
  });
  // Names that start with what you typed first, then the ones you hold most of; with what you can spare.
  const matches = $derived.by(() => {
    const q = search.trim().toLowerCase();
    if (q.length < 2) return [];
    if (console) {
      return sellable
        .filter((x) => x.it.name.toLowerCase().includes(q))
        .sort((a, b) => Number(b.it.name.toLowerCase().startsWith(q)) - Number(a.it.name.toLowerCase().startsWith(q)) || a.it.name.length - b.it.name.length || a.it.name.localeCompare(b.it.name))
        .slice(0, 10)
        .map((x) => ({ ...x, spare: null }));
    }
    return sellable
      .filter((x) => x.it.name.toLowerCase().includes(q))
      .sort((a, b) => Number(b.it.name.toLowerCase().startsWith(q)) - Number(a.it.name.toLowerCase().startsWith(q)) || b.held - a.held)
      .slice(0, 40)
      .map((x) => ({ ...x, spare: spareOf(model, x.it.name, x.it.tags) }))
      // Things you can actually spare first.
      .sort((a, b) => Number((b.spare?.quantity ?? b.held) > 0) - Number((a.spare?.quantity ?? a.held) > 0))
      .slice(0, 10);
  });

  // The results follow the arrow keys, Enter picks, Esc or a click elsewhere closes them.
  let searchOpen = $state(false);
  let active = $state(0);
  let searchBox = $state<HTMLElement | null>(null);
  function pick(x: (typeof matches)[number]) {
    const sp = x.spare;
    mkt.startListing(model, x.it.name, sp ? { unique: x.it.gameRef, rank: sp.rank, quantity: sp.quantity } : { unique: x.it.gameRef });
    search = "";
  }
  function searchKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      if (search) e.stopPropagation();
      search = "";
      return;
    }
    if (!matches.length || !searchOpen) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      active = (active + (e.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length;
    } else if (e.key === "Enter") {
      e.preventDefault();
      const x = matches[active];
      if (x) pick(x);
    }
  }
  function outside(e: PointerEvent) {
    if (searchOpen && searchBox && !searchBox.contains(e.target as Node)) searchOpen = false;
  }

  // What you hold of each listing (as of TennoScope's last read): a listing for more than you
  // have, or for something you no longer have, sells what you can't deliver.
  function stock(o: MyOrder): number | null {
    const it = mkt.item(o.itemId);
    return it ? heldFor(model, it, o) : null;
  }
  const short = $derived(orders.filter((o) => { const n = stock(o); return n != null && n < o.quantity; }));
  // Counted like Home and the notices: a hidden listing can't be bought, so it can't let anyone down.
  const shortShown = $derived(short.filter((o) => o.visible).length);

  const rankLabel = (o: { rank: number | null; subtype: string | null }) =>
    [o.rank != null ? `R${o.rank}` : null, o.subtype].filter(Boolean).join(" · ");

  function setFloor(o: MyOrder, v: string) {
    const n = Math.round(Number(v));
    const key = listingKey(o);
    const floors = { ...settings.floors };
    if (!v || !Number.isFinite(n) || n <= 0) delete floors[key];
    else floors[key] = n;
    settings.floors = floors;
  }
  function togglePause(o: MyOrder) {
    const key = listingKey(o);
    settings.paused = { ...settings.paused, [key]: !settings.paused[key] };
  }
  // Quantity and price change a live listing, so an edit is held (gold) until you press Enter or
  // Save; Esc or Undo puts the listing's value back.
  let edits = $state<Record<string, { quantity?: string; platinum?: string }>>({});
  const whole = (v: string | undefined) => {
    const n = Math.round(Number(v));
    return v != null && v.trim() !== "" && Number.isFinite(n) && n > 0 ? n : null;
  };
  function changeOf(o: MyOrder): { quantity?: number; platinum?: number } | null {
    const e = edits[o.id];
    if (!e) return null;
    const out: { quantity?: number; platinum?: number } = {};
    const q = whole(e.quantity);
    const pr = whole(e.platinum);
    if (q != null && q !== o.quantity) out.quantity = q;
    if (pr != null && pr !== o.platinum) out.platinum = pr;
    return Object.keys(out).length ? out : null;
  }
  function edit(o: MyOrder, field: "quantity" | "platinum", v: string) {
    edits[o.id] = { ...edits[o.id], [field]: v };
    // Held back from the repricer only while there's an actual change waiting.
    if (changeOf(o)) mkt.editing.add(o.id);
    else mkt.editing.delete(o.id);
  }
  // Your shown listings as trade chat lines (core/market.ts, wtsLines); each press copies the next.
  const wts = $derived(wtsLines(mkt.orders.filter((o) => o.visible).map((o) => ({ name: mkt.item(o.itemId)?.name ?? o.itemId, rank: o.rank, platinum: o.platinum }))));
  let wtsNext = 0;
  let wtsCopied = $state<string | null>(null);
  async function copyWts() {
    const i = wtsNext % wts.length;
    try {
      await navigator.clipboard.writeText(wts[i]);
      wtsCopied = wts.length > 1 ? `Copied line ${i + 1} of ${wts.length}: paste it in trade chat` : "Copied: paste it in trade chat";
      wtsNext = i + 1;
    } catch {
      wtsCopied = "Couldn't copy";
    }
    const was = wtsCopied;
    setTimeout(() => wtsCopied === was && (wtsCopied = null), 3000);
  }
  function revert(o: MyOrder) {
    delete edits[o.id];
    mkt.editing.delete(o.id);
  }
  async function save(o: MyOrder) {
    if (overHeld(o)) return;
    const change = changeOf(o);
    // Refused (or warframe.market turned orbiter away): what you typed stays, to save again.
    if (change && !(await mkt.update(o, change))) return;
    revert(o);
  }
  /** A quantity over what you hold can't be delivered: refused, as the List form refuses it. */
  /** What it really goes for, when every in-game seller asks more than twice that (the listing follows it instead). */
  function goesFor(p: Plan): number | null {
    return p.competitor.price != null && p.value != null && overAsked(p.competitor.price, p.value) != null ? Math.round(p.value * 10) / 10 : null;
  }

  /** A relic held up by what a crack of it is worth: what that crack is worth. */
  function crackHeld(o: MyOrder, p: Plan): number | null {
    if (p.reason !== "floor") return null;
    const it = mkt.item(o.itemId);
    if (!it?.tags?.includes("relic")) return null;
    const crack = relicCrackFor(model, it.name, o.subtype ?? it.subtypes?.[0] ?? null, mkt.advice?.platPerDucat ?? 0, mkt.advice?.squad ?? 1);
    return crack != null && aboveCrack(crack) === p.floor ? crack : null;
  }

  function overHeld(o: MyOrder): string | null {
    const q = changeOf(o)?.quantity;
    const held = stock(o);
    if (q == null || held == null || q <= held) return null;
    return `You hold ${held}${o.rank != null ? " at this rank" : o.subtype ? " of this variant" : ""}: you can't list more than that.`;
  }
  function editKey(o: MyOrder, e: KeyboardEvent) {
    if (e.key === "Enter") {
      if (!overHeld(o)) save(o);
    }
    else if (e.key === "Escape") {
      e.stopPropagation();
      revert(o);
    }
  }
  // Edits that never got saved don't hold the repricer back once the page is gone.
  $effect(() => () => {
    for (const id of Object.keys(edits)) mkt.editing.delete(id);
  });
  // Your riven auctions: warframe.market keeps them apart from listings (Rivens has the same, per riven).
  $effect(() => {
    void mkt.ordersAt;
    if (!mkt.linked) return;
    void rivens.loadMeta();
    void rivens.loadMine();
  });
  const auctions = $derived(rivens.mine.filter((a) => !a.closed));
  const weaponOf = (a: MyAuction) => rivens.meta?.weapons.find((w) => w.slug === a.weapon);
  const auctionTitle = (a: MyAuction) => `${weaponOf(a)?.name ?? a.weapon.replace(/_/g, " ")} ${a.name.replace(/(^|-)\p{L}/gu, (c) => c.toUpperCase())}`;
  let auctionPrice = $state<{ id: string; buyout: number | null; busy: boolean; error: string | null } | null>(null);
  let auctionBusy = $state<string | null>(null);
  let auctionError = $state<string | null>(null);
  async function saveAuctionPrice(a: MyAuction) {
    const f = auctionPrice;
    if (!f || !f.buyout) return;
    const buyout = Math.round(f.buyout);
    f.busy = true;
    f.error = null;
    try {
      // No bidding stays no bidding; bids from where they were, never above the new buyout; hidden stays hidden.
      await rivens.reprice(a, buyout);
      auctionPrice = null;
    } catch (e) {
      f.error = String(e).replace(/^Error:\s*/, "");
      f.busy = false;
    }
  }
  async function takeDownAuction(a: MyAuction) {
    auctionBusy = a.id;
    auctionError = null;
    try {
      await rivens.close(a);
    } catch (e) {
      auctionError = String(e).replace(/^Error:\s*/, "");
    } finally {
      auctionBusy = null;
    }
  }
  /** Remove asks twice: the listing (and its place in the queue) is gone for good. */
  let removing = $state<string | null>(null);
  /** The listing whose "Sold" box is open, and how many. */
  let selling = $state<{ id: string; n: number } | null>(null);
  /** Sign out asks first: listing and repricing stop until you sign in again. */
  let signingOut = $state(false);
  // A confirm takes the focus on its safe choice, so Esc (or Enter) keeps things as they are.
  const focusIt = (node: HTMLInputElement | HTMLButtonElement) => {
    node.focus();
    if (node instanceof HTMLInputElement) node.select();
  };
  const onEsc = (undo: () => void) => (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    undo();
  };
  // Sold waits a few seconds, with Undo, before it's sent: marking sold on warframe.market goes on
  // your profile and lowers or closes the listing, which a slip of the mouse shouldn't do.
  const SOLD_WAIT = 4000;
  let pendingSold = $state<Record<string, number>>({});
  const soldTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Each listing's quantity when you clicked Sold. */
  const soldFrom = new Map<string, number>();
  function recordSale(o: MyOrder, n: number) {
    if (n < 1 || n > o.quantity) return;
    selling = null;
    clearTimeout(soldTimers.get(o.id));
    pendingSold = { ...pendingSold, [o.id]: n };
    soldFrom.set(o.id, o.quantity);
    soldTimers.set(o.id, setTimeout(() => void commitSale(o.id), SOLD_WAIT));
  }
  function undoSale(id: string) {
    clearTimeout(soldTimers.get(id));
    soldTimers.delete(id);
    const { [id]: _, ...rest } = pendingSold;
    pendingSold = rest;
  }
  async function commitSale(id: string) {
    const n = pendingSold[id];
    undoSale(id);
    const o = mkt.orders.find((x) => x.id === id);
    if (!o || !n) return;
    // The game's trade log got there first while Undo was showing: it already marked copies sold
    // (the listing shrank since you clicked) and recorded the sale. Only what's left is yours.
    const already = Math.max(0, (soldFrom.get(id) ?? o.quantity) - o.quantity);
    soldFrom.delete(id);
    if (n - already < 1) return;
    const sale = await mkt.sold(o, Math.min(n - already, o.quantity));
    if (sale) settings.sales = [sale, ...settings.sales].slice(0, 2000);
  }
  // Leaving the page (or quitting) doesn't lose a sale that was waiting.
  $effect(() => () => {
    for (const id of soldTimers.keys()) void commitSale(id);
  });
  const fmt = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  /** The listing whose price history is open under its row. */
  let charted = $state<string | null>(null);
</script>

<svelte:window onpointerdown={outside} />

<div class="page"><div class="page-inner">
  <PageHead title="Orders" blurb="Your warframe.market listings, kept at the cheapest in-game price." band={mkt.linked ? band : undefined} />
  {#snippet band()}
      <Stat label="Listed value" note="Visible listings, price × quantity"><P v={listed} big /></Stat>
      <Stat label="Listings" tone={mkt.room <= 0 ? "gold" : "platinum"} note={`${mkt.room <= 0 ? "At warframe.market's limit" : `${mkt.room} more allowed`} · ${orders.filter((o) => !o.visible).length} hidden`}>{orders.length}<span class="of">/{LISTING_LIMIT - mkt.otherOrders}</span></Stat>
      {#if !console}<Stat label="Can't deliver" tone={shortShown ? "gold" : "dim"} note={shortShown ? `Listing more than you hold${short.length > shortShown ? ` (+${short.length - shortShown} hidden)` : ""}` : short.length ? `Only in hidden listings (${short.length}), which nobody can buy` : "You hold everything you list"}>{shortShown}</Stat>{/if}
      <Stat label="To reprice" tone={pending ? "gold" : "dim"} note={checkedAt ? `${pending ? "Off the cheapest in-game price" : "All match"} · checked ${fmt(checkedAt)}` : "Press Check prices to compare"}>{pending}</Stat>
  {/snippet}

  <section class="status">
    {#if mkt.linked}
      <span class="register">Your status</span>
      <div class="presence"><Presence {settings} /></div>
    {/if}
    <div class="grow"></div>
    {#if mkt.linked}
      <span class="account">
        <span class="who register" title={`orbiter's own sign-in to warframe.market; the token is kept in ${mkt.account?.backing === "keyring" ? "the system keyring" : "a private file"}`}>Signed in as <strong>{mkt.me?.ingameName ?? "?"}</strong></span>
        <IconButton icon="refresh" tone="quiet" label={mkt.op === "Reloading" ? "Reloading…" : "Reload"} title="Fetch your listings from warframe.market again" disabled={!!mkt.busy} onclick={() => mkt.reload()} />
        {@render signOut()}
      </span>
    {/if}
  </section>

  {#snippet signOut()}
    <span class="out">
      {#if signingOut}
        <span class="small">Sign out of warframe.market? Listing and repricing stop until you sign in again.</span>
        <button class="danger" onclick={() => { signingOut = false; mkt.signOut(); }} onkeydown={onEsc(() => (signingOut = false))}>Sign out</button>
        <button class="link quiet" onclick={() => (signingOut = false)} onkeydown={onEsc(() => (signingOut = false))} use:focusIt>Stay signed in</button>
      {:else}
        <IconButton icon="sign-out" tone="quiet" label="Sign out" title="Sign out: forget orbiter's warframe.market sign-in" onclick={() => (signingOut = true)} />
      {/if}
    </span>
  {/snippet}

  {#if mkt.error}<div class="alert">{mkt.error}</div>{/if}

  {#if mkt.accountError}
    <section class="panel">
      {#if mkt.signInRefused}
        <h2 class="mark">warframe.market refused the sign-in</h2>
        <p class="prose">It no longer accepts orbiter's sign-in (it expired, or was signed out elsewhere). Sign out, then sign in again: listing and repricing wait until you do.</p>
        <div class="row"><button class="stamp" onclick={() => mkt.signOut()}>Sign out</button></div>
      {:else}
        <h2 class="mark">Can't reach warframe.market</h2>
        <p class="prose">You're signed in, but warframe.market didn't answer: {mkt.accountError}. orbiter tries again every minute; your listings and the repricer come back on their own.</p>
        <div class="row"><button class="stamp" disabled={!!mkt.busy} onclick={() => mkt.init()}>Try again now</button>{@render signOut()}</div>
      {/if}
    </section>
  {:else if !mkt.linked}
    <section class="panel signin">
      <h2 class="mark">Sign in to warframe.market</h2>
      <p class="prose">{console ? "orbiter signs in to warframe.market itself." : "orbiter keeps its own sign-in, separate from TennoScope's."} The token goes into your system keyring; the password is sent to warframe.market once and never stored.</p>
      <Seg bind:value={how} options={[{ v: "password", label: "Email & password" }, { v: "token", label: "Paste a token" }]} />
      {#if how === "password"}
        <form class="row" onsubmit={(e) => { e.preventDefault(); mkt.signIn(email, password).then(() => (password = "")); }}>
          <input type="email" placeholder="Email" bind:value={email} autocomplete="username" />
          <input type="password" placeholder="Password" bind:value={password} autocomplete="current-password" />
          <button class="stamp" disabled={!email || !password || !!mkt.busy}>{mkt.busy ?? "Sign in"}</button>
        </form>
      {:else}
        <form class="row" onsubmit={(e) => { e.preventDefault(); mkt.useToken(token).then(() => (token = "")); }}>
          <input class="wide" type="password" placeholder="JWT token from a signed-in browser" bind:value={token} />
          <button class="stamp" disabled={!token || !!mkt.busy}>{mkt.busy ?? "Use token"}</button>
        </form>
        <p class="dim small">In a browser signed in to warframe.market: developer tools → Storage → Cookies → copy the value of <code>JWT</code>.</p>
      {/if}
    </section>
  {:else}

    <!-- Your listings first, with where to add one right beside the heading. -->
    <div class="listhead">
      <h2 class="register yours">Your listings</h2>
      {#if wts.length}<button class="link wts" title={`Copy your shown listings as a trade chat line, to post in game too:\n${wts[0]}${wts.length > 1 ? `\n(${wts.length} lines: each press copies the next)` : ""}`} onclick={copyWts}>{wtsCopied ?? (wts.length > 1 ? `Copy trade-chat line 1 of ${wts.length}` : "Copy trade-chat line")}</button>{/if}
      <section class="newlisting" aria-label="New listing">
        <span class="register">New listing</span>
        <span class="searchbox" bind:this={searchBox}><input type="search" placeholder={console ? "Find anything to sell…" : "Find something you own…"} bind:value={search} aria-label={console ? "Find anything to sell" : "Find something you own"}
          oninput={() => { searchOpen = true; active = 0; }} onfocus={() => (searchOpen = true)} onkeydown={searchKey} />
        {#if matches.length && searchOpen}<div class="results">
            {#each matches as x, i (x.it.id)}
              <button class="pick" class:active={i === active} tabindex="-1" onpointerenter={() => (active = i)} onclick={() => pick(x)}>
                <Named file={model.imageOf(x.it.name.replace(/ Set$/, ""))} name={x.it.name} size={26} />
                {#if !console}<span class="dim small">{x.spare ? `${x.spare.quantity} spare of ${x.held}` : `you hold ${x.held}`}</span>{/if}
              </button>
            {/each}
          </div>{/if}</span>
        {#if console && (!matches.length || !searchOpen)}<span class="dim small hint">Type a name, pick it, then set how many you have to sell and the price.</span>
        {:else if !matches.length || !searchOpen}<span class="dim small hint">or the <Icon name="list" size={13} /> on any card or row in Inventory, Sets, Prime parts, Arcanes, Mods or Relics.</span>{/if}

      </section>
    </div>
    <div class="bar tools">
      <div class="grp">
        <button class="stamp" disabled={!!mkt.busy} onclick={() => mkt.reprice(model, settings, false)} title="Read the order books and show, per listing below, what it would be repriced to">{mkt.pass === "Checking prices" ? "Checking…" : "Check prices"}</button>
        <button class="stamp gold" disabled={!!mkt.busy || !pending} title={pending ? `Send the new prices to warframe.market: the ${pending} listing${pending === 1 ? "" : "s"} with a Will set` : "Nothing to change: Check prices first, or every listing matches already"} onclick={() => mkt.reprice(model, settings, true)}>{mkt.pass === "Repricing" ? "Applying…" : pending ? `Reprice ${pending}` : "Reprice"}</button>
      </div>
      <div class="grp">
        <Chip bind:on={settings.autoCheck} label="Check automatically" title="Read the order books on a timer while orbiter is open, and show what each listing would change to" onchange={(on) => { if (!on) settings.auto = false; }} />
        <Chip bind:on={settings.auto} label="Apply automatically" title="Also send the new prices to warframe.market on that timer, as Reprice would" onchange={(on) => { if (on) settings.autoCheck = true; }} />
        <select bind:value={settings.every} aria-label="How often" title="How often the automatic check runs" disabled={!settings.autoCheck && !settings.auto}>
          {#each [1, 2, 5, 10, 15, 30, 60] as m (m)}<option value={m}>every {m} min</option>{/each}
        </select>
      </div>
      <div class="grp">
        <span class="register">Floor</span>
        <select bind:value={settings.minShare} aria-label="Floor" title="Never price a listing under this share of the item's daily market price (a per-listing floor in the table wins)">
          {#each [0, 0.3, 0.5, 0.7, 0.85] as f (f)}<option value={f}>{f ? `${f * 100}% of market` : "none"}</option>{/each}
        </select>
        <span class="register" title="Nothing is listed or repriced below this, anywhere in orbiter (relics have their own minimum)">never under</span>
        <input class="minp" type="number" min="1" inputmode="numeric" value={settings.minPrice} aria-label="Minimum price" onchange={(e) => (settings.minPrice = Math.max(1, Math.round(Number(e.currentTarget.value)) || 1))} onwheel={(e) => e.currentTarget.blur()} />
        <Metal kind="plat" size={14} />
        <span class="register" title="Relics sell for a few platinum each and go in stacks: the lowest a relic is listed or repriced at">relics</span>
        <input class="minp" type="number" min="1" inputmode="numeric" value={settings.minRelicPrice} aria-label="Minimum relic price" onchange={(e) => (settings.minRelicPrice = Math.max(1, Math.round(Number(e.currentTarget.value)) || 1))} onwheel={(e) => e.currentTarget.blur()} />
        <Metal kind="plat" size={14} />
      </div>
      {#if nextPass}<span class="register next">Next check {fmt(+nextPass)}</span>{/if}
      {#if hiddenOrders.length}<button class="link quiet" disabled={!!mkt.busy} title="Make every hidden listing visible to buyers again" onclick={() => mkt.setShown(hiddenOrders, true)}>Show all {hiddenOrders.length} hidden</button>{/if}
      {#if !console}<a class="link quiet tospares" href="#spares" title="Down to Put my spares on sale: list everything you can spare in one go" onclick={(e) => { e.preventDefault(); document.getElementById("spares")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>Put my spares on sale ↓</a>{/if}
    </div>

    <table class="orders">
      <thead>
        <tr>
          <th>Item</th><th class="right">Qty</th><th class="right">Your price</th><th title="The cheapest seller who is in game right now (and how many are), from the last check">Cheapest in game</th>
          <th class="right willset" title="What the repricer would change the price to, and why">Will set</th><th class="right floorcol" title="Never go below this">Floor</th><th class="center" title="Auto-price on: when you check prices, this listing is moved to the cheapest in-game seller's price (never under its floor). Off: orbiter leaves its price as you set it">Auto-price</th><th class="center" title="Whether buyers see the listing on warframe.market (hidden ones keep their place)">Shown</th><th></th>
        </tr>
      </thead>
      <tbody>
        {#each orders as o (o.id)}
          {@const it = mkt.item(o.itemId)}
          {@const p = plans.get(o.id)}
          {@const paused = settings.paused[listingKey(o)]}
          {@const held = stock(o)}
          {@const change = changeOf(o)}
          <tr class="order" class:hidden={!o.visible}>
            <td class="fade c-item">
              <Named file={model.imageOf(it?.name ?? "")} name={it?.name ?? o.itemId}>
                {#if it}<button type="button" class="charted" class:on={charted === o.id} aria-label="Price history" aria-expanded={charted === o.id} title="What it sold for over the last 90 days, against your price" onclick={() => (charted = charted === o.id ? null : o.id)}><Icon name="chart" size={13} /></button>{/if}
                {#if rankLabel(o)}<span class="tag">{rankLabel(o)}</span>{/if}
                {#if it && collecting.has(it.name) && !o.rank}{@const c = collecting.get(it.name)!}<span class="tag ok" title="You're collecting copies to max it ({c.copies} of {c.needed}, on Arcanes): selling these sets you back">still collecting</span>{/if}
                {#if held === 0}<span class="tag warn" title="As of TennoScope's last read of your inventory">you have none</span>
                {:else if held != null && held < o.quantity}<span class="tag warn" title="As of TennoScope's last read of your inventory">you hold {held}</span>{/if}
              </Named>
              {#if held != null && held < o.quantity}
                <!-- Holding fewer than you list usually means some sold: say so, and orbiter closes them. -->
                <div class="fix">
                  <button class="stamp gold" onclick={() => recordSale(o, o.quantity - held)} title="Record the sale and {held === 0 ? 'close the listing' : `lower the listing to ${held}`}">Sold {o.quantity - held}</button>
                  {#if held === 0}<button class="link quiet" onclick={() => (removing = o.id)} title="You didn't sell it: just take the listing down">Didn't sell: remove</button>
                  {:else}<button class="link quiet" onclick={() => mkt.update(o, { quantity: held })} title="You didn't sell them: just lower the quantity">Didn't sell: set to {held}</button>{/if}
                </div>
              {/if}
            </td>
            <td class="right c-qty" data-label="Qty">
              <input type="number" min="1" inputmode="numeric" class:edited={change?.quantity != null} value={edits[o.id]?.quantity ?? o.quantity}
                oninput={(e) => edit(o, "quantity", e.currentTarget.value)} onkeydown={(e) => editKey(o, e)} onwheel={(e) => e.currentTarget.blur()} aria-label="Quantity" />
            </td>
            <td class="right c-price" data-label="Your price">
              <input type="number" min="1" inputmode="numeric" class:edited={change?.platinum != null} value={edits[o.id]?.platinum ?? o.platinum}
                oninput={(e) => edit(o, "platinum", e.currentTarget.value)} onkeydown={(e) => editKey(o, e)} onwheel={(e) => e.currentTarget.blur()} aria-label="Your price" />
              <!-- Narrow windows hide Will set: what Reprice would do shows under the price instead. -->
              {#if p?.change && !paused && o.visible && !change}<div class="willnote" class:up={p.target > o.platinum} title={p.reason === "floor" ? "Reprice sets this, held up by the floor" : "Reprice sets this"}>→ {p.target}p{p.reason === "floor" ? (p.competitor.price != null && p.target > p.competitor.price ? " · over market" : " · floor") : ""}</div>{/if}
              {#if change}
                {@const over = overHeld(o)}
                {#if over}<p class="err small">{over}</p>{/if}
                <div class="save">
                  <IconButton icon="check" tone="gold" label="Save" title={over ?? "Save: update the listing on warframe.market (Enter)"} disabled={!!mkt.busy || !!over} onclick={() => save(o)} />
                  <IconButton icon="undo" tone="quiet" label="Undo" title="Undo: put back {o.quantity} at {o.platinum}p (Esc)" onclick={() => revert(o)} />
                </div>
              {/if}
            </td>
            <td class="fade c-comp" data-label="Cheapest in game">
              {#if p && p.competitor.price != null}
                <span class="comp"><P v={p.competitor.price} /> <span class="dim small">{p.competitor.cheapest?.name} · {p.competitor.sellers} in game</span></span>
                {@const goes = goesFor(p)}
                {#if goes != null}<div class="register goes" title="Everyone in game asks more than twice what it really goes for: what it sold for lately, or what sellers on the site ask if that's lower ({p.competitor.askLevel ?? '–'}p, in game or not). Priced at that, so it sells.">goes for ~{goes}p</div>
                {:else if p.competitor.ladder.length > 1}<div class="register ladder" title="The next cheapest in-game prices">{p.competitor.ladder.join(" · ")}</div>{/if}
              {:else if p}<span class="dim small">Nobody in game</span>
              {:else if !o.visible || paused}<span class="none" title="The order book isn't read for a listing that's {o.visible ? 'left alone' : 'hidden'}">–</span>
              {:else}<span class="dim small">Not checked yet</span>{/if}
            </td>
            <td class="right fade willset">
              {#if p?.change && !paused && o.visible}<span class="target" class:down={p.target < o.platinum} class:up={p.target > o.platinum}><span class="dim">{o.platinum} →</span> <P v={p.target} /> <span class="delta">{p.target > o.platinum ? "+" : "−"}{Math.abs(p.target - o.platinum)}</span>{#if p.reason === "floor" && crackHeld(o, p) != null}<span class="tag ok" title="Worth more cracked: a crack of it is worth about {crackHeld(o, p)}p, so it isn't listed under {p.floor}p. Take it down to crack it instead.">crack</span>{:else if p.reason === "floor" && p.competitor.price != null && p.target > p.competitor.price}<span class="tag warn" title="Your floor ({p.floor}p) is over what the cheapest seller in game asks ({p.competitor.price}p): at this price it's unlikely to sell. Lower this listing's floor, or take it down.">over market</span>{:else if p.reason === "floor"}<span class="tag ok" title="Held up by the floor">floor</span>{:else if p.reason === "median"}<span class="tag" title="Everyone in game asks more than twice what it really goes for ({p.competitor.price}p and up): priced at that instead">sells for</span>{/if}</span>
              {:else if !o.visible}<span class="register" title="Hidden listings aren't repriced">hidden</span>
              {:else if paused}<span class="register" title="Auto-price is off: orbiter leaves this price as you set it">left alone</span>
              {:else if p && goesFor(p) != null}<span class="register ok" title="At what it really goes for: in game they ask {p.competitor.price}p and up">at its value</span>
              {:else if p}<span class="register ok">matched</span>{/if}
            </td>
            <td class="right floorcol"><input type="number" min="1" style:width="4.8rem" placeholder={p ? `auto ${p.floor}` : "auto"} aria-label="Floor for this listing" title="Your own floor for this listing; empty uses the automatic one" value={settings.floors[listingKey(o)] ?? ""} onchange={(e) => setFloor(o, e.currentTarget.value)} /></td>
            <td class="center c-auto" data-label="Auto-price"><Toggle on={!paused && o.visible} disabled={!o.visible} label="Auto-price: match the cheapest in-game seller" title={!o.visible ? "Hidden listings aren't repriced" : paused ? "Auto-price off: the price stays as you set it" : "Auto-price on: kept at the cheapest in-game seller's price"} onchange={() => togglePause(o)} /></td>
            <td class="center c-shown" data-label="Shown"><Toggle on={o.visible} label="Shown to buyers" title={o.visible ? "Visible to buyers" : "Hidden from buyers"} disabled={!!mkt.busy} onchange={(v) => mkt.update(o, { visible: v })} /></td>
            <td class="right c-acts">
              <!-- Three fixed places, the same on every row: sold one, sold several, remove. A
                   confirm takes over the same places, its safe choice where the click just was. -->
              <span class="acts">
                {#if pendingSold[o.id]}
                  <span class="pendrow">
                    <span class="register pending" title="Sent to warframe.market in a moment: marked sold, the listing lowered, the sale logged">Sold {pendingSold[o.id]}<i aria-hidden="true"></i></span>
                    <button type="button" class="link undo" title="Undo: nothing is sent" onclick={() => undoSale(o.id)}>Undo</button>
                  </span>
                {:else if selling?.id === o.id}
                  {@const n = selling.n}
                  {@const bad = n < 1 ? "At least 1" : n > o.quantity ? `Only ${o.quantity} listed` : null}
                  <input type="number" min="1" max={o.quantity} inputmode="numeric" class:bad value={selling.n} aria-label="How many you sold" title={bad ?? "How many you sold"} use:focusIt oninput={(e) => selling && (selling.n = Math.round(Number(e.currentTarget.value)) || 0)} onkeydown={(e) => { if (e.key === "Enter") recordSale(o, selling?.n ?? 1); else if (e.key === "Escape") { e.stopPropagation(); selling = null; } }} onwheel={(e) => e.currentTarget.blur()} />
                  <IconButton icon="check" tone="gold" label={bad ?? `Sold ${n}`} title={bad ?? `Mark ${n} sold on warframe.market and log the sale`} disabled={!!bad} onclick={() => recordSale(o, selling?.n ?? 1)} />
                  <IconButton icon="close" tone="quiet" label="Cancel" onclick={() => (selling = null)} />
                {:else if removing === o.id}
                  <span class="ask register">Remove?</span>
                  <IconButton icon="trash" tone="danger" label="Remove it" title="Remove it: take {it?.name ?? 'this listing'} off warframe.market" disabled={!!mkt.busy} onclick={() => { removing = null; mkt.remove(o); }} onkeydown={onEsc(() => (removing = null))} />
                  <button type="button" class="ib quiet" aria-label="Keep" title="Keep it" onclick={() => (removing = null)} onkeydown={onEsc(() => (removing = null))} use:focusIt><Icon name="close" /></button>
                {:else}
                  <IconButton icon="sold" tone="gold" label={o.quantity > 1 ? "Sold one" : "Sold"} title="Sold {o.quantity > 1 ? 'one' : 'it'} in game: marked sold on warframe.market (recorded on your profile), the listing goes down by one and the sale is logged. You get a few seconds to undo." onclick={() => recordSale(o, 1)} />
                  {#if o.quantity > 1}<IconButton icon="sold-many" tone="quiet" label="Sold several" title="Sold several at once: say how many" onclick={() => (selling = { id: o.id, n: 2 })} />{:else}<span class="slot"></span>{/if}
                  <IconButton icon="trash" tone="danger quiet" label="Remove" title="Remove: take this listing off warframe.market" onclick={() => (removing = o.id)} />
                {/if}
              </span>
            </td>
          </tr>
          {#if charted === o.id && it}
            <tr class="chartrow">
              <td colspan="9">
                <PriceHistory name={it.name} rank={it.maxRank != null ? (o.rank ?? 0) : null} subtype={o.subtype ?? it.subtypes?.[0] ?? null} height={160}
                  lines={[{ label: "Your price", value: o.platinum, color: "#c9ccd1" }, ...(p?.competitor.price != null ? [{ label: "Cheapest in game", value: p.competitor.price, color: "#6fa38a" }] : [])]} />
              </td>
            </tr>
          {/if}
        {:else}
          <tr><td colspan="9" class="nothing">No sell listings yet</td></tr>
        {/each}
      </tbody>
    </table>
    {#if mkt.buys.length}
      <!-- Buy orders you posted (from Wishlist, or on the website): what you're paying, and a way to take one down. -->
      <section class="buys" aria-label="Your buy orders">
        <h2 class="register yours">Your buy orders</h2>
        <ul>
          {#each mkt.buys as o (o.id)}
            {@const it = mkt.item(o.itemId)}
            <li>
              <Named file={model.imageOf(it?.name ?? "")} name={it?.name ?? o.itemId} size={26}>{#if o.rank != null}<span class="tag">R{o.rank}</span>{/if}{#if !o.visible}<span class="tag">hidden</span>{/if}</Named>
              <span class="dim small">wants {o.quantity}</span>
              <P v={o.platinum} />
              {#if removing === o.id}
                <IconButton icon="trash" tone="danger" label="Take it down" title="Take this buy order off warframe.market" disabled={!!mkt.busy} onclick={() => { removing = null; mkt.remove(o); }} onkeydown={onEsc(() => (removing = null))} />
                <button type="button" class="ib quiet" aria-label="Keep" title="Keep it" onclick={() => (removing = null)} onkeydown={onEsc(() => (removing = null))} use:focusIt><Icon name="close" /></button>
              {:else}
                <IconButton icon="trash" tone="danger quiet" label="Remove" title="Remove: take this buy order off warframe.market" onclick={() => (removing = o.id)} />
              {/if}
            </li>
          {/each}
        </ul>
      </section>
    {/if}
    {#if auctions.length}
      <!-- Riven auctions: warframe.market keeps them apart from listings, and they aren't repriced automatically. -->
      <section class="buys" aria-label="Your riven auctions">
        <h2 class="register yours">Your riven auctions</h2>
        <ul>
          {#each auctions as a (a.id)}
            {@const w = weaponOf(a)}
            <li>
              <Named file={w ? (model.catalogByUnique.get(w.gameRef)?.imageName ?? model.imageOf(w.name)) : null} name={auctionTitle(a)} size={26}>{#if !a.visible}<span class="tag">hidden</span>{/if}</Named>
              {#if auctionPrice?.id === a.id}
                <span class="plat"><input type="number" min="1" bind:value={auctionPrice.buyout} aria-label="New buyout price" use:focusIt onkeydown={onEsc(() => (auctionPrice = null))} /></span>
                <IconButton icon="check" tone="gold" label={auctionPrice.busy ? "Saving…" : "Save the new price"} disabled={auctionPrice.busy || !auctionPrice.buyout} onclick={() => saveAuctionPrice(a)} />
                <IconButton icon="close" tone="quiet" label="Cancel" onclick={() => (auctionPrice = null)} />
                {#if auctionPrice.error}<span class="err small">{auctionPrice.error}</span>{/if}
              {:else}
                <span class="dim small">{a.topBid != null ? `top bid ${a.topBid}p · ` : ""}{a.starting < (a.buyout ?? Infinity) ? `bids from ${a.starting}p` : "no bidding"}</span>
                {#if a.buyout != null}<P v={a.buyout} />{:else}<span class="dim small">no buyout</span>{/if}
                <IconButton icon="pencil" tone="quiet" label="Change price" title="Change its buyout price" onclick={() => (auctionPrice = { id: a.id, buyout: a.buyout, busy: false, error: null })} />
                <IconButton icon="external" tone="quiet" label="Open on warframe.market" onclick={() => openUrl(`https://warframe.market/auction/${a.id}`)} />
                {#if removing === `auction:${a.id}`}
                  <IconButton icon="trash" tone="danger" label="Take it down" title="Close this auction (it stays among your profile's closed auctions)" disabled={auctionBusy === a.id} onclick={() => { removing = null; void takeDownAuction(a); }} onkeydown={onEsc(() => (removing = null))} />
                  <button type="button" class="ib quiet" aria-label="Keep" title="Keep it" onclick={() => (removing = null)} onkeydown={onEsc(() => (removing = null))} use:focusIt><Icon name="close" /></button>
                {:else}
                  <IconButton icon="trash" tone="danger quiet" label={auctionBusy === a.id ? "Taking down…" : "Take down"} title="Take down: close this auction on warframe.market" disabled={auctionBusy === a.id} onclick={() => (removing = `auction:${a.id}`)} />
                {/if}
              {/if}
            </li>
          {/each}
        </ul>
        {#if auctionError}<p class="err small">{auctionError}</p>{/if}
        <p class="dim small">Riven auctions aren't repriced automatically: change a price here or on Rivens, where each riven's card has what similar ones are listed for.</p>
      </section>
    {/if}
    {#if mkt.log.length}
      <section class="log" aria-label="Activity">
        <div class="register">Activity</div>
        {#each mkt.log.slice(0, 30) as l (l.at + l.text)}
          <div class="line {l.tone}"><span class="register">{fmt(l.at)}</span> {l.text}</div>
        {/each}
      </section>
    {/if}

    {#if !console}<div id="spares"><SpareSale {model} {settings} {advice} /></div>{/if}

  {/if}
</div></div>

<style>
  .status { display: flex; flex-wrap: wrap; align-items: flex-start; gap: .6rem 1rem; padding: var(--step) 0 0; }
  .status > .register { padding-top: .55rem; }
  .account { display: inline-flex; align-items: center; gap: .4rem; white-space: nowrap; padding-top: .2rem; }
  .account .who { margin-right: .4rem; }
  .account :global(.ib) { --ib: 32px; }
  .who strong { color: var(--platinum); font-weight: 600; }
  h2.yours { margin: 0; }
  .buys { margin-top: var(--step); display: grid; gap: .5rem; }
  .buys ul { list-style: none; margin: 0; padding: 0; display: grid; gap: .3rem; }
  .buys li { display: flex; align-items: center; gap: .9rem; padding: .35rem .5rem; border: 1px solid var(--rule); }
  .buys li > :global(.named) { flex: 1; }
  .buys .plat input { width: 5.5rem; }
  .listhead { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem 1.6rem; margin-top: var(--step); padding-top: .9rem; border-top: 1px solid var(--rule); }
  .minp { width: 4.2rem; padding: .4rem .5rem; }

  /* New listing: a search with a dropdown of what you hold. */
  .newlisting { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem 1rem; flex: 1; min-width: 0; }
  .newlisting input { min-width: 16rem; }
  .hint :global(svg) { display: inline-block; vertical-align: -2px; color: var(--gold); }
  .searchbox { position: relative; display: inline-block; }
  .results { position: absolute; z-index: 5; top: calc(100% + 2px); left: 0; width: max(100%, 32rem); display: grid; background: var(--plate); border: 1px solid var(--rule-bright); box-shadow: 0 1rem 2rem rgb(0 0 0 / 50%); }
  .results .pick { display: flex; align-items: center; justify-content: space-between; gap: 1rem; text-align: left; border: 0; border-bottom: 1px solid var(--rule); background: transparent; padding: .4rem .8rem; }
  .results .pick:last-child { border-bottom: 0; }
  .results .pick:hover, .results .pick.active { background: var(--raised); }
  .results .pick .small { white-space: nowrap; text-transform: none; letter-spacing: 0; font-family: var(--face-text); }

  /* Quiet text actions in the table; Remove turns red only when you reach for it. */
  input.edited { border-color: var(--gold); color: var(--gold); box-shadow: inset 0 0 0 1px var(--gold-dim); }
  .save { display: flex; justify-content: flex-end; gap: .35rem; margin-top: .35rem; }
  .err { color: var(--oxblood); margin: .3rem 0 0; text-align: right; white-space: normal; }
  .out { display: inline-flex; align-items: center; gap: .8rem; }
  .row .out { margin-left: 0; padding-left: 0; border-left: 0; }
  .acts { display: inline-grid; grid-template-columns: auto 30px 30px; align-items: center; justify-items: end; gap: .35rem; white-space: nowrap; vertical-align: middle; }
  .acts .slot { width: 30px; }
  .orders .acts input[type="number"] { width: 3.4rem; height: 30px; padding: .3rem .4rem; }
  .orders .acts input.bad { border-color: var(--oxblood); color: var(--oxblood); }
  .ask { color: var(--oxblood); font-size: .6rem; }
  .pendrow { grid-column: 1 / -1; display: inline-flex; align-items: center; gap: .7rem; }
  .pending { position: relative; color: var(--gold); font-size: .62rem; padding-bottom: 3px; }
  /* Time left before it's sent: a line that runs out. */
  .pending i { position: absolute; left: 0; right: 0; bottom: 0; height: 1px; background: var(--gold); transform-origin: left; animation: wait 4s linear forwards; }
  @keyframes wait { from { transform: scaleX(1); } to { transform: scaleX(0); } }
  @media (prefers-reduced-motion: reduce) { .pending i { animation: none; } }
  .undo { font-size: .64rem; }
  .fix { display: flex; flex-wrap: wrap; align-items: center; gap: .35rem .9rem; margin-top: .35rem; padding-left: calc(34px + .75rem); }
  .fix .stamp { padding: .35rem .7rem; }
  /* Each button on one line; in a narrow window they sit under the name rather than squeezed beside it. */
  .fix button { white-space: nowrap; }
  :global(html[data-room~="lt1100"]) .fix { padding-left: 0; }

  .alert { border: 1px solid var(--oxblood); color: var(--oxblood); padding: .7rem 1rem; margin: var(--step) 0; font-size: .84rem; }
  .panel { border: 1px solid var(--rule); background: rgb(17 19 23 / 70%); padding: 1.2rem 1.4rem; margin: var(--step) 0; display: grid; gap: .8rem; }
  .signin h2 { font-size: 1.9rem; }
  .row { display: flex; flex-wrap: wrap; align-items: center; gap: .6rem; }
  .wide { min-width: 28rem; }
  code { font-family: var(--face-register); color: var(--platinum); }

  /* Groups kept apart by space, not rules: a rule would start the second line when they wrap. */
  .tools { gap: .6rem 2.2rem; }
  .grp { display: flex; align-items: center; gap: .5rem; }
  .next { margin-left: auto; }

  .log { margin-top: var(--step); max-height: 9.5rem; overflow: auto; display: grid; gap: .3rem; padding: .7rem 1rem; border: 1px solid var(--rule); background: rgb(17 19 23 / 70%); }
  .line { font-size: .82rem; color: var(--platinum-dim); }
  .line.ok { color: var(--platinum); }
  .line.warn { color: var(--oxblood); }
  .line .register { margin-right: .6rem; }

  /* The listings table. */
  table.orders { width: 100%; border-collapse: collapse; margin-top: var(--step); border-top: 1px solid var(--rule); font-variant-numeric: tabular-nums; }
  .orders th { text-align: left; font-family: var(--face-register); font-weight: 500; font-size: .6rem; letter-spacing: .15em; text-transform: uppercase; color: var(--platinum-deep); padding: .7rem .6rem; border-bottom: 1px solid var(--rule); white-space: nowrap; }
  .orders th.right { text-align: right; }
  .orders th.center { text-align: center; }
  .orders td { padding: .5rem .6rem; border-bottom: 1px solid var(--rule); vertical-align: middle; }
  .orders tbody tr:hover td { background: rgb(255 255 255 / 1.5%); }
  .orders th:first-child, .orders td:first-child { padding-left: 0; }
  .orders th:last-child, .orders td:last-child { padding-right: 0; }
  .orders input[type="number"] { width: 4.6rem; padding: .35rem .45rem; text-align: right; }
  /* Less room: the "Will set" column goes first. */
  /* Page area under 900 px (App sets the flag, by the room pages actually have). */
  :global(html[data-room~="lt900"]) .willset { display: none; }
  .willnote { display: none; margin-top: .2rem; font-family: var(--face-register); font-size: .62rem; letter-spacing: .06em; color: var(--oxblood); white-space: nowrap; }
  .willnote.up { color: var(--verdigris); }
  :global(html[data-room~="lt900"]) .willnote { display: block; }
  /* "auto 10" whole: the floor's placeholder without the wide capitals (and the box set wide enough, inline). */
  .floorcol input::placeholder { text-transform: none; letter-spacing: 0; font-size: .74rem; }
  /* The per-listing floor box goes next (your floors still apply, and the overall floor is above
     the table): half a 1080p screen leaves the page about 800 px, where it no longer fits. */
  :global(html[data-room~="lt900"]) .floorcol { display: none; }
  /* Less still: the headings wrap onto two lines rather than set the column widths. */
  :global(html[data-room~="lt760"]) .orders th { white-space: normal; line-height: 1.35; }
  /* A narrow window: each listing a card. The item across the top, the rest in a row under it, each with its name. */
  :global(html[data-room~="lt760"]) table.orders thead { display: none; }
  :global(html[data-room~="lt760"]) table.orders, :global(html[data-room~="lt760"]) table.orders tbody { display: block; }
  :global(html[data-room~="lt760"]) .orders tr.order { display: grid; grid-template-columns: auto auto minmax(0, 1fr) auto auto auto; grid-template-areas: "item item item item item item" "qty price comp auto shown acts"; column-gap: .6rem; row-gap: .45rem; align-items: end; padding: .7rem 0; border-bottom: 1px solid var(--rule); }
  :global(html[data-room~="lt760"]) .orders tr.order > td { display: block; border: 0; padding: 0 !important; }
  :global(html[data-room~="lt760"]) .orders tr.order > td:is(.willset, .floorcol) { display: none; }
  :global(html[data-room~="lt760"]) .orders tr.order > td[data-label]::before { content: attr(data-label); display: block; margin-bottom: .25rem; font-family: var(--face-register); font-size: .55rem; letter-spacing: .14em; text-transform: uppercase; color: var(--platinum-deep); text-align: left; white-space: nowrap; }
  :global(html[data-room~="lt760"]) .orders .c-item { grid-area: item; }
  :global(html[data-room~="lt760"]) .orders .c-qty { grid-area: qty; }
  :global(html[data-room~="lt760"]) .orders .c-price { grid-area: price; }
  :global(html[data-room~="lt760"]) .orders .c-comp { grid-area: comp; min-width: 0; }
  :global(html[data-room~="lt760"]) .orders .c-auto { grid-area: auto; }
  :global(html[data-room~="lt760"]) .orders .c-shown { grid-area: shown; }
  :global(html[data-room~="lt760"]) .orders .c-acts { grid-area: acts; }
  :global(html[data-room~="lt760"]) .orders tr.chartrow, :global(html[data-room~="lt760"]) .orders tr.chartrow > td { display: block; }
  :global(html[data-room~="lt760"]) .orders input[type="number"] { width: 3.3rem; }
  :global(html[data-room~="lt760"]) .acts { gap: .3rem; }
  :global(html[data-room~="lt760"]) .orders :is(td, th):not(:first-child):not(:last-child) { padding-left: .3rem; padding-right: .3rem; }
  /* Page area under 1100 px (App sets the flag, by the room pages actually have). */
  :global(html[data-room~="lt1100"]) .orders input[type="number"] { width: 3.8rem; }
  /* The floor's "auto 10" has to fit whole, or it reads as a 1p floor. */
  :global(html[data-room~="lt1100"]) .orders :is(td, th) { padding-left: .4rem; padding-right: .4rem; }
  :global(html[data-room~="lt1100"]) .orders :is(td, th):first-child { padding-left: 0; }
  :global(html[data-room~="lt1100"]) .orders :is(td, th):last-child { padding-right: 0; }
  :global(html[data-room~="lt1100"]) .ladder { display: none; }
  :global(html[data-room~="lt1100"]) .acts { gap: .6rem; }
  /* A hidden listing reads faded; its switches and actions stay at full strength. */
  tr.hidden td.fade { opacity: .45; }
  .right { text-align: right; }
  .center { text-align: center; }
  .comp { display: inline-flex; align-items: center; gap: .45rem; }
  .ladder { margin-top: .15rem; font-size: .6rem; }
  .goes { margin-top: .15rem; font-size: .6rem; color: var(--gold); }
  .none { color: var(--rule-control); }
  .target { display: inline-flex; align-items: center; justify-content: flex-end; white-space: nowrap; }
  .target.down .delta { color: var(--oxblood); }
  .target.up .delta { color: var(--verdigris); }
  .delta { font-family: var(--face-register); font-size: .62rem; margin-left: .3rem; }
  .register.ok { color: var(--verdigris); }
  .charted { all: unset; cursor: pointer; display: inline-grid; place-items: center; width: 22px; height: 22px; color: var(--platinum-deep); border: 1px solid transparent; }
  .charted:hover, .charted:focus-visible { color: var(--platinum); border-color: var(--rule-control); }
  .charted:focus-visible { outline: 1px solid var(--gold); outline-offset: 2px; }
  .charted.on { color: var(--gold); border-color: var(--gold-dim); }
  /* The chart sits in from the table's edges, which its first and last cells otherwise touch. */
  .orders tr.chartrow > td, :global(html[data-room~="lt1100"]) .orders tr.chartrow > td { padding: .6rem 1rem 1.1rem; background: rgb(17 19 23 / 55%); }
</style>
