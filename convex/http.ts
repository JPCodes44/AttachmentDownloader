import { registerStaticRoutes } from "@convex-dev/static-hosting";
import { httpRouter } from "convex/server";
import { components } from "./_generated/api";
import { auth } from "./auth";

const http = httpRouter();

auth.addHttpRoutes(http);

// The built frontend (staging/production). Exact routes above take priority.
registerStaticRoutes(http, components.staticHosting);

export default http;
