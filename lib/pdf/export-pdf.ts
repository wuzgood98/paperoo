import fontkit from "@pdf-lib/fontkit";
import {
  BlendMode,
  EncryptedPDFError,
  PDFDocument,
  PDFName,
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
  setFontAndSize,
  setLineCap,
  setLineJoin,
  setLineWidth,
  setStrokingColor,
  setTextRenderingMode,
  showText,
  stroke,
  LineCapStyle,
  LineJoinStyle,
  toRadians,
} from "pdf-lib";
import type { PDFFont, PDFImage, PDFOperator, PDFPage } from "pdf-lib";

import {
  centerRotateCtm,
  displayedPointToUserSpace,
  displayedToUserSpace,
  normalizeRotation,
  pdfTextBaselineUserSpace,
  userPointToDisplayed,
} from "@/lib/editor/coordinates";
import {
  fittedPdfTextBox,
  isPdfImageDirty,
  isPdfTextDirty,
  isPdfVectorDirty,
  pdfLinkTextAppearance,
  pdfImageCoverBox,
  pdfTextCoverColor,
  pdfTextCoverRects,
  pdfTextInkCoverStyle,
  pdfTextInkOutline,
  pdfTextNeedsFill,
  pdfTextNeedsStroke,
  pdfVectorCoverPathStyle,
} from "@/lib/editor/object-utils";
import type { PdfVectorCoverPathStyle } from "@/lib/editor/object-utils";
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
  ShapeObject,
  SignatureObject,
  TextObject,
} from "@/lib/editor/types";
import { FONT_FILES, wrapText } from "@/lib/fonts/measure-text";
import type { OcrTextObject } from "@/lib/ocr/types";
import { embeddedFontCanDraw } from "@/lib/pdf/embedded-font";
import { applyPdfAnnotationEdits } from "@/lib/pdf/export-annotations";
import {
  applyPdfFormEdits,
  copyPagesWithAcroForm,
} from "@/lib/pdf/export-forms";
import { resolvePdfFont } from "@/lib/pdf/extract-text";
import { rebuiltGlyphLayout } from "@/lib/pdf/glyph-face";
import { pushRebuiltType3Text } from "@/lib/pdf/rebuilt-type3-font";
import { removeOriginalInk } from "@/lib/pdf/remove-original-ink";
import { reusedFontHex, reuseEmbeddedPdfFont } from "@/lib/pdf/reuse-pdf-font";
import type { ReusedPdfFontText } from "@/lib/pdf/reuse-pdf-font";

export interface ExportAsset {
  bytes: Uint8Array;
  mimeType: string;
}

export interface ExportInput {
  assets: Record<string, ExportAsset>;
  bytes: Uint8Array;
  document: EditorDocument;
  fontBytes: Record<string, Uint8Array>;
  ocrWordsByPage?: Readonly<Record<string, readonly OcrTextObject[]>>;
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

const reusedTextMode = (
  needsFill: boolean,
  needsStroke: boolean
): TextRenderingMode => {
  if (needsStroke && needsFill) {
    return TextRenderingMode.FillAndOutline;
  }
  if (needsStroke) {
    return TextRenderingMode.Outline;
  }
  return TextRenderingMode.Fill;
};

interface ReusedPdfTextDraw {
  fillHex: string;
  object: PdfTextObject;
  /** Text origin (baseline start) in PDF user space. */
  origin: Point;
  reused: ReusedPdfFontText;
  size: number;
}

const pushReusedPdfText = (
  page: PDFPage,
  { fillHex, object, origin, reused, size }: ReusedPdfTextDraw
): void => {
  const needsFill = pdfTextNeedsFill(object.textRenderingMode);
  const needsStroke = pdfTextNeedsStroke(object.textRenderingMode);
  const mode = reusedTextMode(needsFill, needsStroke);
  const zero = degrees(0);
  const ops: PDFOperator[] = [
    pushGraphicsState(),
    beginText(),
    setTextRenderingMode(mode),
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
  ops.push(
    setFontAndSize(PDFName.of(reused.resourceName), size),
    rotateAndSkewTextRadiansAndTranslate(
      toRadians(zero),
      toRadians(zero),
      toRadians(zero),
      origin.x,
      origin.y
    ),
    showText(reusedFontHex(reused.encoded)),
    endText(),
    popGraphicsState()
  );
  page.pushOperators(...ops);
};

/** The run's own font resource, or a bundled face when it cannot be reused. */
type DirtyTextFont =
  | { kind: "bundled"; font: PDFFont }
  | { kind: "reused"; reused: ReusedPdfFontText };

const drawDirtyPdfText = async (
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
  const weight = object.fontWeight ?? 400;
  const italic = object.italic === true;
  const reused = embeddedFontCanDraw(object, object.text)
    ? reuseEmbeddedPdfFont(page, object)
    : null;
  const textFont: DirtyTextFont = reused
    ? { kind: "reused", reused }
    : {
        font: await embedFontForStyle(
          family,
          weight,
          italic,
          fonts,
          doc,
          fontBytes
        ),
        kind: "bundled",
      };

  const fitted = fittedPdfTextBox(
    object,
    textFont.kind === "reused"
      ? textFont.reused.width
      : textFont.font.widthOfTextAtSize(object.text, size)
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
  const textX = user.x;
  const textY = baseline.y;
  const needsFill = pdfTextNeedsFill(object.textRenderingMode);
  const needsStroke = pdfTextNeedsStroke(object.textRenderingMode);

  const drawLinkCaptionUnderline = (): void => {
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

  if (textFont.kind === "reused") {
    pushReusedPdfText(page, {
      fillHex,
      object,
      origin: { x: textX, y: textY },
      reused: textFont.reused,
      size,
    });
    drawLinkCaptionUnderline();
    return;
  }
  const { font } = textFont;

  if (!needsStroke) {
    page.drawText(object.text, {
      color: color(fillHex),
      font,
      size,
      x: textX,
      y: textY,
    });
    drawLinkCaptionUnderline();
    return;
  }

  const embeddedFontKey = page.node.newFontDictionary(font.name, font.ref);
  const mode = needsFill
    ? TextRenderingMode.FillAndOutline
    : TextRenderingMode.Outline;
  const zero = degrees(0);
  const ops: PDFOperator[] = [
    pushGraphicsState(),
    beginText(),
    setTextRenderingMode(mode),
  ];
  if (needsFill) {
    ops.push(setFillingColor(color(fillHex)));
  }
  ops.push(
    setStrokingColor(color(object.strokeColor)),
    setLineWidth(object.strokeWidth),
    setFontAndSize(embeddedFontKey, size),
    rotateAndSkewTextRadiansAndTranslate(
      toRadians(zero),
      toRadians(zero),
      toRadians(zero),
      textX,
      textY
    ),
    showText(font.encodeText(object.text)),
    endText(),
    popGraphicsState()
  );
  page.pushOperators(...ops);
  drawLinkCaptionUnderline();
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
  const sx =
    object.originalWidth > 1e-6 ? local.width / object.originalWidth : 1;
  const sy =
    object.originalHeight > 1e-6 ? local.height / object.originalHeight : 1;
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

const paintVectorOperators = (object: PdfVectorObject): PDFOperator[] => {
  const ops: PDFOperator[] = [];
  if (object.fill) {
    ops.push(setFillingColor(color(object.fill.color)));
  }
  if (object.stroke) {
    const scale =
      (object.width / Math.max(object.originalWidth, 1e-6) +
        object.height / Math.max(object.originalHeight, 1e-6)) /
      2;
    ops.push(
      setStrokingColor(color(object.stroke.color)),
      setLineWidth(object.stroke.width * scale),
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
    ...paintVectorOperators(coverObject)
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
  for (const cover of pdfTextCoverRects(object, editorPage)) {
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

  const local = displayedToUserSpace(
    object,
    editorPage.cropBox,
    editorPage.sourceRotate
  );
  applyCtm(page, object, local);
  page.pushOperators(
    ...vectorPathOperators(object.commands, object, editorPage, local),
    ...paintVectorOperators(object)
  );
  page.pushOperators(popGraphicsState());
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

const drawShape = (
  page: PDFPage,
  object: ShapeObject,
  user: ReturnType<typeof displayedToUserSpace>
): void => {
  applyCtm(page, object, user);
  const fill = object.fill ? color(object.fill) : undefined;
  const border = color(object.stroke);
  if (object.shape === "circle") {
    page.drawEllipse({
      borderColor: border,
      borderOpacity: object.opacity,
      borderWidth: object.strokeWidth,
      color: fill,
      opacity: object.opacity,
      rotate: degrees(0),
      x: user.width / 2,
      xScale: user.width / 2,
      y: user.height / 2,
      yScale: user.height / 2,
    });
  } else if (object.shape === "line") {
    page.drawLine({
      color: border,
      end: { x: user.width, y: user.height },
      opacity: object.opacity,
      start: { x: 0, y: user.height },
      thickness: object.strokeWidth,
    });
  } else {
    page.drawRectangle({
      borderColor: border,
      borderOpacity: object.opacity,
      borderWidth: object.strokeWidth,
      color: fill,
      height: user.height,
      opacity: object.opacity,
      width: user.width,
      x: 0,
      y: 0,
    });
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

const drawInvisibleOcrWords = (
  page: PDFPage,
  words: readonly OcrTextObject[],
  editorPage: EditorPage,
  font: PDFFont
): void => {
  const suppressed = editorPage.suppressedOcrWordIds
    ? new Set(editorPage.suppressedOcrWordIds)
    : null;
  const embeddedFontKey = page.node.newFontDictionary(font.name, font.ref);
  const zero = degrees(0);
  for (const word of words) {
    if (suppressed?.has(word.id) || word.text.trim().length === 0) {
      continue;
    }
    const encoded = encodeWinAnsiText(font, word.text);
    if (!encoded) {
      continue;
    }
    const size = Math.max(word.height, MIN_INVISIBLE_OCR_FONT_SIZE);
    const origin = displayedPointToUserSpace(
      { x: word.x, y: word.baselineY },
      editorPage.cropBox,
      editorPage.sourceRotate
    );
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
  }
};

export interface ExportReport {
  bytes: Uint8Array;
  /**
   * Edited runs whose original ink could only be covered, so the old text
   * or its glyph shapes are still in the file.
   */
  coverOnlyRunIds: string[];
}

/**
 * Take dirty runs' original ink out of the page where it can be verified, and
 * cover the rest. Returns the runs that could only be covered.
 */
const removeOrCoverDirtyText = (
  output: PDFDocument,
  page: PDFPage,
  editorPage: EditorPage,
  dirtyText: readonly PdfTextObject[]
): string[] => {
  const coverOnly: string[] = [];
  const removal = removeOriginalInk(output, page, editorPage, dirtyText);
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
  return coverOnly;
};

export const exportDocumentWithReport = async (
  input: ExportInput
): Promise<ExportReport> => {
  const coverOnlyRunIds: string[] = [];
  let source: PDFDocument;
  try {
    source = await PDFDocument.load(input.bytes);
  } catch (error) {
    if (error instanceof EncryptedPDFError) {
      throw new TypeError("This PDF is encrypted and cannot be exported.", {
        cause: error,
      });
    }
    throw error;
  }
  await applyPdfAnnotationEdits(source, input.document);
  await applyPdfFormEdits(source, input.document, input.fontBytes);

  const output = await PDFDocument.create();
  output.registerFontkit(fontkit);

  const indices = input.document.pages.map((page) => page.sourceIndex);
  const copied = await copyPagesWithAcroForm(source, output, indices);

  for (const [index, page] of copied.entries()) {
    output.addPage(page);
    const editorPage = input.document.pages[index];
    if (!editorPage) {
      continue;
    }
    const combined = normalizeRotation(
      editorPage.sourceRotate + editorPage.rotation
    );
    if (combined !== normalizeRotation(page.getRotation().angle)) {
      page.setRotation(degrees(combined));
    }

    const fonts = new Map<string, PDFFont>();
    const images = new Map<string, PDFImage>();
    const ocrWords = input.ocrWordsByPage?.[editorPage.id];
    if (ocrWords && ocrWords.length > 0) {
      const ocrFontKey = "ocr-helvetica";
      let ocrFont = fonts.get(ocrFontKey);
      if (!ocrFont) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- Helvetica is embedded once per export
        ocrFont = await output.embedFont(StandardFonts.Helvetica);
        fonts.set(ocrFontKey, ocrFont);
      }
      drawInvisibleOcrWords(page, ocrWords, editorPage, ocrFont);
    }
    const dirtyText = editorPage.pdfTextObjects.filter(isPdfTextDirty);
    // Removal first, on the page's own content; covers only where ink stays.
    coverOnlyRunIds.push(
      ...removeOrCoverDirtyText(output, page, editorPage, dirtyText)
    );
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
    for (const object of editorPage.pdfVectorObjects) {
      if (!isPdfVectorDirty(object)) {
        continue;
      }
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
      });
    }
  }

  return { bytes: await output.save(), coverOnlyRunIds };
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
