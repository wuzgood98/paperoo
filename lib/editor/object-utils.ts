import {
  DEFAULT_ASCENT_RATIO,
  isPdfTextTurned,
  objectCenter,
  pdfTextBaselineDisplayed,
  rotatePoint,
  userPointToDisplayed,
  vectorAxisScale,
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
  EMPTY_PDF_FORM,
  HIGHLIGHT_OPACITY,
  MIN_CREATE_DRAG,
} from "@/lib/editor/types";
import type {
  DrawingObject,
  CropBox,
  EditorDocument,
  EditorObject,
  EditorPage,
  HighlightObject,
  ImageMimeType,
  ImageObject,
  PdfAnnotationObject,
  PdfFormChoiceOption,
  PdfFormField,
  PdfFormModel,
  PdfFormWidget,
  PdfImageObject,
  PdfLinkAction,
  PdfLinkAnnotation,
  PageRotation,
  PdfMarkupAnnotation,
  PdfPathCommand,
  PdfTextCaptionUnderline,
  PdfTextObject,
  PdfVectorObject,
  Point,
  Rect,
  ShapeObject,
  ShapeStyleDefaults,
  SignatureObject,
  Size,
  TextObject,
} from "@/lib/editor/types";
import type {
  CanvasFontOptions,
  PdfTextGlyphInk,
} from "@/lib/fonts/measure-text";
import {
  canvasTextWidth,
  measurePdfTextGlyphInk,
} from "@/lib/fonts/measure-text";
import { pickSubpathCommands } from "@/lib/ocr/outline-text";
import { pdfTextPreviewFontCss } from "@/lib/pdf/embedded-font";

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

export const documentForm = (
  document: Pick<EditorDocument, "form">
): PdfFormModel => document.form ?? EMPTY_PDF_FORM;

export const findPdfFormField = (
  document: EditorDocument,
  fieldId: string | null
): PdfFormField | undefined =>
  documentForm(document).fields.find((field) => field.id === fieldId);

export const isPdfFormFieldDirty = (field: PdfFormField): boolean => {
  switch (field.kind) {
    case "signature": {
      return false;
    }
    case "listbox": {
      return field.value.join("\0") !== field.originalValue.join("\0");
    }
    case "checkbox": {
      return field.value !== field.originalValue;
    }
    default: {
      return field.value !== field.originalValue;
    }
  }
};

export const mapDocumentFormFields = (
  document: EditorDocument,
  mapper: (field: PdfFormField) => PdfFormField
): EditorDocument => ({
  ...document,
  form: {
    ...documentForm(document),
    fields: documentForm(document).fields.map(mapper),
  },
});

export const isPdfFormFieldEditable = (field: PdfFormField): boolean =>
  field.kind !== "signature" && !field.readOnly;

export const pdfFormChoiceDisplay = (
  options: readonly PdfFormChoiceOption[],
  exportValue: string | null
): string => {
  if (exportValue === null) {
    return "";
  }
  return (
    options.find((option) => option.exportValue === exportValue)?.display ??
    exportValue
  );
};

export const pdfFormFieldPreviewText = (
  field: PdfFormField,
  widget: PdfFormWidget
): string => {
  switch (field.kind) {
    case "checkbox": {
      return field.value ? "✓" : "";
    }
    case "dropdown": {
      return pdfFormChoiceDisplay(field.options, field.value);
    }
    case "listbox": {
      return field.value
        .map((value) => pdfFormChoiceDisplay(field.options, value))
        .join(", ");
    }
    case "radio": {
      return field.value === widget.exportValue ? "●" : "";
    }
    case "signature": {
      return "";
    }
    case "text": {
      if (field.password) {
        return "•".repeat(field.value.length);
      }
      return field.value;
    }
    default: {
      return "";
    }
  }
};

interface PdfFormWidgetItem {
  field: PdfFormField;
  widget: PdfFormWidget;
}

const NO_FORM_WIDGETS: readonly PdfFormWidgetItem[] = [];

/** Forms are immutable, so each form's per-page index is built once. */
const formWidgetIndex = new WeakMap<
  PdfFormModel,
  ReadonlyMap<string, readonly PdfFormWidgetItem[]>
>();

const formWidgetsByPage = (
  form: PdfFormModel
): ReadonlyMap<string, readonly PdfFormWidgetItem[]> => {
  const cached = formWidgetIndex.get(form);
  if (cached) {
    return cached;
  }
  const index = new Map<string, PdfFormWidgetItem[]>();
  for (const field of form.fields) {
    for (const widget of field.widgets) {
      const items = index.get(widget.pageId);
      if (items) {
        items.push({ field, widget });
      } else {
        index.set(widget.pageId, [{ field, widget }]);
      }
    }
  }
  formWidgetIndex.set(form, index);
  return index;
};

/** Widget order on a page: field list, then widgets. PDF /Tabs R/C/S is not used. */
export const pdfFormWidgetsOnPage = (
  document: Pick<EditorDocument, "form">,
  pageId: string
): readonly PdfFormWidgetItem[] =>
  formWidgetsByPage(documentForm(document)).get(pageId) ?? NO_FORM_WIDGETS;

const pointInRect = (point: Point, rect: Rect): boolean =>
  point.x >= rect.x &&
  point.x <= rect.x + rect.width &&
  point.y >= rect.y &&
  point.y <= rect.y + rect.height;

export const hitTestPdfFormField = (
  document: Pick<EditorDocument, "form">,
  pageId: string,
  point: Point
): PdfFormField | undefined => {
  const hits = pdfFormWidgetsOnPage(document, pageId);
  return hits.findLast(({ widget }) => pointInRect(point, widget))?.field;
};

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

/** Share of a run's width and height a link quad must cover to own the run. */
const PDF_LINK_RUN_COVERAGE = 0.5;

const spanOverlap = (
  start: number,
  length: number,
  otherStart: number,
  otherLength: number
): number =>
  Math.max(
    0,
    Math.min(start + length, otherStart + otherLength) -
      Math.max(start, otherStart)
  );

const coversEnoughOf = (overlap: number, size: number): boolean =>
  overlap / size >= PDF_LINK_RUN_COVERAGE;

/**
 * True when `quad` covers most of `run`. A run that only grazes the link rect,
 * such as a "|" separator ending a hair inside the rect, is not part of the
 * link label.
 */
const linkQuadOwnsRun = (run: Rect, quad: Rect): boolean => {
  if (!rectsOverlap(run, quad)) {
    return false;
  }
  if (run.width <= 0 || run.height <= 0) {
    return true;
  }
  return (
    coversEnoughOf(
      spanOverlap(run.x, run.width, quad.x, quad.width),
      run.width
    ) &&
    coversEnoughOf(
      spanOverlap(run.y, run.height, quad.y, quad.height),
      run.height
    )
  );
};

/**
 * Reading order: runs sharing a line by x, lines by y. PDF.js inserts
 * zero-height space runs at the baseline, so a run with no height shares a
 * line with any run whose box contains its y.
 */
const compareRunsInReadingOrder = (
  left: PdfTextObject,
  right: PdfTextObject
): number => {
  const overlap =
    Math.min(left.y + left.height, right.y + right.height) -
    Math.max(left.y, right.y);
  const minHeight = Math.min(left.height, right.height);
  const sameLine = minHeight > 0 ? overlap > minHeight / 2 : overlap >= 0;
  return sameLine ? left.x - right.x : left.y - right.y;
};

const isBlankRun = (run: PdfTextObject): boolean => run.text.trim() === "";

const NO_TEXT_RUNS: readonly PdfTextObject[] = [];

const computeLinkOverlappingTextRuns = (
  link: PdfLinkAnnotation,
  textRuns: readonly PdfTextObject[]
): readonly PdfTextObject[] => {
  const runs = textRuns
    .filter((run) => {
      const runBox: Rect = {
        height: run.height,
        width: run.width,
        x: run.x,
        y: run.y,
      };
      return link.quads.some((quad) => linkQuadOwnsRun(runBox, quad));
    })
    .toSorted(compareRunsInReadingOrder);
  // Spaces at either end are padding from the link rect, not label text.
  const first = runs.findIndex((run) => !isBlankRun(run));
  if (first === -1) {
    return NO_TEXT_RUNS;
  }
  const last = runs.findLastIndex((run) => !isBlankRun(run));
  return runs.slice(first, last + 1);
};

/** Links and run lists are immutable; one cached answer per link and run list. */
const overlappingRunsCache = new WeakMap<
  PdfLinkAnnotation,
  {
    result: readonly PdfTextObject[];
    textRuns: readonly PdfTextObject[];
  }
>();

export const pdfLinkOverlappingTextRuns = (
  link: PdfLinkAnnotation,
  textRuns: readonly PdfTextObject[]
): readonly PdfTextObject[] => {
  const cached = overlappingRunsCache.get(link);
  if (cached?.textRuns === textRuns) {
    return cached.result;
  }
  const result = computeLinkOverlappingTextRuns(link, textRuns);
  overlappingRunsCache.set(link, { result, textRuns });
  return result;
};

export interface PdfLinkEditableLabel {
  editable: boolean;
  label: string;
  runs: readonly PdfTextObject[];
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

/**
 * Degrees a run's box turns about its baseline origin (see
 * `pdfTextFramePivot`). 0 for runs on the page's axes, including those that
 * only follow a page `/Rotate`: their box is already where the ink is.
 */
export const pdfTextFrameRotation = (
  object: Pick<PdfTextObject, "rotation" | "transform">
): number => (isPdfTextTurned(object.transform) ? object.rotation : 0);

/** The run's baseline origin in displayed space: the pivot of its frame. */
export const pdfTextFramePivot = (
  object: Pick<PdfTextObject, "ascentRatio" | "fontSize" | "height" | "x" | "y">
): Point => {
  const ascentRatio =
    object.ascentRatio !== undefined && object.ascentRatio > 0
      ? object.ascentRatio
      : DEFAULT_ASCENT_RATIO;
  return {
    x: object.x,
    y: object.y + (object.fontSize ?? object.height) * ascentRatio,
  };
};

type PdfTextFrameFields = Pick<
  PdfTextObject,
  "ascentRatio" | "fontSize" | "height" | "rotation" | "transform" | "x" | "y"
>;

/** A displayed point in the run's unturned frame, where its box is a plain rect. */
export const pdfTextFramePoint = (
  object: PdfTextFrameFields,
  point: Point
): Point => {
  const rotation = pdfTextFrameRotation(object);
  return rotation === 0
    ? point
    : rotatePoint(point, pdfTextFramePivot(object), -rotation);
};

/** Corners (clockwise from top-left) of a frame rect, in displayed space. */
export const pdfTextFrameCorners = (
  object: PdfTextFrameFields,
  rect: Rect
): Point[] => {
  const rotation = pdfTextFrameRotation(object);
  const pivot = pdfTextFramePivot(object);
  return [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ].map((corner) => rotatePoint(corner, pivot, rotation));
};

/** Displayed-space bounds of a frame rect. */
export const pdfTextFrameBounds = (
  object: PdfTextFrameFields,
  rect: Rect
): Rect => {
  if (pdfTextFrameRotation(object) === 0) {
    return rect;
  }
  const corners = pdfTextFrameCorners(object, rect);
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return {
    height: Math.max(...ys) - top,
    width: Math.max(...xs) - left,
    x: left,
    y: top,
  };
};

/** Canvas font for drawing `text` in a run, in the face preview would use. */
export const pdfTextCanvasFont = (
  object: PdfTextObject,
  text: string
): CanvasFontOptions => ({
  familyCss: pdfTextPreviewFontCss(object, text),
  fontFamily: object.fontFamily ?? "sans",
  fontSize: object.fontSize ?? object.height,
  fontWeight: object.fontWeight ?? 400,
  italic: object.italic === true,
});

/** Advance of `text` in page units, stretched like the run's own glyphs. */
export const measurePdfTextWidth = (
  object: PdfTextObject,
  text: string = object.text
): number =>
  canvasTextWidth(text, pdfTextCanvasFont(object, text)) *
  (object.horizontalScale ?? 1);

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

/**
 * Top of a `line-height: 1` text box so its baseline lands on the PDF's.
 * `cssBaselineRatio` is where that box paints the baseline (font-size
 * fractions), not the font ascent: CSS half-leading moves it up.
 */
export const pdfTextCssInkOffsetFromRunTop = (
  object: Pick<PdfTextObject, "fontSize" | "height" | "transform">,
  runBox: Rect,
  crop: CropBox,
  sourceRotate: PageRotation,
  cssBaselineRatio: number
): number => {
  const baseline = pdfTextBaselineDisplayed(
    object.transform,
    crop,
    sourceRotate
  );
  const fontSize = object.fontSize ?? object.height;
  return baseline.y - runBox.y - fontSize * cssBaselineRatio;
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
  // An emptied run only hides its old glyphs; the primary run draws the
  // caption and its underline.
  if (!isPdfTextDirty(run) || run.text === "") {
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
  if (run.captionFill) {
    // Pixels showed the caption color but no rule under it.
    return {
      fillColor: run.captionFill,
      underline: found ?? defaultCaptionUnderline(runBox, run.captionFill),
    };
  }
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

/** Page-space outset so anti-aliased fringes of the original glyphs stay covered. */
export const PDF_TEXT_COVER_BLEED = 1;

/** Cover color when the page behind a run could not be sampled. */
export const PDF_TEXT_COVER_FALLBACK_COLOR = "#ffffff";

export const pdfTextCoverColor = (
  object: Pick<PdfTextObject, "coverColor">
): string => object.coverColor ?? PDF_TEXT_COVER_FALLBACK_COLOR;

const MIN_COVER_EDGE = 0.25;

/** Runs within this many degrees of 0 are measured as horizontal text. */
const UPRIGHT_TOLERANCE_DEG = 1;

const isUprightRun = (rotation: number): boolean => {
  const turns = ((rotation % 360) + 360) % 360;
  return turns < UPRIGHT_TOLERANCE_DEG || turns > 360 - UPRIGHT_TOLERANCE_DEG;
};

const fontDescriptorInk = (object: PdfTextObject) => {
  const fontSize = object.fontSize ?? object.height;
  const ascentRatio =
    object.ascentRatio !== undefined && object.ascentRatio > 0
      ? object.ascentRatio
      : DEFAULT_ASCENT_RATIO;
  return {
    ascent: fontSize * ascentRatio,
    descent: fontSize * Math.abs(object.descentRatio ?? 0),
  };
};

const uprightBaselineY = (
  object: PdfTextObject,
  page: Pick<EditorPage, "cropBox" | "sourceRotate">
): number =>
  pdfTextBaselineDisplayed(object.transform, page.cropBox, page.sourceRotate).y;

/** Smallest rect containing every rect, or null for none. */
export const unionRects = (rects: readonly Rect[]): Rect | null => {
  if (rects.length === 0) {
    return null;
  }
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const rect of rects) {
    left = Math.min(left, rect.x);
    top = Math.min(top, rect.y);
    right = Math.max(right, rect.x + rect.width);
    bottom = Math.max(bottom, rect.y + rect.height);
  }
  return { height: bottom - top, width: right - left, x: left, y: top };
};

const subtractRect = (subject: Rect, cutter: Rect): Rect[] => {
  const subjectRight = subject.x + subject.width;
  const subjectBottom = subject.y + subject.height;
  const overlapLeft = Math.max(subject.x, cutter.x);
  const overlapTop = Math.max(subject.y, cutter.y);
  const overlapRight = Math.min(subjectRight, cutter.x + cutter.width);
  const overlapBottom = Math.min(subjectBottom, cutter.y + cutter.height);
  if (overlapRight <= overlapLeft || overlapBottom <= overlapTop) {
    return [subject];
  }
  const parts: Rect[] = [];
  if (overlapTop > subject.y) {
    parts.push({
      height: overlapTop - subject.y,
      width: subject.width,
      x: subject.x,
      y: subject.y,
    });
  }
  if (overlapBottom < subjectBottom) {
    parts.push({
      height: subjectBottom - overlapBottom,
      width: subject.width,
      x: subject.x,
      y: overlapBottom,
    });
  }
  if (overlapLeft > subject.x) {
    parts.push({
      height: overlapBottom - overlapTop,
      width: overlapLeft - subject.x,
      x: subject.x,
      y: overlapTop,
    });
  }
  if (overlapRight < subjectRight) {
    parts.push({
      height: overlapBottom - overlapTop,
      width: subjectRight - overlapRight,
      x: overlapRight,
      y: overlapTop,
    });
  }
  return parts;
};

const clipRects = (
  subjects: readonly Rect[],
  cutters: readonly Rect[]
): Rect[] => {
  let current = [...subjects];
  for (const cutter of cutters) {
    const next: Rect[] = [];
    for (const subject of current) {
      for (const part of subtractRect(subject, cutter)) {
        if (part.width > MIN_COVER_EDGE && part.height > MIN_COVER_EDGE) {
          next.push(part);
        }
      }
    }
    current = next;
  }
  return current;
};

/**
 * Measures per-glyph ink for a string. Production uses the browser canvas;
 * there is none in the export worker or tests, so callers can pass another.
 */
export type GlyphInkMeasurer = (
  text: string,
  font: CanvasFontOptions
) => PdfTextGlyphInk[] | null;

const glyphInkRects = (
  object: PdfTextObject,
  baselineY: number,
  measureInk: GlyphInkMeasurer
): Rect[] | null => {
  if (!isUprightRun(object.rotation) || object.dir === "rtl") {
    return null;
  }
  const glyphs = measureInk(
    object.originalText,
    pdfTextCanvasFont(object, object.originalText)
  );
  if (!glyphs) {
    return null;
  }
  return glyphs.map((glyph) => ({
    height: glyph.ascent + glyph.descent,
    width: glyph.width,
    x: object.x + glyph.left,
    y: baselineY - glyph.ascent,
  }));
};

/** Original glyph ink, without the cover bleed or the font-wide descent floor. */
export const pdfTextOriginalInkBox = (
  object: PdfTextObject,
  page: Pick<EditorPage, "cropBox" | "sourceRotate">,
  measureInk: GlyphInkMeasurer = measurePdfTextGlyphInk
): Rect => {
  if (!isUprightRun(object.rotation)) {
    return pdfTextFrameBounds(object, {
      height: object.height,
      width: object.width,
      x: object.x,
      y: object.y,
    });
  }
  const baselineY = uprightBaselineY(object, page);
  const glyphs = glyphInkRects(object, baselineY, measureInk);
  const glyphBox = glyphs ? unionRects(glyphs) : null;
  if (glyphBox) {
    return glyphBox;
  }
  const { ascent, descent } = fontDescriptorInk(object);
  return {
    height: ascent + descent,
    width: object.width,
    x: object.x,
    y: baselineY - ascent,
  };
};

/** Glyph ink can pass the font descriptor box (accents, swashes). */
const NEIGHBOUR_REACH_EM = 0.5;

export const rectsIntersect = (left: Rect, right: Rect): boolean =>
  left.x < right.x + right.width &&
  right.x < left.x + left.width &&
  left.y < right.y + right.height &&
  right.y < left.y + left.height;

/**
 * Cheap outer bound for a neighbour's ink, from font metrics only. Neighbours
 * outside it skip the per-glyph canvas measuring.
 */
export const neighbourReachBox = (
  object: PdfTextObject,
  page: Pick<EditorPage, "cropBox" | "sourceRotate">
): Rect => {
  const reach = (object.fontSize ?? object.height) * NEIGHBOUR_REACH_EM;
  const box = isUprightRun(object.rotation)
    ? {
        ...fontDescriptorInk(object),
        baselineY: uprightBaselineY(object, page),
      }
    : null;
  const top = Math.min(object.y, box ? box.baselineY - box.ascent : object.y);
  const bottom = Math.max(
    object.y + object.height,
    box ? box.baselineY + box.descent : object.y + object.height
  );
  const bounds = pdfTextFrameBounds(object, {
    height: bottom - top,
    width: object.width,
    x: object.x,
    y: top,
  });
  return {
    height: bounds.height + reach * 2,
    width: bounds.width + reach * 2,
    x: bounds.x - reach,
    y: bounds.y - reach,
  };
};

const neighbourInkRects = (
  object: PdfTextObject,
  page: Pick<EditorPage, "cropBox" | "sourceRotate">,
  measureInk: GlyphInkMeasurer
): Rect[] => {
  const glyphs = glyphInkRects(
    object,
    uprightBaselineY(object, page),
    measureInk
  );
  if (glyphs) {
    return glyphs;
  }
  return [pdfTextOriginalInkBox(object, page, measureInk)];
};

/**
 * Cover for a dirty run: original glyph ink, not the replacement width, with
 * pieces removed where that ink would paint over a neighbouring run.
 *
 * A turned run's cover is one rect in its own frame (see
 * `pdfTextFrameCorners`): neighbours on the page's axes cannot be cut out of
 * it as rects, so it is not clipped.
 */
export const measurePdfTextCoverRects = (
  object: PdfTextObject,
  page: EditorPage,
  neighbours: readonly PdfTextObject[],
  measureInk: GlyphInkMeasurer = measurePdfTextGlyphInk
): Rect[] => {
  const fontSize = object.fontSize ?? object.height;
  const underline =
    pdfLinkTextAppearance(page, object)?.underline ?? object.captionUnderline;
  const bleed = PDF_TEXT_COVER_BLEED;
  if (pdfTextFrameRotation(object) !== 0) {
    const cover = dirtyPdfTextCoverBox(
      { height: object.height, width: object.width, x: object.x, y: object.y },
      fontSize,
      underline
    );
    return [
      {
        height: cover.height + bleed * 2,
        width: cover.width + bleed * 2,
        x: cover.x - bleed,
        y: cover.y - bleed,
      },
    ];
  }
  let seed: Rect;
  if (isUprightRun(object.rotation)) {
    const ink = pdfTextOriginalInkBox(object, page, measureInk);
    const leftPad = fontSize * PDF_TEXT_COVER_LEFT_EM;
    let top = ink.y - bleed;
    let bottom = ink.y + ink.height + bleed;
    const left = Math.min(ink.x, object.x) - leftPad - bleed;
    const right = Math.max(ink.x + ink.width, object.x + object.width) + bleed;
    if (underline) {
      const half = underline.thickness / 2;
      const center = object.y + underline.offsetFromRunTop;
      top = Math.min(top, center - half - bleed);
      bottom = Math.max(bottom, center + half + bleed);
    }
    seed = { height: bottom - top, width: right - left, x: left, y: top };
  } else {
    seed = dirtyPdfTextCoverBox(
      { height: object.height, width: object.width, x: object.x, y: object.y },
      fontSize,
      underline
    );
  }
  const cutters: Rect[] = [];
  for (const neighbour of neighbours) {
    if (
      neighbour.id === object.id ||
      !rectsIntersect(seed, neighbourReachBox(neighbour, page))
    ) {
      continue;
    }
    cutters.push(...neighbourInkRects(neighbour, page, measureInk));
  }
  return clipRects([seed], cutters);
};

/**
 * Cover rects for a dirty run. Prefers the rects measured on the main thread
 * when editing began; the export worker has no canvas to measure glyph ink.
 */
const rectsEqual = (left: Rect, right: Rect): boolean =>
  left.x === right.x &&
  left.y === right.y &&
  left.width === right.width &&
  left.height === right.height;

/**
 * Covers for the primary run of an edited link label: its own glyph covers
 * plus a band over the original underline across the whole link, which the
 * glyph covers (measured before the edit) leave visible.
 */
export const pdfLinkPrimaryCoverRects = (
  page: EditorPage,
  link: PdfLinkAnnotation,
  runs: readonly PdfTextObject[],
  primary: PdfTextObject,
  underline: PdfTextCaptionUnderline | null | undefined
): Rect[] => {
  const covers =
    primary.coverRects ??
    measurePdfTextCoverRects(primary, page, page.pdfTextObjects);
  if (!underline || !isUprightRun(primary.rotation)) {
    return covers;
  }
  const spans = [...link.quads, ...runs];
  const left = Math.min(...spans.map((span) => span.x));
  const right = Math.max(...spans.map((span) => span.x + span.width));
  const half = underline.thickness / 2 + PDF_TEXT_COVER_BLEED;
  const center = primary.y + underline.offsetFromRunTop;
  const band: Rect = {
    height: half * 2,
    width: right - left + PDF_TEXT_COVER_BLEED * 2,
    x: left - PDF_TEXT_COVER_BLEED,
    y: center - half,
  };
  return covers.some((cover) => rectsEqual(cover, band))
    ? covers
    : [...covers, band];
};

const lineOutlines = new WeakMap<
  PdfVectorObject,
  Map<string, PdfVectorObject>
>();

/** The outline cut down to some of its subpaths; same box, so it maps the same. */
export const pdfVectorSubpaths = (
  outline: PdfVectorObject,
  subpaths: readonly number[]
): PdfVectorObject => {
  const key = subpaths.join(",");
  const cached = lineOutlines.get(outline)?.get(key);
  if (cached) {
    return cached;
  }
  const line = {
    ...outline,
    commands: pickSubpathCommands(outline.commands, new Set(subpaths)),
  };
  const byKey = lineOutlines.get(outline) ?? new Map<string, PdfVectorObject>();
  byKey.set(key, line);
  lineOutlines.set(outline, byKey);
  return line;
};

/**
 * The outline path that paints a run, when the run owns it alone (Figma
 * Type3 export), or the run's own line of an outline-only label. Its shape is
 * the run's original ink, so covering the path hides the old text without
 * touching neighbouring artwork.
 */
const vectorIndexCache = new WeakMap<
  readonly PdfVectorObject[],
  ReadonlyMap<string, PdfVectorObject>
>();

/** Vectors by id, built once per page vector list (runs look theirs up per render). */
const vectorsById = (
  vectors: readonly PdfVectorObject[]
): ReadonlyMap<string, PdfVectorObject> => {
  const cached = vectorIndexCache.get(vectors);
  if (cached) {
    return cached;
  }
  const index = new Map<string, PdfVectorObject>();
  for (const vector of vectors) {
    // First match wins, as a linear find would.
    if (!index.has(vector.id)) {
      index.set(vector.id, vector);
    }
  }
  vectorIndexCache.set(vectors, index);
  return index;
};

export const pdfTextInkOutline = (
  object: Pick<PdfTextObject, "inkShared" | "inkSubpaths" | "inkVectorId">,
  page: Pick<EditorPage, "pdfVectorObjects">
): PdfVectorObject | null => {
  if (!object.inkVectorId) {
    return null;
  }
  if (object.inkShared === true && !object.inkSubpaths) {
    return null;
  }
  const outline = vectorsById(page.pdfVectorObjects).get(object.inkVectorId);
  if (!outline) {
    return null;
  }
  return object.inkSubpaths
    ? pdfVectorSubpaths(outline, object.inkSubpaths)
    : outline;
};

/** Text rendering modes that paint no glyph ink (3 invisible, 7 clip only). */
const INVISIBLE_TEXT_RENDER_MODES = new Set([3, 7]);

/** Tr 4–7 add the glyphs to the clip path, which later paint relies on. */
const CLIP_TEXT_RENDER_MODES = new Set([4, 5, 6, 7]);

/**
 * Whether the run's text can be edited. A clip-mode run's show op builds a
 * clip that later operators (often an `sh`) paint through, so emptying or
 * redrawing it would change other ink. It stays selectable and searchable.
 */
export const pdfTextEditable = (
  object: Pick<PdfTextObject, "originalTextRenderingMode">
): boolean => !CLIP_TEXT_RENDER_MODES.has(object.originalTextRenderingMode);

/**
 * Whether export can take this run's original ink out of the page (Removal)
 * rather than only cover it. Export re-verifies against the raw content and
 * can still fall back to a cover; this is the load-time answer.
 */
export const pdfTextRemovable = (
  object: PdfTextObject,
  page: Pick<EditorPage, "contentOpCounts" | "pdfVectorObjects">
): boolean => {
  if (object.outlineText) {
    // Outline-only text has no text operator: removing its path is enough.
    return (
      page.contentOpCounts !== undefined &&
      pdfTextInkOutline(object, page)?.removalTarget !== undefined
    );
  }
  if (
    !(object.removalTarget && page.contentOpCounts && pdfTextEditable(object))
  ) {
    return false;
  }
  const paintsOwnInk =
    object.invisibleGlyphs !== true &&
    !INVISIBLE_TEXT_RENDER_MODES.has(object.originalTextRenderingMode);
  if (paintsOwnInk) {
    return true;
  }
  return pdfTextInkOutline(object, page)?.removalTarget !== undefined;
};

/** PDF line join and cap value for round ends. */
const ROUND_PATH_END = 1;

/**
 * Paint that repaints a glyph outline in the page color. A thin round stroke
 * reaches the antialiased edge without miter spikes at glyph corners.
 */
export const pdfTextInkCoverStyle = (
  coverColor: string
): PdfVectorCoverPathStyle => ({
  fill: coverColor,
  lineCap: ROUND_PATH_END,
  lineJoin: ROUND_PATH_END,
  stroke: coverColor,
  strokeWidth: PDF_VECTOR_COVER_BLEED,
});

export const pdfTextCoverRects = (
  object: PdfTextObject,
  page: EditorPage
): Rect[] => {
  const outline = pdfTextInkOutline(object, page);
  if (outline && object.inkSubpaths) {
    // One line of a label: its own box, not the whole label's.
    return [
      { height: object.height, width: object.width, x: object.x, y: object.y },
    ];
  }
  if (outline) {
    // The ink box: callers that need a rect (cover color sampling) use it,
    // while preview and export paint the outline path itself.
    return [
      {
        height: outline.originalHeight,
        width: outline.originalWidth,
        x: outline.originalX,
        y: outline.originalY,
      },
    ];
  }
  return (
    object.coverRects ??
    measurePdfTextCoverRects(object, page, page.pdfTextObjects)
  );
};

/**
 * Topmost run under `point`. Fitting a dirty run only widens it, so the
 * vertical check rejects most runs first, and only dirty runs are measured.
 */
export const hitTestPdfText = (
  objects: readonly PdfTextObject[],
  pagePoint: Point
): PdfTextObject | undefined =>
  objects.findLast((object) => {
    // A turned run's box is a plain rect in its own frame.
    const point = pdfTextFramePoint(object, pagePoint);
    if (
      object.height <= 0 ||
      point.y < object.y ||
      point.y > object.y + object.height
    ) {
      return false;
    }
    const box = isPdfTextDirty(object)
      ? fittedPdfTextBox(object, measurePdfTextWidth(object))
      : object;
    return box.width > 0 && point.x >= box.x && point.x <= box.x + box.width;
  });

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
  const sx = vectorAxisScale(object.originalWidth, object.width);
  const sy = vectorAxisScale(object.originalHeight, object.height);
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

interface VectorPathBounds {
  crop: EditorPage["cropBox"];
  rect: Rect;
  sourceRotate: EditorPage["sourceRotate"];
}

/** Vectors are immutable, so mapped path bounds are computed once per object. */
const vectorPathBoundsCache = new WeakMap<PdfVectorObject, VectorPathBounds>();

const commandPoints = (command: PdfPathCommand): Point[] => {
  if (command.type === "moveTo" || command.type === "lineTo") {
    return [command];
  }
  if (command.type === "curveTo") {
    return [
      { x: command.x1, y: command.y1 },
      { x: command.x2, y: command.y2 },
      { x: command.x3, y: command.y3 },
    ];
  }
  if (command.type === "quadraticCurveTo") {
    return [
      { x: command.x1, y: command.y1 },
      { x: command.x, y: command.y },
    ];
  }
  return [];
};

/** Displayed bounds of every path point, control points included. */
const vectorPathBounds = (
  object: PdfVectorObject,
  crop: EditorPage["cropBox"],
  sourceRotate: EditorPage["sourceRotate"]
): Rect | null => {
  const cached = vectorPathBoundsCache.get(object);
  if (cached && cached.crop === crop && cached.sourceRotate === sourceRotate) {
    return cached.rect;
  }
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const command of object.commands) {
    for (const point of commandPoints(command)) {
      const mapped = mapUserPointToObjectDisplayed(
        point,
        object,
        crop,
        sourceRotate
      );
      minX = Math.min(minX, mapped.x);
      minY = Math.min(minY, mapped.y);
      maxX = Math.max(maxX, mapped.x);
      maxY = Math.max(maxY, mapped.y);
    }
  }
  if (!Number.isFinite(minX)) {
    return null;
  }
  const rect = { height: maxY - minY, width: maxX - minX, x: minX, y: minY };
  vectorPathBoundsCache.set(object, { crop, rect, sourceRotate });
  return rect;
};

const pointNearRect = (point: Point, rect: Rect, margin: number): boolean =>
  point.x >= rect.x - margin &&
  point.x <= rect.x + rect.width + margin &&
  point.y >= rect.y - margin &&
  point.y <= rect.y + rect.height + margin;

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
  // Every stroke segment lies inside the path bounds, so a point beyond them
  // plus the threshold can only hit the box fallback below.
  const bounds = vectorPathBounds(object, crop, sourceRotate);
  if (!(bounds && pointNearRect(point, bounds, threshold))) {
    return object.kind !== "line" && pointInRotatedRect(point, object);
  }
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

/** Deleting a vector covering more than this share of the page asks first. */
const LARGE_VECTOR_SHARE = 0.5;

/** Whether a vector covers more than half of its page. */
export const pdfVectorIsLarge = (
  object: Pick<PdfVectorObject, "height" | "width">,
  page: Pick<EditorPage, "cropBox">
): boolean =>
  object.width * object.height >
  page.cropBox.width * page.cropBox.height * LARGE_VECTOR_SHARE;

export const hitTestPdfVector = (
  objects: readonly PdfVectorObject[],
  point: Point,
  crop: EditorPage["cropBox"],
  sourceRotate: EditorPage["sourceRotate"]
): PdfVectorObject | undefined =>
  objects.findLast(
    (object) =>
      !object.deleted &&
      // A text run owns its glyph outline; it changes only through text edits.
      object.textInk !== true &&
      // The page background is never picked: it sits under every click.
      object.pageBackground !== true &&
      // Form content is only extracted for text recognition.
      object.formNested !== true &&
      hitTestVectorCommands(object, point, crop, sourceRotate)
  );

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
  // Starts empty; the view shows a placeholder and an untouched box is discarded.
  content: "",
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
  // Pad by half the stroke so the box covers the ink, not just the path.
  const box = expandRect(boundsFromPoints(points), strokeWidth / 2);
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
  style: ShapeStyleDefaults = DEFAULT_SHAPE_STYLE,
  flip = false
): ShapeObject => {
  const shape: ShapeObject = {
    fill: style.shape === "line" ? null : style.fill,
    id: createId(),
    opacity: DEFAULT_OBJECT_OPACITY,
    rotation: 0,
    shape: style.shape,
    source: EDITOR_OBJECT_SOURCE,
    stroke: style.stroke,
    strokeWidth: style.strokeWidth,
    type: "shape",
    ...rect,
  };
  if (style.shape === "line" && flip) {
    shape.flip = true;
  }
  return shape;
};

// Kept above zero: SVG skips a rect or ellipse with a zero size, stroke and all.
const MIN_SHAPE_PATH_SIZE = 0.01;

/**
 * Path box for a rect or circle whose stroke sits inside its box. Strokes are
 * centred on the path, so the path is inset by half the stroke width. Screen,
 * preview and export all draw from this box so they agree.
 */
export const insetShapePathBox = (size: Size, strokeWidth: number): Rect => {
  const width = Math.max(MIN_SHAPE_PATH_SIZE, size.width - strokeWidth);
  const height = Math.max(MIN_SHAPE_PATH_SIZE, size.height - strokeWidth);
  return {
    height,
    width,
    x: (size.width - width) / 2,
    y: (size.height - height) / 2,
  };
};

/** True when a drag from start to end runs bottom-left to top-right (or reverse). */
export const isRisingDrag = (start: Point, end: Point): boolean =>
  (end.x - start.x) * (end.y - start.y) < 0;

/**
 * Whether a drag is too short to create an object. Lines need length on one
 * axis; boxes need it on both.
 */
export const isClickDrag = (
  start: Point,
  end: Point,
  oneAxis = false
): boolean => {
  const dx = Math.abs(end.x - start.x);
  const dy = Math.abs(end.y - start.y);
  return oneAxis
    ? Math.max(dx, dy) < MIN_CREATE_DRAG
    : Math.min(dx, dy) < MIN_CREATE_DRAG;
};

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

/**
 * A line's box keeps its true extent. A flat axis stays 0 (resize keeps it
 * flat), where `normalizedRect`'s 1pt floor would tilt a straight line.
 */
export const lineRect = (start: Point, end: Point): Rect => ({
  height: Math.abs(end.y - start.y),
  width: Math.abs(end.x - start.x),
  x: Math.min(start.x, end.x),
  y: Math.min(start.y, end.y),
});

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
