import { test } from "node:test";
import assert from "node:assert/strict";
import { field, salesCsv, tradesCsv } from "../src/lib/core/exportCsv";

test("csv: fields with commas and quotes are quoted", () => {
  assert.equal(field('Ack & Brunt, "Prime"'), '"Ack & Brunt, ""Prime"""');
  assert.equal(field(null), "");
});

test("csv: sales and trades, oldest first", () => {
  const s = salesCsv([
    { at: Date.UTC(2026, 9, 2), item: "Serration", rank: 10, quantity: 1, platinum: 9 },
    { at: Date.UTC(2026, 9, 1), item: "Mesa Prime Set", rank: null, quantity: 2, platinum: 60, median: 58.4, trade: "k" },
  ]);
  assert.deepEqual(s.trim().split("\n"), [
    "date,item,rank,quantity,platinum_each,platinum_total,median_then,source",
    "2026-10-01T00:00:00Z,Mesa Prime Set,,2,60,120,58,game trade",
    "2026-10-02T00:00:00Z,Serration,10,1,9,9,,by hand",
  ]);
  const t = tradesCsv([{ key: "k", at: Date.UTC(2026, 9, 1), partner: "Tenno", offered: [{ name: "Mesa Prime Set", rank: null, count: 1 }], received: [], platIn: 60, platOut: 0 }]);
  assert.equal(t.trim().split("\n")[1], "2026-10-01T00:00:00Z,Tenno,Mesa Prime Set,,60,0");
});
