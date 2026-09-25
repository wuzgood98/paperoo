"use client";

import { useEffect, useRef, useState } from "react";

import { EditorOverlay } from "@/components/editor/editor-overlay";
import { InspectorBar } from "@/components/editor/inspector-bar";
import { PdfCanvas } from "@/components/editor/pdf-canvas";
import { clamp } from "@/lib/editor/coordinates";
import { findPage } from "@/lib/editor/object-utils";
import { editorStore, useEditorStore } from "@/lib/editor/store";
import { MAX_ZOOM, MIN_ZOOM, ZOOM_SETTLE_MS } from "@/lib/editor/types";
import { openPdfFromList } from "@/lib/pdf/open-pdf";

export const EditorViewport = () => {
  const pages = useEditorStore((state) => state.document.pages);
  const currentPageId = useEditorStore((state) => state.currentPageId);
  const zoom = useEditorStore((state) => state.zoom);
  const page = findPage(pages, currentPageId);
  const scrollerRef = useRef<HTMLDivElement>(null);
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

  if (!page) {
    return null;
  }

  const displayZoom = previewZoom ?? zoom;
  const rasterScale = displayZoom / zoom;
  const displayWidth = page.width * displayZoom;
  const displayHeight = page.height * displayZoom;
  const frameWidth = page.rotation % 180 === 0 ? displayWidth : displayHeight;
  const frameHeight = page.rotation % 180 === 0 ? displayHeight : displayWidth;

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
          await openPdfFromList(event.dataTransfer.files);
        }}
        ref={scrollerRef}
      >
        <div className="flex min-h-full min-w-full items-center justify-center p-8">
          <div
            className="relative shrink-0 shadow-lg"
            style={{ height: frameHeight, width: frameWidth }}
          >
            <div
              className="absolute top-1/2 left-1/2 origin-center"
              style={{
                height: displayHeight,
                transform: `translate(-50%, -50%) rotate(${page.rotation}deg)`,
                width: displayWidth,
              }}
            >
              <div
                className="origin-top-left"
                style={{
                  height: page.height * zoom,
                  transform: `scale(${rasterScale})`,
                  width: page.width * zoom,
                }}
              >
                <PdfCanvas scale={zoom} sourceIndex={page.sourceIndex} />
                <EditorOverlay page={page} zoom={zoom} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
