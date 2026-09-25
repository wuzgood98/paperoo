"use client";

import { useEffect, useRef } from "react";

import type { RenderTask } from "@/lib/pdf/pdfjs";
import { renderPdfPage } from "@/lib/pdf/render-page";
import { pdfSession } from "@/lib/pdf/session";

export const PdfCanvas = ({
  scale,
  sourceIndex,
}: {
  scale: number;
  sourceIndex: number;
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const taskRef = useRef<RenderTask | null>(null);

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
        previous: taskRef.current,
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
  }, [scale, sourceIndex]);

  return <canvas className="block" ref={canvasRef} />;
};
