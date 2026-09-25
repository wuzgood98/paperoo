"use client";

import { CircleIcon, MinusIcon, SquareIcon } from "lucide-react";

import { Popover, PopoverPopup, PopoverTrigger } from "@/components/ui/popover";
import { Toggle } from "@/components/ui/toggle";
import { editorStore, useEditorStore } from "@/lib/editor/store";
import type { ShapeKind } from "@/lib/editor/types";

const SHAPES: { icon: React.ReactNode; id: ShapeKind; label: string }[] = [
  { icon: <SquareIcon />, id: "rect", label: "Rectangle" },
  { icon: <MinusIcon />, id: "line", label: "Line" },
  { icon: <CircleIcon />, id: "circle", label: "Circle" },
];

export const ShapeMenu = ({ disabled }: { disabled: boolean }) => {
  const tool = useEditorStore((state) => state.tool);
  const shape = useEditorStore((state) => state.shapeStyle.shape);

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Toggle
            aria-label="Shapes"
            pressable
            disabled={disabled}
            pressed={tool === "shape"}
            size="sm"
          >
            <SquareIcon />
          </Toggle>
        }
      />
      <PopoverPopup align="start" side="left">
        <div className="flex flex-col gap-1 p-1">
          {SHAPES.map((item) => (
            <button
              className="hover:bg-accent editor-pressable flex items-center gap-2 rounded-md px-2 py-1.5 text-sm"
              key={item.id}
              onClick={() => {
                editorStore.setShapeStyle({ shape: item.id });
                editorStore.setTool("shape");
              }}
              type="button"
            >
              {item.icon}
              {item.label}
              {shape === item.id ? (
                <span className="text-muted-foreground ml-auto text-xs">
                  Active
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </PopoverPopup>
    </Popover>
  );
};
