import fontkit from "@pdf-lib/fontkit";
import {
  BlendMode,
  EncryptedPDFError,
  PDFDocument,
  StandardFonts,
  degrees,
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
  setFillingColor,
  setLineCap,
  setLineJoin,
  setLineWidth,
  setStrokingColor,
  stroke,
  LineCapStyle,
  LineJoinStyle,
} from "pdf-lib";
import type { PDFFont, PDFImage, PDFOperator, PDFPage } from "pdf-lib";

import {
  centerRotateCtm,
  displayedPointToUserSpace,
  displayedToUserSpace,
  normalizeRotation,
  textBaselineY,
  userPointToDisplayed,
} from "@/lib/editor/coordinates";
import {
  fittedPdfTextBox,
  isPdfImageDirty,
  isPdfTextDirty,
  isPdfVectorDirty,
  pdfImageCoverBox,
  pdfVectorCoverPathStyle,
} from "@/lib/editor/object-utils";
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
import { resolvePdfFont } from "@/lib/pdf/extract-text";

export interface ExportAsset {
  bytes: Uint8Array;
  mimeType: string;
}

export interface ExportInput {
  assets: Record<string, ExportAsset>;
  bytes: Uint8Array;
  document: EditorDocument;
  fontBytes: Record<string, Uint8Array>;
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

const REPLACEMENT_TEXT_COLOR = "#111827";

const drawDirtyPdfText = async (
  page: PDFPage,
  object: PdfTextObject,
  editorPage: EditorPage,
  fonts: Map<string, PDFFont>,
  doc: PDFDocument,
  fontBytes: Record<string, Uint8Array>
): Promise<void> => {
  const family = object.fontFamily ?? resolvePdfFont();
  const size = object.fontSize ?? object.height;
  const weight = object.fontWeight ?? 400;
  const italic = object.italic === true;
  const font = await embedFontForStyle(
    family,
    weight,
    italic,
    fonts,
    doc,
    fontBytes
  );

  const user = displayedToUserSpace(
    fittedPdfTextBox(object, font.widthOfTextAtSize(object.text, size)),
    editorPage.cropBox,
    editorPage.sourceRotate
  );
  // White cover leaves the original operators in the page stream. It fails on
  // non-white and image backgrounds. Width grows with a longer replacement so
  // the extra glyphs stay on a white field.
  page.drawRectangle({
    color: rgb(1, 1, 1),
    height: user.height,
    width: user.width,
    x: user.x,
    y: user.y,
  });

  const ascent = font.heightAtSize(size, { descender: false });
  page.drawText(object.text, {
    color: color(REPLACEMENT_TEXT_COLOR),
    font,
    size,
    x: user.x,
    y: user.y + textBaselineY(user.height, ascent),
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

const drawDirtyPdfVector = (
  page: PDFPage,
  object: PdfVectorObject,
  editorPage: EditorPage
): void => {
  const coverStyle = pdfVectorCoverPathStyle(object);
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

export const exportDocument = async (
  input: ExportInput
): Promise<Uint8Array> => {
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
  const output = await PDFDocument.create();
  output.registerFontkit(fontkit);

  const indices = input.document.pages.map((page) => page.sourceIndex);
  const copied = await output.copyPages(source, indices);

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
    for (const object of editorPage.pdfTextObjects) {
      if (!isPdfTextDirty(object)) {
        continue;
      }
      // oxlint-disable-next-line eslint/no-await-in-loop -- font cache is filled in order
      await drawDirtyPdfText(
        page,
        object,
        editorPage,
        fonts,
        output,
        input.fontBytes
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

  return output.save();
};

export const displayedPointOnPage = (
  point: Point,
  editorPage: EditorPage
): Point =>
  displayedPointToUserSpace(point, editorPage.cropBox, editorPage.sourceRotate);
