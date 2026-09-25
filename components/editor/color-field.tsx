"use client";

import { Popover, PopoverPopup, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";

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

const hexToChannel = (hex: string): number => {
  const normalized = hex.replace("#", "").padEnd(6, "0");
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  return Math.round((r + g + b) / 3);
};

const applyLightness = (hex: string, lightness: number): string => {
  const normalized = hex.replace("#", "").padEnd(6, "0");
  const mix = (channel: number): string => {
    const next = Math.round((channel * lightness) / 255);
    return next.toString(16).padStart(2, "0");
  };
  return `#${mix(Number.parseInt(normalized.slice(0, 2), 16))}${mix(Number.parseInt(normalized.slice(2, 4), 16))}${mix(Number.parseInt(normalized.slice(4, 6), 16))}`;
};

export const ColorField = ({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  value: string;
}) => (
  <Popover>
    <PopoverTrigger
      className="flex items-center gap-2 text-xs"
      render={
        <button
          className="editor-pressable flex items-center gap-2"
          type="button"
        >
          <span className="text-muted-foreground w-12 text-left">{label}</span>
          <span
            className="size-5 rounded-sm border"
            style={{ backgroundColor: value }}
          />
        </button>
      }
    />
    <PopoverPopup className="w-56" side="bottom">
      <div className="p-2">
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
        <p className="text-muted-foreground mt-3 flex items-center gap-2 text-xs">
          Lightness
          <Slider
            aria-label="Lightness"
            className="flex-1"
            max={255}
            min={16}
            onValueChange={(next) => {
              const channel = Array.isArray(next) ? next[0] : next;
              if (channel === undefined) {
                return;
              }
              onChange(applyLightness(value, channel));
            }}
            step={1}
            value={[hexToChannel(value)]}
          />
        </p>
        <label className="mt-2 block text-xs" htmlFor={`${label}-color`}>
          <span className="sr-only">{label} color</span>
          <input
            className="h-8 w-full cursor-pointer rounded border bg-transparent p-0"
            id={`${label}-color`}
            onChange={(event) => onChange(event.target.value)}
            type="color"
            value={value}
          />
        </label>
      </div>
    </PopoverPopup>
  </Popover>
);
