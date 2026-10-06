"use client";

import { ObjectView } from "@/components/editor/objects/object-view";
import {
  requireOverlayRoot,
  snapshotBounds,
} from "@/components/editor/overlay-gestures";
import type { Gesture } from "@/components/editor/overlay-gestures";
import { SelectionBox } from "@/components/editor/selection-box";
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuPopup,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { objectCenter, objectWrapperStyle } from "@/lib/editor/coordinates";
import type { PageBounds } from "@/lib/editor/coordinates";
import { editorStore } from "@/lib/editor/store";
import type { EditorObject, EditorTool, Point } from "@/lib/editor/types";

interface RefBox<T> {
  current: T;
}

export const OverlayObject = ({
  boundsRef,
  editing,
  gestureRef,
  nodeRefs,
  object,
  rootRef,
  selected,
  setEditingId,
  toPage,
  tool,
  zoom,
}: {
  boundsRef: RefBox<PageBounds | null>;
  editing: boolean;
  gestureRef: RefBox<Gesture | null>;
  nodeRefs: RefBox<Map<string, HTMLDivElement>>;
  object: EditorObject;
  rootRef: RefBox<HTMLDivElement | null>;
  selected: boolean;
  setEditingId: (id: string | null) => void;
  toPage: (event: { clientX: number; clientY: number }) => Point;
  tool: EditorTool;
  zoom: number;
}) => {
  const frame = objectWrapperStyle(object, zoom);

  return (
    <ContextMenu>
      <div
        className="absolute origin-center"
        data-editor-object-id={object.id}
        onDoubleClick={() => {
          if (object.type === "text") {
            setEditingId(object.id);
          }
        }}
        onPointerDown={(event) => {
          if (tool !== "select" && tool !== "text") {
            return;
          }
          event.stopPropagation();
          boundsRef.current = snapshotBounds(
            requireOverlayRoot(rootRef.current)
          );
          rootRef.current?.setPointerCapture(event.pointerId);
          editorStore.selectObjects([object.id]);
          gestureRef.current = {
            kind: "drag",
            object,
            origin: { x: object.x, y: object.y },
            start: toPage(event),
          };
        }}
        ref={(node) => {
          if (node) {
            nodeRefs.current.set(object.id, node);
          } else {
            nodeRefs.current.delete(object.id);
          }
        }}
        style={frame}
      >
        <ContextMenuTrigger className="block h-full w-full">
          <ObjectView
            editing={editing}
            object={object}
            onTextCommit={(content) => {
              setEditingId(null);
              if (object.type !== "text") {
                return;
              }
              editorStore.commitObject(object.id, { ...object, content }, true);
            }}
            zoom={zoom}
          />
        </ContextMenuTrigger>
        {selected && !editing ? (
          <SelectionBox
            onResizePointerDown={(handle, event) => {
              event.stopPropagation();
              boundsRef.current = snapshotBounds(
                requireOverlayRoot(rootRef.current)
              );
              rootRef.current?.setPointerCapture(event.pointerId);
              gestureRef.current = {
                handle,
                kind: "resize",
                object,
                start: toPage(event),
              };
            }}
            onRotatePointerDown={(event) => {
              event.stopPropagation();
              boundsRef.current = snapshotBounds(
                requireOverlayRoot(rootRef.current)
              );
              rootRef.current?.setPointerCapture(event.pointerId);
              const center = objectCenter(object);
              const point = toPage(event);
              gestureRef.current = {
                kind: "rotate",
                object,
                originRotation: object.rotation,
                startAngle:
                  (Math.atan2(point.y - center.y, point.x - center.x) * 180) /
                  Math.PI,
              };
            }}
          />
        ) : null}
      </div>
      <ContextMenuPopup>
        <ContextMenuItem
          onClick={() => {
            editorStore.selectObjects([object.id]);
            editorStore.deleteSelected();
          }}
          variant="destructive"
        >
          Delete
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() => {
            editorStore.selectObjects([object.id]);
            editorStore.reorderSelected("front");
          }}
        >
          Bring to front
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() => {
            editorStore.selectObjects([object.id]);
            editorStore.reorderSelected("back");
          }}
        >
          Send to back
        </ContextMenuItem>
      </ContextMenuPopup>
    </ContextMenu>
  );
};
