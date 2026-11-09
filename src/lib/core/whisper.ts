// The whisper to a seller (or buyer) found on warframe.market: the one place MyOrbiter builds it.
//
// warframe.market's terms of service (warframe.market/tos):
// - API: "Applications that provide a copy/paste message must provide the message in the same
//   format as seen on the Site and include the application name."
// - Trading: the site's generated message "must be used as-is without modification at the start
//   of contact"; it is what tells the other player the contact came through the site.
// (docs.warframe.market's Rules page has no rule on the message; it asks for an identifying
// User-Agent, which MyOrbiter sends on every request.)
//
// So the message is the site's own, word for word, from its template (app.order.clipboard.template
// in the site's English strings):
//   /w {ingameName} Hi! I want to {buy|sell}: {x{perTrade} }"{subtype }{itemName}{ (rank {modRank})}{ {ayatan}}" for {price} platinum. (warframe.market)
// with the ayatan part "({cyan} cyan, {amber} amber)" (app.order.clipboard.stars), and the
// application's name after it, apart, so the site's part stays exactly as the site writes it.

/** The name the terms ask a copy/paste message to include. */
export const APP_NAME = "MyOrbiter";

export interface WhisperOrder {
  /** The other player's in-game name, as warframe.market gives it. */
  player: string;
  /** What you want to do: buy from a seller, sell to a buyer. */
  action: "buy" | "sell";
  /** The item's English name on warframe.market. */
  item: string;
  /** The order's price, each. */
  platinum: number;
  /** The order's rank, for things with ranks (mods, arcanes); left out otherwise. */
  rank?: number | null;
  /** The order's variant (a relic's refinement, a fish's size), as warframe.market names it. */
  subtype?: string | null;
  /** The order's minimum per trade, for things sold in bulk. */
  perTrade?: number | null;
  /** An Ayatan sculpture's stars, as the order gives them. */
  cyanStars?: number | null;
  amberStars?: number | null;
}

const given = (n: number | null | undefined): n is number => n != null && Number.isFinite(n);

/** The ayatan part, as the site's template writes it: "(2 cyan, 1 amber)". */
function stars(cyan: number | null | undefined, amber: number | null | undefined): string | null {
  if (!given(cyan) && !given(amber)) return null;
  return `(${given(cyan) ? `${cyan} cyan` : ""}${given(amber) ? `, ${amber} amber` : ""})`;
}

/** The site's copy/paste message for this order, then the application's name. */
export function tradeWhisper(o: WhisperOrder): string {
  const ayatan = stars(o.cyanStars, o.amberStars);
  const site =
    `/w ${o.player} Hi! I want to ${o.action}: ` +
    `${given(o.perTrade) && o.perTrade > 1 ? `x${o.perTrade} ` : ""}` +
    `"${o.subtype ? `${o.subtype} ` : ""}${o.item}${given(o.rank) ? ` (rank ${o.rank})` : ""}${ayatan ? ` ${ayatan}` : ""}"` +
    ` for ${o.platinum} platinum. (warframe.market)`;
  return `${site} (${APP_NAME})`;
}
