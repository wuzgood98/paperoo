"use client";

import {
  HighlighterIcon,
  ImageIcon,
  MousePointer2Icon,
  PenLineIcon,
  SignatureIcon,
  TypeIcon,
} from "lucide-react";

import { ShapeMenu } from "@/components/editor/shape-menu";
import { Toggle } from "@/components/ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { editorStore, useEditorStore } from "@/lib/editor/store";
import type { EditorTool } from "@/lib/editor/types";

const TOOLS: { icon: React.ReactNode; id: EditorTool; label: string }[] = [
  { icon: <MousePointer2Icon />, id: "select", label: "Select" },
  { icon: <TypeIcon />, id: "text", label: "Text" },
  { icon: <ImageIcon />, id: "image", label: "Image" },
  { icon: <PenLineIcon />, id: "draw", label: "Draw" },
  { icon: <SignatureIcon />, id: "signature", label: "Signature" },
  { icon: <HighlighterIcon />, id: "highlight", label: "Highlight" },
];

export const ToolRail = () => {
  const tool = useEditorStore((state) => state.tool);
  const status = useEditorStore((state) => state.status);
  const disabled = status !== "ready";

  return (
    <aside className="border-border bg-background flex shrink-0 items-center gap-1 overscroll-x-contain max-md:touch-pan-x max-md:justify-center max-md:overflow-x-auto max-md:border-t max-md:px-2 max-md:py-1.5 md:touch-auto md:flex-col md:overflow-x-visible md:overscroll-auto md:border-t-0 md:border-l md:px-0 md:py-2">
      {TOOLS.map((item) => (
        <Tooltip key={item.id}>
          <TooltipTrigger
            render={
              <Toggle
                aria-label={item.label}
                pressable
                disabled={disabled}
                onPressedChange={() => editorStore.setTool(item.id)}
                pressed={tool === item.id}
                size="sm"
              >
                {item.icon}
              </Toggle>
            }
          />
          <TooltipPopup>{item.label}</TooltipPopup>
        </Tooltip>
      ))}
      <ShapeMenu disabled={disabled} />
    </aside>
  );
};
