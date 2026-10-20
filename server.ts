import index from "./index.html";
import guide from "./gmail-attachments-not-downloading.html";
import privacy from "./privacy.html";

// Same files the build copies into dist/ for Vercel to serve as-is.
const publicFiles = Object.fromEntries(
  ["robots.txt", "sitemap.xml", "favicon.svg", "og.png"].map((name) => [
    `/${name}`,
    new Response(Bun.file(`public/${name}`)),
  ]),
);

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  routes: {
    ...publicFiles,
    "/gmail-attachments-not-downloading": guide,
    "/privacy": privacy,
    "/*": index,
  },
  development: process.env.NODE_ENV !== "production" && { hmr: true, console: true },
});

console.log(`AttachmentDownloader running at ${server.url}`);
