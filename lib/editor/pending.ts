import type { Point } from "@/lib/editor/types";

let signaturePoints: Point[] | null = null;
const listeners = new Set<() => void>();

const emit = (): void => {
  for (const listener of listeners) {
    listener();
  }
};

export const pendingSignature = {
  get: (): Point[] | null => signaturePoints,
  set: (points: Point[] | null): void => {
    signaturePoints = points;
    emit();
  },
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
