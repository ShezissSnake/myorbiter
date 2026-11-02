// What you got of each part lately (core/drops.ts), worked out by App from the drop log and the
// trade log, for the pages and the bulk sale to read.
export const drops = $state<{ recent: ReadonlyMap<string, number> }>({ recent: new Map() });
