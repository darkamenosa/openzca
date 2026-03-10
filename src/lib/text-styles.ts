import { TextStyle, type Style } from "zca-js";

type LineStyle = {
  lineIndex: number;
  style: TextStyle;
  indentSize?: number;
};

type Segment = {
  text: string;
  styles: TextStyle[];
};

const TAG_STYLE_MAP: Record<string, TextStyle> = {
  red: TextStyle.Red,
  orange: TextStyle.Orange,
  yellow: TextStyle.Yellow,
  green: TextStyle.Green,
  small: TextStyle.Small,
  big: TextStyle.Big,
  underline: TextStyle.Underline,
};

const INLINE_MARKERS: { pattern: RegExp; style: TextStyle | null; extraStyles?: TextStyle[] }[] = [
  {
    pattern: new RegExp(`\\{(${Object.keys(TAG_STYLE_MAP).join("|")})\\}(.+?)\\{/\\1\\}`, "g"),
    style: null,
  },
  { pattern: /\*\*\*(.+?)\*\*\*/g, style: TextStyle.Bold, extraStyles: [TextStyle.Italic] },
  { pattern: /\*\*(.+?)\*\*/g, style: TextStyle.Bold },
  { pattern: /(?<!\w)__(.+?)__(?!\w)/g, style: TextStyle.Bold },
  { pattern: /\*(.+?)\*/g, style: TextStyle.Italic },
  { pattern: /(?<!\w)_(.+?)_(?!\w)/g, style: TextStyle.Italic },
  { pattern: /~~(.+?)~~/g, style: TextStyle.StrikeThrough },
];

/**
 * Parse markdown-style text and translate it to Zalo's plain-text + range-style format.
 *
 * Supported inline syntax:
 *   **bold**  __bold__  *italic*  _italic_  ~~strikethrough~~
 *   ***bold+italic***  **_combined_**
 *   {red}text{/red}  {orange}...  {yellow}...  {green}...
 *   {small}text{/small}  {big}text{/big}  {underline}text{/underline}
 *
 * Supported line syntax:
 *   # heading       → big + bold
 *   ## heading      → bold
 *   ### heading     → bold + small
 *   #### heading    → bold + small
 *   - item / * item / + item → unordered list
 *   1. item         → ordered list
 *   > text          → indent
 *   leading spaces  → indent
 *
 * Fenced code blocks are downgraded to plain text with fence markers stripped,
 * leading indentation preserved via non-breaking spaces, and inline markdown
 * parsing disabled inside the block.
 */
export function parseTextStyles(input: string): { text: string; styles: Style[] } {
  const allStyles: Style[] = [];

  const escapeMap: string[] = [];
  const escapedInput = input.replace(/\\([*_~#\\{}>+\-])/g, (_match, ch: string) => {
    const index = escapeMap.length;
    escapeMap.push(ch);
    return `\x01${index}\x02`;
  });

  const lines = escapedInput.split("\n");
  const lineStyles: LineStyle[] = [];
  const processedLines: string[] = [];
  const codeOutputLineIndices = new Set<number>();
  let inCodeBlock = false;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    let line = lines[lineIndex];
    let baseIndent = 0;

    if (/^```/.test(line)) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock) {
      const outputLineIndex = processedLines.length;
      codeOutputLineIndices.add(outputLineIndex);
      lineStyles.push({ lineIndex: outputLineIndex, style: TextStyle.Indent, indentSize: 1 });
      processedLines.push(normalizeCodeBlockLeadingWhitespace(line));
      continue;
    }

    const headingMatch = line.match(/^(#{1,4})\s(.*)$/);
    if (headingMatch) {
      const depth = headingMatch[1].length;
      lineStyles.push({ lineIndex, style: TextStyle.Bold });
      if (depth === 1) {
        lineStyles.push({ lineIndex, style: TextStyle.Big });
      } else if (depth === 3 || depth === 4) {
        lineStyles.push({ lineIndex, style: TextStyle.Small });
      }
      processedLines.push(headingMatch[2]);
      continue;
    }

    const quoteMatch = line.match(/^(>+)\s?(.*)$/);
    if (quoteMatch) {
      baseIndent = Math.min(5, quoteMatch[1].length);
      line = quoteMatch[2];
    }

    const indentMatch = line.match(/^(\s+)(.*)$/);
    let indentLevel = 0;
    let content = line;
    if (indentMatch) {
      indentLevel = clampIndent(indentMatch[1].length);
      content = indentMatch[2];
    }
    const totalIndent = Math.min(5, baseIndent + indentLevel);

    if (/^[-*+]\s\[[ xX]\]\s/.test(content)) {
      if (totalIndent > 0) {
        lineStyles.push({ lineIndex, style: TextStyle.Indent, indentSize: totalIndent });
      }
      processedLines.push(content);
      continue;
    }

    const orderedListMatch = content.match(/^(\d+)\.\s(.*)$/);
    if (orderedListMatch) {
      if (totalIndent > 0) {
        lineStyles.push({ lineIndex, style: TextStyle.Indent, indentSize: totalIndent });
      }
      lineStyles.push({ lineIndex, style: TextStyle.OrderedList });
      processedLines.push(orderedListMatch[2]);
      continue;
    }

    const unorderedListMatch = content.match(/^[-*+]\s(.*)$/);
    if (unorderedListMatch) {
      if (totalIndent > 0) {
        lineStyles.push({ lineIndex, style: TextStyle.Indent, indentSize: totalIndent });
      }
      lineStyles.push({ lineIndex, style: TextStyle.UnorderedList });
      processedLines.push(unorderedListMatch[1]);
      continue;
    }

    if (totalIndent > 0) {
      lineStyles.push({ lineIndex, style: TextStyle.Indent, indentSize: totalIndent });
      processedLines.push(content);
      continue;
    }

    processedLines.push(line);
  }

  for (const codeLineIndex of codeOutputLineIndices) {
    if (codeLineIndex >= processedLines.length) {
      continue;
    }
    processedLines[codeLineIndex] = processedLines[codeLineIndex].replace(/[*_~{}]/g, (ch) => {
      const index = escapeMap.length;
      escapeMap.push(ch);
      return `\x01${index}\x02`;
    });
  }

  let segments: Segment[] = [{ text: processedLines.join("\n"), styles: [] }];

  for (const marker of INLINE_MARKERS) {
    const nextSegments: Segment[] = [];
    for (const segment of segments) {
      let lastIndex = 0;
      const regex = new RegExp(marker.pattern.source, marker.pattern.flags);
      let match: RegExpExecArray | null;
      while ((match = regex.exec(segment.text)) !== null) {
        if (match.index > lastIndex) {
          nextSegments.push({
            text: segment.text.slice(lastIndex, match.index),
            styles: [...segment.styles],
          });
        }

        const isTagPattern = marker.style === null;
        const innerText = isTagPattern ? match[2] : match[1];
        const resolvedStyle = isTagPattern ? TAG_STYLE_MAP[match[1]] : marker.style;
        const combinedStyles = [...segment.styles];
        if (resolvedStyle) {
          combinedStyles.push(resolvedStyle);
        }
        if (marker.extraStyles) {
          combinedStyles.push(...marker.extraStyles);
        }

        nextSegments.push({
          text: innerText,
          styles: combinedStyles,
        });
        lastIndex = regex.lastIndex;
      }

      if (lastIndex < segment.text.length) {
        nextSegments.push({
          text: segment.text.slice(lastIndex),
          styles: [...segment.styles],
        });
      } else if (lastIndex === 0) {
        nextSegments.push(segment);
      }
    }
    segments = nextSegments;
  }

  let plainText = "";
  for (const segment of segments) {
    const start = plainText.length;
    plainText += segment.text;
    for (const style of segment.styles) {
      allStyles.push({ start, len: segment.text.length, st: style } as Style);
    }
  }

  const orphanMatches = [...plainText.matchAll(/\*([^*\n]+?)\*/g)];
  for (let index = orphanMatches.length - 1; index >= 0; index -= 1) {
    const match = orphanMatches[index];
    const openPos = match.index ?? 0;
    const content = match[1];
    const closePos = openPos + content.length + 1;

    allStyles.push({ start: openPos + 1, len: content.length, st: TextStyle.Italic });

    plainText = plainText.slice(0, closePos) + plainText.slice(closePos + 1);
    plainText = plainText.slice(0, openPos) + plainText.slice(openPos + 1);

    for (const style of allStyles) {
      if (style.start > closePos) {
        style.start -= 1;
      } else if (style.start + style.len > closePos) {
        style.len -= 1;
      }

      if (style.start > openPos) {
        style.start -= 1;
      } else if (style.start + style.len > openPos) {
        style.len -= 1;
      }
    }
  }

  if (escapeMap.length > 0) {
    const escapeRegex = /\x01(\d+)\x02/g;
    const shifts: { pos: number; delta: number }[] = [];
    let cumulativeDelta = 0;

    for (const match of plainText.matchAll(escapeRegex)) {
      const escapeIndex = Number.parseInt(match[1], 10);
      cumulativeDelta += match[0].length - escapeMap[escapeIndex].length;
      shifts.push({ pos: (match.index ?? 0) + match[0].length, delta: cumulativeDelta });
    }

    for (const style of allStyles) {
      let startDelta = 0;
      let endDelta = 0;
      const end = style.start + style.len;
      for (const shift of shifts) {
        if (shift.pos <= style.start) {
          startDelta = shift.delta;
        }
        if (shift.pos <= end) {
          endDelta = shift.delta;
        }
      }
      style.start -= startDelta;
      style.len -= endDelta - startDelta;
    }

    plainText = plainText.replace(escapeRegex, (_match, index) => escapeMap[Number.parseInt(index, 10)]);
  }

  const finalLines = plainText.split("\n");
  let offset = 0;
  for (let lineIndex = 0; lineIndex < finalLines.length; lineIndex += 1) {
    const lineLength = finalLines[lineIndex].length;
    if (lineLength > 0) {
      for (const lineStyle of lineStyles) {
        if (lineStyle.lineIndex !== lineIndex) {
          continue;
        }

        if (lineStyle.style === TextStyle.Indent) {
          allStyles.push({
            start: offset,
            len: lineLength,
            st: TextStyle.Indent,
            indentSize: lineStyle.indentSize,
          });
        } else {
          allStyles.push({ start: offset, len: lineLength, st: lineStyle.style } as Style);
        }
      }
    }
    offset += lineLength + 1;
  }

  return { text: plainText, styles: allStyles };
}

function clampIndent(spaceCount: number): number {
  return Math.min(5, Math.max(1, Math.floor(spaceCount / 2)));
}

function normalizeCodeBlockLeadingWhitespace(line: string): string {
  return line.replace(/^[ \t]+/, (leadingWhitespace) =>
    leadingWhitespace
      .replace(/\t/g, "\u00A0\u00A0\u00A0\u00A0")
      .replace(/ /g, "\u00A0"),
  );
}
