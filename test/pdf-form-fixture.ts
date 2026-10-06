import {
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
