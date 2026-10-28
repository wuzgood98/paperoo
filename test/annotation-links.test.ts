import { expect, test } from "vitest";

import {
  openableWebUrl,
  resolvePdfLinkNavigation,
} from "@/lib/editor/annotation-links";

const document = { pages: [] };

test("web addresses open as parsed", () => {
  for (const [url, opened] of [
    ["https://example.com/a", "https://example.com/a"],
    ["http://example.com", "http://example.com/"],
    ["HTTPS://example.com", "https://example.com/"],
    // Raw, this would open relative to Paperoo's own page.
    ["https:example.com", "https://example.com/"],
  ] as const) {
    expect(resolvePdfLinkNavigation({ kind: "url", url }, document)).toEqual({
      kind: "url",
      url: opened,
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
    expect(openableWebUrl(url)).toBeNull();
    expect(resolvePdfLinkNavigation({ kind: "url", url }, document)).toBeNull();
  }
});
