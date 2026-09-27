"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { EditorOverlay } from "@/components/editor/editor-overlay";
import { InspectorBar } from "@/components/editor/inspector-bar";
import { PdfCanvas } from "@/components/editor/pdf-canvas";
import {
  clamp,
  normalizeRotation,
  pixelSnapOffset,
} from "@/lib/editor/coordinates";
import { findPage } from "@/lib/editor/object-utils";
import { editorStore, useEditorStore } from "@/lib/editor/store";
import { MAX_ZOOM, MIN_ZOOM, ZOOM_SETTLE_MS } from "@/lib/editor/types";
import { useDevicePixelRatio } from "@/lib/pdf/device-pixel-ratio";
import { openPdfFromList } from "@/lib/pdf/open-pdf";

export const EditorViewport = () => {
  const pages = useEditorStore((state) => state.document.pages);
  const currentPageId = useEditorStore((state) => state.currentPageId);
  const zoom = useEditorStore((state) => state.zoom);
  const page = findPage(pages, currentPageId);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [previewZoom, setPreviewZoom] = useState<number | null>(null);
  const [trackedZoom, setTrackedZoom] = useState(zoom);
  const [snap, setSnap] = useState({ x: 0, y: 0 });
  const previewRef = useRef(zoom);
  const settleTimer = useRef<number>(0);
  const pixelRatio = useDevicePixelRatio();

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

  const displayZoom = previewZoom ?? zoom;
  const rasterScale = displayZoom / zoom;
  const previewing = previewZoom !== null && rasterScale !== 1;
  const pageWidth = page ? page.width * zoom : 0;
  const pageHeight = page ? page.height * zoom : 0;
  const displayWidth = page ? page.width * displayZoom : 0;
  const displayHeight = page ? page.height * displayZoom : 0;
  const swapped = page ? page.rotation % 180 !== 0 : false;
  const frameWidth = swapped ? displayHeight : displayWidth;
  const frameHeight = swapped ? displayWidth : displayHeight;
  const canvasWidth = swapped ? pageHeight : pageWidth;
  const canvasHeight = swapped ? pageWidth : pageHeight;
  const canvasRotation = page
    ? normalizeRotation(page.sourceRotate + page.rotation)
    : 0;

  useLayoutEffect(() => {
    const node = frameRef.current;
    if (!node || frameWidth === 0 || frameHeight === 0) {
      return;
    }
    const rect = node.getBoundingClientRect();
    const x = pixelSnapOffset(rect.left, pixelRatio);
    const y = pixelSnapOffset(rect.top, pixelRatio);
    if (x === 0 && y === 0) {
      return;
    }
    setSnap((current) => ({ x: current.x + x, y: current.y + y }));
  }, [frameHeight, frameWidth, pixelRatio]);

  if (!page) {
    return null;
  }

  const overlayStyle =
    page.rotation === 0
      ? { inset: 0 }
      : {
          height: pageHeight,
          left: (canvasWidth - pageWidth) / 2,
          top: (canvasHeight - pageHeight) / 2,
          transform: `rotate(${page.rotation}deg)`,
          transformOrigin: "center center",
          width: pageWidth,
        };

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
        <div className="flex min-h-full min-w-full items-center justify-center p-8">
          <div
            className="relative flex shrink-0 items-center justify-center shadow-lg"
            ref={frameRef}
            style={{
              height: frameHeight,
              marginLeft: snap.x,
              marginTop: snap.y,
              width: frameWidth,
            }}
          >
            <div
              className="relative"
              style={{
                height: canvasHeight,
                transform: previewing ? `scale(${rasterScale})` : undefined,
                transformOrigin: "center center",
                width: canvasWidth,
              }}
            >
              <PdfCanvas
                rotation={canvasRotation}
                scale={zoom}
                sourceIndex={page.sourceIndex}
              />
              <div className="absolute" style={overlayStyle}>
                <EditorOverlay page={page} zoom={zoom} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
