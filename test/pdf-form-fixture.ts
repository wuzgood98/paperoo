import type { PDFRef } from "pdf-lib";
import {
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFString,
  StandardFonts,
  degrees,
} from "pdf-lib";

const LETTER = [612, 792] satisfies [number, number];

export const FORM_FIELD = {
  bio: "person.bio",
  cities: "address.cities",
  country: "address.country",
  name: "person.name",
  newsletter: "prefs.newsletter",
  pin: "person.pin",
  readonly: "person.readonly",
  region: "prefs.region",
  required: "person.required",
  rotated: "rotated.caption",
  shared: "shared.note",
  signature: "approval.signature",
  tags: "address.tags",
  terms: "prefs.terms",
} as const;

const widget = {
  height: 20,
  width: 200,
  x: 72,
};

export const buildPdfFormFixture = async (): Promise<Uint8Array> => {
  const doc = await PDFDocument.create();
  const page1 = doc.addPage(LETTER);
  const page2 = doc.addPage(LETTER);
  page2.setRotation(degrees(90));
  const form = doc.getForm();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  const name = form.createTextField(FORM_FIELD.name);
  name.setText("Gideon");
  name.addToPage(page1, { ...widget, font, y: 720 });

  const bio = form.createTextField(FORM_FIELD.bio);
  bio.enableMultiline();
  bio.setText("Line one\nLine two");
  bio.addToPage(page1, { ...widget, font, height: 48, y: 650 });

  const required = form.createTextField(FORM_FIELD.required);
  required.enableRequired();
  required.addToPage(page1, { ...widget, font, y: 610 });

  const readonly = form.createTextField(FORM_FIELD.readonly);
  readonly.setText("Locked");
  readonly.enableReadOnly();
  readonly.addToPage(page1, { ...widget, font, y: 580 });

  const pin = form.createTextField(FORM_FIELD.pin);
  pin.setMaxLength(8);
  pin.addToPage(page1, { ...widget, font, width: 80, y: 550 });

  const newsletter = form.createCheckBox(FORM_FIELD.newsletter);
  newsletter.addToPage(page1, { height: 16, width: 16, x: 72, y: 520 });
  newsletter.check();

  const terms = form.createCheckBox(FORM_FIELD.terms);
  terms.addToPage(page1, { height: 16, width: 16, x: 72, y: 496 });
  terms.uncheck();

  const region = form.createRadioGroup(FORM_FIELD.region);
  region.addOptionToPage("Ghana", page1, {
    height: 16,
    width: 16,
    x: 72,
    y: 460,
  });
  region.addOptionToPage("Nigeria", page1, {
    height: 16,
    width: 16,
    x: 72,
    y: 436,
  });
  region.addOptionToPage("Kenya", page1, {
    height: 16,
    width: 16,
    x: 72,
    y: 412,
  });
  region.select("Nigeria");

  const country = form.createDropdown(FORM_FIELD.country);
  country.addToPage(page1, { ...widget, font, y: 370 });
  country.acroField.setOptions([
    {
      display: PDFHexString.fromText("Ghana"),
      value: PDFHexString.fromText("GH"),
    },
    {
      display: PDFHexString.fromText("Nigeria"),
      value: PDFHexString.fromText("NG"),
    },
    {
      display: PDFHexString.fromText("Kenya"),
      value: PDFHexString.fromText("KE"),
    },
  ]);
  country.enableEditing();
  country.acroField.setValues([PDFHexString.fromText("GH")]);
  country.disableEditing();

  const cities = form.createOptionList(FORM_FIELD.cities);
  cities.setOptions(["Accra", "Lagos", "Nairobi"]);
  cities.select("Nairobi");
  cities.addToPage(page1, { ...widget, font, height: 54, y: 300 });

  const tags = form.createOptionList(FORM_FIELD.tags);
  tags.enableMultiselect();
  tags.setOptions(["Ghana", "Nigeria", "Kenya"]);
  tags.select(["Ghana", "Kenya"]);
  tags.addToPage(page1, { ...widget, font, height: 54, y: 230 });

  const shared = form.createTextField(FORM_FIELD.shared);
  shared.setText("Same field");
  shared.addToPage(page1, { ...widget, font, y: 80 });
  shared.addToPage(page2, { ...widget, font, y: 80 });

  const rotated = form.createTextField(FORM_FIELD.rotated);
  rotated.setText("Rotated");
  rotated.addToPage(page2, { ...widget, font, y: 700 });

  const sigDict = doc.context.obj({
    F: 4,
    FT: PDFName.of("Sig"),
    P: page1.ref,
    Rect: [72, 40, 272, 80],
    Subtype: PDFName.of("Widget"),
    T: PDFString.of("approval.signature"),
    Type: PDFName.of("Annot"),
  });
  const sigRef = doc.context.register(sigDict);
  page1.node.addAnnot(sigRef);
  form.acroForm.addField(sigRef);

  form.updateFieldAppearances(font);
  return new Uint8Array(await doc.save());
};

export const buildXfaFormFixture = async (): Promise<Uint8Array> => {
  const doc = await PDFDocument.create();
  doc.addPage(LETTER);
  const form = doc.getForm();
  form.acroForm.dict.set(
    PDFName.of("XFA"),
    doc.context.obj([
      PDFString.of("xdp:xdp"),
      PDFString.of('<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/"/>'),
    ])
  );
  return new Uint8Array(await doc.save({ updateFieldAppearances: false }));
};

export const EDGE_FIELD = {
  dotted: "a.b",
  hidden: "hidden.note",
  nested: "a",
  pick: "pick",
  visible: "visible.note",
} as const;

/**
 * Cases the main fixture lacks: a hidden widget, a checkbox field whose two
 * widgets have different on-states (B starts on), and a top-level field
 * literally named "a.b" beside a field "a" with a kid "b".
 */
export const buildPdfFormEdgeFixture = async (): Promise<Uint8Array> => {
  const doc = await PDFDocument.create();
  const page = doc.addPage(LETTER);
  const form = doc.getForm();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  const visible = form.createTextField(EDGE_FIELD.visible);
  visible.setText("Shown");
  visible.addToPage(page, { ...widget, font, y: 720 });
  // pdf-lib writes the size it drew at; put back "fit to the box".
  const autoSize = "/Helv 0 Tf 0 g";
  visible.acroField.setDefaultAppearance(autoSize);
  for (const visibleWidget of visible.acroField.getWidgets()) {
    visibleWidget.setDefaultAppearance(autoSize);
  }

  const hidden = form.createTextField(EDGE_FIELD.hidden);
  hidden.setText("Secret");
  hidden.addToPage(page, { ...widget, font, hidden: true, y: 690 });

  const box = (onState: string, x: number, on: boolean) => {
    const stream = (content: string) =>
      doc.context.register(
        doc.context.stream(content, { BBox: [0, 0, 16, 16] })
      );
    return doc.context.register(
      doc.context.obj({
        AP: {
          N: {
            [onState]: stream("0 0 1 rg 2 2 12 12 re f"),
            Off: stream(""),
          },
        },
        AS: on ? onState : "Off",
        F: 4,
        P: page.ref,
        Rect: [x, 640, x + 16, 656],
        Subtype: "Widget",
        Type: "Annot",
      })
    );
  };
  const kidA = box("A", 72, false);
  const kidB = box("B", 100, true);
  const pick = doc.context.register(
    doc.context.obj({
      FT: "Btn",
      Kids: [kidA, kidB],
      T: PDFString.of(EDGE_FIELD.pick),
      V: PDFName.of("B"),
    })
  );
  for (const kid of [kidA, kidB]) {
    doc.context.lookup(kid, PDFDict).set(PDFName.of("Parent"), pick);
    page.node.addAnnot(kid);
  }
  form.acroForm.addField(pick);

  // "a" with kid "b" is also fully named "a.b"; the dotted one comes first.
  const textWidget = (
    y: number,
    extra: { Parent?: PDFRef; T: PDFString; V: PDFString }
  ) =>
    doc.context.register(
      doc.context.obj({
        DA: PDFString.of("/Helv 12 Tf 0 g"),
        F: 4,
        FT: "Tx",
        P: page.ref,
        Rect: [72, y, 272, y + 20],
        Subtype: "Widget",
        Type: "Annot",
        ...extra,
      })
    );
  const dotted = textWidget(600, {
    T: PDFString.of(EDGE_FIELD.dotted),
    V: PDFString.of("dotted"),
  });
  const nested = doc.context.register(
    doc.context.obj({ T: PDFString.of(EDGE_FIELD.nested) })
  );
  const nestedKid = textWidget(570, {
    Parent: nested,
    T: PDFString.of("b"),
    V: PDFString.of("nested"),
  });
  doc.context
    .lookup(nested, PDFDict)
    .set(PDFName.of("Kids"), doc.context.obj([nestedKid]));
  page.node.addAnnot(dotted);
  page.node.addAnnot(nestedKid);
  form.acroForm.addField(dotted);
  form.acroForm.addField(nested);

  return new Uint8Array(await doc.save({ updateFieldAppearances: false }));
};
