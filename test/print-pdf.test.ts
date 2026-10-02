import { afterEach, expect, test, vi } from "vitest";

import { printPdfBlob } from "@/lib/pdf/print-blob";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const stubPrintDom = (iframe: {
  addEventListener: (type: string, handler: () => void) => void;
  contentWindow: unknown;
  remove: unknown;
  setAttribute: unknown;
  src: string;
  style: { cssText: string };
}) => {
  vi.stubGlobal("document", {
    body: { append: vi.fn() },
    createElement: vi.fn((tag: string) => {
      expect(tag).toBe("iframe");
      return iframe;
    }),
  });
};

test("printPdfBlob settles, registers afterprint, then prints and cleans up", async () => {
  vi.useFakeTimers();

  const print = vi.fn();
  const revoke = vi.fn();
  const remove = vi.fn();
  const append = vi.fn();
  const registeredTypes: string[] = [];
  let afterPrintHandler: (() => void) | undefined;
  let loadHandler: (() => void) | undefined;

  const contentWindow = {
    addEventListener: (type: string, handler: () => void) => {
      registeredTypes.push(type);
      if (type === "afterprint") {
        afterPrintHandler = handler;
      }
    },
    focus: vi.fn(),
    print,
  };

  const iframe = {
    addEventListener: (type: string, handler: () => void) => {
      if (type === "load") {
        loadHandler = handler;
      }
    },
    contentWindow,
    remove,
    setAttribute: vi.fn(),
    src: "",
    style: { cssText: "" },
  };

  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => "blob:print-test"),
    revokeObjectURL: revoke,
  });

  vi.stubGlobal("document", {
    body: { append },
    createElement: vi.fn((tag: string) => {
      expect(tag).toBe("iframe");
      return iframe;
    }),
  });

  const pending = printPdfBlob(new Blob(["%PDF"], { type: "application/pdf" }));

  expect(append).toHaveBeenCalledWith(iframe);
  expect(iframe.src).toBe("blob:print-test");
  expect(iframe.style.cssText).toContain("height:100px");
  expect(loadHandler).toBeTypeOf("function");

  loadHandler?.();
  expect(print).not.toHaveBeenCalled();
  expect(registeredTypes).toEqual([]);

  await vi.advanceTimersByTimeAsync(1000);

  expect(registeredTypes).toEqual(["afterprint"]);
  expect(registeredTypes).not.toContain("beforeunload");
  expect(afterPrintHandler).toBeTypeOf("function");
  expect(contentWindow.focus).toHaveBeenCalledOnce();
  expect(print).toHaveBeenCalledOnce();

  afterPrintHandler?.();
  await pending;

  expect(remove).toHaveBeenCalledOnce();
  expect(revoke).toHaveBeenCalledWith("blob:print-test");
});

test("printPdfBlob cleans up via fallback timer when afterprint never fires", async () => {
  vi.useFakeTimers();

  const print = vi.fn();
  const revoke = vi.fn();
  const remove = vi.fn();
  const registeredTypes: string[] = [];
  let loadHandler: (() => void) | undefined;

  const contentWindow = {
    addEventListener: (type: string, _handler: () => void) => {
      registeredTypes.push(type);
    },
    focus: vi.fn(),
    print,
  };

  const iframe = {
    addEventListener: (type: string, handler: () => void) => {
      if (type === "load") {
        loadHandler = handler;
      }
    },
    contentWindow,
    remove,
    setAttribute: vi.fn(),
    src: "",
    style: { cssText: "" },
  };

  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => "blob:print-fallback"),
    revokeObjectURL: revoke,
  });

  stubPrintDom(iframe);

  const pending = printPdfBlob(new Blob(["%PDF"], { type: "application/pdf" }));
  loadHandler?.();
  expect(print).not.toHaveBeenCalled();

  await vi.advanceTimersByTimeAsync(1000);
  expect(print).toHaveBeenCalledOnce();
  expect(registeredTypes).toEqual(["afterprint"]);
  expect(registeredTypes).not.toContain("beforeunload");

  await vi.advanceTimersByTimeAsync(60_000);
  await pending;

  expect(remove).toHaveBeenCalledOnce();
  expect(revoke).toHaveBeenCalledWith("blob:print-fallback");
});
