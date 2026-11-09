#!/usr/bin/python3 -I
# The page host for scripts/perf/run.mjs: one WebKitGTK view (webkit2gtk-4.1, the engine the app
# uses on Linux) in a GTK window: with PERF_WINDOW=1 a real window with GPU compositing (measure.sh
# opens it in a nested, headless KWin), otherwise an offscreen one. Throwaway website data in
# <datadir>; every request that isn't to localhost is blocked. run.mjs drives the page
# through the remote inspector (WEBKIT_INSPECTOR_HTTP_SERVER, set by run.mjs).
#   host.py <url> <WxH> <datadir> <start-script.js> <probe.js>
# Prints "ready" once the content filter is in place and the page is loading; exits when stdin
# closes.
import os, sys, json
import gi
gi.require_version("Gtk", "3.0")
gi.require_version("WebKit2", "4.1")
from gi.repository import Gtk, WebKit2, GLib

url, size, data, start_js, probe_js = sys.argv[1:6]
w, h = (int(x) for x in size.split("x"))
os.makedirs(data, exist_ok=True)

mgr = WebKit2.WebsiteDataManager(base_data_directory=data, base_cache_directory=data)
ctx = WebKit2.WebContext.new_with_website_data_manager(mgr)
ucm = WebKit2.UserContentManager()
for path in (start_js, probe_js):
    with open(path) as f:
        ucm.add_script(WebKit2.UserScript.new(f.read(), WebKit2.UserContentInjectedFrames.TOP_FRAME, WebKit2.UserScriptInjectionTime.START, None, None))
# The demo's toasts come and go on timers: hidden, so they don't land inside a measurement.
ucm.add_style_sheet(WebKit2.UserStyleSheet.new(".toasts{display:none!important}", WebKit2.UserContentInjectedFrames.TOP_FRAME, WebKit2.UserStyleLevel.USER, None, None))

view = WebKit2.WebView(web_context=ctx, user_content_manager=ucm)
s = view.get_settings()
s.set_enable_developer_extras(True)
# PERF_WINDOW=1: a real window with GPU compositing, as the app runs on Linux (for a nested,
# headless compositor: see README.md). Otherwise an offscreen window, which has no GL context,
# so every frame is painted on the CPU.
windowed = os.environ.get("PERF_WINDOW") == "1"
s.set_hardware_acceleration_policy(WebKit2.HardwareAccelerationPolicy.ALWAYS if windowed else WebKit2.HardwareAccelerationPolicy.NEVER)
win = Gtk.Window() if windowed else Gtk.OffscreenWindow()
win.set_default_size(w, h)
view.set_size_request(w, h)
win.add(view)
win.show_all()

# Block everything, then let localhost through: no request leaves the machine.
rules = json.dumps([
    {"trigger": {"url-filter": ".*"}, "action": {"type": "block"}},
] + [
    # Content rules take no disjunctions: one rule per allowed prefix.
    {"trigger": {"url-filter": p}, "action": {"type": "ignore-previous-rules"}}
    for p in ("^http://localhost[:/]", "^http://127\\.0\\.0\\.1[:/]", "^ws://localhost[:/]", "^data:", "^blob:", "^about:")
])
store = WebKit2.UserContentFilterStore.new(os.path.join(data, "filters"))

def saved(st, res):
    ucm.add_filter(st.save_finish(res))
    view.load_uri(url)
    print("ready", flush=True)

store.save("local-only", GLib.Bytes.new(rules.encode()), None, saved)

def stdin_closed(*_):
    Gtk.main_quit()
    return False

GLib.io_add_watch(GLib.IOChannel.unix_new(sys.stdin.fileno()), GLib.IO_HUP | GLib.IO_IN, lambda *a: (sys.stdin.read(), stdin_closed())[1])
Gtk.main()
