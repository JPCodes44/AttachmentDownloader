// One packaging path for CI and local publication. This never deploys Convex.
import { cp, mkdir, rm } from "node:fs/promises";

const environment = process.argv[2];
if (environment !== "production" && environment !== "staging") {
  throw new Error("Usage: bun scripts/package-vercel.ts production|staging");
}

// Root HTML entrypoints are pages. public/ also contains ownership HTML that
// must keep its filename and must never enter clean-URL redirect rules.
const pages = [...new Bun.Glob("*.html").scanSync(".")]
  .filter((name) => name !== "index.html" && name !== "404.html")
  .map((name) => name.slice(0, -5));
const pattern = pages.map((page) => page.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
const securityHeaders = {
  "content-security-policy": "default-src 'self'; script-src 'self' https://accounts.google.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https://*.convex.cloud wss://*.convex.cloud https://*.convex.site https://gmail.googleapis.com https://chat.googleapis.com https://www.googleapis.com https://oauth2.googleapis.com https://accounts.google.com; frame-src https://accounts.google.com/gsi/; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'",
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
};

const aliases = [
  "attachmentdownloader.vercel.app",
  "gmail-attachments.vercel.app",
  "attachmentdownloader-justin-maks-projects-297821e4.vercel.app",
];
const routes = [
  ...(environment === "production"
    ? aliases.map((host) => ({ src: "/(.*)", has: [{ type: "host", value: host }], status: 308, headers: { location: "https://attachmentdownloader.ca/$1" } }))
    : [{ src: "/.*", headers: { "x-robots-tag": "noindex" }, continue: true }]),
  { src: "/.*", headers: securityHeaders, continue: true },
  { src: "/[^/]+-[a-z0-9]{8}\\.(js|css|svg)$", headers: { "cache-control": "public, max-age=31536000, immutable" }, continue: true },
  { src: "/index\\.html$", status: 308, headers: { location: "/" } },
  { src: `/(${pattern})\\.html$`, status: 308, headers: { location: "/$1" } },
  { src: `/(${pattern})/$`, status: 308, headers: { location: "/$1" } },
  { handle: "filesystem" },
  { src: `/(${pattern})$`, dest: "/$1.html" },
  { src: "/.*", dest: "/404.html", status: 404 },
];

await rm(".vercel/output", { recursive: true, force: true });
await mkdir(".vercel/output/static", { recursive: true });
await cp("dist", ".vercel/output/static", { recursive: true });
await Bun.write(".vercel/output/config.json", JSON.stringify({ version: 3, routes }, null, 2));
console.log(`Packaged ${pages.length + 1} pages for ${environment}; unknown URLs return 404.`);
