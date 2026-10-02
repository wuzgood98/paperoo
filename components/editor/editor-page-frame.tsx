"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";

import { EditorOverlay } from "@/components/editor/editor-overlay";
import { PdfCanvas } from "@/components/editor/pdf-canvas";
import { normalizeRotation, pixelSnapOffset } from "@/lib/editor/coordinates";
import { editorStore, useEditorStore } from "@/lib/editor/store";
import type { EditorPage } from "@/lib/editor/types";
import { useDevicePixelRatio } from "@/lib/pdf/device-pixel-ratio";

const VISIBILITY_ROOT_MARGIN = "100% 0px";

export const EditorPageFrame = ({
  displayZoom,
  page,
  pageRef,
  scrollerRef,
  zoom,
}: {
  displayZoom: number;
  page: EditorPage;
  pageRef: (id: string, node: HTMLDivElement | null) => void;
  scrollerRef: RefObject<HTMLDivElement | null>;
  zoom: number;
}) => {
  const currentPageId = useEditorStore((state) => state.currentPageId);
  const rootRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(page.id === currentPageId);
  const [snap, setSnap] = useState({ x: 0, y: 0 });
  const pixelRatio = useDevicePixelRatio();

  const rasterScale = displayZoom / zoom;
  const previewing = rasterScale !== 1;
  const pageWidth = page.width * zoom;
  const pageHeight = page.height * zoom;
  const displayWidth = page.width * displayZoom;
  const displayHeight = page.height * displayZoom;
  const swapped = page.rotation % 180 !== 0;
  const frameWidth = swapped ? displayHeight : displayWidth;
  const frameHeight = swapped ? displayWidth : displayHeight;
  const canvasWidth = swapped ? pageHeight : pageWidth;
  const canvasHeight = swapped ? pageWidth : pageHeight;
  const canvasRotation = normalizeRotation(page.sourceRotate + page.rotation);

  useEffect(() => {
    const node = rootRef.current;
    const root = scrollerRef.current;
    if (!node || !root) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        setVisible(Boolean(entry?.isIntersecting || page.id === currentPageId));
      },
      { root, rootMargin: VISIBILITY_ROOT_MARGIN }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [currentPageId, page.id, scrollerRef]);

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
      ref={(node) => {
        rootRef.current = node;
        pageRef(page.id, node);
      }}
      style={{
        height: frameHeight,
        marginLeft: snap.x,
        marginTop: snap.y,
        width: frameWidth,
      }}
    >
      {visible ? (
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
      ) : null}
    </div>
  );
};
