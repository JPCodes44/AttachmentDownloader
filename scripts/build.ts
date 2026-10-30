import { rm } from "node:fs/promises";

// Discover HTML entrypoints so new guides cannot be forgotten in the build.
const pages = [...new Bun.Glob("*.html").scanSync(".")].sort();
await rm("dist", { recursive: true, force: true });
const build = Bun.spawn(["bun", "build", "--check", ...pages.map((page) => `./${page}`), "--outdir", "dist", "--minify", "--env=VITE_*"], {
  stdout: "inherit",
  stderr: "inherit",
});
if (await build.exited !== 0) process.exit(1);
await import("./prerender.tsx");
await import("./check-site.ts");
