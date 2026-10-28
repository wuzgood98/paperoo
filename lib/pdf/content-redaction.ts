import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRawStream,
} from "pdf-lib";
import type { PDFContext, PDFDocument, PDFObject, PDFRef } from "pdf-lib";

import {
  apply,
  boundsOf,
  contains,
  IDENTITY,
  inflate,
  invert,
  isAxisAligned,
  mappedBounds,
  maxScale,
  multiply,
  overlaps,
  rectBounds,
  segmentOutside,
  subtractRect,
  translate,
} from "@/lib/pdf/content-geometry";
import type {
  Bounds2,
  Matrix,
  Point2,
  Segment,
} from "@/lib/pdf/content-geometry";
import {
  applyContentEdits,
  fromLatin1,
  latin1,
  parseContentStream,
} from "@/lib/pdf/content-stream";
import type {
  ContentEdit,
  ContentOperation,
  ContentToken,
} from "@/lib/pdf/content-stream";
import { redactImage } from "@/lib/pdf/image-redaction";
import type { ImageCodec } from "@/lib/pdf/image-redaction";
import type { RedactionBox } from "@/lib/pdf/output-pages";
import { redactionFontFor } from "@/lib/pdf/redaction-fonts";
import type { RedactionFont, ShownGlyph } from "@/lib/pdf/redaction-fonts";

export interface ContentRedactionInput {
  boxes: readonly RedactionBox[];
  /** Decodes and encodes JPEG images under a box; without it they flatten. */
  codec?: ImageCodec;
  /** The output document's context, where rewritten XObjects go. */
  context: PDFContext;
  operations: readonly ContentOperation[];
  /** The page's `/Resources`, for fonts, XObjects and marked-content properties. */
  resources: PDFDict | undefined;
  /** Show ops (by index) Removal already empties: nothing left to redact. */
  emptiedShows?: ReadonlySet<number>;
}

export type ContentRedactionPlan =
  | {
      edits: ContentEdit[];
      ok: true;
      /** XObjects the edited content draws by new names. */
      xObjects: ReadonlyMap<string, PDFRef>;
    }
  | { ok: false; reason: string };

/** An image under a box, to be blanked once the content has been read. */
interface ImageJob {
  boxes: readonly RedactionBox[];
  ctm: Matrix;
  ref: PDFRef;
  stream: PDFRawStream;
}

/** State shared by a page's content and the forms it draws. */
interface Shared {
  jobs: ImageJob[];
  names: number;
}

/** Forms inside forms: deeper than this is not followed. */
const MAX_FORM_DEPTH = 8;

/** Something under a box this pass cannot take out exactly. */
const NOT_PRECISE = "NotPreciseError";

const notPrecise = (reason: string): never => {
  throw Object.assign(new Error(reason), { name: NOT_PRECISE });
};

const THOUSAND = 1000;
const HUNDRED = 100;
const DECIMALS = 4;
/** Unknown fonts: assume glyphs up to this many ems wide, for a safe extent. */
const UNKNOWN_GLYPH_EMS = 2;
const UNKNOWN_ASCENT = 1.5;
const UNKNOWN_DESCENT = -1;
const CLIP_RENDER_MODES = new Set([4, 5, 6, 7]);
const STROKE_OPS = new Set(["S", "s", "B", "B*", "b", "b*"]);
const FILL_OPS = new Set(["f", "F", "f*", "B", "B*", "b", "b*"]);
const CLOSING_PAINT_OPS = new Set(["s", "b", "b*"]);
const EVEN_ODD_OPS = new Set(["f*", "B*", "b*"]);
const PATH_PAINT_OPS = new Set([
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
const PATH_BUILD_OPS = new Set(["m", "l", "c", "v", "y", "h", "re", "W", "W*"]);
const HIDDEN_TEXT_KEYS = ["/ActualText", "/Alt", "/E"];
const OCTAL = /^[0-7]{1,3}/u;
const ESCAPES = new Map([
  ["(", "("],
  [")", ")"],
  ["\\", "\\"],
  ["b", "\b"],
  ["f", "\f"],
  ["n", "\n"],
  ["r", "\r"],
  ["t", "\t"],
]);
const HEX_PAIR = 2;
const HEX_BASE = 16;

/** The bytes a string token encodes, one latin1 char per byte. */
export const stringTokenBytes = (token: ContentToken): string => {
  if (token.kind === "hex-string") {
    const digits = token.text.slice(1, -1).replaceAll(/[^\da-fA-F]/gu, "");
    const padded = digits.length % 2 === 0 ? digits : `${digits}0`;
    let bytes = "";
    for (let index = 0; index < padded.length; index += HEX_PAIR) {
      bytes += String.fromCodePoint(
        Number.parseInt(padded.slice(index, index + HEX_PAIR), HEX_BASE)
      );
    }
    return bytes;
  }
  const body = token.text.slice(1, -1);
  let bytes = "";
  let index = 0;
  while (index < body.length) {
    const char = body[index] ?? "";
    if (char !== "\\") {
      // An end-of-line in a literal string is one \n byte.
      if (char === "\r") {
        bytes += "\n";
        index += body[index + 1] === "\n" ? 2 : 1;
        continue;
      }
      bytes += char;
      index += 1;
      continue;
    }
    const next = body[index + 1] ?? "";
    const octal = OCTAL.exec(body.slice(index + 1))?.[0];
    if (octal) {
      // oxlint-disable-next-line no-magic-numbers -- octal escape, base 8
      bytes += String.fromCodePoint(Number.parseInt(octal, 8) % 256);
      index += 1 + octal.length;
    } else if (next === "\r" || next === "\n") {
      index += next === "\r" && body[index + 2] === "\n" ? 3 : 2;
    } else {
      bytes += ESCAPES.get(next) ?? next;
      index += 2;
    }
  }
  return bytes;
};

const hexString = (bytes: string): string =>
  `<${[...bytes]
    .map((char) =>
      (char.codePointAt(0) ?? 0).toString(HEX_BASE).padStart(HEX_PAIR, "0")
    )
    .join("")
    .toUpperCase()}>`;

const formatNumber = (value: number): string => {
  const fixed = value.toFixed(DECIMALS);
  const trimmed = fixed.includes(".")
    ? fixed.replace(/0+$/u, "").replace(/\.$/u, "")
    : fixed;
  return trimmed === "-0" ? "0" : trimmed;
};

const numbers = (operation: ContentOperation): number[] =>
  operation.operands.map((token) => Number(token.text));

const matrixOf = (operation: ContentOperation): Matrix => {
  const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = numbers(operation);
  return [a, b, c, d, e, f];
};

/**
 * How far the glyphs of a font that cannot be measured reach from the pen,
 * in ems: the most one glyph advances, and where its ink can lie. Null ink
 * means anywhere.
 */
interface GlyphReach {
  advance: number;
  ink: Bounds2 | null;
}

interface GraphicsState {
  charSpacing: number;
  ctm: Matrix;
  font: RedactionFont | null;
  fontSize: number;
  /** Where glyphs reach when `font` is null. */
  glyphReach: GlyphReach;
  hScale: number;
  leading: number;
  lineWidth: number;
  /** The fill or stroke colour is a pattern. */
  pattern: { fill: boolean; stroke: boolean };
  renderMode: number;
  rise: number;
  wordSpacing: number;
}

interface TextPosition {
  /** False after a show the page's fonts could not measure. */
  known: boolean;
  line: Matrix;
  matrix: Matrix;
}

interface MarkedContent {
  /** The inline property dictionary's token range, if any. */
  dict: { end: number; start: number; text: string } | null;
  named: string | null;
  touched: boolean;
}

/** A show operator's elements: glyph strings and TJ displacements. */
type ShowElement = { bytes: string } | { displacement: number };

const showElements = (operation: ContentOperation): ShowElement[] => {
  const elements: ShowElement[] = [];
  for (const token of operation.operands) {
    if (token.kind === "string" || token.kind === "hex-string") {
      elements.push({ bytes: stringTokenBytes(token) });
    } else if (operation.operator === "TJ" && token.kind === "number") {
      elements.push({ displacement: Number(token.text) });
    }
  }
  return operation.operator === "TJ" ? elements : elements.slice(-1);
};

/** One measured element of a show: kept or removed glyph, or a displacement. */
type Placed =
  | { advance: number; bytes: string; removed: boolean }
  | { advance: number; displacement: number };

const lookupDict = (
  dict: PDFDict | undefined,
  key: string
): PDFDict | undefined => dict?.lookupMaybe(PDFName.of(key), PDFDict);

const arrayNumbers = (array: PDFArray | undefined): number[] =>
  array
    ? array.asArray().map((_, index) => {
        const value = array.lookup(index);
        return value instanceof PDFNumber ? value.asNumber() : 0;
      })
    : [];

const UNKNOWN_REACH: GlyphReach = {
  advance: UNKNOWN_GLYPH_EMS,
  ink: { maxX: 0, maxY: UNKNOWN_ASCENT, minX: 0, minY: UNKNOWN_DESCENT },
};

const DEFAULT_TYPE3_MATRIX: Matrix = [0.001, 0, 0, 0.001, 0, 0];

/**
 * A Type3 font's reach: its glyph procedures can paint anywhere the
 * FontMatrix puts them, so the reach comes from the FontBBox and Widths it
 * declares. Without a usable FontBBox the ink can lie anywhere.
 */
const type3Reach = (font: PDFDict): GlyphReach => {
  const box = arrayNumbers(font.lookupMaybe(PDFName.of("FontBBox"), PDFArray));
  const listed = arrayNumbers(
    font.lookupMaybe(PDFName.of("FontMatrix"), PDFArray)
  );
  const matrix: Matrix =
    listed.length === 6
      ? [
          listed[0] ?? 0,
          listed[1] ?? 0,
          listed[2] ?? 0,
          listed[3] ?? 0,
          listed[4] ?? 0,
          listed[5] ?? 0,
        ]
      : DEFAULT_TYPE3_MATRIX;
  const widths = arrayNumbers(font.lookupMaybe(PDFName.of("Widths"), PDFArray));
  const advance = Math.max(
    UNKNOWN_GLYPH_EMS,
    ...widths.map((width) => Math.abs(width) * maxScale(matrix))
  );
  const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = box;
  if (box.length !== 4 || x0 === x1 || y0 === y1) {
    return { advance, ink: null };
  }
  const ink = mappedBounds(matrix, x0, y0, x1, y1);
  return {
    advance,
    ink: {
      maxX: Math.max(0, ink.maxX),
      maxY: Math.max(UNKNOWN_ASCENT, ink.maxY),
      minX: Math.min(0, ink.minX),
      minY: Math.min(UNKNOWN_DESCENT, ink.minY),
    },
  };
};

const UNBOUNDED: Bounds2 = {
  maxX: Number.POSITIVE_INFINITY,
  maxY: Number.POSITIVE_INFINITY,
  minX: Number.NEGATIVE_INFINITY,
  minY: Number.NEGATIVE_INFINITY,
};

/** Where an XObject paints: the unit square, or a form's BBox × Matrix. */
const xObjectBounds = (dict: PDFDict | undefined, ctm: Matrix): Bounds2 => {
  if (dict?.get(PDFName.of("Subtype")) !== PDFName.of("Form")) {
    return mappedBounds(ctm, 0, 0, 1, 1);
  }
  const box = dict.lookupMaybe(PDFName.of("BBox"), PDFArray);
  const isRect =
    box?.size() === 4 &&
    box.asArray().every((_, index) => box.lookup(index) instanceof PDFNumber);
  if (!isRect) {
    // Renderers draw a form without a usable BBox unclipped, so it may
    // paint anywhere.
    return UNBOUNDED;
  }
  const matrix = dict.lookupMaybe(PDFName.of("Matrix"), PDFArray);
  const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = arrayNumbers(box);
  const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = arrayNumbers(matrix);
  return mappedBounds(multiply([a, b, c, d, e, f], ctm), x0, y0, x1, y1);
};

const describes = (text: string): boolean =>
  HIDDEN_TEXT_KEYS.some((key) => text.includes(key));

/** The source text of the tokens between two offsets, space-joined. */
const tokenText = (
  tokens: readonly ContentToken[],
  start: number,
  end: number
): string => {
  const parts: string[] = [];
  for (const token of tokens) {
    if (token.start >= start && token.end <= end) {
      parts.push(token.text);
    }
  }
  return parts.join(" ");
};

/** A replacement `TJ` array: kept glyphs as strings, each removed span one gap. */
const rewriteShow = (placed: readonly Placed[], scale: number): string => {
  const parts: string[] = [];
  let kept = "";
  let gap = 0;
  let gapOpen = false;
  const flushKept = (): void => {
    if (kept !== "") {
      parts.push(hexString(kept));
      kept = "";
    }
  };
  const flushGap = (): void => {
    if (gapOpen) {
      parts.push(formatNumber((-gap / scale) * THOUSAND));
      gap = 0;
      gapOpen = false;
    }
  };
  for (const item of placed) {
    if ("displacement" in item || item.removed) {
      flushKept();
      gap += item.advance;
      gapOpen = true;
      continue;
    }
    flushGap();
    kept += item.bytes;
  }
  flushKept();
  flushGap();
  return `[${parts.join(" ")}]`;
};

interface ReadPath {
  clips: boolean;
  curved: boolean;
  points: Point2[];
  /** Straight open or closed polylines (not `re`). */
  polygons: { closed: boolean; points: Point2[] }[];
  rects: Bounds2[];
}

/** The subpaths a run of path-building operators makes. */
// oxlint-disable-next-line eslint/complexity -- one case per path operator
const readPath = (operations: readonly ContentOperation[]): ReadPath | null => {
  const path: ReadPath = {
    clips: false,
    curved: false,
    points: [],
    polygons: [],
    rects: [],
  };
  let current: { closed: boolean; points: Point2[] } | null = null;
  for (const operation of operations) {
    const values = numbers(operation);
    if (values.some((value) => !Number.isFinite(value))) {
      return null;
    }
    const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = values;
    switch (operation.operator) {
      case "m": {
        current = { closed: false, points: [{ x: a, y: b }] };
        path.polygons.push(current);
        path.points.push({ x: a, y: b });
        break;
      }
      case "l": {
        current?.points.push({ x: a, y: b });
        path.points.push({ x: a, y: b });
        break;
      }
      case "c": {
        path.curved = true;
        path.points.push({ x: a, y: b }, { x: c, y: d }, { x: e, y: f });
        current?.points.push({ x: e, y: f });
        break;
      }
      case "v":
      case "y": {
        path.curved = true;
        const last = current?.points.at(-1);
        if (last) {
          path.points.push(last);
        }
        path.points.push({ x: a, y: b }, { x: c, y: d });
        current?.points.push({ x: c, y: d });
        break;
      }
      case "re": {
        path.rects.push({
          maxX: Math.max(a, a + c),
          maxY: Math.max(b, b + d),
          minX: Math.min(a, a + c),
          minY: Math.min(b, b + d),
        });
        path.points.push({ x: a, y: b }, { x: a + c, y: b + d });
        current = null;
        break;
      }
      case "h": {
        if (current) {
          current.closed = true;
        }
        break;
      }
      case "W":
      case "W*": {
        path.clips = true;
        break;
      }
      default: {
        break;
      }
    }
  }
  return path;
};

/** Every straight segment a stroke of the path draws. */
const pathSegments = (path: ReadPath, closeAll: boolean): Segment[] => {
  const segments: Segment[] = [];
  for (const rect of path.rects) {
    const corners: Point2[] = [
      { x: rect.minX, y: rect.minY },
      { x: rect.maxX, y: rect.minY },
      { x: rect.maxX, y: rect.maxY },
      { x: rect.minX, y: rect.maxY },
    ];
    for (const [index, corner] of corners.entries()) {
      segments.push({ from: corner, to: corners[(index + 1) % 4] ?? corner });
    }
  }
  for (const polygon of path.polygons) {
    const { points } = polygon;
    for (let index = 1; index < points.length; index += 1) {
      const from = points[index - 1];
      const to = points[index];
      if (from && to) {
        segments.push({ from, to });
      }
    }
    const [head] = points;
    const tail = points.at(-1);
    if ((polygon.closed || closeAll) && head && tail && points.length > 2) {
      segments.push({ from: tail, to: head });
    }
  }
  return segments;
};

const SHOW_OPS = new Set(["Tj", "TJ", "'", '"']);
const EMPTY_STRINGS = new Set(["()", "<>"]);

/**
 * Names of the fonts that still show a glyph. Redaction leaves a removed
 * run's Tf in place and empties its show, so selecting a font is not using
 * it. Null when a show runs before any Tf: it uses a font set by whoever
 * draws this content.
 */
const fontsShowingGlyphs = (
  operations: readonly ContentOperation[]
): Set<string> | null => {
  const used = new Set<string>();
  const stack: (string | null)[] = [];
  let font: string | null = null;
  for (const { operands, operator } of operations) {
    if (operator === "q") {
      stack.push(font);
    } else if (operator === "Q") {
      const restored = stack.pop();
      if (restored !== undefined) {
        font = restored;
      }
    } else if (operator === "Tf") {
      font = operands[0]?.text ?? null;
    } else if (SHOW_OPS.has(operator)) {
      const showsGlyphs = operands.some(
        (token) =>
          (token.kind === "string" || token.kind === "hex-string") &&
          !EMPTY_STRINGS.has(token.text)
      );
      if (showsGlyphs && font === null) {
        return null;
      }
      if (showsGlyphs && font !== null) {
        used.add(font);
      }
    }
  }
  return used;
};

interface ResourceUse {
  drawn: Set<string>;
  fonts: Set<string> | null;
}

/**
 * The XObject names a content stream draws and the font names it shows
 * glyphs in. A form without resources of its own draws from these same
 * resources, so what it uses counts too. Fonts are null when they cannot
 * be told.
 */
const resourcesUsed = (
  context: PDFContext,
  xObjects: PDFDict,
  content: string
): ResourceUse => {
  const drawn = new Set<string>();
  let fonts: Set<string> | null = new Set<string>();
  const pending = [content];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    let operations: ContentOperation[];
    try {
      operations = parseContentStream(next);
    } catch {
      return { drawn: new Set(xObjects.keys().map(String)), fonts: null };
    }
    const shown = fontsShowingGlyphs(operations);
    fonts = shown && fonts ? new Set([...fonts, ...shown]) : null;
    for (const operation of operations) {
      const name = operation.operands[0]?.text;
      if (operation.operator !== "Do" || !name || drawn.has(name)) {
        continue;
      }
      drawn.add(name);
      const form = context.lookup(xObjects.get(PDFName.of(name.slice(1))));
      if (
        form instanceof PDFRawStream &&
        form.dict.get(PDFName.of("Subtype")) === PDFName.of("Form") &&
        !form.dict.has(PDFName.of("Resources"))
      ) {
        try {
          pending.push(latin1(decodePDFRawStream(form).decode()));
        } catch {
          return { drawn: new Set(xObjects.keys().map(String)), fonts: null };
        }
      }
    }
  }
  return { drawn, fonts };
};

/**
 * Replace fonts that no longer show a glyph: a font only the removed text
 * used (a bold face for a name, say) would still carry its glyphs, name
 * and Unicode map. Its Tf stays in the content, so the name now points at
 * a plain standard font. Nothing is replaced when a graphics state could
 * name a font.
 */
const pruneFonts = (copy: PDFDict, usedFonts: ReadonlySet<string>): void => {
  const fonts = copy.lookupMaybe(PDFName.of("Font"), PDFDict);
  if (!fonts) {
    return;
  }
  const states = copy.lookupMaybe(PDFName.of("ExtGState"), PDFDict);
  const statesNameFonts = (states?.values() ?? []).some((value) =>
    copy.context.lookupMaybe(value, PDFDict)?.has(PDFName.of("Font"))
  );
  if (statesNameFonts) {
    return;
  }
  const kept = fonts.clone(copy.context);
  let placeholder: PDFDict | undefined;
  for (const key of kept.keys()) {
    if (!usedFonts.has(key.toString())) {
      placeholder ??= copy.context.obj({
        BaseFont: "Helvetica",
        Subtype: "Type1",
        Type: "Font",
      });
      kept.set(key, placeholder);
    }
  }
  copy.set(PDFName.of("Font"), kept);
};

/**
 * Resources with extra XObjects: a copy, so a resource dictionary shared
 * with other pages or forms is never changed. XObjects the content no
 * longer draws are dropped and fonts it no longer shows glyphs in are
 * replaced, so nothing removed stays reachable through them.
 */
export const withXObjects = (
  doc: Pick<PDFDocument, "context">,
  resources: PDFDict | undefined,
  added: ReadonlyMap<string, PDFRef>,
  content: string
): PDFDict => {
  const { context } = doc;
  const copy = resources ? resources.clone(context) : context.obj({});
  const xObjects =
    resources?.lookupMaybe(PDFName.of("XObject"), PDFDict)?.clone(context) ??
    context.obj({});
  for (const [name, ref] of added) {
    xObjects.set(PDFName.of(name), ref);
  }
  const { drawn, fonts } = resourcesUsed(context, xObjects, content);
  for (const key of xObjects.keys()) {
    if (!drawn.has(key.toString())) {
      xObjects.delete(key);
    }
  }
  copy.set(PDFName.of("XObject"), xObjects);
  if (fonts) {
    pruneFonts(copy, fonts);
  }
  return copy;
};

/** What a content stream's redaction comes to. */
interface RedactorResult {
  edits: ContentEdit[];
  xObjects: Map<string, PDFRef>;
}

/** Plan the content edits that take everything under the boxes out. */
class ContentRedactor {
  readonly #added = new Map<string, PDFRef>();
  readonly #boxes: Bounds2[];
  readonly #depth: number;
  readonly #edits: ContentEdit[] = [];
  readonly #fonts = new Map<string, RedactionFont | null>();
  readonly #input: ContentRedactionInput;
  readonly #marked: MarkedContent[] = [];
  #pathStart = -1;
  #state: GraphicsState = {
    charSpacing: 0,
    ctm: IDENTITY,
    font: null,
    fontSize: 0,
    glyphReach: UNKNOWN_REACH,
    hScale: 1,
    leading: 0,
    lineWidth: 1,
    pattern: { fill: false, stroke: false },
    renderMode: 0,
    rise: 0,
    wordSpacing: 0,
  };
  readonly #shared: Shared;
  readonly #stack: GraphicsState[] = [];
  #text: TextPosition = { known: true, line: IDENTITY, matrix: IDENTITY };

  constructor(
    input: ContentRedactionInput,
    shared: Shared,
    inherited?: { depth: number; state: GraphicsState }
  ) {
    this.#input = input;
    this.#shared = shared;
    this.#boxes = input.boxes.map(rectBounds);
    this.#depth = inherited?.depth ?? 0;
    if (inherited) {
      this.#state = { ...inherited.state };
    }
  }

  run(): RedactorResult {
    for (const [index, operation] of this.#input.operations.entries()) {
      this.#step(index, operation);
    }
    while (this.#marked.length > 0) {
      this.#closeMarked();
    }
    return { edits: this.#edits, xObjects: this.#added };
  }

  /** A new XObject name, unused in this content's resources. */
  #newName(): string {
    const taken = lookupDict(this.#input.resources, "XObject");
    let name = "";
    do {
      this.#shared.names += 1;
      name = `RdX${this.#shared.names}`;
    } while (taken?.has(PDFName.of(name)));
    return name;
  }

  #replaceDo(operation: ContentOperation, ref: PDFRef): void {
    const name = this.#newName();
    this.#added.set(name, ref);
    this.#edits.push({
      end: operation.end,
      replacement: `/${name} Do`,
      start: operation.start,
    });
  }

  #touches(bounds: Bounds2): boolean {
    return this.#boxes.some((box) => overlaps(bounds, box));
  }

  #markTouched(): void {
    for (const entry of this.#marked) {
      entry.touched = true;
    }
  }

  // oxlint-disable-next-line eslint/complexity -- one case per content operator
  #step(index: number, operation: ContentOperation): void {
    const { operator } = operation;
    if (PATH_BUILD_OPS.has(operator)) {
      if (this.#pathStart < 0) {
        this.#pathStart = index;
      }
      return;
    }
    if (PATH_PAINT_OPS.has(operator)) {
      this.#paint(index);
      this.#pathStart = -1;
      return;
    }
    if (this.#pathStart >= 0) {
      // The spec allows nothing between building a path and painting it,
      // but renderers keep the path and paint it anyway, so it cannot be
      // measured from the build operators alone.
      notPrecise("A path is interrupted before it is painted.");
    }
    switch (operator) {
      case "q": {
        this.#stack.push({ ...this.#state });
        return;
      }
      case "Q": {
        this.#state = this.#stack.pop() ?? this.#state;
        return;
      }
      case "cm": {
        this.#state.ctm = multiply(matrixOf(operation), this.#state.ctm);
        return;
      }
      case "w": {
        this.#state.lineWidth = numbers(operation)[0] ?? 1;
        return;
      }
      case "gs": {
        this.#graphicsStateParameters(operation);
        return;
      }
      case "BT": {
        this.#text = { known: true, line: IDENTITY, matrix: IDENTITY };
        return;
      }
      case "BDC":
      case "BMC": {
        this.#openMarked(operation);
        return;
      }
      case "EMC": {
        this.#closeMarked();
        return;
      }
      case "Do": {
        this.#xObject(operation);
        return;
      }
      case "EI": {
        // An inline image under a box goes whole.
        if (this.#touches(mappedBounds(this.#state.ctm, 0, 0, 1, 1))) {
          this.#markTouched();
          this.#edits.push({
            end: operation.end,
            replacement: " ",
            start: operation.start,
          });
        }
        return;
      }
      case "sh": {
        // A shading fills the clip; its extent is not known here.
        notPrecise("The page paints a shading.");
        return;
      }
      default: {
        if (!this.#colorOperator(operation)) {
          this.#textOperator(index, operation);
        }
      }
    }
  }

  /** Track whether fills and strokes paint a pattern; true if handled. */
  #colorOperator(operation: ContentOperation): boolean {
    const last = operation.operands.at(-1);
    const isPattern =
      last?.kind === "name" &&
      (last.text === "/Pattern" ||
        operation.operator === "scn" ||
        operation.operator === "SCN");
    switch (operation.operator) {
      case "cs":
      case "scn":
      case "sc":
      case "g":
      case "rg":
      case "k": {
        this.#state.pattern = { ...this.#state.pattern, fill: isPattern };
        return true;
      }
      case "CS":
      case "SCN":
      case "SC":
      case "G":
      case "RG":
      case "K": {
        this.#state.pattern = { ...this.#state.pattern, stroke: isPattern };
        return true;
      }
      default: {
        return false;
      }
    }
  }

  // oxlint-disable-next-line eslint/complexity -- one case per text operator
  #textOperator(index: number, operation: ContentOperation): void {
    const values = numbers(operation);
    const [first = 0, second = 0] = values;
    switch (operation.operator) {
      case "Tf": {
        const name = operation.operands[0]?.text.slice(1) ?? "";
        this.#state.font = this.#font(name);
        this.#state.glyphReach = this.#glyphReach(name);
        this.#state.fontSize = second;
        return;
      }
      case "Tc": {
        this.#state.charSpacing = first;
        return;
      }
      case "Tw": {
        this.#state.wordSpacing = first;
        return;
      }
      case "Tz": {
        this.#state.hScale = first / HUNDRED;
        return;
      }
      case "TL": {
        this.#state.leading = first;
        return;
      }
      case "Ts": {
        this.#state.rise = first;
        return;
      }
      case "Tr": {
        this.#state.renderMode = first;
        return;
      }
      case "Td": {
        this.#moveLine(first, second);
        return;
      }
      case "TD": {
        this.#state.leading = -second;
        this.#moveLine(first, second);
        return;
      }
      case "Tm": {
        const matrix = matrixOf(operation);
        this.#text = { known: true, line: matrix, matrix };
        return;
      }
      case "T*": {
        this.#moveLine(0, -this.#state.leading);
        return;
      }
      case "Tj":
      case "TJ": {
        this.#show(index, operation, "");
        return;
      }
      case "'": {
        this.#moveLine(0, -this.#state.leading);
        this.#show(index, operation, "T* ");
        return;
      }
      case '"': {
        const [aw = "0", ac = "0"] = operation.operands.map(
          (token) => token.text
        );
        this.#state.wordSpacing = first;
        this.#state.charSpacing = second;
        this.#moveLine(0, -this.#state.leading);
        this.#show(index, operation, `${aw} Tw ${ac} Tc T* `);
        break;
      }
      default: {
        break;
      }
    }
  }

  #moveLine(x: number, y: number): void {
    const line = multiply(translate(x, y), this.#text.line);
    this.#text = { known: true, line, matrix: line };
  }

  #glyphReach(name: string): GlyphReach {
    const dict = lookupDict(this.#input.resources, "Font")?.lookupMaybe(
      PDFName.of(name),
      PDFDict
    );
    return dict?.get(PDFName.of("Subtype")) === PDFName.of("Type3")
      ? type3Reach(dict)
      : UNKNOWN_REACH;
  }

  #font(name: string): RedactionFont | null {
    if (!this.#fonts.has(name)) {
      const dict = lookupDict(this.#input.resources, "Font")?.lookupMaybe(
        PDFName.of(name),
        PDFDict
      );
      this.#fonts.set(name, dict ? redactionFontFor(dict) : null);
    }
    return this.#fonts.get(name) ?? null;
  }

  #graphicsStateParameters(operation: ContentOperation): void {
    const name = operation.operands[0]?.text.slice(1) ?? "";
    const params = lookupDict(this.#input.resources, "ExtGState")?.lookupMaybe(
      PDFName.of(name),
      PDFDict
    );
    const lineWidth = params?.lookup(PDFName.of("LW"));
    if (lineWidth instanceof PDFNumber) {
      this.#state.lineWidth = lineWidth.asNumber();
    }
    if (params?.has(PDFName.of("Font"))) {
      // A font set through the graphics state is not measured here.
      this.#state.font = null;
      this.#state.glyphReach = { advance: UNKNOWN_GLYPH_EMS, ink: null };
    }
  }

  #xObject(operation: ContentOperation): void {
    const name = operation.operands[0]?.text.slice(1) ?? "";
    const object = lookupDict(this.#input.resources, "XObject")?.lookup(
      PDFName.of(name)
    );
    if (!(object instanceof PDFRawStream)) {
      return notPrecise("An XObject could not be read.");
    }
    const { ctm } = this.#state;
    const bounds = xObjectBounds(object.dict, ctm);
    if (!this.#touches(bounds)) {
      return;
    }
    this.#markTouched();
    const subtype = object.dict.get(PDFName.of("Subtype"));
    if (subtype === PDFName.of("Image")) {
      if (this.#boxes.some((box) => contains(box, bounds))) {
        this.#edits.push({
          end: operation.end,
          replacement: " ",
          start: operation.start,
        });
        return;
      }
      const ref = this.#input.context.nextRef();
      this.#shared.jobs.push({
        boxes: this.#input.boxes,
        ctm,
        ref,
        stream: object,
      });
      this.#replaceDo(operation, ref);
      return;
    }
    if (subtype !== PDFName.of("Form") || this.#depth >= MAX_FORM_DEPTH) {
      return notPrecise("An XObject under a box cannot be rewritten.");
    }
    const form = this.#redactForm(object);
    if (form) {
      this.#replaceDo(operation, form);
    }
  }

  /**
   * A form under a box, copied with its own content redacted (copy on
   * write: other uses of the form keep the original). Null when nothing in
   * it changed.
   */
  #redactForm(form: PDFRawStream): PDFRef | null {
    let source: string;
    let operations: ContentOperation[];
    try {
      source = latin1(decodePDFRawStream(form).decode());
      operations = parseContentStream(source);
    } catch {
      return notPrecise("A form's content could not be read.");
    }
    const resources =
      form.dict.lookupMaybe(PDFName.of("Resources"), PDFDict) ??
      this.#input.resources;
    const matrix = arrayNumbers(
      form.dict.lookupMaybe(PDFName.of("Matrix"), PDFArray)
    );
    const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = matrix;
    const inner = new ContentRedactor(
      { ...this.#input, emptiedShows: undefined, operations, resources },
      this.#shared,
      {
        depth: this.#depth + 1,
        state: {
          ...this.#state,
          ctm: multiply([a, b, c, d, e, f], this.#state.ctm),
        },
      }
    ).run();
    if (inner.edits.length === 0 && inner.xObjects.size === 0) {
      return null;
    }
    const { context } = this.#input;
    const entries: Record<string, PDFObject> = {};
    for (const [key, value] of form.dict.entries()) {
      const name = key.decodeText();
      if (!["DecodeParms", "Filter", "Length", "Resources"].includes(name)) {
        entries[name] = value;
      }
    }
    const content = applyContentEdits(source, inner.edits);
    const copy = context.flateStream(fromLatin1(content), entries);
    copy.dict.set(
      PDFName.of("Resources"),
      withXObjects({ context }, resources, inner.xObjects, content)
    );
    return context.register(copy);
  }

  #openMarked(operation: ContentOperation): void {
    const open = operation.operands.find((token) => token.kind === "dict-open");
    const close = operation.operands.findLast(
      (token) => token.kind === "dict-close"
    );
    const named = operation.operands.find(
      (token, position) => position > 0 && token.kind === "name"
    );
    this.#marked.push({
      dict:
        open && close
          ? {
              end: close.end,
              start: open.start,
              text: tokenText(operation.operands, open.start, close.end),
            }
          : null,
      named: open ? null : (named?.text.slice(1) ?? null),
      touched: false,
    });
  }

  /** A sequence whose content changed loses the text that describes it. */
  #closeMarked(): void {
    const entry = this.#marked.pop();
    if (!entry?.touched) {
      return;
    }
    if (entry.dict && describes(entry.dict.text)) {
      this.#edits.push({
        end: entry.dict.end,
        replacement: "<<>>",
        start: entry.dict.start,
      });
      return;
    }
    if (entry.named) {
      const properties = lookupDict(
        this.#input.resources,
        "Properties"
      )?.lookupMaybe(PDFName.of(entry.named), PDFDict);
      const keys = properties?.keys().map((key) => key.toString()) ?? [];
      if (keys.some(describes)) {
        notPrecise("Marked content describes redacted text.");
      }
    }
  }

  /** Place each element of a show, advancing the text matrix as pdf.js does. */
  #place(elements: readonly ShowElement[], font: RedactionFont): Placed[] {
    const state = this.#state;
    const placed: Placed[] = [];
    for (const element of elements) {
      if ("displacement" in element) {
        const advance =
          (-element.displacement / THOUSAND) * state.fontSize * state.hScale;
        placed.push({ advance, displacement: element.displacement });
        this.#advance(advance);
        continue;
      }
      const glyphs = font.glyphs(element.bytes);
      if (!glyphs) {
        return notPrecise("A glyph under a box cannot be measured.");
      }
      for (const glyph of glyphs) {
        placed.push(this.#placeGlyph(glyph, font));
      }
    }
    return placed;
  }

  #placeGlyph(glyph: ShownGlyph, font: RedactionFont): Placed {
    const state = this.#state;
    const render = multiply(
      [state.fontSize * state.hScale, 0, 0, state.fontSize, 0, state.rise],
      multiply(this.#text.matrix, state.ctm)
    );
    const box = mappedBounds(
      render,
      0,
      font.descent / THOUSAND,
      glyph.width / THOUSAND,
      font.ascent / THOUSAND
    );
    const advance =
      ((glyph.width / THOUSAND) * state.fontSize +
        state.charSpacing +
        (glyph.wordSpace ? state.wordSpacing : 0)) *
      state.hScale;
    this.#advance(advance);
    return { advance, bytes: glyph.bytes, removed: this.#touches(box) };
  }

  #advance(by: number): void {
    this.#text = {
      ...this.#text,
      matrix: multiply(translate(by, 0), this.#text.matrix),
    };
  }

  /** A show whose font is not measured: safe only when it ends nowhere near a box. */
  #showUnmeasured(elements: readonly ShowElement[]): void {
    const state = this.#state;
    let length = 0;
    for (const element of elements) {
      length += "bytes" in element ? element.bytes.length : 0;
    }
    const render = multiply(
      [state.fontSize * state.hScale, 0, 0, state.fontSize, 0, state.rise],
      multiply(this.#text.matrix, state.ctm)
    );
    const { advance, ink } = state.glyphReach;
    if (!ink) {
      return notPrecise("Text in a font with no known extent is on the page.");
    }
    // Character and word spacing are in unscaled text space, not ems.
    const spacing =
      state.fontSize === 0
        ? 0
        : (Math.abs(state.charSpacing) + Math.abs(state.wordSpacing)) /
          Math.abs(state.fontSize);
    const reach = Math.max(length * (advance + spacing), 1);
    if (
      this.#touches(
        mappedBounds(
          render,
          -reach + ink.minX,
          ink.minY,
          reach + ink.maxX,
          ink.maxY
        )
      )
    ) {
      notPrecise("Text in an unsupported font lies near a box.");
    }
    // Where the next show on this line starts is now unknown.
    this.#text = { ...this.#text, known: false };
  }

  #show(index: number, operation: ContentOperation, prefix: string): void {
    const elements = showElements(operation);
    if (this.#input.emptiedShows?.has(index)) {
      return;
    }
    if (!this.#text.known) {
      return notPrecise("Text follows a show that could not be measured.");
    }
    const { font } = this.#state;
    if (!font) {
      this.#showUnmeasured(elements);
      return;
    }
    const placed = this.#place(elements, font);
    if (!placed.some((item) => "removed" in item && item.removed)) {
      return;
    }
    const scale = this.#state.fontSize * this.#state.hScale;
    if (scale === 0 || CLIP_RENDER_MODES.has(this.#state.renderMode)) {
      return notPrecise("Clip or zero-size text lies under a box.");
    }
    if (this.#state.pattern.fill || this.#state.pattern.stroke) {
      return notPrecise("Pattern-painted text lies under a box.");
    }
    this.#markTouched();
    this.#edits.push({
      end: operation.end,
      replacement: `${prefix}${rewriteShow(placed, scale)} TJ`,
      start: operation.start,
    });
  }

  #paint(index: number): void {
    const { operations } = this.#input;
    const paint = operations[index];
    const start = this.#pathStart < 0 ? index : this.#pathStart;
    const first = operations[start];
    if (!(paint && first)) {
      return;
    }
    const path = readPath(operations.slice(start, index));
    if (!path) {
      return notPrecise("A path could not be read.");
    }
    const { ctm, lineWidth } = this.#state;
    const strokes = STROKE_OPS.has(paint.operator);
    // A stroke reaches up to a full line width past its path (square caps).
    const reach = strokes ? Math.max(lineWidth, 1) * maxScale(ctm) : 0;
    const hull = inflate(
      boundsOf(path.points.map((point) => apply(ctm, point.x, point.y))),
      reach
    );
    if (!this.#touches(hull)) {
      return;
    }
    if (path.clips) {
      return notPrecise("A clipping path lies under a box.");
    }
    const { pattern } = this.#state;
    if (
      (FILL_OPS.has(paint.operator) && pattern.fill) ||
      (strokes && pattern.stroke)
    ) {
      return notPrecise("A pattern-painted path lies under a box.");
    }
    this.#markTouched();
    const inside = this.#boxes.some((box) => contains(box, hull));
    this.#edits.push({
      end: paint.end,
      replacement: inside ? " " : this.#cutPath(path, paint.operator, reach),
      start: first.start,
    });
  }

  /**
   * A touched path cut around the boxes: filled rectangles keep the parts
   * outside, straight strokes keep their segments outside. Anything else
   * (curves, other filled shapes, even-odd fills of several shapes) is
   * removed whole.
   */
  #cutPath(path: ReadPath, operator: string, reach: number): string {
    const { ctm } = this.#state;
    const inverse = invert(ctm);
    const fills = FILL_OPS.has(operator);
    const strokes = STROKE_OPS.has(operator);
    const removeWhole =
      !inverse ||
      path.curved ||
      (fills && (!isAxisAligned(ctm) || path.polygons.length > 0)) ||
      (EVEN_ODD_OPS.has(operator) && path.rects.length > 1);
    if (removeWhole || !(fills || strokes)) {
      return " ";
    }
    let out = "";
    if (fills) {
      out += this.#cutRects(path.rects, inverse);
    }
    if (strokes) {
      out += this.#cutSegments(
        pathSegments(path, CLOSING_PAINT_OPS.has(operator)),
        inverse,
        reach
      );
    }
    return out === "" ? " " : out;
  }

  #cutRects(rects: readonly Bounds2[], inverse: Matrix): string {
    const { ctm } = this.#state;
    let pieces = rects.map((rect) =>
      mappedBounds(ctm, rect.minX, rect.minY, rect.maxX, rect.maxY)
    );
    for (const box of this.#boxes) {
      pieces = pieces.flatMap((piece) => subtractRect(piece, box));
    }
    if (pieces.length === 0) {
      return "";
    }
    const drawn = pieces.map((piece) => {
      const local = mappedBounds(
        inverse,
        piece.minX,
        piece.minY,
        piece.maxX,
        piece.maxY
      );
      return [
        local.minX,
        local.minY,
        local.maxX - local.minX,
        local.maxY - local.minY,
      ]
        .map(formatNumber)
        .join(" ");
    });
    return ` ${drawn.map((rect) => `${rect} re`).join(" ")} f `;
  }

  #cutSegments(
    segments: readonly Segment[],
    inverse: Matrix,
    reach: number
  ): string {
    const { ctm } = this.#state;
    let pieces = segments.map((segment) => ({
      from: apply(ctm, segment.from.x, segment.from.y),
      to: apply(ctm, segment.to.x, segment.to.y),
    }));
    for (const box of this.#boxes) {
      const hole = inflate(box, reach);
      pieces = pieces.flatMap((piece) => segmentOutside(piece, hole));
    }
    if (pieces.length === 0) {
      return "";
    }
    const local = (point: Point2): string => {
      const mapped = apply(inverse, point.x, point.y);
      return `${formatNumber(mapped.x)} ${formatNumber(mapped.y)}`;
    };
    return ` ${pieces
      .map((piece) => `${local(piece.from)} m ${local(piece.to)} l`)
      .join(" ")} S `;
  }
}

/**
 * Plan the edits that take every glyph, path and marked-content description
 * under the boxes out of a page's content, keeping everything else where it
 * is. Returns `ok: false` when something under a box cannot be removed
 * exactly (an image, a shading, a clip, an unmeasured font): that page is
 * flattened instead.
 */
export const planContentRedaction = async (
  input: ContentRedactionInput
): Promise<ContentRedactionPlan> => {
  const shared: Shared = { jobs: [], names: 0 };
  let planned: RedactorResult;
  try {
    planned = new ContentRedactor(input, shared).run();
  } catch (error) {
    if (error instanceof Error && error.name === NOT_PRECISE) {
      return { ok: false, reason: error.message };
    }
    throw error;
  }
  for (const job of shared.jobs) {
    // oxlint-disable-next-line react-doctor/async-await-in-loop eslint/no-await-in-loop -- one image's pixels at a time bounds memory
    const blanked = await redactImage({
      boxes: job.boxes,
      codec: input.codec,
      context: input.context,
      ctm: job.ctm,
      stream: job.stream,
    });
    if (!blanked) {
      return { ok: false, reason: "An image under a box cannot be rewritten." };
    }
    input.context.assign(job.ref, blanked);
  }
  return { ...planned, ok: true };
};
