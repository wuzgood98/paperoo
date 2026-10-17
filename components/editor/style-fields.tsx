"use client";

import { ColorField } from "@/components/editor/color-field";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const STROKE_WIDTHS = [1, 2, 4, 8] as const;

const STROKE_WIDTH_ITEMS = STROKE_WIDTHS.map((width) => ({
  label: `${width} pt`,
  value: String(width),
}));

/** Fallback swatch shown while a shape has no fill. */
const EMPTY_FILL_SWATCH = "#ffffff";

export const StrokeWidthField = ({
  onChange,
  value,
}: {
  onChange: (width: number) => void;
  value: number;
}) => (
  <div className="text-muted-foreground flex items-center gap-2 text-xs">
    Width
    <Select
      items={STROKE_WIDTH_ITEMS}
      onValueChange={(next) => {
        const width = Number(next);
        if (Number.isFinite(width) && width > 0) {
          onChange(width);
        }
      }}
      value={String(value)}
    >
      <SelectTrigger aria-label="Stroke width" className="w-20" size="sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {STROKE_WIDTH_ITEMS.map(({ label, value: item }) => (
          <SelectItem key={item} value={item}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  </div>
);

export const FillField = ({
  onChange,
  value,
}: {
  onChange: (fill: string | null) => void;
  value: string | null;
}) => (
  <div className="flex items-center gap-1">
    <ColorField
      label="Fill"
      onChange={onChange}
      value={value ?? EMPTY_FILL_SWATCH}
    />
    <Button
      aria-pressed={value === null}
      onClick={() => onChange(null)}
      size="xs"
      variant={value === null ? "secondary" : "ghost"}
    >
      None
    </Button>
  </div>
);
