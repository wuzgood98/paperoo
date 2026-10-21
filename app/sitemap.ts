import type { MetadataRoute } from "next";

import { siteConfig } from "@/lib/site";

const sitemap = (): MetadataRoute.Sitemap => [
  {
    changeFrequency: "monthly",
    priority: 1,
    url: siteConfig.url,
  },
  {
    changeFrequency: "yearly",
    priority: 0.3,
    url: `${siteConfig.url}/privacy`,
  },
];

export default sitemap;
