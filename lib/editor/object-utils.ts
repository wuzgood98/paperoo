import { objectCenter, rotatePoint } from "@/lib/editor/coordinates";
import { createId } from "@/lib/editor/ids";
import {
  DEFAULT_DRAW_STYLE,
  DEFAULT_HIGHLIGHT_COLOR,
  DEFAULT_OBJECT_OPACITY,
  DEFAULT_SHAPE_STYLE,
  DEFAULT_TEXT_STYLE,
  EDITOR_OBJECT_SOURCE,
  HIGHLIGHT_OPACITY,
} from "@/lib/editor/types";
import type {
  DrawingObject,
  EditorObject,
  EditorPage,
  HighlightObject,
  ImageMimeType,
  ImageObject,
  PdfImageObject,
  PdfTextObject,
  Point,
  Rect,
  ShapeKind,
  ShapeObject,
  SignatureObject,
  Size,
  TextObject,
} from "@/lib/editor/types";

export const editorPageOrder = (
  pages: readonly { sourceIndex: number }[]
): number[] => pages.map((page) => page.sourceIndex);

export const findPage = (
  pages: readonly EditorPage[],
  pageId: string | null
): EditorPage | undefined => pages.find((page) => page.id === pageId);

export const findObject = (
  page: EditorPage | undefined,
  objectId: string
): EditorObject | undefined =>
  page?.objects.find((object) => object.id === objectId);

export const findPdfText = (
  page: EditorPage | undefined,
  objectId: string | null
): PdfTextObject | undefined =>
  page?.pdfTextObjects.find((object) => object.id === objectId);

export const findPdfImage = (
  page: EditorPage | undefined,
  objectId: string | null
): PdfImageObject | undefined =>
  page?.pdfImageObjects.find((object) => object.id === objectId);

export const isPdfTextDirty = (object: PdfTextObject): boolean =>
  object.text !== object.originalText ||
  object.fontFamily !== object.originalFontFamily ||
  object.fontSize !== object.originalFontSize;

export const isPdfImageDirty = (object: PdfImageObject): boolean =>
  object.deleted ||
  object.replacementAssetId !== null ||
  object.x !== object.originalX ||
  object.y !== object.originalY ||
  object.width !== object.originalWidth ||
  object.height !== object.originalHeight ||
  object.rotation !== object.originalRotation;

export const pdfImageOriginalBox = (
  object: PdfImageObject
): Rect & { rotation: number } => ({
  height: object.originalHeight,
  rotation: object.originalRotation,
  width: object.originalWidth,
  x: object.originalX,
  y: object.originalY,
});

export const pointInRotatedRect = (
  point: Point,
  box: Rect & { rotation: number }
): boolean => {
  const local = rotatePoint(point, objectCenter(box), -box.rotation);
  return (
    local.x >= box.x &&
    local.x <= box.x + box.width &&
    local.y >= box.y &&
    local.y <= box.y + box.height
  );
};

export const fittedPdfTextWidth = (
  originalWidth: number,
  measuredWidth: number
): number => Math.max(originalWidth, measuredWidth);

export const fittedPdfTextBox = (
  object: Pick<PdfTextObject, "dir" | "height" | "width" | "x" | "y">,
  measuredWidth: number
): Rect => {
  const width = fittedPdfTextWidth(object.width, measuredWidth);
  return {
    height: object.height,
    width,
    x: object.dir === "rtl" ? object.x - (width - object.width) : object.x,
    y: object.y,
  };
};

export const hitTestPdfText = (
  objects: readonly PdfTextObject[],
  point: Point
): PdfTextObject | undefined => {
  for (const object of objects.toReversed()) {
    if (
      object.width > 0 &&
      object.height > 0 &&
      point.x >= object.x &&
      point.x <= object.x + object.width &&
      point.y >= object.y &&
      point.y <= object.y + object.height
    ) {
      return object;
    }
  }
  return undefined;
};

export const hitTestPdfImage = (
  objects: readonly PdfImageObject[],
  point: Point
): PdfImageObject | undefined => {
  for (const object of objects.toReversed()) {
    if (
      !object.deleted &&
      object.width > 0 &&
      object.height > 0 &&
      pointInRotatedRect(point, object)
    ) {
      return object;
    }
  }
  return undefined;
};

export const mapPagePdfImages = (
  pages: readonly EditorPage[],
  pageId: string,
  mapper: (objects: PdfImageObject[]) => PdfImageObject[]
): EditorPage[] =>
  pages.map((page) =>
    page.id === pageId
      ? { ...page, pdfImageObjects: mapper(page.pdfImageObjects) }
      : page
  );

export const mapPageObjects = (
  pages: readonly EditorPage[],
  pageId: string,
  mapper: (objects: EditorObject[]) => EditorObject[]
): EditorPage[] =>
  pages.map((page) =>
    page.id === pageId ? { ...page, objects: mapper(page.objects) } : page
  );

export const updateObject = (
  pages: readonly EditorPage[],
  pageId: string,
  objectId: string,
  updater: (object: EditorObject) => EditorObject
): EditorPage[] =>
  mapPageObjects(pages, pageId, (objects) =>
    objects.map((object) => (object.id === objectId ? updater(object) : object))
  );

export const removeObjects = (
  pages: readonly EditorPage[],
  pageId: string,
  objectIds: readonly string[]
): EditorPage[] => {
  const idSet = new Set(objectIds);
  return mapPageObjects(pages, pageId, (objects) =>
    objects.filter((object) => !idSet.has(object.id))
  );
};

export const boundsFromPoints = (points: readonly Point[]): Rect => {
  if (points.length === 0) {
    return { height: 1, width: 1, x: 0, y: 0 };
  }

  let minX = points[0]?.x ?? 0;
  let minY = points[0]?.y ?? 0;
  let maxX = minX;
  let maxY = minY;

  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  return {
    height: Math.max(1, maxY - minY),
    width: Math.max(1, maxX - minX),
    x: minX,
    y: minY,
  };
};

export const normalizePointsToBox = (
  points: readonly Point[],
  box: { x: number; y: number }
): Point[] =>
  points.map((point) => ({ x: point.x - box.x, y: point.y - box.y }));

export const createTextObject = (
  point: Point,
  overrides: Partial<TextObject> = {}
): TextObject => ({
  content: "Text",
  height: 28,
  id: createId(),
  opacity: DEFAULT_OBJECT_OPACITY,
  rotation: 0,
  source: EDITOR_OBJECT_SOURCE,
  type: "text",
  width: 180,
  x: point.x,
  y: point.y,
  ...DEFAULT_TEXT_STYLE,
  ...overrides,
});

export const createImageObject = (
  point: Point,
  size: Size,
  assetId: string,
  mimeType: ImageMimeType
): ImageObject => ({
  assetId,
  height: size.height,
  id: createId(),
  mimeType,
  opacity: DEFAULT_OBJECT_OPACITY,
  rotation: 0,
  source: EDITOR_OBJECT_SOURCE,
  type: "image",
  width: size.width,
  x: point.x,
  y: point.y,
});

export const createDrawingObject = (
  points: Point[],
  stroke = DEFAULT_DRAW_STYLE.stroke,
  strokeWidth = DEFAULT_DRAW_STYLE.strokeWidth
): DrawingObject => {
  const box = boundsFromPoints(points);
  return {
    id: createId(),
    opacity: DEFAULT_OBJECT_OPACITY,
    points: normalizePointsToBox(points, box),
    rotation: 0,
    source: EDITOR_OBJECT_SOURCE,
    stroke,
    strokeWidth,
    type: "drawing",
    ...box,
  };
};

export const SIGNATURE_PLACE_SIZE = { height: 48, width: 160 } as const;
const PLACED_SIGNATURE_STROKE_WIDTH = 2;
const STROKE_HALF_WIDTH = PLACED_SIGNATURE_STROKE_WIDTH / 2;

export const scaleSignaturePoints = (
  points: readonly Point[],
  size: Size
): Point[] => {
  const bounds = boundsFromPoints(points);
  const availableWidth = Math.max(1, size.width - STROKE_HALF_WIDTH * 2);
  const availableHeight = Math.max(1, size.height - STROKE_HALF_WIDTH * 2);
  const scale = Math.min(
    availableWidth / bounds.width,
    availableHeight / bounds.height
  );
  const drawnWidth = bounds.width * scale;
  const drawnHeight = bounds.height * scale;
  const offsetX = STROKE_HALF_WIDTH + (availableWidth - drawnWidth) / 2;
  const offsetY = STROKE_HALF_WIDTH + (availableHeight - drawnHeight) / 2;

  return points.map((item) => ({
    x: (item.x - bounds.x) * scale + offsetX,
    y: (item.y - bounds.y) * scale + offsetY,
  }));
};

export const createSignatureObject = (
  points: Point[],
  box: Rect
): SignatureObject => ({
  id: createId(),
  opacity: DEFAULT_OBJECT_OPACITY,
  points,
  rotation: 0,
  source: EDITOR_OBJECT_SOURCE,
  stroke: "#111827",
  strokeWidth: 2,
  type: "signature",
  ...box,
});

export const createHighlightObject = (
  rect: Rect,
  color = DEFAULT_HIGHLIGHT_COLOR
): HighlightObject => ({
  color,
  id: createId(),
  opacity: HIGHLIGHT_OPACITY,
  rotation: 0,
  source: EDITOR_OBJECT_SOURCE,
  type: "highlight",
  ...rect,
});

export const createShapeObject = (
  rect: Rect,
  shape: ShapeKind = DEFAULT_SHAPE_STYLE.shape
): ShapeObject => ({
  fill: DEFAULT_SHAPE_STYLE.fill,
  id: createId(),
  opacity: DEFAULT_OBJECT_OPACITY,
  rotation: 0,
  shape,
  source: EDITOR_OBJECT_SOURCE,
  stroke: DEFAULT_SHAPE_STYLE.stroke,
  strokeWidth: DEFAULT_SHAPE_STYLE.strokeWidth,
  type: "shape",
  ...rect,
});

export const normalizedRect = (start: Point, end: Point): Rect => {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  return {
    height: Math.max(1, Math.abs(end.y - start.y)),
    width: Math.max(1, Math.abs(end.x - start.x)),
    x,
    y,
  };
};

export const scaleObjectToBox = (
  object: EditorObject,
  nextBox: Rect
): EditorObject => {
  const scaleX = object.width === 0 ? 1 : nextBox.width / object.width;
  const scaleY = object.height === 0 ? 1 : nextBox.height / object.height;

  if (object.type === "drawing" || object.type === "signature") {
    return {
      ...object,
      ...nextBox,
      points: object.points.map((point) => ({
        x: point.x * scaleX,
        y: point.y * scaleY,
      })),
    };
  }

  if (object.type === "text") {
    return {
      ...object,
      ...nextBox,
      fontSize: Math.max(1, object.fontSize * scaleY),
    };
  }

  return { ...object, ...nextBox };
};
