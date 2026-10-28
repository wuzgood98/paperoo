import { PDFArray, PDFDict, PDFName, PDFStream } from "pdf-lib";
import type { PDFDocument, PDFObject } from "pdf-lib";

/**
 * Actions a reader runs only to move around: jump to a page, open a web
 * link, or a viewer command such as NextPage. Every other kind can run
 * script (JavaScript, Rendition), start a program (Launch), send or load
 * form data (SubmitForm, ImportData), or name fields and annotations by ref
 * (ResetForm, Hide), which would keep fields from pages left out of an
 * extract.
 */
const KEPT_ACTION_TYPES = new Set(["GoTo", "URI", "Named"]);

const ACTION_KEY = PDFName.of("A");
const NEXT_KEY = PDFName.of("Next");
const TYPE_KEY = PDFName.of("S");
/** Trigger actions (page open, field change, keystroke, calculate, ...). */
const TRIGGER_KEYS = ["AA", "OpenAction", "JavaScript"].map((key) =>
  PDFName.of(key)
);

const isKeptAction = (doc: PDFDocument, value: PDFObject): boolean => {
  const action = doc.context.lookup(value);
  if (!(action instanceof PDFDict)) {
    return false;
  }
  const type = action.get(TYPE_KEY);
  return type instanceof PDFName && KEPT_ACTION_TYPES.has(type.decodeText());
};

const stripDict = (doc: PDFDocument, dict: PDFDict): void => {
  for (const key of TRIGGER_KEYS) {
    dict.delete(key);
  }
  const action = dict.get(ACTION_KEY);
  if (action && !isKeptAction(doc, action)) {
    dict.delete(ACTION_KEY);
  }
  const next = dict.get(NEXT_KEY);
  if (!next) {
    return;
  }
  const nextList = doc.context.lookup(next);
  if (nextList instanceof PDFArray) {
    const kept = nextList.asArray().filter((item) => isKeptAction(doc, item));
    if (kept.length === 0) {
      dict.delete(NEXT_KEY);
    } else {
      dict.set(NEXT_KEY, doc.context.obj(kept));
    }
  } else if (!isKeptAction(doc, next)) {
    dict.delete(NEXT_KEY);
  }
};

/**
 * Remove every action a reader could run on its own or on a click, other
 * than page jumps, web links and viewer commands. Paperoo never runs PDF
 * script, so nothing it shows depends on them, but the output goes to the
 * browser's PDF viewer for printing and to whoever opens the file, and a
 * script from one opened PDF could read fields merged in from another.
 */
export const stripActiveContent = (doc: PDFDocument): void => {
  const stack: PDFObject[] = [];
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    stack.push(object);
  }
  // Direct dicts and arrays are walked; refs are not followed, because
  // every indirect object is already on the stack.
  for (let next = stack.pop(); next; next = stack.pop()) {
    const dict = next instanceof PDFStream ? next.dict : next;
    if (dict instanceof PDFDict) {
      stripDict(doc, dict);
      stack.push(...dict.values());
    } else if (dict instanceof PDFArray) {
      stack.push(...dict.asArray());
    }
  }
};
