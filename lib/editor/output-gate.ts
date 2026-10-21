import { confirmFormGlyphs } from "@/lib/editor/form-glyph-gate";
import { confirmRedactions } from "@/lib/editor/redaction-gate";

/**
 * Everything to confirm before the edited PDF leaves the editor (export,
 * extract or print). Resolves true to go ahead.
 */
export const confirmOutput = async (): Promise<boolean> =>
  (await confirmRedactions()) && (await confirmFormGlyphs());
