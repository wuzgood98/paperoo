import type { EditorPage } from "@/lib/editor/types";

/** Tailwind `gap-6` between stacked page frames. */
export const PAGE_STACK_GAP = 24;

/** Tailwind `p-8` on the viewport page stack. */
export const PAGE_STACK_PADDING = 32;

type PageGeometry = Pick<EditorPage, "height" | "rotation" | "width">;

export interface PageFrameCssSize {
  height: number;
  width: number;
}

export const pageFrameCssSize = (page: PageGeometry, zoom: number) => {
  const displayWidth = page.width * zoom;
  const displayHeight = page.height * zoom;
  const swapped = page.rotation % 180 !== 0;
  return {
    height: swapped ? displayWidth : displayHeight,
    width: swapped ? displayHeight : displayWidth,
  } satisfies PageFrameCssSize;
};

/**
 * Pick the page whose frame overlaps the vertical center band most
 * (same intent as IntersectionObserver rootMargin `-35% 0px -35% 0px`).
 */
export const activePageIdFromScroll = ({
  gap = PAGE_STACK_GAP,
  padding = PAGE_STACK_PADDING,
  pages,
  scrollTop,
  viewportHeight,
  zoom,
}: {
  gap?: number;
  padding?: number;
  pages: (PageGeometry & { id: string })[];
  scrollTop: number;
  viewportHeight: number;
  zoom: number;
}): string | null => {
  if (pages.length === 0 || viewportHeight <= 0) {
    return null;
  }

  const bandTop = scrollTop + viewportHeight * 0.35;
  const bandBottom = scrollTop + viewportHeight * 0.65;
  let y = padding;
  let bestId: string | null = null;
  let bestOverlap = 0;

  for (const page of pages) {
    const { height } = pageFrameCssSize(page, zoom);
    const pageTop = y;
    const pageBottom = y + height;
    const overlap = Math.max(
      0,
      Math.min(pageBottom, bandBottom) - Math.max(pageTop, bandTop)
    );
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      bestId = page.id;
    }
    y = pageBottom + gap;
  }

  if (bestId && bestOverlap > 0) {
    return bestId;
  }

  const center = scrollTop + viewportHeight / 2;
  y = padding;
  for (const page of pages) {
    const { height } = pageFrameCssSize(page, zoom);
    const pageBottom = y + height;
    if (center >= y && center < pageBottom + gap) {
      return page.id;
    }
    y = pageBottom + gap;
  }

  return pages.at(-1)?.id ?? null;
};
