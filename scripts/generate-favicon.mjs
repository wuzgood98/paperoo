// Rasterises app/icon.svg into a multi-size app/favicon.ico (PNG-encoded
// entries). Next.js can't generate favicon.ico from code, so rerun this after
// changing the icon: `pnpm icons`.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

const root = path.join(import.meta.dirname, "..");
const source = path.join(root, "app", "icon.svg");
const target = path.join(root, "app", "favicon.ico");

const SIZES = [16, 32, 48];
const HEADER_BYTES = 6;
const ENTRY_BYTES = 16;
const ICO_TYPE_ICON = 1;
const BITS_PER_PIXEL = 32;

const svg = await readFile(source);

const images = await Promise.all(
  SIZES.map((size) =>
    sharp(svg, { density: 72 * (size / 32) * 4 })
      .resize(size, size)
      .png()
      .toBuffer()
  )
);

const header = Buffer.alloc(HEADER_BYTES);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(ICO_TYPE_ICON, 2);
header.writeUInt16LE(SIZES.length, 4);

let offset = HEADER_BYTES + ENTRY_BYTES * SIZES.length;
const entries = SIZES.map((size, index) => {
  const entry = Buffer.alloc(ENTRY_BYTES);
  const { length } = images[index];
  entry.writeUInt8(size, 0);
  entry.writeUInt8(size, 1);
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(BITS_PER_PIXEL, 6);
  entry.writeUInt32LE(length, 8);
  entry.writeUInt32LE(offset, 12);
  offset += length;
  return entry;
});

await writeFile(target, Buffer.concat([header, ...entries, ...images]));
