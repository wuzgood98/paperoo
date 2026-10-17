"use client";

import { useTheme } from "next-themes";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog";
import { pendingSignature } from "@/lib/editor/pending";
import { editorStore, useEditorStore } from "@/lib/editor/store";
import type { Point } from "@/lib/editor/types";

const CANVAS_WIDTH = 420;
const CANVAS_HEIGHT = 160;
const STROKE_WIDTH = 2;
const LIGHT_STROKE = "#111827";
const DARK_STROKE = "#ffffff";

const strokeColorForTheme = (theme: string | undefined) =>
  theme === "dark" ? DARK_STROKE : LIGHT_STROKE;

const applyCanvasStrokeStyle = (
  context: CanvasRenderingContext2D,
  strokeColor: string
) => {
  context.lineCap = "round";
  context.lineJoin = "round";
  context.lineWidth = STROKE_WIDTH;
  context.strokeStyle = strokeColor;
};

const replayCanvasStroke = (
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  points: readonly Point[],
  strokeColor: string
) => {
  context.clearRect(0, 0, canvas.width, canvas.height);
  applyCanvasStrokeStyle(context, strokeColor);
  const [first, ...rest] = points;
  if (!first) {
    return;
  }
  context.beginPath();
  context.moveTo(first.x, first.y);
  for (const point of rest) {
    context.lineTo(point.x, point.y);
  }
  context.stroke();
};

const pointerToCanvasPoint = (
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number
): Point => {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((clientX - rect.left) * canvas.width) / rect.width,
    y: ((clientY - rect.top) * canvas.height) / rect.height,
  };
};

export const SignatureDialog = () => {
  const { resolvedTheme } = useTheme();
  const strokeColor = strokeColorForTheme(resolvedTheme);
  const tool = useEditorStore((state) => state.tool);
  const open = tool === "signature";
  const pending = useSyncExternalStore(
    pendingSignature.subscribe,
    pendingSignature.get,
    pendingSignature.get
  );
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointsRef = useRef<Point[]>([]);
  const drawingRef = useRef(false);
  const [hasStroke, setHasStroke] = useState(false);

  useEffect(() => {
    if (!open || pending) {
      return;
    }
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) {
      return;
    }
    context.clearRect(0, 0, canvas.width, canvas.height);
    pointsRef.current = [];
    setHasStroke(false);
  }, [open, pending]);

  useEffect(() => {
    if (!open || pending) {
      return;
    }
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) {
      return;
    }
    replayCanvasStroke(canvas, context, pointsRef.current, strokeColor);
  }, [open, pending, strokeColor]);

  if (pending) {
    return null;
  }

  return (
    <Dialog
      onOpenChange={(next) => {
        if (!next && !pendingSignature.get()) {
          editorStore.setTool("select");
        }
      }}
      open={open}
    >
      <DialogPopup className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Draw your signature</DialogTitle>
        </DialogHeader>
        <canvas
          className="bg-background text-foreground editor-draw-cursor w-full touch-none rounded-md border"
          height={CANVAS_HEIGHT}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            drawingRef.current = true;
            const point = pointerToCanvasPoint(
              event.currentTarget,
              event.clientX,
              event.clientY
            );
            pointsRef.current = [point];
            const context = event.currentTarget.getContext("2d");
            if (!context) {
              return;
            }
            applyCanvasStrokeStyle(context, strokeColor);
            context.beginPath();
            context.moveTo(point.x, point.y);
          }}
          onPointerMove={(event) => {
            if (!drawingRef.current) {
              return;
            }
            const events = event.nativeEvent.getCoalescedEvents?.() ?? [
              event.nativeEvent,
            ];
            const context = event.currentTarget.getContext("2d");
            if (!context) {
              return;
            }
            const canvas = event.currentTarget;
            applyCanvasStrokeStyle(context, strokeColor);
            for (const coalesced of events) {
              const point = pointerToCanvasPoint(
                canvas,
                coalesced.clientX,
                coalesced.clientY
              );
              pointsRef.current.push(point);
              context.lineTo(point.x, point.y);
            }
            context.stroke();
            setHasStroke(true);
          }}
          onPointerUp={() => {
            drawingRef.current = false;
          }}
          ref={canvasRef}
          width={CANVAS_WIDTH}
        />
        <DialogFooter>
          <Button
            onClick={() => {
              const context = canvasRef.current?.getContext("2d");
              context?.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
              pointsRef.current = [];
              setHasStroke(false);
            }}
            variant="ghost"
          >
            Clear
          </Button>
          <DialogClose render={<Button variant="outline">Cancel</Button>} />
          <Button
            disabled={!hasStroke}
            onClick={() => {
              pendingSignature.set(pointsRef.current);
              editorStore.setTool("signature");
            }}
          >
            Place on page
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
};
