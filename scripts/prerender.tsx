// Runs after `bun build`: renders the signed-out landing page into
// dist/index.html, adds FAQ structured data, and copies public/ into dist/,
// so search engines get real content without running the app's JavaScript.
import { $ } from "bun";
import { renderToStaticMarkup } from "react-dom/server";
import { Landing } from "../src/components/Landing";
import { FAQ } from "../src/lib/faq";

const file = Bun.file("dist/index.html");
const html = await file.text();

const root = /<div id="?root"?><\/div>/;
if (!root.test(html)) throw new Error("dist/index.html has no empty root div to prerender into");

const faqSchema = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebApplication",
      name: "AttachmentDownloader",
      url: "https://attachmentdownloader.vercel.app/",
      applicationCategory: "UtilitiesApplication",
      operatingSystem: "Any (web browser)",
      description: "Find attachments in Gmail and download all of them, or the ones you pick, as one ZIP.",
    },
    {
      "@type": "FAQPage",
      mainEntity: FAQ.map(({ q, a }) => ({
        "@type": "Question",
        name: q,
        acceptedAnswer: { "@type": "Answer", text: a },
      })),
    },
  ],
};

const out = html
  .replace(root, `<div id="root">${renderToStaticMarkup(<Landing />)}</div>`)
  .replace("</head>", `<script type="application/ld+json">${JSON.stringify(faqSchema)}</script></head>`);

await Bun.write(file, out);
await $`cp -r public/. dist/`;
console.log("Prerendered landing page into dist/index.html and copied public/");
