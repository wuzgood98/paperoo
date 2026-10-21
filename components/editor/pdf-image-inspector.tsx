"use client";

import { useRef } from "react";

import { inspectorStripClassName } from "@/components/editor/inspector-strip";
import { Button } from "@/components/ui/button";
import { toastManager } from "@/components/ui/toast-manager";
import { editorStore } from "@/lib/editor/store";
import type { PdfImageObject } from "@/lib/editor/types";
import { readImageFile } from "@/lib/pdf/image-file";

export const PdfImageInspector = ({ object }: { object: PdfImageObject }) => {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className={inspectorStripClassName}>
      <input
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) {
            return;
          }
          try {
            const image = await readImageFile(file);
            const asset = editorStore.addAsset(image.bytes, image.mimeType);
            editorStore.patchPdfImage((current) => ({
              ...current,
              replacementAssetId: asset.id,
            }));
          } catch (error) {
            toastManager.add({
              description:
                error instanceof Error
                  ? error.message
                  : "Could not replace image.",
              title: "Replace failed",
              type: "error",
            });
          }
        }}
        ref={inputRef}
        tabIndex={-1}
        type="file"
      />
      <Button
        onClick={() => {
          inputRef.current?.click();
        }}
        size="xs"
        variant="secondary"
      >
        Replace
      </Button>
      <Button
        onClick={() => {
          editorStore.selectPdfImage(object.id);
          editorStore.deleteSelected();
        }}
        size="xs"
        variant="destructive"
      >
        Delete
      </Button>
    </div>
  );
};
