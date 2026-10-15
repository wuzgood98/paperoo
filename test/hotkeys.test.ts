import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { bindHotkeys } from "@/lib/hotkeys";

class FakeElement {
  readonly isContentEditable: boolean;
  readonly tagName: string;
  readonly #type: string | null;

  constructor(tagName: string, type: string | null = null, editable = false) {
    this.tagName = tagName;
    this.#type = type;
    this.isContentEditable = editable;
  }

  getAttribute(name: string): string | null {
    return name === "type" ? this.#type : null;
  }
}

// The subset of KeyboardEvent that bindHotkeys reads.
interface FakeKeyEvent {
  ctrlKey: boolean;
  defaultPrevented: boolean;
  isComposing: boolean;
  key: string;
  metaKey: boolean;
  preventDefault: () => void;
  repeat: boolean;
  shiftKey: boolean;
  target: FakeElement | null;
}

type Listener = (event: FakeKeyEvent) => void;

let listener: Listener | undefined;

beforeEach(() => {
  vi.stubGlobal("HTMLElement", FakeElement);
  vi.stubGlobal("window", {
    addEventListener: (_type: string, next: Listener) => {
      listener = next;
    },
    removeEventListener: () => {
      listener = undefined;
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  listener = undefined;
});

interface PressOptions {
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  target?: FakeElement | null;
}

const press = (key: string, options: PressOptions = {}) => {
  const event: FakeKeyEvent = {
    ctrlKey: options.ctrlKey ?? false,
    defaultPrevented: false,
    isComposing: false,
    key,
    metaKey: options.metaKey ?? false,
    preventDefault: vi.fn(),
    repeat: false,
    shiftKey: options.shiftKey ?? false,
    target: options.target ?? null,
  };
  listener?.(event);
  return event;
};

const bindEditorHistory = () => {
  const undo = vi.fn();
  const redo = vi.fn();
  const nudge = vi.fn();
  const unbind = bindHotkeys([
    { handler: undo, key: "z", meta: true, shift: false },
    { handler: redo, key: "z", meta: true, shift: true },
    { handler: redo, key: "y", meta: true },
    { handler: nudge, key: "ArrowLeft" },
  ]);
  return { nudge, redo, unbind, undo };
};

test("Ctrl+Z and Meta+Z undo", () => {
  const { redo, undo } = bindEditorHistory();
  press("z", { ctrlKey: true });
  press("z", { metaKey: true });
  expect(undo).toHaveBeenCalledTimes(2);
  expect(redo).not.toHaveBeenCalled();
});

test("Ctrl+Shift+Z redoes instead of undoing", () => {
  const { redo, undo } = bindEditorHistory();
  press("Z", { ctrlKey: true, shiftKey: true });
  press("Z", { metaKey: true, shiftKey: true });
  expect(redo).toHaveBeenCalledTimes(2);
  expect(undo).not.toHaveBeenCalled();
});

test("Ctrl+Y redoes", () => {
  const { redo, undo } = bindEditorHistory();
  const event = press("y", { ctrlKey: true });
  expect(redo).toHaveBeenCalledTimes(1);
  expect(undo).not.toHaveBeenCalled();
  expect(event.preventDefault).toHaveBeenCalled();
});

test("modified hotkeys fire while a slider or select has focus", () => {
  const { redo, undo } = bindEditorHistory();
  press("z", { ctrlKey: true, target: new FakeElement("INPUT", "range") });
  press("y", { ctrlKey: true, target: new FakeElement("SELECT") });
  expect(undo).toHaveBeenCalledTimes(1);
  expect(redo).toHaveBeenCalledTimes(1);
});

test("unmodified hotkeys stay with a focused slider", () => {
  const { nudge } = bindEditorHistory();
  const event = press("ArrowLeft", {
    target: new FakeElement("INPUT", "range"),
  });
  expect(nudge).not.toHaveBeenCalled();
  expect(event.preventDefault).not.toHaveBeenCalled();
});

test("text entry keeps the browser's own undo", () => {
  const { undo } = bindEditorHistory();
  const targets = [
    new FakeElement("INPUT", "number"),
    new FakeElement("INPUT"),
    new FakeElement("TEXTAREA"),
    new FakeElement("DIV", null, true),
  ];
  for (const target of targets) {
    const event = press("z", { ctrlKey: true, target });
    expect(event.preventDefault).not.toHaveBeenCalled();
  }
  expect(undo).not.toHaveBeenCalled();
});

test("unbinding removes the listener", () => {
  const { undo, unbind } = bindEditorHistory();
  unbind();
  press("z", { ctrlKey: true });
  expect(undo).not.toHaveBeenCalled();
});
