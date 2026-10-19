import { defineApp } from "convex/server";
import staticHosting from "@convex-dev/static-hosting/convex.config";

// No httpPrefix: convex/http.ts keeps owning the root so the Google OAuth
// callback URLs (/api/auth/..., /gmail/callback) stay where they are.
const app = defineApp();
app.use(staticHosting);

export default app;
