import {
  DEFAULT_PDF_TEXT_COLOR,
  DEFAULT_PDF_TEXT_STROKE_COLOR,
  DEFAULT_PDF_TEXT_STROKE_WIDTH,
} from "@/lib/editor/types";
import type {
  ExtractableOperatorList,
  OperatorArg,
  PdfGlyphArg,
} from "@/lib/pdf/extract-images";
import type { ExtractableTextItem } from "@/lib/pdf/extract-text";

/** TextRenderingMode low bits: FILL=0, STROKE=1, FILL_STROKE=2, INVISIBLE=3 (and +4 add-to-path). */
const TEXT_RENDERING_MODE_COUNT = 4;
/** Tr 0–7 are defined; 4–7 also add the glyphs to the clip path. */
const TEXT_RENDERING_MODE_MAX = 7;
const TEXT_RENDERING_FILL = 0;
const TEXT_RENDERING_STROKE = 1;
const TEXT_RENDERING_FILL_STROKE = 2;

export interface PdfTextColorOps {
  nextLineSetSpacingShowText: number;
  nextLineShowText: number;
  paintFormXObjectBegin: number;
  paintFormXObjectEnd: number;
  restore: number;
  save: number;
  setFillCMYKColor: number;
  setFillColor: number;
  setFillColorN: number;
  setFillGray: number;
  setFillRGBColor: number;
  setFillTransparent: number;
  setLineWidth: number;
  setStrokeCMYKColor: number;
  setStrokeColor: number;
  setStrokeColorN: number;
  setStrokeGray: number;
  setStrokeRGBColor: number;
  setStrokeTransparent: number;
  setTextRenderingMode: number;
  showSpacedText: number;
  showText: number;
}

export const toPdfTextColorOps = (ops: PdfTextColorOps): PdfTextColorOps => ({
  ...ops,
});

/**
 * One showText* sample; null means unsupported ink for the active Tr.
 * Invisible modes (3, 7) sample with no fill or stroke ink.
 */
export interface PdfTextPaint {
  color: string | null;
  strokeColor: string | null;
  strokeWidth: number;
  /** Tr as set, 0–7: clip modes stay distinct from their paint-only twins. */
  textRenderingMode: number;
}

/**
 * Paints in show order. `texts[i]` is what show op `i` drew (its glyphs'
 * unicode), or null when the op carried no glyphs; the zip aligns on it.
 */
export type PdfTextPaints = (PdfTextPaint | null)[] & {
  readonly texts?: readonly (string | null)[];
};

/** Per getTextContent item after zip (always concrete defaults). */
export interface PdfTextItemPaint {
  color: string;
  strokeColor: string;
  strokeWidth: number;
  textRenderingMode: number;
}

export interface ZipPdfTextItemPaintsResult {
  aligned: boolean;
  paints: PdfTextItemPaint[];
}

/** @deprecated Prefer ZipPdfTextItemPaintsResult; kept for color-only callers. */
export interface ZipPdfTextItemColorsResult {
  aligned: boolean;
  colors: string[];
}

interface GraphicsState {
  fill: string;
  fillOk: boolean;
  lineWidth: number;
  stroke: string;
  strokeOk: boolean;
  textRenderingMode: number;
}

const finiteNumber = (value: OperatorArg): number | null =>
  Number.isFinite(value) ? Number(value) : null;

const channelToHex = (value: number): string => {
  const clamped = Math.round(Math.min(1, Math.max(0, value)) * 255);
  return clamped.toString(16).padStart(2, "0");
};

const rgbToHex = (r: number, g: number, b: number): string =>
  `#${channelToHex(r)}${channelToHex(g)}${channelToHex(b)}`;

const grayToHex = (gray: number): string => rgbToHex(gray, gray, gray);

const HEX6 = /^#[0-9a-fA-F]{6}$/u;
const HEX3 = /^#[0-9a-fA-F]{3}$/u;

const isStringArg = (value: OperatorArg): value is string =>
  Object.prototype.toString.call(value) === "[object String]";

const parseHexColor = (value: string): string | null => {
  const hex = value.trim();
  if (HEX6.test(hex)) {
    return hex.toLowerCase();
  }
  if (HEX3.test(hex)) {
    const [r, g, b] = hex.slice(1);
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return null;
};

const readRgb = (args: OperatorArg): string | null => {
  if (isStringArg(args)) {
    return parseHexColor(args);
  }
  if (Array.isArray(args) && args.length === 1) {
    const [only] = args;
    // SAFETY: PDF.js color args are either a hex string or nested one-element arrays of the same.
    return readRgb(only as OperatorArg);
  }
  if (!Array.isArray(args) || args.length < 3) {
    return null;
  }
  const r = finiteNumber(args[0]);
  const g = finiteNumber(args[1]);
  const b = finiteNumber(args[2]);
  if (r === null || g === null || b === null) {
    return null;
  }
  return rgbToHex(r, g, b);
};

const readGray = (args: OperatorArg): string | null => {
  if (isStringArg(args)) {
    return parseHexColor(args);
  }
  const gray = Array.isArray(args) ? finiteNumber(args[0]) : finiteNumber(args);
  if (gray === null) {
    return null;
  }
  return grayToHex(gray);
};

const normalizeMode = (textRenderingMode: number): number =>
  ((textRenderingMode % TEXT_RENDERING_MODE_COUNT) +
    TEXT_RENDERING_MODE_COUNT) %
  TEXT_RENDERING_MODE_COUNT;

const needsFill = (textRenderingMode: number): boolean => {
  const mode = normalizeMode(textRenderingMode);
  return mode === TEXT_RENDERING_FILL || mode === TEXT_RENDERING_FILL_STROKE;
};

const needsStroke = (textRenderingMode: number): boolean => {
  const mode = normalizeMode(textRenderingMode);
  return mode === TEXT_RENDERING_STROKE || mode === TEXT_RENDERING_FILL_STROKE;
};

const defaultState = (): GraphicsState => ({
  fill: "#000000",
  fillOk: true,
  lineWidth: DEFAULT_PDF_TEXT_STROKE_WIDTH,
  stroke: DEFAULT_PDF_TEXT_STROKE_COLOR,
  strokeOk: true,
  textRenderingMode: TEXT_RENDERING_FILL,
});

const patchState = (
  current: GraphicsState,
  patch: Partial<GraphicsState>
): GraphicsState => ({ ...current, ...patch });

const isShowTextOp = (fn: number, ops: PdfTextColorOps): boolean =>
  fn === ops.showText ||
  fn === ops.showSpacedText ||
  fn === ops.nextLineShowText ||
  fn === ops.nextLineSetSpacingShowText;

/** Keep a defined Tr (0–7) as is; fold anything else onto its low bits. */
const settledMode = (textRenderingMode: number): number =>
  Number.isInteger(textRenderingMode) &&
  textRenderingMode >= 0 &&
  textRenderingMode <= TEXT_RENDERING_MODE_MAX
    ? textRenderingMode
    : normalizeMode(textRenderingMode);

const samplePaint = (state: GraphicsState): PdfTextPaint | null => {
  const mode = settledMode(state.textRenderingMode);
  const fillNeeded = needsFill(mode);
  const strokeNeeded = needsStroke(mode);
  if (fillNeeded && !state.fillOk) {
    return null;
  }
  if (strokeNeeded && !state.strokeOk) {
    return null;
  }
  return {
    color: fillNeeded ? state.fill : null,
    strokeColor: strokeNeeded ? state.stroke : null,
    strokeWidth: state.lineWidth,
    textRenderingMode: mode,
  };
};

const readScalar = (args: OperatorArg): number | null =>
  Array.isArray(args) ? finiteNumber(args[0]) : finiteNumber(args);

const applyFillColor = (
  current: GraphicsState,
  args: OperatorArg,
  reader: (value: OperatorArg) => string | null
): GraphicsState => {
  const color = reader(args);
  return color
    ? patchState(current, { fill: color, fillOk: true })
    : patchState(current, { fillOk: false });
};

const applyStrokeColor = (
  current: GraphicsState,
  args: OperatorArg,
  reader: (value: OperatorArg) => string | null
): GraphicsState => {
  const color = reader(args);
  return color
    ? patchState(current, { stroke: color, strokeOk: true })
    : patchState(current, { strokeOk: false });
};

const isUnsupportedFillOp = (fn: number, ops: PdfTextColorOps): boolean =>
  fn === ops.setFillCMYKColor ||
  fn === ops.setFillColorN ||
  fn === ops.setFillColor ||
  fn === ops.setFillTransparent;

const isUnsupportedStrokeOp = (fn: number, ops: PdfTextColorOps): boolean =>
  fn === ops.setStrokeCMYKColor ||
  fn === ops.setStrokeColorN ||
  fn === ops.setStrokeColor ||
  fn === ops.setStrokeTransparent;

/** Apply a non-show op; returns null when the op is ignored. */
const applyStateOp = (
  current: GraphicsState,
  fn: number,
  args: OperatorArg,
  ops: PdfTextColorOps
): GraphicsState | null => {
  if (fn === ops.setTextRenderingMode) {
    const mode = readScalar(args);
    return mode === null
      ? current
      : patchState(current, { textRenderingMode: mode });
  }
  if (fn === ops.setLineWidth) {
    const width = readScalar(args);
    return width === null || width < 0
      ? current
      : patchState(current, { lineWidth: width });
  }
  if (fn === ops.setFillRGBColor) {
    return applyFillColor(current, args, readRgb);
  }
  if (fn === ops.setFillGray) {
    return applyFillColor(current, args, readGray);
  }
  if (fn === ops.setStrokeRGBColor) {
    return applyStrokeColor(current, args, readRgb);
  }
  if (fn === ops.setStrokeGray) {
    return applyStrokeColor(current, args, readGray);
  }
  if (isUnsupportedFillOp(fn, ops)) {
    return patchState(current, { fillOk: false });
  }
  if (isUnsupportedStrokeOp(fn, ops)) {
    return patchState(current, { strokeOk: false });
  }
  return null;
};

const isGlyphArg = (value: OperatorArg): value is PdfGlyphArg =>
  Object.prototype.toString.call(value) === "[object Object]";

/** pdf.js passes a show op's glyphs as objects carrying `unicode`; numbers are kerning. */
const shownText = (args: OperatorArg): string | null => {
  const glyphs = Array.isArray(args) ? args[0] : undefined;
  if (!Array.isArray(glyphs)) {
    return null;
  }
  let text = "";
  for (const glyph of glyphs) {
    if (isGlyphArg(glyph)) {
      text += glyph.unicode ?? "";
    }
  }
  return text;
};

/** Walk showText* ops and sample fill/stroke ink at each paint. */
export const extractPdfTextPaints = (
  list: ExtractableOperatorList,
  ops: PdfTextColorOps
): PdfTextPaints => {
  const paints: (PdfTextPaint | null)[] = [];
  const texts: (string | null)[] = [];
  const stack: GraphicsState[] = [];
  let current = defaultState();

  for (const [sourceIndex, fn] of list.fnArray.entries()) {
    const args = list.argsArray[sourceIndex];

    if (fn === ops.save || fn === ops.paintFormXObjectBegin) {
      stack.push(current);
      current = patchState(current, {});
      continue;
    }

    if (fn === ops.restore || fn === ops.paintFormXObjectEnd) {
      current = stack.pop() ?? defaultState();
      continue;
    }

    const next = applyStateOp(current, fn, args, ops);
    if (next !== null) {
      current = next;
      continue;
    }

    if (!isShowTextOp(fn, ops)) {
      continue;
    }

    paints.push(samplePaint(current));
    texts.push(shownText(args));
  }

  // Non-enumerable, so the list still compares and spreads as plain paints.
  return Object.defineProperty(paints, "texts", { value: texts });
};

/**
 * Fill-only view of paints (null when fill is unused or unsupported).
 * Prefer `extractPdfTextPaints` for stroke-aware callers.
 */
export const extractPdfTextFillPaints = (
  list: ExtractableOperatorList,
  ops: PdfTextColorOps
): (string | null)[] =>
  extractPdfTextPaints(list, ops).map((paint) => paint?.color ?? null);

const isPaintableItem = (item: ExtractableTextItem): boolean =>
  item.str !== undefined && item.str !== " " && item.str !== "";

/** Primary ink used for same-color merge recovery: fill if present, else stroke. */
const primaryInk = (paint: PdfTextPaint | null): string | null => {
  if (paint === null) {
    return null;
  }
  return paint.color ?? paint.strokeColor;
};

const allPaintsSamePrimaryInk = (
  paints: readonly (PdfTextPaint | null)[]
): string | null => {
  let shared: string | null = null;
  for (const paint of paints) {
    const ink = primaryInk(paint);
    if (ink === null) {
      return null;
    }
    if (shared === null) {
      shared = ink;
      continue;
    }
    if (ink !== shared) {
      return null;
    }
  }
  return shared;
};

const paintsShareModeAndStroke = (
  paints: readonly (PdfTextPaint | null)[]
): {
  strokeColor: string;
  strokeWidth: number;
  textRenderingMode: number;
} | null => {
  let shared: {
    strokeColor: string;
    strokeWidth: number;
    textRenderingMode: number;
  } | null = null;
  for (const paint of paints) {
    if (paint === null) {
      return null;
    }
    const strokeColor = paint.strokeColor ?? DEFAULT_PDF_TEXT_STROKE_COLOR;
    const next = {
      strokeColor,
      strokeWidth: paint.strokeWidth,
      textRenderingMode: paint.textRenderingMode,
    };
    if (shared === null) {
      shared = next;
      continue;
    }
    if (
      shared.strokeColor !== next.strokeColor ||
      shared.strokeWidth !== next.strokeWidth ||
      shared.textRenderingMode !== next.textRenderingMode
    ) {
      return null;
    }
  }
  return shared;
};

const fallbackItemPaint = (fallback: string): PdfTextItemPaint => ({
  color: fallback,
  strokeColor: DEFAULT_PDF_TEXT_STROKE_COLOR,
  strokeWidth: DEFAULT_PDF_TEXT_STROKE_WIDTH,
  textRenderingMode: TEXT_RENDERING_FILL,
});

const toItemPaint = (
  paint: PdfTextPaint,
  fallback: string
): PdfTextItemPaint => ({
  color: paint.color ?? fallback,
  strokeColor: paint.strokeColor ?? DEFAULT_PDF_TEXT_STROKE_COLOR,
  strokeWidth: paint.strokeWidth,
  textRenderingMode: paint.textRenderingMode,
});

const fallbackPaints = (length: number, fallback: string): PdfTextItemPaint[] =>
  Array.from({ length }, () => fallbackItemPaint(fallback));

/**
 * Count-only zip for paints without text.
 * Fail closed to `fallback` when counts diverge or any paint is unsupported,
 * unless every paint shares one primary ink (same-color merge recovery).
 */
const zipPaintsByCount = (
  items: readonly ExtractableTextItem[],
  paints: readonly (PdfTextPaint | null)[],
  fallback: string
): ZipPdfTextItemPaintsResult => {
  const itemPaints = fallbackPaints(items.length, fallback);
  const paintableIndices: number[] = [];
  for (const [index, item] of items.entries()) {
    if (isPaintableItem(item)) {
      paintableIndices.push(index);
    }
  }

  const sameInk = allPaintsSamePrimaryInk(paints);
  const sharedStroke = paintsShareModeAndStroke(paints);
  if (
    paints.length !== paintableIndices.length ||
    paints.some((paint) => paint === null)
  ) {
    if (
      sameInk !== null &&
      sharedStroke !== null &&
      paints.length > paintableIndices.length &&
      paintableIndices.length > 0
    ) {
      const recovered = toItemPaint(
        {
          color: needsFill(sharedStroke.textRenderingMode) ? sameInk : null,
          strokeColor: needsStroke(sharedStroke.textRenderingMode)
            ? sharedStroke.strokeColor
            : null,
          strokeWidth: sharedStroke.strokeWidth,
          textRenderingMode: sharedStroke.textRenderingMode,
        },
        fallback
      );
      // When fill-only recovery, color is sameInk; when stroke-only, color falls back.
      if (
        needsFill(sharedStroke.textRenderingMode) &&
        !needsStroke(sharedStroke.textRenderingMode)
      ) {
        recovered.color = sameInk;
      } else if (
        needsStroke(sharedStroke.textRenderingMode) &&
        !needsFill(sharedStroke.textRenderingMode)
      ) {
        recovered.color = fallback;
        recovered.strokeColor = sameInk;
      } else {
        recovered.color = sameInk;
        recovered.strokeColor = sharedStroke.strokeColor;
      }
      for (const index of paintableIndices) {
        itemPaints[index] = { ...recovered };
      }
      return { aligned: true, paints: itemPaints };
    }
    return { aligned: false, paints: itemPaints };
  }

  for (const [paintIndex, itemIndex] of paintableIndices.entries()) {
    const paint = paints[paintIndex];
    if (paint === null) {
      itemPaints[itemIndex] = fallbackItemPaint(fallback);
      continue;
    }
    itemPaints[itemIndex] = toItemPaint(paint, fallback);
  }

  return { aligned: true, paints: itemPaints };
};

const WHITESPACE = /\s+/gu;

/**
 * Text as both sides can agree on it: pdf.js items collapse and invent
 * spaces and NFKC-fold ligatures, show ops carry the raw glyph unicode.
 */
const alignKey = (text: string): string =>
  text.normalize("NFKC").replaceAll(WHITESPACE, "");

/** How far past a lost item to look for the next one, in key characters. */
const RESYNC_WINDOW = 256;

/** Every show op's text joined, with each op's start offset into it. */
interface ShowStream {
  starts: number[];
  text: string;
}

const toShowStream = (texts: readonly (string | null)[]): ShowStream => {
  const starts: number[] = [];
  let text = "";
  for (const shown of texts) {
    starts.push(text.length);
    text += alignKey(shown ?? "");
  }
  return { starts, text };
};

/** Index of the show op that drew stream character `offset`. */
const opAt = (stream: ShowStream, offset: number): number => {
  let low = 0;
  let high = stream.starts.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (stream.starts[mid] <= offset) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return low;
};

const samePaint = (
  left: PdfTextPaint | null,
  right: PdfTextPaint | null
): boolean =>
  left === right ||
  (left !== null &&
    right !== null &&
    left.color === right.color &&
    left.strokeColor === right.strokeColor &&
    left.strokeWidth === right.strokeWidth &&
    left.textRenderingMode === right.textRenderingMode);

const MIXED_PAINT = "mixed";

/**
 * The one paint behind stream[start, end), or MIXED_PAINT. One op may span
 * several items (pdf.js splits words) and one item several ops (pdf.js
 * joins runs); a joined item whose ops disagree has no single ink.
 */
const itemPaint = (
  stream: ShowStream,
  paints: readonly (PdfTextPaint | null)[],
  start: number,
  end: number
): PdfTextPaint | null | typeof MIXED_PAINT => {
  const first = opAt(stream, start);
  const last = opAt(stream, end - 1);
  const paint = paints[first] ?? null;
  for (let op = first + 1; op <= last; op += 1) {
    // An op with no text (spaces only, or no glyphs) drew none of the item.
    const drewNothing = stream.starts[op] === stream.starts[op + 1];
    if (!(drewNothing || samePaint(paint, paints[op] ?? null))) {
      return MIXED_PAINT;
    }
  }
  return paint;
};

/** Where `key` sits in the stream from `cursor`, or -1 when it is lost. */
const locateItem = (
  stream: ShowStream,
  key: string,
  nextKey: string | undefined,
  cursor: number
): number => {
  if (stream.text.startsWith(key, cursor)) {
    return cursor;
  }
  // The next item sits right here: this one has no show op of its own.
  if (nextKey && stream.text.startsWith(nextKey, cursor)) {
    return -1;
  }
  const found = stream.text.indexOf(key, cursor);
  return found !== -1 && found - cursor <= RESYNC_WINDOW ? found : -1;
};

/**
 * Align items to show ops on their text. Items that cannot be placed, or
 * whose ink is unsupported, fall back alone. Null when no item aligns.
 */
const zipPaintsByText = (
  items: readonly ExtractableTextItem[],
  paints: readonly (PdfTextPaint | null)[],
  texts: readonly (string | null)[],
  fallback: string
): ZipPdfTextItemPaintsResult | null => {
  const stream = toShowStream(texts);
  if (stream.text === "") {
    return null;
  }
  const keyed: { index: number; key: string }[] = [];
  for (const [index, item] of items.entries()) {
    const key = alignKey(item.str ?? "");
    if (key !== "") {
      keyed.push({ index, key });
    }
  }
  const itemPaints = fallbackPaints(items.length, fallback);
  let cursor = 0;
  let placed = 0;
  let settled = 0;
  for (const [position, { index, key }] of keyed.entries()) {
    const start = locateItem(stream, key, keyed[position + 1]?.key, cursor);
    if (start === -1) {
      continue;
    }
    placed += 1;
    cursor = start + key.length;
    const paint = itemPaint(stream, paints, start, cursor);
    if (paint === MIXED_PAINT) {
      continue;
    }
    settled += 1;
    if (paint) {
      itemPaints[index] = toItemPaint(paint, fallback);
    }
  }
  if (placed === 0) {
    return null;
  }
  return { aligned: settled === keyed.length, paints: itemPaints };
};

/**
 * Zip showText paints onto getTextContent items. With show-op text (from
 * `extractPdfTextPaints`) items align on text, so pdf.js splitting or
 * joining runs costs nothing and a lost or unsupported run falls back
 * alone; `aligned` is false when some item found no show op, or its ops
 * disagree on ink. Without text,
 * or when no item aligns, falls back to a count-only zip.
 */
export const zipPdfTextItemPaints = (
  items: readonly ExtractableTextItem[],
  paints: PdfTextPaints | readonly (PdfTextPaint | null)[],
  fallback: string = DEFAULT_PDF_TEXT_COLOR
): ZipPdfTextItemPaintsResult => {
  const texts = "texts" in paints ? paints.texts : undefined;
  const byText =
    texts && texts.length === paints.length
      ? zipPaintsByText(items, paints, texts, fallback)
      : null;
  return byText ?? zipPaintsByCount(items, paints, fallback);
};

/**
 * Zip fill colors only (legacy). Prefer `zipPdfTextItemPaints`.
 */
export const zipPdfTextItemColors = (
  items: readonly ExtractableTextItem[],
  paints: readonly (string | null)[],
  fallback: string = DEFAULT_PDF_TEXT_COLOR
): ZipPdfTextItemColorsResult => {
  const paintRecords: (PdfTextPaint | null)[] = paints.map((color) =>
    color === null
      ? null
      : {
          color,
          strokeColor: null,
          strokeWidth: DEFAULT_PDF_TEXT_STROKE_WIDTH,
          textRenderingMode: TEXT_RENDERING_FILL,
        }
  );
  const { aligned, paints: itemPaints } = zipPdfTextItemPaints(
    items,
    paintRecords,
    fallback
  );
  return {
    aligned,
    colors: itemPaints.map((paint) => paint.color),
  };
};
