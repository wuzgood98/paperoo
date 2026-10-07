/* oxlint-disable shadcn/no-inline-styles -- next/og ImageResponse only accepts inline styles */

import { readFile } from "node:fs/promises";
import path from "node:path";

import { ImageResponse } from "next/og";

import { LogoGlyph } from "@/components/brand/logo-mark";
import { siteConfig } from "@/lib/site";

export const alt = siteConfig.title;

export const size = {
  height: 630,
  width: 1200,
};

export const contentType = "image/png";

const liberationSansBold = await readFile(
  path.join(process.cwd(), "public/fonts/LiberationSans-Bold.ttf")
);

const OpenGraphImage = () =>
  new ImageResponse(
    <div
      style={{
        background: "#f7f6f2",
        color: "#141414",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        justifyContent: "center",
        padding: 80,
        width: "100%",
      }}
    >
      <div
        style={{
          alignItems: "center",
          display: "flex",
          gap: 32,
        }}
      >
        <LogoGlyph fill="#141414" size={112} />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            maxWidth: 860,
          }}
        >
          <div
            style={{
              fontSize: 72,
              fontWeight: 700,
              letterSpacing: -2,
              lineHeight: 1,
            }}
          >
            {siteConfig.name}
          </div>
          <div
            style={{
              color: "#525252",
              fontSize: 28,
              lineHeight: 1.35,
              marginTop: 16,
            }}
          >
            {siteConfig.description}
          </div>
        </div>
      </div>
    </div>,
    {
      ...size,
      fonts: [
        {
          data: liberationSansBold,
          name: "Liberation Sans",
          style: "normal",
          weight: 700,
        },
      ],
    }
  );

export default OpenGraphImage;
