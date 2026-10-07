import type { MetadataRoute } from "next";

import { siteConfig } from "@/lib/site";

const manifest = (): MetadataRoute.Manifest => ({
  background_color: "#ffffff",
  description: siteConfig.description,
  display: "standalone",
  icons: [
    {
      sizes: "any",
      src: "/icon.svg",
      type: "image/svg+xml",
    },
    {
      sizes: "180x180",
      src: "/apple-icon",
      type: "image/png",
    },
  ],
  name: siteConfig.name,
  short_name: siteConfig.name,
  start_url: "/",
  theme_color: "#141414",
});

export default manifest;
