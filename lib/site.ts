const DEFAULT_APP_URL = "http://localhost:3000";

const trimTrailingSlash = (url: string): string => url.replace(/\/$/u, "");

const appUrl = trimTrailingSlash(
  process.env.NEXT_PUBLIC_APP_URL ?? DEFAULT_APP_URL
);

const siteDescription =
  "Open, edit, export, and print PDFs in your browser. Text, images, drawing, signatures, OCR, and page tools — files never leave your machine.";

const siteName = "Paperoo";

const supportEmail = "support@paperoo.app";

const organizationId = `${appUrl}/#organization`;

export const siteConfig = {
  description: siteDescription,
  jsonLd: {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        name: siteName,
        publisher: { "@id": organizationId },
        url: appUrl,
      },
      {
        "@id": organizationId,
        "@type": "Organization",
        contactPoint: {
          "@type": "ContactPoint",
          contactType: "customer support",
          email: supportEmail,
        },
        email: supportEmail,
        name: siteName,
        url: appUrl,
      },
      {
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
        publisher: { "@id": organizationId },
        url: appUrl,
      },
    ],
  },
  keywords: ["PDF editor", "browser PDF editor", "private PDF editing", "OCR"],
  name: siteName,
  supportEmail,
  title: `${siteName} — Edit PDFs in your browser`,
  url: appUrl,
};

/** A mailto link to support with the subject and body filled in. */
export const supportMailto = ({
  body,
  subject,
}: {
  body: string;
  subject: string;
}): string => {
  const params = new URLSearchParams({ body, subject });
  // Mail apps read "+" literally, so spaces must be %20.
  return `mailto:${supportEmail}?${params.toString().replaceAll("+", "%20")}`;
};
