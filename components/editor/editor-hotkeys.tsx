"use client";

import { useEffect } from "react";

import { editorStore } from "@/lib/editor/store";
import {
  NUDGE_DISTANCE,
  NUDGE_DISTANCE_SHIFT,
  ZOOM_STEP,
} from "@/lib/editor/types";
import { bindHotkeys } from "@/lib/hotkeys";

const nudgeSelected = (deltaX: number, deltaY: number): void => {
  if (editorStore.getState().selectedPdfImageId) {
    editorStore.patchPdfImage((object) => ({
      ...object,
      x: object.x + deltaX,
      y: object.y + deltaY,
    }));
    return;
  }
  editorStore.patchSelected((object) => ({
    ...object,
    x: object.x + deltaX,
    y: object.y + deltaY,
  }));
};

export const EditorHotkeys = () => {
  useEffect(
    () =>
      bindHotkeys([
        { handler: () => editorStore.undo(), key: "z", meta: true },
        {
          handler: () => editorStore.redo(),
          key: "z",
          meta: true,
          shift: true,
        },
        { handler: () => editorStore.redo(), key: "y", meta: true },
        {
          handler: () => editorStore.deleteSelected(),
          key: "Delete",
        },
        {
          handler: () => editorStore.deleteSelected(),
          key: "Backspace",
        },
        {
          handler: () => editorStore.clearSelection(),
          key: "Escape",
        },
        {
          handler: (event) => {
            const distance = event.shiftKey
              ? NUDGE_DISTANCE_SHIFT
              : NUDGE_DISTANCE;
            nudgeSelected(0, -distance);
          },
          key: "ArrowUp",
        },
        {
          handler: (event) => {
            const distance = event.shiftKey
              ? NUDGE_DISTANCE_SHIFT
              : NUDGE_DISTANCE;
            nudgeSelected(0, distance);
          },
          key: "ArrowDown",
        },
        {
          handler: (event) => {
            const distance = event.shiftKey
              ? NUDGE_DISTANCE_SHIFT
              : NUDGE_DISTANCE;
            nudgeSelected(-distance, 0);
          },
          key: "ArrowLeft",
        },
        {
          handler: (event) => {
            const distance = event.shiftKey
              ? NUDGE_DISTANCE_SHIFT
              : NUDGE_DISTANCE;
            nudgeSelected(distance, 0);
          },
          key: "ArrowRight",
        },
        { handler: () => editorStore.zoomBy(ZOOM_STEP), key: "=", meta: true },
        { handler: () => editorStore.zoomBy(-ZOOM_STEP), key: "-", meta: true },
        {
          handler: () => {
            document
              .querySelector<HTMLInputElement>("#editor-open-input")
              ?.click();
          },
          key: "o",
          meta: true,
        },
      ]),
    []
  );

  return null;
};
