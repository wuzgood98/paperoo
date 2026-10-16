import { expect, test } from "vitest";

import {
  applyContentEdits,
  parseContentStream,
} from "@/lib/pdf/content-stream";

const operators = (source: string): string[] =>
  parseContentStream(source).map((operation) => operation.operator);

test("operations keep their operands and byte range", () => {
  const source = "q 1 0 0 1 10 20 cm /F1 12 Tf Q";
  const [save, transform, font] = parseContentStream(source);

  expect(save?.operator).toBe("q");
  expect(transform?.operands.map((token) => token.text)).toEqual([
    "1",
    "0",
    "0",
    "1",
    "10",
    "20",
  ]);
  expect(transform && source.slice(transform.start, transform.end)).toBe(
    "1 0 0 1 10 20 cm"
  );
  expect(font?.operands.map((token) => token.kind)).toEqual(["name", "number"]);
});

test("literal strings keep nested parens, escapes, and delimiters", () => {
  const source = String.raw`(a (b) \) [c] /d % e) Tj`;
  const [show] = parseContentStream(source);

  expect(show?.operator).toBe("Tj");
  expect(show?.operands).toHaveLength(1);
  expect(show?.operands[0]?.text).toBe(String.raw`(a (b) \) [c] /d % e)`);
});

test("hex strings, arrays, and dictionaries are operands", () => {
  const source = "[<0102> -120 (x)] TJ /OC <</MCID 3>> BDC EMC";
  const [show, marked, end] = parseContentStream(source);

  expect(show?.operands.map((token) => token.kind)).toEqual([
    "array-open",
    "hex-string",
    "number",
    "string",
    "array-close",
  ]);
  expect(marked?.operator).toBe("BDC");
  expect(end?.operator).toBe("EMC");
});

test("comments are skipped", () => {
  expect(operators("q % save the state\n0 g Q")).toEqual(["q", "g", "Q"]);
});

test("inline image data is skipped whole", () => {
  const binary = String.fromCodePoint(0, 255, 69, 73, 10, 81);
  const source = `q BI /W 2 /H 1 /BPC 8 /CS /G ID ${binary} EI Q 0 0 m`;

  expect(operators(source)).toEqual(["q", "EI", "Q", "m"]);
});

test("true, false, and null are operands, not operators", () => {
  const [operation] = parseContentStream("true false null op");

  expect(operation?.operator).toBe("op");
  expect(operation?.operands).toHaveLength(3);
});

test("an unterminated string is rejected", () => {
  expect(() => parseContentStream("(open Tj")).toThrow(/Unterminated/u);
});

test("edits replace exact ranges and keep every other byte", () => {
  const source = "BT (old) Tj ET 0 0 m 1 1 l f";
  const [, show] = parseContentStream(source);
  const string = show?.operands[0];

  const result = applyContentEdits(source, [
    { end: string?.end ?? 0, replacement: "()", start: string?.start ?? 0 },
    { end: source.length, replacement: "n", start: source.length - 1 },
  ]);

  expect(result).toBe("BT () Tj ET 0 0 m 1 1 l n");
});

test("overlapping edits are refused", () => {
  expect(() =>
    applyContentEdits("abcdef", [
      { end: 4, replacement: "", start: 1 },
      { end: 5, replacement: "", start: 3 },
    ])
  ).toThrow(/Overlapping/u);
});
