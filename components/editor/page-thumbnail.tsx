"use client";

import { useEffect, useRef, useState } from "react";

import type { EditorPage } from "@/lib/editor/types";
import { AnnotationMode } from "@/lib/pdf/pdfjs";
import {
  releaseCanvas,
  renderPdfPage,
  thumbnailScale,
} from "@/lib/pdf/render-page";
import { pdfSession } from "@/lib/pdf/session";
import { cn } from "@/lib/utils";

export const PageThumbnail = ({
  page,
  selected,
}: {
  page: EditorPage;
  selected: boolean;
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const taskRef = useRef<Awaited<ReturnType<typeof renderPdfPage>>>(null);
  const [visible, setVisible] = useState(selected);

  useEffect(() => {
    const node = rootRef.current;
    if (!node) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        setVisible(Boolean(entry?.isIntersecting || selected));
      },
      { rootMargin: "160px 0px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [selected]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !visible) {
      return;
    }
    const controller = new AbortController();

    let task: Awaited<ReturnType<typeof renderPdfPage>> = null;

    let retained = false;

    const draw = async () => {
      const pdfPage = await pdfSession.retainPage(page.sourceIndex);
      if (!pdfPage) {
        return;
      }
      if (controller.signal.aborted) {
        pdfSession.releasePageRef(page.sourceIndex);
        return;
      }
      retained = true;
      task = await renderPdfPage(pdfPage, canvas, thumbnailScale(page.width), {
        annotationMode: AnnotationMode.DISABLE,
        previous: task,
        signal: controller.signal,
      });
      taskRef.current = task;
    };

    void draw();

    return () => {
      // Cancel the paint still in flight before the canvas is shrunk under it.
      controller.abort();
      task?.cancel();
      releaseCanvas(canvas);
      if (retained) {
        pdfSession.releasePageRef(page.sourceIndex);
      }
    };
  }, [page.sourceIndex, page.width, visible]);

  return (
    <div
      className={cn(
        "bg-muted overflow-hidden rounded-md border shadow-xs",
        selected ? "border-primary ring-primary/30 ring-2" : "border-border"
      )}
      ref={rootRef}
    >
      <canvas
        className="mx-auto block h-auto max-w-full"
        ref={canvasRef}
        style={{ transform: `rotate(${page.rotation}deg)` }}
      />
    </div>
  );
};
