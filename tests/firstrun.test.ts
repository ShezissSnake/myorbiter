import { test } from "node:test";
import assert from "node:assert/strict";
import { nothingYet, NO_INVENTORY_YET } from "../src/lib/backend";

test("a fresh TennoScope reads as not set up yet, on Linux and Windows alike", () => {
  // What the desktop app says now, on every system.
  assert.ok(nothingYet("not found at C:\\Users\\a\\AppData\\Roaming\\io.github.deftera186.tennoscope\\catalog\\catalog-generation.json: TennoScope hasn't written it yet"));
  // What older builds passed through: Linux's missing file, Windows' missing folder.
  assert.ok(nothingYet("could not read /home/a/.local/share/x/catalog/catalog-generation.json: No such file or directory (os error 2)"));
  assert.ok(nothingYet("could not read C:\\x\\catalog\\catalog-generation.json: The system cannot find the path specified. (os error 3)"));
  assert.ok(nothingYet(NO_INVENTORY_YET));
  // A real failure still reads as one.
  assert.ok(!nothingYet("could not parse catalog-generation.json: expected value at line 1"));
  assert.ok(!nothingYet("could not read x: Access is denied. (os error 5)"));
  assert.ok(!nothingYet("could not read x: (os error 32)"), "os error 32 isn't os error 3");
});
