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

test("csv: every source named, line breaks quoted, ranks and counts in a trade's items", () => {
  assert.equal(field("a\rb"), '"a\rb"');
  assert.equal(field("two\nlines"), '"two\nlines"');
  assert.equal(field(0), "0");
  const s = salesCsv([{ at: Date.UTC(2026, 9, 3), item: "Arcane Energize", rank: 5, quantity: 1, platinum: 150, wfm: "o1" }]);
  assert.equal(s.trim().split("\n")[1], "2026-10-03T00:00:00Z,Arcane Energize,5,1,150,150,,warframe.market");
  const t = tradesCsv([
    { key: "b", at: Date.UTC(2026, 9, 2), partner: "ExamplePlayer", offered: [{ name: "Serration", rank: 10, count: 2 }, { name: "Mesa Prime Set", rank: null, count: 1 }], received: [{ name: "Vitality", rank: 0, count: 1 }], platOut: 5, platIn: 0 },
  ]);
  assert.equal(t.trim().split("\n")[1], "2026-10-02T00:00:00Z,ExamplePlayer,2× Serration R10; Mesa Prime Set,Vitality R0,0,5");
  assert.equal(salesCsv([]), "date,item,rank,quantity,platinum_each,platinum_total,median_then,source\n");
});
