// Charts (ui/TimeChart.svelte) give their readings to the keyboard too: the chart takes the focus,
// Left and Right move the reading a day at a time (Home and End to the first and the last), and
// the reading is announced. The pointer's reading stays as it was.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { chartKey } = await import("../src/lib/ui/chartKeys");

const DAY = 86_400_000;
const H = 3_600_000;
// Readings: two on day 0, one on day 1, none on day 2, two on day 3.
const at = [0, 6 * H, DAY + 2 * H, 3 * DAY, 3 * DAY + 5 * H];
const idx = [0, 1, 2, 3, 4];

test("with no reading shown yet, an arrow starts at the latest", () => {
  assert.equal(chartKey("ArrowLeft", at, idx, null), 4);
  assert.equal(chartKey("ArrowRight", at, idx, null), 4);
});

test("Right goes to the first reading a day or more later, Left a day or more earlier", () => {
  assert.equal(chartKey("ArrowRight", at, idx, 0), 2, "past the second reading of the same day");
  assert.equal(chartKey("ArrowRight", at, idx, 2), 3, "over a day with none");
  assert.equal(chartKey("ArrowLeft", at, idx, 4), 2, "a day or more before 3d 5h is 1d 2h");
  assert.equal(chartKey("ArrowLeft", at, idx, 2), 0);
});

test("at either end the reading moves to the last one there, then stays", () => {
  assert.equal(chartKey("ArrowRight", at, idx, 3), 4, "less than a day left: the last reading");
  assert.equal(chartKey("ArrowRight", at, idx, 4), null);
  assert.equal(chartKey("ArrowLeft", at, idx, 1), 0);
  assert.equal(chartKey("ArrowLeft", at, idx, 0), null);
});

test("Home and End go to the first and the last reading; other keys do nothing", () => {
  assert.equal(chartKey("Home", at, idx, 3), 0);
  assert.equal(chartKey("End", at, idx, 0), 4);
  assert.equal(chartKey("ArrowUp", at, idx, 2), null);
  assert.equal(chartKey("Enter", at, idx, 2), null);
});

test("only the readings the chart draws are stepped through", () => {
  assert.equal(chartKey("ArrowRight", at, [0, 3], 0), 3);
  assert.equal(chartKey("ArrowLeft", at, [], null), null);
});

test("the chart takes the focus, reads keys and announces the reading", () => {
  const src = readFileSync("src/lib/ui/TimeChart.svelte", "utf8");
  const from = src.indexOf("<svg ");
  const svg = src.slice(from, src.indexOf("\n", from));
  assert.match(svg, /role="img"/);
  assert.match(svg, /tabindex="0"/);
  assert.match(svg, /onkeydown=/);
  assert.match(svg, /onpointermove=\{move\}/, "the pointer's reading stays");
  assert.match(src, /aria-live="polite"/);
});
