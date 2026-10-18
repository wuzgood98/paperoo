"use client";

import { CheckIcon, CircleIcon, MinusIcon, SquareIcon } from "lucide-react";
import { useState } from "react";

import { Popover, PopoverPopup, PopoverTrigger } from "@/components/ui/popover";
import { Toggle } from "@/components/ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { editorStore, useEditorStore } from "@/lib/editor/store";
import { toolTooltip } from "@/lib/editor/tool-keys";
import type { ShapeKind } from "@/lib/editor/types";

/** Lucide has no dashed line, so this matches its 24px stroke style. */
const DashedLineIcon = () => (
  <svg
    aria-hidden="true"
    fill="none"
    height="24"
    stroke="currentColor"
    strokeLinecap="round"
    strokeWidth="2"
    viewBox="0 0 24 24"
    width="24"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M4 12h3M10.5 12h3M17 12h3" />
  </svg>
);

const SHAPES: {
  dashed: boolean;
  icon: React.ReactNode;
  id: string;
  label: string;
  shape: ShapeKind;
}[] = [
  {
    dashed: false,
    icon: <SquareIcon />,
    id: "rect",
    label: "Rectangle",
    shape: "rect",
  },
  {
    dashed: false,
    icon: <MinusIcon />,
    id: "line",
    label: "Line",
    shape: "line",
  },
  {
    dashed: true,
    icon: <DashedLineIcon />,
    id: "dashed-line",
    label: "Dashed line",
    shape: "line",
  },
  {
    dashed: false,
    icon: <CircleIcon />,
    id: "circle",
    label: "Circle",
    shape: "circle",
  },
];

/** Rendered inside the tool rail's ToggleGroup, which owns pressed state. */
export const ShapeMenu = ({ isMdUp }: { isMdUp: boolean }) => {
  const tool = useEditorStore((state) => state.tool);
  const shape = useEditorStore((state) => state.shapeStyle.shape);
  const dashed = useEditorStore((state) => state.shapeStyle.dashed);
  const [open, setOpen] = useState(false);
  // Dashes only apply to lines, so a box keeps matching whatever dashed is.
  const isCurrent = (item: (typeof SHAPES)[number]) =>
    item.shape === shape && (shape !== "line" || item.dashed === dashed);
  const current = SHAPES.find(isCurrent) ?? SHAPES[0];

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
                editorStore.setShapeStyle({
                  dashed: item.dashed,
                  shape: item.shape,
                });
                editorStore.setTool("shape");
                setOpen(false);
              }}
              type="button"
            >
              {item.icon}
              {item.label}
              {tool === "shape" && isCurrent(item) ? (
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
