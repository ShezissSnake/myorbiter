// Sales and trades as CSV, for a spreadsheet: one row each, the date in ISO form, plain numbers.
import type { Sale, TradeLogEntry } from "../backend";

/**
 * One CSV field: quoted when it holds a comma, a quote or a line break, quotes doubled. Text that
 * starts with `=`, `+`, `-`, `@`, a tab or a carriage return (a trade partner's name, an item's)
 * would be a formula in a spreadsheet that opens the file: it gets a `'` in front, so it opens as
 * text. Numbers the app writes are numbers, and stay as they are.
 */
export const field = (v: string | number | null | undefined): string => {
  let s = v == null ? "" : String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const row = (xs: (string | number | null | undefined)[]) => xs.map(field).join(",");
const date = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
/**
 * The file: a byte-order mark first, so Excel on Windows reads it as UTF-8 and not in the system
 * code page ("2× Serration", accented names); LibreOffice and other readers skip the mark.
 */
const file = (lines: string[]) => `\uFEFF${lines.join("\n")}\n`;

export function salesCsv(sales: Sale[]): string {
  const lines = [row(["date", "item", "rank", "quantity", "platinum_each", "platinum_total", "median_then", "source"])];
  for (const s of [...sales].sort((a, b) => a.at - b.at)) {
    lines.push(row([date(s.at), s.item, s.rank, s.quantity, s.platinum, s.quantity * s.platinum, s.median != null ? Math.round(s.median) : null, s.trade ? "game trade" : s.wfm ? "warframe.market" : "by hand"]));
  }
  return file(lines);
}

const items = (xs: TradeLogEntry["offered"]) => xs.map((x) => `${x.count > 1 ? `${x.count}× ` : ""}${x.name}${x.rank != null ? ` R${x.rank}` : ""}`).join("; ");

export function tradesCsv(trades: TradeLogEntry[]): string {
  const lines = [row(["date", "partner", "gave", "got", "platinum_in", "platinum_out"])];
  for (const t of [...trades].sort((a, b) => a.at - b.at)) lines.push(row([date(t.at), t.partner, items(t.offered), items(t.received), t.platIn, t.platOut]));
  return file(lines);
}
