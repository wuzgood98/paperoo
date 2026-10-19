import type {
  CropBox,
  PageRotation,
  Point,
  Rect,
  Size,
} from "@/lib/editor/types";

export interface PageBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export const pixelSnapOffset = (
  position: number,
  devicePixelRatio: number
): number => {
  if (devicePixelRatio <= 0) {
    return 0;
  }
  return Math.round(position * devicePixelRatio) / devicePixelRatio - position;
};

export const degreesToRadians = (degrees: number): number =>
  (degrees * Math.PI) / 180;

export const normalizeRotation = (degrees: number): PageRotation => {
  const wrapped = ((degrees % 360) + 360) % 360;
  if (wrapped === 90 || wrapped === 180 || wrapped === 270) {
    return wrapped;
  }
  return 0;
};

/**
 * Rotation for a page canvas whose pixels line up with displayed space, where
 * the overlay and every run box live: the source /Rotate only. The user's
 * page rotation is a CSS transform on top, so samplers must not apply it.
 */
export const displayedCanvasRotation = (page: {
  sourceRotate: number;
}): PageRotation => normalizeRotation(page.sourceRotate);

/**
 * Rotation for a canvas that shows the page as the user sees it: the source
 * /Rotate plus the user's page rotation, baked into the pixels. The main page
 * canvas and the sidebar thumbnails both paint this way.
 */
export const shownCanvasRotation = (page: {
  rotation: number;
  sourceRotate: number;
}): PageRotation => normalizeRotation(page.sourceRotate + page.rotation);

export const rotatePoint = (
  point: Point,
  origin: Point,
  degrees: number
): Point => {
  if (degrees === 0) {
    return { x: point.x, y: point.y };
  }

  const radians = degreesToRadians(degrees);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;

  return {
    x: origin.x + dx * cos - dy * sin,
    y: origin.y + dx * sin + dy * cos,
  };
};

export const screenToPage = (
  screen: Point,
  pageBounds: PageBounds,
  zoom: number
): Point => ({
  x: (screen.x - pageBounds.left) / zoom,
  y: (screen.y - pageBounds.top) / zoom,
});

export const pageToScreen = (
  page: Point,
  pageBounds: PageBounds,
  zoom: number
): Point => ({
  x: pageBounds.left + page.x * zoom,
  y: pageBounds.top + page.y * zoom,
});

export const pageToCss = (value: number, zoom: number): number => value * zoom;

export const textBaselineY = (userHeight: number, ascent: number): number =>
  userHeight - ascent;

export const cssToPage = (value: number, zoom: number): number => value / zoom;

export const fitPageScale = (
  page: Size,
  viewport: Size,
  padding = 32
): number => {
  const availableWidth = Math.max(1, viewport.width - padding);
  const availableHeight = Math.max(1, viewport.height - padding);
  return Math.min(availableWidth / page.width, availableHeight / page.height);
};

export const fitWidthScale = (
  page: Size,
  viewport: Size,
  padding = 32
): number => {
  const availableWidth = Math.max(1, viewport.width - padding);
  return availableWidth / page.width;
};

export type PdfUserBox = Rect;

export const displayedToUserSpace = (
  box: Rect,
  crop: CropBox,
  rotate: PageRotation
): PdfUserBox => {
  const { x, y, width, height } = box;

  switch (rotate) {
    case 90: {
      return {
        height: width,
        width: height,
        x: crop.x + y,
        y: crop.y + x,
      };
    }
    case 180: {
      return {
        height,
        width,
        x: crop.x + crop.width - x - width,
        y: crop.y + y,
      };
    }
    case 270: {
      return {
        height: width,
        width: height,
        x: crop.x + crop.width - y - height,
        y: crop.y + crop.height - x - width,
      };
    }
    default: {
      return {
        height,
        width,
        x: crop.x + x,
        y: crop.y + crop.height - y - height,
      };
    }
  }
};

export const displayedPointToUserSpace = (
  point: Point,
  crop: CropBox,
  rotate: PageRotation
): Point => {
  const box = displayedToUserSpace(
    { height: 0, width: 0, x: point.x, y: point.y },
    crop,
    rotate
  );
  return { x: box.x, y: box.y };
};

export const DEFAULT_ASCENT_RATIO = 0.8;
export const DEFAULT_DESCENT_FLOOR = 0.25;

export const textDescentBelowBaseline = (
  em: number,
  ascentRatio: number,
  descentRatio: number
): number =>
  em * Math.max(1 - ascentRatio, Math.abs(descentRatio), DEFAULT_DESCENT_FLOOR);

export const userPointToDisplayed = (
  point: Point,
  crop: CropBox,
  rotate: PageRotation
): Point => {
  switch (rotate) {
    case 90: {
      return { x: point.y - crop.y, y: point.x - crop.x };
    }
    case 180: {
      return {
        x: crop.x + crop.width - point.x,
        y: point.y - crop.y,
      };
    }
    case 270: {
      return {
        x: crop.y + crop.height - point.y,
        y: crop.x + crop.width - point.x,
      };
    }
    default: {
      return {
        x: point.x - crop.x,
        y: crop.y + crop.height - point.y,
      };
    }
  }
};

export const userBoxToDisplayed = (
  box: Rect,
  crop: CropBox,
  rotate: PageRotation
): Rect => {
  switch (rotate) {
    case 90: {
      return {
        height: box.width,
        width: box.height,
        x: box.y - crop.y,
        y: box.x - crop.x,
      };
    }
    case 180: {
      return {
        height: box.height,
        width: box.width,
        x: crop.x + crop.width - box.x - box.width,
        y: box.y - crop.y,
      };
    }
    case 270: {
      return {
        height: box.width,
        width: box.height,
        x: crop.y + crop.height - box.y - box.height,
        y: crop.x + crop.width - box.x - box.width,
      };
    }
    default: {
      return {
        height: box.height,
        width: box.width,
        x: box.x - crop.x,
        y: crop.y + crop.height - box.y - box.height,
      };
    }
  }
};

export type TextItemTransform = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
];

/** Baseline origin from a pdf.js text-item matrix (ISO 32000-1 §9.4.2). */
export const pdfTextMatrixOrigin = (transform: TextItemTransform): Point => ({
  x: transform[4],
  y: transform[5],
});

export const pdfTextBaselineDisplayed = (
  transform: TextItemTransform,
  crop: CropBox,
  sourceRotate: PageRotation
): Point =>
  userPointToDisplayed(pdfTextMatrixOrigin(transform), crop, sourceRotate);

export const pdfTextBaselineUserSpace = (
  transform: TextItemTransform,
  crop: CropBox,
  sourceRotate: PageRotation
): Point =>
  displayedPointToUserSpace(
    pdfTextBaselineDisplayed(transform, crop, sourceRotate),
    crop,
    sourceRotate
  );

/** Runs within this many degrees of a page axis are treated as unturned. */
const TEXT_UPRIGHT_TOLERANCE_DEG = 1;

/** Baseline direction of a text matrix in user space, in degrees. */
export const pdfTextUserAngle = (transform: TextItemTransform): number =>
  (Math.atan2(transform[1], transform[0]) * 180) / Math.PI;

/**
 * True when the run's baseline is turned against the page's own axes (a `cm`
 * or `Tm` rotation), as opposed to only following a page `/Rotate`.
 */
export const isPdfTextTurned = (transform: TextItemTransform): boolean => {
  const turns = ((pdfTextUserAngle(transform) % 360) + 360) % 360;
  return (
    turns >= TEXT_UPRIGHT_TOLERANCE_DEG &&
    turns <= 360 - TEXT_UPRIGHT_TOLERANCE_DEG
  );
};

/**
 * Horizontal scale of a text matrix: advance-axis length over the em size.
 * 1 for ordinary text; 2.5 for `2.5 0 0 1 cm` or `Tz 250`. The em size is
 * the matrix's em-axis length |(c, d)|, except for Type3 faces where pdf.js
 * inflates that axis (see `textItemEmSize`).
 */
export const pdfTextHorizontalScale = (
  transform: TextItemTransform,
  em: number = Math.hypot(transform[2], transform[3])
): number => {
  const advance = Math.hypot(transform[0], transform[1]);
  if (!(advance > 0 && em > 0)) {
    return 1;
  }
  return advance / em;
};

export interface DisplayedTextBox extends Rect {
  fontSize: number;
  horizontalScale: number;
  rotation: number;
}

export const textItemToDisplayedBox = (
  transform: TextItemTransform,
  userWidth: number,
  userHeight: number,
  ascentRatio: number,
  crop: CropBox,
  sourceRotate: PageRotation,
  descentRatio = 0
): DisplayedTextBox => {
  const ratio =
    Number.isFinite(ascentRatio) && ascentRatio > 0
      ? ascentRatio
      : DEFAULT_ASCENT_RATIO;
  const descent = Number.isFinite(descentRatio) ? descentRatio : 0;
  const em = Math.abs(userHeight);
  const ascent = em * ratio;
  const belowBaseline = textDescentBelowBaseline(em, ratio, descent);
  const baseline = { x: transform[4], y: transform[5] };
  const userBox: Rect = {
    height: ascent + belowBaseline,
    width: Math.abs(userWidth),
    x: baseline.x,
    y: baseline.y - belowBaseline,
  };
  const advance = userPointToDisplayed(
    { x: baseline.x + transform[0], y: baseline.y + transform[1] },
    crop,
    sourceRotate
  );
  const origin = userPointToDisplayed(baseline, crop, sourceRotate);
  const rotation =
    (Math.atan2(advance.y - origin.y, advance.x - origin.x) * 180) / Math.PI;
  // A turned run's box is its unturned strip with the baseline origin at
  // (x, y + ascent); turning it by `rotation` about that point gives its ink.
  const displayed = isPdfTextTurned(transform)
    ? {
        height: userBox.height,
        width: userBox.width,
        x: origin.x,
        y: origin.y - ascent,
      }
    : userBoxToDisplayed(userBox, crop, sourceRotate);

  return {
    ...displayed,
    fontSize: em,
    horizontalScale: pdfTextHorizontalScale(transform, em),
    rotation,
  };
};

export const pointInRect = (point: Point, box: Rect): boolean =>
  point.x >= box.x &&
  point.x <= box.x + box.width &&
  point.y >= box.y &&
  point.y <= box.y + box.height;

export type Ctm = readonly [number, number, number, number, number, number];

export const IDENTITY_CTM: Ctm = [1, 0, 0, 1, 0, 0];
export const IMAGE_SKEW_EPSILON = 1e-3;
export const IMAGE_MIN_AXIS = 1e-4;

export const imageCtmToDisplayedBox = (
  ctm: Ctm,
  crop: CropBox,
  sourceRotate: PageRotation
): (Rect & { rotation: number }) | null => {
  const [a, b, c, d, e, f] = ctm;
  const widthLen = Math.hypot(a, b);
  const heightLen = Math.hypot(c, d);
  if (widthLen < IMAGE_MIN_AXIS || heightLen < IMAGE_MIN_AXIS) {
    return null;
  }
  const dot = a * c + b * d;
  if (Math.abs(dot) > IMAGE_SKEW_EPSILON * widthLen * heightLen) {
    return null;
  }

  const bottomLeft = userPointToDisplayed({ x: e, y: f }, crop, sourceRotate);
  const bottomRight = userPointToDisplayed(
    { x: e + a, y: f + b },
    crop,
    sourceRotate
  );
  const topLeft = userPointToDisplayed(
    { x: e + c, y: f + d },
    crop,
    sourceRotate
  );
  const topRight = userPointToDisplayed(
    { x: e + a + c, y: f + b + d },
    crop,
    sourceRotate
  );
  const width = Math.hypot(
    bottomRight.x - bottomLeft.x,
    bottomRight.y - bottomLeft.y
  );
  const height = Math.hypot(topLeft.x - bottomLeft.x, topLeft.y - bottomLeft.y);
  if (width < IMAGE_MIN_AXIS || height < IMAGE_MIN_AXIS) {
    return null;
  }

  const rotation =
    (Math.atan2(bottomRight.y - bottomLeft.y, bottomRight.x - bottomLeft.x) *
      180) /
    Math.PI;
  const centerX = (bottomLeft.x + bottomRight.x + topLeft.x + topRight.x) / 4;
  const centerY = (bottomLeft.y + bottomRight.y + topLeft.y + topRight.y) / 4;

  return {
    height,
    rotation,
    width,
    x: centerX - width / 2,
    y: centerY - height / 2,
  };
};

export const multiplyCtm = (left: Ctm, right: Ctm): Ctm => [
  left[0] * right[0] + left[2] * right[1],
  left[1] * right[0] + left[3] * right[1],
  left[0] * right[2] + left[2] * right[3],
  left[1] * right[2] + left[3] * right[3],
  left[0] * right[4] + left[2] * right[5] + left[4],
  left[1] * right[4] + left[3] * right[5] + left[5],
];

export const centerRotateCtm = (
  centerX: number,
  centerY: number,
  width: number,
  height: number,
  degrees: number
): Ctm => {
  const radians = degreesToRadians(degrees);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const toCenter: Ctm = [1, 0, 0, 1, centerX, centerY];
  const rotate: Ctm = [cos, sin, -sin, cos, 0, 0];
  const toBottomLeft: Ctm = [1, 0, 0, 1, -width / 2, -height / 2];
  return multiplyCtm(multiplyCtm(toCenter, rotate), toBottomLeft);
};

export type ResizeHandle = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

/**
 * Extents at or below this are a straight line's thickness, not a size: a
 * zero-height path is floored to a hair (1e-4) at extraction, and scaling
 * against that hair turns any resize into a ~10^5x stretch.
 */
export const DEGENERATE_EXTENT = 1e-2;

export const isDegenerateExtent = (extent: number): boolean =>
  extent <= DEGENERATE_EXTENT;

/** Scale of one axis from its original extent; flat axes never stretch. */
export const vectorAxisScale = (original: number, current: number): number =>
  isDegenerateExtent(original) ? 1 : current / original;

/**
 * Stroke width multiplier for a resized vector: the area scale of its two
 * axes. A straight line has no second axis, so its stroke keeps its width.
 */
export const vectorStrokeScale = (box: {
  height: number;
  originalHeight: number;
  originalWidth: number;
  width: number;
}): number => {
  if (
    isDegenerateExtent(box.originalWidth) ||
    isDegenerateExtent(box.originalHeight)
  ) {
    return 1;
  }
  return Math.sqrt(
    Math.abs(
      vectorAxisScale(box.originalWidth, box.width) *
        vectorAxisScale(box.originalHeight, box.height)
    )
  );
};

export const HANDLE_LOCAL_OFFSET: Record<ResizeHandle, Point> = {
  e: { x: 0.5, y: 0 },
  n: { x: 0, y: -0.5 },
  ne: { x: 0.5, y: -0.5 },
  nw: { x: -0.5, y: -0.5 },
  s: { x: 0, y: 0.5 },
  se: { x: 0.5, y: 0.5 },
  sw: { x: -0.5, y: 0.5 },
  w: { x: -0.5, y: 0 },
};

export const objectCenter = (box: Rect): Point => ({
  x: box.x + box.width / 2,
  y: box.y + box.height / 2,
});

export const resizeRotatedBox = (
  box: Rect,
  rotation: number,
  handle: ResizeHandle,
  pointer: Point,
  options: { minSize: number; lockAspect: boolean }
): Rect => {
  // A flat axis (a straight line's thickness) stays flat: clamping it to
  // `minSize` would stretch the path by minSize / hair on export.
  const flatX = isDegenerateExtent(box.width);
  const flatY = isDegenerateExtent(box.height);
  const center = objectCenter(box);
  const handleOffset = {
    x: flatX ? 0 : HANDLE_LOCAL_OFFSET[handle].x,
    y: flatY ? 0 : HANDLE_LOCAL_OFFSET[handle].y,
  };
  const oppositeWorld = rotatePoint(
    {
      x: center.x - handleOffset.x * box.width,
      y: center.y - handleOffset.y * box.height,
    },
    center,
    rotation
  );
  const pointerLocal = rotatePoint(pointer, oppositeWorld, -rotation);
  const localX = pointerLocal.x - oppositeWorld.x;
  const localY = pointerLocal.y - oppositeWorld.y;

  let nextWidth = handleOffset.x === 0 ? box.width : Math.abs(localX);
  let nextHeight = handleOffset.y === 0 ? box.height : Math.abs(localY);

  if (options.lockAspect && !flatX && !flatY) {
    const aspect = box.width / box.height;
    if (handleOffset.x !== 0 && handleOffset.y !== 0) {
      if (nextWidth / aspect > nextHeight) {
        nextHeight = nextWidth / aspect;
      } else {
        nextWidth = nextHeight * aspect;
      }
    } else if (handleOffset.x === 0) {
      nextWidth = nextHeight * aspect;
    } else {
      nextHeight = nextWidth / aspect;
    }
  }

  if (!flatX) {
    nextWidth = Math.max(options.minSize, nextWidth);
  }
  if (!flatY) {
    nextHeight = Math.max(options.minSize, nextHeight);
  }

  const signX =
    handleOffset.x === 0 ? 0 : Math.sign(localX) || Math.sign(handleOffset.x);
  const signY =
    handleOffset.y === 0 ? 0 : Math.sign(localY) || Math.sign(handleOffset.y);
  const nextCenter = rotatePoint(
    {
      x: oppositeWorld.x + (signX * nextWidth) / 2,
      y: oppositeWorld.y + (signY * nextHeight) / 2,
    },
    oppositeWorld,
    rotation
  );

  return {
    height: nextHeight,
    width: nextWidth,
    x: nextCenter.x - nextWidth / 2,
    y: nextCenter.y - nextHeight / 2,
  };
};

export const objectWrapperStyle = (
  object: Rect & { opacity?: number; rotation: number },
  zoom: number
) => ({
  height: pageToCss(object.height, zoom),
  left: pageToCss(object.x, zoom),
  opacity: object.opacity ?? 1,
  top: pageToCss(object.y, zoom),
  transform: `rotate(${object.rotation}deg)`,
  width: pageToCss(object.width, zoom),
});
