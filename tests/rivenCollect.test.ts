// The riven research script (scripts/riven-model/collect.py) keeps warframe.market's pace: its
// auction searches go at most 10 a minute, retries included, and a 429 waits its Retry-After in
// full. The script's own `get` is run against a listener on 127.0.0.1 (with the gap shortened for
// the test); nothing here reaches warframe.market, and importing the script runs nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import type { AddressInfo } from "node:net";

const SCRIPT = new URL("../scripts/riven-model/collect.py", import.meta.url).pathname;
const src = readFileSync(SCRIPT, "utf8");
const python = spawnSync("python3", ["--version"]).status === 0;

test("collect.py keeps 6 s between requests, warframe.market's 10 contracts a minute", () => {
  const gap = Number(/^GAP = ([\d.]+)$/m.exec(src)?.[1]);
  assert.ok(gap >= 6, `GAP ${gap}`);
  assert.match(src, /^if __name__ == "__main__":\n {4}main\(\)\n?$/m, "importing the script sends nothing");
});

/** Runs the script's `get` once against a local listener whose answers are `replies`, in turn; gives when each request came, in seconds from the first. */
async function times(replies: { status: number; headers?: Record<string, string> }[], gap: number): Promise<{ at: number[]; out: string }> {
  const at: number[] = [];
  const server = createServer((_req, res) => {
    at.push(performance.now() / 1000);
    const r = replies[Math.min(at.length - 1, replies.length - 1)];
    res.writeHead(r.status, { "Content-Type": "application/json", ...r.headers });
    res.end(r.status === 200 ? '{"ok": true}' : "");
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const { port } = server.address() as AddressInfo;
  const code = [
    "import importlib.util, json, sys, urllib.request",
    // Straight to the listener, never through a proxy set in the environment.
    "urllib.request.install_opener(urllib.request.build_opener(urllib.request.ProxyHandler({})))",
    `spec = importlib.util.spec_from_file_location("collect", ${JSON.stringify(SCRIPT)})`,
    "c = importlib.util.module_from_spec(spec); spec.loader.exec_module(c)",
    `c.GAP = ${gap}`,
    `print(json.dumps(c.get("http://127.0.0.1:${port}/v1/auctions/search")))`,
  ].join("\n");
  const out = await new Promise<string>((ok, fail) => {
    const p = spawn("python3", ["-I", "-c", code], { stdio: ["ignore", "pipe", "pipe"] });
    let text = "";
    p.stdout.on("data", (d) => (text += d));
    p.stderr.on("data", (d) => (text += d));
    p.on("error", fail);
    p.on("close", () => ok(text.trim()));
  });
  server.close();
  return { at: at.map((t) => t - at[0]), out };
}

test("collect.py waits a 429's Retry-After in full before asking again", { skip: !python && "no python3" }, async () => {
  const { at, out } = await times([{ status: 429, headers: { "Retry-After": "2" } }, { status: 200 }], 0.1);
  assert.equal(out, '{"ok": true}');
  assert.equal(at.length, 2);
  assert.ok(at[1] >= 1.95, `asked again after ${at[1].toFixed(2)} s`);
});

test("collect.py keeps its gap before a retry too", { skip: !python && "no python3" }, async () => {
  const { at, out } = await times([{ status: 500 }, { status: 502 }, { status: 200 }], 0.6);
  assert.equal(out, '{"ok": true}');
  assert.equal(at.length, 3);
  for (let i = 1; i < at.length; i++) assert.ok(at[i] - at[i - 1] >= 0.55, `request ${i} after ${(at[i] - at[i - 1]).toFixed(2)} s`);
});
