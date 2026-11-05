# Testing log

One line per finished item: what was checked, what was found, and the commit. Newest last.
Property tests replay with `PROPERTY_SEED=<n>` and run longer with `PROPERTY_RUNS=<n>`.

| Item | Checked | Found | Commit |
| --- | --- | --- | --- |
| 1. Property tests, money logic | `tests/property.test.ts` (3,000 seeds each): listGuard (never past what the keep rules prove spare, never a never-sell item, never under its ducats, never on an untrusted read, whole copies and prices), inventory trust, modSpares (exact count, installed never spare, best and give-away copies kept), the ducat floor against exact integer arithmetic, the 70% repricing floor. `tests/propertyStores.test.ts` (400 seeds): overlapping sales that succeed or fail in any order, +rep in any case and order, timed repricing against random markets. Mutation check: each of 21 rules removed in turn, and a property failed every time (two properties were strengthened until they did). | A failed partial sale whose listing a later sale had closed on screen didn't come back (5 listed, sell 2, sell 3, the first fails: nothing shown instead of 2). Fixed in `marketStore.svelte.ts`. | e17999f |
