"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { EditorPageFrame } from "@/components/editor/editor-page-frame";
import { InspectorBar } from "@/components/editor/inspector-bar";
import { clamp } from "@/lib/editor/coordinates";
import {
  activePageIdFromScroll,
  PAGE_STACK_GAP,
  PAGE_STACK_PADDING,
  pageFrameCssSize,
} from "@/lib/editor/page-frame-size";
import { editorStore, useEditorStore } from "@/lib/editor/store";
import { MAX_ZOOM, MIN_ZOOM, ZOOM_SETTLE_MS } from "@/lib/editor/types";
import { classifyPageForOcr } from "@/lib/ocr/classify-page";
import { outlineTextSession } from "@/lib/ocr/outline-session";
import { ocrSession } from "@/lib/ocr/session";
import { openPdfFromList } from "@/lib/pdf/open-pdf";
import { pdfSession } from "@/lib/pdf/session";

const SCROLL_SPY_SUPPRESS_MS = 500;
const VIRTUAL_OVERSCAN = 2;

export const EditorViewport = () => {
  const pages = useEditorStore((state) => state.document.pages);
  const currentPageId = useEditorStore((state) => state.currentPageId);
  const zoom = useEditorStore((state) => state.zoom);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const inspectorRef = useRef<HTMLDivElement>(null);
  const skipRevealRef = useRef(false);
  const revealedRef = useRef<{ id: string; index: number } | null>(null);
  const ignoreScrollSpyUntil = useRef(0);
  const [previewZoom, setPreviewZoom] = useState<number | null>(null);
  const [trackedZoom, setTrackedZoom] = useState(zoom);
  const previewRef = useRef(zoom);
  const settleTimer = useRef<number>(0);
  const scrollRaf = useRef(0);
  const zoomRaf = useRef(0);

  if (zoom !== trackedZoom) {
    setTrackedZoom(zoom);
    setPreviewZoom(null);
  }

  const displayZoom = previewZoom ?? zoom;
  // Scroll and wheel listeners read these, so they are set up once instead
  // of on every edit (each edit makes a new `pages` array) and zoom step.
  const pagesRef = useRef(pages);
  const displayZoomRef = useRef(displayZoom);
  useEffect(() => {
    pagesRef.current = pages;
    displayZoomRef.current = displayZoom;
  }, [displayZoom, pages]);

  // oxlint-disable-next-line react/incompatible-library -- TanStack Virtual is not React Compiler memo-safe
  const virtualizer = useVirtualizer({
    count: pages.length,
    estimateSize: (index) => {
      const page = pages[index];
      if (!page) {
        return 0;
      }
      return pageFrameCssSize(page, displayZoom).height;
    },
    gap: PAGE_STACK_GAP,
    getItemKey: (index) => pages[index]?.id ?? index,
    getScrollElement: () => scrollerRef.current,
    overscan: VIRTUAL_OVERSCAN,
    paddingEnd: PAGE_STACK_PADDING,
    paddingStart: PAGE_STACK_PADDING,
  });

  useEffect(() => {
    previewRef.current = zoom;
  }, [zoom]);

  const virtualItems = virtualizer.getVirtualItems();

  const pagesMeasureKey = useMemo(
    () =>
      pages
        .map(
          (page) => `${page.id}:${page.rotation}:${page.width}:${page.height}`
        )
        .join("\0"),
    [pages]
  );

  useEffect(() => {
    virtualizer.measure();
  }, [displayZoom, pagesMeasureKey, virtualizer]);

  useEffect(() => {
    pdfSession.setIdleCacheBudget(Math.max(virtualItems.length, 1));
  }, [virtualItems.length]);

  const visiblePageKey = virtualItems
    .map((item) => pages[item.index]?.id ?? "")
    .join("\0");

  useEffect(() => {
    const visibleIds = new Set(visiblePageKey.split("\0").filter(Boolean));
    ocrSession.keepVisible(visibleIds);
    const count = pages.length;
    for (const [index, page] of pages.entries()) {
      if (!visibleIds.has(page.id)) {
        continue;
      }
      outlineTextSession.enqueuePage(page);
      if (classifyPageForOcr(page) !== "scanned") {
        continue;
      }
      ocrSession.enqueueVisible(page, {
        pageCount: count,
        pageNumber: index + 1,
      });
    }
  }, [pages, visiblePageKey]);

  const hasPages = pages.length > 0;
  useEffect(() => {
    const node = scrollerRef.current;
    if (!(hasPages && node)) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const [entry] = entries;
      if (
        !entry ||
        entry.contentRect.width === 0 ||
        entry.contentRect.height === 0
      ) {
        return;
      }
      // Count the inspector strip as viewport so selecting an object does not
      // read as a resize and refit zoom to a differently sized current page.
      const stripHeight =
        inspectorRef.current?.getBoundingClientRect().height ?? 0;
      editorStore.setViewportSize({
        height: Math.round(entry.contentRect.height + stripHeight),
        width: entry.contentRect.width,
      });
    });
    observer.observe(node);

    const onWheel = (event: WheelEvent): void => {
      if (!(event.ctrlKey || event.metaKey)) {
        return;
      }
      event.preventDefault();
      const next = clamp(
        previewRef.current * (event.deltaY < 0 ? 1.08 : 0.92),
        MIN_ZOOM,
        MAX_ZOOM
      );
      previewRef.current = next;
      // Trackpads send a wheel event per display frame or faster; render
      // the preview at most once per frame.
      window.cancelAnimationFrame(zoomRaf.current);
      zoomRaf.current = window.requestAnimationFrame(() => {
        setPreviewZoom(previewRef.current);
      });
      window.clearTimeout(settleTimer.current);
      settleTimer.current = window.setTimeout(() => {
        editorStore.setZoom(next, "custom");
      }, ZOOM_SETTLE_MS);
    };

    const syncActivePage = (): void => {
      if (performance.now() < ignoreScrollSpyUntil.current) {
        return;
      }
      const activeId = activePageIdFromScroll({
        pages: pagesRef.current,
        scrollTop: node.scrollTop,
        viewportHeight: node.clientHeight,
        zoom: displayZoomRef.current,
      });
      if (!activeId || activeId === editorStore.getState().currentPageId) {
        return;
      }
      skipRevealRef.current = true;
      editorStore.setCurrentPage(activeId, { syncFitZoom: false });
    };

    const onScroll = (): void => {
      window.cancelAnimationFrame(scrollRaf.current);
      scrollRaf.current = window.requestAnimationFrame(syncActivePage);
    };

    node.addEventListener("wheel", onWheel, { passive: false });
    node.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      observer.disconnect();
      node.removeEventListener("wheel", onWheel);
      node.removeEventListener("scroll", onScroll);
      window.clearTimeout(settleTimer.current);
      window.cancelAnimationFrame(scrollRaf.current);
      window.cancelAnimationFrame(zoomRaf.current);
    };
  }, [hasPages]);

  // The inspector strip sits above the scroller, so mounting or resizing it
  // moves every page on screen. Shift scrollTop by the same amount to keep
  // the content still. Resize observers run before paint, so nothing jumps.
  useEffect(() => {
    const strip = inspectorRef.current;
    const scroller = scrollerRef.current;
    if (!(hasPages && strip && scroller)) {
      return;
    }
    let previousHeight: number | null = null;
    const observer = new ResizeObserver(() => {
      const { height } = strip.getBoundingClientRect();
      if (previousHeight !== null && height !== previousHeight) {
        ignoreScrollSpyUntil.current =
          performance.now() + SCROLL_SPY_SUPPRESS_MS;
        scroller.scrollTop += height - previousHeight;
      }
      previousHeight = height;
    });
    observer.observe(strip);
    return () => {
      observer.disconnect();
    };
  }, [hasPages]);

  const activatePage = useCallback((pageId: string): void => {
    skipRevealRef.current = true;
    editorStore.setCurrentPage(pageId, { syncFitZoom: false });
  }, []);

  useEffect(() => {
    if (!currentPageId) {
      return;
    }
    const index = pages.findIndex((page) => page.id === currentPageId);
    if (index === -1) {
      return;
    }
    // `pages` changes on every document edit (including text measurement
    // when an edit opens). Reveal only when the current page or its slot moves.
    const revealed = revealedRef.current;
    if (revealed?.id === currentPageId && revealed.index === index) {
      return;
    }
    revealedRef.current = { id: currentPageId, index };
    if (skipRevealRef.current) {
      skipRevealRef.current = false;
      return;
    }
    ignoreScrollSpyUntil.current = performance.now() + SCROLL_SPY_SUPPRESS_MS;
    virtualizer.scrollToIndex(index, { align: "auto", behavior: "auto" });
  }, [currentPageId, pages, virtualizer]);

  if (pages.length === 0) {
    return null;
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div ref={inspectorRef}>
        <InspectorBar />
      </div>
      <div
        className="min-h-0 flex-1 overflow-auto overscroll-contain"
        onDragOver={(event) => {
          event.preventDefault();
        }}
        onDrop={async (event) => {
          event.preventDefault();
          const [file] = event.dataTransfer.files;
          if (file?.type && file.type !== "application/pdf") {
            return;
          }
          await openPdfFromList(event.dataTransfer.files);
        }}
        ref={scrollerRef}
      >
        <div
          className="relative w-full"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualItems.map((item) => {
            const page = pages[item.index];
            if (!page) {
              return null;
            }
            return (
              <div
                className="absolute top-0 left-0 flex w-full justify-center"
                data-index={item.index}
                key={item.key}
                style={{
                  height: item.size,
                  transform: `translateY(${item.start}px)`,
                }}
              >
                <EditorPageFrame
                  displayZoom={displayZoom}
                  onActivate={activatePage}
                  page={page}
                  pageCount={pages.length}
                  pageNumber={item.index + 1}
                  zoom={zoom}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
