// Builds public/sample.pdf, the document behind "Open sample": a short
// proposal with a budget table, a contact block to try redaction on, and a
// sign-off page with real form fields. Rerun after editing: `pnpm sample`.
import { writeFile } from "node:fs/promises";
import path from "node:path";

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const root = path.join(import.meta.dirname, "..");
const target = path.join(root, "public", "sample.pdf");

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const PAGE_COUNT = 3;
const MARGIN = 64;
const TEXT_WIDTH = 470;
const LINE_HEIGHT = 1.55;

const ink = rgb(0.12, 0.12, 0.14);
const muted = rgb(0.42, 0.42, 0.46);
const accent = rgb(0.16, 0.32, 0.86);
const rule = rgb(0.88, 0.88, 0.9);
const fieldBorder = rgb(0.8, 0.8, 0.84);

const doc = await PDFDocument.create();
doc.setTitle("Website Redesign Proposal");
doc.setAuthor("Paperoo");
doc.setSubject("Paperoo sample document");

const regular = await doc.embedFont(StandardFonts.Helvetica);
const bold = await doc.embedFont(StandardFonts.HelveticaBold);

/** Draws wrapped text and returns the baseline below the last line. */
const paragraph = (page, text, y, { font = regular, size = 11 } = {}) => {
  let line = "";
  let baseline = y;
  for (const word of text.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) > TEXT_WIDTH) {
      page.drawText(line, { color: ink, font, size, x: MARGIN, y: baseline });
      line = word;
      baseline -= size * LINE_HEIGHT;
    } else {
      line = next;
    }
  }
  page.drawText(line, { color: ink, font, size, x: MARGIN, y: baseline });
  return baseline - size * LINE_HEIGHT;
};

const heading = (page, text, y, size = 14) => {
  page.drawText(text, { color: ink, font: bold, size, x: MARGIN, y });
};

const addPage = (number) => {
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  page.drawRectangle({
    color: accent,
    height: 6,
    width: PAGE_WIDTH,
    x: 0,
    y: PAGE_HEIGHT - 6,
  });
  page.drawText("NORTHWIND STUDIO", {
    color: accent,
    font: bold,
    size: 9,
    x: MARGIN,
    y: PAGE_HEIGHT - 48,
  });
  page.drawText(`Page ${number} of ${PAGE_COUNT}`, {
    color: muted,
    font: regular,
    size: 9,
    x: PAGE_WIDTH - 110,
    y: PAGE_HEIGHT - 48,
  });
  return page;
};

// Page 1: the proposal.
{
  const page = addPage(1);
  heading(page, "Website Redesign Proposal", PAGE_HEIGHT - 120, 26);
  page.drawText("Prepared for Lakeside Bakery  ·  October 2026", {
    color: muted,
    font: regular,
    size: 12,
    x: MARGIN,
    y: PAGE_HEIGHT - 146,
  });

  let y = PAGE_HEIGHT - 200;
  heading(page, "Overview", y);
  y = paragraph(
    page,
    "Lakeside Bakery wants a website that makes ordering simple on any phone. This proposal covers the new design, an online ordering page, and a short training session for the team.",
    y - 24
  );

  y -= 14;
  heading(page, "Scope of work", y);
  y -= 24;
  for (const item of [
    "New home, menu, and about pages",
    "Online ordering with pickup times",
    "Photo shoot of the full menu",
    "Two rounds of changes after launch",
  ]) {
    page.drawCircle({ color: accent, size: 2.5, x: MARGIN + 8, y: y + 3.5 });
    page.drawText(item, {
      color: ink,
      font: regular,
      size: 11,
      x: MARGIN + 20,
      y,
    });
    y -= 20;
  }

  y -= 14;
  heading(page, "Timeline", y);
  y = paragraph(
    page,
    "Design starts on 2 November and the new site goes live on 14 December, in time for the holiday rush.",
    y - 24
  );

  y -= 14;
  heading(page, "Budget", y);
  y -= 30;
  for (const [label, amount] of [
    ["Design", "$3,200"],
    ["Development", "$4,800"],
    ["Photography", "$1,100"],
    ["Total", "$9,100"],
  ]) {
    const font = label === "Total" ? bold : regular;
    page.drawText(label, { color: ink, font, size: 11, x: MARGIN, y });
    page.drawText(amount, { color: ink, font, size: 11, x: 460, y });
    page.drawLine({
      color: rule,
      end: { x: MARGIN + TEXT_WIDTH, y: y - 8 },
      start: { x: MARGIN, y: y - 8 },
      thickness: 0.8,
    });
    y -= 26;
  }
}

// Page 2: notes and a contact block to try redaction on.
{
  const page = addPage(2);
  heading(page, "Project Notes", PAGE_HEIGHT - 120, 22);
  let y = PAGE_HEIGHT - 170;
  for (const text of [
    "The bakery's busiest hours are 7 to 10 in the morning. Most visitors arrive on a phone, so every page is designed for small screens first.",
    "Customers asked for clear prices, allergy information on every item, and a way to order a cake a week ahead. All three are part of the new menu page.",
    "We will check in every Friday with a short update and a link to the latest version of the site.",
  ]) {
    y = paragraph(page, text, y) - 10;
  }

  heading(page, "Client contact", 500);
  page.drawText("Maria Owusu, Owner", {
    color: ink,
    font: regular,
    size: 11,
    x: MARGIN,
    y: 476,
  });
  for (const [label, value, rowY] of [
    ["Phone:", "+233 20 555 0142", 456],
    ["Email:", "maria@lakeside-bakery.example", 436],
  ]) {
    page.drawText(label, {
      color: muted,
      font: regular,
      size: 11,
      x: MARGIN,
      y: rowY,
    });
    page.drawText(value, {
      color: ink,
      font: regular,
      size: 11,
      x: MARGIN + 46,
      y: rowY,
    });
  }
}

// Page 3: sign-off form.
{
  const page = addPage(3);
  const form = doc.getForm();
  heading(page, "Approval", PAGE_HEIGHT - 120, 22);
  paragraph(
    page,
    "Please fill in your details and sign below to approve this proposal.",
    PAGE_HEIGHT - 160
  );

  for (const [label, name, y] of [
    ["Full name", "name", PAGE_HEIGHT - 240],
    ["Company", "company", PAGE_HEIGHT - 300],
    ["Date", "date", PAGE_HEIGHT - 360],
  ]) {
    page.drawText(label, {
      color: muted,
      font: regular,
      size: 10,
      x: MARGIN,
      y: y + 30,
    });
    form.createTextField(name).addToPage(page, {
      borderColor: fieldBorder,
      borderWidth: 1,
      height: 24,
      width: 300,
      x: MARGIN,
      y,
    });
  }

  form.createCheckBox("agree").addToPage(page, {
    borderColor: rgb(0.6, 0.6, 0.64),
    borderWidth: 1,
    height: 14,
    width: 14,
    x: MARGIN,
    y: PAGE_HEIGHT - 410,
  });
  page.drawText("I agree to the scope, timeline, and budget above.", {
    color: ink,
    font: regular,
    size: 11,
    x: MARGIN + 22,
    y: PAGE_HEIGHT - 407,
  });

  page.drawLine({
    color: ink,
    end: { x: 300, y: PAGE_HEIGHT - 520 },
    start: { x: MARGIN, y: PAGE_HEIGHT - 520 },
    thickness: 1,
  });
  page.drawText("Signature", {
    color: muted,
    font: regular,
    size: 10,
    x: MARGIN,
    y: PAGE_HEIGHT - 536,
  });
}

await writeFile(target, await doc.save());
