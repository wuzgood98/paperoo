export const EDITOR_OBJECT_SOURCE = "overlay" as const;

export type PageRotation = 0 | 90 | 180 | 270;

export type EditorTool =
  | "select"
  | "text"
  | "image"
  | "draw"
  | "signature"
  | "highlight"
  | "shape";

export type ShapeKind = "rect" | "line" | "circle";

export type FontFamily = "sans" | "serif" | "mono";

export type TextAlign = "left" | "center" | "right";

export type FontWeight = 400 | 700;

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export type Rect = Point & Size;

export type CropBox = Rect;

export interface BaseObject {
  id: string;
  source: typeof EDITOR_OBJECT_SOURCE;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
}

export type TextObject = BaseObject & {
  type: "text";
  content: string;
  fontFamily: FontFamily;
  fontSize: number;
  fontWeight: FontWeight;
  italic: boolean;
  color: string;
  align: TextAlign;
};

export type ImageMimeType = "image/png" | "image/jpeg" | "image/webp";

export type ImageObject = BaseObject & {
  type: "image";
  assetId: string;
  mimeType: ImageMimeType;
};

export type DrawingObject = BaseObject & {
  type: "drawing";
  points: Point[];
  stroke: string;
  strokeWidth: number;
};

export type SignatureObject = BaseObject & {
  type: "signature";
  points: Point[];
  stroke: string;
  strokeWidth: number;
};

export type HighlightObject = BaseObject & {
  type: "highlight";
  color: string;
};

export type ShapeObject = BaseObject & {
  type: "shape";
  shape: ShapeKind;
  fill: string | null;
  stroke: string;
  strokeWidth: number;
};

export type EditorObject =
  | TextObject
  | ImageObject
  | DrawingObject
  | SignatureObject
  | HighlightObject
  | ShapeObject;

export type EditorObjectType = EditorObject["type"];

export type PdfTextDir = "ltr" | "rtl" | "ttb";

export type PdfTextTransform = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
];

export interface PdfTextCaptionUnderline {
  color: string;
  /** Line center Y in displayed page space, relative to run box top. */
  offsetFromRunTop: number;
  thickness: number;
}

export interface PdfTextObject {
  captionFill?: string;
  captionUnderline?: PdfTextCaptionUnderline;
  color: string;
  dir: PdfTextDir;
  fontFamily?: FontFamily;
  fontName: string;
  fontSize?: number;
  fontWeight?: FontWeight;
  hasEOL: boolean;
  height: number;
  id: string;
  italic?: boolean;
  originalColor: string;
  originalFontFamily?: FontFamily;
  originalFontSize?: number;
  originalStrokeColor: string;
  originalStrokeWidth: number;
  originalText: string;
  originalTextRenderingMode: number;
  pageId: string;
  rotation: number;
  sourceIndex: number;
  strokeColor: string;
  strokeWidth: number;
  text: string;
  textRenderingMode: number;
  transform: PdfTextTransform;
  type: "pdf-text";
  width: number;
  x: number;
  y: number;
}

export interface PdfImageObject {
  deleted: boolean;
  height: number;
  id: string;
  originalHeight: number;
  originalRotation: number;
  originalWidth: number;
  originalX: number;
  originalY: number;
  pageId: string;
  previewAssetId: string | null;
  replacementAssetId: string | null;
  rotation: number;
  sourceId: string;
  sourceIndex: number;
  type: "pdf-image";
  width: number;
  x: number;
  y: number;
}

export type PdfPathCommand =
  | { type: "moveTo"; x: number; y: number }
  | { type: "lineTo"; x: number; y: number }
  | {
      type: "curveTo";
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      x3: number;
      y3: number;
    }
  | {
      type: "quadraticCurveTo";
      x1: number;
      y1: number;
      x: number;
      y: number;
    }
  | { type: "closePath" };

export type PdfVectorKind = "line" | "rect" | "path";

export type PdfVectorPaint =
  | "stroke"
  | "closeStroke"
  | "fill"
  | "eoFill"
  | "fillStroke"
  | "eoFillStroke"
  | "closeFillStroke"
  | "closeEOFillStroke";

export interface PdfVectorFillStyle {
  color: string;
}

export interface PdfVectorStrokeStyle {
  color: string;
  lineCap: number;
  lineJoin: number;
  width: number;
}

export type PdfLinkAction =
  | { kind: "url"; url: string }
  | { kind: "goto"; dest: unknown }
  | { kind: "named"; name: string }
  | { kind: "none" };

export interface PdfAnnotationGeometry {
  annotationFlags: number;
  deleted: boolean;
  height: number;
  id: string;
  originalHeight: number;
  originalRotation: number;
  originalUserHeight: number;
  originalUserWidth: number;
  originalUserX: number;
  originalUserY: number;
  originalWidth: number;
  originalX: number;
  originalY: number;
  pageId: string;
  rotation: number;
  sourceRef: string;
  subtype: string;
  width: number;
  x: number;
  y: number;
}

export type PdfMarkupAnnotationType =
  | "pdf-highlight"
  | "pdf-underline"
  | "pdf-squiggly"
  | "pdf-strikeout";

export interface PdfMarkupAnnotation extends PdfAnnotationGeometry {
  color: string;
  originalColor: string;
  originalUserQuadPoints: number[];
  popupRef: string | null;
  quads: Rect[];
  type: PdfMarkupAnnotationType;
  opacity?: number;
  originalOpacity?: number;
}

export interface PdfLinkAnnotation extends PdfAnnotationGeometry {
  action: PdfLinkAction;
  color: string;
  label: string;
  originalAction: PdfLinkAction;
  originalColor: string;
  originalLabel: string;
  originalUserQuadPoints: number[] | null;
  quads: Rect[];
  type: "pdf-link";
}

export interface PdfFreeTextAnnotation extends PdfAnnotationGeometry {
  color: string;
  contents: string;
  fontColor: string;
  fontSize: number;
  originalColor: string;
  originalContents: string;
  originalFontSize: number;
  popupRef: string | null;
  type: "pdf-free-text";
}

export interface PdfTextNoteAnnotation extends PdfAnnotationGeometry {
  color: string;
  contents: string;
  iconName: string;
  originalColor: string;
  originalContents: string;
  originalIconName: string;
  popupRef: string | null;
  type: "pdf-text-note";
}

export interface PdfStampAnnotation extends PdfAnnotationGeometry {
  appearanceTranslatable: boolean;
  color: string;
  originalColor: string;
  popupRef: string | null;
  type: "pdf-stamp";
}

export type PdfAnnotationObject =
  | PdfLinkAnnotation
  | PdfMarkupAnnotation
  | PdfFreeTextAnnotation
  | PdfTextNoteAnnotation
  | PdfStampAnnotation;

export interface PdfVectorObject {
  commands: PdfPathCommand[];
  deleted: boolean;
  fill: PdfVectorFillStyle | null;
  height: number;
  id: string;
  kind: PdfVectorKind;
  originalFill: PdfVectorFillStyle | null;
  originalHeight: number;
  originalRotation: number;
  originalStroke: PdfVectorStrokeStyle | null;
  originalWidth: number;
  originalX: number;
  originalY: number;
  pageId: string;
  paint: PdfVectorPaint;
  rotation: number;
  sourceIndex: number;
  sourceOperatorIndices: number[];
  stroke: PdfVectorStrokeStyle | null;
  type: "pdf-vector";
  width: number;
  x: number;
  y: number;
}

export interface EditorPage {
  id: string;
  sourceIndex: number;
  width: number;
  height: number;
  rotation: PageRotation;
  sourceRotate: PageRotation;
  cropBox: CropBox;
  objects: EditorObject[];
  pdfAnnotationObjects: PdfAnnotationObject[];
  pdfImageObjects: PdfImageObject[];
  pdfTextObjects: PdfTextObject[];
  pdfVectorObjects: PdfVectorObject[];
  skippedPdfAnnotationSubtypes: string[];
}

export interface EditorDocument {
  pages: EditorPage[];
}

export interface ImageAsset {
  id: string;
  bytes: Uint8Array;
  mimeType: ImageMimeType;
  objectUrl: string;
  provisional?: boolean;
}

export type EditorStatus = "idle" | "loading" | "ready" | "error";

export type ZoomMode = "custom" | "fit-page" | "fit-width";

export interface HistorySnapshot {
  document: EditorDocument;
  selectedObjectIds: readonly string[];
  currentPageId: string | null;
}

export interface TextStyleDefaults {
  fontFamily: FontFamily;
  fontSize: number;
  fontWeight: FontWeight;
  italic: boolean;
  color: string;
  align: TextAlign;
}

export interface DrawStyleDefaults {
  stroke: string;
  strokeWidth: number;
}

export interface ShapeStyleDefaults {
  shape: ShapeKind;
  fill: string | null;
  stroke: string;
  strokeWidth: number;
}

export const DEFAULT_TEXT_STYLE: TextStyleDefaults = {
  align: "left",
  color: "#111827",
  fontFamily: "sans",
  fontSize: 16,
  fontWeight: 400,
  italic: false,
};

export const DEFAULT_DRAW_STYLE: DrawStyleDefaults = {
  stroke: "#111827",
  strokeWidth: 2,
};

export const DEFAULT_SHAPE_STYLE: ShapeStyleDefaults = {
  fill: null,
  shape: "rect",
  stroke: "#111827",
  strokeWidth: 2,
};

export const DEFAULT_HIGHLIGHT_COLOR = "#facc15";

/** Default fill for dirty PDF text preview/export until op-list colors are extracted. */
export const DEFAULT_PDF_TEXT_COLOR = "#111827";
export const DEFAULT_PDF_TEXT_STROKE_COLOR = "#000000";
export const DEFAULT_PDF_TEXT_STROKE_WIDTH = 1;
export const DEFAULT_PDF_TEXT_RENDERING_MODE = 0;

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;
export const ZOOM_STEP = 0.25;
export const DEFAULT_OBJECT_OPACITY = 1;
export const HIGHLIGHT_OPACITY = 0.4;
export const NUDGE_DISTANCE = 1;
export const NUDGE_DISTANCE_SHIFT = 10;
export const MIN_OBJECT_SIZE = 8;
export const MAX_PDF_BYTES = 80 * 1024 * 1024;
export const MAX_PDF_PAGES = 200;
export const ZOOM_SETTLE_MS = 140;
