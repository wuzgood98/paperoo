import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { ToastProvider } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  authors: [{ name: "Gideon Ofori Addo", url: "https://g14o.dev" }],
  description: "A lightweight web PDF editor",
  title: "Paperoo",
};

const RootLayout = ({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) => (
  <html
    lang="en"
    suppressHydrationWarning
    className={cn(
      "antialiased",
      fontMono.variable,
      "font-sans",
      geist.variable
    )}
    data-scroll-behavior="smooth"
  >
    <body>
      <ThemeProvider>
        <TooltipProvider>
          <ToastProvider position="bottom-center">{children}</ToastProvider>
        </TooltipProvider>
      </ThemeProvider>
    </body>
  </html>
);

export default RootLayout;
