# Read-only collection of riven auctions from warframe.market for price-model research.
# GET only, one request at a time, >= 0.45 s apart, honest User-Agent. Output: auctions.jsonl
import json, time, urllib.request, urllib.parse, sys, os, re
SP = os.path.dirname(os.path.abspath(__file__))
UA = "orbiter-dev (read-only riven price research; gitlab.com/sheziss-group/orbiter)"
last = [0.0]
def get(url):
    wait = 0.45 - (time.time() - last[0])
    if wait > 0: time.sleep(wait)
    for attempt in range(4):
        last[0] = time.time()
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json", "Platform": "pc", "Language": "en", "Crossplay": "true"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(10 * (attempt + 1)); continue
            if e.code in (400, 404): return None
            time.sleep(3)
        except Exception:
            time.sleep(3)
    return None

weapons = get("https://api.warframe.market/v2/riven/weapons")["data"]
by_name = {w["i18n"]["en"]["name"].lower() if "i18n" in w else w.get("name","").lower(): w for w in weapons}
# DE's weekly trades: popularity per weapon name.
txt = open(os.path.join(SP, "weekly.txt")).read()
pop = {}
for m in re.finditer(r"compatibility:\s*'([^']*)'[^}]*?pop:\s*(\d+)", txt, re.S):
    pop[m.group(1).lower()] = pop.get(m.group(1).lower(), 0) + int(m.group(2))
ranked = sorted(weapons, key=lambda w: -pop.get((w["i18n"]["en"]["name"] if "i18n" in w else w.get("name","")).lower(), 0))
N = int(sys.argv[1]) if len(sys.argv) > 1 else 200
ranked = ranked[:N]
GUN = ["critical_chance", "critical_damage", "multishot", "base_damage_/_melee_damage", "toxin_damage", "fire_rate_/_attack_speed"]
MELEE = ["critical_chance", "critical_damage", "base_damage_/_melee_damage", "range", "critical_chance_on_slide_attack", "toxin_damage", "fire_rate_/_attack_speed", "status_chance"]
out = open(os.path.join(SP, "auctions.jsonl"), "a")
seen = set()
if os.path.exists(os.path.join(SP, "seen.txt")):
    seen = set(open(os.path.join(SP, "seen.txt")).read().split())
done = set(open(os.path.join(SP, "done.txt")).read().split()) if os.path.exists(os.path.join(SP, "done.txt")) else set()
seenf = open(os.path.join(SP, "seen.txt"), "a"); donef = open(os.path.join(SP, "done.txt"), "a")
base = "https://api.warframe.market/v1/auctions/search?type=riven&buyout_policy=direct&weapon_url_name="
for i, w in enumerate(ranked):
    slug = w["slug"]
    if slug in done: continue
    group = w.get("group") or w.get("rivenType")
    stats = MELEE if (w.get("rivenType") == "melee" or group in ("melee", "zaw")) else GUN
    queries = [("", "price_asc"), ("", "price_desc")] + [(s, o) for s in stats for o in ("price_asc", "price_desc")]
    n = 0
    for stat, order in queries:
        url = base + urllib.parse.quote(slug, safe="_") + f"&sort_by={order}" + (f"&positive_stats={urllib.parse.quote(stat, safe='_')}" if stat else "")
        d = get(url)
        if not d: continue
        for a in d.get("payload", {}).get("auctions", []):
            if a["id"] in seen or a.get("item", {}).get("type") != "riven": continue
            seen.add(a["id"]); seenf.write(a["id"] + "\n")
            it = a["item"]
            out.write(json.dumps({"id": a["id"], "weapon": slug, "price": a.get("buyout_price"), "starting": a.get("starting_price"), "top_bid": a.get("top_bid"),
                "rerolls": it.get("re_rolls"), "mr": it.get("mastery_level"), "rank": it.get("mod_rank"), "polarity": it.get("polarity"), "name": it.get("name"),
                "attributes": it.get("attributes"), "created": a.get("created"), "updated": a.get("updated"), "status": a.get("owner", {}).get("status"),
                "rep": a.get("owner", {}).get("reputation"), "seller": a.get("owner", {}).get("id")}) + "\n")
            n += 1
    out.flush(); seenf.flush()
    donef.write(slug + "\n"); donef.flush()
    print(f"{i+1}/{len(ranked)} {slug} +{n} total={len(seen)}", flush=True)
