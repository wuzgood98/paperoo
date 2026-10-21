"use client";

import { useEffect, useRef } from "react";

import { useDevicePixelRatio } from "@/lib/pdf/device-pixel-ratio";
import { AnnotationMode } from "@/lib/pdf/pdfjs";
import { releaseCanvas, renderPdfPage } from "@/lib/pdf/render-page";
import type { PdfPaintTask } from "@/lib/pdf/render-page";
import { pdfSession } from "@/lib/pdf/session";

export const PdfCanvas = ({
  docId,
  omitFormWidgets = false,
  rotation,
  scale,
  sourceIndex,
}: {
  docId: string;
  /** Leave form widgets unpainted (a duplicated page has no fields). */
  omitFormWidgets?: boolean;
  rotation?: number;
  scale: number;
  sourceIndex: number;
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const taskRef = useRef<PdfPaintTask | null>(null);
  const pixelRatio = useDevicePixelRatio();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const controller = new AbortController();
    let retained = false;

    const key = { docId, sourceIndex };

    const draw = async () => {
      const page = await pdfSession.retainPage(key);
      if (!page) {
        return;
      }
      if (controller.signal.aborted) {
        pdfSession.releasePageRef(key);
        return;
      }
      retained = true;
      if (!canvasRef.current) {
        return;
      }
      const task = await renderPdfPage(page, canvasRef.current, scale, {
        annotationMode: omitFormWidgets
          ? AnnotationMode.ENABLE_FORMS
          : AnnotationMode.ENABLE,
        pixelRatio,
        previous: taskRef.current,
        rotation,
        signal: controller.signal,
      });
      if (!controller.signal.aborted) {
        taskRef.current = task;
      }
      if (task) {
        pdfSession.markFirstPaint();
      }
    };

    void draw();

    return () => {
      // Cancel the paint still in flight before the canvas is shrunk under it.
      controller.abort();
      taskRef.current?.cancel();
      releaseCanvas(canvas);
      if (retained) {
        pdfSession.releasePageRef(key);
      }
    };
  }, [docId, omitFormWidgets, pixelRatio, rotation, scale, sourceIndex]);

  // White under the backing store: a resized canvas is transparent black until
  // pdf.js paints its first chunk.
  return <canvas className="block bg-white" ref={canvasRef} />;
};
