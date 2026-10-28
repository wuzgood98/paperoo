import { expect, test } from "vitest";

import {
  isOpenableWebUrl,
  resolvePdfLinkNavigation,
} from "@/lib/editor/annotation-links";

const document = { pages: [] };

test("web addresses open", () => {
  for (const url of [
    "https://example.com/a",
    "http://example.com",
    "HTTPS://example.com",
  ]) {
    expect(resolvePdfLinkNavigation({ kind: "url", url }, document)).toEqual({
      kind: "url",
      url,
    });
  }
});

test("other address types never reach the browser", () => {
  for (const url of [
    // oxlint-disable-next-line eslint/no-script-url -- the test checks these are refused
    "javascript:alert(1)",
    // oxlint-disable-next-line eslint/no-script-url -- the test checks these are refused
    " javascript:alert(1)",
    // oxlint-disable-next-line eslint/no-script-url -- the test checks these are refused
    "JaVaScRiPt:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd",
    "vbscript:msgbox(1)",
    "ms-msdt:/id",
    "mailto:a@example.com",
    "relative/path.html",
    "",
  ]) {
    expect(isOpenableWebUrl(url)).toBe(false);
    expect(resolvePdfLinkNavigation({ kind: "url", url }, document)).toBeNull();
  }
});
