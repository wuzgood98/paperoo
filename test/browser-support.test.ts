import { expect, test } from "vitest";

import { supportsPdfEngine } from "@/lib/browser-support";

const helper = (): string => "";

test("supportsPdfEngine accepts a browser with the hex and base64 helpers", () => {
  expect(
    supportsPdfEngine({
      fromBase64: helper,
      prototype: { toBase64: helper, toHex: helper },
    })
  ).toBe(true);
});

test("supportsPdfEngine rejects a browser missing any helper pdf.js calls", () => {
  expect(supportsPdfEngine({ prototype: {} })).toBe(false);
  expect(
    supportsPdfEngine({ fromBase64: helper, prototype: { toBase64: helper } })
  ).toBe(false);
  expect(
    supportsPdfEngine({ fromBase64: helper, prototype: { toHex: helper } })
  ).toBe(false);
  expect(
    supportsPdfEngine({ prototype: { toBase64: helper, toHex: helper } })
  ).toBe(false);
});
