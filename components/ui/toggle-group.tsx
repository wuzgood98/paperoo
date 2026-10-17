"use client";

import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group";
import type React from "react";

import { cn } from "@/lib/utils";

export const ToggleGroup = <Value extends string>({
  className,
  ...props
}: ToggleGroupPrimitive.Props<Value>): React.ReactElement => (
  <ToggleGroupPrimitive
    className={cn("flex", className)}
    data-slot="toggle-group"
    {...props}
  />
);

export { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group";
