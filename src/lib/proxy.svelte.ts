import { proxyProblem } from "./backend";

// A proxy set in the environment that MyOrbiter can't use stops every request and connection
// (presence.rs, `route_from`): the reason, for the places that say a service can't be reached,
// since waiting or trying again changes nothing until the proxy is changed and MyOrbiter
// restarted. Read once: the environment is read once a start.
export const proxy = $state<{ problem: string | null }>({ problem: null });

void proxyProblem()
  .then((p) => (proxy.problem = p))
  .catch(() => {});
