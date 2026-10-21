export const EDITOR_OBJECT_SOURCE = "overlay" as const;

export type PageRotation = 0 | 90 | 180 | 270;

export type EditorTool =
  | "select"
  | "text"
  | "image"
  | "draw"
  | "signature"
  | "highlight"
  | "shape"
  | "redact";

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
  ocrWordId?: string;
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

/**
 * A box whose content export removes for good: everything under it is
 * taken out of the file and the box is painted in `fill`. Never rotated,
 * always opaque.
 */
export type RedactionObject = BaseObject & {
  type: "redaction";
  fill: string;
};

export type ShapeObject = BaseObject & {
  type: "shape";
  shape: ShapeKind;
  /** Line only: runs bottom-left to top-right instead of top-left to bottom-right. */
  flip?: boolean;
  /** Line only: drawn with a dash pattern scaled to the stroke width. */
  dashed?: boolean;
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
  | ShapeObject
  | RedactionObject;

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
  /** Font-wide ascent as a fraction of font size, from the PDF font descriptor. */
  ascentRatio?: number;
  /** BaseFont name, including any subset tag, used to reuse the embedded font. */
  baseFontName?: string;
  captionFill?: string;
  captionUnderline?: PdfTextCaptionUnderline;
  /** Sampled page color painted behind a dirty run. White when unset. */
  coverColor?: string;
  /** True when the sampled ring was not one dominant color. */
  coverColorUncertain?: boolean;
  /**
   * Cover rects measured once on the main thread from the original glyph ink,
   * so preview and the export worker (no canvas) paint the same patch.
   */
  coverRects?: Rect[];
  color: string;
  /** Font-wide descent as a fraction of font size. Negative PDF values are stored as magnitudes. */
  descentRatio?: number;
  /** Code points already shown in this embedded font, across the document. */
  embeddedFontGlyphs?: string;
  /** Type3 or non-embedded faces cannot be reused for a replacement. */
  embeddedFontUnavailable?: boolean;
  /**
   * Id of the outline path that paints this run (Figma export: the run's own
   * Type3 glyphs are invisible). Its fill is the run's color and its shape is
   * the run's original ink.
   */
  inkVectorId?: string;
  /** True when that outline also paints other runs, so it cannot be covered alone. */
  inkShared?: boolean;
  /**
   * Outline-only text: the subpaths of the `inkVectorId` path that draw this
   * run's glyphs. That path also draws the label's other lines.
   */
  inkSubpaths?: readonly number[];
  /** Constant alpha of the original ink (fill `ca`), below 1; unset is opaque. */
  fillOpacity?: number;
  /**
   * A text block of the document face this run was matched to, when its own
   * text block has no glyphs to rebuild from (outline-only text).
   */
  glyphFace?: PdfGlyphFaceRef;
  /** Set when the run was recognized from outline-only text by OCR. */
  outlineText?: PdfOutlineTextSource;
  /**
   * The run's own text-showing operator, when it can be emptied without
   * moving other text. Unset means Removal is impossible: export covers it.
   */
  removalTarget?: PdfTextRemovalTarget;
  /** The one text-showing operator that draws exactly this run, if known. */
  showOrdinal?: number;
  /** The run's glyphs paint nothing (Type3 `d0`/`d1`-only procedures). */
  invisibleGlyphs?: boolean;
  dir: PdfTextDir;
  fontFamily?: FontFamily;
  fontName: string;
  fontSize?: number;
  fontWeight?: FontWeight;
  hasEOL: boolean;
  height: number;
  /**
   * Advance-axis over em-axis length of the text matrix (`Tz`, or a stretched
   * `cm`). Unset means 1. Already included in `width`.
   */
  horizontalScale?: number;
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
  /**
   * Code points the export can encode with this run's font resource (its
   * inverted ToUnicode). Unset until probed; unset or empty means no reuse.
   */
  reusableFontGlyphs?: string;
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

/** A Figma text block whose glyphs make up a face (see `resolveGlyphFace`). */
export interface PdfGlyphFaceRef {
  pageId: string;
  showOrdinal: number;
}

/** Which edge or middle of a recognized line stays put when its text changes. */
export type PdfTextAnchor = "start" | "center" | "end";

/** How a run of outline-only text was recognized. */
export interface PdfOutlineTextSource {
  anchor: PdfTextAnchor;
  /** User-space x of the anchor (line start, middle or end) as recognized. */
  anchorX: number;
  /** OCR confidence for the line, 0–100. */
  confidence: number;
  /** User-space advance width of the line as recognized. */
  lineWidth: number;
  /** User-space pen origin x as recognized. */
  originX: number;
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
  /** Constant fill alpha (`ca`) below 1; unset means opaque. */
  opacity?: number;
}

export interface PdfVectorStrokeStyle {
  color: string;
  lineCap: number;
  lineJoin: number;
  /** Constant stroke alpha (`CA`) below 1; unset means opaque. */
  opacity?: number;
  width: number;
}

export type PdfLinkAction =
  | { kind: "url"; url: string }
  /** `pageIndex`: the target page within the link's source document, when resolved. */
  | { kind: "goto"; dest: unknown; pageIndex?: number }
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
  /** The vector's own path-painting operator, when it is top-level content. */
  removalTarget?: PdfPathRemovalTarget;
  /**
   * A fill covering (nearly) the whole page, drawn before any text: the page
   * background. Not selectable, so a click can't pick it and Delete can't
   * remove it.
   */
  pageBackground?: boolean;
  /**
   * Glyph outline of invisible Type3 text (Figma export), or outline-only
   * text recognized by OCR. Its text runs own it: it is their original ink
   * and is not selectable on its own.
   */
  textInk?: boolean;
  /**
   * Painted inside a form XObject. Kept only so outline-only text there can be
   * recognized; never selectable, and its ink can only be covered.
   */
  formNested?: boolean;
  type: "pdf-vector";
  width: number;
  x: number;
  y: number;
}

export type PdfFormFieldKind =
  | "text"
  | "checkbox"
  | "radio"
  | "dropdown"
  | "listbox"
  | "signature";

export interface PdfFormChoiceOption {
  display: string;
  exportValue: string;
}

export interface PdfFormWidget {
  /** Drawn border width in points; 0 without a border colour. Unset in old sessions. */
  borderWidth?: number;
  exportValue: string | null;
  /** The /DA font size; 0 sizes text to fit. Unset in old sessions. */
  fontSize?: number;
  height: number;
  id: string;
  pageId: string;
  sourceAnnotId: string;
  width: number;
  x: number;
  y: number;
}

interface PdfFormFieldBase {
  /** Source document the field belongs to; unset is the opened file. */
  docId?: string;
  id: string;
  name: string;
  readOnly: boolean;
  required: boolean;
  widgets: PdfFormWidget[];
}

export interface PdfFormTextField extends PdfFormFieldBase {
  align: TextAlign;
  comb: boolean;
  fileSelect: boolean;
  kind: "text";
  maxLength: number | null;
  multiline: boolean;
  originalValue: string;
  password: boolean;
  richText: boolean;
  value: string;
}

/**
 * The value is the on-state that is checked, or null when none is. Widgets
 * may have different on-states (a "Yes" box beside a "No" box).
 */
export interface PdfFormCheckboxField extends PdfFormFieldBase {
  kind: "checkbox";
  originalValue: string | null;
  value: string | null;
}

/** The on-state pdf-lib and Acrobat give a checkbox that names none. */
export const DEFAULT_CHECKBOX_ON_STATE = "Yes";

export interface PdfFormRadioField extends PdfFormFieldBase {
  kind: "radio";
  options: PdfFormChoiceOption[];
  originalValue: string | null;
  value: string | null;
}

export interface PdfFormDropdownField extends PdfFormFieldBase {
  editable: boolean;
  kind: "dropdown";
  options: PdfFormChoiceOption[];
  originalValue: string | null;
  value: string | null;
}

export interface PdfFormListboxField extends PdfFormFieldBase {
  kind: "listbox";
  multiSelect: boolean;
  options: PdfFormChoiceOption[];
  originalValue: string[];
  value: string[];
}

export interface PdfFormSignatureField extends PdfFormFieldBase {
  kind: "signature";
}

export type PdfFormField =
  | PdfFormTextField
  | PdfFormCheckboxField
  | PdfFormRadioField
  | PdfFormDropdownField
  | PdfFormListboxField
  | PdfFormSignatureField;

export interface PdfFormSignatureInfo {
  fieldName: string;
}

export interface PdfFormModel {
  fields: PdfFormField[];
  hasJavaScript: boolean;
  hasXfa: boolean;
  signatures: PdfFormSignatureInfo[];
}

export const EMPTY_PDF_FORM: PdfFormModel = {
  fields: [],
  hasJavaScript: false,
  hasXfa: false,
  signatures: [],
};

/**
 * Top-level operator totals pdf.js reported for a page's content. Export only
 * edits the raw content stream when its own counts match these.
 */
export interface PdfContentOpCounts {
  paths: number;
  shows: number;
}

/** Where a run's text-showing operator sits in the page's raw content. */
export interface PdfTextRemovalTarget {
  /** Glyphs pdf.js decoded from the operator, to verify the raw string. */
  glyphCount: number;
  /** Index among the page's top-level `Tj`/`TJ`/`'`/`"` operators. */
  showOrdinal: number;
}

/** Where a vector's path-painting operator sits in the page's raw content. */
export interface PdfPathRemovalTarget {
  /** pdf.js path bounds in the path's own coordinates: [minX, minY, maxX, maxY]. */
  box: readonly [number, number, number, number];
  /** Index among the page's top-level path-painting operators. */
  pathOrdinal: number;
}

/**
 * One glyph cut from a Figma text outline. Figma registers the same glyph
 * under a new code for every occurrence, so glyphs are keyed by shape.
 */
export interface PdfGlyphShape {
  /** `d1` box in em: [llx, lly, urx, ury]. */
  box: readonly [number, number, number, number];
  /** Outline in em, origin at the glyph's pen position, y up. Empty for spaces. */
  commands: PdfPathCommand[];
  /** Unicode, width and box, which identify one glyph of one face. */
  key: string;
  unicode: string;
  /** Advance in em. */
  width: number;
}

/** The glyphs one Figma text-showing operator drew, in order. */
export interface PdfGlyphShow {
  /** Shape keys of the drawn glyphs. */
  glyphs: string[];
  /** TJ adjustment (thousandths of an em, positive tightens) before each glyph. */
  kerning: number[];
  /** Same numbering as `PdfTextRemovalTarget.showOrdinal`. */
  showOrdinal: number;
}

/** Glyphs sliced from a page's Figma outlines. */
export interface PdfType3Glyphs {
  shapes: Record<string, PdfGlyphShape>;
  shows: PdfGlyphShow[];
}

/** Source document id of the opened file; pages without a `docId` use it. */
export const PRIMARY_DOC_ID = "primary";

export interface EditorPage {
  /** Set at load; missing means export never edits this page's content. */
  contentOpCounts?: PdfContentOpCounts;
  /** Source document the page comes from; unset is the opened file. */
  docId?: string;
  id: string;
  /** Index of the page within its source document. */
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
  /**
   * A duplicated page: form fields stay on the original, so the copy is
   * drawn and exported without the source page's widgets.
   */
  omitFormWidgets?: true;
  skippedPdfAnnotationSubtypes: string[];
  suppressedOcrWordIds?: readonly string[];
  /** Figma pages only: glyphs cut from text outlines, for rebuilding the face. */
  type3Glyphs?: PdfType3Glyphs;
}

export interface EditorDocument {
  form?: PdfFormModel;
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
  /** Line only. */
  dashed: boolean;
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
  dashed: false,
  fill: null,
  shape: "rect",
  stroke: "#111827",
  strokeWidth: 2,
};

export const DEFAULT_HIGHLIGHT_COLOR = "#facc15";

export const DEFAULT_REDACTION_FILL = "#000000";

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

/** A drag shorter than this (page pt) on both axes is a click, not a new object. */
export const MIN_CREATE_DRAG = 2;
export const MAX_PDF_BYTES = 80 * 1024 * 1024;
export const MAX_PDF_PAGES = 200;
/** All source documents together, since each is held several times over. */
export const MAX_TOTAL_SOURCE_BYTES = 160 * 1024 * 1024;
export const ZOOM_SETTLE_MS = 140;
