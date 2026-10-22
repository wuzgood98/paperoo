import type { MetadataRoute } from "next";

import { appIcons, appIconSrc } from "@/lib/app-icons";
import { siteConfig } from "@/lib/site";

const manifest = (): MetadataRoute.Manifest => ({
  background_color: "#ffffff",
  description: siteConfig.description,
  display: "standalone",
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
