"use client";

import { useEffect, useRef, useState } from "react";

import { EditorPageFrame } from "@/components/editor/editor-page-frame";
import { InspectorBar } from "@/components/editor/inspector-bar";
import { clamp } from "@/lib/editor/coordinates";
import { editorStore, useEditorStore } from "@/lib/editor/store";
import { MAX_ZOOM, MIN_ZOOM, ZOOM_SETTLE_MS } from "@/lib/editor/types";
import { openPdfFromList } from "@/lib/pdf/open-pdf";

const SCROLL_SPY_ROOT_MARGIN = "-35% 0px -35% 0px";
const SCROLL_SPY_SUPPRESS_MS = 500;
const SCROLL_SPY_THRESHOLDS = [0, 0.25, 0.5, 0.75, 1];

export const EditorViewport = () => {
  const pages = useEditorStore((state) => state.document.pages);
  const currentPageId = useEditorStore((state) => state.currentPageId);
  const zoom = useEditorStore((state) => state.zoom);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const pageEls = useRef(new Map<string, HTMLDivElement>());
  const fromScrollSpyRef = useRef(false);
  const ignoreScrollSpyUntil = useRef(0);
  const ratiosRef = useRef(new Map<string, number>());
  const [previewZoom, setPreviewZoom] = useState<number | null>(null);
  const [trackedZoom, setTrackedZoom] = useState(zoom);
  const previewRef = useRef(zoom);
  const settleTimer = useRef<number>(0);

  if (zoom !== trackedZoom) {
    setTrackedZoom(zoom);
    setPreviewZoom(null);
  }

  useEffect(() => {
    previewRef.current = zoom;
  }, [zoom]);

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

    node.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      observer.disconnect();
      node.removeEventListener("wheel", onWheel);
      window.clearTimeout(settleTimer.current);
    };
  }, []);

  const pageIds = pages.map((page) => page.id).join("\0");

  useEffect(() => {
    const root = scrollerRef.current;
    const ids = pageIds.length === 0 ? [] : pageIds.split("\0");
    if (!root || ids.length === 0) {
      return;
    }

    const ratios = ratiosRef.current;
    ratios.clear();

    const pickActive = (): void => {
      if (performance.now() < ignoreScrollSpyUntil.current) {
        return;
      }
      let bestId: string | null = null;
      let bestRatio = 0;
      for (const [id, ratio] of ratios) {
        if (ratio > bestRatio) {
          bestRatio = ratio;
          bestId = id;
        }
      }
      if (!bestId || bestRatio <= 0) {
        return;
      }
      if (bestId === editorStore.getState().currentPageId) {
        return;
      }
      fromScrollSpyRef.current = true;
      editorStore.setCurrentPage(bestId, { syncFitZoom: false });
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const { target } = entry;
          if (!(target instanceof HTMLElement)) {
            continue;
          }
          const id = target.dataset.pageId;
          if (!id) {
            continue;
          }
          ratios.set(id, entry.isIntersecting ? entry.intersectionRatio : 0);
        }
        pickActive();
      },
      {
        root,
        rootMargin: SCROLL_SPY_ROOT_MARGIN,
        threshold: SCROLL_SPY_THRESHOLDS,
      }
    );

    for (const id of ids) {
      const node = pageEls.current.get(id);
      if (node) {
        observer.observe(node);
      }
    }

    return () => {
      observer.disconnect();
    };
  }, [pageIds]);

  useEffect(() => {
    if (!currentPageId) {
      return;
    }
    if (fromScrollSpyRef.current) {
      fromScrollSpyRef.current = false;
      return;
    }
    const node = pageEls.current.get(currentPageId);
    if (!node) {
      return;
    }
    ignoreScrollSpyUntil.current = performance.now() + SCROLL_SPY_SUPPRESS_MS;
    node.scrollIntoView({ behavior: "instant", block: "nearest" });
  }, [currentPageId]);

  const setPageEl = (id: string, node: HTMLDivElement | null): void => {
    if (node) {
      pageEls.current.set(id, node);
      return;
    }
    pageEls.current.delete(id);
  };

  const displayZoom = previewZoom ?? zoom;

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
        <div className="flex min-w-full flex-col items-center gap-6 p-8">
          {pages.map((page) => (
            <EditorPageFrame
              displayZoom={displayZoom}
              key={page.id}
              page={page}
              pageRef={setPageEl}
              scrollerRef={scrollerRef}
              zoom={zoom}
            />
          ))}
        </div>
      </div>
    </div>
  );
};
