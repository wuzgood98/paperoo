import { Loader2Icon } from "lucide-react";
import type React from "react";

import { cn } from "@/lib/utils";

export const Spinner = ({
  className,
  ...props
}: React.ComponentProps<typeof Loader2Icon>): React.ReactElement => (
  <output aria-label="Loading">
    <Loader2Icon className={cn("animate-spin", className)} {...props} />
  </output>
);
