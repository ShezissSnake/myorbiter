"""Trains orbiter's riven price model from listings collect.py read, and writes it for the app.

    python3 scripts/riven-model/train.py DATA_DIR src/lib/data/riven-model.json

DATA_DIR holds auctions.jsonl (collect.py), weekly.txt (Digital Extremes' weekly riven trades,
https://www-static.warframe.com/repos/weeklyRivensPC.json) and rw.json (warframe.market's
/v2/riven/weapons). Needs numpy, pandas and scikit-learn.

The model guesses what a riven is listed for on warframe.market (asking prices: the site keeps
no record of what rivens sold for) from what orbiter can work out for one of yours at any time:
its stats and how good each roll is, its weapon's riven kind, cycles, mastery, rank and polarity,
what that weapon's rivens traded for in game last week (DE's figures) and what the cheapest 60
listed for the weapon ask now (the "Any … riven from" search orbiter already makes). Gradient-
boosted trees on the log of the price: the middle guess (absolute error) and a lower and upper
quartile. The app walks the trees itself (src/lib/core/rivenModel.ts); `parity` below checks
the exported trees give scikit-learn's own numbers.
"""
import json, math, os, re, sys, collections, datetime
import numpy as np, pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.model_selection import GroupKFold

DATA, OUT = sys.argv[1], sys.argv[2]
TYPES = ["rifle", "shotgun", "pistol", "melee", "archgun", "kitgun", "zaw"]
POLS = ["madurai", "vazarin", "naramon"]
CAP = 1.5


def weekly(path):
    """{weapon name (lower case): {rerolled: (median or average, pop)}}"""
    out = {}
    for blk in re.findall(r"\{[^{}]*\}", open(path).read()):
        comp = re.search(r"compatibility:\s*'([^']*)'", blk)
        if not comp:
            continue
        get = lambda k: (re.search(rf"{k}:\s*([^,\n]+)", blk) or [None, ""])[1].strip()
        try:
            med = get("median")
            value = float(med) if med and med != "null" else float(get("avg"))
            out.setdefault(comp.group(1).lower(), {})[get("rerolled") == "true"] = (value, float(get("pop") or 0))
        except ValueError:
            pass
    return out


def load():
    W = {w["slug"]: w for w in json.load(open(os.path.join(DATA, "rw.json")))["data"]}
    week = weekly(os.path.join(DATA, "weekly.txt"))
    recs = []
    for line in open(os.path.join(DATA, "auctions.jsonl")):
        r = json.loads(line)
        p = r["price"]
        if not p or p < 5 or p > 50000 or r["weapon"] not in W:
            continue
        w = W[r["weapon"]]
        pos = [a for a in r["attributes"] if a["positive"]]
        neg = [a for a in r["attributes"] if not a["positive"]]
        wk = week.get(w["i18n"]["en"]["name"].lower(), {})
        rr = (r["rerolls"] or 0) > 0
        med, pop = wk.get(rr) or wk.get(not rr) or (None, 0)
        recs.append(dict(weapon=r["weapon"], seller=r["seller"], price=p, rtype=w.get("rivenType"), wk_med=math.log(med) if med and med > 0 else None, wk_pop=math.log1p(pop),
                         rerolls=r["rerolls"] or 0, mr=r["mr"] or 0, rank=r["rank"] or 0, pol=r["polarity"], pos={a["url_name"]: abs(a["value"]) for a in pos}, neg=neg[0]["url_name"] if neg else None))
    df = pd.DataFrame(recs)
    df = df[df.price <= 40 * df.groupby("weapon")["price"].transform("median")].reset_index(drop=True)
    df["cheap60"] = df.weapon.map({w: math.log(float(np.median(sorted(g.price)[:60]))) for w, g in df.groupby("weapon")})
    return df


def cfg_of(rtype, npos, neg):
    """Riven kind, buff count, curse or not: a stat's range depends on all three."""
    return f"{rtype}|{npos}|{1 if isinstance(neg, str) else 0}"


def features(df, ref, stats, negs):
    """The same numbers rivenModel.ts works out (see `featurize` there)."""
    cols = {}
    cols["wk_med"] = [m if m is not None and not (isinstance(m, float) and math.isnan(m)) else c for m, c in zip(df.wk_med, df.cheap60)]
    cols["wk_pop"] = df.wk_pop.tolist()
    cols["cheap60"] = df.cheap60.tolist()
    cols["rerolls"] = [math.log1p(x) for x in df.rerolls]
    cols["mr"] = df.mr.tolist()
    cols["maxed"] = [1 if x >= 8 else 0 for x in df["rank"]]
    cols["npos"] = [len(p) for p in df.pos]
    cols["hasneg"] = [1 if isinstance(n, str) else 0 for n in df.neg]
    for t in TYPES:
        cols["t_" + t] = [1 if x == t else 0 for x in df.rtype]
    for pl in POLS:
        cols["pol_" + pl] = [1 if x == pl else 0 for x in df.pol]
    cfgs = [cfg_of(t, len(p), n) for t, p, n in zip(df.rtype, df.pos, df.neg)]
    qs = [{s: min(CAP, v / ref[c + "|" + s]) if (c + "|" + s) in ref else 0.7 for s, v in p.items()} for c, p in zip(cfgs, df.pos)]
    for s in stats:
        cols["q_" + s] = [q.get(s, 0.0) for q in qs]
    for n in negs:
        cols["n_" + n] = [1 if x == n else 0 for x in df.neg]
    cols["qmean"] = [float(np.mean(list(q.values()))) if q else 0.0 for q in qs]
    return pd.DataFrame(cols)


def model(loss, quantile=None, iters=250, leaves=15):
    kw = dict(max_iter=iters, learning_rate=0.08, max_leaf_nodes=leaves, min_samples_leaf=40, l2_regularization=1.0, max_bins=64, random_state=0)
    return HistGradientBoostingRegressor(loss=loss, quantile=quantile, **kw) if quantile else HistGradientBoostingRegressor(loss=loss, **kw)


def export(m, names):
    """Each tree as flat arrays: leaf value, or feature, threshold (<= goes left), left, right."""
    trees = []
    for (pred,) in m._predictors:
        nodes = pred.nodes
        trees.append({
            "f": [int(n["feature_idx"]) if not n["is_leaf"] else -1 for n in nodes],
            "t": [float(n["num_threshold"]) if not n["is_leaf"] else 0 for n in nodes],
            "l": [int(n["left"]) for n in nodes],
            "r": [int(n["right"]) for n in nodes],
            "v": [round(float(n["value"]), 6) if n["is_leaf"] else 0 for n in nodes],
            "m": [1 if n["missing_go_to_left"] else 0 for n in nodes],
        })
    return {"base": float(np.ravel(m._baseline_prediction)[0]), "trees": trees}


def walk(exp, x):
    s = exp["base"]
    for t in exp["trees"]:
        i = 0
        while t["f"][i] != -1:
            i = t["l"][i] if x[t["f"][i]] <= t["t"][i] else t["r"][i]
        s += t["v"][i]
    return s


def main():
    df = load()
    print("listings", len(df), "weapons", df.weapon.nunique(), "sellers", df.seller.nunique())
    vals = collections.defaultdict(list)
    for t, p, n in zip(df.rtype, df.pos, df.neg):
        for s, v in p.items():
            vals[cfg_of(t, len(p), n) + "|" + s].append(v)
    ref = {k: round(float(np.percentile(v, 95)), 4) for k, v in vals.items() if len(v) >= 20 and np.percentile(v, 95) > 0}
    stats = sorted({s for p in df.pos for s in p})
    negs = sorted({n for n in df.neg if isinstance(n, str)})
    X = features(df, ref, stats, negs)
    y = np.log(df.price.values)
    # How it does on listings (and sellers) it didn't learn from, and on weapons it never saw.
    for label, groups in (("held-out sellers", df.seller.values), ("held-out weapons", df.weapon.values)):
        pred = np.zeros(len(df))
        for tr, te in GroupKFold(n_splits=5).split(X, y, groups):
            pred[te] = model("absolute_error").fit(X.iloc[tr].values, y[tr]).predict(X.iloc[te].values)
        e = np.abs(pred - y)
        print(f"{label}: typical error ×{math.exp(np.median(e)):.2f}, within ×2 {np.mean(e < math.log(2)) * 100:.0f}%")
    mid = model("absolute_error").fit(X.values, y)
    lo = model("quantile", 0.25, iters=150).fit(X.values, y)
    hi = model("quantile", 0.75, iters=150).fit(X.values, y)
    names = list(X.columns)
    out = {
        "version": 1,
        "trained": datetime.date.today().isoformat(),
        "listings": int(len(df)),
        "weapons": int(df.weapon.nunique()),
        "features": names,
        "stats": stats,
        "negs": negs,
        "ref": ref,
        "cap": CAP,
        "mid": export(mid, names),
        "lo": export(lo, names),
        "hi": export(hi, names),
    }
    # Parity: the exported trees give scikit-learn's numbers.
    sample = X.values[:: max(1, len(X) // 500)]
    for key, m in (("mid", mid), ("lo", lo), ("hi", hi)):
        diff = max(abs(walk(out[key], row) - p) for row, p in zip(sample, m.predict(sample)))
        assert diff < 1e-4, (key, diff)
    # A few listings as the app would see them, with the numbers they must come to: the app's own
    # test that its featurize and its walk of the trees agree with this script.
    picks = [i for i in range(0, len(df), max(1, len(df) // 7))][:6]
    out["checks"] = [{
        "input": {"rivenType": df.rtype[i], "attributes": [{"url_name": k, "value": v, "positive": True} for k, v in df.pos[i].items()] + ([{"url_name": df.neg[i], "value": -1, "positive": False}] if isinstance(df.neg[i], str) else []),
                  "rerolls": int(df.rerolls[i]), "mr": int(df.mr[i]), "rank": int(df["rank"][i]), "polarity": df.pol[i],
                  "weeklyMedian": None if df.wk_med[i] is None or (isinstance(df.wk_med[i], float) and math.isnan(df.wk_med[i])) else round(math.exp(df.wk_med[i]), 6), "weeklyPop": round(math.expm1(df.wk_pop[i]), 6), "cheap60": round(math.exp(df.cheap60[i]), 6)},
        "x": [float(v) for v in X.values[i]],
        "mid": float(mid.predict(X.values[i:i + 1])[0]),
    } for i in picks]
    json.dump(out, open(OUT, "w"), separators=(",", ":"))
    print("wrote", OUT, os.path.getsize(OUT) // 1024, "KB")


if __name__ == "__main__":
    main()
