import { cp, mkdir } from "node:fs/promises";
import path from "node:path";

const root = path.join(import.meta.dirname, "..");
const pdfjs = path.join(root, "node_modules", "pdfjs-dist");
const publicDir = path.join(root, "public");

const copies = [
  ["cmaps", path.join(publicDir, "pdfjs", "cmaps")],
  ["standard_fonts", path.join(publicDir, "pdfjs", "standard_fonts")],
  ["wasm", path.join(publicDir, "pdfjs", "wasm")],
  ["iccs", path.join(publicDir, "pdfjs", "iccs")],
];

const fonts = [
  "LiberationSans-Regular.ttf",
  "LiberationSans-Bold.ttf",
  "LiberationSans-Italic.ttf",
  "LiberationSans-BoldItalic.ttf",
];

await mkdir(path.join(publicDir, "pdfjs"), { recursive: true });
await mkdir(path.join(publicDir, "fonts"), { recursive: true });

await Promise.all(
  copies.map(([from, to]) =>
    cp(path.join(pdfjs, from), to, { recursive: true })
  )
);

await Promise.all(
  fonts.map((font) =>
    cp(
      path.join(pdfjs, "standard_fonts", font),
      path.join(publicDir, "fonts", font)
    )
  )
);

console.log("Copied pdf.js assets and Liberation fonts into public/");
