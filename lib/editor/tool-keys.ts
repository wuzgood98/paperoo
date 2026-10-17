import type { EditorTool } from "@/lib/editor/types";

/** Single-key shortcut for each tool, shown in the rail's tooltips. */
export const TOOL_KEYS: readonly { key: string; tool: EditorTool }[] = [
  { key: "v", tool: "select" },
  { key: "t", tool: "text" },
  { key: "i", tool: "image" },
  { key: "d", tool: "draw" },
  { key: "s", tool: "signature" },
  { key: "h", tool: "highlight" },
  { key: "r", tool: "shape" },
];

export const toolTooltip = (label: string, tool: EditorTool): string => {
  const key = TOOL_KEYS.find((entry) => entry.tool === tool)?.key;
  return key ? `${label} (${key.toUpperCase()})` : label;
};
