import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let server: ReturnType<typeof Bun.spawn>;
let origin = "";

beforeAll(async () => {
  server = Bun.spawn(["bun", "server.ts"], {
    env: { ...process.env, PORT: "0", NODE_ENV: "production" },
    stdout: "pipe",
    stderr: "inherit",
  });
  const reader = (server.stdout as ReadableStream<Uint8Array>).getReader();
  let output = "";
  while (!origin) {
    const { value, done } = await reader.read();
    if (done) throw new Error(`Site did not start: ${output}`);
    output += new TextDecoder().decode(value);
    origin = output.match(/running at (http:\/\/\S+)/)?.[1] ?? "";
  }
  reader.releaseLock();
}, 15_000);

afterAll(() => server?.kill());

test("missing URLs return a real 404 instead of a copy of the homepage", async () => {
  const response = await fetch(new URL("/not-a-real-page", origin));
  expect(response.status).toBe(404);
  expect(await response.text()).toContain("Page not found");
});

test.each([
  ["/privacy.html?ref=guide", "/privacy?ref=guide"],
  ["/download-all-gmail-attachments/?utm_source=test", "/download-all-gmail-attachments?utm_source=test"],
  ["/index.html?code=oauth-callback&state=example", "/?code=oauth-callback&state=example"],
])("canonical redirect %s preserves its query string", async (path, destination) => {
  const response = await fetch(new URL(path, origin), { redirect: "manual" });
  expect(response.status).toBe(308);
  expect(response.headers.get("location")).toBe(destination);
});

test("unknown HTML variants stay 404 rather than creating arbitrary redirects", async () => {
  const response = await fetch(new URL("/does-not-exist.html", origin), { redirect: "manual" });
  expect(response.status).toBe(404);
});

test("Google verification file keeps its exact public contents", async () => {
  const response = await fetch(new URL("/googlefd6628355733cf4e.html", origin));
  expect(response.status).toBe(200);
  expect(await response.text()).toBe("google-site-verification: googlefd6628355733cf4e.html");
});

test("existing public guide is reachable without account access", async () => {
  const response = await fetch(new URL("/download-all-gmail-attachments", origin));
  expect(response.status).toBe(200);
  expect(await response.text()).toContain("How to download all attachments from Gmail at once");
});

test("production packaging preserves public ownership HTML instead of redirecting it as a guide", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "attachment-seo-"));
  try {
    await mkdir(join(fixture, "dist"));
    for (const file of ["index.html", "privacy.html"]) {
      await Bun.write(join(fixture, file), "<h1>Source page</h1>");
      await Bun.write(join(fixture, "dist", file), "<h1>Built page</h1>");
    }
    await Bun.write(join(fixture, "dist/googlefd6628355733cf4e.html"), "google-site-verification: googlefd6628355733cf4e.html");
    await Bun.write(join(fixture, "dist/404.html"), "Page not found");
    const script = join(import.meta.dir, "../scripts/package-vercel.ts");
    const process = Bun.spawn(["bun", script, "production"], { cwd: fixture, stdout: "pipe", stderr: "pipe" });
    expect(await process.exited).toBe(0);
    const config = await Bun.file(join(fixture, ".vercel/output/config.json")).json();
    const redirects = config.routes.filter((route: any) => route.status === 308 && !route.has);
    expect(redirects.some((route: any) => new RegExp(`^${route.src}$`).test("/googlefd6628355733cf4e.html"))).toBe(false);
    expect(redirects.some((route: any) => new RegExp(`^${route.src}$`).test("/privacy.html"))).toBe(true);
    expect(config.routes.at(-1)).toMatchObject({ status: 404, dest: "/404.html" });
    expect(await Bun.file(join(fixture, ".vercel/output/static/googlefd6628355733cf4e.html")).text()).toBe("google-site-verification: googlefd6628355733cf4e.html");
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
