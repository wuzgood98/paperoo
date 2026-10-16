import {
  DEFAULT_ASCENT_RATIO,
  textItemToDisplayedBox,
} from "@/lib/editor/coordinates";
import type { TextItemTransform } from "@/lib/editor/coordinates";
import { createId } from "@/lib/editor/ids";
import {
  DEFAULT_PDF_TEXT_COLOR,
  DEFAULT_PDF_TEXT_RENDERING_MODE,
  DEFAULT_PDF_TEXT_STROKE_COLOR,
  DEFAULT_PDF_TEXT_STROKE_WIDTH,
} from "@/lib/editor/types";
import type {
  CropBox,
  FontFamily,
  FontWeight,
  PageRotation,
  PdfTextDir,
  PdfTextObject,
  PdfTextTransform,
} from "@/lib/editor/types";
import { collectEmbeddedFontGlyphs } from "@/lib/pdf/embedded-font";
import type { PdfTextItemPaint } from "@/lib/pdf/extract-text-colors";

export interface ExtractableTextStyle {
  ascent?: number;
  descent?: number;
  fontFamily?: string;
}

export interface ExtractableTextItem {
  dir?: string;
  fontName?: string;
  hasEOL?: boolean;
  height?: number;
  str?: string;
  transform?: readonly number[];
  width?: number;
}

export interface ExtractableTextMarkedContent {
  items?: readonly ExtractableTextEntry[];
  type: string;
}

export type ExtractableTextEntry =
  | ExtractableTextItem
  | ExtractableTextMarkedContent;

export interface ExtractableTextContent {
  items: readonly ExtractableTextItem[];
  styles: Record<string, ExtractableTextStyle | undefined>;
}

export interface PdfJsTextContent {
  items: readonly ExtractableTextEntry[];
  styles: Record<string, ExtractableTextStyle | undefined>;
}

/** A Type3 glyph's `d1` bounds in glyph space: [llx, lly, urx, ury]. */
export type Type3GlyphBox = readonly [number, number, number, number];

export interface PdfFontFaceMeta {
  bold?: boolean;
  /** Paint-nothing Type3 only: each glyph's `d1` box, keyed by glyph name. */
  charBoxes?: ReadonlyMap<string, Type3GlyphBox>;
  isType3?: boolean;
  /**
   * Type3 face whose glyph procedures only declare metrics (`d0`/`d1`), so its
   * text is invisible. Figma draws the visible glyphs as outline paths instead.
   */
  paintsNothing?: boolean;
  italic?: boolean;
  missingFile?: boolean;
  name?: string;
}

/** Shape of a PDF.js FontFaceObject exported onto commonObjs. */
export interface PdfJsFontFaceData {
  black?: boolean;
  bold?: boolean;
  /** Type3 only: each glyph procedure's operator list, keyed by glyph name. */
  charProcOperatorList?: ReadonlyMap<
    string,
    {
      /** First entry of a `d1` procedure: [wx, wy, llx, lly, urx, ury]. */
      argsArray?: readonly (readonly number[] | null | undefined)[];
      fnArray: readonly number[];
    }
  >;
  isType3Font?: boolean;
  italic?: boolean;
  missingFile?: boolean;
  name?: string;
}

export interface PdfJsFontObjectStore {
  get: (
    id: string,
    callback?: (data: PdfJsFontFaceData) => void
  ) => PdfJsFontFaceData | undefined;
  has: (id: string) => boolean;
}

const FONT_FACE_RESOLVE_MS = 2000;

/** Operators a Type3 glyph procedure may hold without painting anything. */
export type Type3MetricOps = ReadonlySet<number>;

const type3PaintsNothing = (
  value: PdfJsFontFaceData,
  metricOps: Type3MetricOps | undefined
): boolean => {
  const procs = value.charProcOperatorList;
  if (!(metricOps && value.isType3Font === true && procs && procs.size > 0)) {
    return false;
  }
  for (const proc of procs.values()) {
    if (proc.fnArray.some((fn) => !metricOps.has(fn))) {
      return false;
    }
  }
  return true;
};

const D1_BOX_START = 2;
const D1_ARG_COUNT = 6;

/** `d1` args are [wx, wy, llx, lly, urx, ury]; pdf.js drops a zero-area d1. */
const readGlyphBox = (
  args: readonly number[] | null | undefined
): Type3GlyphBox => {
  if (!args || args.length < D1_ARG_COUNT) {
    return [0, 0, 0, 0];
  }
  const [llx, lly, urx, ury] = args
    .slice(D1_BOX_START, D1_ARG_COUNT)
    .map(Number);
  return [llx ?? 0, lly ?? 0, urx ?? 0, ury ?? 0].every(Number.isFinite)
    ? [llx ?? 0, lly ?? 0, urx ?? 0, ury ?? 0]
    : [0, 0, 0, 0];
};

const type3CharBoxes = (
  value: PdfJsFontFaceData
): Map<string, Type3GlyphBox> => {
  const boxes = new Map<string, Type3GlyphBox>();
  for (const [name, proc] of value.charProcOperatorList ?? []) {
    boxes.set(name, readGlyphBox(proc.argsArray?.[0]));
  }
  return boxes;
};

const parseFontFace = (
  value: PdfJsFontFaceData | undefined,
  metricOps?: Type3MetricOps
): PdfFontFaceMeta | null => {
  if (!value) {
    return null;
  }
  const paintsNothing = type3PaintsNothing(value, metricOps);
  return {
    bold: value.bold === true || value.black === true,
    charBoxes: paintsNothing ? type3CharBoxes(value) : undefined,
    isType3: value.isType3Font === true,
    italic: value.italic === true,
    missingFile: value.missingFile === true,
    name: value.name,
    paintsNothing,
  };
};

const readResolvedFontFace = (
  store: PdfJsFontObjectStore,
  loadedName: string,
  metricOps: Type3MetricOps | undefined
): PdfFontFaceMeta | null => {
  if (!store.has(loadedName)) {
    return null;
  }
  try {
    return parseFontFace(store.get(loadedName), metricOps);
  } catch {
    return null;
  }
};

const resolveFontFace = (
  store: PdfJsFontObjectStore,
  loadedName: string,
  metricOps: Type3MetricOps | undefined
): Promise<PdfFontFaceMeta | null> => {
  const ready = readResolvedFontFace(store, loadedName, metricOps);
  if (ready) {
    return Promise.resolve(ready);
  }

  // oxlint-disable-next-line promise/avoid-new -- PDFObjects.get only notifies through a callback
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: PdfFontFaceMeta | null): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value);
    };

    const timer = setTimeout(() => {
      finish(null);
    }, FONT_FACE_RESOLVE_MS);

    store.get(loadedName, (data) => {
      const parsed = parseFontFace(data, metricOps);
      if (!parsed) {
        return;
      }
      clearTimeout(timer);
      finish(parsed);
    });
  });
};

/** Resolve PDF.js Font records from commonObjs for each text-item loadedName. */
export const collectPdfFontFaces = async (
  store: PdfJsFontObjectStore,
  items: readonly ExtractableTextItem[],
  /** pdf.js `setCharWidth`/`setCharWidthAndBounds`; enables `paintsNothing`. */
  type3MetricOps?: Type3MetricOps
): Promise<Record<string, PdfFontFaceMeta>> => {
  const loadedNames = new Set<string>();
  for (const item of items) {
    if (item.fontName) {
      loadedNames.add(item.fontName);
    }
  }

  const faces: Record<string, PdfFontFaceMeta> = {};
  await Promise.all(
    [...loadedNames].map(async (loadedName) => {
      const face = await resolveFontFace(store, loadedName, type3MetricOps);
      if (face) {
        faces[loadedName] = face;
      }
    })
  );
  return faces;
};

const isTextItem = (
  entry: ExtractableTextEntry
): entry is ExtractableTextItem => !("type" in entry);

export const toExtractableTextContent = (
  content: PdfJsTextContent
): ExtractableTextContent => ({
  items: content.items.filter(isTextItem),
  styles: content.styles,
});

export const resolvePdfFont = (fontFamily?: string): FontFamily => {
  if (fontFamily === "serif") {
    return "serif";
  }
  if (fontFamily === "monospace") {
    return "mono";
  }
  return "sans";
};

/** Match PDF.js Font.fallbackToSystemFont: /bold/i on the face name. */
export const resolvePdfFontWeight = (
  faceName?: string,
  bold?: boolean
): FontWeight => {
  if (bold === true) {
    return 700;
  }
  if (faceName && /bold|black/iu.test(faceName)) {
    return 700;
  }
  return 400;
};

/** Match PDF.js Font.fallbackToSystemFont: /oblique|italic/i on the face name. */
export const resolvePdfFontItalic = (
  faceName?: string,
  italic?: boolean
): boolean => {
  if (italic === true) {
    return true;
  }
  return Boolean(faceName && /oblique|italic/iu.test(faceName));
};

const toDir = (value: string | undefined): PdfTextDir => {
  if (value === "rtl" || value === "ttb") {
    return value;
  }
  return "ltr";
};

const toTransform = (
  value: readonly number[] | undefined
): PdfTextTransform | null => {
  if (!value || value.length < 6) {
    return null;
  }
  const [a, b, c, d, e, f] = value;
  if (
    a === undefined ||
    b === undefined ||
    c === undefined ||
    d === undefined ||
    e === undefined ||
    f === undefined ||
    ![a, b, c, d, e, f].every(Number.isFinite)
  ) {
    return null;
  }
  return [a, b, c, d, e, f];
};

const defaultItemPaint = (): PdfTextItemPaint => ({
  color: DEFAULT_PDF_TEXT_COLOR,
  strokeColor: DEFAULT_PDF_TEXT_STROKE_COLOR,
  strokeWidth: DEFAULT_PDF_TEXT_STROKE_WIDTH,
  textRenderingMode: DEFAULT_PDF_TEXT_RENDERING_MODE,
});

/** Map a legacy parallel color array into full paint records. */
export const colorsToItemPaints = (
  colors: readonly string[]
): PdfTextItemPaint[] =>
  colors.map((color) => ({ ...defaultItemPaint(), color }));

const itemPaintAt = (
  itemPaints: readonly PdfTextItemPaint[] | undefined,
  sourceIndex: number
): PdfTextItemPaint => itemPaints?.[sourceIndex] ?? defaultItemPaint();

const embeddedRunFields = (
  item: { fontName?: string },
  style: { ascent?: number; descent?: number } | undefined,
  face: PdfFontFaceMeta | undefined,
  glyphsByFont: ReadonlyMap<string, string>
) => {
  const ascentRatio =
    style?.ascent !== undefined && style.ascent > 0
      ? style.ascent
      : DEFAULT_ASCENT_RATIO;
  return {
    ascentRatio,
    baseFontName: face?.name,
    descentRatio: Math.abs(style?.descent ?? 0),
    embeddedFontGlyphs: item.fontName
      ? (glyphsByFont.get(item.fontName) ?? "")
      : "",
    embeddedFontUnavailable:
      face?.isType3 === true || face?.missingFile === true,
    invisibleGlyphs: face?.paintsNothing === true,
  };
};

/**
 * Em size of a text item. For Type3 faces pdf.js multiplies the item's height
 * by the glyph-box height when the font matrix is not 1/1000 (Figma exports:
 * FontMatrix [1 0 0 1 0 0], Tf 1), so `height` can be ~1.3× the real size.
 * The matrix's x column is not inflated, so use its length. That is exact
 * unless the run also sets horizontal scaling (Tz), which Figma never does.
 */
export const textItemEmSize = (
  transform: TextItemTransform,
  height: number,
  isType3: boolean
): number => {
  if (!isType3) {
    return height;
  }
  const advanceScale = Math.hypot(transform[0], transform[1]);
  return advanceScale > 0 ? advanceScale : height;
};

export const extractPdfTextObjects = (
  content: ExtractableTextContent,
  page: {
    cropBox: CropBox;
    id: string;
    sourceRotate: PageRotation;
  },
  fontFaces: Readonly<Record<string, PdfFontFaceMeta | undefined>> = {},
  /** Parallel to `content.items`; missing/short entries fall back to defaults. */
  itemPaints?: readonly PdfTextItemPaint[]
): PdfTextObject[] => {
  const objects: PdfTextObject[] = [];
  const glyphsByFont = collectEmbeddedFontGlyphs(content.items);

  for (const [sourceIndex, item] of content.items.entries()) {
    const transform = toTransform(item.transform);
    if (!transform || item.str === undefined) {
      continue;
    }

    const style = item.fontName ? content.styles[item.fontName] : undefined;
    const face = item.fontName ? fontFaces[item.fontName] : undefined;
    const fontFamily = resolvePdfFont(style?.fontFamily);
    const fontWeight = resolvePdfFontWeight(face?.name, face?.bold);
    const italic = resolvePdfFontItalic(face?.name, face?.italic);
    const embedded = embeddedRunFields(item, style, face, glyphsByFont);
    const box = textItemToDisplayedBox(
      transform,
      item.width ?? 0,
      textItemEmSize(transform, item.height ?? 0, face?.isType3 === true),
      style?.ascent ?? DEFAULT_ASCENT_RATIO,
      page.cropBox,
      page.sourceRotate,
      style?.descent ?? 0
    );
    const paint = itemPaintAt(itemPaints, sourceIndex);

    objects.push({
      ...embedded,
      color: paint.color,
      dir: toDir(item.dir),
      fontFamily,
      fontName: item.fontName ?? "",
      fontSize: box.fontSize,
      fontWeight,
      hasEOL: item.hasEOL === true,
      height: box.height,
      id: createId(),
      italic,
      originalColor: paint.color,
      originalFontFamily: fontFamily,
      originalFontSize: box.fontSize,
      originalStrokeColor: paint.strokeColor,
      originalStrokeWidth: paint.strokeWidth,
      originalText: item.str,
      originalTextRenderingMode: paint.textRenderingMode,
      pageId: page.id,
      rotation: box.rotation,
      sourceIndex,
      strokeColor: paint.strokeColor,
      strokeWidth: paint.strokeWidth,
      text: item.str,
      textRenderingMode: paint.textRenderingMode,
      transform,
      type: "pdf-text",
      width: box.width,
      x: box.x,
      y: box.y,
    });
  }

  return objects;
};
