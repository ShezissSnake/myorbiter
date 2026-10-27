<script lang="ts">
  import Owned from "../ui/Owned.svelte";
  import PageHead from "../ui/PageHead.svelte";
  import Avail from "../ui/Avail.svelte";
  import Metal from "../ui/Metal.svelte";
  import Effort from "../ui/Effort.svelte";
  import Icon from "../ui/Icon.svelte";

  let { go, plannerMode = $bindable() }: { go: (tab: string) => void; plannerMode: "sets" | "radiant" } = $props();

  type Step = [tab: string, label: string, text: string, planner?: "sets" | "radiant"];
  const ROUTINES: { title: string; steps: Step[] }[] = [
    {
      title: "Each session",
      steps: [
        ["home", "Home", "what needs you (an invasion with a part you need and the side to take, listings to fix, Varzia's rotation ending), the open-world cycles and resets, your market, live fissures with your best relic for each era, what's ready to sell, what's worth doing today (Circuit, Steel Path, Teshin, Sortie, Archon, Nightwave), your Foundry and Wishlist, cheap buys, the easiest mastery next, and Baro and Varzia against your collection."],
        ["foundry", "Foundry", "everything you can master as cards, each part gold when you have it; click any card for stats, abilities, where each part drops (your relics first) and live prices. The star puts it on your Wishlist."],
        ["wishlist", "Wishlist", "what you've starred, with each missing part's way in: relics you hold (lit when a fissure of their era is open now), where to farm the ones you don't, or what buying it costs. The gold percentage is the chance your relics finish it if you crack each once; orbiter can tell you when a fissure opens for them."],
        ["mastery", "Mastery", "everything you haven't mastered, easiest first: five pips from Market-and-build to Liches, where it comes from and how, and the mastery it's worth. Open a prime for the relics that drop each missing part."],
        ["inventory", "Inventory", "everything you own in one list (gear, prime parts, relics, mods, arcanes, resources and blueprints), with what it's worth at the daily median and what's easy to sell. Narrow it by kind, to what warframe.market trades, or to what actually sells."],
      ],
    },
    {
      title: "Running fissures",
      steps: [
        ["planner", "Planner → Complete sets", "pick the relics most likely to finish a set you're close to.", "sets"],
        ["planner", "Planner → Make radiant", "spend Void Traces where they gain the most.", "radiant"],
        ["relics", "Relics", "average plat per crack, intact against radiant. Click an era to see what you can crack in its fissures now. Solo or radshare is one setting, shared with the Planner and Home."],
        ["mission", "In mission", "once the mission loads, the squad's relics. On the reward screen it scores every card (by default plat, then unmastered, then ducats, then completing a set; the weights are yours to change) and says which to take."],
      ],
    },
    {
      title: "Selling",
      steps: [
        ["parts", "Prime parts", "every part with its best use: keep it to build, sell it alone or as a set, or trade it to Baro for ducats. Set what a ducat is worth to you here."],
        ["sets", "Sets", "complete sets you can sell, and sets one or two parts short."],
        ["arcanes", "Arcanes", "rank arcanes by price or your own S–D tier (the Tier picker on each card or row); “Sell or dissolve” sorts your spare copies into ones to sell and ones worth more dissolved for Vosfor at Loid, and ranks his arcane packs by what you're still collecting (or by market price)."],
        ["mods", "Mods", "spare mod copies to sell (your best copy and one to give away are always kept), by default only ones that sell daily."],
        ["market", "Orders", "your listings, following the cheapest in-game seller. “Put my spares on sale” lists everything you tick in one go after showing the plan. Your warframe.market status lives here and on Home."],
        ["rivens", "Rivens", "your rivens graded roll by roll, a price check against similar ones for sale, a finder, and alerts when one you want is listed at your price."],
        ["stats", "Stats", "your inventory's value, platinum, credits, Endo, ducats and more over time, what your relic runs come to per hour, profit by type, and every trade you've made."],
        ["sales", "Sales", "sales log themselves: when you give items for platinum in game, orbiter marks the listing sold on warframe.market and records the sale. Sold on a listing in Orders, or adding a sale here, does it by hand. Totals for today, 7 and 30 days, platinum per day, each sale against the market, and what sells often enough to list more of."],
      ],
    },
  ];
</script>

<div class="page"><div class="page-inner">
  <PageHead title="Guide" blurb="What each page is for. orbiter runs TennoScope for you in the background." />

  <section class="routines">
    {#each ROUTINES as r (r.title)}
      <article>
        <h2 class="mark">{r.title}</h2>
        <ol>
          {#each r.steps as [tab, label, text, planner] (label)}
            <li><button class="link" onclick={() => { if (planner) plannerMode = planner; go(tab); }}>{label}</button><span>{text}</span></li>
          {/each}
        </ol>
      </article>
    {/each}
  </section>

  <section class="trust">
    <h3 class="register lead">What orbiter does to your game</h3>
    <ul>
      <li><b>Nothing.</b> orbiter never sends keys, clicks or anything else to Warframe. It reads Warframe's log file and what TennoScope saves, and it changes your warframe.market listings only when you ask: a button (List, Sold, a price), Auto-match if you turn it on in Orders, or marking a listing sold when the game log shows you traded it (Settings, under Trades).</li>
      <li>TennoScope reads the game's memory to find your session, read only, then downloads your inventory from the same address the official companion app uses. It doesn't write to the game either.</li>
      <li>Mods: orbiter can't see which copy is fitted to a build, so it always keeps your best copy and one more. What it calls spare is past those two.</li>
      <li>Everything orbiter records (sales, trades, value over time, settings) stays on this computer. Your warframe.market sign-in is kept in the system keyring (a private file if there isn't one).</li>
    </ul>
  </section>

  <section class="cols">
    <article>
      <h3 class="register lead">Getting around</h3>
      <ul>
        <li><span class="ic"><Icon name="list" /></span> at the end of a row puts it on warframe.market without leaving the page: only the copies you can spare, priced at the cheapest seller in game. A padlock <span class="ic"><Icon name="lock" /></span> (or nothing) means you need what you have; the green <span class="ic good"><Icon name="listed" /></span> means it's on the market already (click to add more or change the price). Every icon says what it does when you hover it.</li>
        <li><b>Cards or rows:</b> collection pages show cards by default; <span class="ic"><Icon name="rows" /></span> above the cards switches that page to a sortable table, <span class="ic"><Icon name="cards" /></span> back, and it's remembered. A gold edge on a card marks one to look at: spares you can sell, gear you own but haven't mastered, a relic with a part you need, an arcane you've maxed. On part icons, gold is enough in hand, dashed is building.</li>
        <li><b>Hover</b> over anything with a name (a relic, a part, a mod, an arcane, a warframe or weapon) for what it is: a relic's rewards with their odds and prices, where a part drops and what it sells for, a mod's effect at max rank. Move off it, scroll or press <kbd>Esc</kbd> to close it.</li>
        <li><b>Click a card or row</b> to open it: a warframe, weapon or companion opens its full details (stats, parts, drops, prices); other things show relic odds, how many you keep, and warframe.market links.</li>
        <li><b>Keyboard:</b> <kbd>Ctrl</kbd>+<kbd>1</kbd>…<kbd>9</kbd> pages in sidebar order, <kbd>Ctrl</kbd>+<kbd>PgUp</kbd>/<kbd>PgDn</kbd> (or <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Tab</kbd>/<kbd>Ctrl</kbd>+<kbd>Tab</kbd>) previous or next page, <kbd>Ctrl</kbd>+<kbd>F</kbd> or <kbd>/</kbd> the filter, <kbd>Ctrl</kbd>+<kbd>R</kbd> or <kbd>F5</kbd> sync, <kbd>Ctrl</kbd>+<kbd>,</kbd> settings, <kbd>F1</kbd> this guide, <kbd>Esc</kbd> closes a panel, <kbd>Ctrl</kbd>+<kbd>Q</kbd> quits.</li>
        <li><b>Sort</b> with the menu above the cards, or by clicking a column header in the table; click again (or <span class="ic"><Icon name="sort-desc" /></span> beside the menu) to flip the order.</li>
        <li>Filters and sorting stay as you left them while orbiter is open.</li>
        <li><b>Sync</b> (bottom of the sidebar) asks TennoScope to read your inventory from the game and reloads. It says <b>Refresh</b> when Warframe isn't running or TennoScope can't read the game, and then re-reads what TennoScope last saved.</li>
        <li><b>TennoScope</b> under it opens its panel: whether it's healthy, screen-capture permission for the reward overlay, and inventory sync. Its light is green when all is well, gold when something wants a look, red when it isn't running or something failed.</li>
        <li>The sidebar folds to icons on narrow windows; the arrow next to the name folds or unfolds it, and orbiter remembers your choice.</li>
        <li>The gear opens Settings: starting TennoScope with orbiter, where it, its data and Warframe's log are, switching to In mission when the reward screen opens, marking sales sold from the game, notifications, and clearing your arcane tiers.</li>
      </ul>
    </article>
    <article>
      <h3 class="register lead">What the marks mean</h3>
      <ul class="legend">
        <li><span class="k"><Avail v="farmable" /></span><span>a relic for it is still in the drop tables</span></li>
        <li><span class="k"><Avail v="vaulted" /></span><span>only vaulted relics drop it: no new copies</span></li>
        <li><span class="k"><Avail v="resurgence" /></span><span>vaulted, but Varzia sells it right now</span></li>
        <li><span class="k"><span class="tag ok">✓ mastered</span></span><span>you've mastered it, or the item the part builds</span></li>
        <li><span class="k"><span class="tag warn">need</span></span><span>a part for something you haven't built or mastered</span></li>
        <li><span class="k"><span class="tag">keep 1</span></span><span>copies held back so you can still build and master it</span></li>
        <li><span class="k"><Effort acq={{ method: "market-credits", difficulty: 1, how: "", icon: null, available: true, tradable: false, researched: false, wiki: null }} compact /> … <Effort acq={{ method: "lich-sister", difficulty: 5, how: "", icon: null, available: true, tradable: false, researched: false, wiki: null }} compact /></span><span>how hard something is to get, from buy-and-build to Liches</span></li>
        <li><span class="k"><Metal kind="plat" /></span><span>platinum (warframe.market daily median)</span></li>
        <li><span class="k"><Metal kind="ducat" /></span><span>ducats</span></li>
        <li><span class="k"><Owned owned={{ Intact: 1, Radiant: 2 }} /></span><span>relics you hold, by refinement: intact, exceptional, flawless, radiant</span></li>
      </ul>
    </article>
    <article>
      <h3 class="register lead">Where the numbers come from</h3>
      <ul>
        <li>Inventory and mastery: TennoScope's last read of your account. When that was: “Last read” in the TennoScope panel, also shown at the bottom of the sidebar (“Synced …”) when it has its labels and you're not in a fissure.</li>
        <li>How to get things: researched item by item on the official wiki, and worked out from the game's drop tables for the rest.</li>
        <li>Prices: the warframe.market summary TennoScope downloads once a day. Orders uses live order books, but when everyone in game asks more than twice what something has sold for lately, it's priced at what it sells for (marked <b>sells for</b>): matching them, it would never sell.</li>
        <li>Relic prices by refinement: what each relic you hold sold for on warframe.market over the last 30 days, intact to radiant, read once a day while relic selling is on (TennoScope's summary mostly has the intact price only). Fewer than two sales: the intact price stands in. Relics have their own minimum on Orders, next to Never under, since they go in stacks.</li>
        <li>Your ducat rate: while Baro is here, the best price per ducat among what he sells that trades daily is worked out and offered next to Your rates on Prime parts.</li>
        <li>Fissures, Varzia and Baro (with his stock): api.warframestat.us, refreshed every few minutes.</li>
        <li>Sales: trades read from the game log and what you record with Sold, kept on this computer.</li>
        <li>Foundry, mastery rank and platinum held: the patched TennoScope's read of your account. Value over time on Stats is recorded from each read.</li>
        <li>What you can spare (Inventory, Spare only, and "Everything else I don't need" on Orders): everything warframe.market trades that you hold beyond what you keep. Kept: the parts, blueprints and resources the recipes of everything you haven't mastered or built take (a recipe's own parts, not what those parts' recipes take), relics that drop a part you still need, two of each mod, one maxed arcane, one of each Captura scene, and hound, MOA, kitgun, zaw and amp parts while anything in that family is unmastered. Veiled rivens are kept unless you turn them on under Settings, Selling; relics only go when they sell for more than a crack is worth, each refinement on its own (a radiant relic's own odds against what radiant ones sell for; each reward at its price, or its ducats at your rate when that's more; solo or radshare as set on Relics), are never listed at or under that, and one that drops a part you still need is never sold; unveiled rivens are on Rivens. Built gear can't be traded and isn't counted.</li>
        <li>Relic runs on Stats: every reward screen TennoScope read, from its own log. Which card you took shows up in the first inventory read after the mission: one more of it than you held when the screen opened. History from before orbiter recorded it counts the average card.</li>
        <li>Cheap buys: warframe.market's live feed of new orders, checked as each one goes up against everything you're missing or collecting; and its order books every 10 minutes for the top 20.</li>
        <li>Price history (Inventory, item details): warframe.market's daily trade statistics for the last 90 days. Imported sales (Sales): the closed orders on your warframe.market profile. Messages: warframe.market's own chat, read each minute while you're signed in.</li>
        <li>Riven auctions (Rivens, Sell) and +rep: warframe.market's v1 API, with your sign-in.</li>
        <li>Today: Nightwave, Sortie, Archon Hunt, Teshin and the Duviri Circuit from api.warframestat.us, as are the open worlds' cycles.</li>
        <li>Stats, abilities and build costs: the item catalog TennoScope keeps (WFCD). Rivens: each one's stats from your inventory, with the game's own base values; prices from warframe.market's riven auctions.</li>
        <li>Relics in a mission: Warframe's own <code>EE.log</code>, read only.</li>
        <li>Finish odds on Wishlist and Mastery: each relic's drop chance at the refinement you hold, assuming you crack every copy once. Squadmates' relics aren't counted.</li>
        <li>The four reward cards: Warframe only logs your own, so orbiter gets them from a TennoScope patched to share them (<code>patches/README.md</code>). That patch also puts orbiter's score and <b>Pick</b> on TennoScope's overlay. Without it, In mission ranks everything the squad's relics can drop.</li>
      </ul>
    </article>
  </section>
</div></div>

<style>
  /* An icon named in the text, drawn as it is on the page. */
  .ic { display: inline-grid; place-items: center; width: 1.3rem; height: 1.3rem; vertical-align: -.3rem; border: 1px solid var(--rule-bright); color: var(--platinum-dim); }
  .ic.good { color: var(--verdigris); border-color: color-mix(in srgb, var(--verdigris) 50%, transparent); }
  .routines { display: grid; grid-template-columns: repeat(auto-fit, minmax(19rem, 1fr)); border-top: 1px solid var(--rule); border-left: 1px solid var(--rule); }
  .routines article { padding: 1.2rem 1.3rem 1.4rem; border-right: 1px solid var(--rule); border-bottom: 1px solid var(--rule); background: rgb(17 19 23 / 60%); }
  h2 { font-size: 1.6rem; margin-bottom: .9rem; }
  ol { margin: 0; padding: 0; list-style: none; counter-reset: s; display: grid; gap: .75rem; }
  ol li { counter-increment: s; display: grid; grid-template-columns: 1.6rem 1fr; column-gap: .2rem; font-size: .86rem; color: var(--platinum-dim); line-height: 1.5; }
  ol li::before { content: counter(s); grid-row: span 2; font-family: var(--face-mark); font-weight: 700; font-size: 1.2rem; color: var(--gold); line-height: 1.1; }
  ol .link { justify-self: start; font-size: .64rem; }
  .trust { margin-top: var(--course); padding: 1.1rem 1.3rem; border: 1px solid var(--gold-dim); background: linear-gradient(180deg, #1a1810, rgb(17 19 23 / 60%) 60%); }
  .trust ul { grid-template-columns: repeat(auto-fit, minmax(22rem, 1fr)); column-gap: 2rem; }
  .cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(19rem, 1fr)); gap: var(--course); margin-top: var(--course); }
  h3 { margin: 0 0 .7rem; color: var(--platinum); }
  ul { margin: 0; padding-left: 1rem; display: grid; gap: .5rem; font-size: .84rem; color: var(--platinum-dim); line-height: 1.5; }
  ul.legend { list-style: none; padding: 0; }
  /* Each mark in a column of its own, so the explanations line up. */
  ul.legend li { display: grid; grid-template-columns: 8rem 1fr; align-items: center; gap: .8rem; }
  ul.legend .k { display: inline-flex; align-items: center; gap: .3rem; white-space: nowrap; }
  ul.legend .tag { margin-left: 0; }
  b { color: var(--platinum); font-weight: 500; }
  code, kbd { font-family: var(--face-register); font-size: .8em; color: var(--platinum); }
</style>
