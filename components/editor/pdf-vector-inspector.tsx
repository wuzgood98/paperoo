"use client";

import { ColorField } from "@/components/editor/color-field";
import { inspectorStripClassName } from "@/components/editor/inspector-strip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { editorStore } from "@/lib/editor/store";
import type { PdfVectorObject } from "@/lib/editor/types";

export const PdfVectorInspector = ({ object }: { object: PdfVectorObject }) => (
  <div className={inspectorStripClassName}>
    {object.fill ? (
      <ColorField
        label="Fill"
        onChange={(color) => {
          editorStore.patchPdfVector((current) =>
            current.fill
              ? { ...current, fill: { ...current.fill, color } }
              : current
          );
        }}
        value={object.fill.color}
      />
    ) : null}
    {object.stroke ? (
      <>
        <ColorField
          label="Stroke"
          onChange={(color) => {
            editorStore.patchPdfVector((current) =>
              current.stroke
                ? { ...current, stroke: { ...current.stroke, color } }
                : current
            );
          }}
          value={object.stroke.color}
        />
        <div className="text-muted-foreground flex items-center gap-2 text-xs">
          <span id="pdf-vector-stroke-width-label">Width</span>
          <Input
            aria-labelledby="pdf-vector-stroke-width-label"
            className="h-7 w-16"
            min={0}
            onChange={(event) => {
              const width = Number(event.target.value);
              if (!Number.isFinite(width) || width < 0) {
                return;
              }
              editorStore.patchPdfVector((current) =>
                current.stroke
                  ? { ...current, stroke: { ...current.stroke, width } }
                  : current
              );
            }}
            step={0.5}
            type="number"
            value={object.stroke.width}
          />
        </div>
      </>
    ) : null}
    <Button
      onClick={() => {
        editorStore.selectPdfVector(object.id);
        editorStore.deleteSelected();
      }}
      size="xs"
      variant="destructive"
    >
      Delete
    </Button>
  </div>
);
