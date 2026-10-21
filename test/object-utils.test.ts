import { afterEach, expect, test } from "vitest";

import {
  resizeRotatedBox,
  rotatePoint,
  textItemToDisplayedBox,
} from "@/lib/editor/coordinates";
import {
  boundsFromPoints,
  createDrawingObject,
  fittedPdfTextBox,
  fittedPdfTextWidth,
  hitTestPdfFormField,
  hitTestPdfImage,
  hitTestPdfText,
  isPdfImageDirty,
  adjacentPdfFormWidget,
  isPdfTextDirty,
  nextCheckboxValue,
  PDF_IMAGE_COVER_BLEED,
  PDF_TEXT_COVER_LEFT_EM,
  PDF_VECTOR_COVER_BLEED,
  captionUnderlineCssOffsetFromRunTop,
  dirtyPdfTextCoverBox,
  PDF_TEXT_COVER_BLEED,
  pdfImageCoverBox,
  pdfImageOriginalBox,
  pdfImageWithGestureBox,
  pdfLinkEditableLabel,
  pdfLinkPrimaryCoverRects,
  pdfLinkTextAppearance,
  pdfTextCssInkOffsetFromRunTop,
  pdfTextCoverRects,
  measurePdfTextCoverRects,
  pdfTextOriginalInkBox,
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
import { editorStore } from "@/lib/editor/store";
import type {
  EditorDocument,
  EditorPage,
  PdfFormTextField,
  PdfImageObject,
  PdfLinkAnnotation,
  PdfTextObject,
  PdfVectorObject,
  DrawingObject,
  TextObject,
} from "@/lib/editor/types";
import {
  DEFAULT_PDF_TEXT_COLOR,
  EDITOR_OBJECT_SOURCE,
} from "@/lib/editor/types";

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

test("createDrawingObject pads its box by half the stroke width", () => {
  const strokeWidth = 6;
  const pad = strokeWidth / 2;
  const object = createDrawingObject(
    [
      { x: 10, y: 20 },
      { x: 50, y: 5 },
      { x: 30, y: 45 },
    ],
    "#000000",
    strokeWidth
  );

  expect(object.x).toBe(10 - pad);
  expect(object.y).toBe(5 - pad);
  expect(object.width).toBe(40 + strokeWidth);
  expect(object.height).toBe(40 + strokeWidth);
  for (const point of object.points) {
    expect(point.x).toBeGreaterThanOrEqual(pad);
    expect(point.y).toBeGreaterThanOrEqual(pad);
    expect(point.x).toBeLessThanOrEqual(object.width - pad);
    expect(point.y).toBeLessThanOrEqual(object.height - pad);
  }
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

const linkCaptionRun = (
  overrides: Partial<PdfTextObject> = {}
): PdfTextObject => ({
  color: DEFAULT_PDF_TEXT_COLOR,
  dir: "ltr",
  fontFamily: "sans",
  fontName: "g_d0_f1",
  fontSize: 12,
  fontWeight: 400,
  hasEOL: false,
  height: 18,
  id: "caption-run",
  italic: false,
  originalColor: DEFAULT_PDF_TEXT_COLOR,
  originalFontFamily: "sans",
  originalFontSize: 12,
  originalStrokeColor: "#000000",
  originalStrokeWidth: 1,
  originalText: "Old label",
  originalTextRenderingMode: 0,
  pageId: "page-1",
  rotation: 0,
  sourceIndex: 0,
  strokeColor: "#000000",
  strokeWidth: 1,
  text: "New label",
  textRenderingMode: 0,
  transform: [12, 0, 0, 12, 72, 700],
  type: "pdf-text",
  width: 60,
  x: 72,
  y: 74,
  ...overrides,
});

const linkForCaption = (): PdfLinkAnnotation => ({
  action: { kind: "url", url: "https://example.com" },
  annotationFlags: 0,
  color: "#facc15",
  deleted: false,
  height: 18,
  id: "link-1",
  label: "New label",
  originalAction: { kind: "url", url: "https://example.com" },
  originalColor: "#facc15",
  originalHeight: 18,
  originalLabel: "Old label",
  originalRotation: 0,
  originalUserHeight: 18,
  originalUserQuadPoints: null,
  originalUserWidth: 60,
  originalUserX: 72,
  originalUserY: 74,
  originalWidth: 60,
  originalX: 72,
  originalY: 74,
  pageId: "page-1",
  quads: [{ height: 18, width: 60, x: 72, y: 74 }],
  rotation: 0,
  sourceRef: "1R",
  subtype: "Link",
  type: "pdf-link",
  width: 60,
  x: 72,
  y: 74,
});

const underlineVector = (): PdfVectorObject => ({
  commands: [
    { type: "moveTo", x: 72, y: 93 },
    { type: "lineTo", x: 140, y: 93 },
  ],
  deleted: false,
  fill: null,
  height: 1,
  id: "underline-vec",
  kind: "line",
  originalFill: null,
  originalHeight: 1,
  originalRotation: 0,
  originalStroke: {
    color: "#0000ff",
    lineCap: 0,
    lineJoin: 0,
    width: 1,
  },
  originalWidth: 68,
  originalX: 72,
  originalY: 92.5,
  pageId: "page-1",
  paint: "stroke",
  rotation: 0,
  sourceIndex: 1,
  sourceOperatorIndices: [1],
  stroke: {
    color: "#0000ff",
    lineCap: 0,
    lineJoin: 0,
    width: 1,
  },
  type: "pdf-vector",
  width: 68,
  x: 72,
  y: 92.5,
});

const linkCaptionPage = (
  run: PdfTextObject,
  vectors: readonly PdfVectorObject[] = [underlineVector()]
): EditorPage => ({
  cropBox: { height: 792, width: 612, x: 0, y: 0 },
  height: 792,
  id: "page-1",
  objects: [],
  pdfAnnotationObjects: [linkForCaption()],
  pdfImageObjects: [],
  pdfTextObjects: [run],
  pdfVectorObjects: [...vectors],
  rotation: 0,
  skippedPdfAnnotationSubtypes: [],
  sourceIndex: 0,
  sourceRotate: 0,
  width: 612,
});

test("pdfLinkTextAppearance uses blue vector ink when zip fallback is default", () => {
  const page = linkCaptionPage(linkCaptionRun());
  const [caption] = page.pdfTextObjects;
  const appearance = caption ? pdfLinkTextAppearance(page, caption) : null;
  expect(appearance?.fillColor).toBe("#0000ff");
  expect(appearance?.underline.color).toBe("#0000ff");
});

test("pdfLinkTextAppearance keeps extracted blue fill", () => {
  const run = linkCaptionRun({ color: "#0000ff", originalColor: "#0000ff" });
  const page = linkCaptionPage(run);
  const appearance = pdfLinkTextAppearance(page, run);
  expect(appearance?.fillColor).toBe("#0000ff");
});

test("pdfLinkTextAppearance keeps black fill with blue underline", () => {
  const run = linkCaptionRun({ color: "#000000", originalColor: "#000000" });
  const page = linkCaptionPage(run);
  const appearance = pdfLinkTextAppearance(page, run);
  expect(appearance?.fillColor).toBe("#000000");
  expect(appearance?.underline.color).toBe("#0000ff");
});

test("pdfLinkTextAppearance prefers stored caption ink from sampling", () => {
  const run = linkCaptionRun({
    captionFill: "#0000ff",
    captionUnderline: {
      color: "#0000ff",
      offsetFromRunTop: 14,
      thickness: 1,
    },
    color: DEFAULT_PDF_TEXT_COLOR,
  });
  const page = linkCaptionPage(run, []);
  const appearance = pdfLinkTextAppearance(page, run);
  expect(appearance?.fillColor).toBe("#0000ff");
  expect(appearance?.underline.offsetFromRunTop).toBe(14);
});

test("captionUnderlineCssOffsetFromRunTop uses the stroke center", () => {
  expect(
    captionUnderlineCssOffsetFromRunTop({
      color: "#0000ff",
      offsetFromRunTop: 14,
      thickness: 2,
    })
  ).toBe(13);
});

test("dirtyPdfTextCoverBox pads left of the run and through the rule", () => {
  const runBox = { height: 18, width: 60, x: 72, y: 74 };
  const fontSize = 12;
  const underline = {
    color: "#0000ff",
    offsetFromRunTop: 17,
    thickness: 2,
  };
  const cover = dirtyPdfTextCoverBox(runBox, fontSize, underline);
  const leftPad = fontSize * PDF_TEXT_COVER_LEFT_EM;
  expect(cover.x).toBeCloseTo(runBox.x - leftPad);
  expect(cover.x + cover.width).toBeCloseTo(runBox.x + runBox.width);
  expect(cover.y).toBeLessThanOrEqual(runBox.y);
  expect(cover.y + cover.height).toBeGreaterThanOrEqual(
    runBox.y + underline.offsetFromRunTop + underline.thickness / 2
  );
  expect(cover.x).toBeLessThan(runBox.x);
  expect(cover.x + cover.width).toBeGreaterThan(runBox.x);
});

test("measurePdfTextCoverRects stays off the next line and the original width", () => {
  const fontSize = 40;
  const page: EditorPage = {
    cropBox: { height: 792, width: 612, x: 0, y: 0 },
    height: 792,
    id: "page-1",
    objects: [],
    pdfAnnotationObjects: [],
    pdfImageObjects: [],
    pdfTextObjects: [],
    pdfVectorObjects: [],
    rotation: 0,
    skippedPdfAnnotationSubtypes: [],
    sourceIndex: 0,
    sourceRotate: 0,
    width: 612,
  };
  const stacked = (
    id: string,
    userBaseline: number,
    width: number
  ): PdfTextObject => ({
    ...linkCaptionRun(),
    ascentRatio: 0.8,
    descentRatio: 0.35,
    fontSize,
    height: fontSize,
    id,
    originalText: "Prompt",
    text: "Prompts are longer than the original run",
    transform: [fontSize, 0, 0, fontSize, 72, userBaseline],
    width,
  });
  const upper = stacked("upper", 400, 100);
  const lower = stacked("lower", 360, 180);
  page.pdfTextObjects = [upper, lower];

  const lowerInk = pdfTextOriginalInkBox(lower, page);
  const covers = measurePdfTextCoverRects(upper, page, [lower]);
  const overlaps = (subject: (typeof covers)[number], other: typeof lowerInk) =>
    subject.x < other.x + other.width &&
    other.x < subject.x + subject.width &&
    subject.y < other.y + other.height &&
    other.y < subject.y + subject.height;

  expect(covers.length).toBeGreaterThan(0);
  const [initialCover] = covers;
  let widest = initialCover;
  for (const cover of covers) {
    expect(overlaps(cover, lowerInk)).toBe(false);
    if (widest && cover.width > widest.width) {
      widest = cover;
    }
  }
  const leftPad = fontSize * PDF_TEXT_COVER_LEFT_EM;
  expect(widest.width).toBeCloseTo(
    upper.width + leftPad + PDF_TEXT_COVER_BLEED * 2
  );
  expect(widest.x).toBeCloseTo(upper.x - leftPad - PDF_TEXT_COVER_BLEED);
});

test("pdfTextCssInkOffsetFromRunTop puts the CSS baseline on the matrix baseline", () => {
  const em = 20;
  const ascentRatio = 0.9;
  const transform = [em, 0, 0, em, 72, 200] as const;
  const crop = { height: 792, width: 612, x: 0, y: 0 };
  const runBox = textItemToDisplayedBox(
    transform,
    40,
    em,
    ascentRatio,
    crop,
    0
  );
  expect(
    pdfTextCssInkOffsetFromRunTop(
      { fontSize: em, height: runBox.height, transform },
      runBox,
      crop,
      0,
      ascentRatio
    )
  ).toBeCloseTo(0);
});

test("hitTestPdfFormField hits a widget and returns the field", () => {
  const field: PdfFormTextField = {
    align: "left",
    comb: false,
    fileSelect: false,
    id: "field-name",
    kind: "text",
    maxLength: null,
    multiline: false,
    name: "person.name",
    originalValue: "Gideon",
    password: false,
    readOnly: false,
    required: false,
    richText: false,
    value: "Gideon",
    widgets: [
      {
        exportValue: null,
        height: 20,
        id: "widget-1",
        pageId: "page-1",
        sourceAnnotId: "12R",
        width: 200,
        x: 72,
        y: 720,
      },
    ],
  };
  const document: EditorDocument = {
    form: {
      fields: [field],
      hasJavaScript: false,
      hasXfa: false,
      signatures: [],
    },
    pages: [],
  };
  expect(hitTestPdfFormField(document, "page-1", { x: 80, y: 725 })?.id).toBe(
    "field-name"
  );
  expect(
    hitTestPdfFormField(document, "page-1", { x: 10, y: 10 })
  ).toBeUndefined();
});

test("pdfTextCoverRects prefers the rects measured when editing began", () => {
  const run: PdfTextObject = {
    ...linkCaptionRun(),
    coverRects: [{ height: 12, width: 30, x: 70, y: 80 }],
  };
  const page: EditorPage = {
    cropBox: { height: 792, width: 612, x: 0, y: 0 },
    height: 792,
    id: "page-1",
    objects: [],
    pdfAnnotationObjects: [],
    pdfImageObjects: [],
    pdfTextObjects: [run],
    pdfVectorObjects: [],
    rotation: 0,
    skippedPdfAnnotationSubtypes: [],
    sourceIndex: 0,
    sourceRotate: 0,
    width: 612,
  };
  expect(pdfTextCoverRects(run, page)).toEqual(run.coverRects);
  const { coverRects: _saved, ...unmeasured } = run;
  expect(pdfTextCoverRects(unmeasured, page)).toEqual(
    measurePdfTextCoverRects(unmeasured, page, page.pdfTextObjects)
  );
});

afterEach(() => {
  editorStore.clearDocument();
});

test("a longer link label keeps the cover measured from the original run", () => {
  const run = linkCaptionRun({ text: "Old label" });
  const page = linkCaptionPage(run, []);
  const original = measurePdfTextCoverRects(run, page, page.pdfTextObjects);
  editorStore.resetDocument([page], "demo.pdf");
  editorStore.applyPdfTextMeasurement(page.id, run.id, {
    coverRects: original,
    reusableFontGlyphs: "",
  });

  editorStore.commitPdfLinkLabel("A much longer replacement label", null, {
    linkId: "link-1",
    pageId: page.id,
  });

  const [committedPage] = editorStore.getState().document.pages;
  const committed = committedPage?.pdfTextObjects[0];
  expect(committed?.text).toBe("A much longer replacement label");
  expect(committed?.width).toBeGreaterThan(run.width);
  expect(
    committed && committedPage && pdfTextCoverRects(committed, committedPage)
  ).toEqual(original);
  for (const rect of original) {
    expect(rect.x + rect.width).toBeLessThanOrEqual(
      run.x + run.width + PDF_TEXT_COVER_BLEED
    );
  }
});

const resumeLinkLine = (): EditorPage => {
  const run = (
    id: string,
    caption: string,
    box: Pick<PdfTextObject, "height" | "width" | "x" | "y">
  ): PdfTextObject =>
    linkCaptionRun({ ...box, id, originalText: caption, text: caption });
  return {
    ...linkCaptionPage(linkCaptionRun(), []),
    pdfAnnotationObjects: [
      {
        ...linkForCaption(),
        quads: [{ height: 12.649, width: 126.608, x: 149.369, y: 648.807 }],
      },
    ],
    pdfTextObjects: [
      run("company", "Bozoma Labs", {
        height: 12.708,
        width: 71.464,
        x: 72,
        y: 649.167,
      }),
      run("pipe", "|", {
        height: 12.708,
        width: 2.857,
        x: 146.514,
        y: 649.167,
      }),
      run("space", " ", { height: 0, width: 4.069, x: 149.371, y: 659.125 }),
      run("url", "https://bozomalabs.com", {
        height: 12.708,
        width: 116.09,
        x: 152.423,
        y: 649.167,
      }),
    ],
  };
};

test("a link label leaves out a separator that grazes the link rect", () => {
  const page = resumeLinkLine();
  const [link] = page.pdfAnnotationObjects;
  if (link?.type !== "pdf-link") {
    throw new Error("missing link");
  }
  const { label, runs } = pdfLinkEditableLabel(page, link);
  expect(label).toBe("https://bozomalabs.com");
  expect(runs.map((run) => run.id)).toEqual(["url"]);
});

test("the primary cover hides the original underline across the link", () => {
  const page = resumeLinkLine();
  const [link] = page.pdfAnnotationObjects;
  const primary = page.pdfTextObjects.find((run) => run.id === "url");
  if (link?.type !== "pdf-link" || !primary) {
    throw new Error("missing link line");
  }
  const underline = { color: "#0000ff", offsetFromRunTop: 11, thickness: 1 };
  const covers = pdfLinkPrimaryCoverRects(
    page,
    link,
    [primary],
    { ...primary, coverRects: [] },
    underline
  );
  expect(covers).toHaveLength(1);
  const [band] = covers;
  expect(band?.x).toBeLessThanOrEqual(149.369);
  expect((band?.x ?? 0) + (band?.width ?? 0)).toBeGreaterThanOrEqual(
    149.369 + 126.608
  );
  expect(band?.y).toBeLessThan(primary.y + 11 - 0.5);
  expect((band?.y ?? 0) + (band?.height ?? 0)).toBeGreaterThan(
    primary.y + 11 + 0.5
  );
});

const checkboxWidget = (exportValue: string) => ({
  exportValue,
  height: 16,
  id: exportValue,
  pageId: "page-1",
  sourceAnnotId: "1R",
  width: 16,
  x: 0,
  y: 0,
});

test("clicking a checkbox widget picks its on-state, or clears it when on", () => {
  const [boxA, boxB] = [checkboxWidget("A"), checkboxWidget("B")];
  const field = {
    id: "pick",
    kind: "checkbox" as const,
    name: "pick",
    originalValue: "B",
    readOnly: false,
    required: false,
    value: "B",
    widgets: [boxA, boxB],
  };
  expect(nextCheckboxValue(field, boxA)).toBe("A");
  expect(nextCheckboxValue(field, boxB)).toBeNull();
  expect(nextCheckboxValue({ ...field, value: null }, boxB)).toBe("B");
});

const formWidget = (id: string, pageId: string) => ({
  exportValue: null,
  height: 20,
  id,
  pageId,
  sourceAnnotId: `${id}R`,
  width: 200,
  x: 72,
  y: 720,
});

const formTextField = (
  id: string,
  widgets: ReturnType<typeof formWidget>[],
  readOnly = false
) => ({
  align: "left" as const,
  comb: false,
  fileSelect: false,
  id,
  kind: "text" as const,
  maxLength: null,
  multiline: false,
  name: id,
  originalValue: "",
  password: false,
  readOnly,
  required: false,
  richText: false,
  value: "",
  widgets,
});

test("Tab order runs through the whole document and skips fields with nothing to fill", () => {
  const form = {
    fields: [
      formTextField("first", [formWidget("w-first", "page-1")]),
      formTextField("locked", [formWidget("w-locked", "page-1")], true),
      {
        id: "sign",
        kind: "signature" as const,
        name: "sign",
        readOnly: true,
        required: false,
        widgets: [formWidget("w-sign", "page-1")],
      },
      formTextField("shared", [
        formWidget("w-shared-2", "page-2"),
        formWidget("w-shared-1", "page-1"),
      ]),
    ],
    hasJavaScript: false,
    hasXfa: false,
    signatures: [],
  };
  const pageOrder = ["page-1", "page-2"];
  const after = (id: string) =>
    adjacentPdfFormWidget(form, pageOrder, id, 1)?.widget.id ?? null;
  const before = (id: string) =>
    adjacentPdfFormWidget(form, pageOrder, id, -1)?.widget.id ?? null;

  expect(after("w-first")).toBe("w-shared-1");
  expect(after("w-shared-1")).toBe("w-shared-2");
  expect(after("w-shared-2")).toBeNull();
  expect(before("w-shared-2")).toBe("w-shared-1");
  expect(before("w-first")).toBeNull();
  // From a read-only field that was clicked, Tab still moves on.
  expect(after("w-locked")).toBe("w-shared-1");
  // Page order follows the document, not the form.
  expect(
    adjacentPdfFormWidget(form, ["page-2", "page-1"], "w-shared-2", 1)?.widget
      .id
  ).toBe("w-first");
});
