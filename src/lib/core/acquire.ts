// How to get each thing you haven't mastered, and how hard that is, 1 (buy it in the Market and
// build it) to 5 (a Lich, or gone for good). Two sources: hand-researched entries from the wiki for
// the items the drop data can't explain (src/lib/data/acquisition.json), and rules over the drop
// data for the rest: where each blueprint and part comes from, what it needs, how rare it is.
import research from "../data/acquisition.json";
import dojoLabs from "../data/dojo.json";
import type { Model } from "./model";
import type { CatalogItem, Component } from "./types";

export type Method =
  | "level"
  | "build"
  | "relics"
  | "market-credits"
  | "syndicate"
  | "quest"
  | "dojo"
  | "baro"
  | "vendor"
  | "lich-sister"
  | "coda"
  | "incubator"
  | "open-world"
  | "boss"
  | "railjack"
  | "mission-drop"
  | "event"
  | "nightwave"
  | "other";

export const METHOD_LABEL: Record<Method, string> = {
  level: "Level it",
  build: "Build it",
  relics: "Relics",
  "market-credits": "Market",
  syndicate: "Syndicate",
  quest: "Quest",
  dojo: "Dojo",
  baro: "Baro Ki’Teer",
  vendor: "Vendor",
  "lich-sister": "Lich / Sister",
  coda: "Coda",
  incubator: "Incubator",
  "open-world": "Bounties",
  boss: "Boss",
  railjack: "Railjack",
  "mission-drop": "Missions",
  event: "Event",
  nightwave: "Nightwave",
  other: "Other",
};

export const DIFFICULTY_LABEL = ["Level it", "Easy", "Simple", "Some farming", "Grind", "Hard"] as const;
export const DIFFICULTY_TIP = [
  "You have it: only levelling left",
  "Buy it in the Market (or it's in hand) and build it",
  "An easy boss or a Nightwave pick, maybe one rare resource",
  "Relics, a quest, bounties, Baro or a syndicate's first ranks",
  "A long grind: high syndicate rank, rare drops, vaulted parts",
  "Liches, Sisters, Coda, or nearly out of reach",
] as const;

export interface Acquisition {
  method: Method;
  /** 0 = you have it, only levelling left; 1 easiest … 5 hardest. */
  difficulty: number;
  how: string;
  /** The syndicate or vendor icon that says where it comes from, when there is one. */
  icon: string | null;
  available: boolean;
  /** Its blueprint or parts can be bought from players. */
  tradable: boolean;
  /** Researched on the wiki rather than worked out from drop data. */
  researched: boolean;
  wiki: string | null;
  /** What players report about farming it (warframes: from forum and Steam threads), when researched. */
  players?: string | null;
}

interface Researched {
  method: Method;
  how: string;
  difficulty: number;
  available: boolean;
  tradable: boolean;
  source: string;
  /** Warframes: what players report, and the threads it comes from. */
  players?: string;
  evidence?: string[];
}
const RESEARCH = research as Record<string, Researched>;
/** Items whose blueprints come from clan dojo research, by lab (from the wiki's Research pages). */
const DOJO = dojoLabs as Record<string, string>;

// ---------------------------------------------------------------- mastery points

/** Mastery points for taking it to max rank: 200 a rank for frames, companions, archwings and
 *  K-Drives, 100 for weapons; Kuva, Tenet and Coda weapons, Paracesis and Necramechs go to 40. */
export function masteryPoints(item: Pick<CatalogItem, "name" | "category" | "type">): number {
  const big = item.category === "Warframes" || item.category === "Archwing" || item.category === "Sentinels" || item.category === "Pets" || item.type === "K-Drive Component" || item.type === "Archwing" || item.type === "Plexus";
  const forty = /^(Kuva|Tenet|Coda|Dual Coda) /.test(item.name) || item.name === "Paracesis" || item.type === "Necramech";
  return (forty ? 40 : 30) * (big ? 200 : 100);
}

// ---------------------------------------------------------------- syndicates

// Rank titles, 1–5, so a location like "Vox Solaris, Hand" says how far up you need to be.
const RANKS: Record<string, string[]> = {
  Ostron: ["Offworlder", "Visitor", "Trusted", "Surah", "Kin"],
  "Solaris United": ["Outworlder", "Rapscallion", "Doer", "Cove", "Old Mate"],
  "Vox Solaris": ["Operative", "Agent", "Hand", "Instrument", "Shadow"],
  Entrati: ["Stranger", "Acquaintance", "Associate", "Friend", "Family"],
  NecraLoid: ["Clearance Agnesis", "Clearance Modus", "Clearance Odima"],
  "The Holdfasts": ["Fallen", "Watcher", "Guardian", "Seraph", "Angel"],
  Ventkids: ["Glinty", "Whozit", "Proper Felon", "Primo", "Logical"],
  "The Quills": ["Mote", "Observer", "Adherent", "Instrument", "Architect"],
  "Kahl's Garrison": ["Encampment", "Settlement", "Fort", "Home"],
  Cavia: ["Assistant", "Researcher", "Colleague", "Scholar", "Illuminate"],
  "Steel Meridian": ["Brave", "Valiant", "Defender", "Protector", "General"],
  "Red Veil": ["Respected", "Honored", "Esteemed", "Revered", "Exalted"],
  "New Loka": ["Humane", "Bountiful", "Benevolent", "Pure", "Flawless"],
  "The Perrin Sequence": ["Associate", "Senior Associate", "Executive", "Senior Executive", "Partner"],
  "Cephalon Suda": ["Competent", "Intriguing", "Intelligent", "Wise", "Genius"],
  "Arbiters of Hexis": ["Principled", "Authentic", "Lawful", "Crusader", "Maxim"],
  "Operational Supply": ["Collaborator", "Champion"],
};

const SYNDICATE_ICON: Record<string, string> = {
  Ostron: "ostron",
  "Solaris United": "solaris-united",
  "Vox Solaris": "vox-solaris",
  Entrati: "entrati",
  NecraLoid: "necraloid",
  "The Holdfasts": "holdfasts",
  Ventkids: "ventkids",
  "The Quills": "quills",
  "Kahl's Garrison": "kahl",
  Cavia: "cavia",
  "The Hex": "hex",
  "Steel Meridian": "steel-meridian",
  "Red Veil": "red-veil",
  "New Loka": "new-loka",
  "The Perrin Sequence": "perrin",
  "Cephalon Suda": "suda",
  "Arbiters of Hexis": "hexis",
  "Cephalon Simaris": "simaris",
  Conclave: "conclave",
};

const METHOD_ICON: Partial<Record<Method, string>> = {
  "market-credits": "credits",
  baro: "baro",
  dojo: "dojo",
  relics: "relic-axi-intact",
  "lich-sister": "kuva",
  nightwave: "nightwave",
  level: "mastery",
  build: "foundry",
};

const RELAY_WEAPONS: Record<string, string> = {
  Sancti: "New Loka",
  Secura: "The Perrin Sequence",
  Vaykor: "Steel Meridian",
  Rakta: "Red Veil",
  Synoid: "Cephalon Suda",
  Telos: "Arbiters of Hexis",
};

/** "Vox Solaris, Hand" → syndicate, vendor and rank (1–5, or null if the title isn't known). */
function syndicateOf(loc: string): { name: string; vendor: string | null; title: string; rank: number | null } | null {
  const m = /^([^,(]+?)(?: \(([^)]+)\))?, (.+)$/.exec(loc);
  if (!m) return null;
  const name = m[1].trim();
  if (!(name in RANKS) && name !== "Cephalon Simaris" && name !== "Conclave") return null;
  const title = m[3].replace(/^Rank \d+:/, "").trim();
  if (title === "Neutral") return { name, vendor: m[2] ?? null, title, rank: 0 };
  const i = RANKS[name]?.indexOf(title) ?? -1;
  return { name, vendor: m[2] ?? null, title, rank: i >= 0 ? i + 1 : null };
}

// ---------------------------------------------------------------- one source of one part

interface Source {
  method: Method;
  difficulty: number;
  where: string;
  icon: string | null;
}

const BOSSES = /Assassinat|^(Jackal|Captain Vor|Janus Captain Vor|Kela De Thaym|Hunhow|Wolf Of Saturn Six|Exploiter Orb|Razorback|Phorid|Lephantis|Ambulas|Hyena|Raptor|Councilor Vay Hek|Tyl Regor|Sargas Ruk|Alad V|Ropalolyst|Erra|The Xoris|Roathe|Kuva Lich Agor Rok)\b/;
const STALKER = /^(Stalker|Shadow Stalker|Protector Stalker|Zanuka Hunter|Grustrag Three|Shik Tal|Vem Tabook|Leekter)/;
const the = (s: string) => s.replace(/^The /, "");
const RAILJACK = /^Veil Proxima\/|\(Skirmish\)|^Void Storm|Veil Proxima\)/;

/** Where one drop comes from, and roughly how much of a farm that is. */
function sourceOf(loc: string, chance: number): Source {
  const at = loc.replace(/,\s*Rotation [ABC]$/, "");
  if (at === "Cephalon Simaris") return { method: "vendor", difficulty: 3, where: "Cephalon Simaris, for his standing (from scanning)", icon: "simaris" };
  const syn = syndicateOf(at);
  if (syn?.name === "Cephalon Simaris") {
    const quest = /^Complete (.+)$/.exec(syn.title);
    if (quest) return { method: "quest", difficulty: 3, where: `the ${the(quest[1].replace(/ \(Quest\)$/, ""))} quest`, icon: null };
    if (/Daily Tribute/.test(syn.title)) return { method: "other", difficulty: 4, where: "a Daily Tribute milestone", icon: null };
    return { method: "quest", difficulty: 3, where: syn.title.replace(/^Unlock through /, "").replace(/^Defeat /, "defeating "), icon: null };
  }
  if (syn) {
    const rank = syn.rank;
    const where = `${syn.name}${syn.vendor ? ` (${syn.vendor})` : ""}${syn.title !== "Neutral" ? ` at ${syn.title}` : ""}`;
    return { method: "syndicate", difficulty: rank == null ? 3 : rank <= 1 ? 2 : rank <= 2 ? 3 : 4, where, icon: SYNDICATE_ICON[syn.name] ?? null };
  }
  if (/Bounty\)/.test(at)) {
    const place = /^[^/]+\/([^(]+)/.exec(at)?.[1]?.trim() ?? "open-world";
    const icon = /Cetus|Plains/.test(at) ? "ostron" : /Orb Vallis/.test(at) ? "solaris-united" : /Cambion/.test(at) ? "entrati" : /Zariman/.test(at) ? "holdfasts" : /Albrecht/.test(at) ? "cavia" : null;
    return { method: "open-world", difficulty: 3, where: `${place} bounties`, icon };
  }
  if (RAILJACK.test(at)) return { method: "railjack", difficulty: 4, where: "Railjack missions", icon: null };
  if (/^Operation[: ]|Event/.test(at)) return { method: "event", difficulty: 4, where: at, icon: null };
  if (STALKER.test(at)) return { method: "boss", difficulty: 4, where: `${at.split(" Assassinate")[0]} (shows up at random)`, icon: null };
  if (BOSSES.test(at)) {
    const boss = at.replace(/ Assassinate$/, "").replace(/^[^/]+\/([^(]+) \(Assassination\)$/, (_, b: string) => `the ${the(b.trim())} boss`);
    return { method: "boss", difficulty: chance >= 20 ? 2 : 3, where: boss, icon: null };
  }
  if (/Conclave/.test(at)) return { method: "other", difficulty: 3, where: "Conclave", icon: "conclave" };
  return { method: "mission-drop", difficulty: chance >= 10 ? 3 : 4, where: at.replace(/^([^/]+)\/(.+) \((.+)\)$/, "$2, $1 ($3)"), icon: null };
}

// ---------------------------------------------------------------- resources

/** Resources worth naming: rare, or only found in one place. Everyday ones are left out. */
const COMMON = new Set(["Salvage", "Alloy Plate", "Ferrite", "Polymer Bundle", "Rubedo", "Circuits", "Plastids", "Nano Spores", "Credits", "Blueprint"]);
const RARE = new Set(["Nitain Extract", "Tellurium", "Neural Sensors", "Argon Crystal"]);
/** Star-chart resources; anything else named in a build comes from an open world or a vendor. */
const STAR_CHART = new Set([...RARE, "Orokin Cell", "Neurodes", "Control Module", "Gallium", "Morphics", "Cryotic", "Oxium", "Kuva", "Forma", "Detonite Ampule", "Fieldron", "Mutagen Mass", "Detonite Injector", "Fieldron Sample", "Mutagen Sample", "Hexenon", "Scrap"]);
const isResource = (c: Component) => /\/MiscItems\/|\/Gems\/|\/Fish\/|\/Plants\//.test(c.uniqueName);
const isPart = (c: Component) => /\/Recipes\//.test(c.uniqueName) || /Blueprint$/.test(c.name);

// ---------------------------------------------------------------- an item

export interface AcquireContext {
  isPrime: boolean;
  owned: boolean;
  /** Prime parts that drop from relics (0: not a relic prime, like Excalibur Prime). */
  partsTotal: number;
  /** Founders' items and the like: no way to get it. */
  unobtainable: boolean;
  /** Primes: every part in hand. */
  buildable: boolean;
  /** `need`: copies still to get (two Blades), 1 when not given. */
  missingParts: { name: string; need?: number; availability: string; sources: { owned: number }[] }[];
  ownedRelicsForIt: number;
  /** Plat for the parts you're missing, at the daily median, if all are priced. */
  buyFor: number | null;
  /** Not relic primes: the blueprint and parts you hold, and the ones still to get ("Chassis"). */
  held?: string[];
  toGet?: string[];
  /** Every part in hand: what building still takes (buildPlan.ts), when the recipes are known. */
  build?: { tier: "now" | "farm" | "hard" | "parts"; short: string } | null;
}

/** Every part in hand: as easy as the resources still short make it. */
function buildAcquisition(ctx: AcquireContext): Pick<Acquisition, "method" | "difficulty" | "how" | "icon" | "available"> {
  const b = ctx.build;
  const base = { method: "build" as const, icon: "foundry", available: true };
  if (b?.tier === "farm") return { ...base, difficulty: 2, how: `You have every part. Still to farm before building: ${b.short}.` };
  if (b?.tier === "hard") return { ...base, difficulty: 4, how: `You have every part, but building needs ${b.short}, from an open world or an event.` };
  return { ...base, difficulty: 1, how: b?.tier === "now" ? "You have every part and resource: build it in the Foundry." : "You have every part: build it in the Foundry." };
}

const memo = new WeakMap<Model, Map<string, Acquisition>>();

export function acquisition(m: Model, item: CatalogItem, ctx: AcquireContext): Acquisition {
  if (ctx.owned) {
    return { method: "level", difficulty: 0, how: "You have it: take it to max rank.", icon: "mastery", available: true, tradable: false, researched: false, wiki: item.wikiaUrl ?? null };
  }
  if (ctx.unobtainable) {
    return { method: "other", difficulty: 5, how: "Not obtainable any more.", icon: null, available: false, tradable: false, researched: false, wiki: item.wikiaUrl ?? null };
  }
  if (ctx.isPrime && ctx.partsTotal > 0) return primeAcquisition(m, item, ctx);
  const a = otherAcquisition(m, item);
  if (ctx.buildable) return { ...a, ...buildAcquisition(ctx) };
  // Some of it in hand: say so before where the rest comes from.
  if (ctx.held?.length && ctx.toGet?.length) return { ...a, how: `You have the ${list(ctx.held)}; still to get: ${list(ctx.toGet)}. ${a.how}` };
  return a;
}

const list = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

function otherAcquisition(m: Model, item: CatalogItem): Acquisition {
  const r = RESEARCH[item.name];
  if (r) {
    return {
      method: r.method,
      difficulty: r.available || r.tradable ? r.difficulty : 5,
      how: r.how,
      // A syndicate's or vendor's own icon when the drop data names one (Vox Solaris for Baruuk).
      icon: METHOD_ICON[r.method] ?? fromDrops(m, item).icon ?? null,
      available: r.available,
      tradable: r.tradable,
      researched: true,
      wiki: r.source || item.wikiaUrl || null,
      players: r.players ?? null,
    };
  }
  return fromDrops(m, item);
}

/** What the drop data says, worked out once per item and model. */
function fromDrops(m: Model, item: CatalogItem): Acquisition {
  let cache = memo.get(m);
  if (!cache) memo.set(m, (cache = new Map()));
  const hit = cache.get(item.uniqueName);
  if (hit) return hit;
  const a = fromDropData(m, item, new Set());
  cache.set(item.uniqueName, a);
  return a;
}

function primeAcquisition(m: Model, item: CatalogItem, ctx: AcquireContext): Acquisition {
  const base = { icon: "relic-axi-intact", tradable: true, researched: false, wiki: item.wikiaUrl ?? null };
  if (ctx.buildable) return { ...base, ...buildAcquisition(ctx) };
  const missing = ctx.missingParts;
  const vaulted = missing.filter((p) => p.availability === "vaulted");
  const resurgence = missing.filter((p) => p.availability === "resurgence");
  const covered = missing.filter((p) => p.sources.some((s) => s.owned > 0)).length;
  const copies = missing.reduce((n, p) => n + (p.need ?? 1), 0);
  const buy = ctx.buyFor != null ? ` Or buy the ${copies === 1 ? "part" : `${copies} parts`} for about ${ctx.buyFor}p.` : "";
  if (vaulted.length) {
    return {
      ...base,
      method: "relics",
      difficulty: covered === missing.length ? 3 : 4,
      how: `${vaulted.length === missing.length ? "Vaulted" : `${vaulted.length} of ${missing.length} missing parts vaulted`}: ${covered ? `your relics cover ${covered} of ${missing.length}` : "only from relics you'd have to trade for"}.${buy}`,
      available: covered > 0 || resurgence.length > 0,
    };
  }
  return {
    ...base,
    method: "relics",
    difficulty: covered === missing.length ? 2 : 3,
    how: `${missing.length} missing part${missing.length === 1 ? "" : "s"} from ${resurgence.length ? "relics, some only from Varzia" : "relics still in the drop tables"}${covered ? `; you own relics for ${covered === missing.length ? "all of them" : `${covered} of ${missing.length}`}` : ""}.${buy}`,
    available: true,
  };
}

/** Worked out from where each blueprint and part drops, and what the build takes. */
function fromDropData(m: Model, item: CatalogItem, seen: Set<string>): Acquisition {
  seen.add(item.uniqueName);
  const comps = item.components ?? [];
  const parts = comps.filter((c) => !isResource(c) && (isPart(c) || c.drops?.length));
  const weapons = comps.filter((c) => !isResource(c) && !isPart(c) && m.catalogByUnique.get(c.uniqueName)?.masterable);
  const notable = comps.filter((c) => isResource(c) && !COMMON.has(c.name));

  // Where each part comes from: its likeliest drop, or the Market for a credits blueprint.
  const groups = new Map<string, { src: Source; names: string[] }>();
  let worst = 1;
  let method: Method | null = null;
  let icon: string | null = null;
  const take = (src: Source, name: string) => {
    const g = groups.get(src.where) ?? { src, names: [] };
    g.names.push(name);
    groups.set(src.where, g);
    if (src.difficulty > worst || method == null) {
      worst = Math.max(worst, src.difficulty);
      method = src.method;
      icon = src.icon;
    }
  };
  // A credits blueprint is the Market's, unless it's dojo research: then it's the clan's lab.
  const lab = DOJO[item.name];
  const market: Source = lab
    ? { method: "dojo", difficulty: 2, where: `your clan dojo's ${lab}${lab === "Dagath's Hollow" ? "" : " (once researched)"}`, icon: "dojo" }
    : { method: "market-credits", difficulty: 1, where: `the Market${item.bpCost ? ` (${item.bpCost.toLocaleString("en")} credits)` : ""}`, icon: "credits" };
  for (const c of parts) {
    const drops = c.drops ?? [];
    const name = c.name === "Blueprint" ? "Blueprint" : c.name.replace(new RegExp(`^${item.name} `), "");
    if (!drops.length) {
      // A part with no drops of its own is built from its blueprint: comes with the main one.
      if (c.name === "Blueprint" && (item.bpCost || lab)) take(market, name);
      continue;
    }
    // The easiest place it drops; but a blueprint the Market sells (or the dojo researches, parts
    // and all) comes from there, however many missions also drop it (Boltor: 15,000 credits, not
    // the 1% from Duviri's Endless).
    const best = drops.map((d) => sourceOf(d.location, d.chance)).sort((a, b) => a.difficulty - b.difficulty)[0];
    const bought = (lab || (c.name === "Blueprint" && item.bpCost)) && market.difficulty <= best.difficulty;
    take(bought ? market : best, name);
  }
  if (!groups.size && (item.bpCost || lab)) take(market, "Blueprint");

  // Built from other weapons (Akbronco from two Broncos): as hard as those.
  const needs: string[] = [];
  for (const c of weapons) {
    const sub = m.catalogByUnique.get(c.uniqueName);
    if (!sub || seen.has(sub.uniqueName)) continue;
    const r = RESEARCH[sub.name];
    const d = r ? r.difficulty : fromDropData(m, sub, seen).difficulty;
    worst = Math.max(worst, d);
    needs.push(`${(c.itemCount ?? 1) > 1 ? `${c.itemCount}× ` : ""}${sub.name}${m.owned(sub.uniqueName) > 0 ? " (you have one)" : ""}`);
  }
  if (notable.some((c) => RARE.has(c.name)) && worst < 2) worst = 2;
  if (notable.some((c) => !STAR_CHART.has(c.name)) && worst < 3) worst = 3;

  // Relay syndicates' own weapons: no drops, bought at the syndicate's top rank.
  const relay = Object.entries(RELAY_WEAPONS).find(([prefix]) => item.name.startsWith(`${prefix} `));
  if (!groups.size && relay) {
    const [, syn] = relay;
    return {
      method: "syndicate",
      difficulty: 3,
      how: `Bought from ${syn} at its top rank (${RANKS[syn].at(-1)}) for 125,000 standing; standing comes from daily missions with its sigil equipped.`,
      icon: SYNDICATE_ICON[syn],
      available: true,
      tradable: false,
      researched: false,
      wiki: item.wikiaUrl ?? null,
    };
  }
  if (!groups.size && !needs.length) {
    return { method: "other", difficulty: 3, how: "No drop data: check the wiki for how to get it.", icon: null, available: true, tradable: !!item.tradable, researched: false, wiki: item.wikiaUrl ?? null };
  }
  const where = [...groups.values()].map((g) => `${g.names.length === parts.length && parts.length > 1 ? "Everything" : g.names.join(", ")} from ${g.src.where}`);
  const res = notable.slice(0, 4).map((c) => `${(c.itemCount ?? 1).toLocaleString("en")} ${c.name}`);
  const how = [where.join("; "), needs.length ? `Built from ${needs.join(" and ")}` : "", res.length ? `Needs ${res.join(", ")}` : ""].filter(Boolean).join(". ") + ".";
  return {
    method: method ?? (needs.length ? "market-credits" : "other"),
    difficulty: Math.min(5, worst),
    how: how.charAt(0).toUpperCase() + how.slice(1),
    icon: icon ?? (method ? (METHOD_ICON[method as Method] ?? null) : null),
    available: true,
    tradable: comps.some((c) => c.tradable),
    researched: false,
    wiki: item.wikiaUrl ?? null,
  };
}

/** Total mastery a rank takes: 2,500·n² up to 30, then 147,500 more for each Legendary rank. */
export function rankThreshold(rank: number): number {
  return rank <= 30 ? 2500 * rank * rank : 2_250_000 + 147_500 * (rank - 30);
}
/** "MR 24", or "Legendary 2" past 30. */
export const rankLabel = (rank: number) => (rank > 30 ? `Legendary ${rank - 30}` : `MR ${rank}`);
