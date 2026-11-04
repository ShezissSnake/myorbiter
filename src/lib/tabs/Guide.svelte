<script lang="ts">
  import Owned from "../ui/Owned.svelte";
  import PageHead from "../ui/PageHead.svelte";
  import Avail from "../ui/Avail.svelte";
  import Metal from "../ui/Metal.svelte";
  import Effort from "../ui/Effort.svelte";
  import Icon from "../ui/Icon.svelte";
  import PartChip from "../ui/PartChip.svelte";
  import GameIcon from "../ui/GameIcon.svelte";
  import { NEWS, batches, tourStops } from "../whatsNew";
  import { startTour } from "../tour.svelte";
  import NewsItems from "../ui/NewsItems.svelte";
  import Rich from "../ui/Rich.svelte";
  import { BUILD } from "../build";
  import { updates as updateState } from "../updates.svelte";
  import { arrive } from "../motion";

  // console: the short guide, for the pages a console or phone player has. platform: where they play.
  // hidden: the pages Settings → Pages keeps out of the sidebar.
  let { go, plannerMode = $bindable(), console = false, platform = "PC", hidden = [] }: { go: (tab: string) => void; plannerMode: "sets" | "radiant"; console?: boolean; platform?: string; hidden?: string[] } = $props();

  const CONSOLE_STEPS: Step[] = [
    ["home", "Home", "alerts with rare rewards (catalysts, reactors, Forma…), your market at a glance, the open worlds' cycles, Duviri's mood and the resets (and when the world was last read), every fissure open now (normal, Steel Path or Void Storms, with alerts for the ones you want), the bounties in each open world and hub (hover one for everything it can pay), events running in game and what they pay, what's worth doing today (Darvo's deal, the Sortie's missions, modifiers and reward chances among it), and when Baro comes and what he brings."],
    ["market", "Orders", "your listings. New listing finds anything warframe.market trades: pick it, set how many you have and the price (it starts at the cheapest seller in game). Check prices compares each listing with the cheapest seller in game; Reprice moves it there; both can run on their own, on a timer you choose (unattended, a price is never more than halved: that waits for you to press Reprice). Copy trade-chat line puts your listings on the clipboard for trade chat. When you sell one in game, press Sold on it: that marks it sold on warframe.market and logs the sale."],
    ["sales", "Sales", "what you've sold and what it made: today, 7 and 30 days, platinum per day, and each sale against the market. Import pulls in sales you marked sold on the website or app."],
    ["rivens", "Rivens", "find rivens for sale with each roll graded, see what the weapon's rivens traded for in game last week, and get alerts when one you want is listed at your price."],
  ];

  type Step = [tab: string, label: string, text: string | string[], planner?: "sets" | "radiant"];
  // What's new, one update a day, each with a tour of that day's changes.
  const updates = batches(NEWS).map((u) => ({ ...u, stops: tourStops(u.items) }));
  const longDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
  const shortDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "long" });
  // The walks' pages kept out of the sidebar, named in the note under them.
  const OUT: [id: string, label: string][] = [["planner", "Planner"], ["browse", "Browse market"], ["stats", "Stats"]];
  const out = $derived(OUT.filter(([id]) => hidden.includes(id)).map(([, l]) => l));
  const listed = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : xs[0]);
  // Each page in a line: its first clause, the rest on "more".
  let openSteps = $state<Record<string, boolean>>({});
  const brief = (t: string | string[]) => {
    const s = Array.isArray(t) ? t[0] : t;
    const cut = s.search(/[.:;(]/);
    if (cut > 20 && cut < 120) return s.slice(0, cut).trimEnd() + "…";
    return s.length > 110 ? s.slice(0, 110).replace(/\s\S*$/, "") + "…" : s;
  };
  // Four evenings, step by step: what to open, in order, for the things players come to orbiter for.
  const WALKS: { title: string; steps: [tab: string, page: string, what: string][] }[] = [
    { title: "A relic evening", steps: [
      ["home", "Home", "Fissures now: each era's best relic of yours (+2 for the next ones), Recruit for a squad line"],
      ["relics", "Relics", "refine what's worth it; your Void Traces and the cap are at the top"],
      ["mission", "Current fissure", "the squad's relics as the mission loads, the reward to take on the reward screen, and the session so far"],
      ["parts", "Prime parts", "what you got: sell, keep for a set, or ducats"],
    ] },
    { title: "A selling day", steps: [
      ["market", "Orders", "Put my spares on sale (top, folded): Plan, look it over, Apply; it ticks off as it goes"],
      ["market", "Orders", "Check prices, then Reprice; sort the table by any column"],
      ["market", "Orders", "a buyer whispers: Whispered you, Invite; mark it Sold. Out of trades? Go invisible until 00:00 UTC"],
      ["sales", "Sales", "what it made"],
    ] },
    { title: "A mastery push", steps: [
      ["mastery", "Mastery", "easiest first, or what to buy with plat"],
      ["foundry", "Foundry", "what's building, what you can build, star what you're after"],
      ["builds", "Builds", "a build for what you just built, and what you're missing for it"],
      ["wishlist", "Wishlist", "the relics for each missing part, and what buying it costs"],
    ] },
    { title: "The weekly round", steps: [
      ["home", "Home", "Worth doing today: tick each chore as you do it (they clear at the reset); Baro, Varzia, the Sortie, the Archon, Archimedea, Nightwave"],
    ] },
  ];
  const ROUTINES: { title: string; steps: Step[] }[] = [
    {
      title: "Each session",
      steps: [
        ["home", "Home", ["Needs you: alerts and invasions with something you haven't mastered (and the side to take), alerts and invasions with a rare reward (an Orokin Catalyst or Reactor blueprint, Forma, an Exilus Adapter blueprint), listings to fix, Varzia's rotation ending. The × dismisses one (Undo brings it back for a few seconds).", "The open worlds' clocks, Duviri's mood (2 hours each: joy, anger, envy, sorrow, fear) and the resets. By the date: when the world was last read (every 5 minutes).", "Your market (Listed more than you hold: listings for more copies than you have now), and Ready to list: the kinds ticked under Put my spares on sale, at or over your minimum, with what your minimum leaves out beside it. Sold today counts from your local midnight, Trades left from 00:00 UTC.", "Every open fissure (normal, Steel Path or Void Storms) with your best relic for each era; quick missions (Capture, Exterminate, Rescue, Sabotage) are marked quick and listed first in their era. Add alert sets a fissure alert, with a notification when one opens: tick any number of kinds (Normal, Steel Path, Void Storm), eras, mission types and planets in its menus (Defense or Mobile Defense, Axi or Neo). Only my alerts, above the board, shows just the fissures your alerts match, every kind together. Recruit, by an era's best relic, copies a line for Recruiting chat (H Axi C12 rad 4b4); +2 beside it opens your next best relics for that era, with how many radiant you hold.", "The bounties in Cetus, Fortuna, the Necralisk, the Zariman, Cavia and Höllvania: each one's best reward, gold when you need it; hover for everything it pays.", "Events: what's running in game (Tactical Alerts, operations, seasonal events), where, until when, and what it pays.", "Worth doing today: the Circuit (an Incarnon weapon is marked only when it has no Genesis installed or in hand), Darvo, Teshin (and how many weeks until Umbra Forma comes round), the Sortie (each mission's modifier, hover for what it does; Reward chances for its table), the Archon Hunt, Nightwave (up to how much standing the open challenges give), and the week's Deep and Temporal Archimedea missions, the 1999 Calendar's prize days worth picking (Catalysts, adapters, rivens; hover for all of them) and the Descendia. Everything → shows each Nightwave task and each Archimedea mission's deviation and risks (! the hard ones). The box at the end of a chore's line ticks it off (the game doesn't say what's done); each tick clears itself at that chore's reset, and Kahl's Garrison and Netracells are there to tick too.", "Your Foundry and Wishlist, cheap buys (and your price alerts: Alert me in Post a buy order watches an item for a listing at or under your price), the easiest mastery next, Baro and Varzia against your collection (Baro's card shows each item's ducats and credits, and while he's here his best ducats-to-plat flips: what he sells that trades on warframe.market, by platinum per ducat, with trades a day).", "The gear by the date chooses which cards Home shows.", "Start here, at the top in your first days: signing in, your rates, a star, a fissure alert, Home's cards; it goes once they're done (or on Not now)."]],
        ["foundry", "Foundry", "the Codex rings at the top: each category's sigil in a ring of what you've mastered of it, named and counted (click one to show only that category, All for every one; the figures beside count every category), with what to build, assemble, gild or level next. Amps (Sirocco too) and K-Drives have rings of their own, companion weapons and the Plexus are with Companions, and a kitgun's chamber shows under Primary and Secondary both, counted once in All; then what's in your foundry (building, and ready to claim), then everything you can master as cards (the filter finds a name or a kind: Kitgun, MOA, Zaw), each part gold when you have it (a kitgun, zaw, amp, MOA or hound says its next step: a part in hand to assemble, a build to gild, a gilded one to level); click any card for stats, abilities, where each part drops (your relics first) and live prices. The star puts it on your Wishlist."],
        ["builds", "Builds", ["Mod and arcane builds for anything that takes them. Find an item (yours first, or Builds on an item's details), then pick a tier at the top, by how far along a player is: New player (basic mods, no Catalyst or Forma), Intermediate (a Catalyst or Reactor, Forma, an Exilus Adapter, augments, corrupted mods, easy arcanes, the Helminth) or Veteran (everything: Primed, Archon and Umbral mods, Umbra Forma, Tauforged Archon shards).", "Each build is laid out as the Arsenal shows it (each mod's drain green on its own polarity, red on another; a gold ring where a Forma goes; the arcanes, Archon shards and Helminth below), with its capacity, why it's in its tier, and what you're missing: mods (and the Endo to rank them), arcanes, shards, the Catalyst, adapters, Forma. For a mod or arcane you lack, Find seller reads warframe.market for the cheapest seller in game and gives you the whisper to copy. What you hold comes from your inventory, so it needs Full mode (off until you turn it on, see TennoScope below); without it, orbiter can't tell what you hold.", "Favourites (★) come first, then the builds you pasted or made, then a site's, then orbiter's suggestion, made from the mods you hold. Its Variant buttons switch between orbiter's builds for the item (a caster's Star Chart and Steel Path nuke, a tank's Tank / Steel Path and Caster / Star Chart). Its Archon shards are always Tauforged: a filled gem is one you hold, an outlined one to get, and a gold dot means plain shards you hold can be fused into it (hover for how). With it lists what goes around a warframe build: the element its kit deals, a companion or a primer instead, support weapons (the Grimoire), an arcane to swap in, the Focus school and the mod sets that fit, each with ✓ or ✕ for what you hold. A weapon's shows its ideal riven as players write it (CC · CD · MS, with harmless negatives such as −Zoom), from orbiter's rule and, once the Rivens page has read the weapon's listings, what players pay most for on warframe.market (underlined in gold); dispositions are flat since Hotfix 44.1.3; Yours says how close your rivens for it come.", "Tags (Steel Path, Support, Shield gating…) filter the builds in every tier. Paste a build from anywhere (Nox's Frame, a friend, Discord: orbiter reads the names and asks about the ones it can't place) or a Nox's Frame build code, make one with New, or Edit a copy of any. Builds from other people updated more than two years ago are hidden; change that by Hide older than (0: never).", "On Nox's Frame, under the tiers, lists the item's 5 most voted builds on noxsframe.com within that age limit, by their authors: Open reads one and shows it in its tier with what you're missing, Save or ★ keeps it. orbiter reads the list when you open the item and a build when you open it, never in the background, keeps each for a week and waits 3 seconds between reads. Turn it off in Settings, Builds.", "Popular on Overframe lists up to 5 of the item's builds with 10 votes or more, updated in the last two years, from orbiter's copy of Overframe's build lists (taken with Overframe's permission; Collected shows when). They're links only: each opens on overframe.gg in your browser, so its author gets the visit. orbiter never contacts Overframe, and a newer copy comes with an update.", "Kitgun chambers, zaw strikes, amp prisms, MOAs, Hounds, Predasites and Vulpaphylas also list their part recipes, ranked by orbiter from the wiki's part stats."]],
        ["mastery", "Mastery", "everything you haven't mastered, easiest first (the Codex rings at the top: click a category to show only what's left in it, again for all): five pips from Market-and-build to Liches, where it comes from and how, and the mastery it's worth. Modular gear is listed by the part its mastery goes by (a kitgun's chamber, a zaw's strike, an amp's prism, a MOA's or hound's model, a K-Drive's board), once, with the next step: where to buy that part, where to assemble it, where to gild the build, or level it once gilded. Open a prime for the relics that drop each missing part. Buy with plat lists what platinum gets you instead, cheapest first or least plat per mastery point: the missing parts (or the set) from players, or the in-game Market's price, each part with a Buy order button that posts one on warframe.market, and a running total of what buying down the list costs."],
        ["wishlist", "Wishlist", "what you've starred (the rings at the top: every category, how much of it you've mastered, and a gold ★ for how many you starred in it, a kitgun's chamber in Primary and Secondary both; click a starred one to go to them, any other to pick something on Foundry), with each missing part's way in: relics you hold (lit when a fissure of their era is open now), where to farm the ones you don't, or what buying it costs, with a Buy order button that posts one on warframe.market (your buy orders are listed on Orders). The gold percentage is the chance your relics finish it if you crack each once; orbiter can tell you when a fissure opens for them. Gear with nothing left to collect (a kitgun chamber in hand, an amp to gild) says its next step and who to see instead."],
        ["inventory", "Inventory", "everything you own in one list (gear, prime parts, relics, mods, arcanes, resources and blueprints), with what it's worth at the daily median (Market value), what sells quickly (Quick-sale value: what trades daily, kept copies too) and what you can spare (Spare value: every copy beyond what you keep; hover it for each kind's share), never counting more copies of an item than the whole market sells in a month. Beside it, Spare copies (every copy beyond what you keep) and Sell daily (items with spares that trade at least daily). A card's Spares is that row's share of Spare value, so the rows add up to it. Each is the price of one copy at its rank or refinement (an exceptional or flawless relic has none until one sells); Ducats (all) is for every copy held. Prime parts, Mods and Arcanes show Worth selling, the narrower figure: what's best sold for platinum and worth a trade. Narrow the list by kind, to what warframe.market trades, or to what sells at least so often. Not needed lists gear you can't trade and no longer need, to sell for credits: a weapon, frame or companion once you own and have mastered a better version (the Dual Decurion with Prisma Dual Decurions; a Prime and a Vandal aren't upgrades of each other), and extra copies of something mastered. It keeps back what you haven't mastered, what a recipe you haven't mastered takes, and one with its Incarnon installed when the better one has none; Keep takes one off the list. Each Collection page (Inventory, Prime parts, Sets, Mods, Arcanes, Rivens) opens on a showcase: up to five of its most valuable spares, large, by the page's own figure (Spare value, Worth selling, sets to sell); with nothing spare, the dearest things you hold; on Rivens, your best-graded rivens. Click one for its details."],
      ],
    },
    {
      title: "Running fissures",
      steps: [
        ["planner", "Planner → Complete sets", "pick the relics most likely to finish a set you're close to. Sets / crack is what a crack is worth toward finishing sets, not the Relics page's plat per crack.", "sets"],
        ["planner", "Planner → Make radiant", "spend Void Traces where they gain the most. The relic plate at the top shows your relics era by era (how many radiant) and the Void Trace meter: what you hold against the most you can (100 + 50 a Mastery Rank; traces past it are lost), a notch for every 100, one relic to Radiant.", "radiant"],
        ["relics", "Relics", "average plat per crack, intact against radiant (each reward at its price, or its ducats at your rate when that's more; a relic with an unpriced Prime part shows none). Click an era to see what you can crack in its fissures now. Solo or radshare is one setting, shared with the Planner and Home. The relic plate at the top: each era's relics you hold and how many are radiant (click an era there to show only its relics), and the Void Trace meter, what you hold against the cap (100 + 50 a Mastery Rank) and how many relics that refines to Radiant."],
        ["mission", "Current fissure", "once a void fissure loads, the squad's relics, and with four of them whether they're a 4×4, a 4b4 (one relic at one refinement; if not, which ones are off, \"Not 4×4: 1 intact Lith C13 differs\"). On the reward screen the cards stand side by side as the game shows them (the art, the rarity as the bar along the bottom, plat and ducats, need and set marks), and the one to take glows violet with Take this; before it opens, the squad's relics stand in their places. It scores every card (by default plat, then unmastered, then ducats, then completing a set; the weights are yours to change in Settings, Fissures, where you also say what a Forma Blueprint is worth to you: 3p unless you change it, twice that for a 2X Forma Blueprint, since it has no market price) and says which to take. No overlay or cards? It says why: solo runs show one card (nothing to choose), TennoScope wasn't running, or, on Windows, Warframe is in exclusive fullscreen (set Display Mode to Borderless). The TennoScope panel has a solid-background option for Windows if the overlay stays invisible. Copy for squad chat puts the four cards and their prices on your clipboard. This session: the missions so far, what the rewards come to in platinum and ducats, how many go toward gear you haven't built, and your Void Traces against the cap."],
      ],
    },
    {
      title: "Selling",
      steps: [
        ["market", "Orders", [
          "Your listings, kept at the cheapest in-game price. New listing finds what you hold; Copy trade-chat line puts your listings on the clipboard as one trade chat line. Click a column heading to sort by it (again for the other way); the order is kept.",
          "Whispered you: who whispered you this game session (from the game's log; the message isn't logged), with Invite (copies /invite name) and their warframe.market profile.",
          "Out of trades while buyers can see you, your status offers Go invisible until then: invisible until 00:00 UTC, then back to what you had.",
          "Check prices reads the order books and shows what each listing would change to (Will set, with why); Reprice sends those changes. A prime part or set is never listed or repriced at or under what its ducats are worth to you (your ducat rate, on Prime parts): it waits for Baro instead. Check and Apply automatically do it on a timer: unattended, a price is never more than halved, and one seller far under everyone else isn't followed.",
          "Floor and never-under keep prices from dropping too far, overall or per listing; Auto-price off leaves a price as you set it; Shown off hides a listing from buyers. Hide last copies (Settings, Trades): a whisper hides each listing down to its last copy for a while.",
          "Sold marks one sold (Sold several for more), with a few seconds to undo. A listing for more than you hold asks Sold?: Yes logs the sale and lowers the listing, No just lowers it.",
          "The tape under the title (Orders, Browse market, Sales, Stats): the page's live figures in a line (two on a narrow window); a gold ▲ or ▼ marks one that moved since you last looked at the page. On Orders: trades left today (as many as your Mastery Rank, refreshed at 00:00 UTC, counted from the game's log), listed value, listings to reprice and the last check.",
          "Put my spares on sale, folded at the top (one line until you open it), lists everything you tick in one go, after showing the plan in the order Apply sends it (removals, changes, new listings); applying, the row being sent is lit, each sent one is ticked and struck through, then leaves the list. It shows the plan, how many days of trades it would take and the credit tax for selling it all (you pay 500 credits for each platinum you're paid, plus 10% in Maroo's Bazaar; the buyer pays the item's own tax), with a warning when that's more credits than you have. Over warframe.market's 100 listings, More than 100 listings? Keep picks what gets the slots.",
          "Your status lives at the top and on Home (Online in game while TennoScope sees Warframe running). By keyboard, the arrow keys move along it and Enter or Space picks, so nothing is sent on the way. Your buy orders and riven auctions are listed below your listings.",
        ]],
        ["sets", "Sets", "complete sets you can sell (with what a set sells for over its parts, and how much faster it sells than its slowest part), sets one or two parts short, and Saving up: the sets your loose parts wait for, easiest first (about how many relic cracks finish each, and the chance the relics you hold do), what's still to get and where from (a relic you own, relics that still drop, Varzia, or parts you keep getting), and what buying the rest would cost. Home's fissure board marks the eras where a relic of yours drops one of those parts."],
        ["parts", "Prime parts", "every part with its best use: keep it to build, save it for its set, sell it alone or as a set, or trade it to Baro for ducats. Got (30d) is how many turned up in your inventory in the last 30 days, trades left out. Worth selling is what the parts best sold for platinum come to, no more of each than the market sells in a month (parts that go out in a whole set, and ones better as ducats, left out). Set what a ducat is worth to you here. Below, Ducats for less lists the parts that buy ducats cheapest before Baro comes, each with a Buy order button."],
        ["mods", "Mods", "spare mod copies to sell (your best copy and one to give away are always kept; five of each Requiem mod kept while a Kuva or Tenet weapon is left to master, and five of each Antivirus mod while a Coda one is, since liches, sisters and the Technocyte Coda take them), by default only ones that sell daily, and how many days of trades selling them all would take. Worth selling counts the spares of mods that sell daily, leaving out the ones not worth a trade (Not worth a trade under, set on Prime parts: judged on one trade of up to six copies), whatever the filters show."],
        ["arcanes", "Arcanes", "rank arcanes by price and see how close you are to maxing each; “Sell or dissolve” sorts your spare copies into ones to sell and ones worth more dissolved for Vosfor at Loid (copies are priced as maxed arcanes: one is 1/21 of a maxed one, since a pile of unranked copies rarely fetches their unranked price), and ranks his arcane packs by what you're still collecting (or by market price). Worth selling adds up the ones marked Sell, no more of each than the market sells in a month."],
        ["rivens", "Rivens", [
          "Your rivens graded roll by roll (a curse is marked harmless or hurts instead of graded: a curse on ammo, zoom or recoil costs nothing); after a price check, ★ N in demand under the grade counts the stats buyers pay clearly more for on that weapon, filtered by kind or spliced, with what rivens for the weapon traded for in game last week (Digital Extremes' weekly figures).",
          "Check prices: the cheapest riven listed for the weapon, similar ones' asking prices, and an Estimate of what a riven like it is listed for, with a range and what each stat does to it. Checks are kept, and refresh after a day when you open the page.",
          "Cycling a riven: press Sync at the cycle screen and the two rolls show side by side with which to keep and each one's Estimate; TennoScope's overlay shows them over the game for 25 seconds. A riven key (Settings, Overlays) reads them without switching windows.",
          "Find a riven: listings with their Estimate, the ones well under it marked, a Best deal sort, and alerts when one you want is listed at your price. Sell starts a buyout at the Estimate.",
        ]],
        ["browse", "Browse market", "everything warframe.market trades, yours or not, with what it sold for lately and how often it sells. Pick a category (Captura scenes, mods, arcanes…), set a price range or a minimum sold a day, and sort by any column. Sold weekly (on to start) leaves out things that sold less than once a week or on only a few days, whose prices can be jokes; turn it off to see everything. Open an item for its price history, or Buy order for the live cheapest seller and best buyer. The tape under the title: how many items the filters show, how many of them sell daily, and how many you hold."],
        ["sales", "Sales", "sales log themselves: when you give items for platinum in game, orbiter marks the listing sold on warframe.market and records the sale, and a notification says what you sold, to whom, for how much. Sold on a listing in Orders, or adding a sale here, does it by hand; Import brings in sales you marked sold on the website or app. Totals for today, 7 and 30 days, platinum per day, each sale against the market as it was that day, and what sells often enough to list more of. The tape under the title has today, the last 7 days and your best sale (the most one sale brought)."],
        ["stats", "Stats", "your inventory's value at each read (Market value and Quick-sale value, as Inventory counts them; the figures by the title are from the last read), platinum, credits, Endo, ducats and more over time (the last 30 days to start), what your relic runs come to per hour, the parts you got (from relics, missions or anything but a trade), profit by type and revenue (from the game's trade log), and every trade you've made; the sheet icon by Trade history saves them as a CSV in your Downloads folder (Sales has the same for your sales). The tape under the title: your inventory's value at the last read and how far it moved since the read before."],
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
          <li><button class="link" onclick={() => go(tab)}>{label}</button><span><Rich text={Array.isArray(text) ? text.join(" ") : text} {go} /></span></li>
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
        <li data-card="sections"><b>Each section its own colour:</b> the sidebar's four groups, and every page in them, carry one colour and sigil (over the title, on the label, along the open page's edge): Fissures Void violet, Progress mastery teal, Collection Arsenal steel, Trade market gold; folded to icons, a short rule in each colour parts the groups. Under each title sits that section's own strip: the reward screen or relic plate, the Codex rings, the showcase of your best spares, the market ticker.</li>
        <li data-card="showme"><b>Show me</b>, on a change in What's New, opens its page and lights up what changed. <b>Take the tour</b> steps through every change since you last opened orbiter, page by page (at the end of this Guide, each day's update has a tour of its own), with a bar at the bottom of the window: <kbd>→</kbd> or <kbd>Enter</kbd> for the next, <kbd>←</kbd> back, <kbd>Esc</kbd> to stop.</li>
        <li><b>Sync</b>, at the bottom of the sidebar, reloads your listings, the fissures and Baro; it fills as it goes and ticks when done.</li>
        <li><b>Keyboard:</b> <kbd>Ctrl</kbd>+<kbd>1</kbd>…<kbd>4</kbd> pages in sidebar order, <kbd>Ctrl</kbd>+<kbd>R</kbd> or <kbd>F5</kbd> sync, <kbd>Ctrl</kbd>+<kbd>,</kbd> settings, <kbd>F1</kbd> this guide, <kbd>Esc</kbd> closes a panel, <kbd>Ctrl</kbd>+<kbd>Q</kbd> quits.</li>
        <li><span class="ic"><Icon name="bell" /></span> <b>Notifications</b>: what orbiter told you lately (click one to open it), and under <b>Choose</b> which kinds you get, with a pause for all of them. Choose can also send the kinds you pick to a Discord channel (paste its webhook address), to get them on your phone while you're away.</li>
        <li>The gear opens Settings: your platform, which pages the sidebar shows, in what order, and which one orbiter opens on, the +rep message and automatic +rep.</li>
        <li data-card="updates"><b>Updates</b> (Settings, Updates): orbiter looks for a new build when it starts and every 6 hours, on the channel you pick: <b>Stable</b> (tested builds), <b>Beta</b> (the next Stable, a few days early) or <b>Experimental</b> (every change as soon as it's built; it may break). A new one shows in the bottom right corner with what changed: <b>Update and restart</b> downloads it (the button fills), checks its signature and restarts into it, and nothing installs without that click; <b>Later</b> hides it until the next. <b>Check now</b> asks at once and says on the button whether you're up to date. Switching to a more stable channel whose build is older offers it there by name (Switch to Stable's …), as a step back you take only by clicking. The Linux AppImage replaces its own file (it needs a folder you can write to) and the Windows installer runs by itself; a .deb or .rpm updates through your package manager. Release notes opens the build's page on GitHub.</li>
        <li>Animations follow your system's reduce-motion setting: with it on, things change at once without moving.</li>
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
  <PageHead title="Guide" brief="What each page is for." blurb="What each page is for. orbiter runs TennoScope for you in the background." />

  <section class="walks" aria-label="Walkthroughs" data-card="walks">
    {#each WALKS as w (w.title)}
      <article>
        <h2 class="mark">{w.title}</h2>
        <ol>{#each w.steps as [tab, page, what], i (i)}<li><button class="link" onclick={() => go(tab)} title="Open {page}">{page}</button> <span class="dim"><Rich text={what} {go} /></span></li>{/each}</ol>
      </article>
    {/each}
    {#if out.length}<p class="dim small hidden-pages"><Rich text={`${listed(out)} ${out.length === 1 ? "is" : "are"} out of your sidebar: put ${out.length === 1 ? "it" : "them"} back in Settings → Pages. Links to ${out.length === 1 ? "it" : "them"} still work, like these.`} {go} /></p>{/if}
  </section>

  <section class="routines">
    {#each ROUTINES as r (r.title)}
      <article>
        <h2 class="mark">{r.title}</h2>
        <ol>
          {#each r.steps as [tab, label, text, planner] (label)}
            {@const key = `${r.title}|${label}`}
            <!-- One line each, the page's name taking you there; the whole of it a click away. -->
            <li><button class="link" onclick={() => { if (planner) plannerMode = planner; go(tab); }} title="Open {label}">{label}</button>{#if openSteps[key]}{#if Array.isArray(text)}<ul class="sub" in:arrive={{ y: 0 }}>{#each text as t (t)}<li><Rich text={t} {go} /></li>{/each}</ul>{:else}<span in:arrive={{ y: 0 }}><Rich {text} {go} /></span>{/if}{:else}<span><Rich text={brief(text)} {go} /></span>{/if} <button class="more" aria-expanded={!!openSteps[key]} title={openSteps[key] ? "Less" : "Everything about it"} onclick={() => (openSteps[key] = !openSteps[key])}>{openSteps[key] ? "less" : "more"}</button></li>
          {/each}
        </ol>
      </article>
    {/each}
  </section>

  <section class="trust">
    <h3 class="register lead">What orbiter does to your game</h3>
    <ul>
      <li><b>Nothing.</b> orbiter never sends keys, clicks or anything else to Warframe. It reads Warframe's log file and its <code>EE.cfg</code> (for the display mode), and what TennoScope saves. It writes to warframe.market when you ask (a button: Sell, Sold, a price, Post buy order), when you turn on Apply automatically in Orders, when the game log shows you sold a listing (Settings, Trades), to give each player you trade with +rep with your message (on unless you turn it off in Settings, Trades), and, if you turn it on, to hide your last copies while someone whispers you.</li>
      <li data-card="fullmode"><b>Full mode</b> (off until you turn it on: <i>Read my inventory</i> in the first-run steps, the TennoScope panel or Settings): TennoScope reads the game's memory to find your session, read only, then downloads your inventory from the same address the official companion app uses. It doesn't write to the game either. Warframe's EULA forbids unauthorised third-party programs, so using Full mode could put your account at risk: that's your call. Without it, TennoScope only reads the log and the reward screen (Overlay mode), and orbiter shows everything that doesn't need your inventory.</li>
      <li>Mods: orbiter can't see which copy is fitted to a build, so it always keeps your best copy and one more. What it calls spare is past those two.</li>
      <li>Everything orbiter records (sales, trades, value over time, settings) stays on this computer. Your warframe.market sign-in is kept in the system keyring (a private file if there isn't one).</li>
    </ul>
  </section>

  <section class="cols">
    <article>
      <h3 class="register lead">Getting around</h3>
      <ul>
        <li><span class="ic"><Icon name="list" /></span> at the end of a row puts it on warframe.market without leaving the page: only the copies you can spare, priced at the cheapest seller in game. A padlock <span class="ic"><Icon name="lock" /></span> (or nothing) means you need what you have; the green <span class="ic good"><Icon name="listed" /></span> means it's on the market already (click to add more or change the price). Every icon says what it does when you hover it.</li>
        <li><b>Cards or rows:</b> collection pages show cards by default; <span class="ic"><Icon name="rows" /></span> above the cards switches that page to a sortable table, <span class="ic"><Icon name="cards" /></span> back, and it's remembered. A gold notch in a card's top corner marks one to look at: spares you can sell, gear you own but haven't mastered, a relic with a part you need, an arcane you've maxed (hover the notch for that card's reason). On round part icons, a gold ring is enough in hand, dashed is building; a relic's rewards are square, like the game's reward screen.</li>
        <li data-card="sections"><b>Each section its own colour:</b> the sidebar's four groups, and every page in them, carry one colour and sigil (over the title, on the label, along the open page's edge): Fissures Void violet, Progress mastery teal, Collection Arsenal steel, Trade market gold; folded to icons, a short rule in each colour parts the groups. Under each title sits that section's own strip: the reward screen or relic plate, the Codex rings, the showcase of your best spares, the market ticker.</li>
        <li data-card="showme"><b>Show me</b>, on a change in What's New, opens its page and lights up what changed. <b>Take the tour</b> steps through every change since you last opened orbiter, page by page (at the end of this Guide, each day's update has a tour of its own), with a bar at the bottom of the window: <kbd>→</kbd> or <kbd>Enter</kbd> for the next, <kbd>←</kbd> back, <kbd>Esc</kbd> to stop.</li>
        <li><b>Hover</b> over anything with a name (a relic, a part, a mod, an arcane, a warframe or weapon) for what it is: a relic's rewards with their odds and prices, where a part drops and what it sells for, a mod's effect at max rank. Move off it, scroll or press <kbd>Esc</kbd> to close it.</li>
        <li><b>Click a card or row</b> to open it: a warframe, weapon or companion opens its full details (stats, parts, drops, prices); other things show relic odds, how many you keep, and warframe.market links.</li>
        <li><b>Details</b>, by each page's title, shows the sentence under every figure, the full page description and every table column; off (the start), pages keep to the essentials and the rest is on hover. <b>More filters ▾</b> holds the filters most visits don't need (a number on it says how many are set; Clear puts them back).</li>
        <li><b>Keyboard:</b> <kbd>Ctrl</kbd>+<kbd>1</kbd>…<kbd>9</kbd> pages in sidebar order (change it in Settings → Pages), <kbd>Ctrl</kbd>+<kbd>PgUp</kbd>/<kbd>PgDn</kbd> (or <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Tab</kbd>/<kbd>Ctrl</kbd>+<kbd>Tab</kbd>) previous or next page (the next <kbd>Tab</kbd> carries on in that page; the first <kbd>Tab</kbd> in the window offers Skip to page), <kbd>Ctrl</kbd>+<kbd>K</kbd> find anything by name (an item opens its details, a relic, mod or arcane its page; the magnifier by Sync does the same), <kbd>Ctrl</kbd>+<kbd>F</kbd> or <kbd>/</kbd> the filter, <kbd>Tab</kbd> onto a button or figure shows what it does, <kbd>Ctrl</kbd>+<kbd>R</kbd> or <kbd>F5</kbd> sync, <kbd>Ctrl</kbd>+<kbd>,</kbd> settings, <kbd>F1</kbd> this guide, <kbd>Esc</kbd> closes a panel, <kbd>Ctrl</kbd>+<kbd>Q</kbd> quits.</li>
        <li><b>Sort</b> with the menu above the cards, or by clicking a column header in the table; click again (or <span class="ic"><Icon name="sort-desc" /></span> beside the menu) to flip the order. The same row has how many are shown and Cards or Table on every list page (Rivens' Check prices at its end).</li>
        <li><b>Nothing matches these filters · Clear</b>: a search or filter hid everything; Clear puts the search and filters back. A page only says it has nothing when there truly is nothing.</li>
        <li><b>Show</b> (Relics, Foundry) picks which ones the list shows; <b>Squad</b> on Relics values a crack solo or in a radshare.</li>
        <li>Filters and sorting stay as you left them while orbiter is open.</li>
        <li>A page that hits an error says so, with <b>Try again</b> to draw it afresh; the rest of orbiter keeps working, and the log (Settings) has what went wrong.</li>
        <li><b>Sync</b> (bottom of the sidebar) asks TennoScope to read your inventory from the game, fills while it waits for that new read (up to half a minute), and ticks once it's loaded; if no read comes, it says why under the button. When Warframe isn't running or TennoScope can't read the game, it re-reads what TennoScope last saved instead. Buttons that start longer work (Check prices on Orders and Rivens, Reprice, the spares plan) fill the same way and say how it went.</li>
        <li><b>TennoScope</b> under it opens its panel: whether it's healthy, screen-capture permission for the reward overlay, and inventory sync. Its light is green when all is well, gold when something wants a look, red when it isn't running or something failed.</li>
        <li>The sidebar folds to icons on narrow windows; the arrow next to the name folds or unfolds it, and orbiter remembers your choice.</li>
        <li>Animations follow your system's reduce-motion setting: with it on, things change at once without moving.</li>
        <li><span class="ic"><Icon name="bell" /></span> <b>Notifications</b>: what orbiter told you lately, newest first (click one to open what it's about; the number on the bell is how many are new), and under <b>Choose</b> a switch for each kind, with a pause for all of them. Each sale you make in game is told as it happens (what, to whom, for how much, and whether its listing was marked sold on warframe.market), so you don't have to look on the website; if you give +rep by hand, the notification has a +rep button for the buyer (on the desktop, Give +rep), and the reminder at the top goes once you press it or Not now. Besides your sales, listings and fissures, it can tell you when an alert or invasion rewards something you haven't mastered or something rare (a Catalyst or Reactor blueprint, Forma), when Baro brings something new to you, when Varzia's rotation has primes you need, and the Duviri Circuit's picks. While you're looking at orbiter they pop up in its corner; otherwise on your desktop, where clicking one (on Linux and Windows) brings orbiter up on what it's about. Choose can also send the kinds you pick to a Discord channel (paste its webhook address), to get them on your phone while you're away.</li>
        <li>On a wide window (1640 px and up), the <b>Watching</b> column on the right keeps what you choose in view on every page but Home (which shows it all already): your alerts, every open fissure, the open worlds' clocks, your Foundry, the best bounty rewards and your market. Its gear picks what it shows; » folds it away and the tab on the right edge brings it back.</li>
        <li>The gear opens Settings: your platform; which pages the sidebar shows, in what order, and which one orbiter opens on; starting TennoScope with orbiter and where it, its data and Warframe's log are; switching to Current fissure on the reward screen and how the pick is scored; what TennoScope's overlays show, and the riven key; +rep after trades, marking sales sold from the game, and hiding last copies while someone whispers you; whether veiled rivens and relics count as spare; and whether Builds reads builds from Nox's Frame.</li>
        <li data-card="updates"><b>Updates</b> (Settings, Updates): orbiter looks for a new build when it starts and every 6 hours, on the channel you pick: <b>Stable</b> (tested builds), <b>Beta</b> (the next Stable, a few days early) or <b>Experimental</b> (every change as soon as it's built; it may break). A new one shows in the bottom right corner with what changed: <b>Update and restart</b> downloads it (the button fills), checks its signature and restarts into it, and nothing installs without that click; <b>Later</b> hides it until the next. <b>Check now</b> asks at once and says on the button whether you're up to date. Switching to a more stable channel whose build is older offers it there by name (Switch to Stable's …), as a step back you take only by clicking. The Linux AppImage replaces its own file (it needs a folder you can write to) and the Windows installer runs by itself; a .deb or .rpm updates through your package manager. Release notes opens the build's page on GitHub.</li>
      </ul>
    </article>
    <article>
      <h3 class="register lead">What the marks mean</h3>
      <ul class="legend">
        <li><span class="k"><Avail v="farmable" /></span><span>a relic for it is still in the drop tables</span></li>
        <li><span class="k"><Avail v="vaulted" /></span><span>only vaulted relics drop it: no new copies</span></li>
        <li><span class="k"><Avail v="resurgence" /></span><span>vaulted, but Varzia sells it right now</span></li>
        <li><span class="k"><span class="tag good">✓ mastered</span></span><span>you've mastered it, or the item the part builds</span></li>
        <li><span class="k"><span class="tag mastery">level it</span></span><span>you own it but haven't mastered it</span></li>
        <li><span class="k"><span class="tag warn">need</span></span><span>a part for something you haven't built or mastered</span></li>
        <li><span class="k"><span class="notch-demo" aria-hidden="true"></span></span><span>a gold notch in a card's corner: one to look at; hover it for that card's reason ("10 spare to sell", "Not mastered", "Drops a part you need")</span></li>
        <li><span class="k"><PartChip part={{ label: "Chassis", name: "Chassis", image: null, required: 1, have: 3, resource: false, building: false, price: null, ducats: null, tradable: false }} size={26} /></span><span>a part ring: gold when you hold enough; the number is how many you hold (hover it: "Held: 3")</span></li>
        <li><span class="k"><span class="tag">★ Wishlist 4</span></span><span>on Foundry: only what you starred, from every category, with how many (hidden until you star something)</span></li>
        <li><span class="k"><span class="sell-demo"><Icon name="list" size={12} />Sell</span></span><span>on every card, rivens too: sell it on warframe.market (the form shows the price first; nothing is posted until you confirm)</span></li>
        <li><span class="k"><GameIcon name="kuva" size={16} /></span><span>on a riven, "3,100 Kuva spent · next roll 1,400": the Kuva its cycles have cost so far, and what the next cycle costs; "unrolled" ones were never cycled</span></li>
        <li><span class="k"><span class="rwd r"><i></i></span><span class="rwd u"></span><span class="rwd c"><b></b></span></span><span>a relic's rewards, as on the reward screen: frame and bar in its rarity, a gold diamond on a rare, a silver dot on an uncommon; a gold disc at the corner is a part you still need</span></li>
        <li><span class="k"><span class="sw" style:--c="var(--rarity-common)"></span><span class="sw" style:--c="var(--rarity-uncommon)"></span><span class="sw" style:--c="var(--rarity-rare)"></span></span><span>rarity, everywhere: bronze common, silver uncommon, gold rare (Rivens violet)</span></li>
        <li><span class="k">{#each ["lith", "meso", "neo", "axi", "requiem"] as e (e)}<span class="sw" style:--c="var(--era-{e})"></span>{/each}</span><span>relic eras: Lith copper, Meso olive, Neo silver, Axi gold, Requiem crimson</span></li>
        <li><span class="k"><span class="tag alert">stale</span></span><span>amber with a "!": wants a look (can't deliver, old prices, few trades left)</span></li>
        <li><span class="k"><span class="gold-word">Prime</span></span><span>in Orokin gold: Ash Prime apart from Ash at a glance</span></li>
        <li><span class="k"><span class="lastmark">last</span></span><span>on Planner: the last part a set is missing; Finishes counts the sets a crack could complete</span></li>
        <li><span class="k"><span class="tug-demo" aria-hidden="true"><i></i><i></i></span></span><span>an invasion: each side's colour, its sigil at the end; whoever fills the bar wins</span></li>
        <li><span class="k"><Icon name="m-survival" /> <Icon name="m-defense" /> <Icon name="m-exterminate" /></span><span>a fissure's mission type (Survival, Defense, Exterminate…); the faction sigil beside it is whom you fight</span></li>
        <li><span class="k"><span class="tag">keep 1</span></span><span>copies held back so you can still build and master it</span></li>
        <li><span class="k"><Effort acq={{ method: "market-credits", difficulty: 1, how: "", icon: null, available: true, tradable: false, researched: false, wiki: null }} compact /> … <Effort acq={{ method: "lich-sister", difficulty: 5, how: "", icon: null, available: true, tradable: false, researched: false, wiki: null }} compact /></span><span>how hard something is to get, from buy-and-build to Liches</span></li>
        <li><span class="k"><Metal kind="plat" /></span><span>platinum (warframe.market daily median)</span></li>
        <li><span class="k"><Metal kind="ducat" /></span><span>ducats</span></li>
        <li><span class="k"><Owned owned={{ Intact: 8, Radiant: 3 }} /></span><span>relics you hold, by refinement: intact, exceptional, flawless, radiant</span></li>
      </ul>
    </article>
    <article>
      <h3 class="register lead">Where the numbers come from</h3>
      <ul>
        <li>Inventory and mastery: TennoScope's last read of your account. When that was: “Last read” in the TennoScope panel, also shown at the bottom of the sidebar (“Synced …”) when it has its labels and you're not in a fissure.</li>
        <li>How to get things: researched item by item on the official wiki, and worked out from the game's drop tables for the rest.</li>
        <li>Gilding: modular gear gives mastery only after it's gilded (kitguns, zaws, amps, MOAs, hounds, Predasites and Vulpaphylas; K-Drives need none, Sirocco comes gilded). Rank it to 30, gild it with the vendor who builds it, then rank it to 30 again. Each chamber, strike, prism, model or board counts once, so a kitgun is the same mastery as a primary or a secondary. Whether a build is gilded comes from the patched TennoScope.</li>
        <li>Prices: the warframe.market summary TennoScope downloads when it starts (a note at the top says when it's a day or more behind). Orders uses live order books, but when everyone in game asks more than twice what something has sold for lately, it's priced at what it sells for (marked <b>sells for</b>): matching them, it would never sell.</li>
        <li>Relic prices by refinement: what each relic you hold sold for on warframe.market over the last 30 days, intact to radiant, read once a day while relic selling is on (TennoScope's summary mostly has the intact price only). Fewer than two sales: the intact price stands in. Relics have their own minimum on Orders, next to Never under, since they go in stacks.</li>
        <li>Your ducat rate: while Baro is here, the best price per ducat among what he sells that trades daily is worked out and offered next to Your rates on Prime parts.</li>
        <li>Fissures, Varzia and Baro (with his stock): api.warframestat.us, refreshed every few minutes. When it isn't answering, these, the Sortie, the Archon Hunt, the open worlds' bounties and the clocks are read from the game's own worldstate instead (its places named by WFCD's tables), and Home says so. The last read is kept for the next start (up to a day), so these show at once; each fissure, alert and offer in it goes when it ends.</li>
        <li>Relics, what each one holds at each refinement, and which are vaulted: the official drop tables (through drops.warframestat.us, checked twice a day), laid over TennoScope's relic list, so a new Prime Access's relics show up within a day or two even before TennoScope has them. A relic that drops nowhere is vaulted; Requiem relics never are: Requiem Eterna drops from Kuva Siphons and Kuva Floods (and Lich thralls), and Palladino sells the retired Requiem I–IV for Riven Slivers.</li>
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
        <li>The four reward cards: Warframe only logs your own, so orbiter gets them from a TennoScope changed to share them (orbiter's own, built from <code>tennoscope/</code>: <code>tennoscope/ORBITER.md</code>). That change also puts orbiter's score and <b>Pick</b> on TennoScope's overlay. Without it, Current fissure ranks everything the squad's relics can drop.</li>
      </ul>
    </article>
  </section>
{/if}

  <section class="news" aria-label="What's new" data-card="news">
    <div class="newshead">
      <h3 class="register lead">What's new</h3>
      <span class="dim small">Every update, newest first. Each day's changes count as one update.</span>
    </div>
    {#each updates as u (u.ids[0])}
      <div class="day">
        <h4 class="register">{longDay(u.date)} <span class="n">· {u.items.length} {u.items.length === 1 ? "change" : "changes"}</span></h4>
        {#if u.stops.length > 1}<button class="stamp" title="Step through the {u.stops.length} changes of {shortDay(u.date)} that have a place to show, each on its page, with a bar at the bottom of the window: arrow keys or Enter for the next, Esc to stop" onclick={() => startTour(u.stops)}>Tour {shortDay(u.date)} <span class="dim">{u.stops.length} stops</span></button>{/if}
      </div>
      <NewsItems items={u.items} {go} />
    {/each}
    <p class="dim small" data-card="build">This build: {#if updateState.line}orbiter {updateState.line}, {/if}{BUILD.commit}{BUILD.date ? `, ${BUILD.date}` : ""}. Say it when you report a problem.</p>
  </section>
</div></div>

<style>
  .walks { display: grid; grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); gap: 1rem 1.6rem; margin: 0 0 var(--course); }
  /* Two by two where four won't fit, so no walk sits alone on a row. */
  :global(html[data-room~="lt1100"]) .walks { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  :global(html[data-room~="lt640"]) .walks { grid-template-columns: 1fr; }
  .walks article { padding: .8rem 1rem; border: 1px solid var(--rule); background: var(--plate); }
  .walks h2 { font-size: 1.05rem; margin: 0 0 .5rem; }
  .walks ol { margin: 0; padding-left: 1.1rem; display: grid; gap: .35rem; font-size: .86rem; }
  .walks .hidden-pages { grid-column: 1 / -1; margin: 0; }
  .news { margin-top: var(--course); display: grid; gap: .5rem; max-width: 72rem; }
  .news h4 { margin: 0; font-size: .6rem; color: var(--platinum-deep); }
  .news h4 .n { letter-spacing: .1em; }
  .newshead { display: flex; align-items: baseline; gap: 1rem; }
  /* A day's heading, its tour at the right. */
  .day { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-top: .9rem; min-height: 2.4rem; }
  .newshead .lead { margin: 0; }
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
  /* The marks drawn as they are on the pages. */
  .rwd { position: relative; display: inline-block; width: 18px; height: 18px; border-radius: 3px; background: linear-gradient(180deg, #1d2026, var(--well)); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--c) 45%, transparent), inset 0 -3px 0 var(--c); margin-right: .15rem; }
  .rwd.r { --c: var(--rarity-rare); }
  .rwd.u { --c: var(--rarity-uncommon); }
  .rwd.c { --c: var(--rarity-common); }
  .rwd.r::before, .rwd.u::before { content: ""; position: absolute; top: -3px; left: 50%; }
  .rwd.r::before { width: 6px; height: 6px; margin-left: -3px; background: var(--rarity-rare); transform: rotate(45deg); }
  .rwd.u::before { width: 4px; height: 4px; margin-left: -2px; border-radius: 50%; background: var(--rarity-uncommon); }
  .rwd b { position: absolute; right: -3px; bottom: -3px; width: 7px; height: 7px; border-radius: 50%; background: var(--gold); box-shadow: 0 0 0 1.5px var(--plate); }
  .sw { display: inline-block; width: 10px; height: 10px; background: var(--c); }
  .sell-demo { display: inline-flex; align-items: center; gap: .3rem; padding: .15rem .45rem; border: 1px solid var(--rule-bright); font-family: var(--face-register); font-size: .58rem; letter-spacing: .1em; text-transform: uppercase; color: var(--platinum-dim); }
  .notch-demo { display: inline-block; width: 22px; height: 16px; border: 1px solid color-mix(in srgb, var(--gold) 30%, var(--rule)); background: linear-gradient(225deg, var(--gold) 0 7px, var(--plate) 7px); }
  .gold-word { font-family: var(--face-mark); font-weight: 700; text-transform: uppercase; color: var(--gold); }
  .lastmark { font-family: var(--face-register); font-size: .56rem; font-weight: 600; letter-spacing: .1em; text-transform: uppercase; color: var(--gold); }
  .tug-demo { display: inline-flex; width: 4.5rem; height: 4px; gap: 1px; }
  .tug-demo i { display: block; height: 100%; }
  .tug-demo i:first-child { width: 60%; background: var(--faction-grineer); }
  .tug-demo i:last-child { flex: 1; background: var(--faction-corpus); }
  .more { border: 0; background: none; padding: 0 .2rem; font-size: .62rem; letter-spacing: .1em; text-transform: uppercase; color: var(--gold-dim); cursor: pointer; }
  .more:hover { color: var(--gold); }
</style>
