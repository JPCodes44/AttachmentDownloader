import { defineApp } from "convex/server";
import staticHosting from "@convex-dev/static-hosting/convex.config";

// No httpPrefix: convex/http.ts keeps owning the root so the Google OAuth
// callback URL (/api/auth/callback/google) stays where it is.
const app = defineApp();
app.use(staticHosting);

export default app;
