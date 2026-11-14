import { proxyProblem } from "./backend";

// A proxy set in the environment that MyOrbiter can't use stops every request and connection but the update check
// (presence.rs, `route_from`): the reason, for the places that say a service can't be reached,
// since waiting or trying again changes nothing until the proxy is changed and MyOrbiter
// restarted. Read once: the environment is read once a start.
export const proxy = $state<{ problem: string | null }>({ problem: null });

/**
 * Whether a read the window makes itself (with `fetch`, so through neither the agent nor the
 * sockets) may go out, from the answer of `proxy_problem`: only once it has come in, and only
 * when no proxy set is one that can't be used. An answer that fails counts as a stop: the route
 * can't be known, so nothing goes around it.
 */
export function windowMayAsk(answer: Promise<string | null>): Promise<boolean> {
  return answer.then(
    (problem) => problem == null,
    () => false,
  );
}

const answer = proxyProblem();
answer.then((p) => (proxy.problem = p)).catch(() => {});

/** `windowMayAsk` for this start's answer: waits for it if it hasn't come in yet. */
export const mayAskFromWindow = (): Promise<boolean> => windowMayAsk(answer);
