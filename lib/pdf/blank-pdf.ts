/** Source document ids of generated blank pages start with this. */
export const BLANK_DOC_PREFIX = "blank:";

/** Sizes are kept to 1/100 pt so equal pages share one blank source. */
const roundSize = (value: number): number => Math.round(value * 100) / 100;

/** The source document id of a blank page `width` × `height` points. */
export const blankDocId = (width: number, height: number): string =>
  `${BLANK_DOC_PREFIX}${roundSize(width)}x${roundSize(height)}`;

/** Width and height named by a blank source id; null for any other id. */
export const blankDocSize = (
  docId: string
): { height: number; width: number } | null => {
  if (!docId.startsWith(BLANK_DOC_PREFIX)) {
    return null;
  }
  const [width, height] = docId
    .slice(BLANK_DOC_PREFIX.length)
    .split("x")
    .map(Number);
  if (!(width && height && width > 0 && height > 0)) {
    return null;
  }
  return { height, width };
};

const encoder = new TextEncoder();

/**
 * A one-page PDF of the given size with nothing on it. Written by hand: a
 * few hundred bytes, the same every time, and no pdf-lib on the page.
 */
export const blankPdfBytes = (width: number, height: number): Uint8Array => {
  const w = roundSize(width);
  const h = roundSize(height);
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << >> /Contents 4 0 R >>`,
    "<< /Length 0 >>\nstream\n\nendstream",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = body.length;
  const entries = offsets
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  body +=
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${entries}` +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n` +
    `startxref\n${xrefOffset}\n%%EOF\n`;
  return encoder.encode(body);
};
