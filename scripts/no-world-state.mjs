// The demo has a world state of its own (demo/dev-worldstate.json): the pictures, the help-picture
// check and the sweep ask no world-state service. Each window they open stops any request to one
// and counts it, so a run says how many there were and fails on any. Every host the windows asked
// is counted too, so a run shows what it reached.

/** api.warframestat.us, and the game's own world-state file. */
const WORLD_STATE = /warframestat\.us|worldState\.php/i;

export const worldStateAsked = { count: 0 };
/** Requests by host, every window of the run together. */
export const hostsAsked = new Map();

/** Stops and counts every world-state request the page `p` makes, and counts its requests by host. */
export async function stopWorldState(p) {
  p.on("request", (r) => {
    let host = "?";
    try {
      host = new URL(r.url()).host || new URL(r.url()).protocol;
    } catch {}
    hostsAsked.set(host, (hostsAsked.get(host) ?? 0) + 1);
  });
  await p.route(WORLD_STATE, (r) => {
    worldStateAsked.count++;
    console.error(`stopped a world-state request: ${r.request().url()}`);
    return r.abort();
  });
}

/** One line: the requests by host, then the world-state ones. */
export function requestsLine() {
  const hosts = [...hostsAsked].sort((a, b) => b[1] - a[1]).map(([h, n]) => `${h} ${n}`).join(", ");
  return `requests by host: ${hosts || "none"}; ${worldStateAsked.count} world-state requests (each stopped)`;
}
