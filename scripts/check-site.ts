// Validate the generated pages that crawlers actually receive. Run after build.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { metadataText } from "./metadata-text";

const directory = process.argv[2] ?? "dist";
const site = "https://attachmentdownloader.ca";
const errors: string[] = [];
type Page = { filename: string; title: string; descriptions: string[]; canonical: string[]; headings: number; links: string[]; ids: Set<string>; graphs: Record<string, unknown>[][]; robots: string[] };
const pages: Page[] = [];

for (const filename of new Bun.Glob("*.html").scanSync(".")) {
  const page: Page = { filename, title: "", descriptions: [], canonical: [], headings: 0, links: [], ids: new Set(), graphs: [], robots: [] };
  let schema = "";
  const socialTitles: string[] = [];
  await new HTMLRewriter()
    .on("title", { text(chunk) { page.title += chunk.text; } })
    .on('meta[property="og:title"], meta[name="twitter:title"]', { element(e) { socialTitles.push(metadataText(e.getAttribute("content") ?? "")); } })
    .on('meta[name="description"]', { element(e) { page.descriptions.push(e.getAttribute("content") ?? ""); } })
    .on('meta[name="robots"]', { element(e) { page.robots.push(e.getAttribute("content") ?? ""); } })
    .on('link[rel="canonical"]', { element(e) { page.canonical.push(e.getAttribute("href") ?? ""); } })
    .on("h1", { element() { page.headings++; } })
    .on("[id]", { element(e) { const id = e.getAttribute("id")!; if (page.ids.has(id)) errors.push(`${filename}: duplicate id ${id}`); page.ids.add(id); } })
    .on("a[href], link[href]", { element(e) { page.links.push(e.getAttribute("href") ?? ""); } })
    .on("script[src], img[src]", { element(e) { page.links.push(e.getAttribute("src") ?? ""); } })
    .on('script[type="application/ld+json"]', {
      element(e) { schema = ""; e.onEndTag(() => {
        try {
          const parsed = JSON.parse(schema);
          if (parsed["@context"] !== "https://schema.org" || !Array.isArray(parsed["@graph"])) throw new Error("expected schema.org graph");
          page.graphs.push(parsed["@graph"]);
        } catch (error) { errors.push(`${filename}: invalid structured data (${error})`); }
      }); },
      text(chunk) { schema += chunk.text; },
    })
    .transform(new Response(Bun.file(join(directory, filename)))).text();
  if (socialTitles.length !== 2 || socialTitles.some((title) => title !== metadataText(page.title))) errors.push(`${filename}: social titles must match the visible document title without double-escaped entities`);
  pages.push(page);
}
if (!pages.length) errors.push("No built public pages found");

const canonicals = new Map<string, Page>();
const titles = new Set<string>();
for (const page of pages) {
  const expected = `${site}/${page.filename === "index.html" ? "" : page.filename.slice(0, -5)}`;
  if (!page.title.trim() || titles.has(page.title)) errors.push(`${page.filename}: missing or duplicate title`);
  titles.add(page.title);
  if (page.descriptions.length !== 1 || !page.descriptions[0]?.trim()) errors.push(`${page.filename}: expected one nonempty description`);
  if (page.canonical.length !== 1 || page.canonical[0] !== expected) errors.push(`${page.filename}: incorrect canonical`);
  if (page.headings !== 1) errors.push(`${page.filename}: expected one H1, found ${page.headings}`);
  if (page.robots.length !== 1 || /noindex|nosnippet/i.test(page.robots[0]!)) errors.push(`${page.filename}: unexpected search restriction`);
  const graph = page.graphs.flat();
  if (page.graphs.length !== 1 || !graph.some((entity) => entity["@id"] === `${expected}#webpage`)) errors.push(`${page.filename}: missing matching WebPage entity`);
  if (page.filename !== "index.html" && !graph.some((entity) => entity["@type"] === "BreadcrumbList")) errors.push(`${page.filename}: missing breadcrumbs`);
  canonicals.set(expected, page);
}
for (const page of pages) {
  for (const link of page.links) {
    if (/^(mailto:|tel:|data:)/i.test(link)) continue;
    let url: URL;
    try { url = new URL(link, page.canonical[0] ?? site); }
    catch { errors.push(`${page.filename}: malformed link ${link}`); continue; }
    if (url.origin !== site) continue;
    const target = canonicals.get(`${site}${url.pathname}`);
    if (target) {
      if (url.hash && !target.ids.has(decodeURIComponent(url.hash.slice(1)))) errors.push(`${page.filename}: missing anchor ${link}`);
    } else if (!existsSync(join(directory, decodeURIComponent(url.pathname)))) {
      errors.push(`${page.filename}: broken internal link or asset ${link}`);
    }
  }
}

const sitemap = await Bun.file(join(directory, "sitemap.xml")).text();
const listed = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]!);
if (listed.length !== canonicals.size || new Set(listed).size !== listed.length || listed.some((url) => !canonicals.has(url))) errors.push("Sitemap must contain every canonical page exactly once and no other URLs");
for (const url of canonicals.keys()) if (!listed.includes(url)) errors.push(`Sitemap missing ${url}`);
const verification = await Bun.file(join(directory, "googlefd6628355733cf4e.html")).text();
if (verification !== "google-site-verification: googlefd6628355733cf4e.html") errors.push("Google ownership verification file changed");
const notFound = await Bun.file(join(directory, "404.html")).text();
if (!notFound.includes('content="noindex,follow"')) errors.push("404 page must be noindex");

if (errors.length) throw new Error(`SEO build validation failed:\n${errors.map((error) => `- ${error}`).join("\n")}`);
console.log(`SEO validation passed: ${pages.length} pages, unique metadata, schema, internal links/assets, sitemap and ownership file.`);
