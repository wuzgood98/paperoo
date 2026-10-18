/**
 * One saved session slot is shared by every tab. The tab saving into it
 * holds this Web Lock until it clears the slot or closes, so other tabs
 * neither overwrite it nor offer to restore a session that is still open.
 */
const SLOT_LOCK = "paperoo:autosave";

let releaseHeld: (() => void) | null = null;

/** Hold the slot; true when this tab now holds it (or locks are unsupported). */
export const claimSlot = async (): Promise<boolean> => {
  if (releaseHeld) {
    return true;
  }
  if (typeof navigator === "undefined" || !navigator.locks) {
    return true;
  }
  // oxlint-disable-next-line promise/avoid-new -- the lock callback reports whether it was granted
  return await new Promise<boolean>((resolve) => {
    void navigator.locks.request(
      SLOT_LOCK,
      { ifAvailable: true },
      async (lock) => {
        if (!lock) {
          resolve(false);
          return;
        }
        resolve(true);
        // oxlint-disable-next-line promise/avoid-new -- held until releaseSlot
        await new Promise<void>((_resolve) => {
          releaseHeld = _resolve;
        });
      }
    );
  });
};

export const releaseSlot = (): void => {
  releaseHeld?.();
  releaseHeld = null;
};

/**
 * A reloading tab lets go of the lock only as its old page unloads, which
 * can be after the new page asks; wait this long before deciding.
 */
const SLOT_WAIT_MS = 2000;

/** True when no tab holds the slot, so its saved session is not open anywhere. */
export const isSlotFree = async (): Promise<boolean> => {
  if (releaseHeld) {
    return false;
  }
  if (typeof navigator === "undefined" || !navigator.locks) {
    return true;
  }
  try {
    return await navigator.locks.request(
      SLOT_LOCK,
      { signal: AbortSignal.timeout(SLOT_WAIT_MS) },
      () => true
    );
  } catch {
    // Still held when the wait ran out: the session is open in another tab.
    return false;
  }
};
