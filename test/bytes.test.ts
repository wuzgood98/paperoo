import { expect, test } from "vitest";

import { clonePdfBytes } from "@/lib/pdf/bytes";

const sliceBuffer = (buffer: ArrayBufferLike): ArrayBuffer =>
  ArrayBuffer.prototype.slice.call(buffer, 0);

test("clonePdfBytes survives a transferred detached source buffer", () => {
  const source = new Uint8Array([37, 80, 68, 70]);
  const clone = clonePdfBytes(source);

  structuredClone(source, { transfer: [source.buffer] });

  expect(source.buffer.detached).toBe(true);
  expect(() => sliceBuffer(source.buffer)).toThrow(
    /ArrayBuffer\.prototype\.slice on a detached ArrayBuffer/u
  );

  expect(clone[0]).toBe(37);
  expect(clone[1]).toBe(80);
  expect(clone[2]).toBe(68);
  expect(clone[3]).toBe(70);
  expect(sliceBuffer(clone.buffer).byteLength).toBe(4);
});
