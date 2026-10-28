import fontkit from "@pdf-lib/fontkit";
import {
  BlendMode,
  EncryptedPDFError,
  PDFDocument,
  PDFName,
  PDFObjectCopier,
  PDFPage,
  StandardFonts,
  TextRenderingMode,
  beginText,
  degrees,
  endText,
  rgb,
  appendBezierCurve,
  appendQuadraticCurve,
  closePath,
  concatTransformationMatrix,
  fill as fillPath,
  fillAndStroke,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  rotateAndSkewTextRadiansAndTranslate,
  setFillingColor,
  setCharacterSpacing,
  setCharacterSqueeze,
  setFontAndSize,
  setTextMatrix,
  setLineCap,
  setLineJoin,
  setGraphicsState,
  setLineWidth,
  setStrokingColor,
  setTextRenderingMode,
  showText,
  stroke,
  LineCapStyle,
  LineJoinStyle,
  toRadians,
} from "pdf-lib";
import type { PDFFont, PDFImage, PDFOperator } from "pdf-lib";

import {
  centerRotateCtm,
  displayedPointToUserSpace,
  displayedToUserSpace,
  isPdfTextTurned,
  normalizeRotation,
  pdfTextBaselineUserSpace,
  pdfTextUserAngle,
  userPointToDisplayed,
  vectorAxisScale,
  vectorStrokeScale,
} from "@/lib/editor/coordinates";
import {
  documentForm,
  fittedPdfTextBox,
  insetShapePathBox,
  lineDashArray,
  isPdfImageDirty,
  isPdfTextDirty,
  isPdfVectorDirty,
  pdfLinkTextAppearance,
  pdfImageCoverBox,
  pdfTextCoverColor,
  pdfTextCoverRects,
  pdfTextFrameCorners,
  pdfTextFrameRotation,
  pdfTextInkCoverStyle,
  pdfTextInkOutline,
  pdfTextNeedsFill,
  pdfTextNeedsStroke,
  pdfVectorCoverPathStyle,
  pdfVectorSubpaths,
} from "@/lib/editor/object-utils";
import type { PdfVectorCoverPathStyle } from "@/lib/editor/object-utils";
import { pageDocId, pageKeyOf, pageKeyString } from "@/lib/editor/page-source";
import { PRIMARY_DOC_ID } from "@/lib/editor/types";
import type {
  DrawingObject,
  EditorDocument,
  EditorObject,
  EditorPage,
  FontFamily,
  FontWeight,
  HighlightObject,
  ImageObject,
  PdfImageObject,
  PdfPathCommand,
  PdfTextObject,
  PdfVectorObject,
  Point,
  Rect,
  ShapeObject,
  SignatureObject,
  TextObject,
} from "@/lib/editor/types";
import { FONT_FILES, wrapText } from "@/lib/fonts/measure-text";
import type { OcrTextObject } from "@/lib/ocr/types";
import { embeddedFontCanDraw } from "@/lib/pdf/embedded-font";
import {
  applyPageAnnotationEdits,
  copiedAnnotRefs,
  helveticaFor,
  markInternalLinkTargets,
  resolveInternalLinkTargets,
} from "@/lib/pdf/export-annotations";
import type { OutputPagePlacement } from "@/lib/pdf/export-annotations";
import {
  applyPdfFormEdits,
  stripFormWidgets,
  writeOutputAcroForm,
} from "@/lib/pdf/export-forms";
import { resolvePdfFont } from "@/lib/pdf/extract-text";
import { figmaFallbackFor } from "@/lib/pdf/figma-fallback";
import type { InterWeight } from "@/lib/pdf/figma-fallback";
import { rebuiltGlyphLayout } from "@/lib/pdf/glyph-face";
import type { ImageCodec } from "@/lib/pdf/image-redaction";
import { saveSwept } from "@/lib/pdf/output-gc";
import { outputPagesOf } from "@/lib/pdf/output-pages";
import type { RedactionBox } from "@/lib/pdf/output-pages";
import { pushRebuiltType3Text } from "@/lib/pdf/rebuilt-type3-font";
import {
  clearOfBoxes,
  deletedObjectBoxes,
  ocrWordsClearOf,
  pageRedaction,
  removeAnnotationsUnderBoxes,
  removeFieldsUnderBoxes,
} from "@/lib/pdf/redact-page";
import type { PageRedaction } from "@/lib/pdf/redact-page";
import { editPageContent } from "@/lib/pdf/remove-original-ink";
import { reusedFontHex, reuseEmbeddedPdfFont } from "@/lib/pdf/reuse-pdf-font";
import type { ReusedPdfFontText } from "@/lib/pdf/reuse-pdf-font";
import { scrubHiddenData } from "@/lib/pdf/scrub";

export interface ExportAsset {
  bytes: Uint8Array;
  mimeType: string;
}

export interface ExportInput {
  assets: Record<string, ExportAsset>;
  /** The opened file (PRIMARY_DOC_ID). */
  bytes: Uint8Array;
  /** Other source documents the pages come from, by docId. */
  sources?: Readonly<Record<string, Uint8Array>>;
  /**
   * Export only these pages, in document order (extracting pages). The rest
   * of the document still informs lookups such as shared glyph faces.
   */
  pageIds?: readonly string[];
  document: EditorDocument;
  fontBytes: Record<string, Uint8Array>;
  ocrWordsByPage?: Readonly<Record<string, readonly OcrTextObject[]>>;
  /**
   * Redaction boxes are never drawn as plain boxes. "forbid" (the default)
   * refuses them; "skip" leaves every redacted page for the flatten pass;
   * "apply" takes the content under the boxes out where it can, and leaves
   * the rest (reported in `flattenPages`) for the flatten pass.
   */
  redactions?: "apply" | "forbid" | "skip";
  /** Strip metadata, thumbnails and the Info dictionary (anything redacted). */
  scrub?: boolean;
  /** JPEG decoding for images under a box; without it those pages flatten. */
  imageCodec?: ImageCodec;
}

const hexToRgb = (hex: string) => {
  const normalized = hex.replace("#", "");
  const value =
    normalized.length === 3
      ? [...normalized].map((char) => `${char}${char}`).join("")
      : normalized.padEnd(6, "0");
  return {
    b: Number.parseInt(value.slice(4, 6), 16) / 255,
    g: Number.parseInt(value.slice(2, 4), 16) / 255,
    r: Number.parseInt(value.slice(0, 2), 16) / 255,
  };
};

const color = (hex: string) => {
  const { r, g, b } = hexToRgb(hex);
  return rgb(r, g, b);
};

const applyCtm = (
  page: PDFPage,
  box: { rotation: number },
  user: ReturnType<typeof displayedToUserSpace>
): void => {
  const ctm = centerRotateCtm(
    user.x + user.width / 2,
    user.y + user.height / 2,
    user.width,
    user.height,
    box.rotation
  );
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...ctm));
};

const fontKey = (
  family: FontFamily,
  weight: FontWeight,
  italic: boolean
): string => {
  if (family === "sans") {
    if (italic && weight === 700) {
      return FONT_FILES.sans.italic700;
    }
    if (italic) {
      return FONT_FILES.sans.italic400;
    }
    if (weight === 700) {
      return FONT_FILES.sans[700];
    }
    return FONT_FILES.sans[400];
  }
  return `${family}:${weight}:${italic ? "i" : "n"}`;
};

const standardFontFor = (
  family: FontFamily,
  weight: FontWeight,
  italic: boolean
): StandardFonts => {
  if (family === "serif") {
    if (italic && weight === 700) {
      return StandardFonts.TimesRomanBoldItalic;
    }
    if (italic) {
      return StandardFonts.TimesRomanItalic;
    }
    if (weight === 700) {
      return StandardFonts.TimesRomanBold;
    }
    return StandardFonts.TimesRoman;
  }
  if (family === "mono") {
    if (italic && weight === 700) {
      return StandardFonts.CourierBoldOblique;
    }
    if (italic) {
      return StandardFonts.CourierOblique;
    }
    if (weight === 700) {
      return StandardFonts.CourierBold;
    }
    return StandardFonts.Courier;
  }
  if (italic && weight === 700) {
    return StandardFonts.HelveticaBoldOblique;
  }
  if (italic) {
    return StandardFonts.HelveticaOblique;
  }
  if (weight === 700) {
    return StandardFonts.HelveticaBold;
  }
  return StandardFonts.Helvetica;
};

const embedFontForStyle = async (
  family: FontFamily,
  weight: FontWeight,
  italic: boolean,
  fonts: Map<string, PDFFont>,
  doc: PDFDocument,
  fontBytes: Record<string, Uint8Array>
): Promise<PDFFont> => {
  const key = fontKey(family, weight, italic);
  const cached = fonts.get(key);
  if (cached) {
    return cached;
  }
  const bytes = fontBytes[key];
  const font = bytes
    ? await doc.embedFont(bytes, { subset: true })
    : await doc.embedFont(standardFontFor(family, weight, italic));
  fonts.set(key, font);
  return font;
};

/** Inter for a Figma fallback, or null when its bytes were not supplied. */
const embedInterFont = async (
  weight: InterWeight,
  fonts: Map<string, PDFFont>,
  doc: PDFDocument,
  fontBytes: Record<string, Uint8Array>
): Promise<PDFFont | null> => {
  const key = FONT_FILES.inter[weight];
  const cached = fonts.get(key);
  if (cached) {
    return cached;
  }
  const bytes = fontBytes[key];
  if (!bytes) {
    return null;
  }
  const font = await doc.embedFont(bytes, { subset: true });
  fonts.set(key, font);
  return font;
};

interface SpacedTextDraw {
  fill: ReturnType<typeof rgb>;
  font: PDFFont;
  /** Extra space after each glyph, in points (PDF `Tc`). */
  letterSpacing: number;
  /** Baseline origin in user space. */
  origin: { x: number; y: number };
  size: number;
  text: string;
}

/** One line of text with the source's letter spacing. */
const pushSpacedText = (
  page: PDFPage,
  { fill, font, letterSpacing, origin, size, text }: SpacedTextDraw
): void => {
  const fontName = page.node.newFontDictionary(font.name, font.ref);
  page.pushOperators(
    pushGraphicsState(),
    beginText(),
    setFillingColor(fill),
    setFontAndSize(fontName, size),
    setCharacterSpacing(letterSpacing),
    setTextMatrix(1, 0, 0, 1, origin.x, origin.y),
    showText(font.encodeText(text)),
    endText(),
    popGraphicsState()
  );
};

const drawTextObject = async (
  page: PDFPage,
  object: TextObject,
  user: ReturnType<typeof displayedToUserSpace>,
  fonts: Map<string, PDFFont>,
  doc: PDFDocument,
  fontBytes: Record<string, Uint8Array>
): Promise<void> => {
  const font = await embedFontForStyle(
    object.fontFamily,
    object.fontWeight,
    object.italic,
    fonts,
    doc,
    fontBytes
  );

  const ascent = font.heightAtSize(object.fontSize, { descender: false });
  const lines = wrapText(object.content, object.width, (line) =>
    font.widthOfTextAtSize(line, object.fontSize)
  );
  const lineHeight = object.fontSize * 1.2;

  applyCtm(page, object, user);
  // Same class of limitation as dirty PDF text: a white field hides scan
  // ink under the replacement and does not reconstruct the page.
  if (object.ocrWordId) {
    page.drawRectangle({
      color: rgb(1, 1, 1),
      height: user.height,
      width: user.width,
      x: 0,
      y: 0,
    });
  }
  for (const [index, line] of lines.entries()) {
    let x = 0;
    const width = font.widthOfTextAtSize(line, object.fontSize);
    if (object.align === "center") {
      x = (user.width - width) / 2;
    } else if (object.align === "right") {
      x = user.width - width;
    }
    page.drawText(line, {
      color: color(object.color),
      font,
      opacity: object.opacity,
      size: object.fontSize,
      x,
      y: user.height - ascent - index * lineHeight,
    });
  }
  page.pushOperators(popGraphicsState());
};

/** Clip modes (4–7) are written without the clip; 3 and 7 stay invisible. */
const dirtyTextMode = (
  needsFill: boolean,
  needsStroke: boolean
): TextRenderingMode => {
  if (needsStroke && needsFill) {
    return TextRenderingMode.FillAndOutline;
  }
  if (needsStroke) {
    return TextRenderingMode.Outline;
  }
  if (needsFill) {
    return TextRenderingMode.Fill;
  }
  return TextRenderingMode.Invisible;
};

/** `Tz` takes a percentage. */
const PERCENT = 100;

/** `Tm` operands: [a, b, c, d, e, f] in PDF user space. */
type TextMatrix = readonly [number, number, number, number, number, number];

interface DirtyPdfTextDraw {
  encoded: ReturnType<PDFFont["encodeText"]>;
  fillHex: string;
  fontName: PDFName;
  matrix: TextMatrix;
  object: PdfTextObject;
  size: number;
}

/** One replacement run: its paint, font, turned matrix and `Tz` stretch. */
const pushDirtyPdfText = (
  page: PDFPage,
  { encoded, fillHex, fontName, matrix, object, size }: DirtyPdfTextDraw
): void => {
  const needsFill = pdfTextNeedsFill(object.textRenderingMode);
  const needsStroke = pdfTextNeedsStroke(object.textRenderingMode);
  const ops: PDFOperator[] = [
    pushGraphicsState(),
    beginText(),
    setTextRenderingMode(dirtyTextMode(needsFill, needsStroke)),
  ];
  if (needsFill) {
    ops.push(setFillingColor(color(fillHex)));
  }
  if (needsStroke) {
    ops.push(
      setStrokingColor(color(object.strokeColor)),
      setLineWidth(object.strokeWidth)
    );
  }
  ops.push(setFontAndSize(fontName, size));
  const scale = object.horizontalScale ?? 1;
  if (scale !== 1) {
    ops.push(setCharacterSqueeze(scale * PERCENT));
  }
  ops.push(
    setTextMatrix(...matrix),
    showText(encoded),
    endText(),
    popGraphicsState()
  );
  page.pushOperators(...ops);
};

/**
 * `Tm` for a replacement run. A turned run keeps its baseline direction from
 * the source matrix; its origin moves back along it when right-to-left text
 * grows. Unturned runs keep the axis-aligned matrix.
 */
const dirtyTextMatrix = (
  object: PdfTextObject,
  fitted: Rect,
  user: Rect,
  baseline: Point
): TextMatrix => {
  if (!isPdfTextTurned(object.transform)) {
    return [1, 0, 0, 1, user.x, baseline.y];
  }
  const angle = (pdfTextUserAngle(object.transform) * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const shift = object.x - fitted.x;
  return [
    cos,
    sin,
    -sin,
    cos,
    baseline.x - cos * shift,
    baseline.y - sin * shift,
  ];
};

/**
 * A bundled face that can encode `text`. The standard 14 fonts only encode
 * WinAnsi; for other characters the run falls back to embedded Liberation
 * Sans in the same weight and style, when its bytes were supplied.
 */
const encodableBundledFont = async (
  text: string,
  style: { family: FontFamily; italic: boolean; weight: FontWeight },
  fonts: Map<string, PDFFont>,
  doc: PDFDocument,
  fontBytes: Record<string, Uint8Array>
): Promise<PDFFont> => {
  const { family, italic, weight } = style;
  const font = await embedFontForStyle(
    family,
    weight,
    italic,
    fonts,
    doc,
    fontBytes
  );
  try {
    font.encodeText(text);
    return font;
  } catch (error) {
    if (!fontBytes[fontKey("sans", weight, italic)]) {
      throw error;
    }
    return await embedFontForStyle(
      "sans",
      weight,
      italic,
      fonts,
      doc,
      fontBytes
    );
  }
};

/** The run's own font resource, or a bundled face when it cannot be reused. */
type DirtyTextFont =
  | { kind: "bundled"; font: PDFFont }
  | { kind: "reused"; reused: ReusedPdfFontText };

const drawDirtyPdfTextInk = async (
  page: PDFPage,
  object: PdfTextObject,
  editorPage: EditorPage,
  fonts: Map<string, PDFFont>,
  doc: PDFDocument,
  fontBytes: Record<string, Uint8Array>,
  pages: readonly EditorPage[]
): Promise<void> => {
  const family = object.fontFamily ?? resolvePdfFont();
  const size = object.fontSize ?? object.height;
  const rebuilt = rebuiltGlyphLayout(pages, editorPage, object);
  if (
    rebuilt &&
    pushRebuiltType3Text(doc, page, {
      fill: color(object.color),
      layout: rebuilt,
      origin: pdfTextBaselineUserSpace(
        object.transform,
        editorPage.cropBox,
        editorPage.sourceRotate
      ),
      size,
    })
  ) {
    return;
  }
  const fallback = figmaFallbackFor(pages, editorPage, object);
  if (fallback) {
    const fallbackFont =
      fallback.family === "inter" && fallback.weight !== 700
        ? await embedInterFont(fallback.weight, fonts, doc, fontBytes)
        : null;
    pushSpacedText(page, {
      fill: color(object.color),
      font:
        fallbackFont ??
        (await embedFontForStyle(
          "sans",
          fallback.weight === 400 ? 400 : 700,
          false,
          fonts,
          doc,
          fontBytes
        )),
      letterSpacing: fallback.letterSpacingEm * size,
      origin: pdfTextBaselineUserSpace(
        object.transform,
        editorPage.cropBox,
        editorPage.sourceRotate
      ),
      size,
      text: object.text,
    });
    return;
  }
  const weight = object.fontWeight ?? 400;
  const italic = object.italic === true;
  const reused = embeddedFontCanDraw(object, object.text)
    ? reuseEmbeddedPdfFont(page, object)
    : null;
  const textFont: DirtyTextFont = reused
    ? { kind: "reused", reused }
    : {
        font: await encodableBundledFont(
          object.text,
          { family, italic, weight },
          fonts,
          doc,
          fontBytes
        ),
        kind: "bundled",
      };

  const advance =
    textFont.kind === "reused"
      ? textFont.reused.width
      : textFont.font.widthOfTextAtSize(object.text, size);
  const fitted = fittedPdfTextBox(
    object,
    advance * (object.horizontalScale ?? 1)
  );
  const user = displayedToUserSpace(
    fitted,
    editorPage.cropBox,
    editorPage.sourceRotate
  );
  const linkAppearance = pdfLinkTextAppearance(editorPage, object);
  const fillHex = linkAppearance?.fillColor ?? object.color;

  const baseline = pdfTextBaselineUserSpace(
    object.transform,
    editorPage.cropBox,
    editorPage.sourceRotate
  );

  pushDirtyPdfText(page, {
    ...(textFont.kind === "reused"
      ? {
          encoded: reusedFontHex(textFont.reused.encoded),
          fontName: PDFName.of(textFont.reused.resourceName),
        }
      : {
          encoded: textFont.font.encodeText(object.text),
          fontName: page.node.newFontDictionary(
            textFont.font.name,
            textFont.font.ref
          ),
        }),
    fillHex,
    matrix: dirtyTextMatrix(object, fitted, user, baseline),
    object,
    size,
  });

  if (!linkAppearance) {
    return;
  }
  const { underline } = linkAppearance;
  const yDisplay = fitted.y + underline.offsetFromRunTop;
  const start = displayedPointToUserSpace(
    { x: fitted.x, y: yDisplay },
    editorPage.cropBox,
    editorPage.sourceRotate
  );
  const end = displayedPointToUserSpace(
    { x: fitted.x + fitted.width, y: yDisplay },
    editorPage.cropBox,
    editorPage.sourceRotate
  );
  page.drawLine({
    color: color(underline.color),
    end,
    start,
    thickness: underline.thickness,
  });
};

const drawEmbeddedImage = async (
  page: PDFPage,
  object: { opacity: number; rotation: number },
  user: ReturnType<typeof displayedToUserSpace>,
  assetId: string,
  assets: Record<string, ExportAsset>,
  images: Map<string, PDFImage>,
  doc: PDFDocument
): Promise<void> => {
  const asset = assets[assetId];
  if (!asset) {
    return;
  }
  let image = images.get(assetId);
  if (!image) {
    image =
      asset.mimeType === "image/jpeg"
        ? await doc.embedJpg(asset.bytes)
        : await doc.embedPng(asset.bytes);
    images.set(assetId, image);
  }
  applyCtm(page, object, user);
  page.drawImage(image, {
    height: user.height,
    opacity: object.opacity,
    width: user.width,
    x: 0,
    y: 0,
  });
  page.pushOperators(popGraphicsState());
};

const drawDirtyPdfImage = async (
  page: PDFPage,
  object: PdfImageObject,
  editorPage: EditorPage,
  assets: Record<string, ExportAsset>,
  images: Map<string, PDFImage>,
  doc: PDFDocument
): Promise<void> => {
  const cover = displayedToUserSpace(
    pdfImageCoverBox(object),
    editorPage.cropBox,
    editorPage.sourceRotate
  );
  applyCtm(page, { rotation: object.originalRotation }, cover);
  page.drawRectangle({
    color: rgb(1, 1, 1),
    height: cover.height,
    width: cover.width,
    x: 0,
    y: 0,
  });
  page.pushOperators(popGraphicsState());

  if (object.deleted) {
    return;
  }

  const assetId = object.replacementAssetId ?? object.previewAssetId;
  if (!assetId) {
    return;
  }
  const current = displayedToUserSpace(
    object,
    editorPage.cropBox,
    editorPage.sourceRotate
  );
  await drawEmbeddedImage(
    page,
    { opacity: 1, rotation: object.rotation },
    current,
    assetId,
    assets,
    images,
    doc
  );
};

const mapVectorPointToLocal = (
  point: Point,
  object: PdfVectorObject,
  editorPage: EditorPage,
  local: ReturnType<typeof displayedToUserSpace>
): Point => {
  const displayed = userPointToDisplayed(
    point,
    editorPage.cropBox,
    editorPage.sourceRotate
  );
  const sx = vectorAxisScale(object.originalWidth, local.width);
  const sy = vectorAxisScale(object.originalHeight, local.height);
  return {
    x: (displayed.x - object.originalX) * sx,
    y: local.height - (displayed.y - object.originalY) * sy,
  };
};

const lineCapStyle = (value: number): LineCapStyle => {
  if (value === 1) {
    return LineCapStyle.Round;
  }
  if (value === 2) {
    return LineCapStyle.Projecting;
  }
  return LineCapStyle.Butt;
};

const lineJoinStyle = (value: number): LineJoinStyle => {
  if (value === 1) {
    return LineJoinStyle.Round;
  }
  if (value === 2) {
    return LineJoinStyle.Bevel;
  }
  return LineJoinStyle.Miter;
};

const vectorPathOperators = (
  commands: readonly PdfPathCommand[],
  object: PdfVectorObject,
  editorPage: EditorPage,
  local: ReturnType<typeof displayedToUserSpace>
): PDFOperator[] => {
  const ops: PDFOperator[] = [];
  for (const command of commands) {
    if (command.type === "moveTo") {
      const point = mapVectorPointToLocal(command, object, editorPage, local);
      ops.push(moveTo(point.x, point.y));
      continue;
    }
    if (command.type === "lineTo") {
      const point = mapVectorPointToLocal(command, object, editorPage, local);
      ops.push(lineTo(point.x, point.y));
      continue;
    }
    if (command.type === "curveTo") {
      const c1 = mapVectorPointToLocal(
        { x: command.x1, y: command.y1 },
        object,
        editorPage,
        local
      );
      const c2 = mapVectorPointToLocal(
        { x: command.x2, y: command.y2 },
        object,
        editorPage,
        local
      );
      const end = mapVectorPointToLocal(
        { x: command.x3, y: command.y3 },
        object,
        editorPage,
        local
      );
      ops.push(appendBezierCurve(c1.x, c1.y, c2.x, c2.y, end.x, end.y));
      continue;
    }
    if (command.type === "quadraticCurveTo") {
      const control = mapVectorPointToLocal(
        { x: command.x1, y: command.y1 },
        object,
        editorPage,
        local
      );
      const end = mapVectorPointToLocal(
        { x: command.x, y: command.y },
        object,
        editorPage,
        local
      );
      ops.push(appendQuadraticCurve(control.x, control.y, end.x, end.y));
      continue;
    }
    ops.push(closePath());
  }
  return ops;
};

const OPAQUE_ALPHA = 1;

const alphaStates = new WeakMap<PDFPage, Map<string, PDFName>>();

/**
 * Set constant fill and stroke alpha through a page ExtGState (`ca`/`CA`).
 * Null when both are opaque, so opaque paint adds no resource.
 */
export const alphaGraphicsState = (
  page: PDFPage,
  fillAlpha: number,
  strokeAlpha: number
): PDFOperator | null => {
  if (fillAlpha >= OPAQUE_ALPHA && strokeAlpha >= OPAQUE_ALPHA) {
    return null;
  }
  const key = `${fillAlpha}/${strokeAlpha}`;
  let states = alphaStates.get(page);
  if (!states) {
    states = new Map();
    alphaStates.set(page, states);
  }
  let name = states.get(key);
  if (!name) {
    name = page.node.newExtGState(
      "GS",
      page.doc.context.obj({
        CA: strokeAlpha,
        Type: "ExtGState",
        ca: fillAlpha,
      })
    );
    states.set(key, name);
  }
  return setGraphicsState(name);
};

const paintVectorOperators = (
  page: PDFPage,
  object: PdfVectorObject
): PDFOperator[] => {
  const ops: PDFOperator[] = [];
  const alpha = alphaGraphicsState(
    page,
    object.fill?.opacity ?? OPAQUE_ALPHA,
    object.stroke?.opacity ?? OPAQUE_ALPHA
  );
  if (alpha) {
    ops.push(alpha);
  }
  if (object.fill) {
    ops.push(setFillingColor(color(object.fill.color)));
  }
  if (object.stroke) {
    ops.push(
      setStrokingColor(color(object.stroke.color)),
      setLineWidth(object.stroke.width * vectorStrokeScale(object)),
      setLineCap(lineCapStyle(object.stroke.lineCap)),
      setLineJoin(lineJoinStyle(object.stroke.lineJoin))
    );
  }
  switch (object.paint) {
    case "stroke":
    case "closeStroke": {
      ops.push(stroke());
      break;
    }
    case "fill":
    case "eoFill": {
      ops.push(fillPath());
      break;
    }
    default: {
      ops.push(fillAndStroke());
      break;
    }
  }
  return ops;
};

/** Draw a dirty run's replacement at the original ink's opacity. */
const drawDirtyPdfText = async (
  page: PDFPage,
  object: PdfTextObject,
  editorPage: EditorPage,
  fonts: Map<string, PDFFont>,
  doc: PDFDocument,
  fontBytes: Record<string, Uint8Array>,
  pages: readonly EditorPage[]
): Promise<void> => {
  const alpha =
    object.fillOpacity === undefined
      ? null
      : alphaGraphicsState(page, object.fillOpacity, OPAQUE_ALPHA);
  if (alpha) {
    page.pushOperators(pushGraphicsState(), alpha);
  }
  try {
    await drawDirtyPdfTextInk(
      page,
      object,
      editorPage,
      fonts,
      doc,
      fontBytes,
      pages
    );
  } finally {
    if (alpha) {
      page.pushOperators(popGraphicsState());
    }
  }
};

/** Repaint a vector's original path in `coverStyle` to hide its ink. */
const paintPdfVectorCoverPath = (
  page: PDFPage,
  object: PdfVectorObject,
  editorPage: EditorPage,
  coverStyle: PdfVectorCoverPathStyle
): void => {
  const coverBox = {
    height: object.originalHeight,
    rotation: object.originalRotation,
    width: object.originalWidth,
    x: object.originalX,
    y: object.originalY,
  };
  const coverLocal = displayedToUserSpace(
    coverBox,
    editorPage.cropBox,
    editorPage.sourceRotate
  );
  const coverObject: PdfVectorObject = {
    ...object,
    ...coverBox,
    fill: coverStyle.fill ? { color: coverStyle.fill } : null,
    // A fill-only outline still needs its cover's stroke painted: the stroke
    // reaches the antialiased edge the fill alone leaves showing.
    paint: coverStyle.fill && coverStyle.stroke ? "fillStroke" : object.paint,
    stroke: coverStyle.stroke
      ? {
          color: coverStyle.stroke,
          lineCap: coverStyle.lineCap,
          lineJoin: coverStyle.lineJoin,
          width: coverStyle.strokeWidth,
        }
      : null,
  };
  applyCtm(page, coverObject, coverLocal);
  page.pushOperators(
    ...vectorPathOperators(
      object.commands,
      coverObject,
      editorPage,
      coverLocal
    ),
    ...paintVectorOperators(page, coverObject)
  );
  page.pushOperators(popGraphicsState());
};

/**
 * Hide a dirty run's original glyphs. The cover leaves the original operators
 * in the page stream. A sampled page color hides that on flat tints; white
 * remains the fallback. A run that owns its outline path is covered by that
 * path; otherwise the rects follow original glyph ink and stop at
 * neighbouring runs.
 */
const drawDirtyPdfTextCovers = (
  page: PDFPage,
  object: PdfTextObject,
  editorPage: EditorPage
): void => {
  const outline = pdfTextInkOutline(object, editorPage);
  if (outline) {
    // The run's ink is this outline path; repaint just its shape.
    paintPdfVectorCoverPath(
      page,
      outline,
      editorPage,
      pdfTextInkCoverStyle(pdfTextCoverColor(object))
    );
    return;
  }
  const coverColor = color(pdfTextCoverColor(object));
  const turned = pdfTextFrameRotation(object) !== 0;
  for (const cover of pdfTextCoverRects(object, editorPage)) {
    if (turned) {
      // A turned run's cover is a rect in its own frame: paint it turned.
      const [first, ...rest] = pdfTextFrameCorners(object, cover).map(
        (corner) =>
          displayedPointToUserSpace(
            corner,
            editorPage.cropBox,
            editorPage.sourceRotate
          )
      );
      if (first) {
        page.pushOperators(
          pushGraphicsState(),
          setFillingColor(coverColor),
          moveTo(first.x, first.y),
          ...rest.map((corner) => lineTo(corner.x, corner.y)),
          closePath(),
          fillPath(),
          popGraphicsState()
        );
      }
      continue;
    }
    const coverUser = displayedToUserSpace(
      cover,
      editorPage.cropBox,
      editorPage.sourceRotate
    );
    page.drawRectangle({
      color: coverColor,
      height: coverUser.height,
      width: coverUser.width,
      x: coverUser.x,
      y: coverUser.y,
    });
  }
};

/** Paint a vector at its current place and style. */
const drawPdfVectorPath = (
  page: PDFPage,
  object: PdfVectorObject,
  editorPage: EditorPage
): void => {
  const local = displayedToUserSpace(
    object,
    editorPage.cropBox,
    editorPage.sourceRotate
  );
  applyCtm(page, object, local);
  page.pushOperators(
    ...vectorPathOperators(object.commands, object, editorPage, local),
    ...paintVectorOperators(page, object)
  );
  page.pushOperators(popGraphicsState());
};

const drawDirtyPdfVector = (
  page: PDFPage,
  object: PdfVectorObject,
  editorPage: EditorPage
): void => {
  paintPdfVectorCoverPath(
    page,
    object,
    editorPage,
    pdfVectorCoverPathStyle(object)
  );

  if (object.deleted) {
    return;
  }
  drawPdfVectorPath(page, object, editorPage);
};

const drawImageObject = async (
  page: PDFPage,
  object: ImageObject,
  user: ReturnType<typeof displayedToUserSpace>,
  assets: Record<string, ExportAsset>,
  images: Map<string, PDFImage>,
  doc: PDFDocument
): Promise<void> => {
  await drawEmbeddedImage(
    page,
    object,
    user,
    object.assetId,
    assets,
    images,
    doc
  );
};

const drawStrokePoints = (
  page: PDFPage,
  object: DrawingObject | SignatureObject,
  user: ReturnType<typeof displayedToUserSpace>
): void => {
  if (object.points.length === 0) {
    return;
  }
  applyCtm(page, object, user);
  const toLocal = (point: Point): Point => ({
    x: point.x,
    y: user.height - point.y,
  });
  const first = toLocal(object.points[0] ?? { x: 0, y: 0 });
  const ops = [
    setStrokingColor(color(object.stroke)),
    setLineWidth(object.strokeWidth),
    setLineCap(LineCapStyle.Round),
    setLineJoin(LineJoinStyle.Round),
    moveTo(first.x, first.y),
  ];
  for (const point of object.points.slice(1)) {
    const local = toLocal(point);
    ops.push(lineTo(local.x, local.y));
  }
  ops.push(stroke(), popGraphicsState());
  page.pushOperators(...ops);
};

const drawHighlight = (
  page: PDFPage,
  object: HighlightObject,
  user: ReturnType<typeof displayedToUserSpace>
): void => {
  applyCtm(page, object, user);
  page.drawRectangle({
    blendMode: BlendMode.Multiply,
    color: color(object.color),
    height: user.height,
    opacity: object.opacity,
    width: user.width,
    x: 0,
    y: 0,
  });
  page.pushOperators(popGraphicsState());
};

const drawShapeArea = (
  page: PDFPage,
  shape: "circle" | "rect",
  path: Rect,
  paint: {
    border?: ReturnType<typeof color>;
    fill?: ReturnType<typeof color>;
    opacity: number | undefined;
    strokeWidth: number;
  }
): void => {
  const options = {
    borderColor: paint.border,
    borderOpacity: paint.opacity,
    borderWidth: paint.border ? paint.strokeWidth : 0,
    color: paint.fill,
    opacity: paint.opacity,
  };
  if (shape === "circle") {
    page.drawEllipse({
      ...options,
      // Keeps pdf-lib off its deprecated path, which wraps the ellipse in q/Q.
      rotate: degrees(0),
      x: path.x + path.width / 2,
      xScale: path.width / 2,
      y: path.y + path.height / 2,
      yScale: path.height / 2,
    });
    return;
  }
  page.drawRectangle({
    ...options,
    height: path.height,
    width: path.width,
    // Inset boxes are centred, so the y-down offset is also the y-up one.
    x: path.x,
    y: path.y,
  });
};

const drawShape = (
  page: PDFPage,
  object: ShapeObject,
  user: ReturnType<typeof displayedToUserSpace>
): void => {
  applyCtm(page, object, user);
  const fill = object.fill ? color(object.fill) : undefined;
  const border = color(object.stroke);
  if (object.shape === "line") {
    page.drawLine({
      color: border,
      dashArray: object.dashed ? lineDashArray(object.strokeWidth) : undefined,
      // User space is y-up from the box's bottom-left corner.
      end: { x: user.width, y: object.flip ? user.height : 0 },
      opacity: object.opacity,
      start: { x: 0, y: object.flip ? 0 : user.height },
      thickness: object.strokeWidth,
    });
    page.pushOperators(popGraphicsState());
    return;
  }

  // Same inset as the screen, which keeps rect and circle strokes in the box.
  const path = insetShapePathBox(user, object.strokeWidth);
  const paint = {
    opacity: object.opacity,
    strokeWidth: object.strokeWidth,
  };
  // The screen fades the whole object at once. PDF alpha applies per paint,
  // so a translucent fill under the stroke's inner half would show through as
  // a second tone. Fill only up to the stroke's inner edge instead.
  const translucentFill =
    fill !== undefined && (object.opacity ?? 1) < 1 && object.strokeWidth > 0;
  if (translucentFill) {
    const inner = insetShapePathBox(user, object.strokeWidth * 2);
    drawShapeArea(page, object.shape, inner, { ...paint, fill });
    drawShapeArea(page, object.shape, path, { ...paint, border });
  } else {
    drawShapeArea(page, object.shape, path, { ...paint, border, fill });
  }
  page.pushOperators(popGraphicsState());
};

const drawObject = async (
  page: PDFPage,
  object: EditorObject,
  editorPage: EditorPage,
  context: {
    assets: Record<string, ExportAsset>;
    doc: PDFDocument;
    fontBytes: Record<string, Uint8Array>;
    fonts: Map<string, PDFFont>;
    images: Map<string, PDFImage>;
    /** "draw": the content under the box is gone; paint the box. */
    redactions: "draw" | "forbid" | "skip";
  }
): Promise<void> => {
  const rotate = editorPage.sourceRotate;
  const user = displayedToUserSpace(object, editorPage.cropBox, rotate);

  switch (object.type) {
    case "text": {
      // A blank box placed by the text tool draws nothing. OCR edits still
      // export so their white field keeps hiding the scanned word.
      if (!(object.ocrWordId || object.content.trim())) {
        return;
      }
      await drawTextObject(
        page,
        object,
        user,
        context.fonts,
        context.doc,
        context.fontBytes
      );
      return;
    }
    case "image": {
      await drawImageObject(
        page,
        object,
        user,
        context.assets,
        context.images,
        context.doc
      );
      return;
    }
    case "drawing":
    case "signature": {
      drawStrokePoints(page, object, user);
      return;
    }
    case "highlight": {
      drawHighlight(page, object, user);
      return;
    }
    case "shape": {
      drawShape(page, object, user);
      return;
    }
    case "redaction": {
      if (context.redactions === "draw") {
        page.drawRectangle({
          color: color(object.fill),
          height: user.height,
          width: user.width,
          x: user.x,
          y: user.y,
        });
        return;
      }
      // A box painted over content leaves that content in the file.
      if (context.redactions === "skip") {
        return;
      }
      throw new Error("Redactions must be flattened, not drawn.");
    }
    default: {
      const _exhaustive: never = object;
      return _exhaustive;
    }
  }
};

const MIN_INVISIBLE_OCR_FONT_SIZE = 1;

const encodeWinAnsiText = (font: PDFFont, text: string) => {
  try {
    return font.encodeText(text);
  } catch {
    return null;
  }
};

/** Searchable, unpainted text (rendering mode 3) at a baseline origin. */
const pushInvisibleText = (
  page: PDFPage,
  font: PDFFont,
  text: string,
  size: number,
  origin: Point
): void => {
  const encoded = encodeWinAnsiText(font, text);
  if (!encoded) {
    return;
  }
  const embeddedFontKey = page.node.newFontDictionary(font.name, font.ref);
  const zero = degrees(0);
  page.pushOperators(
    pushGraphicsState(),
    beginText(),
    setTextRenderingMode(TextRenderingMode.Invisible),
    setFontAndSize(embeddedFontKey, size),
    rotateAndSkewTextRadiansAndTranslate(
      toRadians(zero),
      toRadians(zero),
      toRadians(zero),
      origin.x,
      origin.y
    ),
    showText(encoded),
    endText(),
    popGraphicsState()
  );
};

const drawInvisibleOcrWords = (
  page: PDFPage,
  words: readonly OcrTextObject[],
  editorPage: EditorPage,
  font: PDFFont
): void => {
  const suppressed = editorPage.suppressedOcrWordIds
    ? new Set(editorPage.suppressedOcrWordIds)
    : null;
  for (const word of words) {
    if (suppressed?.has(word.id) || word.text.trim().length === 0) {
      continue;
    }
    pushInvisibleText(
      page,
      font,
      word.text,
      Math.max(word.height, MIN_INVISIBLE_OCR_FONT_SIZE),
      displayedPointToUserSpace(
        { x: word.x, y: word.baselineY },
        editorPage.cropBox,
        editorPage.sourceRotate
      )
    );
  }
};

/**
 * Outline-only text the user did not edit is still only outlines in the
 * page; recognized text under it makes the export searchable.
 */
const drawInvisibleOutlineText = (
  page: PDFPage,
  runs: readonly PdfTextObject[],
  editorPage: EditorPage,
  font: PDFFont
): void => {
  for (const run of runs) {
    pushInvisibleText(
      page,
      font,
      run.text,
      Math.max(run.fontSize ?? run.height, MIN_INVISIBLE_OCR_FONT_SIZE),
      pdfTextBaselineUserSpace(
        run.transform,
        editorPage.cropBox,
        editorPage.sourceRotate
      )
    );
  }
};

const OCR_FONT_KEY = "ocr-helvetica";

const ocrFontFor = async (
  fonts: Map<string, PDFFont>,
  doc: PDFDocument
): Promise<PDFFont> => {
  const cached = fonts.get(OCR_FONT_KEY);
  if (cached) {
    return cached;
  }
  const font = await doc.embedFont(StandardFonts.Helvetica);
  fonts.set(OCR_FONT_KEY, font);
  return font;
};

export interface ExportReport {
  bytes: Uint8Array;
  /**
   * Edited runs whose original ink could only be covered, so the old text
   * or its glyph shapes are still in the file.
   */
  coverOnlyRunIds: string[];
  /**
   * Deleted PDF images and vectors that could only be covered, so they are
   * still in the file.
   */
  coveredObjectCount: number;
  /** Output pages (by index) whose redactions are left for flattening. */
  flattenPages: number[];
  /** Fields removed because a widget sat under a precise redaction. */
  removedFieldNames: string[];
}

/**
 * Take dirty runs' original ink out of the page where it can be verified, and
 * cover the rest. Returns the runs that could only be covered.
 */
interface DirtyTextOutcome {
  /** Dirty runs whose original ink could only be covered. */
  coverOnly: string[];
  /** The page's redaction boxes were applied to its content. */
  redactedPrecisely: boolean;
  /** Deleted vectors taken out of the page's content. */
  vectorsRemoved: ReadonlySet<string>;
}

const removeOrCoverDirtyText = async (
  output: PDFDocument,
  page: PDFPage,
  editorPage: EditorPage,
  dirtyText: readonly PdfTextObject[],
  boxes: readonly RedactionBox[],
  codec: ImageCodec | undefined
): Promise<DirtyTextOutcome> => {
  const coverOnly: string[] = [];
  const removal = await editPageContent(
    output,
    page,
    editorPage,
    dirtyText,
    boxes,
    codec
  );
  // Unedited lines of a label whose path stopped painting come back as they were.
  const vectors = new Map(
    editorPage.pdfVectorObjects.map((vector) => [vector.id, vector])
  );
  for (const kept of removal.keptOutlineLines) {
    const vector = vectors.get(kept.vectorId);
    if (vector) {
      drawPdfVectorPath(
        page,
        pdfVectorSubpaths(vector, kept.subpaths),
        editorPage
      );
    }
  }
  // Every cover goes down before any text: a run emptied by a link label
  // edit must not hide the caption drawn by the run before it.
  for (const object of dirtyText) {
    const inkGone = removal.inkRemoved.has(object.id);
    if (!(inkGone && removal.textRemoved.has(object.id))) {
      coverOnly.push(object.id);
    }
    // A link caption's cover also hides its underline, which stays.
    if (!inkGone || object.captionUnderline) {
      drawDirtyPdfTextCovers(page, object, editorPage);
    }
  }
  return {
    coverOnly,
    redactedPrecisely: removal.redactedPrecisely,
    vectorsRemoved: removal.vectorsRemoved,
  };
};

const loadSourcePdf = async (bytes: Uint8Array): Promise<PDFDocument> => {
  try {
    return await PDFDocument.load(bytes);
  } catch (error) {
    if (error instanceof EncryptedPDFError) {
      throw new TypeError("This PDF is encrypted and cannot be exported.", {
        cause: error,
      });
    }
    throw error;
  }
};

/** Each source document the pages use, parsed once, opened file first. */
const loadSources = async (
  input: ExportInput,
  outputPages: readonly EditorPage[]
): Promise<Map<string, { doc: PDFDocument; pages: PDFPage[] }>> => {
  const docIds = [
    ...new Set([PRIMARY_DOC_ID, ...outputPages.map((page) => pageDocId(page))]),
  ];
  const entries = await Promise.all(
    docIds.map(async (docId) => {
      const bytes =
        docId === PRIMARY_DOC_ID ? input.bytes : input.sources?.[docId];
      if (!bytes) {
        throw new Error("A page's source PDF is missing from the export.");
      }
      const doc = await loadSourcePdf(bytes);
      // Each source's field values and appearances go into its own form.
      const fields = documentForm(input.document).fields.filter(
        (field) => (field.docId ?? PRIMARY_DOC_ID) === docId
      );
      if (fields.length > 0) {
        await applyPdfFormEdits(
          doc,
          {
            ...input.document,
            form: { ...documentForm(input.document), fields },
          },
          input.fontBytes
        );
      }
      await doc.flush();
      return [docId, { doc, pages: doc.getPages() }] as const;
    })
  );
  return new Map(entries);
};

/** How `drawObject` treats a redaction box on this page. */
const boxMode = (
  mode: ExportInput["redactions"],
  precise: boolean
): "draw" | "forbid" | "skip" => {
  if (mode === undefined || mode === "forbid") {
    return "forbid";
  }
  return precise ? "draw" : "skip";
};

interface PageTextOutcome {
  coverOnly: string[];
  /** The page's redactions were applied here; it needs no flattening. */
  precise: boolean;
  /** Deleted vectors taken out of the page's content: no cover needed. */
  vectorsRemoved: ReadonlySet<string>;
}

/**
 * Edit the page's own content (Removal, precise redaction) and draw its
 * invisible text. Text under a box is never drawn. `precise` is true when
 * the page's redactions were applied here and need no flattening.
 */
const writePageText = async (
  context: {
    fonts: Map<string, PDFFont>;
    input: ExportInput;
    output: PDFDocument;
  },
  page: PDFPage,
  editorPage: EditorPage,
  redaction: PageRedaction | null
): Promise<PageTextOutcome> => {
  const { fonts, input, output } = context;
  const tryPrecise = redaction?.tryPrecise === true;
  if (redaction && tryPrecise) {
    removeAnnotationsUnderBoxes(output, page, redaction.boxes);
  }
  const dirtyText = editorPage.pdfTextObjects.filter(isPdfTextDirty);
  // Removal first, on the page's own content; covers only where ink stays.
  const { coverOnly, redactedPrecisely, vectorsRemoved } =
    await removeOrCoverDirtyText(
      output,
      page,
      editorPage,
      dirtyText,
      redaction && tryPrecise ? redaction.boxes : [],
      input.imageCodec
    );
  // After Removal, which reads the page's own content and gives up on a
  // page with appended streams.
  const boxes = redaction?.boxes;
  const ocrWords = ocrWordsClearOf(
    input.ocrWordsByPage?.[editorPage.id],
    editorPage,
    [...(boxes ?? []), ...deletedObjectBoxes(editorPage)]
  );
  if (ocrWords.length > 0) {
    drawInvisibleOcrWords(
      page,
      ocrWords,
      editorPage,
      await ocrFontFor(fonts, output)
    );
  }
  const cleanOutlineText = editorPage.pdfTextObjects.filter(
    (run) =>
      run.outlineText &&
      !isPdfTextDirty(run) &&
      clearOfBoxes(run, editorPage, boxes)
  );
  if (cleanOutlineText.length > 0) {
    drawInvisibleOutlineText(
      page,
      cleanOutlineText,
      editorPage,
      await ocrFontFor(fonts, output)
    );
  }
  return {
    coverOnly,
    precise: tryPrecise && redactedPrecisely,
    vectorsRemoved,
  };
};

/** Dirty vectors to cover (and redraw), leaving out deleted ones already gone. */
const coveredVectors = (
  editorPage: EditorPage,
  vectorsRemoved: ReadonlySet<string>
): PdfVectorObject[] =>
  editorPage.pdfVectorObjects.filter(
    (vector) => isPdfVectorDirty(vector) && !vectorsRemoved.has(vector.id)
  );

/**
 * Deleted images, and deleted vectors whose path could not come out of the
 * content: export only covers them.
 */
const coveredDeletions = (
  editorPage: EditorPage,
  vectorsRemoved: ReadonlySet<string>
): number =>
  editorPage.pdfImageObjects.filter((image) => image.deleted).length +
  editorPage.pdfVectorObjects.filter(
    (vector) => vector.deleted && !vectorsRemoved.has(vector.id)
  ).length;

const saveOutput = (
  output: PDFDocument,
  scrub: boolean | undefined
): Promise<Uint8Array> => {
  if (scrub) {
    scrubHiddenData(output);
  }
  return saveSwept(output);
};

export const exportDocumentWithReport = async (
  input: ExportInput
): Promise<ExportReport> => {
  const coverOnlyRunIds: string[] = [];
  let coveredObjectCount = 0;
  const outputPages = outputPagesOf(input);
  const [sources, output] = await Promise.all([
    loadSources(input, outputPages),
    PDFDocument.create(),
  ]);
  // A ref to a source page would pull that page in as a hidden copy.
  markInternalLinkTargets(sources, outputPages);
  output.registerFontkit(fontkit);
  const helvetica = helveticaFor(output);

  // One copier per source keeps resources shared by its pages copied once.
  // A source page shown again (a duplicate) gets a copier of its own, so its
  // annotations and content are its own to edit.
  const sharedCopiers = new Map<string, PDFObjectCopier>();
  const sharedCopier = (docId: string, doc: PDFDocument): PDFObjectCopier => {
    let copier = sharedCopiers.get(docId);
    if (!copier) {
      copier = PDFObjectCopier.for(doc.context, output.context);
      sharedCopiers.set(docId, copier);
    }
    return copier;
  };
  const copiedOnce = new Set<string>();
  const placements: OutputPagePlacement[] = [];

  // Shared by every page: a font is parsed and subset once, and an image
  // placed on many pages is embedded once and referenced from each.
  const fonts = new Map<string, PDFFont>();
  const images = new Map<string, PDFImage>();
  const precisePages = new Map<number, PageRedaction>();
  const flattenPages: number[] = [];
  for (const [outputIndex, editorPage] of outputPages.entries()) {
    const docId = pageDocId(editorPage);
    const source = sources.get(docId);
    const sourcePage = source?.pages[editorPage.sourceIndex];
    if (!(source && sourcePage)) {
      throw new Error("A page is missing from its source PDF.");
    }
    const key = pageKeyString(pageKeyOf(editorPage));
    const copier = copiedOnce.has(key)
      ? PDFObjectCopier.for(source.doc.context, output.context)
      : sharedCopier(docId, source.doc);
    copiedOnce.add(key);
    const node = copier.copy(sourcePage.node);
    const page = PDFPage.of(node, output.context.register(node), output);
    output.addPage(page);
    placements.push({ docId, page, sourceIndex: editorPage.sourceIndex });
    // oxlint-disable-next-line eslint/no-await-in-loop -- pages are written in order
    await applyPageAnnotationEdits(
      output,
      helvetica,
      editorPage,
      page,
      copiedAnnotRefs(sourcePage, page)
    );
    if (editorPage.omitFormWidgets) {
      stripFormWidgets(output, page);
    }

    const combined = normalizeRotation(
      editorPage.sourceRotate + editorPage.rotation
    );
    if (combined !== normalizeRotation(page.getRotation().angle)) {
      page.setRotation(degrees(combined));
    }

    const redaction = pageRedaction(editorPage, input.redactions ?? "forbid");
    // oxlint-disable-next-line eslint/no-await-in-loop -- pages are written in order
    const written = await writePageText(
      { fonts, input, output },
      page,
      editorPage,
      redaction
    );
    coverOnlyRunIds.push(...written.coverOnly);
    if (redaction && written.precise) {
      precisePages.set(outputIndex, redaction);
    } else if (redaction) {
      flattenPages.push(outputIndex);
    }
    const dirtyText = editorPage.pdfTextObjects.filter(isPdfTextDirty);
    for (const object of dirtyText) {
      if (object.text === "") {
        continue;
      }
      // oxlint-disable-next-line eslint/no-await-in-loop -- font cache is filled in order
      await drawDirtyPdfText(
        page,
        object,
        editorPage,
        fonts,
        output,
        input.fontBytes,
        input.document.pages
      );
    }
    coveredObjectCount += coveredDeletions(editorPage, written.vectorsRemoved);
    for (const object of editorPage.pdfImageObjects) {
      if (!isPdfImageDirty(object)) {
        continue;
      }
      // oxlint-disable-next-line react-doctor/async-await-in-loop  no-await-in-loop-- image cache is filled in order
      await drawDirtyPdfImage(
        page,
        object,
        editorPage,
        input.assets,
        images,
        output
      );
    }
    for (const object of coveredVectors(editorPage, written.vectorsRemoved)) {
      drawDirtyPdfVector(page, object, editorPage);
    }
    for (const object of editorPage.objects) {
      // oxlint-disable-next-line eslint/no-await-in-loop  no-await-in-loop-- font and image caches are filled in order
      await drawObject(page, object, editorPage, {
        assets: input.assets,
        doc: output,
        fontBytes: input.fontBytes,
        fonts,
        images,
        redactions: boxMode(input.redactions, written.precise),
      });
    }
  }

  resolveInternalLinkTargets(output, placements);
  writeOutputAcroForm(
    output,
    [...sources].flatMap(([docId, { doc }]) => {
      const copier = sharedCopiers.get(docId);
      return copier ? [{ copier, source: doc }] : [];
    })
  );

  const removedFieldNames =
    precisePages.size > 0
      ? removeFieldsUnderBoxes(output, output.getPages(), precisePages)
      : [];
  return {
    bytes: await saveOutput(output, input.scrub),
    coverOnlyRunIds,
    coveredObjectCount,
    flattenPages,
    removedFieldNames,
  };
};

export const exportDocument = async (
  input: ExportInput
): Promise<Uint8Array> => {
  const report = await exportDocumentWithReport(input);
  return report.bytes;
};

export const displayedPointOnPage = (
  point: Point,
  editorPage: EditorPage
): Point =>
  displayedPointToUserSpace(point, editorPage.cropBox, editorPage.sourceRotate);
