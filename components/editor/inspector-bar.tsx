"use client";

import { ColorField } from "@/components/editor/color-field";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { editorStore, useEditorStore } from "@/lib/editor/store";
import type { FontFamily, TextAlign } from "@/lib/editor/types";

const TEXT_ALIGNS: TextAlign[] = ["left", "center", "right"];

const fontFamilyFromSelect = (value: string): FontFamily => {
  if (value === "serif" || value === "mono") {
    return value;
  }
  return "sans";
};

export const InspectorBar = () => {
  const selected = useEditorStore((state) => {
    const page = state.document.pages.find(
      (item) => item.id === state.currentPageId
    );
    const [id] = state.selectedObjectIds;
    return page?.objects.find((object) => object.id === id);
  });

  if (!selected) {
    return null;
  }

  return (
    <div className="border-border bg-background flex flex-wrap items-center gap-3 border-b px-3 py-2">
      {selected.type === "text" ? (
        <>
          <select
            className="border-input h-7 rounded-md border bg-transparent px-2 text-xs"
            onChange={(event) =>
              editorStore.patchSelected((object) =>
                object.type === "text"
                  ? {
                      ...object,
                      fontFamily: fontFamilyFromSelect(event.target.value),
                    }
                  : object
              )
            }
            value={selected.fontFamily}
          >
            <option value="sans">Sans</option>
            <option value="serif">Serif</option>
            <option value="mono">Mono</option>
          </select>
          <input
            className="border-input h-7 w-14 rounded-md border px-2 text-xs"
            min={8}
            onChange={(event) =>
              editorStore.patchSelected((object) =>
                object.type === "text"
                  ? { ...object, fontSize: Number(event.target.value) }
                  : object
              )
            }
            type="number"
            value={selected.fontSize}
          />
          <Button
            onClick={() =>
              editorStore.patchSelected((object) =>
                object.type === "text"
                  ? {
                      ...object,
                      fontWeight: object.fontWeight === 700 ? 400 : 700,
                    }
                  : object
              )
            }
            size="xs"
            variant={selected.fontWeight === 700 ? "secondary" : "ghost"}
          >
            B
          </Button>
          <Button
            onClick={() =>
              editorStore.patchSelected((object) =>
                object.type === "text"
                  ? { ...object, italic: !object.italic }
                  : object
              )
            }
            size="xs"
            variant={selected.italic ? "secondary" : "ghost"}
          >
            I
          </Button>
          {TEXT_ALIGNS.map((align) => (
            <Button
              key={align}
              onClick={() =>
                editorStore.patchSelected((object) =>
                  object.type === "text" ? { ...object, align } : object
                )
              }
              size="xs"
              variant={selected.align === align ? "secondary" : "ghost"}
            >
              {align}
            </Button>
          ))}
          <ColorField
            label="Color"
            onChange={(color) =>
              editorStore.patchSelected((object) =>
                object.type === "text" ? { ...object, color } : object
              )
            }
            value={selected.color}
          />
        </>
      ) : null}
      {selected.type === "highlight" ? (
        <ColorField
          label="Fill"
          onChange={(color) =>
            editorStore.patchSelected((object) =>
              object.type === "highlight" ? { ...object, color } : object
            )
          }
          value={selected.color}
        />
      ) : null}
      {selected.type === "drawing" ||
      selected.type === "signature" ||
      selected.type === "shape" ? (
        <ColorField
          label="Stroke"
          onChange={(stroke) =>
            editorStore.patchSelected((object) =>
              object.type === "drawing" ||
              object.type === "signature" ||
              object.type === "shape"
                ? { ...object, stroke }
                : object
            )
          }
          value={
            selected.type === "shape" ||
            selected.type === "drawing" ||
            selected.type === "signature"
              ? selected.stroke
              : "#111827"
          }
        />
      ) : null}
      <p className="text-muted-foreground flex items-center gap-2 text-xs">
        Opacity
        <Slider
          aria-label="Opacity"
          className="w-28"
          max={1}
          min={0.1}
          onValueChange={(value) => {
            const next = Array.isArray(value) ? value[0] : value;
            if (next === undefined) {
              return;
            }
            editorStore.patchSelected((object) => ({
              ...object,
              opacity: next,
            }));
          }}
          step={0.05}
          value={[selected.opacity]}
        />
      </p>
    </div>
  );
};
