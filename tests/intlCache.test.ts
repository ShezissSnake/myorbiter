// Number formatting with a kept formatter: the same text as the engine's own toLocaleString.
import { test } from "node:test";
import assert from "node:assert/strict";

const original = Number.prototype.toLocaleString;
const { installIntlCache } = await import("../src/lib/intlCache");
installIntlCache();

test("a kept formatter gives the text toLocaleString gives", () => {
  const values = [0, -0, 7, 1234, -98765.4321, 0.5, 1e21, 123456789.987, Number.NaN, Infinity, -Infinity];
  for (const v of values) {
    for (const locale of ["en", "de", "en-US", undefined]) assert.equal(v.toLocaleString(locale), original.call(v, locale), `${v} in ${locale}`);
    assert.equal(v.toLocaleString(), original.call(v));
  }
});

test("options, locale lists and bad locales go to the original", () => {
  assert.equal((1234.5).toLocaleString("en", { maximumFractionDigits: 0 }), "1,235");
  assert.equal((1234.5).toLocaleString(["de", "en"]), original.call(1234.5, ["de", "en"]));
  assert.equal(Number.prototype.toLocaleString.call(new Number(4321), "en"), "4,321");
  assert.throws(() => (1).toLocaleString("not a locale!"), RangeError);
});
