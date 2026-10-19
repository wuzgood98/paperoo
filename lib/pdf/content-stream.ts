/**
 * Minimal PDF content-stream tokenizer (ISO 32000-1 §7.2, §7.8.2). It keeps
 * byte offsets so an edit can replace one operation in place and leave every
 * other byte untouched. Content is handled as latin1 text: one char per byte.
 */

export type ContentTokenKind =
  | "array-close"
  | "array-open"
  | "dict-close"
  | "dict-open"
  | "hex-string"
  | "keyword"
  | "name"
  | "number"
  | "string";

export interface ContentToken {
  end: number;
  kind: ContentTokenKind;
  start: number;
  /** Source text of the token (a string token includes its delimiters). */
  text: string;
}

export interface ContentOperation {
  /** Offset just past the operator keyword. */
  end: number;
  operands: ContentToken[];
  operator: string;
  /** Offset of the first operand, or of the operator when it has none. */
  start: number;
}

const WHITESPACE = new Set(["\0", "\t", "\n", "\f", "\r", " "]);
const DELIMITERS = new Set(["(", ")", "<", ">", "[", "]", "{", "}", "/", "%"]);
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)$/u;
const INLINE_IMAGE_END = /[\0\t\n\f\r ]EI(?=[\0\t\n\f\r ]|$)/gu;

const isRegular = (char: string): boolean =>
  !(WHITESPACE.has(char) || DELIMITERS.has(char));

const skipComment = (source: string, from: number): number => {
  let index = from;
  while (
    index < source.length &&
    source[index] !== "\n" &&
    source[index] !== "\r"
  ) {
    index += 1;
  }
  return index;
};

/** End offset (exclusive) of a literal string starting at `(`. */
const literalStringEnd = (source: string, from: number): number => {
  let depth = 0;
  let index = from;
  while (index < source.length) {
    const char = source[index];
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        return index + 1;
      }
    }
    index += 1;
  }
  throw new Error("Unterminated string in content stream.");
};

const hexStringEnd = (source: string, from: number): number => {
  const close = source.indexOf(">", from);
  if (close === -1) {
    throw new Error("Unterminated hex string in content stream.");
  }
  return close + 1;
};

const regularEnd = (source: string, from: number): number => {
  let index = from;
  while (index < source.length && isRegular(source[index] ?? " ")) {
    index += 1;
  }
  return index;
};

/** Next token at or after `from`, or null at the end. */
const readToken = (source: string, from: number): ContentToken | null => {
  let index = from;
  while (index < source.length) {
    const char = source[index] ?? "";
    if (WHITESPACE.has(char)) {
      index += 1;
      continue;
    }
    if (char === "%") {
      index = skipComment(source, index);
      continue;
    }
    break;
  }
  if (index >= source.length) {
    return null;
  }
  const char = source[index];
  const token = (kind: ContentTokenKind, end: number): ContentToken => ({
    end,
    kind,
    start: index,
    text: source.slice(index, end),
  });
  if (char === "(") {
    return token("string", literalStringEnd(source, index));
  }
  if (char === "<") {
    return source[index + 1] === "<"
      ? token("dict-open", index + 2)
      : token("hex-string", hexStringEnd(source, index));
  }
  if (char === ">" && source[index + 1] === ">") {
    return token("dict-close", index + 2);
  }
  if (char === "[") {
    return token("array-open", index + 1);
  }
  if (char === "]") {
    return token("array-close", index + 1);
  }
  if (char === "/") {
    return token("name", regularEnd(source, index + 1));
  }
  if (char === "{" || char === "}") {
    // PostScript calculator braces never appear in page content; keep going.
    return token("keyword", index + 1);
  }
  const end = regularEnd(source, index);
  if (end === index) {
    throw new Error(`Unexpected "${char}" in content stream.`);
  }
  const text = source.slice(index, end);
  return token(NUMBER.test(text) ? "number" : "keyword", end);
};

/** Operand keywords: they are values, not operators. */
const OPERAND_KEYWORDS = new Set(["true", "false", "null"]);

/** Skip the binary data of an inline image that starts after `ID`. */
const inlineImageEnd = (source: string, idEnd: number): number => {
  INLINE_IMAGE_END.lastIndex = idEnd + 1;
  const match = INLINE_IMAGE_END.exec(source);
  if (!match) {
    throw new Error("Inline image without EI in content stream.");
  }
  return match.index + match[0].length;
};

/**
 * Split a content stream into operations. Inline images (`BI … ID … EI`)
 * become one `EI` operation whose operands are the image dictionary tokens.
 */
export const parseContentStream = (source: string): ContentOperation[] => {
  const operations: ContentOperation[] = [];
  let operands: ContentToken[] = [];
  let position = 0;
  for (;;) {
    const token = readToken(source, position);
    if (!token) {
      break;
    }
    position = token.end;
    if (token.kind !== "keyword" || OPERAND_KEYWORDS.has(token.text)) {
      operands.push(token);
      continue;
    }
    if (token.text === "ID") {
      position = inlineImageEnd(source, token.end);
      const begin = operands[0]?.start ?? token.start;
      operations.push({
        end: position,
        operands,
        operator: "EI",
        start: begin,
      });
      operands = [];
      continue;
    }
    if (token.text === "BI") {
      // Collect the inline image dictionary as operands of the coming EI.
      operands = [token];
      continue;
    }
    operations.push({
      end: token.end,
      operands,
      operator: token.text,
      start: operands[0]?.start ?? token.start,
    });
    operands = [];
  }
  return operations;
};

/** Raw path-painting operators; pdf.js emits one constructPath per each. */
export const PATH_PAINT_OPERATORS: ReadonlySet<string> = new Set([
  "S",
  "s",
  "f",
  "F",
  "f*",
  "B",
  "B*",
  "b",
  "b*",
  "n",
]);

/** Raw text-showing operators; pdf.js emits one showText per each. */
export const TEXT_SHOW_OPERATORS: ReadonlySet<string> = new Set([
  "Tj",
  "TJ",
  "'",
  '"',
]);

export interface ContentEdit {
  end: number;
  replacement: string;
  start: number;
}

/** Apply non-overlapping edits; offsets refer to the original `source`. */
export const applyContentEdits = (
  source: string,
  edits: readonly ContentEdit[]
): string => {
  const sorted = edits.toSorted((left, right) => left.start - right.start);
  let result = "";
  let cursor = 0;
  for (const edit of sorted) {
    if (edit.start < cursor) {
      throw new Error("Overlapping content-stream edits.");
    }
    result += source.slice(cursor, edit.start) + edit.replacement;
    cursor = edit.end;
  }
  return result + source.slice(cursor);
};

/** Bytes per `String.fromCharCode` call, well under engine argument limits. */
const LATIN1_CHUNK = 0x80_00;

/** Bytes as a latin1 string: one char per byte. */
export const latin1 = (bytes: Uint8Array): string => {
  const parts: string[] = [];
  for (let start = 0; start < bytes.length; start += LATIN1_CHUNK) {
    parts.push(
      // oxlint-disable-next-line unicorn/prefer-code-point -- bytes are code units 0-255, and fromCharCode takes them in bulk
      String.fromCharCode(...bytes.subarray(start, start + LATIN1_CHUNK))
    );
  }
  return parts.join("");
};

/** Inverse of `latin1`: every char came from one byte, so fits in one. */
export const fromLatin1 = (text: string): Uint8Array => {
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) {
    // oxlint-disable-next-line unicorn/prefer-code-point -- every code unit is one latin1 byte
    bytes[index] = text.charCodeAt(index);
  }
  return bytes;
};
