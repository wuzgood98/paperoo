import {
  PDFDocument,
  PDFDict,
  PDFName,
  PDFRef,
  PDFString,
  StandardFonts,
} from "pdf-lib";

const LETTER = [612, 792] satisfies [number, number];

const addAnnot = (
  doc: PDFDocument,
  pageIndex: number,
  // oxlint-disable-next-line anti-slop/no-object-parameters, anti-slop/no-unsafe-dictionary-type -- pdf-lib literal annotation dicts in tests.
  dict: Record<string, unknown>
): void => {
  const page = doc.getPage(pageIndex);
  // SAFETY: dict is a pdf-lib literal annotation dictionary built in this file.
  const ref = doc.context.register(doc.context.obj(dict as never));
  page.node.addAnnot(ref);
};

const markupQuad = (
  x1: number,
  yTop: number,
  x2: number,
  yBottom: number
): number[] => [x1, yTop, x2, yTop, x1, yBottom, x2, yBottom];

export const buildPdfAnnotationFixture = async (): Promise<Uint8Array> => {
  const doc = await PDFDocument.create();
  const page1 = doc.addPage(LETTER);
  const page2 = doc.addPage(LETTER);
  page1.drawText("Highlighted line one", { size: 12, x: 72, y: 700 });
  page1.drawText("Highlighted line two", { size: 12, x: 72, y: 684 });
  page1.drawText("Click paperoo", { size: 12, x: 72, y: 664 });
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);

  const page2Ref = page2.ref;

  addAnnot(doc, 0, {
    A: doc.context.obj({
      S: PDFName.of("URI"),
      URI: PDFString.of("https://example.com/paperoo"),
    }),
    Border: [0, 0, 0],
    Rect: [70, 660, 160, 678],
    Subtype: PDFName.of("Link"),
    Type: PDFName.of("Annot"),
  });

  addAnnot(doc, 0, {
    Border: [0, 0, 0],
    Dest: doc.context.obj([page2Ref, PDFName.of("Fit")]),
    Rect: [72, 640, 180, 656],
    Subtype: PDFName.of("Link"),
    Type: PDFName.of("Annot"),
  });

  const highlightQuads = [
    ...markupQuad(72, 712, 220, 698),
    ...markupQuad(72, 696, 180, 682),
  ];
  addAnnot(doc, 0, {
    C: [1, 0.92, 0.23],
    CA: 0.5,
    QuadPoints: highlightQuads,
    Rect: [72, 682, 220, 712],
    Subtype: PDFName.of("Highlight"),
    Type: PDFName.of("Annot"),
  });

  addAnnot(doc, 0, {
    C: [0, 0, 1],
    QuadPoints: markupQuad(72, 620, 200, 612),
    Rect: [72, 612, 200, 620],
    Subtype: PDFName.of("Underline"),
    Type: PDFName.of("Annot"),
  });

  addAnnot(doc, 0, {
    C: [1, 0, 0],
    QuadPoints: markupQuad(72, 600, 200, 592),
    Rect: [72, 592, 200, 600],
    Subtype: PDFName.of("StrikeOut"),
    Type: PDFName.of("Annot"),
  });

  addAnnot(doc, 0, {
    C: [0, 0.5, 0],
    QuadPoints: markupQuad(72, 580, 200, 572),
    Rect: [72, 572, 200, 580],
    Subtype: PDFName.of("Squiggly"),
    Type: PDFName.of("Annot"),
  });

  addAnnot(doc, 0, {
    Contents: PDFString.of("Original free text"),
    DA: PDFString.of("/Helv 12 Tf 0.1 0.1 0.1 rg"),
    Rect: [72, 520, 260, 548],
    Subtype: PDFName.of("FreeText"),
    Type: PDFName.of("Annot"),
  });

  const popupDict = doc.context.obj({
    Open: false,
    Rect: [240, 500, 360, 440],
    Subtype: PDFName.of("Popup"),
    Type: PDFName.of("Annot"),
  });
  const popupRef = doc.context.register(popupDict);
  const noteDict = doc.context.obj({
    Contents: PDFString.of("Original note"),
    Name: PDFName.of("Note"),
    Popup: popupRef,
    Rect: [72, 460, 90, 478],
    Subtype: PDFName.of("Text"),
    Type: PDFName.of("Annot"),
  });
  const noteRef = doc.context.register(noteDict);
  popupDict.set(PDFName.of("Parent"), noteRef);
  page1.node.addAnnot(noteRef);
  page1.node.addAnnot(popupRef);

  const stampAppearance = doc.context.flateStream(
    "q 0.8 0.2 0.2 rg 0 0 80 40 re f Q",
    {
      BBox: doc.context.obj([0, 0, 80, 40]),
      FormType: 1,
      Subtype: PDFName.of("Form"),
      Type: PDFName.of("XObject"),
    }
  );
  const stampApRef = doc.context.register(stampAppearance);
  addAnnot(doc, 0, {
    AP: doc.context.obj({ N: stampApRef }),
    Rect: [400, 500, 480, 540],
    Subtype: PDFName.of("Stamp"),
    Type: PDFName.of("Annot"),
  });

  const form = doc.getForm();
  form.createTextField("fixtureField").addToPage(page1, {
    height: 24,
    width: 180,
    x: 72,
    y: 80,
  });

  void helvetica;

  return new Uint8Array(await doc.save());
};

export const countPageAnnotSubtypes = async (
  bytes: Uint8Array,
  pageIndex: number
): Promise<Map<string, number>> => {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(pageIndex);
  const annots = page.node.Annots();
  const counts = new Map<string, number>();
  if (!annots) {
    return counts;
  }
  for (let index = 0; index < annots.size(); index += 1) {
    const entry = annots.get(index);
    if (!(entry instanceof PDFRef)) {
      continue;
    }
    const dict = doc.context.lookup(entry, PDFDict);
    if (!(dict instanceof PDFDict)) {
      continue;
    }
    const subtype = dict.get(PDFName.of("Subtype"));
    const name = subtype instanceof PDFName ? subtype.decodeText() : "Unknown";
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return counts;
};

export const annotHasUri = async (
  bytes: Uint8Array,
  uri: string
): Promise<boolean> => {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.Annots();
  if (!annots) {
    return false;
  }
  for (let index = 0; index < annots.size(); index += 1) {
    const entry = annots.get(index);
    if (!(entry instanceof PDFRef)) {
      continue;
    }
    const dict = doc.context.lookup(entry, PDFDict);
    if (!(dict instanceof PDFDict)) {
      continue;
    }
    const action = dict.lookup(PDFName.of("A"), PDFDict);
    if (!(action instanceof PDFDict)) {
      continue;
    }
    const actionUri = action.get(PDFName.of("URI"));
    if (actionUri instanceof PDFString && actionUri.decodeText() === uri) {
      return true;
    }
  }
  return false;
};

export const findAnnotContents = async (
  bytes: Uint8Array,
  subtype: string,
  contents: string
): Promise<boolean> => {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.Annots();
  if (!annots) {
    return false;
  }
  for (let index = 0; index < annots.size(); index += 1) {
    const entry = annots.get(index);
    if (!(entry instanceof PDFRef)) {
      continue;
    }
    const dict = doc.context.lookup(entry, PDFDict);
    if (!(dict instanceof PDFDict)) {
      continue;
    }
    const subtypeEntry = dict.get(PDFName.of("Subtype"));
    if (
      !(subtypeEntry instanceof PDFName) ||
      subtypeEntry.decodeText() !== subtype
    ) {
      continue;
    }
    const value = dict.get(PDFName.of("Contents"));
    if (value instanceof PDFString && value.decodeText() === contents) {
      return true;
    }
  }
  return false;
};
