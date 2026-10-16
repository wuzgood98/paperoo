import {
  beginText,
  endText,
  PDFArray,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFOperator,
  PDFOperatorNames,
  popGraphicsState,
  pushGraphicsState,
  setFillingColor,
  setFontAndSize,
  setTextMatrix,
} from "pdf-lib";
import type { Color, PDFDocument, PDFPage } from "pdf-lib";

import type { PdfGlyphShape, PdfPathCommand } from "@/lib/editor/types";
import type { GlyphLayout } from "@/lib/pdf/glyph-face";

/** One-byte codes: a rebuilt font holds at most this many glyphs. */
const MAX_CODES = 256;
const PATH_DIGITS = 5;
const HEX_RADIX = 16;
const UTF16_UNIT_DIGITS = 4;
const RESOURCE_PREFIX = "RebuiltType3";

const num = (value: number): string => {
  const fixed = value.toFixed(PATH_DIGITS);
  return fixed.includes(".") ? fixed.replace(/\.?0+$/u, "") : fixed;
};

const pathOperator = (command: PdfPathCommand): string => {
  switch (command.type) {
    case "moveTo": {
      return `${num(command.x)} ${num(command.y)} m`;
    }
    case "lineTo": {
      return `${num(command.x)} ${num(command.y)} l`;
    }
    case "curveTo": {
      const points = [
        command.x1,
        command.y1,
        command.x2,
        command.y2,
        command.x3,
        command.y3,
      ].map(num);
      return [...points, "c"].join(" ");
    }
    case "closePath": {
      return "h";
    }
    default: {
      return "";
    }
  }
};

/** `d1` glyph procedure: it paints in the current fill color, like Figma's. */
const glyphProcedure = (shape: PdfGlyphShape): string => {
  const [llx, lly, urx, ury] = shape.box;
  const metrics = [shape.width, 0, llx, lly, urx, ury].map(num).join(" ");
  if (shape.commands.length === 0) {
    return `${metrics} d1`;
  }
  const path: string[] = [];
  for (const command of shape.commands) {
    const operator = pathOperator(command);
    if (operator) {
      path.push(operator);
    }
  }
  return `${metrics} d1\n${path.join("\n")}\nf`;
};

const hexByte = (code: number): string =>
  code.toString(HEX_RADIX).padStart(2, "0");

const BMP_LIMIT = 0x1_00_00;
const SURROGATE_SPAN = 0x4_00;
const HIGH_SURROGATE_BASE = 0xd8_00;
const LOW_SURROGATE_BASE = 0xdc_00;

const unitHex = (unit: number): string =>
  unit.toString(HEX_RADIX).padStart(UTF16_UNIT_DIGITS, "0");

/** UTF-16BE hex of `text`, as ToUnicode CMaps expect. */
const utf16Hex = (text: string): string => {
  let hex = "";
  for (const char of text) {
    const point = char.codePointAt(0) ?? 0;
    if (point < BMP_LIMIT) {
      hex += unitHex(point);
      continue;
    }
    const offset = point - BMP_LIMIT;
    hex +=
      unitHex(HIGH_SURROGATE_BASE + Math.floor(offset / SURROGATE_SPAN)) +
      unitHex(LOW_SURROGATE_BASE + (offset % SURROGATE_SPAN));
  }
  return hex;
};

/** ToUnicode CMap so the rebuilt text stays searchable and copyable. */
const toUnicodeCMap = (shapes: readonly PdfGlyphShape[]): string =>
  [
    "/CIDInit /ProcSet findresource begin",
    "12 dict begin",
    "begincmap",
    "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
    "/CMapName /Adobe-Identity-UCS def",
    "/CMapType 2 def",
    "1 begincodespacerange",
    "<00> <FF>",
    "endcodespacerange",
    `${shapes.length} beginbfchar`,
    ...shapes.map(
      (shape, code) => `<${hexByte(code)}> <${utf16Hex(shape.unicode)}>`
    ),
    "endbfchar",
    "endcmap",
    "CMapName currentdict /CMap defineresource pop",
    "end",
    "end",
  ].join("\n");

const fontBox = (
  shapes: readonly PdfGlyphShape[]
): [number, number, number, number] => {
  const boxes = shapes.map((shape) => shape.box);
  return [
    Math.min(0, ...boxes.map((box) => box[0])),
    Math.min(0, ...boxes.map((box) => box[1])),
    Math.max(0, ...boxes.map((box) => box[2])),
    Math.max(0, ...boxes.map((box) => box[3])),
  ];
};

/** Register a Type3 font holding exactly `shapes`, code = index. */
const embedType3Font = (
  doc: PDFDocument,
  page: PDFPage,
  shapes: readonly PdfGlyphShape[]
): PDFName => {
  const { context } = doc;
  const charProcs = context.obj({});
  for (const [code, shape] of shapes.entries()) {
    charProcs.set(
      PDFName.of(`g${code}`),
      context.register(context.flateStream(glyphProcedure(shape)))
    );
  }
  const font = context.obj({
    CharProcs: charProcs,
    Encoding: context.obj({
      Differences: [0, ...shapes.map((_shape, code) => PDFName.of(`g${code}`))],
      Type: "Encoding",
    }),
    FirstChar: 0,
    FontBBox: fontBox(shapes),
    FontMatrix: [1, 0, 0, 1, 0, 0],
    LastChar: shapes.length - 1,
    Resources: context.obj({}),
    Subtype: "Type3",
    ToUnicode: context.register(context.flateStream(toUnicodeCMap(shapes))),
    Type: "Font",
    Widths: shapes.map((shape) => shape.width),
  });
  return page.node.newFontDictionary(RESOURCE_PREFIX, context.register(font));
};

export interface RebuiltTextDraw {
  fill: Color;
  layout: GlyphLayout;
  /** Baseline origin in user space. */
  origin: { x: number; y: number };
  /** Font size in points (the em of the layout). */
  size: number;
}

/**
 * Draw text in the document's own glyphs: a Type3 font rebuilt from the
 * Figma outlines, shown with the document's kerning. False when the text
 * needs more glyphs than one-byte codes allow.
 */
export const pushRebuiltType3Text = (
  doc: PDFDocument,
  page: PDFPage,
  { fill, layout, origin, size }: RebuiltTextDraw
): boolean => {
  const shapes: PdfGlyphShape[] = [];
  const codes = new Map<string, number>();
  for (const { shape } of layout.glyphs) {
    if (!codes.has(shape.key)) {
      codes.set(shape.key, shapes.length);
      shapes.push(shape);
    }
  }
  if (shapes.length === 0 || shapes.length > MAX_CODES) {
    return false;
  }
  const fontKey = embedType3Font(doc, page, shapes);

  const shown = PDFArray.withContext(doc.context);
  for (const [index, { shape }] of layout.glyphs.entries()) {
    const adjustment = layout.adjustments[index] ?? 0;
    if (adjustment !== 0) {
      shown.push(PDFNumber.of(adjustment));
    }
    shown.push(PDFHexString.of(hexByte(codes.get(shape.key) ?? 0)));
  }
  page.pushOperators(
    pushGraphicsState(),
    beginText(),
    setFillingColor(fill),
    setFontAndSize(fontKey, 1),
    setTextMatrix(size, 0, 0, size, origin.x, origin.y),
    PDFOperator.of(PDFOperatorNames.ShowTextAdjusted, [shown]),
    endText(),
    popGraphicsState()
  );
  return true;
};
