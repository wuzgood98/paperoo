"use client";

import type { ResizeHandle } from "@/lib/editor/coordinates";
import {
  HANDLE_LOCAL_OFFSET,
  isDegenerateExtent,
} from "@/lib/editor/coordinates";

const HANDLES: ResizeHandle[] = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];

/**
 * Handles that can change the box. A straight line's box is flat on one
 * axis, so its corner and cross-axis handles would pile onto the line's
 * middle and swallow drags meant to move it.
 */
const activeHandles = (box?: {
  height: number;
  width: number;
}): ResizeHandle[] => {
  if (!box) {
    return HANDLES;
  }
  const flatX = isDegenerateExtent(box.width);
  const flatY = isDegenerateExtent(box.height);
  return HANDLES.filter((handle) => {
    const offset = HANDLE_LOCAL_OFFSET[handle];
    return !((flatX && offset.x !== 0) || (flatY && offset.y !== 0));
  });
};

export const SelectionBox = ({
  box,
  onResizePointerDown,
  onRotatePointerDown,
}: {
  /** The selected object's size; flat axes get no handles. */
  box?: { height: number; width: number };
  onResizePointerDown: (
    handle: ResizeHandle,
    event: React.PointerEvent
  ) => void;
  /** Unset for objects that never rotate (redactions). */
  onRotatePointerDown?: (event: React.PointerEvent) => void;
}) => (
  <div className="pointer-events-none absolute inset-0">
    <div className="border-primary absolute inset-0 border" />
    {onRotatePointerDown ? (
      <button
        aria-label="Rotate"
        className="border-primary bg-background pointer-events-auto absolute -top-5 left-1/2 size-3 -translate-x-1/2 rounded-full border"
        onPointerDown={onRotatePointerDown}
        type="button"
      />
    ) : null}
    {activeHandles(box).map((handle) => {
      const offset = HANDLE_LOCAL_OFFSET[handle];
      return (
        <button
          aria-label={`Resize ${handle}`}
          className="border-primary bg-background pointer-events-auto absolute size-2.5 -translate-x-1/2 -translate-y-1/2 border"
          key={handle}
          onPointerDown={(event) => onResizePointerDown(handle, event)}
          style={{
            cursor: `${handle}-resize`,
            left: `${(offset.x + 0.5) * 100}%`,
            top: `${(offset.y + 0.5) * 100}%`,
          }}
          type="button"
        />
      );
    })}
  </div>
);
