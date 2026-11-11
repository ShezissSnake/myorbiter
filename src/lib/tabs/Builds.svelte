<script lang="ts">
  // Builds: mod and arcane loadouts for anything that takes them. Pick an item (yours first); its
  // builds come in three tiers by what they take (no Catalyst; a Catalyst; a Catalyst, Forma and
  // adapters), favourites first, then yours, then a site's, then MyOrbiter's own suggestion. Each shows
  // the Arsenal's slot grid, why it's in its tier, and what you're missing of it, with the cheapest
  // seller's whisper for a mod or arcane you lack. Modular gear also gets its part recipes.
  //
  // Sources: what you paste or make, MyOrbiter's suggestions, and any network source registered with
  // the builds core (source.ts: a site's, only with its permission on record): Nox's Frame, read on
  // demand when the setting is on (nox.ts), its top builds listed under the tiers to open. MyOrbiter
  // never reads Overframe: its popular builds come from a list bundled with the app (collected with
  // its permission, lists only), each a link to the build on overframe.gg, and its buttons open the
  // site in your browser.
  import { links, openUrl } from "../links.svelte";
  import Opening from "../ui/Opening.svelte";
  import type { Model } from "../core/model";
  import type { Settings } from "../backend";
  import type { CatalogItem, InventoryRow } from "../core/types";
  import {
    bestCopy,
    buildSources,
    buildsFor,
    filterByAge,
    missing,
    removeBuild,
    sanitizeMaxAgeDays,
    saveBuild,
    sourceBuilds,
    tierOf,
    toggleFavourite,
    newBuildId,
    withinAge,
    NOX_HOST,
    type Build,
    type MissingReport,
    type Tier,
    type TierResult,
  } from "../core/builds";
  import { canSuggest, heldFrom, modIndex, ownedFrom, suggest, toBuild, variantsFor, type RivenContext, type Suggestion } from "../core/builds/suggest";
  import { parseRiven, rivenTables, unpackListed, weaponSlug, type Riven } from "../core/rivens";
  import { rivens } from "../rivenStore.svelte";
  import { ageLine, arrange, buildableItems, isOverframe, buildKindOf, kindLabelOf, noxUrl, overframeUrl, recentItems, savedFrom, startingItems, tagsIn, TIER_MEANS, TIER_NAME, TIER_TIP, TIERS, withTags, type Shown } from "../core/buildsPage";
  import { byFamily } from "../ui/builds/tags";
  import { recipeItem } from "../core/recipes";
  import { takeIntent } from "../intent.svelte";
  import { shownPage, whenIdle, whileShown } from "../pane.svelte";
  import { UndoSlots } from "../undo.svelte";
  import { arrive, calm, flip, leave } from "../motion";
  import { useNox } from "../nox";
  import PageHead from "../ui/PageHead.svelte";
  import HelpMark from "../ui/HelpMark.svelte";
  import Art from "../ui/Art.svelte";
  import Thumb from "../ui/Thumb.svelte";
  import Count from "../ui/Count.svelte";
  import Icon from "../ui/Icon.svelte";
  import UndoSlot from "../ui/UndoSlot.svelte";
  import { kindIcon } from "../ui/GameIcon.svelte";
  import Segments from "../ui/Segments.svelte";
  import { kindSlot, SLOTS, SLOT_LABEL, type Slot } from "../core/kinds";
  import { buildDate } from "../core/builds/store";
  import ItemPicker from "../ui/builds/ItemPicker.svelte";
  import BuildCard, { type Extras } from "../ui/builds/BuildCard.svelte";
  import PasteDialog from "../ui/builds/PasteDialog.svelte";
  import BuildEditor from "../ui/builds/BuildEditor.svelte";
  import Recipes from "../ui/builds/Recipes.svelte";
  import NoxList from "../ui/builds/NoxList.svelte";
  import OverframeList from "../ui/builds/OverframeList.svelte";
  import Kind from "../ui/Kind.svelte";

  let { model, settings = $bindable() }: { model: Model; settings: Settings } = $props();
  // Nox's Frame: registered with the builds core on the first mount (then sourceBuilds includes it).
  const nox = useNox(() => settings.buildsFromNox);

  // ---------------------------------------------------------------- the item

  const items = $derived(buildableItems(model.catalogByUnique.values(), (u) => model.owned(u)));
  const byUnique = $derived(new Map(items.map((x) => [x.unique, x])));
  let pick = $state<string | null>(null);
  /** Items opened this session, newest first. */
  let opened = $state<string[]>([]);
  const recent = $derived(recentItems(opened, settings.builds).map((u) => byUnique.get(u)).filter((x) => !!x));
  // ---------------------------------------------------------------- nothing picked yet

  /** New build pressed with nothing picked: the picker asks what for, and the editor opens on the pick. */
  let wantNew = $state(false);
  let picker = $state<{ focus: () => void } | null>(null);
  /** Browse by kind: the picker lists one kind only. */
  let browse = $state<Slot | null>(null);
  /** The width the landing has, for how many cards fit in a row (more in a wider pane, never wider cards). */
  let landW = $state(0);
  const landWide = $derived(landW >= 990);
  const cardsN = $derived(Math.max(2, Math.min(5, Math.floor(((landWide ? landW - 316 : landW) + 16) / 256))));
  /** Your most built: the items with the most saved builds, then the most recent; without any, your most invested gear. */
  const mostBuilt = $derived.by(whileShown("builds", () => {
    const per = new Map<string, { n: number; last: number }>();
    for (const b of settings.builds) {
      if (isOverframe(b)) continue;
      const e = per.get(b.item) ?? { n: 0, last: 0 };
      e.n++;
      e.last = Math.max(e.last, buildDate(b));
      per.set(b.item, e);
    }
    const rows = [...per].flatMap(([u, e]) => {
      const c = model.catalogByUnique.get(u);
      const k = c ? buildKindOf(c) : null;
      return c && k ? [{ unique: u, name: c.name, label: kindLabelOf(c, k), fig: e.n, unit: e.n === 1 ? "build" : "builds", last: e.last }] : [];
    }).sort((a, b) => b.fig - a.fig || b.last - a.last);
    if (rows.length) return rows.slice(0, 9);
    return startingItems(items, (u) => { const c = bestCopy(model.gear, u); return c ? (c.p ?? 0) + (c.f & 1) : 0; }, 9)
      .map((x) => { const c = bestCopy(model.gear, x.unique); return { unique: x.unique, name: x.name, label: x.label, fig: c?.p ?? 0, unit: "Forma", last: 0 }; });
  }));
  /** The builds you saved or changed last, each with its tier and what you're missing of it. */
  const recentBuilds = $derived.by(whileShown("builds", () => {
    if (pick) return [];
    return [...settings.builds].filter((b) => !isOverframe(b)).sort((a, b) => buildDate(b) - buildDate(a)).slice(0, 8).flatMap((b) => {
      const it = model.catalogByUnique.get(b.item);
      const k = it ? buildKindOf(it) : null;
      if (!it || !k) return [];
      const t = tierOf(b, it, model.catalogByUnique, k);
      const r = missing(b, model, { tier: t });
      return [{ b, it, label: kindLabelOf(it, k), tier: t.tier, have: r.lines.length - r.todo, of: r.lines.length, todo: r.todo }];
    });
  }));
  /** Browse by kind: how many things of each kind take a build, and how many of them are yours. */
  const byKind = $derived(SLOTS.map((slot) => {
    const of = items.filter((x) => kindSlot(x.kind) === slot);
    return { slot, n: of.length, mine: of.filter((x) => x.owned).length };
  }).filter((r) => r.n));
  const kindMax = $derived(Math.max(1, ...byKind.map((r) => r.n)));
  const only = $derived(browse ? { label: SLOT_LABEL[browse], test: (x: { kind: string }) => kindSlot(x.kind) === browse } : null);
  function browseKind(slot: Slot) {
    browse = slot;
    picker?.focus();
  }
  function newBuild() {
    if (item && kind) {
      editing = { build: blank(), copy: false };
      return;
    }
    wantNew = true;
    picker?.focus();
  }
  function openBuild(b: Build) {
    choose(b.item);
    later(() => bring(b));
  }

  const item = $derived<CatalogItem | null>(pick ? (model.catalogByUnique.get(pick) ?? null) : null);
  const kind = $derived(item ? buildKindOf(item) : null);
  const label = $derived(item && kind ? kindLabelOf(item, kind) : "");

  /** Your copy that's furthest along, and the tier it stands at now. */
  const copy = $derived(pick ? bestCopy(model.gear, pick) : null);
  const copyTier = $derived<Tier | null>(!copy ? null : (copy.f & 1) && (copy.p ?? 0) > 0 ? "high" : copy.f & 1 ? "medium" : "low");
  const owned = $derived(pick ? model.owned(pick) > 0 : false);

  let tier = $state<Tier>("low");
  function choose(u: string) {
    if (!model.catalogByUnique.has(u)) return;
    pick = u;
    opened = [u, ...opened.filter((x) => x !== u)].slice(0, 12);
    showOld = false;
    picked = [];
    variantOf = { low: null, medium: null, high: null };
    const c = bestCopy(model.gear, u);
    tier = !c ? "low" : (c.f & 1) && (c.p ?? 0) > 0 ? "high" : c.f & 1 ? "medium" : "low";
    browse = null;
    // New build was pressed before anything was picked: its editor opens for what was just picked.
    if (wantNew) {
      wantNew = false;
      later(() => kind && (editing = { build: blank(), copy: false }));
    }
  }
  // A link may ask for an item: "builds?item=/Lotus/…" (Builds on an item's details), or its name.
  $effect(() => {
    const want = takeIntent("builds");
    if (!want?.item) return;
    const u = model.catalogByUnique.has(want.item) ? want.item : items.find((x) => x.name.toLowerCase() === want.item.toLowerCase())?.unique;
    // The page shows first; the item's builds a frame later.
    if (u) requestAnimationFrame(() => setTimeout(() => choose(u), 0));
  });

  // ---------------------------------------------------------------- the builds

  let showOld = $state(false);
  const now = $derived(model.observedAt ? Math.max(Date.now(), model.observedAt.getTime()) : Date.now());
  // Overframe's builds are links only (Overframe allows linking, not showing them): kept apart,
  // never in a tier, never drawn or checked against your inventory.
  const savedAll = $derived(pick ? buildsFor(settings.builds, pick).filter((b) => !isOverframe(b)) : []);
  const saved = $derived(showOld ? savedAll : filterByAge(savedAll, settings.buildsMaxAgeDays, now));

  // MyOrbiter's suggestions: from the mods you hold, for each tier, in the variant picked on its card.
  const rows = $derived([...model.inventoryByBase.values()].flat() as InventoryRow[]);
  const owns = $derived(ownedFrom(rows));
  /** Everything held (shards, companions, the Grimoire…), so the loadout can mark what you have. */
  const held = $derived(heldFrom(rows));
  let variantOf = $state<Record<Tier, string | null>>({ low: null, medium: null, high: null });
  const variants = $derived(item && canSuggest(item) ? variantsFor(item).map((v) => ({ id: v.id, label: v.label, tags: v.tags })) : []);
  // A weapon's ideal riven: your rivens for it, and the listings the Rivens page last read for it.
  const takesRiven = $derived(kind === "primary" || kind === "secondary" || kind === "melee" || kind === "archgun" || kind === "companionWeapon");
  $effect(() => {
    if (!takesRiven) return;
    void rivens.loadSaved(settings.market.platform);
    void rivens.loadMeta();
  });
  let tablesMemo: { cat: unknown; t: ReturnType<typeof rivenTables> } | null = null;
  const rivenCtx = $derived.by((): RivenContext | null => {
    if (!takesRiven || !item) return null;
    const tables = tablesMemo?.cat === model.catalogByUnique ? tablesMemo.t : (tablesMemo = { cat: model.catalogByUnique, t: rivenTables(model.catalogByUnique.values()) }).t;
    const mine = (settings.game.rivens ?? []).map((r) => parseRiven(model, tables, r)).filter((r): r is Riven => !!r);
    const slug = rivens.meta ? weaponSlug(rivens.meta, item.uniqueName, item.name) : null;
    const w = slug ? rivens.saved?.weapons[slug] : undefined;
    return { mine, market: w ? { listed: unpackListed(w.listed), at: w.at } : null };
  });
  let indexMemo: { cat: unknown; idx: ReturnType<typeof modIndex> } | null = null;
  const index = () => (indexMemo?.cat === model.catalogByUnique ? indexMemo.idx : (indexMemo = { cat: model.catalogByUnique, idx: modIndex([...model.catalogByUnique.values()]) }).idx);
  // Worked out when the app is idle after the page opens, so the first item picked answers at once,
  // in a quiet moment (lib/pane.svelte.ts). Again for a new collection only while the page is on
  // screen: out of sight, every sync would have it worked out again for nobody, on top of the sync.
  $effect(() => {
    void model;
    if (indexMemo && !shownPage("builds")) return;
    return whenIdle(() => {
      index();
      void owns;
    });
  });
  const suggestions = $derived.by((): Partial<Record<Tier, Suggestion>> => {
    if (!item || !canSuggest(item)) return {};
    try {
      const idx = index();
      return Object.fromEntries(TIERS.map((t) => [t, suggest(item, t, owns, idx, now, held, rivenCtx, variantOf[t])])) as Record<Tier, Suggestion>;
    } catch (e) {
      console.error("MyOrbiter's suggestion failed:", e);
      return {};
    }
  });
  const suggested = $derived(Object.fromEntries(Object.entries(suggestions).map(([t, s]) => [t, toBuild(s, now) as unknown as Build])) as Partial<Record<Tier, Build>>);

  // A network source's builds (Nox's Frame, when it's on): read once per item, on choosing it, with
  // no age limit (the page hides old ones itself, so "show" needs no second read).
  let net = $state<{ item: string | null; state: "none" | "reading" | "done"; builds: Build[]; errors: { source: string; label: string; error: string }[]; labels: string[] }>({ item: null, state: "none", builds: [], errors: [], labels: [] });
  let netTry = $state(0);
  $effect(() => {
    void netTry;
    const it = item;
    if (!it) return;
    const noxOn = settings.buildsFromNox;
    const sources = buildSources().filter((s) => s.network && (noxOn || s.id !== NOX_HOST));
    const labels = sources.map((s) => s.label);
    if (!sources.length) {
      net = { item: it.uniqueName, state: "none", builds: [], errors: [], labels };
      return;
    }
    net = { item: it.uniqueName, state: "reading", builds: [], errors: [], labels };
    let gone = false;
    void sourceBuilds(it, { catalog: model.catalogByUnique, maxAgeDays: 0, now: Date.now() }).then(
      (r) => {
        if (gone) return;
        const name = (id: string) => buildSources().find((s) => s.id === id)?.label ?? id;
        net = { item: it.uniqueName, state: "done", builds: r.builds.filter((b) => b.item === it.uniqueName && b.source !== "orbiter"), errors: r.errors.map((e) => ({ ...e, label: name(e.source), error: e.error.replace(/^Error:\s*/, "") })), labels };
      },
      (e) => {
        if (!gone) net = { item: it.uniqueName, state: "done", builds: [], errors: [{ source: "?", label: labels.join(", "), error: String(e) }], labels };
      },
    );
    return () => (gone = true);
  });
  /** Nox's Frame builds opened from its list this session (any item), newest first. */
  let noxOpened = $state.raw<Build[]>([]);
  const siteAll = $derived.by(() => {
    if (!pick) return [];
    const mine = noxOpened.filter((b) => b.item === pick);
    const ids = new Set(mine.map((b) => b.id));
    return [...mine, ...(net.item === pick ? net.builds : []).filter((b) => !ids.has(b.id))].filter((b) => !isOverframe(b));
  });
  /** Overframe links for the item: saved ones (from before, or pasted with an Overframe link) and any a permitted source lists. */
  const overframeLinks = $derived.by(() => {
    if (!pick) return [];
    const mine = buildsFor(settings.builds, pick).filter(isOverframe);
    const ids = new Set(mine.map((b) => b.id));
    const listed = (net.item === pick ? net.builds : []).filter((b) => isOverframe(b) && !ids.has(b.id));
    return [...mine, ...listed].map((b) => ({ build: b, saved: ids.has(b.id) }));
  });
  const siteFresh = $derived(siteAll.filter((b) => withinAge(b, settings.buildsMaxAgeDays, now)));
  const site = $derived(showOld ? siteAll : siteFresh);
  /** Nox's Frame's list shows (the setting on, an item that takes a build). */
  const noxShows = $derived(settings.buildsFromNox && !!item && !!kind);
  /** Nox's Frame's listed builds hidden for their age (NoxList's count). */
  let noxHidden = $state(0);
  /** Nox's Frame's listed builds shown. */
  let noxListed = $state(0);
  // Counted whether or not they're shown, so "Hide old ones" stays while they are.
  const hiddenOld = $derived(savedAll.length - filterByAge(savedAll, settings.buildsMaxAgeDays, now).length + siteAll.length - siteFresh.length + (noxShows ? noxHidden : 0));

  // Tiers and reports, worked out once per build (a build is replaced, never changed, when edited).
  const tiers = new WeakMap<Build, TierResult>();
  const tierFor = (b: Build): TierResult => {
    let t = tiers.get(b);
    if (!t && item && kind) tiers.set(b, (t = tierOf(b, item, model.catalogByUnique, kind)));
    return t!;
  };
  let reportsOf = $state.raw(new WeakMap<Build, MissingReport>());
  $effect.pre(() => {
    void model;
    reportsOf = new WeakMap();
  });
  const reportFor = (b: Build): MissingReport => {
    let r = reportsOf.get(b);
    if (!r) reportsOf.set(b, (r = missing(b, model, { tier: tierFor(b) })));
    return r;
  };
  const arranged = $derived(item && kind ? arrange(saved, site, suggested, tierFor) : { low: [], medium: [], high: [] });
  // Tags: the ones on this item's builds, every tier; picking some keeps the builds carrying them all.
  let picked = $state<string[]>([]);
  const tags = $derived(tagsIn(TIERS.flatMap((t) => arranged[t].map((s) => s.build))));
  const tagGroups = $derived(byFamily(tags));
  const filtered = $derived(Object.fromEntries(TIERS.map((t) => [t, withTags(arranged[t], picked)])) as Record<Tier, Shown[]>);
  const shown = $derived(filtered[tier]);
  const toggleTag = (t: string) => (picked = picked.includes(t) ? picked.filter((x) => x !== t) : [...picked, t]);
  const ready = (t: Tier) => filtered[t].filter((s) => reportFor(s.build).todo === 0).length;
  const extrasOf = (s: Shown): Extras | null => {
    if (s.build.source !== "orbiter" || s.saved) return null;
    const sug = Object.values(suggestions).find((x) => x?.id === s.build.id);
    if (!sug) return null;
    const t = sug.tier;
    return { why: sug.reasons, upgrades: sug.upgrades, loadout: sug.loadout ?? null, riven: sug.riven ?? null, variants, variant: sug.variant.id, onvariant: (id: string) => (variantOf = { ...variantOf, [t]: id }) };
  };

  // ---------------------------------------------------------------- changes

  const undo = new UndoSlots();
  $effect(() => () => undo.flush());
  /** The build just saved: it arrives with a gold edge. */
  let fresh = $state<string | null>(null);
  function keep(b: Build) {
    settings.builds = saveBuild(settings.builds, b);
    fresh = b.id;
    if (item && kind) tier = tierFor(b).tier;
    setTimeout(() => fresh === b.id && (fresh = null), 1200);
  }
  /** After the next paint: the dialog closes on the press, the list changes a frame later. */
  const later = (f: () => void) => requestAnimationFrame(() => setTimeout(f, 0));
  function fav(s: Shown) {
    if (s.saved) settings.builds = toggleFavourite(settings.builds, s.build.id);
    else settings.builds = saveBuild(settings.builds, { ...s.build, favourite: true, importedAt: s.build.source === "orbiter" ? Date.now() : s.build.importedAt });
  }
  function del(s: Shown) {
    undo.hold(s.build.id, () => (settings.builds = removeBuild(settings.builds, s.build.id)));
  }
  let pasting = $state(false);
  let editing = $state<{ build: Build; copy: boolean } | null>(null);
  function blank(): Build {
    return { id: newBuildId(), item: pick!, kind: kind!, mods: [], arcanes: [], shards: [], source: "mine", importedAt: Date.now() };
  }

  // ---------------------------------------------------------------- the age setting

  let ageText = $state(String(settings.buildsMaxAgeDays));
  $effect(() => {
    ageText = String(settings.buildsMaxAgeDays);
  });
  function setAge() {
    const n = Number(ageText);
    settings.buildsMaxAgeDays = sanitizeMaxAgeDays(ageText.trim() === "" ? 0 : n);
    ageText = String(settings.buildsMaxAgeDays);
  }

  const counts = $derived(Object.fromEntries(TIERS.map((t) => [t, filtered[t].length])) as Record<Tier, number>);

  // ---------------------------------------------------------------- Nox's Frame's list

  const noxError = $derived(net.item === pick ? (net.errors.find((e) => e.source === NOX_HOST)?.error ?? null) : null);
  /** Shows a build on the page: its tier, the tags and age that would hide it cleared, scrolled to, edged in gold. */
  function bring(b: Build) {
    if (!item || !kind) return;
    if (picked.length && !withTags([{ build: b }], picked).length) picked = [];
    if (!showOld && !withinAge(b, settings.buildsMaxAgeDays, now)) showOld = true;
    tier = tierFor(b).tier;
    fresh = b.id;
    setTimeout(() => fresh === b.id && (fresh = null), 1200);
    later(() => document.querySelector(`.builds > li[data-build="${CSS.escape(b.id)}"]`)?.scrollIntoView({ block: "start", behavior: calm.current ? "auto" : "smooth" }));
  }
  function noxOpen(b: Build) {
    noxOpened = [b, ...noxOpened.filter((x) => x.id !== b.id)];
    bring(savedAll.find((x) => x.id === b.id) ?? b);
  }
  function noxShow(url: string): boolean {
    const b = savedFrom(savedAll, url) ?? savedFrom(siteAll, url);
    if (!b) return false;
    bring(b);
    return true;
  }
</script>

{#snippet hero()}
  <div class="arsenal">
    <div class="find">
      <ItemPicker bind:this={picker} {model} {items} recent={recent.filter((r) => r.unique !== pick)} onpick={choose} autofocus={!pick} {only} onclear={() => (browse = null)} placeholder={wantNew ? "What is the new build for? Find a warframe, weapon, companion…" : undefined} />
      {#if recent.length}
        <div class="recent" aria-label="Recent">
          {#each recent.filter((r) => r.unique !== pick).slice(0, 5) as r (r.unique)}
            <button type="button" class="rc" title="Builds for {r.name}" onclick={() => choose(r.unique)}><Thumb file={model.imageOf(r.name)} size={20} />{r.name}</button>
          {/each}
        </div>
      {/if}
    </div>
    {#if item && kind}
      <div class="strip">
        <div class="art"><Art file={model.imageOf(item.name)} size={132} alt={item.name} fallback={kindIcon(item.type ?? label, item.name) ?? "foundry"} /></div>
        <div class="who">
          <span class="register"><Kind kind={label} /></span>
          <h2 class="mark nm">{item.name}</h2>
          <p class="yours">
            {#if owned}
              <span class="tag good" title="You have it">Yours</span>
              {#if copy}
                <span title="Your copy's Orokin {kind === 'warframe' || kind === 'companion' || kind === 'archwing' || kind === 'necramech' ? 'Reactor' : 'Catalyst'}" class:on={!!(copy.f & 1)}>{copy.f & 1 ? "✓" : "✕"} {kind === "warframe" || kind === "companion" || kind === "archwing" || kind === "necramech" ? "Reactor" : "Catalyst"}</span>
                <span title="Forma on your copy">{copy.p ?? 0} Forma</span>
                {#if kind === "warframe" || kind === "primary" || kind === "secondary" || kind === "melee"}<span title="Your copy's Exilus slot" class:on={!!(copy.f & 2)}>{copy.f & 2 ? "✓" : "✕"} Exilus</span>{/if}
              {:else}<span class="dim small">{model.gear ? "" : "Your copy's Catalyst and Forma show once the patched TennoScope reads your gear."}</span>{/if}
            {:else}<span class="dim">You don't have it yet.</span>{/if}
          </p>
          <div class="out">
            <button type="button" class="link" title="Find {item.name}'s builds on Overframe, in your browser (MyOrbiter never reads Overframe)" aria-busy={links.isOpening(overframeUrl(item!.name))} onclick={() => openUrl(overframeUrl(item!.name))}><Opening url={overframeUrl(item!.name)}>Overframe <Icon name="external" size={11} /></Opening></button>
            <button type="button" class="link" title="Open {item.name}'s builds on Nox's Frame in your browser" aria-busy={links.isOpening(noxUrl(item!.name, kind!, !!recipeItem(item!.uniqueName)))} onclick={() => openUrl(noxUrl(item!.name, kind!, !!recipeItem(item!.uniqueName)))}><Opening url={noxUrl(item!.name, kind!, !!recipeItem(item!.uniqueName))}>Nox's Frame <Icon name="external" size={11} /></Opening></button>
          </div>
        </div>
        <div class="tiers" role="tablist" aria-label="Investment">
          {#each TIERS as t (t)}
            <button type="button" role="tab" class="plate" class:lit={tier === t} aria-selected={tier === t} tabindex={tier === t ? 0 : -1} title="{TIER_TIP[t]} {counts[t]} build{counts[t] === 1 ? '' : 's'}{picked.length ? ' with the tags picked' : ''}{copyTier === t ? '. Your copy has what this tier takes' : ''}" onclick={() => (tier = t)} onkeydown={(e) => { if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); const i = (TIERS.indexOf(tier) + (e.key === "ArrowRight" ? 1 : 2)) % 3; tier = TIERS[i]; (e.currentTarget.parentElement?.children[i] as HTMLElement)?.focus(); } }}>
              <span class="tmark t-{t}" aria-hidden="true"><i></i><i></i><i></i></span>
              <b class="mark tn">{TIER_NAME[t]}</b>
              <span class="tm">{TIER_MEANS[t]}</span>
              <span class="tc"><Count value={counts[t]} /> build{counts[t] === 1 ? "" : "s"}{#if ready(t)}<span class="rd" title="Builds you have everything for">&nbsp;· {ready(t)} ready</span>{/if}</span>
              {#if copyTier === t}<span class="mine" title="Your copy has what this tier takes">Your copy</span>{/if}
            </button>
          {/each}
        </div>
      </div>
    {:else if !mostBuilt.length && !recentBuilds.length}
      <p class="lead dim">Pick anything that takes mods: a warframe or its exalted weapon, any weapon, a companion or its weapon, an archwing, arch-gun or arch-melee, a Necramech, a kitgun chamber, zaw strike or amp prism. Its builds, MyOrbiter's suggestion and what you're missing for each show here.</p>
    {/if}
  </div>
{/snippet}

<div class="page"><div class="page-inner">
  <PageHead title="Builds" help={{ hero: "builds.arsenal" }} brief="Mod builds for anything, and what you're missing." blurb="Mod and arcane builds for anything that takes them, in three tiers by what they take, with what you're missing of each against your inventory. Paste a build from anywhere, make your own, or start from MyOrbiter's suggestion." {hero} {action} />
  {#snippet action()}<button type="button" class="primary newb" title={item ? `Make a build of your own for ${item.name}, slot by slot` : "Make a build of your own: pick what it's for, then fill it slot by slot"} onclick={newBuild}><Icon name="plus" size={12} /> New build</button>{/snippet}

  {#if item && kind}
    <div class="bar">
      <h2 class="register th"><span class="tn2">{TIER_NAME[tier]}</span> · {TIER_MEANS[tier]}</h2>
      <span class="grow"></span>
      <button type="button" class="stamp" title="Paste a build from anywhere (Nox's Frame, a friend, Discord…), or a Nox's Frame build code: MyOrbiter reads the names" onclick={() => (pasting = true)}><Icon name="import" size={12} /> Paste a build</button>
      <label class="age" title="Builds from other people older than this are hidden (by their site's date, else when you added them). 0: never hidden. Yours and MyOrbiter's never are">
        <span class="register">Hide older than</span>
        <input type="number" min="0" step="30" bind:value={ageText} onchange={setAge} onkeydown={(e) => e.key === "Enter" && setAge()} aria-label="Hide builds older than this many days (0: never)" />
        <span class="register">days</span>
      </label>
      {#if hiddenOld}<button type="button" class="link" aria-pressed={showOld} title={showOld ? "Hide them again" : "Show the builds hidden for their age, this time only"} onclick={() => (showOld = !showOld)}>{showOld ? "Hide old ones" : `${hiddenOld} older hidden: show`}</button>{/if}
      <HelpMark part="builds.tier-bar" />
    </div>

    {#if tags.length}
      <div class="tagbar" data-card="tags" role="group" aria-label="Show builds tagged">
        {#each tagGroups as g (g.family)}
          <span class="tg"><span class="register">{g.family}</span>{#each g.tags as t (t)}<button type="button" class="tagchip" class:on={picked.includes(t)} aria-pressed={picked.includes(t)} title={picked.includes(t) ? `Showing builds tagged ${t}: click to drop it` : `Show only builds tagged ${t}${picked.length ? " (and the other tags picked)" : ""}`} onclick={() => toggleTag(t)}>{t}</button>{/each}</span>
        {/each}
        {#if picked.length}<button type="button" class="link" title="Show every build again" onclick={() => (picked = [])}>Clear tags</button>{/if}
        <HelpMark part="builds.tags" />
      </div>
    {/if}

    {#if net.state === "reading" && net.item === pick}
      <p class="netline reading" role="status"><span class="run" aria-hidden="true"></span>Reading {net.labels.join(" and ")}…</p>
    {:else if net.item === pick && net.errors.some((e) => e.source !== NOX_HOST || !noxShows)}
      <p class="netline bad" role="alert">{net.errors.filter((e) => e.source !== NOX_HOST || !noxShows).map((e) => `${e.label} didn't answer (${e.error})`).join("; ")}. <button type="button" class="link" title="Ask again" onclick={() => netTry++}>Try again</button></p>
    {/if}

    {#key `${pick}|${tier}`}
      <ul class="builds" in:arrive={{ y: 0 }}>
        <!-- MyOrbiter's suggestion keeps its place when its variant changes. -->
        {#each shown as s (s.place === "orbiter" && !s.saved ? "orbiter" : s.build.id)}
          <li class:fresh={fresh === s.build.id} data-build={s.build.id} animate:flip out:leave>
            {#if undo.has(s.build.id)}<UndoSlot label="Deleted" what={s.build.title ?? "the build"} onundo={() => undo.undo(s.build.id)} />
            {:else}
              <BuildCard {model} shown={s} report={reportFor(s.build)} extras={extrasOf(s)} {now}
                onfav={() => fav(s)}
                onedit={() => (editing = { build: s.build, copy: !s.saved || s.build.source === "orbiter" })}
                onsave={s.saved ? null : () => keep({ ...s.build, importedAt: Date.now() })}
                ondelete={s.saved ? () => del(s) : null}
              />
            {/if}
          </li>
        {/each}
      </ul>
      {#if !shown.length && picked.length && arranged[tier].length}
        <div class="empty">
          <p>No {TIER_NAME[tier].toLowerCase()} builds for {item.name} tagged {picked.join(" and ")}.</p>
          <div class="eacts"><button type="button" title="Show every build again" onclick={() => (picked = [])}>Clear tags</button></div>
        </div>
      {:else if !shown.length}
        <div class="empty">
          <p>No {TIER_NAME[tier].toLowerCase()} builds saved for {item.name} yet: paste one{noxShows && noxListed ? ", open one of Nox's Frame's below" : ""}{canSuggest(item) ? ", or start from MyOrbiter's suggestion in another tier" : ", or make your own"}.</p>
          <p class="dim small">{TIER_TIP[tier]}{#if hiddenOld} {hiddenOld} older build{hiddenOld === 1 ? " is" : "s are"} hidden for their age.{/if}</p>
          <div class="eacts">
            <button type="button" class="stamp" title="Paste a build from anywhere (Nox's Frame, a friend, Discord…), or a Nox's Frame build code" onclick={() => (pasting = true)}><Icon name="import" size={12} /> Paste a build</button>
            <button type="button" title="Make a build of your own, slot by slot" onclick={() => (editing = { build: blank(), copy: false })}><Icon name="plus" size={12} /> Make one</button>
          </div>
        </div>
      {/if}
    {/key}

    {#if noxShows}
      <NoxList {nox} {item} catalog={model.catalogByUnique} maxAgeDays={settings.buildsMaxAgeDays} bind:showOld ready={net.item === pick && net.state !== "reading"} readError={noxError} saved={settings.builds} onopen={noxOpen} onshow={noxShow} bind:hidden={noxHidden} bind:count={noxListed} />
    {/if}

    <!-- Overframe: its popular builds from MyOrbiter's bundled copy of its lists (links only, opened
         on overframe.gg), then the Overframe links you saved. -->
    <OverframeList {item} />

    {#if overframeLinks.length}
      <section class="ofr" data-card="overframe" aria-label="Saved from Overframe">
        <div class="hmark"><h2 class="register">Saved from Overframe</h2><HelpMark part="builds.saved-links" /></div>
        <p class="dim small">Overframe's builds open on overframe.gg: MyOrbiter keeps the link only.</p>
        <ul>
          {#each overframeLinks as o (o.build.id)}
            {@const src = o.build.source as { url: string; site: string }}
            <li animate:flip out:leave>
              {#if undo.has(o.build.id)}<UndoSlot label="Deleted" what={o.build.title ?? "the link"} onundo={() => undo.undo(o.build.id)} />
              {:else}
                <span class="ot"><b>{o.build.title ?? "Overframe build"}</b>{#if o.build.author}<span class="dim small"> by {o.build.author}</span>{/if}<span class="dim small"> · {ageLine(o.build, now)}</span></span>
                <button type="button" class="link out" title="Open it on Overframe, in your browser" aria-busy={links.isOpening(src.url)} onclick={() => openUrl(src.url)}><Opening url={src.url}>Open on Overframe <Icon name="external" size={11} /></Opening></button>
                {#if o.saved}<button type="button" class="ib quiet" title="Delete the link (you get a few seconds to undo)" aria-label="Delete the link" onclick={() => undo.hold(o.build.id, () => (settings.builds = removeBuild(settings.builds, o.build.id)))}><Icon name="trash" size={12} /></button>
                {:else}<button type="button" class="link" title="Keep the link with your builds" onclick={() => keep({ ...o.build, importedAt: Date.now() })}>Save link</button>{/if}
              {/if}
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if recipeItem(item.uniqueName)}<Recipes {model} unique={item.uniqueName} />{/if}
  {:else}
    <!-- Nothing picked: your most built, your recent builds against your inventory, and every kind
         to browse. A wider pane gets more cards and the side plates beside the main ones; a
         narrower one stacks them. -->
    <div class="landing" class:wide={landWide} bind:clientWidth={landW}>
      {#if mostBuilt.length}
        <div class="hmark"><h2 class="register">Your most built</h2><HelpMark part="builds.most-built" /></div>
        <div class="row">
          <ul class="cards" style:--n={cardsN} aria-label="Your most built">
            {#each mostBuilt.slice(0, cardsN) as r (r.unique)}
              <li><button type="button" class="mb" title="Builds for {r.name}" onclick={() => choose(r.unique)}>
                <span class="mbwell picwell"><Art file={model.imageOf(r.name)} size={104} plain alt="" name={r.name} fallback={kindIcon(r.label, r.name) ?? "foundry"} /></span>
                <span class="cap">
                  <span class="mbn mark">{r.name}</span>
                  <span class="mbf"><b class="mark">{r.fig}</b><span class="register">{r.unit}</span></span>
                  <span class="register mbk"><Kind kind={r.label} size={12} /></span>
                </span>
              </button></li>
            {/each}
          </ul>
          {#if mostBuilt.length > cardsN}
            <section class="side plate-box" aria-label="Also often built">
              <div class="plate-head"><span class="register">Also often built</span><HelpMark part="builds.also-built" /></div>
              <ul class="also">
                {#each mostBuilt.slice(cardsN, cardsN + 4) as r (r.unique)}
                  <li><button type="button" title="Builds for {r.name}" onclick={() => choose(r.unique)}>
                    <Thumb file={model.imageOf(r.name)} size={30} />
                    <span class="an"><b>{r.name}</b><span class="register"><Kind kind={r.label} size={11} /></span></span>
                    <span class="af mark">{r.fig}</span>
                  </button></li>
                {/each}
              </ul>
            </section>
          {/if}
        </div>
      {/if}
      <div class="row">
        {#if recentBuilds.length}
          <section class="plate-box recentb" aria-label="Recent builds">
            <table>
              <thead><tr><th>Recent builds</th><th class="c-for">For</th><th class="c-tier">Tier</th><th>Against your inventory</th><th class="right c-when">Changed</th></tr></thead>
              <tbody>
                {#each recentBuilds as r (r.b.id)}
                  <tr>
                    <td><button type="button" class="link rb" title="Open {r.b.title ?? 'this build'} on {r.it.name}" onclick={() => openBuild(r.b)}>{r.b.title ?? (r.b.source === "mine" ? "Your build" : "Pasted build")}</button></td>
                    <td class="c-for"><span class="dim"><Kind kind={r.label} label={r.it.name} size={12} /></span></td>
                    <td class="c-tier"><span class="tag">{TIER_NAME[r.tier]}</span></td>
                    <td><span class="inv"><Segments key="build:{r.b.id}:inv" value={r.have} max={Math.max(1, r.of)} fill label="{r.have} of {r.of} things this build takes, against your inventory" /><span class:dim={r.todo > 0}>{r.of && !r.todo ? "Complete" : `${r.todo} missing`}</span></span></td>
                    <td class="right dim c-when">{ageLine(r.b, Date.now()).replace(/^(added|updated) /, "")}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
            <HelpMark part="builds.recent" corner />
          </section>
        {/if}
        <section class="side plate-box" aria-label="Browse by kind">
          <div class="plate-head"><span class="register">Browse by kind</span><HelpMark part="builds.browse-kinds" /></div>
          <ul class="kinds">
            {#each byKind as k (k.slot)}
              <li><button type="button" class:on={browse === k.slot} aria-pressed={browse === k.slot} title="{k.n} {SLOT_LABEL[k.slot].toLowerCase()} take a build, {k.mine} of them yours: list them to pick one" onclick={() => browseKind(k.slot)}>
                <i class="share" style:transform="scaleX({k.n / kindMax})" aria-hidden="true"></i>
                <Kind kind={k.slot} label={SLOT_LABEL[k.slot]} />
                <b class="kn">{k.n}</b>
              </button></li>
            {/each}
          </ul>
        </section>
      </div>
    </div>
  {/if}
</div></div>

{#if pasting && item && kind}<PasteDialog {model} {item} {kind} onsave={(b) => { pasting = false; later(() => keep(b)); }} onclose={() => (pasting = false)} />{/if}
{#if editing && item && kind}<BuildEditor {model} {item} {kind} build={editing.build} copy={editing.copy} onsave={(b) => { editing = null; later(() => keep(b)); }} onclose={() => (editing = null)} />{/if}

<style>
  /* The hero: what you're building, as the Arsenal shows it, with the three tiers as its tabs. */
  .arsenal { display: grid; gap: .9rem; padding: .9rem 0 .2rem; border-top: 1px solid var(--rule); }
  .find { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem 1rem; }
  .recent { display: flex; flex-wrap: wrap; gap: .3rem; }
  .rc { display: inline-flex; align-items: center; gap: .4rem; padding: .18rem .55rem .18rem .2rem; font-family: var(--face-text); font-size: .8rem; letter-spacing: 0; text-transform: none; color: var(--platinum-dim); }
  .rc:hover:not(:disabled) { color: var(--platinum); }
  .lead { margin: 0; max-width: 72ch; font-size: .88rem; line-height: 1.6; }
  .strip { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 1.2rem; }
  .art { width: 132px; height: 132px; display: grid; place-items: center; }
  .who { display: grid; gap: .35rem; min-width: 0; }
  .nm { font-size: clamp(1.8rem, 3vw, 2.6rem); line-height: .9; overflow-wrap: anywhere; }
  .yours { margin: 0; display: flex; flex-wrap: wrap; align-items: center; gap: .2rem .9rem; font-size: .82rem; color: var(--platinum-deep); }
  .yours .tag { margin: 0; }
  .yours .on { color: var(--platinum); }
  .out { display: flex; gap: 1.1rem; }
  .out .link { display: inline-flex; align-items: center; gap: .3rem; font-size: .82rem; }

  .tiers { display: grid; grid-template-columns: repeat(3, 12.2rem); gap: .4rem; }
  .plate {
    all: unset; box-sizing: border-box; position: relative; cursor: pointer;
    display: grid; gap: .15rem; align-content: start; padding: .6rem .75rem .65rem;
    background: var(--plate); border: 1px solid var(--rule); clip-path: var(--cut);
    transition: background-color var(--snap) var(--out), transform var(--snap) var(--out);
  }
  .plate:hover { background: var(--raised); border-color: var(--rule-bright); }
  .plate:active { transform: translateY(1px); }
  .plate:focus-visible { outline: 2px solid var(--sec); outline-offset: -2px; }
  /* The tier picked: edged in the section's colour, as the Codex rings are. */
  .plate.lit { background: var(--raised); border-color: color-mix(in srgb, var(--sec) 60%, transparent); box-shadow: inset 0 -2px 0 var(--sec); }
  .tn { font-size: 1.35rem; line-height: .95; color: var(--platinum-dim); }
  .plate.lit .tn { color: var(--platinum); }
  .tm { font-family: var(--face-register); font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: var(--platinum-deep); }
  .plate.lit .tm { color: var(--sec); }
  .tc { font-size: .78rem; color: var(--platinum-dim); margin-top: .3rem; font-variant-numeric: tabular-nums; }
  .rd { color: var(--verdigris); }
  .mine { position: absolute; top: .45rem; right: .6rem; font-family: var(--face-register); font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: var(--gold); }
  /* The tier as rising bars: one, two, three lit. */
  .tmark { display: inline-flex; align-items: flex-end; gap: 2px; height: .85rem; margin-bottom: .25rem; }
  .tmark i { width: 4px; background: var(--rule-bright); }
  .tmark i:nth-child(1) { height: 40%; }
  .tmark i:nth-child(2) { height: 70%; }
  .tmark i:nth-child(3) { height: 100%; }
  .t-low i:nth-child(1), .t-medium i:nth-child(-n + 2), .t-high i { background: var(--sec-dim); }
  .plate.lit .t-low i:nth-child(1), .plate.lit .t-medium i:nth-child(-n + 2), .plate.lit .t-high i { background: var(--sec); }
  :global(html[data-room~="lt1100"]) .strip { grid-template-columns: auto minmax(0, 1fr); }
  :global(html[data-room~="lt1100"]) .tiers { grid-column: 1 / -1; grid-template-columns: repeat(3, minmax(0, 1fr)); }
  :global(html[data-room~="lt760"]) .art { width: 96px; height: 96px; }

  .bar { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem .8rem; margin: var(--step) 0 .8rem; }
  .th { margin: 0; font-size: 11px; }
  .tn2 { color: var(--sec); }
  .bar > button { display: inline-flex; align-items: center; gap: .35rem; }
  .age { display: inline-flex; align-items: center; gap: .4rem; }
  .age input { width: 4.6rem; text-align: right; padding: .3rem .45rem; }
  .tagbar { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem 1.2rem; margin: 0 0 .9rem; }
  .tg { display: inline-flex; flex-wrap: wrap; align-items: center; gap: .3rem; }
  .tg .register { font-size: 11px; margin-right: .2rem; }
  .tagchip { padding: .18rem .55rem; font-family: var(--face-text); font-size: .78rem; letter-spacing: 0; text-transform: none; color: var(--platinum-dim); }
  .tagchip.on { color: var(--slab); background: var(--sec); border-color: var(--sec); }
  .tagchip:focus-visible { outline: 2px solid var(--sec); outline-offset: 2px; }
  .netline { display: flex; align-items: center; gap: .6rem; margin: 0 0 .7rem; font-size: .82rem; color: var(--platinum-dim); }
  .netline.bad { color: var(--alert); }
  /* The band runs by transform (app.css, sweep-band), clipped to the bar. */
  .run { position: relative; overflow: hidden; width: 2.4rem; height: 2px; }
  .run::before { content: ""; position: absolute; inset: 0 auto 0 0; width: 40%; background: linear-gradient(90deg, transparent, var(--sec), transparent); animation: sweep-band 900ms linear infinite; }
  @media (prefers-reduced-motion: reduce) { .run { background: var(--sec-dim); } .run::before { display: none; } }

  .ofr { margin-top: var(--course); padding-top: var(--step); border-top: 1px solid var(--rule); }
  .ofr h2 { margin: 0 0 .3rem; color: var(--sec); font-size: .7rem; }
  .ofr .hmark { margin: 0 0 .3rem; }
  .ofr .hmark > h2 { margin: 0; }
  .ofr ul { list-style: none; margin: .5rem 0 0; padding: 0; display: grid; gap: .3rem; }
  .ofr li { display: flex; flex-wrap: wrap; align-items: center; gap: .4rem 1rem; padding: .5rem .75rem; background: var(--plate); border: 1px solid var(--rule); }
  .ot { flex: 1; min-width: 0; }
  .ot b { font-weight: 500; color: var(--platinum); }
  .ot .dim { margin-left: .35em; }
  .ofr .out { display: inline-flex; align-items: center; gap: .3rem; font-size: .82rem; }
  /* Nothing picked: the landing. Two columns (main, side) from a regular pane up; one below. */
  .landing { display: grid; gap: var(--step); margin-top: var(--step); }
  .landing h2 { margin: 0; }
  .row { display: grid; gap: 16px; align-items: start; }
  .landing.wide .row { grid-template-columns: minmax(0, 1fr) 300px; }
  .landing.wide .row > :only-child { grid-column: 1 / -1; }
  .plate-box { background: var(--plate-sheen), var(--plate); border: 1px solid var(--rule); box-shadow: var(--plate-light); min-width: 0; }
  .cards { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(var(--n), minmax(0, 1fr)); gap: 16px; }
  .mb {
    all: unset; box-sizing: border-box; cursor: pointer; display: grid; width: 100%; min-width: 0;
    background: var(--plate-sheen), var(--plate); border: 1px solid var(--rule); box-shadow: var(--plate-light);
    clip-path: polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 12px 100%, 0 calc(100% - 12px));
  }
  .mb:hover { border-color: var(--rule-bright); }
  .mb:focus-visible { outline: 2px solid var(--sec); outline-offset: -2px; }
  .mbwell { display: grid; place-items: center; height: 150px; margin: 8px 8px 0; }
  /* The caption: a flat bar of the section's colour above it. */
  .cap { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: 4px 12px; padding: 12px 14px 12px; border-top: 2px solid var(--sec); margin-top: 8px; }
  .mbn { font-size: 20px; line-height: 1.05; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--platinum); }
  .mbf { grid-row: span 2; display: grid; justify-items: end; gap: 2px; }
  .mbf b { font-size: 20px; line-height: 1; color: var(--platinum); font-variant-numeric: tabular-nums; }
  .mbf .register { font-size: 11px; }
  .mbk { font-size: 11px; min-width: 0; overflow: hidden; }
  .also { list-style: none; margin: 0; padding: 0; }
  .also li + li { border-top: 1px solid var(--rule); }
  .also button { all: unset; box-sizing: border-box; cursor: pointer; width: 100%; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 10px 14px; min-height: 56px; }
  .also button:hover { background: var(--raised); }
  .also button:focus-visible { outline: 2px solid var(--sec); outline-offset: -2px; }
  .an { display: grid; gap: 2px; min-width: 0; }
  .an b { font-weight: 600; color: var(--platinum); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .an .register { font-size: 11px; }
  .af { font-size: 18px; color: var(--platinum); font-variant-numeric: tabular-nums; }
  .recentb { position: relative; }
  .recentb :is(th, td):last-child { padding-right: 42px; }
  .recentb table { width: 100%; border-collapse: collapse; background: none; }
  /* The table's head row is the plate's head bar. */
  .recentb th { height: 36px; padding: 0 12px; text-align: left; font-family: var(--face-register); font-weight: 500; font-size: 12px; letter-spacing: .14em; text-transform: uppercase; color: var(--platinum-dim); border-bottom: 1px solid var(--rule); background: none; }
  .recentb td { height: 48px; padding: 0 12px; white-space: nowrap; border-bottom: 1px solid var(--rule); }
  .recentb tr:last-child td { border-bottom: none; }
  .recentb .right { text-align: right; }
  .rb { font-family: var(--face-text); font-size: 14px; font-weight: 600; letter-spacing: 0; text-transform: none; color: var(--platinum); text-decoration: none; text-align: left; }
  .rb:hover { text-decoration: underline; }
  .inv { display: inline-flex; align-items: center; gap: 12px; }
  /* Every row's meter the same length, whatever the build takes. */
  .inv > :global(.meter) { width: 140px; }
  .newb { display: inline-flex; align-items: center; gap: .45rem; }
  .kinds { list-style: none; margin: 0; padding: 0; }
  .kinds li + li { border-top: 1px solid var(--rule); }
  .kinds button { all: unset; box-sizing: border-box; cursor: pointer; position: relative; width: 100%; display: flex; align-items: center; gap: 12px; height: 36px; padding: 0 14px; color: var(--platinum); }
  /* A flat bar behind each count, its share of the largest kind. */
  .share { position: absolute; inset: 0; transform-origin: left center; background: color-mix(in srgb, var(--sec) 12%, transparent); pointer-events: none; }
  .kinds button > :global(.kind) { position: relative; }
  .kn { position: relative; margin-left: auto; font-family: var(--face-figures); font-variant-numeric: tabular-nums; }
  .kinds button:hover { background: var(--raised); }
  .kinds button.on { box-shadow: inset 2px 0 0 var(--sec); }
  .kinds button:focus-visible { outline: 2px solid var(--sec); outline-offset: -2px; }
  :global(html[data-room~="lt900"]) .c-tier, :global(html[data-room~="lt760"]) .c-for, :global(html[data-room~="lt640"]) .c-when { display: none; }
  .builds { list-style: none; margin: 0; padding: 0; display: grid; gap: .9rem; }
  .builds > li { min-width: 0; scroll-margin-top: 1rem; }
  .builds > li.fresh :global(.build) { box-shadow: 0 0 0 1px var(--gold); transition: box-shadow 1s var(--out); }
  .empty { padding: 1.4rem 1.2rem; border: 1px dashed var(--rule-bright); display: grid; gap: .4rem; justify-items: start; }
  .empty p { margin: 0; }
  .eacts { display: flex; gap: .5rem; margin-top: .4rem; }
  .eacts button { display: inline-flex; align-items: center; gap: .35rem; }
</style>
