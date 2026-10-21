import { documentForm, isPdfFormFieldDirty } from "@/lib/editor/object-utils";
import { editorStore } from "@/lib/editor/store";
import {
  coversText,
  FORM_FALLBACK_FONT_URLS,
  formFieldDrawnText,
  formFieldsMissingLetters,
  helveticaCovers,
} from "@/lib/pdf/form-fonts";
import type { FieldMissingLetters, GlyphCover } from "@/lib/pdf/form-fonts";

let prompt: FieldMissingLetters[] | null = null;
let answer: ((confirmed: boolean) => void) | null = null;
const listeners = new Set<() => void>();
const covers = new Map<string, Promise<GlyphCover>>();

const emit = (): void => {
  for (const listener of listeners) {
    listener();
  }
};

export const subscribeFormGlyphPrompt = (
  listener: () => void
): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Fields whose letters would be drawn as empty boxes, while asking. */
export const formGlyphPrompt = (): FieldMissingLetters[] | null => prompt;

export const answerFormGlyphPrompt = (confirmed: boolean): void => {
  const resolve = answer;
  prompt = null;
  answer = null;
  emit();
  resolve?.(confirmed);
};

const loadCover = (url: string): Promise<GlyphCover> => {
  let cover = covers.get(url);
  if (!cover) {
    cover = (async () => {
      try {
        const [{ default: fontkit }, response] = await Promise.all([
          import("@pdf-lib/fontkit"),
          fetch(url),
        ]);
        if (!response.ok) {
          throw new Error(`Could not load ${url}`);
        }
        const face = fontkit.create(
          new Uint8Array(await response.arrayBuffer())
        );
        return (codePoint: number) => face.hasGlyphForCodePoint(codePoint);
      } catch (error) {
        // A failed load is tried again next time.
        covers.delete(url);
        throw error;
      }
    })();
    covers.set(url, cover);
  }
  return cover;
};

/**
 * Before export, extract or print: filled form text with letters no
 * bundled font has would draw as empty boxes. Asks whether to go ahead,
 * naming the fields. Resolves true to go ahead.
 */
export const confirmFormGlyphs = async (): Promise<boolean> => {
  const { fields } = documentForm(editorStore.getState().document);
  // Most forms are filled in Latin text: skip loading any font for them.
  const beyondHelvetica = fields.some(
    (field) =>
      isPdfFormFieldDirty(field) &&
      !coversText(helveticaCovers, formFieldDrawnText(field))
  );
  if (!beyondHelvetica) {
    return true;
  }
  const fallbacks = await Promise.all(FORM_FALLBACK_FONT_URLS.map(loadCover));
  const missing = formFieldsMissingLetters(fields, [
    helveticaCovers,
    ...fallbacks,
  ]);
  if (missing.length === 0) {
    return true;
  }
  // A second request while the prompt is open replaces the first.
  answer?.(false);
  prompt = missing;
  // oxlint-disable-next-line promise/avoid-new -- settled by the dialog's buttons
  const decided = new Promise<boolean>((resolve) => {
    answer = resolve;
  });
  emit();
  return await decided;
};
