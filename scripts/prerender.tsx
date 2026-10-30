// Public pages are useful without JavaScript. Metadata describes visible content;
// it does not claim ratings, endorsements or rich-result eligibility.
import { cp } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { Landing } from "../src/components/Landing";
import { FAQ } from "../src/lib/faq";
import { metadataText } from "./metadata-text";

const site = "https://attachmentdownloader.ca";
const brand = "AttachmentDownloader";
const organization = `${site}/#organization`;
const website = `${site}/#website`;
const modified: Record<string, string> = {
  "index.html": "2026-10-30",
  "privacy.html": "2026-10-29",
  "gmail-attachments-not-downloading.html": "2026-10-30",
  "download-all-gmail-attachments.html": "2026-10-30",
  "download-gmail-attachments-from-sender.html": "2026-10-30",
  "download-pdf-attachments-gmail.html": "2026-10-30",
  "download-gmail-attachments-by-date.html": "2026-10-30",
  "guides.html": "2026-10-30",
  "about.html": "2026-10-30",
};
const escape = (text: string) => text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const json = (value: unknown) => JSON.stringify(value).replaceAll("<", "\\u003c");

for (const js of new Bun.Glob("dist/**/*.js").scanSync()) {
  const leftover = (await Bun.file(js).text()).match(/process\.env\.\w+/);
  if (leftover) throw new Error(`${js} still references ${leftover[0]}: set it for the build`);
}

const index = Bun.file("dist/index.html");
const html = await index.text();
const root = /<div id="?root"?><\/div>/;
if (!root.test(html)) throw new Error("dist/index.html has no empty root div to prerender into");
await Bun.write(index, html.replace(root, `<div id="root">${renderToStaticMarkup(<Landing />)}</div>`));

const sitemap: { url: string; modified: string }[] = [];
for (const filename of [...new Bun.Glob("*.html").scanSync("dist")].sort()) {
  const file = Bun.file(`dist/${filename}`);
  const source = await file.text();
  let title = "", description = "", heading = "", canonical = "";
  await new HTMLRewriter()
    .on("title", { text(chunk) { title += chunk.text; } })
    .on('meta[name="description"]', { element(element) { description = element.getAttribute("content") ?? ""; } })
    .on('link[rel="canonical"]', { element(element) { canonical = element.getAttribute("href") ?? ""; } })
    .on("h1", { text(chunk) { heading += chunk.text; } })
    .transform(new Response(source)).text();
  title = metadataText(title);
  description = metadataText(description);
  heading = metadataText(heading);
  if (!title || !description || !heading || !canonical) throw new Error(`${filename}: missing page metadata`);
  const expectedCanonical = `${site}/${filename === "index.html" ? "" : filename.slice(0, -5)}`;
  if (canonical !== expectedCanonical) throw new Error(`${filename}: canonical does not match its public route`);
  if (!modified[filename]) throw new Error(`${filename}: add an accurate modified date`);
  const article = filename.startsWith("download-") || filename === "gmail-attachments-not-downloading.html";
  const home = filename === "index.html";
  const isGuideIndex = filename === "guides.html";
  const breadcrumb = [
    { "@type": "ListItem", position: 1, name: "Home", item: `${site}/` },
    ...(article ? [{ "@type": "ListItem", position: 2, name: "Guides", item: `${site}/guides` }] : []),
    ...(!home ? [{ "@type": "ListItem", position: article ? 3 : 2, name: heading, item: canonical }] : []),
  ];
  const graph: Record<string, unknown>[] = [
    { "@type": "Organization", "@id": organization, name: brand, url: `${site}/`, logo: { "@type": "ImageObject", url: `${site}/logo.png` }, sameAs: ["https://github.com/JPCodes44/AttachmentDownloader"] },
    { "@type": "WebSite", "@id": website, url: `${site}/`, name: brand, inLanguage: "en", publisher: { "@id": organization } },
    {
      "@type": filename === "about.html" ? "AboutPage" : isGuideIndex ? "CollectionPage" : "WebPage",
      "@id": `${canonical}#webpage`, url: canonical, name: heading, description,
      inLanguage: "en", isPartOf: { "@id": website }, dateModified: modified[filename],
      ...(!home ? { breadcrumb: { "@id": `${canonical}#breadcrumb` } } : {}),
    },
  ];
  if (!home) graph.push({ "@type": "BreadcrumbList", "@id": `${canonical}#breadcrumb`, itemListElement: breadcrumb });
  if (article) graph.push({
    "@type": "Article", "@id": `${canonical}#article`, headline: heading, description,
    mainEntityOfPage: { "@id": `${canonical}#webpage` }, inLanguage: "en",
    author: { "@id": organization }, publisher: { "@id": organization },
    dateModified: modified[filename], image: [`${site}/og.png`], isAccessibleForFree: true,
  });
  if (home) graph.push(
    { "@type": "WebApplication", "@id": `${site}/#application`, name: brand, url: `${site}/`, applicationCategory: "UtilitiesApplication", operatingSystem: "Any (web browser)", browserRequirements: "JavaScript and a Google account", isAccessibleForFree: true, offers: { "@type": "Offer", price: "0", priceCurrency: "CAD" }, description, publisher: { "@id": organization } },
    { "@type": "FAQPage", "@id": `${site}/#faq`, mainEntity: FAQ.map(({ q, a }) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) },
  );
  const metadata = `
<meta name="robots" content="index,follow,max-image-preview:large" />
<meta name="author" content="AttachmentDownloader project" />
<meta name="theme-color" content="#2753c9" />
<meta property="og:type" content="${article ? "article" : "website"}" />
<meta property="og:site_name" content="${brand}" />
<meta property="og:locale" content="en_US" />
<meta property="og:url" content="${escape(canonical)}" />
<meta property="og:title" content="${escape(title)}" />
<meta property="og:description" content="${escape(description)}" />
<meta property="og:image" content="${site}/og.png" />
<meta property="og:image:width" content="1200" /><meta property="og:image:height" content="630" />
<meta property="og:image:alt" content="AttachmentDownloader — download Gmail attachments as a ZIP" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${escape(title)}" />
<meta name="twitter:description" content="${escape(description)}" />
<meta name="twitter:image" content="${site}/og.png" />
<script type="application/ld+json">${json({ "@context": "https://schema.org", "@graph": graph })}</script>`;
  const output = await new HTMLRewriter()
    .on('meta[property^="og:"]', { element(element) { element.remove(); } })
    .on('meta[name^="twitter:"]', { element(element) { element.remove(); } })
    .on('meta[name="robots"], meta[name="author"], meta[name="theme-color"]', { element(element) { element.remove(); } })
    .on('script[type="application/ld+json"]', { element(element) { element.remove(); } })
    .on("head", { element(element) { element.append(metadata, { html: true }); } })
    .transform(new Response(source)).text();
  await Bun.write(file, output);
  sitemap.push({ url: canonical, modified: modified[filename]! });
}
await cp("public", "dist", { recursive: true });
const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemap.map(({ url, modified }) => `  <url><loc>${escape(url)}</loc><lastmod>${modified}</lastmod></url>`).join("\n")}\n</urlset>\n`;
await Bun.write("public/sitemap.xml", sitemapXml);
await Bun.write("dist/sitemap.xml", sitemapXml);
console.log(`Prerendered the homepage and enriched ${sitemap.length} public pages with metadata, schema and sitemap entries.`);
