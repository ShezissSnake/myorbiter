// The focus tip (focusTip.ts) goes under the focused control. In a menu (the sidebar's More, opened
// by keyboard) that put it over the next entries, the ones the arrow keys move to. An entry's tip
// goes beside the menu now, to its right, else to its left, else nowhere.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { besideMenu } = await import("../src/lib/focusTip");

const view = { w: 1280, h: 800 };
const box = (left: number, top: number, w: number, h: number) => ({ left, top, right: left + w, bottom: top + h });
const overlaps = (a: ReturnType<typeof box>, b: ReturnType<typeof box>) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

test("beside the folded sidebar's menu: to its right, level with the entry", () => {
  const menu = box(64, 560, 220, 210);
  const item = box(64, 564, 220, 34);
  const at = besideMenu(menu, item, { w: 300, h: 40 }, view);
  assert.ok(at);
  assert.equal(at.left, menu.right + 8);
  assert.equal(at.top, item.top);
  assert.ok(!overlaps(box(at.left, at.top, 300, 40), menu), "off the menu");
});

test("no room to the right: to the left; no room either side: no tip", () => {
  const menu = box(1000, 300, 220, 210);
  const item = box(1000, 340, 220, 34);
  const left = besideMenu(menu, item, { w: 300, h: 40 }, view);
  assert.ok(left);
  assert.equal(left.left, menu.left - 8 - 300);
  assert.equal(besideMenu(box(200, 300, 880, 210), item, { w: 300, h: 40 }, view), null);
});

test("kept inside the window at the bottom", () => {
  const menu = box(64, 560, 220, 230);
  const item = box(64, 770, 220, 34);
  const at = besideMenu(menu, item, { w: 300, h: 60 }, view);
  assert.ok(at);
  assert.equal(at.top, view.h - 60 - 8);
});

test("the focus tip places a menu entry's tip beside its menu", () => {
  const src = readFileSync("src/lib/focusTip.ts", "utf8");
  assert.match(src, /closest(<\w+>)?\(["']\[role=menu\]["']\)/);
  assert.match(src, /besideMenu\(/);
});
