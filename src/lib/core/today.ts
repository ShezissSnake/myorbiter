// What's worth doing today, from the worldstate, marked against your collection: the Duviri
// Circuit's warframes and Incarnon adapters, Teshin's Steel Path offer, Nightwave, the Sortie and
// the Archon Hunt; and the week's Archimedeas, 1999 Calendar season and Descendia.
import type { Model } from "./model";
import { INCARNON, type GearCopy } from "./notNeeded";
import type { Live } from "./types";

export interface CircuitChoice {
  name: string;
  /** Warframes: you haven't mastered it. Incarnon: you own the weapon and hold no adapter for it. */
  wanted: boolean;
  note: string;
  image: string | null;
}

export interface Today {
  circuit: { frames: CircuitChoice[]; incarnons: CircuitChoice[]; resets: string } | null;
  /** `umbraIn`: weeks until Teshin offers Umbra Forma (0: this week), null when his rotation isn't known. */
  steelPath: { reward: string; cost: number; ends: string; umbraIn: number | null } | null;
  /** `standing`: the most the challenges still open can give, every one of them done. */
  nightwave: { standing: number; challenges: { title: string; desc: string; reputation: number; kind: "daily" | "weekly" | "elite"; expiry?: string }[]; ends: string } | null;
  sortie: { boss: string; faction: string; stages: { mission: string; node: string; modifier: string; desc: string }[]; ends: string } | null;
  archon: { boss: string; shard: string; missions: string[]; ends: string } | null;
  /** Darvo's daily deal; `wanted` when it's something masterable you haven't mastered or built. */
  darvo: { item: string; price: number; was: number; discount: number; left: number | null; ends: string; wanted: boolean; note: string | null } | null;
  /** The week's Deep and Temporal Archimedea: their missions, each with its deviation and risks (`hard`: one of the harder ones). */
  archimedeas: { kind: "Deep" | "Temporal"; missions: { type: string; deviation: string; deviationDesc: string; risks: { name: string; desc: string; hard: boolean }[] }[]; ends: string }[];
  /** The 1999 Calendar's season (a week): its prize days, the ones with a reward worth picking first. */
  calendar: { season: string; prizes: { day: string; choices: string[]; notable: boolean; pick: string }[]; ends: string } | null;
  /** The week's Descendia: how many Infernums (floors). */
  descendia: { floors: number; ends: string } | null;
}

/** Calendar prizes worth planning a week around: what you'd otherwise buy with platinum or rarely see. */
const NOTABLE_PRIZE = /Orokin (Catalyst|Reactor)|Forma|Adapter|Riven|Archon/i;
/** The Calendar's internal names for some prizes, as the game shows them. */
const PRIZE_NAME: Record<string, string> = {
  "Weapon Primary Arcane Unlocker": "Primary Arcane Adapter",
  "Weapon Secondary Arcane Unlocker": "Secondary Arcane Adapter",
  "6000 x Kuva": "6,000 Kuva",
};
/** "1999-08-17T00:00:00.000Z" → "17 Aug", the in-game date. */
const calendarDay = (iso: string) => {
  const d = new Date(iso);
  return Number.isFinite(+d) ? `${d.getUTCDate()} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()]}` : iso.slice(0, 10);
};

/** Weeks until Teshin's rotation reaches Umbra Forma: 0 when it's this week's offer. Null when unknown. */
export function umbraFormaIn(sp: Live["steelPath"]): number | null {
  const rot = sp?.rotation;
  const cur = sp?.currentReward?.name;
  if (!Array.isArray(rot) || !rot.length || !cur) return null;
  const at = rot.findIndex((r) => r?.name === cur);
  const umbra = rot.findIndex((r) => /Umbra Forma/i.test(r?.name ?? ""));
  if (at < 0 || umbra < 0) return null;
  return (umbra - at + rot.length) % rot.length;
}

/** The Circuit's choices change weekly, Monday 00:00 UTC. */
export function nextMondayUtc(now = Date.now()): string {
  const d = new Date(now);
  const days = (8 - d.getUTCDay()) % 7 || 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + days)).toISOString();
}

/** An Incarnon Genesis fits every variant of its weapon: Braton Prime, MK1-Braton, Dera Vandal, Dex Sybaris… */
const VARIANT_PREFIX = ["MK1-", "Prisma ", "Dex ", "Sancti ", "Secura ", "Synoid ", "Telos ", "Rakta ", "Vaykor ", "Mara "];
const VARIANT_SUFFIX = [" Prime", " Vandal", " Wraith"];
export const genesisVariants = (name: string) => [name, ...VARIANT_SUFFIX.map((s) => name + s), ...VARIANT_PREFIX.map((p) => p + name)];

const SHARD: Record<string, string> = { "Archon Amar": "Crimson", "Archon Nira": "Amber", "Archon Boreal": "Azure" };

/**
 * `gear`: each copy of your gear with its feature bits (TennoScope, patched): a copy with an
 * Incarnon Genesis installed means that weapon needs no adapter from the Circuit.
 */
export function today(m: Model, live: Live, now = Date.now(), gear: GearCopy[] | null = null): Today {
  const byName = new Map<string, { unique: string; category: string }>();
  for (const item of m.catalogByUnique.values()) if (item.masterable && !byName.has(item.name)) byName.set(item.name, { unique: item.uniqueName, category: item.category });
  const held = (name: string) => (m.inventoryByName.get(name) ?? []).reduce((n, r) => n + r.quantity, 0);
  const owns = (name: string) => {
    const it = byName.get(name);
    return !!it && m.owned(it.unique) > 0;
  };
  const mastered = (name: string) => {
    const it = byName.get(name);
    return !!it && m.isMastered(it.unique);
  };

  // Item paths with an Incarnon Genesis installed on at least one copy.
  const installedOn = new Set((gear ?? []).filter((g) => g && typeof g.f === "number" && (g.f & INCARNON) !== 0).map((g) => g.type));

  const cycle = live.duviriCycle;
  const normal = cycle?.choices.find((c) => c.category === "normal")?.choices ?? [];
  const hard = cycle?.choices.find((c) => c.category === "hard")?.choices ?? [];
  const circuit = cycle
    ? {
        frames: normal.map((name) => {
          const it = byName.get(name);
          const mastered = !!it && m.isMastered(it.unique);
          const has = !!it && m.owned(it.unique) > 0;
          return { name, wanted: !mastered && !has, note: mastered ? "mastered" : has ? "you have it" : "not mastered", image: m.imageOf(name) };
        }),
        incarnons: hard.map((name) => {
          const installed = genesisVariants(name).find((v) => installedOn.has(byName.get(v)?.unique ?? ""));
          const adapter = held(`${name} Incarnon Genesis`) > 0;
          // Held now: a weapon you mastered and sold would have to be built again first.
          const weapon = genesisVariants(name).some(owns);
          const sold = !weapon && genesisVariants(name).some(mastered);
          return {
            name,
            wanted: weapon && !adapter && !installed,
            note: installed ? `installed on ${installed}` : adapter ? "adapter in hand" : weapon ? "you have the weapon" : sold ? "mastered, but you don't have it now" : "no weapon for it",
            image: m.imageOf(`${name} Incarnon Genesis`) ?? m.imageOf(name),
          };
        }),
        resets: nextMondayUtc(now),
      }
    : null;

  const sp = live.steelPath;
  const steelPath = sp?.currentReward ? { reward: sp.currentReward.name, cost: sp.currentReward.cost, ends: sp.expiry, umbraIn: umbraFormaIn(sp) } : null;

  const nw = live.nightwave;
  const nightwave = nw
    ? {
        standing: nw.activeChallenges.filter((c) => !c.expiry || Date.parse(c.expiry) > now).reduce((n, c) => n + c.reputation, 0),
        // The ones that go soonest first (today's dailies), then the most standing.
        challenges: [...nw.activeChallenges]
          .filter((c) => !c.expiry || Date.parse(c.expiry) > now)
          .sort((a, b) => (Date.parse(a.expiry) || Infinity) - (Date.parse(b.expiry) || Infinity) || b.reputation - a.reputation)
          .map((c) => ({ title: c.title, desc: c.desc, reputation: c.reputation, kind: (c.isElite ? "elite" : c.isDaily ? "daily" : "weekly") as "daily" | "weekly" | "elite", expiry: c.expiry })),
        ends: nw.expiry,
      }
    : null;

  const s = live.sortie;
  const sortie = s
    ? { boss: s.boss, faction: s.faction ?? "", stages: (s.variants ?? []).map((v) => ({ mission: v.missionType, node: v.node, modifier: v.modifier ?? "", desc: v.modifierDescription ?? "" })), ends: s.expiry }
    : null;
  const a = live.archonHunt;
  const archon = a ? { boss: a.boss, shard: SHARD[a.boss] ?? "", missions: (a.missions ?? []).map((x) => `${x.type}: ${x.node}`), ends: a.expiry } : null;

  const d = live.darvo;
  const darvoItem = d ? (d.uniqueName ? m.catalogByUnique.get(d.uniqueName.replace("/StoreItems/", "/")) : undefined) ?? (byName.has(d.item) ? m.catalogByUnique.get(byName.get(d.item)!.unique) : undefined) : undefined;
  const darvoNote = darvoItem?.masterable ? (m.isMastered(darvoItem.uniqueName) ? "mastered" : m.owned(darvoItem.uniqueName) > 0 ? "you have it" : "not mastered") : null;
  const darvo = d
    ? {
        item: d.item,
        price: d.salePrice,
        was: d.originalPrice,
        discount: d.discount ?? Math.round((1 - d.salePrice / d.originalPrice) * 100),
        left: d.total != null && d.sold != null ? Math.max(0, d.total - d.sold) : null,
        ends: d.expiry,
        wanted: darvoNote === "not mastered",
        note: darvoNote,
      }
    : null;
  const open = (x: { expiry?: string } | null | undefined) => !!x && typeof x.expiry === "string" && !(Date.parse(x.expiry) <= now);
  const archimedeas = (Array.isArray(live.archimedeas) ? live.archimedeas : []).filter(open).flatMap((a) => {
    const key = (a.typeKey ?? a.type ?? "").replace(/\s+/g, "");
    const kind = key === "CT_LAB" ? ("Deep" as const) : key === "CT_HEX" ? ("Temporal" as const) : null;
    if (!kind) return [];
    const missions = (a.missions ?? []).filter((x) => typeof x?.missionType === "string").map((x) => ({
      type: x.missionType!,
      deviation: x.deviation?.name ?? "",
      deviationDesc: x.deviation?.description ?? "",
      risks: (x.risks ?? []).filter((r) => typeof r?.name === "string").map((r) => ({ name: r.name!, desc: r.description ?? "", hard: r.isHard === true })),
    }));
    return missions.length ? [{ kind, missions, ends: a.expiry }] : [];
  });
  const cal = open(live.calendar) ? live.calendar! : null;
  const prizes = (cal?.days ?? []).flatMap((d) => {
    const choices = (d?.events ?? []).filter((e) => e?.type === "Big Prize!" && typeof e.reward === "string").map((e) => PRIZE_NAME[e.reward!] ?? e.reward!);
    const best = choices.find((c) => NOTABLE_PRIZE.test(c));
    return choices.length ? [{ day: calendarDay(d.date), choices, notable: !!best, pick: best ?? choices[0] }] : [];
  });
  const calendar = cal && prizes.length ? { season: cal.season ?? "", prizes, ends: cal.expiry } : null;
  const ds = open(live.descendia) ? live.descendia! : null;
  const descendia = ds && Array.isArray(ds.challenges) && ds.challenges.length ? { floors: ds.challenges.length, ends: ds.expiry } : null;
  return { circuit, steelPath, nightwave, sortie, archon, darvo, archimedeas, calendar, descendia };
}
