"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import type { VariantProps } from "class-variance-authority";
import type * as React from "react";

import { buttonVariants } from "@/components/ui/button-variants";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

interface ButtonProps extends useRender.ComponentProps<"button"> {
  decoration?: VariantProps<typeof buttonVariants>["decoration"];
  variant?: VariantProps<typeof buttonVariants>["variant"];
  size?: VariantProps<typeof buttonVariants>["size"];
  loading?: boolean;
  pressable?: boolean;
}

export const Button = ({
  className,
  decoration,
  variant,
  size,
  render,
  children,
  loading = false,
  disabled: disabledProp,
  pressable = false,
  ...props
}: ButtonProps): React.ReactElement => {
  const isDisabled = Boolean(loading || disabledProp);
  const typeValue: React.ButtonHTMLAttributes<HTMLButtonElement>["type"] =
    render ? undefined : "button";

  const defaultProps = {
    "aria-disabled": loading || undefined,
    children: (
      <>
        {children}
        {loading && (
          <Spinner
            className="pointer-events-none absolute"
            data-slot="button-loading-indicator"
          />
        )}
      </>
    ),
    className: cn(
      buttonVariants({ className, decoration, size, variant }),
      pressable && "editor-pressable"
    ),
    "data-loading": loading ? "" : undefined,
    "data-slot": "button",
    disabled: isDisabled,
    type: typeValue,
  };

  return useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(defaultProps, props),
    render,
  });
};
