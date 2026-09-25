"use client";

import type { ResizeHandle } from "@/lib/editor/coordinates";
import { HANDLE_LOCAL_OFFSET } from "@/lib/editor/coordinates";

const HANDLES: ResizeHandle[] = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];

export const SelectionBox = ({
  onResizePointerDown,
  onRotatePointerDown,
}: {
  onResizePointerDown: (
    handle: ResizeHandle,
    event: React.PointerEvent
  ) => void;
  onRotatePointerDown: (event: React.PointerEvent) => void;
}) => (
  <div className="pointer-events-none absolute inset-0">
    <div className="border-primary absolute inset-0 border" />
    <button
      aria-label="Rotate"
      className="border-primary bg-background pointer-events-auto absolute -top-5 left-1/2 size-3 -translate-x-1/2 rounded-full border"
      onPointerDown={onRotatePointerDown}
      type="button"
    />
    {HANDLES.map((handle) => {
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
