import type { MetadataRoute } from "next";

import { appIcons, appIconSrc } from "@/lib/app-icons";
import { siteConfig } from "@/lib/site";

const manifest = (): MetadataRoute.Manifest => ({
  background_color: "#ffffff",
  description: siteConfig.description,
  display: "standalone",
  // PNG only: a sizes "any" SVG entry looks like the biggest icon, and iOS
  // can pick it for the Home Screen and then fail to use it.
  icons: appIcons.map((icon) => ({
    purpose: icon.purpose,
    sizes: `${icon.size}x${icon.size}`,
    src: appIconSrc(icon),
    type: "image/png",
  })),
  id: "/",
  name: siteConfig.name,
  scope: "/",
  short_name: siteConfig.name,
  start_url: "/",
  theme_color: "#ffffff",
});

export default manifest;
