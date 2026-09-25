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
    <aside className="border-border bg-background flex flex-col items-center gap-1 border-l py-2">
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
