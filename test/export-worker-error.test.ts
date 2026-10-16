import { afterEach, expect, test, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

type MessageListener = (event: { data: unknown }) => Promise<void> | void;

test("a failed export still reports its error to the page", async () => {
  const listeners: MessageListener[] = [];
  const replies: unknown[] = [];
  vi.stubGlobal("self", {
    addEventListener: (type: string, listener: MessageListener) => {
      if (type === "message") {
        listeners.push(listener);
      }
    },
    location: { origin: "http://localhost" },
    // Mirrors the browser: a worker's postMessage has no targetOrigin, so a
    // string second argument fails overload resolution.
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- fake of an untyped browser API
    postMessage: (message: unknown, options?: unknown) => {
      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- reproduces WebIDL overload resolution
      if (typeof options === "string") {
        throw new TypeError("Overload resolution failed.");
      }
      replies.push(message);
    },
  });
  await import("@/lib/pdf/export.worker");

  const [listener] = listeners;
  expect(listener).toBeDefined();
  await listener?.({
    data: {
      assets: {},
      bytes: new TextEncoder().encode("not a pdf").buffer,
      document: { pages: [] },
      fontBytes: {},
    },
  });

  expect(replies).toHaveLength(1);
  expect(replies[0]).toMatchObject({ ok: false });
});
