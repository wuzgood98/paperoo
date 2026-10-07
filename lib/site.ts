const DEFAULT_APP_URL = "http://localhost:3000";

const trimTrailingSlash = (url: string): string => url.replace(/\/$/u, "");

const appUrl = trimTrailingSlash(
  process.env.NEXT_PUBLIC_APP_URL ?? DEFAULT_APP_URL
);

const siteDescription =
  "Open, edit, export, and print PDFs in your browser. Text, images, drawing, signatures, OCR, and page tools — files never leave your machine.";

const siteName = "Paperoo";

export const siteConfig = {
  description: siteDescription,
  jsonLd: {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    applicationCategory: "BusinessApplication",
    description: siteDescription,
    featureList: [
      "Open, edit, export, and print PDFs in the browser",
      "Text, image, drawing, signature, highlight, and shape overlays",
      "OCR for scanned pages",
      "Page reorder, rotate, and delete",
      "Files never leave your machine",
    ],
    name: siteName,
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
    operatingSystem: "Web",
    url: appUrl,
  },
  keywords: ["PDF editor", "browser PDF editor", "private PDF editing", "OCR"],
  name: siteName,
  title: `${siteName} — Edit PDFs in your browser`,
  url: appUrl,
};
