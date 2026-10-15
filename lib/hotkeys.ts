// In-repo hotkeys on purpose: @tanstack/react-hotkeys ignoreInputs
// defaults fire Mod+Z inside focused contenteditable text.
export interface HotkeyDefinition {
  allowInInput?: boolean;
  handler: (event: KeyboardEvent) => void;
  key: string;
  meta?: boolean;
  shift?: boolean;
}

// Input types with no text editing (and so no native undo). Anything else,
// including unknown types the browser treats as text, counts as text entry.
const CONTROL_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

type TargetKind = "control" | "none" | "text";

// "text" swallows every hotkey; "control" (range, color, checkbox, select…)
// only swallows unmodified keys, since those controls have no native ⌘Z/⌘Y.
const getTargetKind = (target: EventTarget | null): TargetKind => {
  if (!(target instanceof HTMLElement)) {
    return "none";
  }

  if (target.isContentEditable || target.tagName === "TEXTAREA") {
    return "text";
  }

  if (target.tagName === "SELECT") {
    return "control";
  }

  if (target.tagName === "INPUT") {
    const type = (target.getAttribute("type") ?? "").toLowerCase();
    return CONTROL_INPUT_TYPES.has(type) ? "control" : "text";
  }

  return "none";
};

const isBlockedByTarget = (
  target: EventTarget | null,
  hotkey: HotkeyDefinition
): boolean => {
  if (hotkey.allowInInput) {
    return false;
  }

  const kind = getTargetKind(target);
  return kind === "text" || (kind === "control" && !hotkey.meta);
};

const isMetaPressed = (event: KeyboardEvent): boolean =>
  event.metaKey || event.ctrlKey;

const matches = (event: KeyboardEvent, hotkey: HotkeyDefinition): boolean => {
  if (event.key.toLowerCase() !== hotkey.key.toLowerCase()) {
    return false;
  }

  if (Boolean(hotkey.meta) !== isMetaPressed(event)) {
    return false;
  }

  if (hotkey.shift === true && !event.shiftKey) {
    return false;
  }

  if (hotkey.shift === false && event.shiftKey) {
    return false;
  }

  return true;
};

export const bindHotkeys = (
  hotkeys: readonly HotkeyDefinition[]
): (() => void) => {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || event.repeat || event.isComposing) {
      return;
    }

    for (const hotkey of hotkeys) {
      if (!matches(event, hotkey)) {
        continue;
      }

      if (isBlockedByTarget(event.target, hotkey)) {
        return;
      }

      event.preventDefault();
      hotkey.handler(event);
      return;
    }
  };

  window.addEventListener("keydown", onKeyDown);

  return () => {
    window.removeEventListener("keydown", onKeyDown);
  };
};
