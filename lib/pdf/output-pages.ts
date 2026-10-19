import { displayedToUserSpace } from "@/lib/editor/coordinates";
import type { EditorDocument, EditorPage } from "@/lib/editor/types";

/** A rect in PDF user space: origin bottom-left, y up. */
export interface UserRect {
  height: number;
  width: number;
  x: number;
  y: number;
}

/** A redaction box on an output page, in that page's user space. */
export interface RedactionBox extends UserRect {
  fill: string;
}

/** An output page with content to redact, by its position in the output. */
export interface RedactedOutputPage {
  boxes: RedactionBox[];
  outputIndex: number;
}

/** The pages to write: all of them, or the extracted ones in order. */
export const outputPagesOf = (input: {
  document: EditorDocument;
  pageIds?: readonly string[];
}): EditorPage[] => {
  if (!input.pageIds) {
    return input.document.pages;
  }
  const wanted = new Set(input.pageIds);
  const pages = input.document.pages.filter((page) => wanted.has(page.id));
  if (pages.length === 0) {
    throw new Error("Choose at least one page to export.");
  }
  return pages;
};

export const pageHasRedactions = (page: EditorPage): boolean =>
  page.objects.some((object) => object.type === "redaction");

/** Whether any page, exported or not, holds a redaction. */
export const documentHasRedactions = (document: EditorDocument): boolean =>
  document.pages.some(pageHasRedactions);

const clipToCrop = (rect: UserRect, page: EditorPage): UserRect | null => {
  const crop = page.cropBox;
  const x0 = Math.max(rect.x, crop.x);
  const y0 = Math.max(rect.y, crop.y);
  const x1 = Math.min(rect.x + rect.width, crop.x + crop.width);
  const y1 = Math.min(rect.y + rect.height, crop.y + crop.height);
  return x1 > x0 && y1 > y0
    ? { height: y1 - y0, width: x1 - x0, x: x0, y: y0 }
    : null;
};

/** A page's redaction boxes in user space, clipped to its crop box. */
export const pageRedactionBoxes = (page: EditorPage): RedactionBox[] => {
  const boxes: RedactionBox[] = [];
  for (const object of page.objects) {
    if (object.type !== "redaction") {
      continue;
    }
    const clipped = clipToCrop(
      displayedToUserSpace(object, page.cropBox, page.sourceRotate),
      page
    );
    if (clipped) {
      boxes.push({ ...clipped, fill: object.fill });
    }
  }
  return boxes;
};

/**
 * Each output page's redaction boxes in user space, clipped to the crop box.
 * Pages without a box inside their crop are left out.
 */
export const redactionPlan = (
  document: EditorDocument,
  pageIds?: readonly string[]
): RedactedOutputPage[] =>
  outputPagesOf({ document, pageIds }).flatMap((page, outputIndex) => {
    const boxes = pageRedactionBoxes(page);
    return boxes.length > 0 ? [{ boxes, outputIndex }] : [];
  });

/** Margin around text that still counts as touching a box (pt). */
const TEXT_TOUCH_MARGIN = 1;
/** Glyphs reach this far below the baseline, as a share of the item height. */
const TEXT_DESCENT_SHARE = 0.25;

/** A text item as pdf.js reports it: a user-space text matrix and extent. */
export interface PositionedText {
  height: number;
  str: string;
  transform: readonly number[];
  width: number;
}

/** The item's box in user space, padded by `margin`. */
const textBounds = (
  item: PositionedText,
  margin = TEXT_TOUCH_MARGIN
): UserRect => {
  const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = item.transform;
  const run = Math.hypot(a, b) || 1;
  const rise = Math.hypot(c, d) || 1;
  const ux = (a / run) * item.width;
  const uy = (b / run) * item.width;
  const vx = (c / rise) * item.height;
  const vy = (d / rise) * item.height;
  const below = { x: -vx * TEXT_DESCENT_SHARE, y: -vy * TEXT_DESCENT_SHARE };
  const xs = [e + below.x, e + ux + below.x, e + ux + vx, e + vx];
  const ys = [f + below.y, f + uy + below.y, f + uy + vy, f + vy];
  const x0 = Math.min(...xs) - margin;
  const y0 = Math.min(...ys) - margin;
  return {
    height: Math.max(...ys) + margin - y0,
    width: Math.max(...xs) + margin - x0,
    x: x0,
    y: y0,
  };
};

const rectsTouch = (a: UserRect, b: UserRect): boolean =>
  a.x <= b.x + b.width &&
  b.x <= a.x + a.width &&
  a.y <= b.y + b.height &&
  b.y <= a.y + a.height;

/** Whether a text item stays clear of every box, even by a point. */
export const textClearOfBoxes = (
  item: PositionedText,
  boxes: readonly UserRect[]
): boolean => {
  const bounds = textBounds(item);
  return boxes.every((box) => !rectsTouch(bounds, box));
};

/**
 * Whether a text item covers part of a box (sharing only an edge does not
 * count): what a reader could still pull out from under it.
 */
export const textOverlapsBoxes = (
  item: PositionedText,
  boxes: readonly UserRect[]
): boolean => {
  const bounds = textBounds(item, 0);
  return boxes.some(
    (box) =>
      bounds.x < box.x + box.width &&
      box.x < bounds.x + bounds.width &&
      bounds.y < box.y + box.height &&
      box.y < bounds.y + bounds.height
  );
};

/** Whether a user-space rect `[x0, y0, x1, y1]` touches any box. */
export const rectArrayTouchesBoxes = (
  rect: readonly number[],
  boxes: readonly UserRect[]
): boolean => {
  const [ax = 0, ay = 0, bx = 0, by = 0] = rect;
  const bounds = {
    height: Math.abs(by - ay),
    width: Math.abs(bx - ax),
    x: Math.min(ax, bx),
    y: Math.min(ay, by),
  };
  return boxes.some((box) => rectsTouch(bounds, box));
};
