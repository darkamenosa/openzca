import assert from "node:assert/strict";
import test from "node:test";

import { TextStyle } from "zca-js";

import { parseTextStyles } from "./text-styles.js";

test("converts leading whitespace into Zalo indent styles", () => {
  assert.deepStrictEqual(parseTextStyles("  indented plain"), {
    text: "indented plain",
    styles: [{ start: 0, len: 14, st: TextStyle.Indent, indentSize: 1 }],
  });
});

test("preserves fenced code content with literal spaces", () => {
  assert.deepStrictEqual(parseTextStyles("```\n  code\n    deeper\n```"), {
    text: "  code\n    deeper",
    styles: [],
  });
});

test("keeps unindented fenced code lines untouched", () => {
  assert.deepStrictEqual(parseTextStyles("```\nconst x = 1\n  return x\n```"), {
    text: "const x = 1\n  return x",
    styles: [],
  });
});

test("keeps markdown markers literal inside fenced code blocks", () => {
  assert.deepStrictEqual(parseTextStyles("```\n**bold**\n{red}x{/red}\n```"), {
    text: "**bold**\n{red}x{/red}",
    styles: [],
  });
});

test("caps non-code indentation styles at five levels", () => {
  assert.deepStrictEqual(parseTextStyles("            deep"), {
    text: "deep",
    styles: [{ start: 0, len: 4, st: TextStyle.Indent, indentSize: 5 }],
  });
});

test("treats escaped custom tags as literal text", () => {
  assert.deepStrictEqual(parseTextStyles("\\{red}x{/red}"), {
    text: "{red}x{/red}",
    styles: [],
  });
});

test("supports nested markdown emphasis", () => {
  assert.deepStrictEqual(parseTextStyles("*italic **bold** italic*"), {
    text: "italic bold italic",
    styles: [
      { start: 7, len: 4, st: TextStyle.Bold },
      { start: 0, len: 18, st: TextStyle.Italic },
    ],
  });
});

test("supports Zalo-specific underline tags", () => {
  assert.deepStrictEqual(parseTextStyles("{underline}x{/underline}"), {
    text: "x",
    styles: [{ start: 0, len: 1, st: TextStyle.Underline }],
  });
});

test("parses a mixed markdown document with headings, lists, tags, escapes, and fenced code", () => {
  const input = [
    "# Title",
    "> quote with **bold**",
    "1. first",
    "  - child {red}hot{/red}",
    "- [x] done",
    "plain \\*star\\* and {underline}tag{/underline}",
    "```",
    "  const x = 1",
    "```",
  ].join("\n");

  assert.deepStrictEqual(parseTextStyles(input), {
    text: "Title\nquote with bold\nfirst\nchild hot\n- [x] done\nplain *star* and tag\n  const x = 1",
    styles: [
      { start: 17, len: 4, st: TextStyle.Bold },
      { start: 34, len: 3, st: TextStyle.Red },
      { start: 66, len: 3, st: TextStyle.Underline },
      { start: 0, len: 5, st: TextStyle.Bold },
      { start: 0, len: 5, st: TextStyle.Big },
      { start: 6, len: 15, st: TextStyle.Indent, indentSize: 1 },
      { start: 22, len: 5, st: TextStyle.OrderedList },
      { start: 28, len: 9, st: TextStyle.Indent, indentSize: 1 },
      { start: 28, len: 9, st: TextStyle.UnorderedList },
    ],
  });
});

test("parses multiple line styles together without styling escaped markers", () => {
  const input = ["## Section", "- item **bold**", "1. count", "  child", "plain \\_underscore\\_"].join("\n");

  assert.deepStrictEqual(parseTextStyles(input), {
    text: "Section\nitem bold\ncount\nchild\nplain _underscore_",
    styles: [
      { start: 13, len: 4, st: TextStyle.Bold },
      { start: 0, len: 7, st: TextStyle.Bold },
      { start: 8, len: 9, st: TextStyle.UnorderedList },
      { start: 18, len: 5, st: TextStyle.OrderedList },
      { start: 24, len: 5, st: TextStyle.Indent, indentSize: 1 },
    ],
  });
});
