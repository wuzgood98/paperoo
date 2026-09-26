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

export const degreesToRadians = (degrees: number): number =>
  (degrees * Math.PI) / 180;

export const normalizeRotation = (degrees: number): PageRotation => {
  const wrapped = ((degrees % 360) + 360) % 360;
  if (wrapped === 90 || wrapped === 180 || wrapped === 270) {
    return wrapped;
  }
  return 0;
};

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

export interface DisplayedTextBox extends Rect {
  fontSize: number;
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
  const displayed = userBoxToDisplayed(userBox, crop, sourceRotate);
  const advance = userPointToDisplayed(
    { x: baseline.x + transform[0], y: baseline.y + transform[1] },
    crop,
    sourceRotate
  );
  const origin = userPointToDisplayed(baseline, crop, sourceRotate);
  const rotation =
    (Math.atan2(advance.y - origin.y, advance.x - origin.x) * 180) / Math.PI;

  return {
    ...displayed,
    fontSize: em,
    rotation,
  };
};

export const pointInRect = (point: Point, box: Rect): boolean =>
  point.x >= box.x &&
  point.x <= box.x + box.width &&
  point.y >= box.y &&
  point.y <= box.y + box.height;

export type Ctm = readonly [number, number, number, number, number, number];

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
  const center = objectCenter(box);
  const handleOffset = HANDLE_LOCAL_OFFSET[handle];
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

  if (options.lockAspect && box.width > 0 && box.height > 0) {
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

  nextWidth = Math.max(options.minSize, nextWidth);
  nextHeight = Math.max(options.minSize, nextHeight);

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
