"use client";

import { useLayoutEffect, useRef, useState } from "react";

import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverPopup, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { hexToHsl, hslToHex, normalizeHex } from "@/lib/editor/color";
import type { Hsl } from "@/lib/editor/color";

const SWATCHES = [
  "#111827",
  "#dc2626",
  "#ea580c",
  "#facc15",
  "#16a34a",
  "#2563eb",
  "#7c3aed",
  "#ffffff",
];

const LIGHTNESS_MAX = 100;

export const ColorField = ({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  value: string;
}) => {
  const [hsl, setHsl] = useState(() => hexToHsl(value));
  const lastEmittedHex = useRef("");

  useLayoutEffect(() => {
    const nextHex = normalizeHex(value);
    if (nextHex === lastEmittedHex.current) {
      return;
    }
    lastEmittedHex.current = nextHex;
    setHsl(hexToHsl(nextHex));
  }, [value]);

  const emitHsl = (next: Hsl) => {
    const hex = hslToHex(next);
    lastEmittedHex.current = hex;
    setHsl(next);
    onChange(hex);
  };

  return (
    <Popover>
      <PopoverTrigger
        className="flex items-center gap-2 text-xs"
        render={
          <button
            className="editor-pressable flex items-center gap-2"
            type="button"
          >
            <span className="text-muted-foreground w-12 text-left">
              {label}
            </span>
            <span
              className="size-5 rounded-sm border"
              style={{ backgroundColor: value }}
            />
          </button>
        }
      />
      <PopoverPopup side="bottom">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-1.5">
            {SWATCHES.map((swatch) => (
              <button
                aria-label={swatch}
                className="editor-pressable size-5 rounded-sm border"
                key={swatch}
                onClick={() => onChange(swatch)}
                style={{ backgroundColor: swatch }}
                type="button"
              />
            ))}
          </div>
          <Field>
            <FieldLabel>Lightness</FieldLabel>
            <Slider
              aria-label="Lightness"
              className="flex-1"
              max={LIGHTNESS_MAX}
              min={0}
              onValueChange={(next) => {
                const lightness = Array.isArray(next) ? next[0] : next;
                if (lightness === undefined) {
                  return;
                }
                emitHsl({ ...hsl, l: lightness });
              }}
              step={1}
              value={[hsl.l]}
            />
          </Field>
          <Label className="mt-2 block" htmlFor={`${label}-color`}>
            <span className="sr-only">{label} color</span>
            <Input
              className="w-full cursor-pointer"
              style={{ padding: 0 }}
              id={`${label}-color`}
              onValueChange={(next) => onChange(next ?? "")}
              type="color"
              value={value}
            />
          </Label>
        </div>
      </PopoverPopup>
    </Popover>
  );
};
