import assert from "node:assert/strict";
import { test } from "node:test";

import { normalizeThemeCss } from "../theme-css.js";

test("normalizeThemeCss un-escapes CSS saved with literal \\n / \\r / \\t sequences", () => {
  assert.equal(normalizeThemeCss("body {\\n  color: red;\\n}"), "body {\n  color: red;\n}");
  assert.equal(normalizeThemeCss("a{\\tcolor:red}"), "a{  color:red}", "tabs become two spaces");
});

test("normalizeThemeCss is a no-op when there is nothing to fix", () => {
  const real = "body {\n  color: red;\n}";
  assert.equal(normalizeThemeCss(real), real, "already has real newlines");
  assert.equal(normalizeThemeCss("body { color: red; }"), "body { color: red; }", "no escape sequences");
  assert.equal(normalizeThemeCss("just a sentence with \\n but no css"), "just a sentence with \\n but no css");
});
