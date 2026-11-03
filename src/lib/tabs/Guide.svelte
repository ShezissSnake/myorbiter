<script lang="ts">
  import Owned from "../ui/Owned.svelte";
  import PageHead from "../ui/PageHead.svelte";
  import Avail from "../ui/Avail.svelte";
  import Metal from "../ui/Metal.svelte";
  import Effort from "../ui/Effort.svelte";
  import Icon from "../ui/Icon.svelte";
  import { NEWS } from "../whatsNew";
  import { BUILD } from "../build";

  // console: the short guide, for the pages a console or phone player has. platform: where they play.
  let { go, plannerMode = $bindable(), console = false, platform = "PC" }: { go: (tab: string) => void; plannerMode: "sets" | "radiant"; console?: boolean; platform?: string } = $props();

  const CONSOLE_STEPS: Step[] = [
    ["home", "Home", "alerts with rare rewards (catalysts, reactors, Forma…), your market at a glance, the open worlds' cycles, Duviri's mood and the resets (and when the world was last read), every fissure open now (normal, Steel Path or Void Storms, with alerts for the ones you want), the bounties in each open world and hub (hover one for everything it can pay), events running in game and what they pay, what's worth doing today (Darvo's deal, the Sortie's missions, modifiers and reward chances among it), and when Baro comes and what he brings."],
    ["market", "Orders", "your listings. New listing finds anything warframe.market trades: pick it, set how many you have and the price (it starts at the cheapest seller in game). Check prices compares each listing with the cheapest seller in game; Reprice moves it there; both can run on their own, on a timer you choose (unattended, a price is never more than halved: that waits for you to press Reprice). Copy trade-chat line puts your listings on the clipboard for trade chat. When you sell one in game, press Sold on it: that marks it sold on warframe.market and logs the sale."],
    ["sales", "Sales", "what you've sold and what it made: today, 7 and 30 days, platinum per day, and each sale against the market. Import pulls in sales you marked sold on the website or app."],
    ["rivens", "Rivens", "find rivens for sale with each roll graded, see what the weapon's rivens traded for in game last week, and get alerts when one you want is listed at your price."],
  ];

  type Step = [tab: string, label: string, text: string | string[], planner?: "sets" | "radiant"];
  const ROUTINES: { title: string; steps: Step[] }[] = [
    {
      title: "Each session",
      steps: [
        ["home", "Home", ["Needs you: alerts and invasions with something you haven't mastered (and the side to take), rare alert rewards, listings to fix, Varzia's rotation ending. The × dismisses one (Undo brings it back for a few seconds).", "The open worlds' clocks, Duviri's mood (2 hours each: joy, anger, envy, sorrow, fear) and the resets. By the date: when the world was last read (every 5 minutes).", "Your market, and what's ready to sell.", "Every open fissure (normal, Steel Path or Void Storms) with your best relic for each era. Add alert sets a fissure alert, with a notification when one opens: tick any number of kinds (Normal, Steel Path, Void Storm), eras, mission types and planets in its menus (Defense or Mobile Defense, Axi or Neo). Only my alerts, above the board, shows just the fissures your alerts match, every kind together. Copy recruit line, by an era's best relic, copies a line for Recruiting chat (H Axi C12 rad 4b4); if the clipboard refuses, the line opens under it to copy by hand.", "The bounties in Cetus, Fortuna, the Necralisk, the Zariman, Cavia and Höllvania: each one's best reward, gold when you need it; hover for everything it pays.", "Events: what's running in game (Tactical Alerts, operations, seasonal events), where, until when, and what it pays.", "Worth doing today: the Circuit, Darvo, Teshin, the Sortie (each mission's modifier, hover for what it does; Reward chances for its table), the Archon Hunt, Nightwave.", "Your Foundry and Wishlist, cheap buys (and your price alerts: Alert me in Post a buy order watches an item for a listing at or under your price), the easiest mastery next, Baro and Varzia against your collection.", "The gear by the date chooses which cards Home shows."]],
        ["foundry", "Foundry", "everything you can master as cards, each part gold when you have it; click any card for stats, abilities, where each part drops (your relics first) and live prices. The star puts it on your Wishlist."],
        ["mastery", "Mastery", "everything you haven't mastered, easiest first: five pips from Market-and-build to Liches, where it comes from and how, and the mastery it's worth. Open a prime for the relics that drop each missing part. Buy with plat lists what platinum gets you instead, cheapest first or least plat per mastery point: the missing parts (or the set) from players, or the in-game Market's price, each part with a Buy order button that posts one on warframe.market, and a running total of what buying down the list costs."],
        ["wishlist", "Wishlist", "what you've starred, with each missing part's way in: relics you hold (lit when a fissure of their era is open now), where to farm the ones you don't, or what buying it costs, with a Buy order button that posts one on warframe.market (your buy orders are listed on Orders). The gold percentage is the chance your relics finish it if you crack each once; orbiter can tell you when a fissure opens for them."],
        ["inventory", "Inventory", "everything you own in one list (gear, prime parts, relics, mods, arcanes, resources and blueprints), with what it's worth at the daily median and what's easy to sell (never more copies than the whole market sells in a month). Narrow it by kind, to what warframe.market trades, or to what actually sells. Not needed lists gear you can't trade and no longer need, to sell for credits: a weapon, frame or companion once you own and have mastered a better version (the Dual Decurion with Prisma Dual Decurions; a Prime and a Vandal aren't upgrades of each other), and extra copies of something mastered. It keeps back what you haven't mastered, what a recipe you haven't mastered takes, and one with its Incarnon installed when the better one has none; Keep takes one off the list."],
      ],
    },
    {
      title: "Running fissures",
      steps: [
        ["planner", "Planner → Complete sets", "pick the relics most likely to finish a set you're close to.", "sets"],
        ["planner", "Planner → Make radiant", "spend Void Traces where they gain the most, and see how close you are to the most you can hold (100 + 50 a Mastery Rank; traces past it are lost).", "radiant"],
        ["relics", "Relics", "average plat per crack, intact against radiant (each reward at its price, or its ducats at your rate when that's more; a relic with an unpriced Prime part shows none). Click an era to see what you can crack in its fissures now. Solo or radshare is one setting, shared with the Planner and Home."],
        ["mission", "Current fissure", "once a void fissure loads, the squad's relics. On the reward screen it scores every card (by default plat, then unmastered, then ducats, then completing a set; the weights are yours to change in Settings, Fissures) and says which to take. No overlay or cards? It says why: solo runs show one card (nothing to choose), TennoScope wasn't running, or, on Windows, Warframe is in exclusive fullscreen (set Display Mode to Borderless). The TennoScope panel has a solid-background option for Windows if the overlay stays invisible. Copy for squad chat puts the four cards and their prices on your clipboard."],
      ],
    },
    {
      title: "Selling",
      steps: [
        ["market", "Orders", [
          "Your listings, kept at the cheapest in-game price. New listing finds what you hold; Copy trade-chat line puts your listings on the clipboard as one trade chat line.",
          "Check prices reads the order books and shows what each listing would change to (Will set, with why); Reprice sends those changes. Check and Apply automatically do it on a timer: unattended, a price is never more than halved, and one seller far under everyone else isn't followed.",
          "Floor and never-under keep prices from dropping too far, overall or per listing; Auto-price off leaves a price as you set it; Shown off hides a listing from buyers. Hide last copies (Settings, Trades): a whisper hides each listing down to its last copy for a while.",
          "Sold marks one sold (Sold several for more), with a few seconds to undo. A listing for more than you hold asks Sold?: Yes logs the sale and lowers the listing, No just lowers it.",
          "Trades left today: as many trades a day as your Mastery Rank, refreshed at 00:00 UTC, counted from the game's log.",
          "Put my spares on sale lists everything you tick in one go, after showing the plan and how many days of trades it would take. Over warframe.market's 100 listings, More than 100 listings? Keep picks what gets the slots.",
          "Your status lives at the top and on Home (Online in game while TennoScope sees Warframe running). Your buy orders and riven auctions are listed below your listings.",
        ]],
        ["sets", "Sets", "complete sets you can sell (with what a set sells for over its parts, and how much faster it sells than its slowest part), sets one or two parts short, and Saving up: the sets your loose parts wait for, easiest first (about how many relic cracks finish each, and the chance the relics you hold do), what's still to get and where from (a relic you own, relics that still drop, Varzia, or parts you keep getting), and what buying the rest would cost. Home's fissure board marks the eras where a relic of yours drops one of those parts."],
        ["parts", "Prime parts", "every part with its best use: keep it to build, save it for its set, sell it alone or as a set, or trade it to Baro for ducats. Got (30d) is how many turned up in your inventory in the last 30 days, trades left out. Set what a ducat is worth to you here. Below, Ducats for less lists the parts that buy ducats cheapest before Baro comes, each with a Buy order button."],
        ["mods", "Mods", "spare mod copies to sell (your best copy and one to give away are always kept), by default only ones that sell daily, and how many days of trades selling them all would take."],
        ["arcanes", "Arcanes", "rank arcanes by price and see how close you are to maxing each; “Sell or dissolve” sorts your spare copies into ones to sell and ones worth more dissolved for Vosfor at Loid (copies are priced as maxed arcanes: one is 1/21 of a maxed one, since a pile of unranked copies rarely fetches their unranked price), and ranks his arcane packs by what you're still collecting (or by market price)."],
        ["rivens", "Rivens", [
          "Your rivens graded roll by roll, filtered by kind or spliced, with what rivens for the weapon traded for in game last week (Digital Extremes' weekly figures).",
          "Price check: the cheapest riven listed for the weapon, similar ones' asking prices, and an Estimate of what a riven like it is listed for, with a range and what each stat does to it. Checks are kept, and refresh after a day when you open the page.",
          "Cycling a riven: press Sync at the cycle screen and the two rolls show side by side with which to keep and each one's Estimate; TennoScope's overlay shows them over the game for 25 seconds. A riven key (Settings, Overlays) reads them without switching windows.",
          "Find a riven: listings with their Estimate, the ones well under it marked, a Best deal sort, and alerts when one you want is listed at your price. Sell starts a buyout at the Estimate.",
        ]],
        ["browse", "Browse market", "everything warframe.market trades, yours or not, with what it sold for lately and how often it sells. Pick a category (Captura scenes, mods, arcanes…), set a price range or a minimum trades a day, and sort by any column. Sells weekly (on to start) leaves out things that sold less than once a week or on only a few days, whose prices can be jokes; turn it off to see everything. Open an item for its price history, or Buy order for the live cheapest seller and best buyer."],
        ["sales", "Sales", "sales log themselves: when you give items for platinum in game, orbiter marks the listing sold on warframe.market and records the sale. Sold on a listing in Orders, or adding a sale here, does it by hand; Import brings in sales you marked sold on the website or app. Totals for today, 7 and 30 days, platinum per day, each sale against the market as it was that day, and what sells often enough to list more of."],
        ["stats", "Stats", "your inventory's value, platinum, credits, Endo, ducats and more over time, what your relic runs come to per hour, the parts you got (from relics, missions or anything but a trade), profit by type, and every trade you've made; the sheet icon by Trade history saves them as a CSV in your Downloads folder (Sales has the same for your sales)."],
      ],
    },
  ];
</script>

<div class="page"><div class="page-inner">
{#if console}
  <PageHead title="Guide" blurb={`What each page is for, playing on ${platform}.`} />

  <section class="routines">
    <article>
      <h2 class="mark">The pages</h2>
      <ol>
        {#each CONSOLE_STEPS as [tab, label, text] (label)}
          <li><button class="link" onclick={() => go(tab)}>{label}</button><span>{text}</span></li>
        {/each}
      </ol>
    </article>
  </section>

  <section class="trust">
    <h3 class="register lead">What orbiter can and can't do on {platform}</h3>
    <ul>
      <li>orbiter can't read a game running on a console, so it doesn't know what you own or when a trade goes through. It doesn't list things for you or mark them sold by itself: you pick what to list, and press <b>Sold</b> when you've sold one.</li>
      <li>What it does by itself: keeps your listings at the cheapest price in game (Orders, Apply automatically), holds the warframe.market status you choose on Orders while it's open, and tells you when a fissure or riven you're watching for turns up.</li>
      <li>Everything else in orbiter (your collection, relics, mastery, spares to sell) needs your inventory, which it can only read from Warframe on a PC. Switch Settings → Platform to PC if you play there too: with cross-save, it's the same account.</li>
      <li>Everything orbiter records (sales, settings) stays on this computer. Your warframe.market sign-in is kept in the system keyring (a private file if there isn't one).</li>
    </ul>
  </section>

  <section class="cols">
    <article>
      <h3 class="register lead">Getting around</h3>
      <ul>
        <li><b>Hover</b> over any button or number for what it does.</li>
        <li><b>Sync</b>, at the bottom of the sidebar, reloads your listings, the fissures and Baro; it fills as it goes and ticks when done.</li>
        <li><b>Keyboard:</b> <kbd>Ctrl</kbd>+<kbd>1</kbd>…<kbd>4</kbd> pages in sidebar order, <kbd>Ctrl</kbd>+<kbd>R</kbd> or <kbd>F5</kbd> sync, <kbd>Ctrl</kbd>+<kbd>,</kbd> settings, <kbd>F1</kbd> this guide, <kbd>Esc</kbd> closes a panel, <kbd>Ctrl</kbd>+<kbd>Q</kbd> quits.</li>
        <li><span class="ic"><Icon name="bell" /></span> <b>Notifications</b>: what orbiter told you lately (click one to open it), and under <b>Choose</b> which kinds you get, with a pause for all of them. Choose can also send the kinds you pick to a Discord channel (paste its webhook address), to get them on your phone while you're away.</li>
        <li>The gear opens Settings: your platform, which pages the sidebar shows, in what order, and which one orbiter opens on, the +rep message and automatic +rep.</li>
      </ul>
    </article>
    <article>
      <h3 class="register lead">Where the numbers come from</h3>
      <ul>
        <li>Prices: warframe.market's order books, live, and its daily trade statistics for price history. Warframe trades across platforms, so they count sellers on every platform you can trade with: yours, and the others when both of you have cross-play on (in game and on your warframe.market profile). Platinum can't move between Switch and the other platforms.</li>
        <li>Fissures, alerts, Baro and his stock, cycles and today's missions: api.warframestat.us, refreshed every few minutes; the game's own worldstate when it isn't answering.</li>
        <li>Sales: what you record with Sold, and the closed orders on your warframe.market profile when you import them.</li>
        <li>Rivens: warframe.market's riven auctions, last week's in-game trades from Digital Extremes' weekly figures, and orbiter's own price model for the Estimate.</li>
      </ul>
    </article>
  </section>
{:else}
  <PageHead title="Guide" blurb="What each page is for. orbiter runs TennoScope for you in the background." />

  <section class="routines">
    {#each ROUTINES as r (r.title)}
      <article>
        <h2 class="mark">{r.title}</h2>
        <ol>
          {#each r.steps as [tab, label, text, planner] (label)}
            <li><button class="link" onclick={() => { if (planner) plannerMode = planner; go(tab); }}>{label}</button>{#if Array.isArray(text)}<ul class="sub">{#each text as t (t)}<li>{t}</li>{/each}</ul>{:else}<span>{text}</span>{/if}</li>
          {/each}
        </ol>
      </article>
    {/each}
  </section>

  <section class="trust">
    <h3 class="register lead">What orbiter does to your game</h3>
    <ul>
      <li><b>Nothing.</b> orbiter never sends keys, clicks or anything else to Warframe. It reads Warframe's log file and its <code>EE.cfg</code> (for the display mode), and what TennoScope saves. It writes to warframe.market when you ask (a button: List, Sold, a price, Buy order, Sell on a riven), when you turn on Apply automatically in Orders, when the game log shows you sold a listing (Settings, Trades), to give each player you trade with +rep with your message (on unless you turn it off in Settings, Trades), and, if you turn it on, to hide your last copies while someone whispers you.</li>
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
        <li><b>Keyboard:</b> <kbd>Ctrl</kbd>+<kbd>1</kbd>…<kbd>9</kbd> pages in sidebar order (change it in Settings → Pages), <kbd>Ctrl</kbd>+<kbd>PgUp</kbd>/<kbd>PgDn</kbd> (or <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Tab</kbd>/<kbd>Ctrl</kbd>+<kbd>Tab</kbd>) previous or next page, <kbd>Ctrl</kbd>+<kbd>K</kbd> find anything by name (an item opens its details, a relic, mod or arcane its page; the magnifier by Sync does the same), <kbd>Ctrl</kbd>+<kbd>F</kbd> or <kbd>/</kbd> the filter, <kbd>Tab</kbd> onto a button or figure shows what it does, <kbd>Ctrl</kbd>+<kbd>R</kbd> or <kbd>F5</kbd> sync, <kbd>Ctrl</kbd>+<kbd>,</kbd> settings, <kbd>F1</kbd> this guide, <kbd>Esc</kbd> closes a panel, <kbd>Ctrl</kbd>+<kbd>Q</kbd> quits.</li>
        <li><b>Sort</b> with the menu above the cards, or by clicking a column header in the table; click again (or <span class="ic"><Icon name="sort-desc" /></span> beside the menu) to flip the order.</li>
        <li>Filters and sorting stay as you left them while orbiter is open.</li>
        <li><b>Sync</b> (bottom of the sidebar) asks TennoScope to read your inventory from the game, fills while it waits for that new read (up to half a minute), and ticks once it's loaded; if no read comes, it says why under the button. When Warframe isn't running or TennoScope can't read the game, it re-reads what TennoScope last saved instead. Buttons that start longer work (Check prices, Reprice, Price check all, the spares plan) fill the same way and say how it went.</li>
        <li><b>TennoScope</b> under it opens its panel: whether it's healthy, screen-capture permission for the reward overlay, and inventory sync. Its light is green when all is well, gold when something wants a look, red when it isn't running or something failed.</li>
        <li>The sidebar folds to icons on narrow windows; the arrow next to the name folds or unfolds it, and orbiter remembers your choice.</li>
        <li><span class="ic"><Icon name="bell" /></span> <b>Notifications</b>: what orbiter told you lately, newest first (click one to open what it's about; the number on the bell is how many are new), and under <b>Choose</b> a switch for each kind, with a pause for all of them. Besides your listings and fissures, it can tell you when an alert or invasion rewards something you haven't mastered, when Baro brings something new to you, when Varzia's rotation has primes you need, and the Duviri Circuit's picks. While you're looking at orbiter they pop up in its corner; otherwise on your desktop, where clicking one (on Linux and Windows) brings orbiter up on what it's about. Choose can also send the kinds you pick to a Discord channel (paste its webhook address), to get them on your phone while you're away.</li>
        <li>On a wide window (1640 px and up), the <b>Watching</b> column on the right keeps what you choose in view on every page: your alerts, every open fissure, the open worlds' clocks, your Foundry, the best bounty rewards and your market. Its gear picks what it shows; » folds it away and the tab on the right edge brings it back. Planner, Browse market and Stats start out of the sidebar; Settings → Pages puts them back.</li>
        <li>The gear opens Settings: your platform; which pages the sidebar shows, in what order, and which one orbiter opens on; starting TennoScope with orbiter and where it, its data and Warframe's log are; switching to Current fissure on the reward screen and how the pick is scored; what TennoScope's overlays show, and the riven key; +rep after trades, marking sales sold from the game, and hiding last copies while someone whispers you; and whether veiled rivens and relics count as spare.</li>
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
        <li><span class="k"><span class="rar r">◆</span> <span class="rar u">●</span></span><span>on a relic's reward ring: a gold diamond on top is its rare reward, a silver dot an uncommon one, none a common one; a gold disc at the bottom corner is a part you still need</span></li>
        <li><span class="k"><span class="gold">◆</span></span><span>on Planner: the last part a set is missing; Finishes counts the sets a crack could complete</span></li>
        <li><span class="k"><Icon name="m-survival" /> <Icon name="m-defense" /> <Icon name="m-exterminate" /></span><span>a fissure's mission type (Survival, Defense, Exterminate…); the faction sigil beside it is whom you fight</span></li>
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
        <li>Prices: the warframe.market summary TennoScope downloads when it starts (a note at the top says when it's a day or more behind). Orders uses live order books, but when everyone in game asks more than twice what something has sold for lately, it's priced at what it sells for (marked <b>sells for</b>): matching them, it would never sell.</li>
        <li>Relic prices by refinement: what each relic you hold sold for on warframe.market over the last 30 days, intact to radiant, read once a day while relic selling is on (TennoScope's summary mostly has the intact price only). Fewer than two sales: the intact price stands in. Relics have their own minimum on Orders, next to Never under, since they go in stacks.</li>
        <li>Your ducat rate: while Baro is here, the best price per ducat among what he sells that trades daily is worked out and offered next to Your rates on Prime parts.</li>
        <li>Fissures, Varzia and Baro (with his stock): api.warframestat.us, refreshed every few minutes. When it isn't answering, these, the Sortie, the Archon Hunt, the open worlds' bounties and the clocks are read from the game's own worldstate instead (its places named by WFCD's tables), and Home says so. The last read is kept for the next start (up to a day), so these show at once; each fissure, alert and offer in it goes when it ends.</li>
        <li>Relics, what each one holds at each refinement, and which are vaulted: the official drop tables (through drops.warframestat.us, checked twice a day), laid over TennoScope's relic list, so a new Prime Access's relics show up within a day or two even before TennoScope has them. A relic that drops nowhere is vaulted; Requiem relics never are (Palladino sells them).</li>
        <li>Sales: trades read from the game log and what you record with Sold, kept on this computer.</li>
        <li>Foundry, mastery rank and platinum held: the patched TennoScope's read of your account. Value over time on Stats is recorded from each read.</li>
        <li>What you can spare (Inventory, Spare only, and "Everything else I don't need" on Orders): everything warframe.market trades that you hold beyond what you keep. Kept: the parts, blueprints and resources the recipes of everything you haven't mastered or built take (a recipe's own parts, not what those parts' recipes take), relics that drop a part you still need, two of each mod, one maxed arcane, one of each Captura scene, and hound, MOA, kitgun, zaw and amp parts while anything in that family is unmastered. Kubrow and Kavat imprints all count as spare (an imprint only hatches a companion; leave unlisted the ones you'll breed), once a patched TennoScope has read them; Put my spares on sale lists them under Imprints. Veiled rivens are kept unless you turn them on under Settings, Selling; relics only go when they sell for more than a crack is worth, each refinement on its own (a radiant relic's own odds against what radiant ones sell for; each reward at its price, or its ducats at your rate when that's more; solo or radshare as set on Relics), are never listed at or under that, and one that drops a part you still need is never sold; unveiled rivens are on Rivens. Built gear can't be traded and isn't counted.</li>
        <li>Saving parts for sets (Settings, Selling, on by default): a loose part waits for its set instead of being sold alone when the set sells for clearly more than its parts one by one (at least 10% and 5p more; each part at its price, or its ducats at your rate when that's more) and every missing part can still be had: from a relic you own, a relic in the drop tables, Varzia, or, for parts no relic drops (a Lato Vandal part, say), one you got in the last 30 days. Enough for one more set waits; extra copies are sold as usual. Put my spares on sale takes down your listing for a part when every copy you hold is waiting.</li>
        <li>Parts you got: each inventory read is compared with the one before; a prime part, or a blueprint part of other gear, you hold more of is a drop, whatever it came from, unless a trade between the two reads brought it in (a part claimed from the foundry or bought for credits counts too). A read with under half the parts, or none of a kind you held, is taken for a partial read until the next one agrees. Kept for 90 days, on this computer.</li>
        <li>orbiter's log (Settings, Logs): one line per event, in UTC like TennoScope's, in <code>orbiter.log</code> in orbiter's log folder (on Linux <code>~/.local/share/dev.orbiter.app/logs</code>, on Windows <code>%LOCALAPPDATA%\dev.orbiter.app\logs</code>), kept under 4 MB. It has TennoScope starting, stopping or failing, every change orbiter made to your listings and every warframe.market request that failed (the request's path, never your sign-in), the drop tables and EE.log being read, the notifications it sent, and errors in the window.</li>
        <li>Relic runs on Stats: every reward screen TennoScope read, from its own log. Which card you took shows up in the first inventory read after the mission: one more of it than you held when the screen opened. History from before orbiter recorded it counts the average card.</li>
        <li>Cheap buys: warframe.market's live feed of new orders, checked as each one goes up against everything you're missing or collecting; and its order books every 10 minutes for the top 20.</li>
        <li>Price history (Inventory, item details): warframe.market's daily trade statistics for the last 90 days. Imported sales (Sales): the closed orders on your warframe.market profile. Messages: warframe.market's own chat, read each minute while you're signed in.</li>
        <li>Riven auctions (Rivens, Sell) and +rep: warframe.market's v1 API, with your sign-in.</li>
        <li>Today: Nightwave, Sortie, Archon Hunt, Teshin and the Duviri Circuit from api.warframestat.us, as are the open worlds' cycles and alerts.</li>
        <li>Stats, abilities and build costs: the item catalog TennoScope keeps (WFCD). Rivens: each one's stats from your inventory, with the game's own base values; asking prices from warframe.market's riven auctions; last week's in-game trades from Digital Extremes' weekly figures (read again every six hours while orbiter is open); the Estimate from orbiter's own price model, trained on about 80,000 listings (<code>scripts/riven-model/README.md</code>).</li>
        <li>Relics in a mission: Warframe's own <code>EE.log</code>, read only.</li>
        <li>Finish odds on Wishlist and Mastery: each relic's drop chance at the refinement you hold, assuming you crack every copy once. Squadmates' relics aren't counted.</li>
        <li>The four reward cards: Warframe only logs your own, so orbiter gets them from a TennoScope patched to share them (<code>patches/README.md</code>). That patch also puts orbiter's score and <b>Pick</b> on TennoScope's overlay. Without it, Current fissure ranks everything the squad's relics can drop.</li>
      </ul>
    </article>
  </section>
{/if}

  <section class="news" aria-label="What's new">
    <h3 class="register lead">What's new</h3>
    {#each NEWS as n, i (n.id)}
      {#if i === 0 || NEWS[i - 1].date !== n.date}<h4 class="register">{new Date(`${n.date}T12:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}</h4>{/if}
      <ul>{#each n.items as item (item)}<li>{item}</li>{/each}</ul>
    {/each}
    <p class="dim small">This build: {BUILD.commit}{BUILD.date ? `, ${BUILD.date}` : ""}. Say it when you report a problem.</p>
  </section>
</div></div>

<style>
  .news { margin-top: var(--course); display: grid; gap: .5rem; max-width: 80ch; }
  .news h4 { margin: .6rem 0 0; font-size: .6rem; color: var(--platinum-deep); }
  .news ul { margin: 0; padding-left: 1.1rem; display: grid; gap: .35rem; font-size: .86rem; color: var(--platinum-dim); line-height: 1.5; }
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
  .sub { margin: .2rem 0 0; padding-left: 1.1rem; display: grid; gap: .2rem; }
  .sub li { display: list-item; list-style: square; counter-increment: none; grid-template-columns: none; }
  .sub li::before { content: none; }
  .rar { font-size: .8rem; }
  .rar.r { color: var(--gold); }
  .rar.u { color: #a9b0ba; }
  .gold { color: var(--gold); }
</style>
