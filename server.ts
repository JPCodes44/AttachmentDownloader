import index from "./index.html";

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  routes: {
    // The browser learns which Convex deployment to talk to from here (CONVEX_URL is in .env.local).
    "/api/config": () => Response.json({ convexUrl: process.env.CONVEX_URL }),
    "/*": index,
  },
  development: process.env.NODE_ENV !== "production" && { hmr: true, console: true },
});

console.log(`Gmail Attachments running at ${server.url}`);
