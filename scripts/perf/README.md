# Measuring where the time goes (WebKitGTK)

Measurement tools, not part of the app. They time the common actions on the demo account
(`demo/`, an invented player) in WebKitGTK 4.1, the engine the app uses on Linux. No request
leaves the machine: the page host blocks every URL that isn't `localhost`, and the demo's order
books stand in for warframe.market.

```sh
scripts/perf/measure.sh <outdir> [scenarios] [runs]   # everything below, about 45 minutes
PERF_PASSES=timings scripts/perf/measure.sh <outdir> nav 3   # one pass, some scenarios
```

Keep `<outdir>` out of the repository. Run it with nothing heavy alongside, and note what was
running: the numbers move with the load.

`measure.sh` builds the app twice with `vite.perf.config.ts`, serves both builds with the demo
data, and runs `run.mjs` against each:

- **plain build** (`timings.json`): a production build, as shipped. Timings come from here.
- **counting build** (`counts.json`, one run, `--timeline`): unminified, with counters in Svelte's
  runtime (`PERF_COUNT=1`): component mounts, effect runs and derived recomputations, per
  component. It also records the WebKit inspector's Timeline and JS sampling profiler.
- `chunks.json`: every output chunk and the modules in it, biggest first (sizes before
  minification).

The page runs in a real GTK window with GPU compositing and frames handed over through shared
memory, as the app runs with NVIDIA on Linux (`src-tauri/src/rendering.rs`). The window opens
in a nested, headless KWin (`kwin_wayland --virtual` under its own D-Bus session), so nothing
shows on the desktop. Without `PERF_WINDOW=1`, `host.py` uses an offscreen window instead, which
has no GL context: every frame is then painted on the CPU, and paint costs come out several
times higher than in the app.

## The parts

- `host.py`: the page host (system Python with `gi`). One WebView, throwaway website data, the
  local-only content filter, the remote inspector on (`WEBKIT_INSPECTOR_HTTP_SERVER`).
- `probe.js`: injected before the app's scripts. `__perf.measure(code)` runs an action and
  reports, in ms from the action: the next paint (`firstPaintMs`), the first paint showing a DOM
  change (`firstChangeMs`), and when the page settled (`settledMs`: no DOM change and no request
  in flight for `quiet` ms, with the 0.8 s and 2 s background polls ignored). It also reports the
  longest gap in a `setTimeout(0)` heartbeat (`longestTaskMs`: WebKit has no long-task observer,
  so this stands in for the longest task, JS or rendering, to about 4 ms), DOM mutations,
  requests, and the counters. `waitFetch` measures a tick that comes by itself (a poll) from
  when its request goes out.
- `inspector.mjs`: a client for WebKit's remote inspector. WebKitGTK 2.54's remote inspector
  reports every Timeline time as 0, so the Timeline gives counts (style recalculations, layouts,
  paints and the area painted), and the JS sampling profiler (about one sample per ms of JS)
  gives JS time and where it went.
- `scenarios.mjs`: what is measured. Each scenario gets a fresh app that has settled after the
  background warm-up opened every page, or (`cold`) one that has only drawn its first page:
  `nav` (every rail page, first and second visit), `navLayout` (the same with style+layout timed
  apart), `cold`, `tickInventory`/`tickMods`/`tickOrders` (a sync and a market poll on that page),
  `orders` (typing a price, Check prices), `spares` (five ticks), `settings` (the sheet),
  `afterNav` (the 4 s after a switch), `idle`, `quiet`, `animations`, `idleControl` and
  `checkButton` (what repaints by itself, and the Check prices button). The demo's TennoScope
  says the game is running in Full mode, so its Sync waits for a read that never comes; the tick
  scenarios (`syncReload`) have the probe report the game as not running, so Sync reloads the
  inventory file and rebuilds the model as after a real read.
- `run.mjs`: starts a host per scenario run, drives it, writes the JSON.
- Record timings (the app's own recorder, `src/lib/timing.ts`): `PERF_RECORD=1` switches it on
  for every scenario, to compare its cost against a run without it. The `tour` scenario switches
  it on, goes through every page and Sync, and each lap a long list scrolled (Inventory, Mods,
  Orders), an item's card and Settings opened and closed, for `PERF_TOUR_MS` (5 minutes); it returns
  the report the app wrote (Settings › Logs › Copy timing report).

## Reading the numbers

The budget (design rules): every click ≤ 100 ms to the next paint, no task over 50 ms on common
actions. Runs vary by a frame or two; compare medians of the same build before and after a
change. Image decoding isn't measured: the demo's item images come from the internet, which the
host blocks. Tauri commands (`presence_state`, `market_feed_state`, `data_stamp`…) don't exist in
the browser build, so their cost isn't in these numbers either.
