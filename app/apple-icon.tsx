/* oxlint-disable shadcn/no-inline-styles -- next/og ImageResponse only accepts inline styles */

import { ImageResponse } from "next/og";

import { LogoGlyph } from "@/components/brand/logo-mark";

export const size = {
  height: 180,
  width: 180,
};

export const contentType = "image/png";

const AppleIcon = () =>
  new ImageResponse(
    <div
      style={{
        alignItems: "center",
        background: "#141414",
        display: "flex",
        height: "100%",
        justifyContent: "center",
        width: "100%",
      }}
    >
      <LogoGlyph fill="#ffffff" size={118} />
    </div>,
    size
  );

export default AppleIcon;
