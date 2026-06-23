import assert from "node:assert/strict";
import { test } from "node:test";

import { cleanSnippet, decodeHtmlEntities, stripHtml } from "../html-text.js";

test("decodeHtmlEntities handles named, decimal, and hex entities; leaves unknowns alone", () => {
  assert.equal(decodeHtmlEntities("a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos;"), `a & b <c> "d" 'e'`);
  assert.equal(decodeHtmlEntities("nbsp[&nbsp;]"), "nbsp[ ]");
  assert.equal(decodeHtmlEntities("&#65;&#x42;"), "AB");
  assert.equal(decodeHtmlEntities("&notareal;"), "&notareal;", "unknown named entity is preserved");
});

test("stripHtml removes tags, maps block ends to newlines, and collapses whitespace", () => {
  assert.equal(stripHtml("<p>Hello <b>world</b></p>"), "Hello world");
  assert.equal(stripHtml("<script>evil()</script>visible"), "visible");
  assert.equal(stripHtml("one<br>two"), "one\ntwo");
  assert.equal(stripHtml("<ul><li>a</li><li>b</li></ul>"), "- a\n- b");
});

test("cleanSnippet collapses all whitespace to single spaces, or returns undefined for non-strings", () => {
  assert.equal(cleanSnippet("<p>A  \n  B</p>"), "A B");
  assert.equal(cleanSnippet(42), undefined);
  assert.equal(cleanSnippet(null), undefined);
});
