import fontkit from "@pdf-lib/fontkit";
import {
  BlendMode,
  EncryptedPDFError,
  PDFDocument,
  StandardFonts,
  degrees,
  rgb,
  concatTransformationMatrix,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  setLineCap,
  setLineJoin,
  setLineWidth,
  setStrokingColor,
  stroke,
  LineCapStyle,
  LineJoinStyle,
} from "pdf-lib";
import type { PDFFont, PDFImage, PDFPage } from "pdf-lib";

import {
  centerRotateCtm,
  displayedPointToUserSpace,
  displayedToUserSpace,
  normalizeRotation,
} from "@/lib/editor/coordinates";
import type {
  DrawingObject,
  EditorDocument,
  EditorObject,
  EditorPage,
  FontFamily,
  FontWeight,
  HighlightObject,
  ImageObject,
  Point,
  ShapeObject,
  SignatureObject,
  TextObject,
} from "@/lib/editor/types";
import { FONT_FILES, wrapText } from "@/lib/fonts/measure-text";

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
  box: EditorObject,
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
  if (family !== "sans") {
    return family;
  }
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
};

const drawTextObject = async (
  page: PDFPage,
  object: TextObject,
  user: ReturnType<typeof displayedToUserSpace>,
  fonts: Map<string, PDFFont>,
  doc: PDFDocument,
  fontBytes: Record<string, Uint8Array>
): Promise<void> => {
  const key = fontKey(object.fontFamily, object.fontWeight, object.italic);
  let font = fonts.get(key);
  if (!font) {
    const bytes = fontBytes[key];
    if (bytes) {
      font = await doc.embedFont(bytes, { subset: true });
    } else if (object.fontFamily === "serif") {
      font = await doc.embedFont(StandardFonts.TimesRoman);
    } else if (object.fontFamily === "mono") {
      font = await doc.embedFont(StandardFonts.Courier);
    } else {
      font = await doc.embedFont(StandardFonts.Helvetica);
    }
    fonts.set(key, font);
  }

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

const drawImageObject = async (
  page: PDFPage,
  object: ImageObject,
  user: ReturnType<typeof displayedToUserSpace>,
  assets: Record<string, ExportAsset>,
  images: Map<string, PDFImage>,
  doc: PDFDocument
): Promise<void> => {
  const asset = assets[object.assetId];
  if (!asset) {
    return;
  }
  let image = images.get(object.assetId);
  if (!image) {
    image =
      asset.mimeType === "image/jpeg"
        ? await doc.embedJpg(asset.bytes)
        : await doc.embedPng(asset.bytes);
    images.set(object.assetId, image);
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
    for (const object of editorPage.objects) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- font and image caches are filled in order
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
