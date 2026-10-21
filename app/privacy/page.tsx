import type { Metadata } from "next";
import Link from "next/link";

import { siteConfig } from "@/lib/site";

export const metadata: Metadata = {
  alternates: { canonical: "/privacy" },
  description: `How ${siteConfig.name} handles your files and data.`,
  title: "Privacy",
};

const LAST_UPDATED = "21 October 2026";

const Section = ({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) => (
  <section className="flex flex-col gap-3">
    <h2 className="text-foreground text-lg font-semibold tracking-tight">
      {title}
    </h2>
    {children}
  </section>
);

const PrivacyPage = () => (
  <main className="bg-background min-h-dvh px-4 py-12 sm:py-20">
    <article className="text-muted-foreground mx-auto flex max-w-2xl flex-col gap-10 text-base leading-relaxed">
      <header className="flex flex-col gap-3">
        <Link
          className="text-foreground w-fit text-sm font-medium underline underline-offset-4"
          href="/"
        >
          ← Back to {siteConfig.name}
        </Link>
        <h1 className="text-foreground text-3xl font-semibold tracking-tight">
          Privacy
        </h1>
        <p>Last updated {LAST_UPDATED}</p>
      </header>

      <Section title="Your files stay on your device">
        <p>
          {siteConfig.name} opens, edits, reads (OCR), and exports PDFs inside
          your browser. Your files are never uploaded to our servers or sent to
          anyone else. The code that does the work, including the OCR engine and
          its language data, is downloaded with the site and runs on your
          device.
        </p>
      </Section>

      <Section title="What is saved in your browser">
        <p>
          So you don&apos;t lose work if a tab closes, {siteConfig.name} keeps
          the open document and any edits you haven&apos;t exported in your
          browser&apos;s storage (IndexedDB) on this device. It is cleared when
          you export or discard your edits, and it expires on its own after 14
          days. Clearing your browser&apos;s site data also removes it.
        </p>
        <p>
          A few settings, such as light or dark theme and whether form fields
          are highlighted, are stored in your browser too. None of this leaves
          your device.
        </p>
      </Section>

      <Section title="Page view counts">
        <p>
          We count page views with{" "}
          <a
            className="text-foreground underline underline-offset-4"
            href="https://vercel.com/docs/analytics/privacy-policy"
            rel="noopener noreferrer"
            target="_blank"
          >
            Vercel Web Analytics
          </a>
          . It uses no cookies and records which page was visited, the referring
          site, and your general location and device type. It never sees your
          files or what is in them.
        </p>
      </Section>

      <Section title="Hosting">
        <p>
          The site is hosted on{" "}
          <a
            className="text-foreground underline underline-offset-4"
            href="https://vercel.com/legal/privacy-policy"
            rel="noopener noreferrer"
            target="_blank"
          >
            Vercel
          </a>
          . Like any web host, Vercel handles the requests your browser makes to
          load the site, which includes your IP address. Your PDFs are not part
          of those requests.
        </p>
      </Section>

      <Section title="No accounts, no tracking">
        <p>
          There are no accounts or sign-ups, no advertising, and no tracking
          cookies. We don&apos;t sell or share personal data.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          Questions about privacy? Email{" "}
          <a
            className="text-foreground underline underline-offset-4"
            href={`mailto:${siteConfig.supportEmail}`}
          >
            {siteConfig.supportEmail}
          </a>
          .
        </p>
      </Section>
    </article>
  </main>
);

export default PrivacyPage;
