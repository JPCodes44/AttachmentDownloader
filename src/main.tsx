import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

const root = createRoot(document.getElementById("root")!);

fetch("/api/config")
  .then((r) => r.json() as Promise<{ convexUrl?: string }>)
  .then(({ convexUrl }) => {
    if (!convexUrl) throw new Error("CONVEX_URL is not set. Run `bunx convex dev` first.");
    const convex = new ConvexReactClient(convexUrl);
    root.render(
      <StrictMode>
        <ConvexAuthProvider client={convex}>
          <App />
        </ConvexAuthProvider>
      </StrictMode>,
    );
  })
  .catch((err: Error) => root.render(<p className="fatal">{err.message}</p>));
