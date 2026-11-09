#!/usr/bin/env bash
# Builds the app twice (plain, and with Svelte update counters), serves both on the demo account,
# and measures them in WebKitGTK with GPU compositing inside a nested, headless KWin (nothing
# shows on the desktop). See scripts/perf/README.md.
#   scripts/perf/measure.sh <outdir> [scenarios] [runs]
# Needs: kwin_wayland, dbus-run-session, /usr/bin/python3 with gi + WebKit2 4.1, Node 22+.
set -euo pipefail
out=$(realpath -m "${1:?outdir}")
scenarios=${2:-idle,quiet,animations,nav,navLayout,cold,tickInventory,tickMods,tickOrders,orders,spares,settings}
runs=${3:-3}
cd "$(dirname "$0")/../.."
mkdir -p "$out"
run() { nice -n 10 ionice -c 3 "$@"; }

# A short socket path: Wayland sockets are limited to 108 bytes.
xdg=$(mktemp -d /tmp/perfwl-XXXXXX)
pids=()
# nice and npm start children of their own: stop each whole tree.
killtree() { local c; for c in $(pgrep -P "$1"); do killtree "$c"; done; kill "$1" 2>/dev/null || true; }
cleanup() { for p in "${pids[@]}"; do killtree "$p"; done; sleep 1; rm -rf "$xdg"; }
trap cleanup EXIT

XDG_RUNTIME_DIR=$xdg run dbus-run-session -- kwin_wayland --virtual --width 1600 --height 1000 --socket wl \
  --no-lockscreen --no-global-shortcuts --no-kactivities >"$out/kwin.log" 2>&1 & pids+=($!)
MYORBITER_DEMO=1 run npx vite --port 1431 --strictPort >"$out/demo-server.log" 2>&1 & pids+=($!)

PERF_OUT="$out/plain/dist" run npx vite build --config scripts/perf/vite.perf.config.ts >"$out/build-plain.log" 2>&1
PERF_OUT="$out/count/dist" PERF_COUNT=1 PERF_MINIFY=0 run npx vite build --config scripts/perf/vite.perf.config.ts >"$out/build-count.log" 2>&1
PERF_OUT="$out/plain/dist" PERF_PREVIEW_PORT=1432 run npx vite preview --config scripts/perf/vite.perf.config.ts >"$out/preview-plain.log" 2>&1 & pids+=($!)
PERF_OUT="$out/count/dist" PERF_PREVIEW_PORT=1433 run npx vite preview --config scripts/perf/vite.perf.config.ts >"$out/preview-count.log" 2>&1 & pids+=($!)
sleep 5

# As the app runs with NVIDIA on Linux (src-tauri/src/rendering.rs): GPU compositing, frames
# handed over through shared memory.
export PERF_WINDOW=1 XDG_RUNTIME_DIR=$xdg WAYLAND_DISPLAY=wl GDK_BACKEND=wayland DISPLAY= \
  WEBKIT_FORCE_DMABUF_RENDERER=1 WEBKIT_DMABUF_RENDERER_FORCE_SHM=1 PERF_TMP=$out
# Timings on the plain build; counts and what ran (Timeline, JS samples) on the counting build.
# PERF_PASSES=counts (or timings) runs one pass only.
passes=${PERF_PASSES:-timings,counts}
[[ $passes == *timings* ]] && run node scripts/perf/run.mjs --url http://localhost:1432/ --scenarios "$scenarios" --runs "$runs" --out "$out/timings.json"
[[ $passes == *counts* ]] && run node scripts/perf/run.mjs --url http://localhost:1433/ --scenarios "$scenarios" --runs 1 --timeline --out "$out/counts.json"
cp "$out/plain/chunks.json" "$out/chunks.json"
echo "results in $out"
