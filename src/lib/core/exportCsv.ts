// Sales and trades as CSV, for a spreadsheet: one row each, the date in ISO form, plain numbers.
import type { Sale, TradeLogEntry } from "../backend";

/** One CSV field: quoted when it holds a comma, a quote or a line break, quotes doubled. */
export const field = (v: string | number | null | undefined): string => {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const row = (xs: (string | number | null | undefined)[]) => xs.map(field).join(",");
const date = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

export function salesCsv(sales: Sale[]): string {
  const lines = [row(["date", "item", "rank", "quantity", "platinum_each", "platinum_total", "median_then", "source"])];
  for (const s of [...sales].sort((a, b) => a.at - b.at)) {
    lines.push(row([date(s.at), s.item, s.rank, s.quantity, s.platinum, s.quantity * s.platinum, s.median != null ? Math.round(s.median) : null, s.trade ? "game trade" : s.wfm ? "warframe.market" : "by hand"]));
  }
  return lines.join("\n") + "\n";
}

const items = (xs: TradeLogEntry["offered"]) => xs.map((x) => `${x.count > 1 ? `${x.count}× ` : ""}${x.name}${x.rank != null ? ` R${x.rank}` : ""}`).join("; ");

export function tradesCsv(trades: TradeLogEntry[]): string {
  const lines = [row(["date", "partner", "gave", "got", "platinum_in", "platinum_out"])];
  for (const t of [...trades].sort((a, b) => a.at - b.at)) lines.push(row([date(t.at), t.partner, items(t.offered), items(t.received), t.platIn, t.platOut]));
  return lines.join("\n") + "\n";
}
