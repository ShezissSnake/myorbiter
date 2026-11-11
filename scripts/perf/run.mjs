// Measures MyOrbiter's common actions in WebKitGTK on the demo account: see scripts/perf/README.md.
//   node scripts/perf/run.mjs --url http://localhost:1432/ --out results.json
//        [--scenarios nav,tick,…] [--runs 3] [--timeline] [--size 1600x1000]
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Inspector } from "./inspector.mjs";
import { SCENARIOS } from "./scenarios.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? dflt : process.argv[i + 1];
};
const url = arg("url", "http://localhost:1432/");
const out = arg("out", null);
const runs = Number(arg("runs", "3"));
const size = arg("size", "1600x1000");
const timeline = process.argv.includes("--timeline");
const only = arg("scenarios", Object.keys(SCENARIOS).join(",")).split(",");
const inspPort = Number(arg("inspector-port", "9317"));

/** Starts a fresh page (new website data), waits for the app to settle, returns the session. */
async function open(tab = "home", early = false, syncReload = false, record = false) {
  const data = mkdtempSync(join(process.env.PERF_TMP ?? tmpdir(), "perf-wk-"));
  const start = join(data, "start.js");
  // The app's settings as a returning player has them: news seen, Full mode asked, this page open.
  // Record timings (src/lib/timing.ts) on for a scenario that asks, or for every one with
  // PERF_RECORD=1 (to compare the recorder's cost: the same scenarios with it off and on).
  const rec = record || process.env.PERF_RECORD === "1";
  writeFileSync(start, `try{const s=JSON.parse(localStorage.getItem('orbiter-settings')??'{}');s.newsSeen='9999';s.fullModeAsked=true;s.recordTimings=${rec};s.tab=${JSON.stringify(tab)};localStorage.setItem('orbiter-settings',JSON.stringify(s));}catch(e){}localStorage.${syncReload ? "setItem('perf-sync','reload')" : "removeItem('perf-sync')"};`);
  const t0 = Date.now();
  const host = spawn("/usr/bin/python3", ["-I", join(here, "host.py"), url, size, data, start, join(here, "probe.js")], {
    env: { ...process.env, WEBKIT_INSPECTOR_HTTP_SERVER: `127.0.0.1:${inspPort}` },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let errText = "";
  host.stderr.on("data", (d) => (errText += d));
  const insp = await Inspector.connect(inspPort);
  await insp.send("Runtime.enable").catch(() => {});
  // Wait for the rail to exist and requests to stop, then for the page to settle.
  for (let i = 0; i < 200; i++) {
    const ok = await insp.eval("!!(window.__perf && window.__perf.ready())").catch(() => false);
    if (ok) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  // early: just after the first page has drawn (the warm-up starts 1.5 s after that).
  if (early) for (let i = 0; i < 200 && !(await insp.eval("!!window.__perf.marks.pagePaint")); i++) await new Promise((r) => setTimeout(r, 25));
  // Otherwise: until the background warm-up has opened every page (no new pane for 4 s) and the
  // page has settled.
  let boot = { early: true };
  if (!early) {
    let panes = 0;
    let since = Date.now();
    while (Date.now() - since < 4000 && Date.now() - t0 < 60000) {
      const n = await insp.eval("document.querySelectorAll('.pane').length");
      if (n !== panes) [panes, since] = [n, Date.now()];
      await new Promise((r) => setTimeout(r, 250));
    }
    boot = { ...(await insp.evalAsync("window.__perf.settle({quiet: 1500, max: 30000})")), panes, warmedMs: since - t0 };
  }
  const nav = await insp.eval("(()=>{const n=performance.getEntriesByType('navigation')[0];const m=window.__perf.marks;return {domContentLoaded:Math.round(n?.domContentLoadedEventEnd??0),load:Math.round(n?.loadEventEnd??0),railPaint:Math.round(m.railPaint??0),pagePaint:Math.round(m.pagePaint??0)}})()");
  return {
    insp,
    boot: { ...boot, ...nav, wallMs: Date.now() - t0 },
    close() {
      insp.close();
      host.stdin.end();
      host.kill();
      rmSync(data, { recursive: true, force: true });
      if (/CRITICAL|ERROR \*\*/.test(errText)) console.error(errText.slice(0, 2000));
    },
  };
}

/** Measures one action; with --timeline also records what ran during it. */
async function measure(s, code, opts = {}) {
  if (timeline) await s.insp.startRecording();
  const m = await s.insp.evalAsync(`window.__perf.measure(${JSON.stringify(code)}, ${JSON.stringify(opts)})`);
  if (timeline) m.timeline = await s.insp.stopRecording();
  return m;
}

const results = { url, size, timeline, runs, startedAt: new Date().toISOString(), scenarios: {} };
for (const name of only) {
  const sc = SCENARIOS[name];
  if (!sc) throw new Error(`no scenario ${name}`);
  results.scenarios[name] = [];
  for (let run = 0; run < (sc.runs ?? runs); run++) {
   for (const page of sc.perPage ?? [null]) {
    const s = await open(sc.tab ?? "home", !!sc.early, !!sc.syncReload, !!sc.record);
    try {
      const r = await sc.run({ ...s, measure: (code, opts) => measure(s, code, opts), eval: (e) => s.insp.eval(e), evalAsync: (e) => s.insp.evalAsync(e) }, { page });
      results.scenarios[name].push({ run, boot: s.boot, ...r });
      console.error(`${name} run ${run}${page ? ` ${page}` : ""} done`);
    } catch (e) {
      results.scenarios[name].push({ run, page, error: String(e.stack ?? e) });
      console.error(`${name} run ${run} failed: ${e.stack ?? e}`);
    } finally {
      s.close();
      await new Promise((r) => setTimeout(r, 500));
    }
   }
  }
  if (out) writeFileSync(out, JSON.stringify(results, null, 1));
}
const json = JSON.stringify(results, null, 1);
if (out) writeFileSync(out, json);
else console.log(json);
process.exit(0);
