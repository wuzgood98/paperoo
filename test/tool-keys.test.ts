import { expect, test } from "vitest";

import { TOOL_KEYS, toolTooltip } from "@/lib/editor/tool-keys";

test("tool keys and tools are unique", () => {
  const keys = TOOL_KEYS.map((entry) => entry.key);
  const tools = TOOL_KEYS.map((entry) => entry.tool);
  expect(new Set(keys).size).toBe(keys.length);
  expect(new Set(tools).size).toBe(tools.length);
});

test("tooltips show the shortcut", () => {
  expect(toolTooltip("Draw", "draw")).toBe("Draw (D)");
  expect(toolTooltip("Shapes", "shape")).toBe("Shapes (R)");
});
