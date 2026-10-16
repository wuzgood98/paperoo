import type { PdfPathCommand } from "@/lib/editor/types";
import type { OutlineRasterFrame } from "@/lib/ocr/outline-ocr";

/** The outline's commands as a canvas path in bitmap pixels (y down). */
const outlinePath2D = (
  commands: readonly PdfPathCommand[],
  frame: OutlineRasterFrame
): Path2D => {
  const px = (x: number): number => (x - frame.left) * frame.scale;
  const py = (y: number): number => (frame.top - y) * frame.scale;
  const path = new Path2D();
  for (const command of commands) {
    switch (command.type) {
      case "moveTo": {
        path.moveTo(px(command.x), py(command.y));
        break;
      }
      case "lineTo": {
        path.lineTo(px(command.x), py(command.y));
        break;
      }
      case "curveTo": {
        path.bezierCurveTo(
          px(command.x1),
          py(command.y1),
          px(command.x2),
          py(command.y2),
          px(command.x3),
          py(command.y3)
        );
        break;
      }
      case "quadraticCurveTo": {
        path.quadraticCurveTo(
          px(command.x1),
          py(command.y1),
          px(command.x),
          py(command.y)
        );
        break;
      }
      default: {
        path.closePath();
        break;
      }
    }
  }
  return path;
};

/**
 * Fill one outline black on white, alone: OCR then sees only the label, at
 * full contrast whatever its color, opacity or background.
 */
export const renderOutlineForOcr = (
  commands: readonly PdfPathCommand[],
  frame: OutlineRasterFrame,
  fillRule: CanvasFillRule
): HTMLCanvasElement => {
  const canvas = document.createElement("canvas");
  canvas.width = frame.width;
  canvas.height = frame.height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas is not available for text recognition.");
  }
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, frame.width, frame.height);
  context.fillStyle = "#000000";
  context.fill(outlinePath2D(commands, frame), fillRule);
  return canvas;
};
