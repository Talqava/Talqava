import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("names in the Organization Add list can wrap at spaces and within long words", () => {
  const css = readFileSync(new URL("../../public/style.css", import.meta.url), "utf8");
  const nameRule = css.match(/\.additem \.posmain b\s*\{([^}]+)\}/)?.[1];
  assert.ok(nameRule, "the Add list has its own name style");
  assert.match(nameRule, /white-space:\s*normal\s*;/);
  assert.match(nameRule, /overflow-wrap:\s*anywhere\s*;/);
});
