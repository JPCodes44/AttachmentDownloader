import index from "./index.html";
import guide from "./gmail-attachments-not-downloading.html";
import downloadAll from "./download-all-gmail-attachments.html";
import fromSender from "./download-gmail-attachments-from-sender.html";
import privacy from "./privacy.html";
import guides from "./guides.html";
import pdfs from "./download-pdf-attachments-gmail.html";
import byDate from "./download-gmail-attachments-by-date.html";
import about from "./about.html";

// Same files the build copies into dist/ for Vercel to serve as-is.
const publicFiles = Object.fromEntries(
  [...new Bun.Glob("*").scanSync("public")].filter((name) => name !== "404.html").map((name) => [
    `/${name}`,
    new Response(Bun.file(`public/${name}`)),
  ]),
);

const pages = {
  "/gmail-attachments-not-downloading": guide,
  "/download-all-gmail-attachments": downloadAll,
  "/download-gmail-attachments-from-sender": fromSender,
  "/privacy": privacy,
  "/guides": guides,
  "/download-pdf-attachments-gmail": pdfs,
  "/download-gmail-attachments-by-date": byDate,
  "/about": about,
};

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  routes: {
    ...publicFiles,
    ...pages,
    "/": index,
  },
  fetch(request) {
    const url = new URL(request.url);
    const clean = url.pathname.replace(/\.html$|\/$/, "");
    if (url.pathname === "/index.html" || Object.hasOwn(pages, clean)) {
      return new Response(null, {
        status: 308,
        headers: { location: `${url.pathname === "/index.html" ? "/" : clean}${url.search}` },
      });
    }
    return new Response(Bun.file("public/404.html"), { status: 404 });
  },
  development: process.env.NODE_ENV !== "production" && { hmr: true, console: true },
});

console.log(`AttachmentDownloader running at ${server.url}`);
