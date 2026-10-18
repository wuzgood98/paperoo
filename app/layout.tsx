/* oxlint-disable react/no-danger -- Next.js JSON-LD guide uses a script tag */

import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";

import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { ToastProvider } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { siteConfig } from "@/lib/site";
import { cn } from "@/lib/utils";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const viewport: Viewport = {
  colorScheme: "light dark",
  initialScale: 1,
  themeColor: [
    { color: "#ffffff", media: "(prefers-color-scheme: light)" },
    { color: "#171717", media: "(prefers-color-scheme: dark)" },
  ],
  viewportFit: "cover",
  width: "device-width",
};

export const metadata: Metadata = {
  alternates: {
    canonical: "/",
  },
  applicationName: siteConfig.name,
  authors: [{ name: "Gideon Ofori Addo", url: "https://g14o.dev" }],
  creator: "Gideon Ofori Addo",
  description: siteConfig.description,
  keywords: siteConfig.keywords,
  metadataBase: new URL(siteConfig.url),
  openGraph: {
    description: siteConfig.description,
    locale: "en_US",
    siteName: siteConfig.name,
    title: siteConfig.title,
    type: "website",
    url: "/",
  },
  robots: {
    follow: true,
    googleBot: {
      follow: true,
      index: true,
      "max-image-preview": "large",
    },
    index: true,
  },
  title: {
    default: siteConfig.title,
    template: `%s · ${siteConfig.name}`,
  },
  twitter: {
    card: "summary_large_image",
    description: siteConfig.description,
    title: siteConfig.title,
  },
};

const RootLayout = ({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) => (
  <html
    lang="en"
    suppressHydrationWarning
    className={cn("antialiased", "font-sans", geist.variable)}
    data-scroll-behavior="smooth"
  >
    <body>
      <script
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(siteConfig.jsonLd).replaceAll("<", "\\u003c"),
        }}
        type="application/ld+json"
      />
      <ThemeProvider>
        <TooltipProvider>
          <ToastProvider position="bottom-center">{children}</ToastProvider>
        </TooltipProvider>
      </ThemeProvider>
    </body>
  </html>
);

export default RootLayout;
