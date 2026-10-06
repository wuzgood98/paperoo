import {
  objectCenter,
  pdfTextBaselineDisplayed,
  rotatePoint,
  userPointToDisplayed,
} from "@/lib/editor/coordinates";
import { createId } from "@/lib/editor/ids";
import {
  DEFAULT_DRAW_STYLE,
  DEFAULT_HIGHLIGHT_COLOR,
  DEFAULT_OBJECT_OPACITY,
  DEFAULT_PDF_TEXT_COLOR,
  DEFAULT_SHAPE_STYLE,
  DEFAULT_TEXT_STYLE,
  EDITOR_OBJECT_SOURCE,
  HIGHLIGHT_OPACITY,
} from "@/lib/editor/types";
import type {
  DrawingObject,
  CropBox,
  EditorObject,
  EditorPage,
  HighlightObject,
  ImageMimeType,
  ImageObject,
  PdfAnnotationObject,
  PdfImageObject,
  PdfLinkAction,
  PdfLinkAnnotation,
  PageRotation,
  PdfMarkupAnnotation,
  PdfTextCaptionUnderline,
  PdfTextObject,
  PdfVectorObject,
  Point,
  Rect,
  ShapeKind,
  ShapeObject,
  SignatureObject,
  Size,
  TextObject,
} from "@/lib/editor/types";
import { canvasTextWidth } from "@/lib/fonts/measure-text";

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

export const findPdfVector = (
  page: EditorPage | undefined,
  objectId: string | null
): PdfVectorObject | undefined =>
  page?.pdfVectorObjects.find((object) => object.id === objectId);

export const findPdfAnnotation = (
  page: EditorPage | undefined,
  objectId: string | null
): PdfAnnotationObject | undefined =>
  page?.pdfAnnotationObjects.find((object) => object.id === objectId);

const pointInRect = (point: Point, rect: Rect): boolean =>
  point.x >= rect.x &&
  point.x <= rect.x + rect.width &&
  point.y >= rect.y &&
  point.y <= rect.y + rect.height;

const rectsOverlap = (left: Rect, right: Rect): boolean =>
  left.x < right.x + right.width &&
  left.x + left.width > right.x &&
  left.y < right.y + right.height &&
  left.y + left.height > right.y;

export const pdfLinkActionsEqual = (
  left: PdfLinkAction,
  right: PdfLinkAction
): boolean => {
  if (left.kind !== right.kind) {
    return false;
  }
  switch (left.kind) {
    case "url": {
      return right.kind === "url" && left.url === right.url;
    }
    case "named": {
      return right.kind === "named" && left.name === right.name;
    }
    case "goto": {
      return (
        right.kind === "goto" &&
        JSON.stringify(left.dest) === JSON.stringify(right.dest)
      );
    }
    case "none": {
      return true;
    }
    default: {
      return false;
    }
  }
};

export const pdfLinkOverlappingTextRuns = (
  link: PdfLinkAnnotation,
  textRuns: readonly PdfTextObject[]
): PdfTextObject[] =>
  textRuns
    .filter((run) => {
      const runBox: Rect = {
        height: run.height,
        width: run.width,
        x: run.x,
        y: run.y,
      };
      return link.quads.some((quad) => rectsOverlap(runBox, quad));
    })
    .toSorted((left, right) => left.y - right.y || left.x - right.x);

export interface PdfLinkEditableLabel {
  editable: boolean;
  label: string;
  runs: PdfTextObject[];
}

export const pdfLinkEditableLabel = (
  page: EditorPage,
  link: PdfLinkAnnotation
): PdfLinkEditableLabel => {
  const runs = pdfLinkOverlappingTextRuns(link, page.pdfTextObjects);
  if (runs.length === 0) {
    return { editable: false, label: link.label, runs: [] };
  }
  return {
    editable: true,
    label: runs.map((run) => run.text).join(""),
    runs,
  };
};

export const hitTestPdfAnnotation = (
  objects: readonly PdfAnnotationObject[],
  point: Point
): PdfAnnotationObject | undefined => {
  for (const object of objects.toReversed()) {
    if (object.deleted) {
      continue;
    }
    if (
      object.type === "pdf-highlight" ||
      object.type === "pdf-underline" ||
      object.type === "pdf-squiggly" ||
      object.type === "pdf-strikeout" ||
      object.type === "pdf-link"
    ) {
      if (object.quads.some((quad) => pointInRect(point, quad))) {
        return object;
      }
      continue;
    }
    if (pointInRect(point, object)) {
      return object;
    }
  }
  return undefined;
};

export const isPdfMarkupAnnotation = (
  object: PdfAnnotationObject
): object is PdfMarkupAnnotation =>
  object.type === "pdf-highlight" ||
  object.type === "pdf-underline" ||
  object.type === "pdf-squiggly" ||
  object.type === "pdf-strikeout";

export const isPdfAnnotationDirty = (object: PdfAnnotationObject): boolean => {
  if (object.deleted) {
    return true;
  }
  if (
    object.x !== object.originalX ||
    object.y !== object.originalY ||
    object.width !== object.originalWidth ||
    object.height !== object.originalHeight ||
    object.rotation !== object.originalRotation
  ) {
    return true;
  }
  switch (object.type) {
    case "pdf-highlight": {
      return (
        object.color !== object.originalColor ||
        object.opacity !== object.originalOpacity
      );
    }
    case "pdf-underline":
    case "pdf-squiggly":
    case "pdf-strikeout": {
      return object.color !== object.originalColor;
    }
    case "pdf-link": {
      return (
        !pdfLinkActionsEqual(object.action, object.originalAction) ||
        object.label !== object.originalLabel
      );
    }
    case "pdf-stamp": {
      return false;
    }
    case "pdf-free-text": {
      return (
        object.contents !== object.originalContents ||
        object.fontSize !== object.originalFontSize ||
        object.fontColor !== object.originalColor
      );
    }
    case "pdf-text-note": {
      return object.contents !== object.originalContents;
    }
    default: {
      return false;
    }
  }
};

export const pageHasDirtyPdfAnnotations = (page: EditorPage): boolean =>
  page.pdfAnnotationObjects.some(isPdfAnnotationDirty);

export const mapPagePdfAnnotations = (
  pages: readonly EditorPage[],
  pageId: string,
  mapper: (objects: PdfAnnotationObject[]) => PdfAnnotationObject[]
): EditorPage[] =>
  pages.map((page) =>
    page.id === pageId
      ? { ...page, pdfAnnotationObjects: mapper(page.pdfAnnotationObjects) }
      : page
  );

export const pdfAnnotationWithGestureBox = (
  current: PdfAnnotationObject,
  gesture: Pick<
    PdfAnnotationObject,
    "height" | "rotation" | "width" | "x" | "y"
  >
): PdfAnnotationObject => ({
  ...current,
  height: gesture.height,
  rotation: gesture.rotation,
  width: gesture.width,
  x: gesture.x,
  y: gesture.y,
});

export const shouldPaintPdfAnnotationPreview = (
  object: PdfAnnotationObject
): boolean => isPdfAnnotationDirty(object) && !object.deleted;

export const isPdfTextDirty = (object: PdfTextObject): boolean =>
  object.text !== object.originalText ||
  object.fontFamily !== object.originalFontFamily ||
  object.fontSize !== object.originalFontSize ||
  object.color !== object.originalColor ||
  object.strokeColor !== object.originalStrokeColor ||
  object.strokeWidth !== object.originalStrokeWidth ||
  object.textRenderingMode !== object.originalTextRenderingMode;

/** PDF text rendering mode low bits: fill=0, stroke=1, fill+stroke=2. */
export const pdfTextNeedsFill = (textRenderingMode: number): boolean => {
  const mode = ((textRenderingMode % 4) + 4) % 4;
  return mode === 0 || mode === 2;
};

export const pdfTextNeedsStroke = (textRenderingMode: number): boolean => {
  const mode = ((textRenderingMode % 4) + 4) % 4;
  return mode === 1 || mode === 2;
};

export const isPdfImageDirty = (object: PdfImageObject): boolean =>
  object.deleted ||
  object.replacementAssetId !== null ||
  object.x !== object.originalX ||
  object.y !== object.originalY ||
  object.width !== object.originalWidth ||
  object.height !== object.originalHeight ||
  object.rotation !== object.originalRotation;

const sameFill = (
  a: PdfVectorObject["fill"],
  b: PdfVectorObject["fill"]
): boolean => {
  if (a === null && b === null) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  return a.color === b.color;
};

const sameStroke = (
  a: PdfVectorObject["stroke"],
  b: PdfVectorObject["stroke"]
): boolean => {
  if (a === null && b === null) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  return (
    a.color === b.color &&
    a.width === b.width &&
    a.lineCap === b.lineCap &&
    a.lineJoin === b.lineJoin
  );
};

export const isPdfVectorDirty = (object: PdfVectorObject): boolean =>
  object.deleted ||
  object.x !== object.originalX ||
  object.y !== object.originalY ||
  object.width !== object.originalWidth ||
  object.height !== object.originalHeight ||
  object.rotation !== object.originalRotation ||
  !sameFill(object.fill, object.originalFill) ||
  !sameStroke(object.stroke, object.originalStroke);

export const pdfImageAssetId = (object: PdfImageObject): string | null =>
  object.replacementAssetId ?? object.previewAssetId;

export const shouldPaintPdfImageCover = (
  object: PdfImageObject,
  transformingId: string | null
): boolean =>
  object.deleted ||
  (pdfImageAssetId(object) !== null &&
    (isPdfImageDirty(object) || object.id === transformingId));

export const shouldPaintPdfImagePreview = (
  object: PdfImageObject,
  transformingId: string | null
): boolean =>
  !object.deleted &&
  pdfImageAssetId(object) !== null &&
  (isPdfImageDirty(object) || object.id === transformingId);

export const pdfImageOriginalBox = (
  object: PdfImageObject
): Rect & { rotation: number } => ({
  height: object.originalHeight,
  rotation: object.originalRotation,
  width: object.originalWidth,
  x: object.originalX,
  y: object.originalY,
});

/** Outset for white covers so scan-conversion / AA fringes of the original Do do not show. */
export const PDF_IMAGE_COVER_BLEED = 1;

export const pdfImageCoverBox = (
  object: PdfImageObject
): Rect & { rotation: number } => {
  const box = pdfImageOriginalBox(object);
  return {
    height: box.height + PDF_IMAGE_COVER_BLEED * 2,
    rotation: box.rotation,
    width: box.width + PDF_IMAGE_COVER_BLEED * 2,
    x: box.x - PDF_IMAGE_COVER_BLEED,
    y: box.y - PDF_IMAGE_COVER_BLEED,
  };
};

export const PDF_VECTOR_COVER_BLEED = 1;

/** Half stroke width (page space), floored so hairlines still paint in preview. */
export const pdfVectorStrokePad = (strokeWidth?: number | null): number => {
  if (strokeWidth === null || strokeWidth === undefined) {
    return 0;
  }
  return Math.max(strokeWidth / 2, 0.5);
};

export const expandRect = (box: Rect, pad: number): Rect => ({
  height: box.height + pad * 2,
  width: box.width + pad * 2,
  x: box.x - pad,
  y: box.y - pad,
});

export const pdfVectorOriginalBox = (
  object: PdfVectorObject
): Rect & { rotation: number } => ({
  height: object.originalHeight,
  rotation: object.originalRotation,
  width: object.originalWidth,
  x: object.originalX,
  y: object.originalY,
});

export const pdfVectorCoverBox = (
  object: PdfVectorObject
): Rect & { rotation: number } => {
  const box = pdfVectorOriginalBox(object);
  const pad =
    PDF_VECTOR_COVER_BLEED + pdfVectorStrokePad(object.originalStroke?.width);
  return {
    ...expandRect(box, pad),
    rotation: box.rotation,
  };
};

/** Original placement used to map cover path commands (scale 1). */
export const pdfVectorCoverGeometry = (
  object: PdfVectorObject
): Pick<
  PdfVectorObject,
  | "height"
  | "originalHeight"
  | "originalWidth"
  | "originalX"
  | "originalY"
  | "rotation"
  | "width"
  | "x"
  | "y"
> => ({
  height: object.originalHeight,
  originalHeight: object.originalHeight,
  originalWidth: object.originalWidth,
  originalX: object.originalX,
  originalY: object.originalY,
  rotation: object.originalRotation,
  width: object.originalWidth,
  x: object.originalX,
  y: object.originalY,
});

/**
 * White path paint that hides original ink without an AABB rect.
 * Stroke is slightly thicker than the original for AA fringe coverage.
 */
export interface PdfVectorCoverPathStyle {
  fill: string | null;
  lineCap: number;
  lineJoin: number;
  stroke: string | null;
  strokeWidth: number;
}

export const pdfVectorCoverPathStyle = (
  object: PdfVectorObject
): PdfVectorCoverPathStyle => {
  const originalWidth = object.originalStroke?.width;
  return {
    fill: object.originalFill ? "#ffffff" : null,
    lineCap: object.originalStroke?.lineCap ?? 0,
    lineJoin: object.originalStroke?.lineJoin ?? 0,
    stroke: object.originalStroke ? "#ffffff" : null,
    strokeWidth:
      originalWidth === undefined || originalWidth === null
        ? 0
        : originalWidth + PDF_VECTOR_COVER_BLEED * 2,
  };
};

/** Current geometry expanded so SVG stroke ink stays inside the preview wrapper. */
export const pdfVectorPreviewBox = (
  object: PdfVectorObject
): Rect & { rotation: number } => {
  const pad = pdfVectorStrokePad(object.stroke?.width);
  return {
    ...expandRect(object, pad),
    rotation: object.rotation,
  };
};

export const shouldPaintPdfVectorCover = (
  object: PdfVectorObject,
  transformingId: string | null
): boolean =>
  object.deleted || isPdfVectorDirty(object) || object.id === transformingId;

export const shouldPaintPdfVectorPreview = (
  object: PdfVectorObject,
  transformingId: string | null
): boolean =>
  !object.deleted && (isPdfVectorDirty(object) || object.id === transformingId);

export const pdfVectorWithGestureBox = (
  current: PdfVectorObject,
  gesture: Pick<PdfVectorObject, "height" | "rotation" | "width" | "x" | "y">
): PdfVectorObject => ({
  ...current,
  height: gesture.height,
  rotation: gesture.rotation,
  width: gesture.width,
  x: gesture.x,
  y: gesture.y,
});

export const pdfImageWithGestureBox = (
  current: PdfImageObject,
  gesture: Pick<PdfImageObject, "height" | "rotation" | "width" | "x" | "y">
): PdfImageObject => ({
  ...current,
  height: gesture.height,
  rotation: gesture.rotation,
  width: gesture.width,
  x: gesture.x,
  y: gesture.y,
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

/** Overlay box for PDF text: source geometry when clean, Liberation-fitted when dirty. */
export const pdfTextOverlayBox = (
  object: PdfTextObject,
  measuredWidth: number
): Rect =>
  isPdfTextDirty(object)
    ? fittedPdfTextBox(object, measuredWidth)
    : {
        height: object.height,
        width: object.width,
        x: object.x,
        y: object.y,
      };

export const measurePdfTextWidth = (
  object: PdfTextObject,
  text: string = object.text
): number =>
  canvasTextWidth(text, {
    fontFamily: object.fontFamily ?? "sans",
    fontSize: object.fontSize ?? object.height,
    fontWeight: object.fontWeight ?? 400,
    italic: object.italic === true,
  });

export const pdfLinkBoxAfterLabel = (
  _link: PdfLinkAnnotation,
  primary: PdfTextObject,
  label: string
): Pick<PdfLinkAnnotation, "height" | "quads" | "width" | "x" | "y"> => {
  const measured = measurePdfTextWidth(primary, label);
  const fitted = fittedPdfTextBox(primary, measured);
  const quad: Rect = {
    height: fitted.height,
    width: fitted.width,
    x: fitted.x,
    y: fitted.y,
  };
  return {
    height: fitted.height,
    quads: [quad],
    width: fitted.width,
    x: fitted.x,
    y: fitted.y,
  };
};

/** Left outset in ems so original ink left of the text origin stays covered. */
export const PDF_TEXT_COVER_LEFT_EM = 0.15;

export const captionUnderlineCssOffsetFromRunTop = (
  underline: PdfTextCaptionUnderline
): number => underline.offsetFromRunTop - underline.thickness / 2;

export const dirtyPdfTextCoverBox = (
  runBox: Rect,
  fontSize: number,
  underline?: PdfTextCaptionUnderline | null
): Rect => {
  const leftPad = fontSize * PDF_TEXT_COVER_LEFT_EM;
  let top = runBox.y;
  let bottom = runBox.y + runBox.height;
  if (underline) {
    const half = underline.thickness / 2;
    const center = runBox.y + underline.offsetFromRunTop;
    top = Math.min(top, center - half);
    bottom = Math.max(bottom, center + half);
  }
  return {
    height: bottom - top,
    width: runBox.width + leftPad,
    x: runBox.x - leftPad,
    y: top,
  };
};

export const pdfTextCssInkOffsetFromRunTop = (
  object: Pick<PdfTextObject, "fontSize" | "height" | "transform">,
  runBox: Rect,
  crop: CropBox,
  sourceRotate: PageRotation,
  cssAscentRatio: number
): number => {
  const baseline = pdfTextBaselineDisplayed(
    object.transform,
    crop,
    sourceRotate
  );
  const fontSize = object.fontSize ?? object.height;
  return baseline.y - runBox.y - fontSize * cssAscentRatio;
};

const horizontalOverlapWidth = (left: Rect, right: Rect): number =>
  Math.max(
    0,
    Math.min(left.x + left.width, right.x + right.width) -
      Math.max(left.x, right.x)
  );

const isUnderlineBand = (runBox: Rect, decorBox: Rect): boolean => {
  const bandTop = runBox.y + runBox.height * 0.7;
  const bandBottom =
    runBox.y + runBox.height + Math.max(4, runBox.height * 0.35);
  const decorMid = decorBox.y + decorBox.height / 2;
  return decorMid >= bandTop && decorMid <= bandBottom;
};

const decorationColorFromVector = (vector: PdfVectorObject): string | null =>
  vector.stroke?.color ?? vector.fill?.color ?? null;

const isHorizontalUnderlineVector = (vector: PdfVectorObject): boolean => {
  if (vector.deleted || vector.kind !== "line") {
    return false;
  }
  if (!vector.stroke) {
    return false;
  }
  return vector.width >= Math.max(vector.height * 3, 4);
};

const isThinUnderlineRect = (vector: PdfVectorObject): boolean => {
  if (vector.deleted || vector.kind !== "rect") {
    return false;
  }
  if (!decorationColorFromVector(vector)) {
    return false;
  }
  return vector.height <= Math.max(3, vector.width > 0 ? 6 : 3);
};

export type PdfLinkCaptionUnderline = PdfTextCaptionUnderline;

export interface PdfLinkTextAppearance {
  fillColor: string;
  underline: PdfTextCaptionUnderline;
}

interface Match {
  best: { score: number; underline: PdfLinkCaptionUnderline } | null;
}

const defaultCaptionUnderline = (
  runBox: Rect,
  color: string
): PdfLinkCaptionUnderline => ({
  color,
  offsetFromRunTop: runBox.height * 0.92,
  thickness: 1,
});

const findCaptionUnderlineDecoration = (
  page: EditorPage,
  runBox: Rect
): PdfLinkCaptionUnderline | null => {
  const match: Match = { best: null };

  const consider = (decorBox: Rect, color: string, thickness: number): void => {
    if (!isUnderlineBand(runBox, decorBox)) {
      return;
    }
    const score = horizontalOverlapWidth(runBox, decorBox);
    if (score <= 0) {
      return;
    }
    const offsetFromRunTop = decorBox.y + decorBox.height / 2 - runBox.y;
    const entry = {
      score,
      underline: {
        color,
        offsetFromRunTop,
        thickness: Math.max(0.5, thickness),
      },
    };
    if (!match.best || entry.score > match.best.score) {
      match.best = entry;
    }
  };

  for (const vector of page.pdfVectorObjects) {
    const color = decorationColorFromVector(vector);
    if (!color) {
      continue;
    }
    const box: Rect = {
      height: vector.height,
      width: vector.width,
      x: vector.x,
      y: vector.y,
    };
    if (isHorizontalUnderlineVector(vector)) {
      consider(box, color, vector.stroke?.width ?? 1);
      continue;
    }
    if (isThinUnderlineRect(vector)) {
      consider(box, color, vector.height);
    }
  }

  for (const object of page.pdfAnnotationObjects) {
    if (object.deleted || object.type !== "pdf-underline") {
      continue;
    }
    for (const quad of object.quads) {
      consider(quad, object.color, Math.max(1, quad.height));
    }
  }

  return match.best?.underline ?? null;
};

export const pdfLinkForDirtyCaptionRun = (
  page: EditorPage,
  run: PdfTextObject
): PdfLinkAnnotation | undefined => {
  if (!isPdfTextDirty(run)) {
    return undefined;
  }
  for (const object of page.pdfAnnotationObjects) {
    if (object.deleted || object.type !== "pdf-link") {
      continue;
    }
    const runs = pdfLinkOverlappingTextRuns(object, page.pdfTextObjects);
    if (!runs.some((item) => item.id === run.id)) {
      continue;
    }
    if (
      object.label !== object.originalLabel ||
      run.text !== run.originalText
    ) {
      return object;
    }
  }
  return undefined;
};

/** Caption ink and underline for dirty PDF text tied to an edited link label. */
export const pdfLinkTextAppearance = (
  page: EditorPage,
  run: PdfTextObject
): PdfLinkTextAppearance | null => {
  if (!pdfLinkForDirtyCaptionRun(page, run)) {
    return null;
  }
  if (run.captionFill && run.captionUnderline) {
    return {
      fillColor: run.captionFill,
      underline: run.captionUnderline,
    };
  }
  const runBox = pdfTextOverlayBox(run, measurePdfTextWidth(run));
  const found = findCaptionUnderlineDecoration(page, runBox);
  let fillColor = run.color;
  if (run.color === DEFAULT_PDF_TEXT_COLOR && found?.color) {
    fillColor = found.color;
  }
  const underline = found ?? defaultCaptionUnderline(runBox, fillColor);
  if (run.color !== DEFAULT_PDF_TEXT_COLOR) {
    fillColor = run.color;
  }
  return { fillColor, underline };
};

export const hitTestPdfText = (
  objects: readonly PdfTextObject[],
  point: Point
): PdfTextObject | undefined => {
  for (const object of objects.toReversed()) {
    const box = pdfTextOverlayBox(object, measurePdfTextWidth(object));
    if (
      box.width > 0 &&
      box.height > 0 &&
      point.x >= box.x &&
      point.x <= box.x + box.width &&
      point.y >= box.y &&
      point.y <= box.y + box.height
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

const distanceToSegment = (point: Point, a: Point, b: Point): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq < 1e-12) {
    return Math.hypot(point.x - a.x, point.y - a.y);
  }
  const t = Math.min(
    1,
    Math.max(0, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq)
  );
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
};

const mapUserPointToObjectDisplayed = (
  point: Point,
  object: PdfVectorObject,
  crop: EditorPage["cropBox"],
  sourceRotate: EditorPage["sourceRotate"]
): Point => {
  const displayed = userPointToDisplayed(point, crop, sourceRotate);
  const sx =
    object.originalWidth > 1e-6 ? object.width / object.originalWidth : 1;
  const sy =
    object.originalHeight > 1e-6 ? object.height / object.originalHeight : 1;
  const local = {
    x: object.x + (displayed.x - object.originalX) * sx,
    y: object.y + (displayed.y - object.originalY) * sy,
  };
  if (object.rotation === 0) {
    return local;
  }
  return rotatePoint(local, objectCenter(object), object.rotation);
};

const vectorStrokeHitThreshold = (object: PdfVectorObject): number =>
  Math.max(4, (object.stroke?.width ?? 1) + 2);

// oxlint-disable-next-line eslint/complexity -- path hit-test branches per command type
const hitTestVectorCommands = (
  object: PdfVectorObject,
  point: Point,
  crop: EditorPage["cropBox"],
  sourceRotate: EditorPage["sourceRotate"]
): boolean => {
  const filledShape =
    object.kind === "rect" || (object.fill !== null && object.kind !== "line");
  if (filledShape && pointInRotatedRect(point, object)) {
    return true;
  }

  const threshold = vectorStrokeHitThreshold(object);
  let cursor: Point | null = null;
  let start: Point | null = null;
  for (const command of object.commands) {
    if (command.type === "moveTo") {
      cursor = mapUserPointToObjectDisplayed(
        command,
        object,
        crop,
        sourceRotate
      );
      start = cursor;
      continue;
    }
    if (command.type === "lineTo" && cursor) {
      const next = mapUserPointToObjectDisplayed(
        command,
        object,
        crop,
        sourceRotate
      );
      if (distanceToSegment(point, cursor, next) <= threshold) {
        return true;
      }
      cursor = next;
      continue;
    }
    if (command.type === "curveTo" && cursor) {
      const end = mapUserPointToObjectDisplayed(
        { x: command.x3, y: command.y3 },
        object,
        crop,
        sourceRotate
      );
      const c1 = mapUserPointToObjectDisplayed(
        { x: command.x1, y: command.y1 },
        object,
        crop,
        sourceRotate
      );
      const c2 = mapUserPointToObjectDisplayed(
        { x: command.x2, y: command.y2 },
        object,
        crop,
        sourceRotate
      );
      if (
        distanceToSegment(point, cursor, c1) <= threshold ||
        distanceToSegment(point, c1, c2) <= threshold ||
        distanceToSegment(point, c2, end) <= threshold
      ) {
        return true;
      }
      cursor = end;
      continue;
    }
    if (command.type === "quadraticCurveTo" && cursor) {
      const end = mapUserPointToObjectDisplayed(
        { x: command.x, y: command.y },
        object,
        crop,
        sourceRotate
      );
      const control = mapUserPointToObjectDisplayed(
        { x: command.x1, y: command.y1 },
        object,
        crop,
        sourceRotate
      );
      if (
        distanceToSegment(point, cursor, control) <= threshold ||
        distanceToSegment(point, control, end) <= threshold
      ) {
        return true;
      }
      cursor = end;
      continue;
    }
    if (command.type === "closePath" && cursor && start) {
      if (distanceToSegment(point, cursor, start) <= threshold) {
        return true;
      }
      cursor = start;
    }
  }

  if (object.kind === "line") {
    return false;
  }
  return pointInRotatedRect(point, object);
};

export const hitTestPdfVector = (
  objects: readonly PdfVectorObject[],
  point: Point,
  crop: EditorPage["cropBox"],
  sourceRotate: EditorPage["sourceRotate"]
): PdfVectorObject | undefined => {
  for (const object of objects.toReversed()) {
    if (object.deleted) {
      continue;
    }
    if (hitTestVectorCommands(object, point, crop, sourceRotate)) {
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

export const mapPagePdfVectors = (
  pages: readonly EditorPage[],
  pageId: string,
  mapper: (objects: PdfVectorObject[]) => PdfVectorObject[]
): EditorPage[] =>
  pages.map((page) =>
    page.id === pageId
      ? { ...page, pdfVectorObjects: mapper(page.pdfVectorObjects) }
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
