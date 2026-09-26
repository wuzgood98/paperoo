"use client";

import { useEffect, useState } from "react";

const readDevicePixelRatio = (): number =>
  typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;

export const useDevicePixelRatio = (): number => {
  const [ratio, setRatio] = useState(readDevicePixelRatio);

  useEffect(() => {
    const media = window.matchMedia(`(resolution: ${ratio}dppx)`);
    const onChange = (): void => {
      setRatio(readDevicePixelRatio());
    };
    media.addEventListener("change", onChange);
    return () => {
      media.removeEventListener("change", onChange);
    };
  }, [ratio]);

  return ratio;
};
