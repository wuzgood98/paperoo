/* oxlint-disable shadcn/no-inline-styles -- next/og ImageResponse only accepts inline styles */

import { ImageResponse } from "next/og";

import { LogoGlyph } from "@/components/brand/logo-mark";
import type { AppIcon } from "@/lib/app-icons";
import { BRAND_GLYPH_COLOR, BRAND_TILE_COLOR } from "@/lib/app-icons";

// Matches the 7/32 corner radius and 0.8 glyph scale of app/icon.svg.
const ANY_CORNER_RATIO = 7 / 32;
const ANY_GLYPH_RATIO = 0.8;
const MASKABLE_GLYPH_RATIO = 0.6;

export const renderAppIcon = ({
  purpose,
  size,
}: {
  purpose: AppIcon["purpose"];
  size: number;
}): ImageResponse => {
  const isMaskable = purpose === "maskable";
  const glyphRatio = isMaskable ? MASKABLE_GLYPH_RATIO : ANY_GLYPH_RATIO;

  return new ImageResponse(
    <div
      style={{
        alignItems: "center",
        background: BRAND_TILE_COLOR,
        borderRadius: isMaskable ? 0 : size * ANY_CORNER_RATIO,
        display: "flex",
        height: "100%",
        justifyContent: "center",
        width: "100%",
      }}
    >
      <LogoGlyph
        fill={BRAND_GLYPH_COLOR}
        size={Math.round(size * glyphRatio)}
      />
    </div>,
    { height: size, width: size }
  );
};
