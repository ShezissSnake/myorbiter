import { test } from "node:test";
import assert from "node:assert/strict";
import { field, salesCsv, tradesCsv } from "../src/lib/core/exportCsv";

test("csv: fields with commas and quotes are quoted", () => {
  assert.equal(field('Ack & Brunt, "Prime"'), '"Ack & Brunt, ""Prime"""');
  assert.equal(field(null), "");
});

test("csv: a text cell holding a ';' is written quoted", () => {
  // Unquoted, a sheet that splits on ";" (common where "," is the decimal mark) could read "=1+1"
  // as a cell of its own. This checks the text written, not how a spreadsheet opens it.
  assert.equal(field("ExamplePlayer;=1+1"), '"ExamplePlayer;=1+1"');
  assert.equal(field("a;b"), '"a;b"');
  assert.equal(field("2× Serration R10; Mesa Prime Set"), '"2× Serration R10; Mesa Prime Set"');
  assert.equal(field("Serration"), "Serration");
});

test("csv: a cell that starts like a formula opens as text; numbers the app writes stay numbers", () => {
  const f = field("=1+1");
  assert.ok(!f.startsWith("="), f);
  assert.equal(f, "'=1+1");
  assert.equal(field("+rep"), "'+rep");
  assert.equal(field("-dash"), "'-dash");
  assert.equal(field("@SUM(A1)"), "'@SUM(A1)");
  assert.equal(field("\t=1"), "'\t=1");
  // Quoted as before when it also holds a comma or a quote.
  assert.equal(field('=HYPERLINK("https://example.invalid","x")'), `"'=HYPERLINK(""https://example.invalid"",""x"")"`);
  // The app's own numbers, negative ones too, and text that only holds such a character later.
  assert.equal(field(-5), "-5");
  assert.equal(field(0), "0");
  assert.equal(field("Ack & Brunt"), "Ack & Brunt");
  assert.equal(field("a=b"), "a=b");
  const t = tradesCsv([{ key: "k", at: Date.UTC(2026, 9, 1), partner: "=cmd|' /C calc'!A0", offered: [{ name: "@x", rank: null, count: 1 }], received: [], platIn: 0, platOut: 5 }]);
  assert.equal(t.trim().split("\n")[1], "2026-10-01T00:00:00Z,'=cmd|' /C calc'!A0,'@x,,0,5");
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
  assert.equal(t.trim().split("\n")[1], '2026-10-02T00:00:00Z,ExamplePlayer,"2× Serration R10; Mesa Prime Set",Vitality R0,0,5');
  assert.equal(salesCsv([]), "\uFEFFdate,item,rank,quantity,platinum_each,platinum_total,median_then,source\n");
});

test("csv: Excel on Windows reads the exports as UTF-8 (a byte-order mark first, once)", () => {
  const t = tradesCsv([{ key: "k", at: Date.UTC(2026, 10, 1), partner: "ExamplePlayer", offered: [{ name: "Serration", rank: 10, count: 2 }], received: [], platIn: 40, platOut: 0 }]);
  assert.ok(t.includes("2× Serration"), "the multiplication sign is in the file");
  // Without it, Excel reads the file in the system code page: "2Ã— Serration".
  assert.equal(t.charCodeAt(0), 0xfeff);
  assert.equal(t.slice(1, 5), "date");
  const s = salesCsv([{ at: Date.UTC(2026, 10, 1), item: "Équipe Prime", rank: null, quantity: 1, platinum: 9 }]);
  assert.equal(s.charCodeAt(0), 0xfeff);
  assert.equal(s.split("\uFEFF").length, 2, "one mark, at the start");
  assert.ok(s.includes("Équipe Prime"));
  // UTF-8 bytes EF BB BF, as Excel looks for them.
  assert.deepEqual([...Buffer.from(salesCsv([]), "utf8").subarray(0, 3)], [0xef, 0xbb, 0xbf]);
});
