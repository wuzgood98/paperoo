"use client";

import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";

export const ToolbarTip = ({
  children,
  label,
  shortcut,
}: {
  children: React.ReactElement;
  label: string;
  shortcut?: string;
}) => (
  <Tooltip>
    <TooltipTrigger render={children} />
    <TooltipPopup>
      <span className="flex items-center gap-2">
        {label}
        {shortcut ? <Kbd>{shortcut}</Kbd> : null}
      </span>
    </TooltipPopup>
  </Tooltip>
);
