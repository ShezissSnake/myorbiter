// Where a walk-through's "More in the Guide" goes: the Guide's entry for an app page, or one of
// its own cards (Guide.svelte marks each with data-card).

import type { PageId } from "../pages";

/** The Guide's entry for an app page (Guide.svelte marks each with data-card="guide-<page>"). */
export const guideOf = (page: PageId) => `guide?open=${page}#guide-${page}`;

/** One of the Guide's own cards: "fullmode", "updates", "report-bug", "news", "sections", "showme". */
export const guideCard = (card: string) => `guide#${card}`;
