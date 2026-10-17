"use client";

import { CheckIcon, CircleIcon, MinusIcon, SquareIcon } from "lucide-react";
import { useState } from "react";

import { Popover, PopoverPopup, PopoverTrigger } from "@/components/ui/popover";
import { Toggle } from "@/components/ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { editorStore, useEditorStore } from "@/lib/editor/store";
import { toolTooltip } from "@/lib/editor/tool-keys";
import type { ShapeKind } from "@/lib/editor/types";

const SHAPES: { icon: React.ReactNode; id: ShapeKind; label: string }[] = [
  { icon: <SquareIcon />, id: "rect", label: "Rectangle" },
  { icon: <MinusIcon />, id: "line", label: "Line" },
  { icon: <CircleIcon />, id: "circle", label: "Circle" },
];

/** Rendered inside the tool rail's ToggleGroup, which owns pressed state. */
export const ShapeMenu = ({ isMdUp }: { isMdUp: boolean }) => {
  const tool = useEditorStore((state) => state.tool);
  const shape = useEditorStore((state) => state.shapeStyle.shape);
  const [open, setOpen] = useState(false);
  const current = SHAPES.find((item) => item.id === shape) ?? SHAPES[0];

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Toggle aria-label="Shapes" pressable size="sm" value="shape">
                  {current?.icon}
                </Toggle>
              }
            />
          }
        />
        <TooltipPopup side={isMdUp ? "left" : "top"}>
          {toolTooltip("Shapes", "shape")}
        </TooltipPopup>
      </Tooltip>
      <PopoverPopup
        align={isMdUp ? "start" : "center"}
        side={isMdUp ? "left" : "top"}
      >
        <div className="flex flex-col gap-1">
          {SHAPES.map((item) => (
            <button
              className="hover:bg-accent editor-pressable flex items-center gap-2 rounded-md px-2 py-1.5 text-sm"
              key={item.id}
              onClick={() => {
                editorStore.setShapeStyle({ shape: item.id });
                editorStore.setTool("shape");
                setOpen(false);
              }}
              type="button"
            >
              {item.icon}
              {item.label}
              {tool === "shape" && shape === item.id ? (
                <CheckIcon
                  aria-label="Active"
                  className="text-muted-foreground ml-auto size-4"
                />
              ) : null}
            </button>
          ))}
        </div>
      </PopoverPopup>
    </Popover>
  );
};
