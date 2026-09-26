import { expect, test } from "vitest";

import { applyHslLightness, hexToHsl, hslToHex } from "@/lib/editor/color";

const rgb = (hex: string) => {
  const normalized = hex.replace("#", "");
  return {
    b: Number.parseInt(normalized.slice(4, 6), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    r: Number.parseInt(normalized.slice(0, 2), 16),
  };
};

test("hexToHsl reads mid-lightness red from a swatch", () => {
  const hsl = hexToHsl("#dc2626");
  expect(hsl.h).toBe(0);
  expect(hsl.s).toBeGreaterThan(70);
  expect(hsl.l).toBeGreaterThan(40);
  expect(hsl.l).toBeLessThan(60);
});

test("raising lightness keeps red dominant and does not collapse to black", () => {
  const hsl = hexToHsl("#dc2626");
  for (const lightness of [60, 70, 80, 90]) {
    const hex = hslToHex({ ...hsl, l: lightness });
    expect(hex).not.toBe("#000000");
    const parsed = hexToHsl(hex);
    expect(parsed.l).toBe(lightness);
    const { r, g, b } = rgb(hex);
    expect(r).toBeGreaterThan(g);
    expect(r).toBeGreaterThan(b);
  }
});

test("slider-style sequential updates keep the requested lightness", () => {
  const hsl = hexToHsl("#2563eb");
  for (const lightness of [20, 35, 50, 65, 80]) {
    const hex = applyHslLightness(hsl, lightness);
    expect(hexToHsl(hex).l).toBe(lightness);
    expect(hex).not.toBe("#000000");
    const { r, g, b } = rgb(hex);
    expect(b).toBeGreaterThan(r);
    expect(b).toBeGreaterThan(g);
  }
});

test("black output from zero lightness can recover hue from stored HSL", () => {
  const hsl = hexToHsl("#16a34a");
  expect(hslToHex({ ...hsl, l: 0 })).toBe("#000000");
  const recovered = hslToHex({ ...hsl, l: hsl.l });
  expect(hexToHsl(recovered).h).toBe(hsl.h);
  expect(recovered).not.toBe("#000000");
});
