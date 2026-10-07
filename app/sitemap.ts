import type { MetadataRoute } from "next";

import { siteConfig } from "@/lib/site";

const sitemap = (): MetadataRoute.Sitemap => [
  {
    changeFrequency: "monthly",
    priority: 1,
    url: siteConfig.url,
  },
];

export default sitemap;
