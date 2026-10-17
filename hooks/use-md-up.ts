"use client";

import { useSyncExternalStore } from "react";

const MD_QUERY = "(min-width: 768px)";

const subscribe = (onChange: () => void) => {
  const media = window.matchMedia(MD_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
};

const getSnapshot = () => window.matchMedia(MD_QUERY).matches;

const getServerSnapshot = () => true;

/** True at Tailwind's `md` breakpoint and up. */
export const useMdUp = (): boolean =>
  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
