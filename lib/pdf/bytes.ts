export const clonePdfBytes = (bytes: Uint8Array): Uint8Array => {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
};
