import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

// Everything Paperoo does runs in the browser, so the policy only allows this
// site's own origin. connect-src 'self' is what keeps files from being sent
// anywhere else. pdf.js and OCR need WebAssembly ('wasm-unsafe-eval') and
// blob: workers; printing loads the exported PDF into a blob: iframe.
// Development also needs eval for React's error stacks, and Vercel Analytics
// loads its debug script from its own host (production serves it from here).
const devScripts = isDev ? " 'unsafe-eval' https://va.vercel-scripts.com" : "";

const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${devScripts}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self' data:",
  "connect-src 'self' blob: data:",
  "worker-src 'self' blob:",
  "frame-src 'self' blob:",
  "media-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const immutableCache = [
  {
    key: "Cache-Control",
    value: "public, max-age=31536000, immutable",
  },
];

const nextConfig: NextConfig = {
  headers() {
    return [
      {
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
        source: "/(.*)",
      },
      { headers: immutableCache, source: "/pdfjs/:path*" },
      { headers: immutableCache, source: "/fonts/:path*" },
      { headers: immutableCache, source: "/ocr/:path*" },
    ];
  },
};

export default nextConfig;
