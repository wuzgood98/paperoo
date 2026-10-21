/**
 * pdf.js 6 calls `Uint8Array` hex and base64 helpers that only newer browsers
 * have (Chrome and Edge 140, Firefox 133, Safari 18.2). Without them every
 * open fails with "hashOriginal.toHex is not a function".
 */
export const UNSUPPORTED_BROWSER_MESSAGE =
  "Paperoo needs a newer browser. Update Chrome, Edge, Firefox, or Safari, then try again.";

interface ByteArrayClass {
  readonly fromBase64?: unknown;
  readonly prototype: object;
}

/** True when this browser has the byte helpers pdf.js needs to open a PDF. */
export const supportsPdfEngine = (
  bytes: ByteArrayClass = Uint8Array
): boolean =>
  "toHex" in bytes.prototype &&
  "toBase64" in bytes.prototype &&
  "fromBase64" in bytes;
