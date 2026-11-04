// What Sell spares would put up, in one line for Orders: the page works it out in a quiet moment
// (tabs/Spares.svelte) and leaves it here, so Orders can say it without working it out again.
// `at`: null until the page has worked it out once; `changes`: the plan's, as Apply would send them.
export const sparesSummary = $state<{ listings: number; plat: number; kinds: number; estimate: boolean; changes: number; at: number | null }>({ listings: 0, plat: 0, kinds: 0, estimate: true, changes: 0, at: null });
