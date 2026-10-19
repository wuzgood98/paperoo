"use client";

import {
  HighlighterIcon,
  ImageIcon,
  MousePointer2Icon,
  PenLineIcon,
  RectangleEllipsisIcon,
  SignatureIcon,
  TypeIcon,
} from "lucide-react";

import { ShapeMenu } from "@/components/editor/shape-menu";
import { Toggle } from "@/components/ui/toggle";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { useMdUp } from "@/hooks/use-md-up";
import { editorStore, useEditorStore } from "@/lib/editor/store";
import { toolTooltip } from "@/lib/editor/tool-keys";
import type { EditorTool } from "@/lib/editor/types";

const TOOLS: { icon: React.ReactNode; id: EditorTool; label: string }[] = [
  { icon: <MousePointer2Icon />, id: "select", label: "Select" },
  { icon: <TypeIcon />, id: "text", label: "Text" },
  { icon: <ImageIcon />, id: "image", label: "Image" },
  { icon: <PenLineIcon />, id: "draw", label: "Draw" },
  { icon: <SignatureIcon />, id: "signature", label: "Signature" },
  { icon: <HighlighterIcon />, id: "highlight", label: "Highlight" },
  { icon: <RectangleEllipsisIcon />, id: "redact", label: "Redact" },
];

export const ToolRail = () => {
  const tool = useEditorStore((state) => state.tool);
  const status = useEditorStore((state) => state.status);
  const isMdUp = useMdUp();
  const disabled = status !== "ready";
  const tooltipSide = isMdUp ? "left" : "top";

  return (
    <ToggleGroup<EditorTool>
      aria-label="Tools"
      className="border-border bg-background flex shrink-0 items-center gap-1 overscroll-x-contain max-md:touch-pan-x max-md:justify-center max-md:overflow-x-auto max-md:border-t max-md:px-2 max-md:py-1.5 md:touch-auto md:flex-col md:overflow-x-visible md:overscroll-auto md:border-t-0 md:border-l md:px-0 md:py-2"
      disabled={disabled}
      onValueChange={(value, details) => {
        const [next] = value;
        // Pressing the active tool again would leave no tool selected.
        if (!next) {
          details.cancel();
          return;
        }
        editorStore.setTool(next);
      }}
      orientation={isMdUp ? "vertical" : "horizontal"}
      render={<aside />}
      value={[tool]}
    >
      {TOOLS.map((item) => (
        <Tooltip key={item.id}>
          <TooltipTrigger
            render={
              <Toggle
                aria-label={item.label}
                pressable
                size="sm"
                value={item.id}
              >
                {item.icon}
              </Toggle>
            }
          />
          <TooltipPopup side={tooltipSide}>
            {toolTooltip(item.label, item.id)}
          </TooltipPopup>
        </Tooltip>
      ))}
      <ShapeMenu isMdUp={isMdUp} />
    </ToggleGroup>
  );
};
