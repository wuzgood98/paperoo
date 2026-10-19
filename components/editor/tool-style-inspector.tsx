"use client";

import { ColorField } from "@/components/editor/color-field";
import { inspectorStripClassName } from "@/components/editor/inspector-strip";
import { FillField, StrokeWidthField } from "@/components/editor/style-fields";
import { editorStore, useEditorStore } from "@/lib/editor/store";

/**
 * Style for the next object a creation tool makes, shown while that tool is
 * active and nothing is selected.
 */
export const ToolStyleInspector = () => {
  const tool = useEditorStore((state) => state.tool);
  const drawStyle = useEditorStore((state) => state.drawStyle);
  const shapeStyle = useEditorStore((state) => state.shapeStyle);
  const highlightColor = useEditorStore((state) => state.highlightColor);
  const redactionFill = useEditorStore((state) => state.redactionFill);
  const textColor = useEditorStore((state) => state.textStyle.color);

  if (tool === "draw") {
    return (
      <div className={inspectorStripClassName}>
        <ColorField
          label="Stroke"
          onChange={(stroke) => editorStore.setDrawStyle({ stroke })}
          value={drawStyle.stroke}
        />
        <StrokeWidthField
          onChange={(strokeWidth) => editorStore.setDrawStyle({ strokeWidth })}
          value={drawStyle.strokeWidth}
        />
      </div>
    );
  }

  if (tool === "shape") {
    return (
      <div className={inspectorStripClassName}>
        <ColorField
          label="Stroke"
          onChange={(stroke) => editorStore.setShapeStyle({ stroke })}
          value={shapeStyle.stroke}
        />
        <StrokeWidthField
          onChange={(strokeWidth) => editorStore.setShapeStyle({ strokeWidth })}
          value={shapeStyle.strokeWidth}
        />
        {shapeStyle.shape === "line" ? null : (
          <FillField
            onChange={(fill) => editorStore.setShapeStyle({ fill })}
            value={shapeStyle.fill}
          />
        )}
      </div>
    );
  }

  if (tool === "highlight") {
    return (
      <div className={inspectorStripClassName}>
        <ColorField
          label="Fill"
          onChange={(color) => editorStore.setHighlightColor(color)}
          value={highlightColor}
        />
      </div>
    );
  }

  if (tool === "redact") {
    return (
      <div className={inspectorStripClassName}>
        <ColorField
          label="Fill"
          onChange={(fill) => editorStore.setRedactionFill(fill)}
          value={redactionFill}
        />
      </div>
    );
  }

  if (tool === "text") {
    return (
      <div className={inspectorStripClassName}>
        <ColorField
          label="Color"
          onChange={(color) => editorStore.setTextStyle({ color })}
          value={textColor}
        />
      </div>
    );
  }

  return null;
};
