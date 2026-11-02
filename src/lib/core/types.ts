import type { Invasion } from "./invasions";
import type { SyndicateMission } from "./board";
import type { WorldAlert } from "./worldNeeds";
// Shapes of the bundle the Rust side hands over (see crates/orbiter-data).

export interface InventoryRow {
  item_id: string;
  name: string;
  category: string; // arcane | blueprint | companion | frame | mod | prime_part | relic | resource | weapon
  quantity: number;
  mastered: boolean;
  image_name: string | null;
  rank: number | null;
  max_rank: number | null;
}

export interface Drop {
  location: string;
  chance: number;
  rarity: string;
}

export interface Component {
  uniqueName: string;
  name: string;
  itemCount?: number;
  ducats?: number;
  tradable?: boolean;
  imageName?: string;
  drops?: Drop[];
}

export interface CatalogItem {
  uniqueName: string;
  name: string;
  category: string;
  type?: string;
  tradable?: boolean;
  masterable?: boolean;
  isPrime?: boolean;
  vaulted?: boolean;
  masteryReq?: number;
  rarity?: string;
  imageName?: string;
  productCategory?: string;
  excludeFromCodex?: boolean;
  marketCost?: number;
  bpCost?: number;
  isAugment?: boolean;
  wikiaUrl?: string;
  maxRank?: number;
  components?: Component[];
  drops?: Drop[];
  // For the item details sheet (masterable gear only).
  description?: string;
  buildPrice?: number;
  /** Seconds. */
  buildTime?: number;
  buildQuantity?: number;
  health?: number;
  shield?: number;
  armor?: number;
  power?: number;
  sprintSpeed?: number;
  polarities?: string[];
  aura?: string;
  exilusPolarity?: string;
  passiveDescription?: string;
  abilities?: { name: string; description?: string; imageName?: string }[];
  criticalChance?: number;
  criticalMultiplier?: number;
  procChance?: number;
  fireRate?: number;
  totalDamage?: number;
  damage?: Record<string, number>;
  magazineSize?: number;
  reloadTime?: number;
  multishot?: number;
  accuracy?: number;
  trigger?: string;
  /** Riven disposition, 1 to 5 dots. */
  disposition?: number;
  omegaAttenuation?: number;
  slot?: number;
  releaseDate?: string;
  range?: number;
  followThrough?: number;
  noise?: string;
  /** Mods and arcanes: what they do at max rank, line by line. */
  maxStats?: string[];
  polarity?: string;
  baseDrain?: number;
  compatName?: string;
}

export interface RelicReward {
  name: string;
  rarity: string | null;
  chance: number | null;
}

export interface RelicEntry {
  uniqueName: string;
  name: string; // "Axi A1 Exceptional"
  vaulted?: boolean;
  tradable?: boolean;
  imageName?: string;
  rewards: RelicReward[];
  /** Where the relic drops, best chance first (percent). */
  drops?: Drop[];
}

export interface PriceFile {
  prices?: Record<string, number | null>;
  max_rank_prices?: Record<string, number | null>;
  carried_relic_prices?: Record<string, [number, string]>;
  trade_rate?: Record<string, [number, number, string]>;
  dump_date?: string;
}

export interface Bundle {
  observed_at: number | null;
  inventory: InventoryRow[];
  catalog: CatalogItem[];
  relics: RelicEntry[];
  prices: PriceFile | null;
}

/**
 * The desktop app sends the Bundle in two parts (see crates/orbiter-data `Collection`, `Catalogs`):
 * this one on every reload, the catalogs only when `catalog_rev` changes.
 */
export interface CollectionPart {
  observed_at: number | null;
  inventory: InventoryRow[];
  prices: PriceFile | null;
  /** Which catalog files are on disk; null: unknown, fetch the catalogs every time. */
  catalog_rev: string | null;
}

export interface CatalogPart {
  /** The catalog files these were read from, comparable with `CollectionPart.catalog_rev`. */
  rev: string | null;
  catalog: CatalogItem[];
  relics: RelicEntry[];
}

/** Live data from api.warframestat.us, optional. */
export interface Fissure {
  id: string;
  node: string;
  missionType: string;
  enemy: string;
  tier: string; // Lith | Meso | Neo | Axi | Requiem | Omnia
  tierNum: number;
  isStorm: boolean;
  isHard: boolean;
  expiry: string;
}

export interface VaultTraderItem {
  uniqueName: string;
  item: string;
  /** Varzia: the Regal Aya price (warframestat calls it ducats). */
  ducats?: number | null;
  /** Varzia: the Aya price, for relics. */
  credits?: number | null;
}

export interface BaroItem {
  uniqueName: string;
  item: string;
  ducats: number | null;
  credits: number | null;
}

export interface Baro {
  activation: string;
  expiry: string;
  location: string;
  /** What he sells; filled in only while he's here. */
  inventory?: BaroItem[];
}

export interface Live {
  fissures: Fissure[] | null;
  resurgence: VaultTraderItem[] | null;
  resurgenceExpiry: string | null;
  baro?: Baro | null;
  /** Running invasions, from the worldstate. */
  invasions?: Invasion[] | null;
  /** Running alerts, from the worldstate. */
  alerts?: WorldAlert[] | null;
  /** Some parts came from the game's own worldstate: api.warframestat.us couldn't give them. */
  fromGame?: boolean;
  /** Each syndicate's bounties (Cetus, Fortuna, the Necralisk), see board.ts. */
  syndicates?: SyndicateMission[] | null;
  /** The rest of today's worldstate, for the "worth doing today" card (see today.ts). */
  nightwave?: Nightwave | null;
  sortie?: SortieLike | null;
  archonHunt?: SortieLike | null;
  steelPath?: SteelPath | null;
  /** Darvo's daily deal in the in-game Market. */
  darvo?: DarvoDeal | null;
  duviriCycle?: DuviriCycle | null;
  /** When the invasions shown were read, if they're from a read kept from last time (they say nothing of when they end). */
  invasionsAt?: number;
  /** Events running in game: Tactical Alerts, operations, seasonal ones. */
  events?: WorldEvent[] | null;
  /** Day/night and the like on the open worlds: Earth, Cetus, Orb Vallis, Cambion Drift, Zariman; and Duviri's mood. */
  cycles?: WorldCycle[];
}

export interface DarvoDeal {
  item: string;
  /** The store path ("/Lotus/StoreItems/Weapons/…"): the item's own path without "StoreItems/". */
  uniqueName?: string;
  originalPrice: number;
  salePrice: number;
  discount?: number;
  total?: number;
  sold?: number;
  expiry: string;
}

export interface WorldCycle {
  key: "earth" | "cetus" | "vallis" | "cambion" | "zariman" | "duviri";
  /** "day", "night", "warm", "cold", "fass", "vome", "corpus", "grineer"; Duviri's mood: "joy", "anger", "envy", "sorrow", "fear". */
  state: string;
  expiry: string;
}

/** An event running in game (a Tactical Alert, an operation, a seasonal one), from the worldstate. */
export interface WorldEvent {
  id: string;
  description: string;
  tooltip?: string;
  node?: string;
  activation?: string;
  expiry: string;
  maximumScore?: number;
  currentScore?: number;
  rewards?: { items?: string[]; countedItems?: { type: string; count: number }[]; credits?: number }[];
  interimSteps?: { goal?: number; reward?: { items?: string[]; countedItems?: { type: string; count: number }[] } }[];
}

export interface Nightwave {
  expiry: string;
  activeChallenges: { id: string; title: string; desc: string; reputation: number; isDaily: boolean; isElite: boolean; expiry: string }[];
}
export interface SortieLike {
  expiry: string;
  boss: string;
  faction?: string;
  variants?: { missionType: string; node: string; modifier?: string; modifierDescription?: string }[];
  missions?: { type: string; node: string }[];
}
export interface SteelPath {
  currentReward: { name: string; cost: number } | null;
  expiry: string;
}
export interface DuviriCycle {
  /** The current mood's start and end (two hours); the Circuit's picks last the week. */
  activation?: string;
  expiry: string;
  state: string;
  choices: { category: string; choices: string[] }[];
}

/** What Warframe's EE.log says about the current fissure (see crates/orbiter-data/src/ee_log.rs). */
export interface MissionState {
  path: string | null;
  session: string | null;
  mission: string | null;
  relics: string[];
  last_relics: string[];
  reward_screen_open: boolean;
  rewards_given: string[];
  last_event: number | null;
  session_start: number | null;
  history: MissionEntry[];
  /** This session's trades that went through, read from the trade dialog in EE.log. */
  trades?: Trade[];
  /** Private chats that opened this session (someone whispered you). */
  whispers?: { name: string; uptime: number; at: number | null }[];
}

export interface TradeItem {
  name: string;
  rank: number | null;
  count: number;
}

export interface Trade {
  uptime: number;
  at: number | null;
  partner: string;
  offered: TradeItem[];
  received: TradeItem[];
  platinum_offered: number;
  platinum_received: number;
}

export interface MissionEntry {
  name: string;
  started_at: number | null;
  uptime: number;
  relics: string[];
  rounds: number;
  rewards: string[];
}
