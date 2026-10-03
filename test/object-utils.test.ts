import { expect, test } from "vitest";

import { resizeRotatedBox, rotatePoint } from "@/lib/editor/coordinates";
import {
  boundsFromPoints,
  fittedPdfTextBox,
  fittedPdfTextWidth,
  hitTestPdfImage,
  hitTestPdfText,
  isPdfImageDirty,
  isPdfTextDirty,
  PDF_IMAGE_COVER_BLEED,
  PDF_VECTOR_COVER_BLEED,
  pdfImageCoverBox,
  pdfImageOriginalBox,
  pdfImageWithGestureBox,
  pdfTextOverlayBox,
  pdfVectorCoverBox,
  pdfVectorCoverGeometry,
  pdfVectorCoverPathStyle,
  pdfVectorPreviewBox,
  pdfVectorStrokePad,
  shouldPaintPdfImageCover,
  shouldPaintPdfImagePreview,
  scaleObjectToBox,
  scaleSignaturePoints,
  SIGNATURE_PLACE_SIZE,
} from "@/lib/editor/object-utils";
import type {
  PdfImageObject,
  PdfTextObject,
  PdfVectorObject,
  DrawingObject,
  TextObject,
} from "@/lib/editor/types";
import { EDITOR_OBJECT_SOURCE } from "@/lib/editor/types";

const drawing = (overrides: Partial<DrawingObject> = {}): DrawingObject => ({
  height: 40,
  id: "draw-1",
  opacity: 1,
  points: [
    { x: 0, y: 0 },
    { x: 80, y: 20 },
    { x: 40, y: 40 },
  ],
  rotation: 0,
  source: EDITOR_OBJECT_SOURCE,
  stroke: "#111827",
  strokeWidth: 2,
  type: "drawing",
  width: 80,
  x: 100,
  y: 60,
  ...overrides,
});

const text = (overrides: Partial<TextObject> = {}): TextObject => ({
  align: "left",
  color: "#111827",
  content: "Text",
  fontFamily: "sans",
  fontSize: 16,
  fontWeight: 400,
  height: 40,
  id: "text-1",
  italic: false,
  opacity: 1,
  rotation: 0,
  source: EDITOR_OBJECT_SOURCE,
  type: "text",
  width: 80,
  x: 100,
  y: 60,
  ...overrides,
});

test("scaleObjectToBox keeps drawing points inside a uniform resize", () => {
  const object = drawing();
  const nextBox = { height: 80, width: 160, x: 100, y: 60 };
  const next = scaleObjectToBox(object, nextBox);

  expect(next.width).toBe(160);
  expect(next.height).toBe(80);
  if (next.type !== "drawing") {
    throw new Error("expected drawing");
  }
  expect(next.points).toEqual([
    { x: 0, y: 0 },
    { x: 160, y: 40 },
    { x: 80, y: 80 },
  ]);
  for (const point of next.points) {
    expect(point.x).toBeGreaterThanOrEqual(0);
    expect(point.y).toBeGreaterThanOrEqual(0);
    expect(point.x).toBeLessThanOrEqual(next.width);
    expect(point.y).toBeLessThanOrEqual(next.height);
  }
});

test("scaleObjectToBox keeps drawing points inside a non-uniform resize", () => {
  const object = drawing();
  const nextBox = { height: 20, width: 120, x: 90, y: 70 };
  const next = scaleObjectToBox(object, nextBox);

  if (next.type !== "drawing") {
    throw new Error("expected drawing");
  }
  expect(next.points).toEqual([
    { x: 0, y: 0 },
    { x: 120, y: 10 },
    { x: 60, y: 20 },
  ]);
  for (const point of next.points) {
    expect(point.x).toBeGreaterThanOrEqual(0);
    expect(point.y).toBeGreaterThanOrEqual(0);
    expect(point.x).toBeLessThanOrEqual(next.width);
    expect(point.y).toBeLessThanOrEqual(next.height);
  }
});

test("resize then scale keeps the opposite corner fixed and points inside", () => {
  const object = drawing();
  const box = {
    height: object.height,
    width: object.width,
    x: object.x,
    y: object.y,
  };
  const nextBox = resizeRotatedBox(
    box,
    0,
    "se",
    { x: 220, y: 140 },
    {
      lockAspect: false,
      minSize: 8,
    }
  );
  const next = scaleObjectToBox(object, nextBox);

  expect(next.x).toBeCloseTo(100);
  expect(next.y).toBeCloseTo(60);
  expect(next.width).toBeCloseTo(120);
  expect(next.height).toBeCloseTo(80);
  if (next.type !== "drawing") {
    throw new Error("expected drawing");
  }
  for (const point of next.points) {
    expect(point.x).toBeGreaterThanOrEqual(0);
    expect(point.y).toBeGreaterThanOrEqual(0);
    expect(point.x).toBeLessThanOrEqual(next.width);
    expect(point.y).toBeLessThanOrEqual(next.height);
  }

  const opposite = rotatePoint(
    { x: box.x, y: box.y },
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    0
  );
  expect(next.x).toBeCloseTo(opposite.x);
  expect(next.y).toBeCloseTo(opposite.y);
});

test("scaleSignaturePoints centers a bottom-right stroke in the place box", () => {
  const points = [
    { x: 300, y: 100 },
    { x: 400, y: 140 },
  ];
  const scaled = scaleSignaturePoints(points, SIGNATURE_PLACE_SIZE);
  const bounds = boundsFromPoints(scaled);

  expect(bounds.x + bounds.width / 2).toBeCloseTo(
    SIGNATURE_PLACE_SIZE.width / 2
  );
  expect(bounds.y + bounds.height / 2).toBeCloseTo(
    SIGNATURE_PLACE_SIZE.height / 2
  );
  expect(bounds.x).toBeGreaterThanOrEqual(1);
  expect(bounds.y).toBeGreaterThanOrEqual(1);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(
    SIGNATURE_PLACE_SIZE.width - 1
  );
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(
    SIGNATURE_PLACE_SIZE.height - 1
  );
});

test("fittedPdfTextWidth never shrinks below the original run", () => {
  expect(fittedPdfTextWidth(90, 40)).toBe(90);
  expect(fittedPdfTextWidth(90, 90)).toBe(90);
  expect(fittedPdfTextWidth(90, 160)).toBe(160);
});

test("fittedPdfTextBox grows left for rtl and right for ltr", () => {
  const ltr = fittedPdfTextBox(
    { dir: "ltr", height: 18, width: 90, x: 72, y: 74 },
    160
  );
  expect(ltr).toEqual({ height: 18, width: 160, x: 72, y: 74 });

  const rtl = fittedPdfTextBox(
    { dir: "rtl", height: 18, width: 90, x: 72, y: 74 },
    160
  );
  expect(rtl).toEqual({ height: 18, width: 160, x: 2, y: 74 });
});

test("pdfTextOverlayBox keeps source geometry when clean", () => {
  const object: PdfTextObject = {
    color: "#111827",
    dir: "ltr",
    fontFamily: "sans",
    fontName: "g_d0_f1",
    fontSize: 18,
    fontWeight: 700,
    hasEOL: false,
    height: 18,
    id: "pdf-1",
    italic: false,
    originalColor: "#111827",
    originalFontFamily: "sans",
    originalFontSize: 18,
    originalStrokeColor: "#000000",
    originalStrokeWidth: 1,
    originalText: "Hello",
    originalTextRenderingMode: 0,
    pageId: "page-1",
    rotation: 0,
    sourceIndex: 0,
    strokeColor: "#000000",
    strokeWidth: 1,
    text: "Hello",
    textRenderingMode: 0,
    transform: [18, 0, 0, 18, 72, 700],
    type: "pdf-text",
    width: 90,
    x: 72,
    y: 74,
  };
  expect(isPdfTextDirty(object)).toBe(false);
  expect(pdfTextOverlayBox(object, 160)).toEqual({
    height: 18,
    width: 90,
    x: 72,
    y: 74,
  });
});

test("pdfTextOverlayBox grows when dirty text measures wider", () => {
  const object: PdfTextObject = {
    color: "#111827",
    dir: "ltr",
    fontFamily: "sans",
    fontName: "g_d0_f1",
    fontSize: 18,
    fontWeight: 700,
    hasEOL: false,
    height: 18,
    id: "pdf-1",
    italic: false,
    originalColor: "#111827",
    originalFontFamily: "sans",
    originalFontSize: 18,
    originalStrokeColor: "#000000",
    originalStrokeWidth: 1,
    originalText: "Hello",
    originalTextRenderingMode: 0,
    pageId: "page-1",
    rotation: 0,
    sourceIndex: 0,
    strokeColor: "#000000",
    strokeWidth: 1,
    text: "Hello World and more",
    textRenderingMode: 0,
    transform: [18, 0, 0, 18, 72, 700],
    type: "pdf-text",
    width: 90,
    x: 72,
    y: 74,
  };
  expect(isPdfTextDirty(object)).toBe(true);
  expect(pdfTextOverlayBox(object, 160)).toEqual({
    height: 18,
    width: 160,
    x: 72,
    y: 74,
  });
});

test("isPdfTextDirty is true when only color changes", () => {
  const object: PdfTextObject = {
    color: "#dc2626",
    dir: "ltr",
    fontFamily: "sans",
    fontName: "g_d0_f1",
    fontSize: 18,
    fontWeight: 400,
    hasEOL: false,
    height: 18,
    id: "pdf-1",
    italic: false,
    originalColor: "#111827",
    originalFontFamily: "sans",
    originalFontSize: 18,
    originalStrokeColor: "#000000",
    originalStrokeWidth: 1,
    originalText: "Hello",
    originalTextRenderingMode: 0,
    pageId: "page-1",
    rotation: 0,
    sourceIndex: 0,
    strokeColor: "#000000",
    strokeWidth: 1,
    text: "Hello",
    textRenderingMode: 0,
    transform: [18, 0, 0, 18, 72, 700],
    type: "pdf-text",
    width: 90,
    x: 72,
    y: 74,
  };
  expect(isPdfTextDirty(object)).toBe(true);
});

test("isPdfTextDirty is true when only stroke color changes", () => {
  const object: PdfTextObject = {
    color: "#111827",
    dir: "ltr",
    fontFamily: "sans",
    fontName: "g_d0_f1",
    fontSize: 18,
    fontWeight: 400,
    hasEOL: false,
    height: 18,
    id: "pdf-1",
    italic: false,
    originalColor: "#111827",
    originalFontFamily: "sans",
    originalFontSize: 18,
    originalStrokeColor: "#000000",
    originalStrokeWidth: 1,
    originalText: "Hello",
    originalTextRenderingMode: 1,
    pageId: "page-1",
    rotation: 0,
    sourceIndex: 0,
    strokeColor: "#dc2626",
    strokeWidth: 1,
    text: "Hello",
    textRenderingMode: 1,
    transform: [18, 0, 0, 18, 72, 700],
    type: "pdf-text",
    width: 90,
    x: 72,
    y: 74,
  };
  expect(isPdfTextDirty(object)).toBe(true);
});

test("hitTestPdfText hits grown dirty text outside the original width", () => {
  const object: PdfTextObject = {
    color: "#111827",
    dir: "ltr",
    fontFamily: "sans",
    fontName: "g_d0_f1",
    fontSize: 20,
    fontWeight: 400,
    hasEOL: false,
    height: 20,
    id: "pdf-1",
    italic: false,
    originalColor: "#111827",
    originalFontFamily: "sans",
    originalFontSize: 20,
    originalStrokeColor: "#000000",
    originalStrokeWidth: 1,
    originalText: "Hi",
    originalTextRenderingMode: 0,
    pageId: "page-1",
    rotation: 0,
    sourceIndex: 0,
    strokeColor: "#000000",
    strokeWidth: 1,
    text: "Hello World Extended",
    textRenderingMode: 0,
    transform: [20, 0, 0, 20, 72, 700],
    type: "pdf-text",
    width: 40,
    x: 72,
    y: 74,
  };
  expect(isPdfTextDirty(object)).toBe(true);
  // Fallback measure in Node: length * fontSize * 0.5 = 20 * 20 * 0.5 = 200
  expect(hitTestPdfText([object], { x: 72 + 40 + 10, y: 80 })?.id).toBe(
    "pdf-1"
  );
  expect(hitTestPdfText([object], { x: 72 + 200 + 10, y: 80 })).toBeUndefined();
});

test("scaleObjectToBox scales text font size with height", () => {
  const next = scaleObjectToBox(text(), {
    height: 80,
    width: 160,
    x: 100,
    y: 60,
  });
  expect(next.type).toBe("text");
  if (next.type !== "text") {
    return;
  }
  expect(next.fontSize).toBe(32);
  expect(next.width).toBe(160);
  expect(next.height).toBe(80);
});

const pdfImage = (overrides: Partial<PdfImageObject> = {}): PdfImageObject => ({
  deleted: false,
  height: 40,
  id: "img-1",
  originalHeight: 40,
  originalRotation: 0,
  originalWidth: 80,
  originalX: 72,
  originalY: 152,
  pageId: "page-1",
  previewAssetId: null,
  replacementAssetId: null,
  rotation: 0,
  sourceId: "Im0",
  sourceIndex: 0,
  type: "pdf-image",
  width: 80,
  x: 72,
  y: 152,
  ...overrides,
});

test("isPdfImageDirty is false until geometry, delete, or replace changes", () => {
  expect(isPdfImageDirty(pdfImage())).toBe(false);
  expect(isPdfImageDirty(pdfImage({ x: 90 }))).toBe(true);
  expect(isPdfImageDirty(pdfImage({ deleted: true }))).toBe(true);
  expect(isPdfImageDirty(pdfImage({ replacementAssetId: "a" }))).toBe(true);
});

test("pdfImageCoverBox outsets the original box equally on each side", () => {
  const object = pdfImage();
  const original = pdfImageOriginalBox(object);
  const cover = pdfImageCoverBox(object);
  expect(cover.x).toBe(original.x - PDF_IMAGE_COVER_BLEED);
  expect(cover.y).toBe(original.y - PDF_IMAGE_COVER_BLEED);
  expect(cover.width).toBe(original.width + PDF_IMAGE_COVER_BLEED * 2);
  expect(cover.height).toBe(original.height + PDF_IMAGE_COVER_BLEED * 2);
  expect(cover.rotation).toBe(original.rotation);
  expect(cover.x + cover.width / 2).toBeCloseTo(
    original.x + original.width / 2
  );
  expect(cover.y + cover.height / 2).toBeCloseTo(
    original.y + original.height / 2
  );
});

test("PDF image cover and preview wait for pixels and stay off a clean selection", () => {
  const clean = pdfImage();
  expect(shouldPaintPdfImageCover(clean, null)).toBe(false);
  expect(shouldPaintPdfImagePreview(clean, null)).toBe(false);
  expect(shouldPaintPdfImageCover(clean, "img-1")).toBe(false);
  expect(shouldPaintPdfImagePreview(clean, "img-1")).toBe(false);

  const previewed = pdfImage({ previewAssetId: "preview-1" });
  expect(shouldPaintPdfImageCover(previewed, null)).toBe(false);
  expect(shouldPaintPdfImagePreview(previewed, null)).toBe(false);
  expect(shouldPaintPdfImageCover(previewed, "img-1")).toBe(true);
  expect(shouldPaintPdfImagePreview(previewed, "img-1")).toBe(true);

  const moved = pdfImage({ previewAssetId: "preview-1", x: 90 });
  expect(shouldPaintPdfImageCover(moved, null)).toBe(true);
  expect(shouldPaintPdfImagePreview(moved, null)).toBe(true);

  const deleted = pdfImage({ deleted: true });
  expect(shouldPaintPdfImageCover(deleted, null)).toBe(true);
  expect(shouldPaintPdfImagePreview(deleted, null)).toBe(false);
});

test("pdfImageWithGestureBox keeps the store preview when the gesture object is stale", () => {
  const current = pdfImage({ previewAssetId: "preview-1" });
  const gesture = pdfImage({ previewAssetId: null, x: 90, y: 160 });
  const next = pdfImageWithGestureBox(current, gesture);
  expect(next.previewAssetId).toBe("preview-1");
  expect(next.x).toBe(90);
  expect(next.y).toBe(160);
  expect(next.originalX).toBe(72);
  expect(next.originalY).toBe(152);
});

test("hitTestPdfImage skips deleted images and hits the topmost box", () => {
  const objects = [
    pdfImage(),
    pdfImage({ id: "img-2", sourceIndex: 1, x: 80, y: 160 }),
  ];
  expect(hitTestPdfImage(objects, { x: 90, y: 170 })?.id).toBe("img-2");
  expect(
    hitTestPdfImage([pdfImage({ deleted: true })], { x: 80, y: 160 })
  ).toBeUndefined();
});

const pdfVector = (
  overrides: Partial<PdfVectorObject> = {}
): PdfVectorObject => ({
  commands: [
    { type: "moveTo", x: 72, y: 700 },
    { type: "lineTo", x: 200, y: 700 },
  ],
  deleted: false,
  fill: null,
  height: 1e-4,
  id: "vec-1",
  kind: "line",
  originalFill: null,
  originalHeight: 1e-4,
  originalRotation: 0,
  originalStroke: {
    color: "#0000ff",
    lineCap: 0,
    lineJoin: 0,
    width: 2,
  },
  originalWidth: 128,
  originalX: 72,
  originalY: 90,
  pageId: "page-1",
  paint: "stroke",
  rotation: 0,
  sourceIndex: 0,
  sourceOperatorIndices: [0],
  stroke: {
    color: "#0000ff",
    lineCap: 0,
    lineJoin: 0,
    width: 2,
  },
  type: "pdf-vector",
  width: 128,
  x: 72,
  y: 90,
  ...overrides,
});

test("pdfVectorStrokePad uses half width with a hairline floor", () => {
  expect(pdfVectorStrokePad(null)).toBe(0);
  expect(pdfVectorStrokePad()).toBe(0);
  expect(pdfVectorStrokePad(2)).toBe(1);
  expect(pdfVectorStrokePad(0.5)).toBe(0.5);
  expect(pdfVectorStrokePad(0.2)).toBe(0.5);
});

test("pdfVectorCoverBox and preview box pad a hairline stroke enough to paint", () => {
  const object = pdfVector();
  const strokePad = pdfVectorStrokePad(2);
  const coverPad = PDF_VECTOR_COVER_BLEED + strokePad;
  const cover = pdfVectorCoverBox(object);
  const preview = pdfVectorPreviewBox(object);

  expect(strokePad).toBe(1);
  expect(cover.height).toBeGreaterThanOrEqual(2);
  expect(cover.height).toBeCloseTo(object.originalHeight + coverPad * 2);
  expect(cover.width).toBeCloseTo(object.originalWidth + coverPad * 2);
  expect(cover.x).toBeCloseTo(object.originalX - coverPad);
  expect(cover.y).toBeCloseTo(object.originalY - coverPad);

  expect(preview.height).toBeGreaterThanOrEqual(2);
  expect(preview.height).toBeCloseTo(object.height + strokePad * 2);
  expect(preview.width).toBeCloseTo(object.width + strokePad * 2);
  expect(preview.x).toBeCloseTo(object.x - strokePad);
  expect(preview.y).toBeCloseTo(object.y - strokePad);
  expect(preview.rotation).toBe(object.rotation);
});

test("pdfVectorPreviewBox follows current stroke width, not original", () => {
  const object = pdfVector({
    stroke: {
      color: "#ff0000",
      lineCap: 0,
      lineJoin: 0,
      width: 4,
    },
  });
  const preview = pdfVectorPreviewBox(object);
  expect(preview.height).toBeCloseTo(object.height + 4);
  expect(pdfVectorCoverBox(object).height).toBeCloseTo(
    object.originalHeight + (PDF_VECTOR_COVER_BLEED + 1) * 2
  );
});

test("pdfVectorCoverPathStyle paints white along original path, not a rect", () => {
  const stroked = pdfVector({
    stroke: {
      color: "#ff0000",
      lineCap: 1,
      lineJoin: 1,
      width: 4,
    },
  });
  const style = pdfVectorCoverPathStyle(stroked);
  expect(style.fill).toBeNull();
  expect(style.stroke).toBe("#ffffff");
  expect(style.strokeWidth).toBe(2 + PDF_VECTOR_COVER_BLEED * 2);
  expect(style.lineCap).toBe(0);
  expect(style.lineJoin).toBe(0);

  const geometry = pdfVectorCoverGeometry(stroked);
  expect(geometry.x).toBe(stroked.originalX);
  expect(geometry.y).toBe(stroked.originalY);
  expect(geometry.width).toBe(stroked.originalWidth);
  expect(geometry.height).toBe(stroked.originalHeight);

  const filled = pdfVector({
    fill: { color: "#00ff00" },
    originalFill: { color: "#00ff00" },
    originalStroke: null,
    paint: "fill",
    stroke: null,
  });
  const fillStyle = pdfVectorCoverPathStyle(filled);
  expect(fillStyle.fill).toBe("#ffffff");
  expect(fillStyle.stroke).toBeNull();
  expect(fillStyle.strokeWidth).toBe(0);
});
