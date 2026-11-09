// A small client for WebKit's remote inspector (WEBKIT_INSPECTOR_HTTP_SERVER), enough for
// scripts/perf/run.mjs: evaluate in the page, and record the Timeline and the JS sampling
// profiler around an action. Node 22+ (global WebSocket).

export class Inspector {
  #ws;
  #id = 0;
  #outer = 0;
  #wait = new Map();
  #target = null;
  #onTarget = null;
  recording = null;

  static async connect(port, timeoutMs = 20000) {
    const until = Date.now() + timeoutMs;
    let path = null;
    while (!path && Date.now() < until) {
      try {
        const html = await (await fetch(`http://127.0.0.1:${port}/`)).text();
        path = /'\/socket\/(\d+\/\d+\/WebPage)'/.exec(html)?.[1] ?? null;
      } catch {}
      if (!path) await new Promise((r) => setTimeout(r, 200));
    }
    if (!path) throw new Error("no inspectable page");
    const insp = new Inspector();
    await insp.#open(`ws://127.0.0.1:${port}/socket/${path}`);
    return insp;
  }

  #open(url) {
    return new Promise((resolve, reject) => {
      this.#ws = new WebSocket(url);
      this.#ws.onerror = (e) => reject(new Error(`inspector socket: ${e.message ?? e.type}`));
      this.#onTarget = resolve.bind(null, undefined);
      this.#ws.onmessage = (e) => this.#message(JSON.parse(e.data));
    });
  }

  #message(m) {
    if (m.method === "Target.targetCreated" && m.params.targetInfo.type === "page") {
      this.#target = m.params.targetInfo.targetId;
      this.#onTarget?.();
      this.#onTarget = null;
      return;
    }
    if (m.method === "Target.didCommitProvisionalTarget") {
      this.#target = m.params.newTargetId;
      return;
    }
    if (m.method !== "Target.dispatchMessageFromTarget") return;
    const inner = JSON.parse(m.params.message);
    if (inner.id != null) {
      const w = this.#wait.get(inner.id);
      if (!w) return;
      this.#wait.delete(inner.id);
      if (inner.error) w.reject(new Error(`${w.method}: ${inner.error.message}`));
      else w.resolve(inner.result);
      return;
    }
    const rec = this.recording;
    if (!rec) return;
    if (inner.method === "Timeline.eventRecorded") rec.records.push(inner.params.record);
    else if (inner.method === "ScriptProfiler.trackingComplete") rec.samples = inner.params.samples;
  }

  send(method, params = {}) {
    const id = ++this.#id;
    const msg = JSON.stringify({ id, method, params });
    this.#ws.send(JSON.stringify({ id: ++this.#outer, method: "Target.sendMessageToTarget", params: { targetId: this.#target, message: msg } }));
    // A page whose web process died never answers: give up after a minute rather than hang.
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.#wait.delete(id) && reject(new Error(`${method}: no answer in 60 s`)), 60_000);
      this.#wait.set(id, { resolve: (v) => (clearTimeout(timer), resolve(v)), reject: (e) => (clearTimeout(timer), reject(e)), method });
    });
  }

  /** Evaluates `expression` in the page and returns its value. */
  async eval(expression) {
    const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, emulateUserGesture: true });
    if (r.wasThrown) throw new Error(`page threw: ${r.result?.description ?? JSON.stringify(r.result)}`);
    return r.result?.value;
  }

  /** Evaluates an expression that returns a promise and returns what it resolves to. */
  async evalAsync(expression) {
    const o = await this.send("Runtime.evaluate", { expression, returnByValue: false, emulateUserGesture: true });
    if (o.wasThrown) throw new Error(`page threw: ${o.result?.description}`);
    const p = await this.send("Runtime.awaitPromise", { promiseObjectId: o.result.objectId, returnByValue: true });
    if (p.wasThrown) throw new Error(`page rejected: ${p.result?.description ?? JSON.stringify(p.result)}`);
    return p.result.value;
  }

  async startRecording() {
    this.recording = { records: [], samples: null };
    await this.send("Timeline.setInstruments", { instruments: ["Timeline", "ScriptProfiler"] });
    await this.send("ScriptProfiler.startTracking", { includeSamples: true });
    await this.send("Timeline.start", { maxCallStackDepth: 0 });
  }

  /**
   * Stops recording and summarises it. WebKitGTK 2.54's remote inspector reports every time as 0,
   * so the Timeline gives counts (style recalcs, layouts, paints and their area), and the JS
   * sampling profiler (about one sample per ms of JS) gives JS time and where it went.
   */
  async stopRecording() {
    await this.send("Timeline.stop");
    await this.send("ScriptProfiler.stopTracking");
    for (let i = 0; i < 40 && !this.recording.samples; i++) await new Promise((r) => setTimeout(r, 50));
    const { records, samples } = this.recording;
    this.recording = null;
    const types = {};
    let paintArea = 0;
    const rects = {};
    const walk = (r) => {
      types[r.type] = (types[r.type] ?? 0) + 1;
      if (r.type === "Paint" && r.data?.clip) {
        const q = r.data.clip;
        const w = Math.round(Math.abs(q[2] - q[0]));
        const h = Math.round(Math.abs(q[5] - q[3]));
        paintArea += w * h;
        const k = `${w}x${h}@${Math.round(q[0])},${Math.round(q[1])}`;
        rects[k] = (rects[k] ?? 0) + 1;
      }
      for (const c of r.children ?? []) walk(c);
    };
    records.forEach(walk);
    const traces = samples?.stackTraces ?? [];
    const self = {};
    const incl = {};
    for (const t of traces) {
      const f = t.stackFrames ?? [];
      const name = (x) => `${x.name || "(anonymous)"} ${String(x.url ?? "").replace(/^https?:\/\/[^/]+\//, "")}:${x.line}`;
      if (f[0]) self[name(f[0])] = (self[name(f[0])] ?? 0) + 1;
      for (const x of new Set(f.map(name))) incl[x] = (incl[x] ?? 0) + 1;
    }
    const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n);
    return { types, paintAreaPx: Math.round(paintArea), paintRects: top(rects, 12), jsSamples: traces.length, topSelf: top(self, 12), topInclusive: top(incl, 15) };
  }

  close() {
    this.#ws?.close();
  }
}
