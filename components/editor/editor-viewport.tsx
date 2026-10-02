"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useRef, useState } from "react";

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
import { openPdfFromList } from "@/lib/pdf/open-pdf";
import { pdfSession } from "@/lib/pdf/session";

const SCROLL_SPY_SUPPRESS_MS = 500;
const VIRTUAL_OVERSCAN = 2;

export const EditorViewport = () => {
  const pages = useEditorStore((state) => state.document.pages);
  const currentPageId = useEditorStore((state) => state.currentPageId);
  const zoom = useEditorStore((state) => state.zoom);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const fromScrollSpyRef = useRef(false);
  const ignoreScrollSpyUntil = useRef(0);
  const [previewZoom, setPreviewZoom] = useState<number | null>(null);
  const [trackedZoom, setTrackedZoom] = useState(zoom);
  const previewRef = useRef(zoom);
  const settleTimer = useRef<number>(0);
  const scrollRaf = useRef(0);

  if (zoom !== trackedZoom) {
    setTrackedZoom(zoom);
    setPreviewZoom(null);
  }

  const displayZoom = previewZoom ?? zoom;

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

  const pagesMeasureKey = pages
    .map((page) => `${page.id}:${page.rotation}:${page.width}:${page.height}`)
    .join("\0");

  useEffect(() => {
    virtualizer.measure();
  }, [displayZoom, pagesMeasureKey, virtualizer]);

  useEffect(() => {
    pdfSession.setIdleCacheBudget(Math.max(virtualItems.length, 1));
  }, [virtualItems.length]);

  useEffect(() => {
    const node = scrollerRef.current;
    if (!node) {
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
      editorStore.setViewportSize({
        height: entry.contentRect.height,
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
      setPreviewZoom(next);
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
        pages,
        scrollTop: node.scrollTop,
        viewportHeight: node.clientHeight,
        zoom: displayZoom,
      });
      if (!activeId || activeId === editorStore.getState().currentPageId) {
        return;
      }
      fromScrollSpyRef.current = true;
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
    };
  }, [displayZoom, pages]);

  useEffect(() => {
    if (!currentPageId) {
      return;
    }
    if (fromScrollSpyRef.current) {
      fromScrollSpyRef.current = false;
      return;
    }
    const index = pages.findIndex((page) => page.id === currentPageId);
    if (index === -1) {
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
      <InspectorBar />
      <div
        className="min-h-0 flex-1 overflow-auto"
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
                  page={page}
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
