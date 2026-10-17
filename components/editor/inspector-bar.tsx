"use client";

import { BoldIcon, ItalicIcon } from "lucide-react";

import { ColorField } from "@/components/editor/color-field";
import { inspectorStripClassName } from "@/components/editor/inspector-strip";
import { PdfAnnotationInspector } from "@/components/editor/pdf-annotation-inspector";
import { PdfFormInspector } from "@/components/editor/pdf-form-inspector";
import { PdfImageInspector } from "@/components/editor/pdf-image-inspector";
import { PdfTextInspector } from "@/components/editor/pdf-text-inspector";
import { PdfVectorInspector } from "@/components/editor/pdf-vector-inspector";
import { FillField, StrokeWidthField } from "@/components/editor/style-fields";
import { ToolStyleInspector } from "@/components/editor/tool-style-inspector";
import { ToolbarTip } from "@/components/editor/toolbar-tip";
import { FONT_FAMILIES, fontFamilyFromSelect } from "@/components/editor/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import {
  findPage,
  findPdfFormField,
  findPdfImage,
  findPdfText,
  findPdfAnnotation,
  findPdfVector,
} from "@/lib/editor/object-utils";
import { editorStore, useEditorStore } from "@/lib/editor/store";
import type { EditorObject, TextAlign } from "@/lib/editor/types";

const TEXT_ALIGNS: TextAlign[] = ["left", "center", "right"];

/** Restyle the selection and make that style the default for the next one. */
const patchStyle = (updater: (object: EditorObject) => EditorObject): void => {
  editorStore.patchSelected(updater);
  editorStore.rememberSelectedStyle();
};

/** Width for stroked objects, plus fill for boxes and circles. */
const StrokeStyleFields = ({ selected }: { selected: EditorObject }) => {
  if (
    selected.type !== "drawing" &&
    selected.type !== "signature" &&
    selected.type !== "shape"
  ) {
    return null;
  }
  return (
    <>
      <StrokeWidthField
        onChange={(strokeWidth) =>
          patchStyle((object) =>
            object.type === "drawing" ||
            object.type === "signature" ||
            object.type === "shape"
              ? { ...object, strokeWidth }
              : object
          )
        }
        value={selected.strokeWidth}
      />
      {selected.type === "shape" && selected.shape !== "line" ? (
        <FillField
          onChange={(fill) =>
            patchStyle((object) =>
              object.type === "shape" ? { ...object, fill } : object
            )
          }
          value={selected.fill}
        />
      ) : null}
    </>
  );
};

export const InspectorBar = () => {
  const selected = useEditorStore((state) => {
    const page = state.document.pages.find(
      (item) => item.id === state.currentPageId
    );
    const [id] = state.selectedObjectIds;
    return page?.objects.find((object) => object.id === id);
  });
  const selectedPdfText = useEditorStore((state) =>
    findPdfText(
      findPage(state.document.pages, state.currentPageId),
      state.selectedPdfTextId
    )
  );
  const selectedPdfImage = useEditorStore((state) =>
    findPdfImage(
      findPage(state.document.pages, state.currentPageId),
      state.selectedPdfImageId
    )
  );
  const selectedPdfVector = useEditorStore((state) =>
    findPdfVector(
      findPage(state.document.pages, state.currentPageId),
      state.selectedPdfVectorId
    )
  );
  const currentPage = useEditorStore((state) =>
    findPage(state.document.pages, state.currentPageId)
  );
  const selectedPdfAnnotation = useEditorStore((state) =>
    findPdfAnnotation(
      findPage(state.document.pages, state.currentPageId),
      state.selectedPdfAnnotationId
    )
  );
  const selectedPdfFormField = useEditorStore((state) =>
    findPdfFormField(state.document, state.selectedPdfFormFieldId)
  );
  if (selectedPdfFormField) {
    return <PdfFormInspector field={selectedPdfFormField} />;
  }
  if (selectedPdfText && currentPage) {
    return <PdfTextInspector object={selectedPdfText} page={currentPage} />;
  }
  if (selectedPdfImage) {
    return <PdfImageInspector object={selectedPdfImage} />;
  }
  if (selectedPdfVector) {
    return <PdfVectorInspector object={selectedPdfVector} />;
  }
  if (selectedPdfAnnotation && currentPage) {
    return (
      <PdfAnnotationInspector
        object={selectedPdfAnnotation}
        page={currentPage}
      />
    );
  }

  if (!selected) {
    return <ToolStyleInspector />;
  }

  return (
    <div className={inspectorStripClassName}>
      {selected.type === "text" ? (
        <>
          <div className="flex items-center gap-2">
            <Select
              onValueChange={(value) =>
                patchStyle((object) =>
                  object.type === "text"
                    ? {
                        ...object,
                        fontFamily: fontFamilyFromSelect(value ?? "sans"),
                      }
                    : object
                )
              }
              value={selected.fontFamily}
              items={FONT_FAMILIES}
            >
              <SelectTrigger
                aria-label="Font family"
                className="w-32 max-md:max-w-full"
              >
                <SelectValue placeholder="Select a font family" />
              </SelectTrigger>
              <SelectContent>
                {FONT_FAMILIES.map(({ label, value }) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              aria-label="Font size"
              min={8}
              onValueChange={(value) =>
                patchStyle((object) =>
                  object.type === "text"
                    ? { ...object, fontSize: Number(value) }
                    : object
                )
              }
              type="number"
              value={selected.fontSize}
              className="w-24 max-md:max-w-full"
            />
          </div>
          <ToolbarTip label="Bold">
            <Button
              onClick={() =>
                patchStyle((object) =>
                  object.type === "text"
                    ? {
                        ...object,
                        fontWeight: object.fontWeight === 700 ? 400 : 700,
                      }
                    : object
                )
              }
              size="icon-xs"
              variant={selected.fontWeight === 700 ? "secondary" : "ghost"}
              aria-label="Bold"
            >
              <BoldIcon />
            </Button>
          </ToolbarTip>
          <ToolbarTip label="Italic">
            <Button
              onClick={() =>
                patchStyle((object) =>
                  object.type === "text"
                    ? { ...object, italic: !object.italic }
                    : object
                )
              }
              size="icon-xs"
              variant={selected.italic ? "secondary" : "ghost"}
              decoration="italic"
              aria-label="Italic"
            >
              <ItalicIcon />
            </Button>
          </ToolbarTip>
          {TEXT_ALIGNS.map((align) => (
            <Button
              key={align}
              onClick={() =>
                patchStyle((object) =>
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
              patchStyle((object) =>
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
            patchStyle((object) =>
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
            patchStyle((object) =>
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
      <StrokeStyleFields selected={selected} />
      <div className="text-muted-foreground flex items-center gap-2 text-xs">
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
            editorStore.previewEdit(() =>
              editorStore.patchSelected((object) => ({
                ...object,
                opacity: next,
              }))
            );
          }}
          onValueCommitted={() => editorStore.commitPreview()}
          step={0.05}
          value={[selected.opacity]}
        />
      </div>
    </div>
  );
};
