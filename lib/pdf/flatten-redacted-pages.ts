import type { FlattenedPage } from "@/lib/pdf/export-flatten";
import { textClearOfBoxes } from "@/lib/pdf/output-pages";
import type {
  PositionedText,
  RedactedOutputPage,
  RedactionBox,
} from "@/lib/pdf/output-pages";

/** At most 144 dpi: twice the 72-unit PDF inch. */
const MAX_RENDER_SCALE = 2;
/** A page picture never holds more pixels than this. */
const MAX_RENDER_PIXELS = 16e6;
/** pdf.js AnnotationMode.ENABLE: widgets and annotations are burned in. */
const ANNOTATION_MODE_ENABLE = 1;

/** A pdf.js text content entry: a positioned run, or a marked-content tag. */
type TextContentItem = PositionedText | { type: string };

/** The slice of a pdf.js page the flattener uses. */
export interface FlattenSourcePage {
  getTextContent: () => Promise<{ items: readonly TextContentItem[] }>;
  getViewport: (params: { rotation: number; scale: number }) => {
    convertToViewportPoint: (x: number, y: number) => number[];
    height: number;
    width: number;
  };
  render: (params: {
    annotationMode: number;
    canvas: never;
    canvasContext: CanvasRenderingContext2D;
    viewport: never;
  }) => { promise: Promise<void> };
  view: readonly number[];
}

export interface FlattenSource {
  destroy: () => Promise<void>;
  getPage: (pageNumber: number) => Promise<FlattenSourcePage>;
}

export interface FlattenDeps<Canvas> {
  createCanvas: (
    width: number,
    height: number
  ) => { canvas: Canvas; context: CanvasRenderingContext2D };
  encodeJpeg: (canvas: Canvas) => Promise<Uint8Array>;
  /** Pass 1 opened in a pdf.js document of its own. */
  open: (bytes: Uint8Array) => Promise<FlattenSource>;
}

/** 144 dpi, or less so the picture stays within the pixel budget. */
export const flattenScale = (width: number, height: number): number =>
  Math.min(MAX_RENDER_SCALE, Math.sqrt(MAX_RENDER_PIXELS / (width * height)));

/** The runs to keep searchable: those with text, clear of every box. */
const keptText = (
  items: readonly TextContentItem[],
  boxes: readonly RedactionBox[]
): PositionedText[] => {
  const kept: PositionedText[] = [];
  for (const item of items) {
    if (
      "str" in item &&
      item.str.trim() !== "" &&
      textClearOfBoxes(item, boxes)
    ) {
      kept.push({
        height: item.height,
        str: item.str,
        transform: [...item.transform],
        width: item.width,
      });
    }
  }
  return kept;
};

/**
 * Render each redacted page of pass 1 with its boxes painted in, and keep
 * the page's text that stays clear of every box. Pages render at rotation 0
 * so the picture lines up with user space; pass 2 restores `/Rotate`.
 */
export const renderRedactedPages = async <Canvas>(
  pass1: Uint8Array,
  plan: readonly RedactedOutputPage[],
  deps: FlattenDeps<Canvas>
): Promise<FlattenedPage[]> => {
  const source = await deps.open(pass1);
  try {
    const pages: FlattenedPage[] = [];
    for (const { boxes, outputIndex } of plan) {
      // oxlint-disable-next-line react-doctor/async-await-in-loop eslint/no-await-in-loop -- one page canvas at a time bounds memory
      const page = await source.getPage(outputIndex + 1);
      const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = page.view;
      const viewport = page.getViewport({
        rotation: 0,
        scale: flattenScale(x1 - x0, y1 - y0),
      });
      const width = Math.max(1, Math.round(viewport.width));
      const height = Math.max(1, Math.round(viewport.height));
      const { canvas, context } = deps.createCanvas(width, height);
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      // oxlint-disable-next-line react-doctor/async-await-in-loop eslint/no-await-in-loop -- one page canvas at a time bounds memory
      await page.render({
        annotationMode: ANNOTATION_MODE_ENABLE,
        // SAFETY: pdf.js takes the canvas and viewport it created; the types
        // here are only the slice the flattener reads.
        canvas: canvas as never,
        canvasContext: context,
        // SAFETY: as above, the viewport came from this page.
        viewport: viewport as never,
      }).promise;
      for (const box of boxes) {
        const [ax = 0, ay = 0] = viewport.convertToViewportPoint(box.x, box.y);
        const [bx = 0, by = 0] = viewport.convertToViewportPoint(
          box.x + box.width,
          box.y + box.height
        );
        // Whole pixels, rounded outward, so no edge of the content shows.
        const left = Math.floor(Math.min(ax, bx));
        const top = Math.floor(Math.min(ay, by));
        context.fillStyle = box.fill;
        context.fillRect(
          left,
          top,
          Math.ceil(Math.max(ax, bx)) - left,
          Math.ceil(Math.max(ay, by)) - top
        );
      }
      // oxlint-disable-next-line react-doctor/async-await-in-loop eslint/no-await-in-loop -- one page canvas at a time bounds memory
      const content = await page.getTextContent();
      const text = keptText(content.items, boxes);
      // oxlint-disable-next-line react-doctor/async-await-in-loop eslint/no-await-in-loop -- one page canvas at a time bounds memory
      const jpeg = await deps.encodeJpeg(canvas);
      pages.push({ boxes, jpeg, outputIndex, text });
    }
    return pages;
  } finally {
    await source.destroy();
  }
};
