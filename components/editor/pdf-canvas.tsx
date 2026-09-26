"use client";

import { useEffect, useRef } from "react";

import { useDevicePixelRatio } from "@/lib/pdf/device-pixel-ratio";
import type { RenderTask } from "@/lib/pdf/pdfjs";
import { renderPdfPage } from "@/lib/pdf/render-page";
import { pdfSession } from "@/lib/pdf/session";

export const PdfCanvas = ({
  rotation,
  scale,
  sourceIndex,
}: {
  rotation?: number;
  scale: number;
  sourceIndex: number;
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const taskRef = useRef<RenderTask | null>(null);
  const pixelRatio = useDevicePixelRatio();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    let cancelled = false;

    const draw = async () => {
      const page = await pdfSession.getPage(sourceIndex);
      if (!page || cancelled || !canvasRef.current) {
        return;
      }
      const task = await renderPdfPage(page, canvasRef.current, scale, {
        pixelRatio,
        previous: taskRef.current,
        rotation,
      });
      if (!cancelled) {
        taskRef.current = task;
      }
    };

    void draw();

    return () => {
      cancelled = true;
      taskRef.current?.cancel();
    };
  }, [pixelRatio, rotation, scale, sourceIndex]);

  return <canvas className="block" ref={canvasRef} />;
};
