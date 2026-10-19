import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

const root = createRoot(document.getElementById("root")!);

// Inlined at bundle time by Bun: server.ts in dev, the build script for staging.
const convexUrl = process.env.VITE_CONVEX_URL;

if (!convexUrl) {
  root.render(<p className="fatal">VITE_CONVEX_URL is not set. Run `bunx convex dev` first.</p>);
} else {
  root.render(
    <StrictMode>
      <ConvexAuthProvider client={new ConvexReactClient(convexUrl)}>
        <App />
      </ConvexAuthProvider>
    </StrictMode>,
  );
}
