/**
 * How export draws a form field's text, so the editor preview can match it.
 * The sizing rules are pdf-lib 1.17's (`api/text/layout.js`), which writes
 * the appearance of every filled field.
 */

/** pdf-lib's text inset inside the border; comb fields have none. */
export const FORM_TEXT_PADDING = 1;
const MIN_FONT_SIZE = 4;
const MAX_FONT_SIZE = 500;
const LINE_GAP = 0.2;
/** Helvetica's ascent, and ascent plus descent, per point of font size. */
export const HELVETICA_ASCENT = 0.718;
export const HELVETICA_HEIGHT = 0.925;
/** pdf-lib leaves a quarter of each comb cell empty. */
const COMB_CELL_FILL = 0.75;

/** Width of `text` at `fontSize` in the field's font. */
export type MeasureText = (text: string, fontSize: number) => number;

export interface FormTextBounds {
  height: number;
  width: number;
}

export const formTextBounds = (
  widget: { height: number; width: number },
  borderWidth: number,
  comb: boolean
): FormTextBounds => {
  const inset = borderWidth + (comb ? 0 : FORM_TEXT_PADDING);
  return {
    height: widget.height - inset * 2,
    width: widget.width - inset * 2,
  };
};

/** Line height pdf-lib gives multiline text. */
export const formLineHeight = (fontSize: number): number =>
  HELVETICA_HEIGHT * fontSize * (1 + LINE_GAP);

/** Lines used at this size once long lines wrap at spaces. */
const wrappedLineCount = (
  lines: readonly string[],
  width: number,
  fontSize: number,
  measure: MeasureText
): number => {
  let used = 0;
  for (const line of lines) {
    used += 1;
    const words = line.split(" ");
    let remaining = width;
    for (const [index, word] of words.entries()) {
      const spaced = index === words.length - 1 ? word : `${word} `;
      const wordWidth = measure(spaced, fontSize);
      remaining -= wordWidth;
      if (remaining <= 0) {
        used += 1;
        remaining = width - wordWidth;
      }
    }
  }
  return used;
};

/**
 * The largest whole size that fits: single-line text may not wrap, and
 * every line must fit the height. Grows from 4pt like pdf-lib does.
 */
export const autoFormFontSize = (
  lines: readonly string[],
  bounds: FormTextBounds,
  measure: MeasureText,
  multiline: boolean
): number => {
  for (let fontSize = MIN_FONT_SIZE; fontSize < MAX_FONT_SIZE; fontSize += 1) {
    const used = wrappedLineCount(lines, bounds.width, fontSize, measure);
    if (!multiline && used > lines.length) {
      return fontSize - 1;
    }
    if (formLineHeight(fontSize) * used > Math.abs(bounds.height)) {
      return fontSize - 1;
    }
  }
  return MAX_FONT_SIZE;
};

/** The largest size where every letter fits three quarters of its cell. */
export const autoCombFontSize = (
  text: string,
  bounds: FormTextBounds,
  cellCount: number,
  measure: MeasureText
): number => {
  const cellWidth = bounds.width / cellCount;
  const letters = [...text];
  for (let fontSize = MIN_FONT_SIZE; fontSize < MAX_FONT_SIZE; fontSize += 1) {
    if (
      letters.some(
        (letter) => measure(letter, fontSize) > cellWidth * COMB_CELL_FILL
      )
    ) {
      return fontSize - 1;
    }
    if (HELVETICA_ASCENT * fontSize > bounds.height) {
      return fontSize - 1;
    }
  }
  return MAX_FONT_SIZE;
};
