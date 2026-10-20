"use client";

import { Geist } from "next/font/google";

import "./globals.css";
import { CrashScreen } from "@/components/crash-screen";
import { ThemeProvider } from "@/components/theme-provider";
import { cn } from "@/lib/utils";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

// Replaces the root layout when it crashes, so it brings its own document,
// styles, font and theme.
const GlobalError = ({ error }: { error: Error & { digest?: string } }) => (
  <html
    lang="en"
    suppressHydrationWarning
    className={cn("antialiased", "font-sans", geist.variable)}
  >
    <body>
      <title>Something went wrong · Paperoo</title>
      <ThemeProvider>
        <CrashScreen error={error} />
      </ThemeProvider>
    </body>
  </html>
);

export default GlobalError;
