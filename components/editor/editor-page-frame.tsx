"use client";

import { useLayoutEffect, useRef, useState } from "react";

import { EditorOverlay } from "@/components/editor/editor-overlay";
import { PdfCanvas } from "@/components/editor/pdf-canvas";
import { normalizeRotation, pixelSnapOffset } from "@/lib/editor/coordinates";
import { pageFrameCssSize } from "@/lib/editor/page-frame-size";
import { editorStore } from "@/lib/editor/store";
import type { EditorPage } from "@/lib/editor/types";
import { useDevicePixelRatio } from "@/lib/pdf/device-pixel-ratio";

export const EditorPageFrame = ({
  displayZoom,
  page,
  zoom,
}: {
  displayZoom: number;
  page: EditorPage;
  zoom: number;
}) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const [snap, setSnap] = useState({ x: 0, y: 0 });
  const pixelRatio = useDevicePixelRatio();

  const rasterScale = displayZoom / zoom;
  const previewing = rasterScale !== 1;
  const pageWidth = page.width * zoom;
  const pageHeight = page.height * zoom;
  const { height: frameHeight, width: frameWidth } = pageFrameCssSize(
    page,
    displayZoom
  );
  const swapped = page.rotation % 180 !== 0;
  const canvasWidth = swapped ? pageHeight : pageWidth;
  const canvasHeight = swapped ? pageWidth : pageHeight;
  const canvasRotation = normalizeRotation(page.sourceRotate + page.rotation);

  useLayoutEffect(() => {
    const node = rootRef.current;
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

  const snapTransform =
    snap.x !== 0 || snap.y !== 0
      ? `translate(${snap.x}px, ${snap.y}px)`
      : undefined;
  const previewTransform = previewing ? `scale(${rasterScale})` : undefined;
  const innerTransform = [snapTransform, previewTransform]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className="relative flex shrink-0 items-center justify-center shadow-lg"
      data-page-id={page.id}
      onPointerDown={() => {
        if (page.id === editorStore.getState().currentPageId) {
          return;
        }
        editorStore.setCurrentPage(page.id, { syncFitZoom: false });
      }}
      ref={rootRef}
      style={{
        height: frameHeight,
        width: frameWidth,
      }}
    >
      <div
        className="relative"
        style={{
          height: canvasHeight,
          transform: innerTransform || undefined,
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
  );
};
