// In-repo hotkeys on purpose: @tanstack/react-hotkeys ignoreInputs
// defaults fire Mod+Z inside focused contenteditable text.
export interface HotkeyDefinition {
  allowInInput?: boolean;
  handler: (event: KeyboardEvent) => void;
  key: string;
  meta?: boolean;
  shift?: boolean;
}

const isInputElement = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
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

      if (isInputElement(event.target) && !hotkey.allowInInput) {
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
