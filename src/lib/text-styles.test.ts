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

test("strips fenced code markers and preserves leading indentation as non-breaking spaces", () => {
  assert.deepStrictEqual(parseTextStyles("```\n  code\n    deeper\n```"), {
    text: "\u00A0\u00A0code\n\u00A0\u00A0\u00A0\u00A0deeper",
    styles: [],
  });
});

test("keeps unindented fenced code lines untouched", () => {
  assert.deepStrictEqual(parseTextStyles("```\nconst x = 1\n  return x\n```"), {
    text: "const x = 1\n\u00A0\u00A0return x",
    styles: [],
  });
});

test("keeps markdown markers literal inside fenced code blocks", () => {
  assert.deepStrictEqual(parseTextStyles("```\n**bold**\n{red}x{/red}\n```"), {
    text: "**bold**\n{red}x{/red}",
    styles: [],
  });
});

test("expands leading tabs inside fenced code blocks", () => {
  assert.deepStrictEqual(parseTextStyles("```\n\tcode\n```"), {
    text: "\u00A0\u00A0\u00A0\u00A0code",
    styles: [],
  });
});

test("strips fenced code language markers", () => {
  assert.deepStrictEqual(parseTextStyles("```javascript\n  const x = 1\n```"), {
    text: "\u00A0\u00A0const x = 1",
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

test("combines quote depth and extra leading spaces into one indent style", () => {
  assert.deepStrictEqual(parseTextStyles(">   hello"), {
    text: "hello",
    styles: [{ start: 0, len: 5, st: TextStyle.Indent, indentSize: 2 }],
  });
});

test("combines quote depth with nested ordered list indentation", () => {
  assert.deepStrictEqual(parseTextStyles(">   1. child _item_"), {
    text: "child item",
    styles: [
      { start: 6, len: 4, st: TextStyle.Italic },
      { start: 0, len: 10, st: TextStyle.Indent, indentSize: 2 },
      { start: 0, len: 10, st: TextStyle.OrderedList },
    ],
  });
});

test("applies indent and ordered list styles to nested ordered list items", () => {
  const input = [
    "1. First item",
    "2. Second item",
    "3. Third item",
    "    1. Indented item",
    "    2. Indented item",
    "4. Fourth item",
  ].join("\n");

  assert.deepStrictEqual(parseTextStyles(input), {
    text: "First item\nSecond item\nThird item\nIndented item\nIndented item\nFourth item",
    styles: [
      { start: 0, len: 10, st: TextStyle.OrderedList },
      { start: 11, len: 11, st: TextStyle.OrderedList },
      { start: 23, len: 10, st: TextStyle.OrderedList },
      { start: 34, len: 13, st: TextStyle.Indent, indentSize: 2 },
      { start: 34, len: 13, st: TextStyle.OrderedList },
      { start: 48, len: 13, st: TextStyle.Indent, indentSize: 2 },
      { start: 48, len: 13, st: TextStyle.OrderedList },
      { start: 62, len: 11, st: TextStyle.OrderedList },
    ],
  });
});

test("applies indent and unordered list styles to nested unordered list items", () => {
  const input = [
    "- First item",
    "- Second item",
    "- Third item",
    "    - Indented item",
    "    - Indented item",
    "- Fourth item",
  ].join("\n");

  assert.deepStrictEqual(parseTextStyles(input), {
    text: "First item\nSecond item\nThird item\nIndented item\nIndented item\nFourth item",
    styles: [
      { start: 0, len: 10, st: TextStyle.UnorderedList },
      { start: 11, len: 11, st: TextStyle.UnorderedList },
      { start: 23, len: 10, st: TextStyle.UnorderedList },
      { start: 34, len: 13, st: TextStyle.Indent, indentSize: 2 },
      { start: 34, len: 13, st: TextStyle.UnorderedList },
      { start: 48, len: 13, st: TextStyle.Indent, indentSize: 2 },
      { start: 48, len: 13, st: TextStyle.UnorderedList },
      { start: 62, len: 11, st: TextStyle.UnorderedList },
    ],
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
    text: "Title\nquote with bold\nfirst\nchild hot\n- [x] done\nplain *star* and tag\n\u00A0\u00A0const x = 1",
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
