# MyOrbiter's riven price model

`src/lib/data/riven-model.json` is what the Rivens page's **Estimate** walks: gradient-boosted
trees that guess what a riven like yours is listed for on warframe.market, from

- its stats and how good each roll is (against the top 5% of that stat for the same riven kind,
  buff count and curse),
- its curse, cycles, mastery, rank and polarity, and its weapon's riven kind,
- what its weapon's rivens traded for in game last week (Digital Extremes' weekly figures), and
- what the cheapest 60 rivens listed for its weapon ask now (MyOrbiter's own "Any … riven from"
  search, which a price check already makes).

The last two are read live, so the estimate follows the market as it moves. The trees, which say
how much each stat and roll is worth on top of that, are retrained now and then by hand:

Needs Python 3; `train.py` also needs numpy, pandas and scikit-learn.

```
python3 scripts/riven-model/collect.py 220   # 220 weapons (200 without the number); writes beside itself
python3 scripts/riven-model/train.py DATA_DIR src/lib/data/riven-model.json
```

`collect.py` reads PC listings with a fixed buyout for the 220 weapons whose rivens trade most (by DE's weekly figures):
for each, the cheapest and dearest 100, and the cheapest and dearest 100 with each of the stats
players look for. GET requests only, one at a time and at least 0.45 s apart, under an honest
User-Agent; it can be stopped and started again (it skips weapons done). It writes
`auctions.jsonl`, `seen.txt` and `done.txt` beside itself and needs `weekly.txt`
(https://www-static.warframe.com/repos/weeklyRivensPC.json) there. Point `train.py` at that
folder, with warframe.market's `/v2/riven/weapons` saved as `rw.json`. The listings themselves
aren't kept in the repo (they carry seller ids): `.gitignore` leaves out the `.jsonl`, `.txt` and
`rw.json` files there.

`train.py` prints how the model does on sellers and on weapons it didn't learn from, checks the
exported trees give scikit-learn's own numbers, and writes a few sample listings into the JSON
for `tests/rivenModel.test.ts`, which checks the app's featurize and tree walk give the same.

Asking prices, not sales: warframe.market keeps no record of what rivens sold for, and many
listings ask more than anyone pays. The estimate says what rivens like it are listed for, with
the middle half of them as a range.
