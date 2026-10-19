// Sets every Convex env var the app needs on the current deployment (the one `convex dev` uses).
// Usage: bun scripts/setup.ts [--google-id ID --google-secret SECRET] [--site-url URL]
// Keys that are already set are left alone, so it is safe to re-run.
import { exportJWK, exportPKCS8, generateKeyPair } from "jose";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    "google-id": { type: "string" },
    "google-secret": { type: "string" },
    "site-url": { type: "string", default: "http://localhost:3000" },
  },
});

async function getEnv(name: string): Promise<string | null> {
  const out = await Bun.$`bunx convex env get ${name}`.quiet().nothrow();
  const value = out.stdout.toString().trim();
  return out.exitCode === 0 && value ? value : null;
}

async function setEnv(name: string, value: string, { overwrite = false } = {}) {
  if (!overwrite && (await getEnv(name))) {
    console.log(`  ${name}: already set, keeping it`);
    return;
  }
  await Bun.$`bunx convex env set ${name} -- ${value}`.quiet();
  console.log(`  ${name}: set`);
}

console.log("Configuring Convex environment variables…");

if (!(await getEnv("JWT_PRIVATE_KEY"))) {
  const keys = await generateKeyPair("RS256", { extractable: true });
  const privateKey = (await exportPKCS8(keys.privateKey)).trimEnd().replace(/\n/g, " ");
  const jwks = JSON.stringify({ keys: [{ use: "sig", ...(await exportJWK(keys.publicKey)) }] });
  await setEnv("JWT_PRIVATE_KEY", privateKey);
  await setEnv("JWKS", jwks);
} else {
  console.log("  JWT_PRIVATE_KEY / JWKS: already set, keeping them");
}

const encryptionKey = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");
await setEnv("TOKEN_ENCRYPTION_KEY", encryptionKey);
await setEnv("SITE_URL", values["site-url"]!, { overwrite: true });

if (values["google-id"]) await setEnv("AUTH_GOOGLE_ID", values["google-id"], { overwrite: true });
if (values["google-secret"]) await setEnv("AUTH_GOOGLE_SECRET", values["google-secret"], { overwrite: true });

for (const name of ["AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET"]) {
  if (!(await getEnv(name))) console.log(`  ${name}: MISSING. Re-run with --google-id / --google-secret.`);
}

const siteUrl = (await Bun.$`bunx convex env get CONVEX_SITE_URL`.quiet().nothrow()).stdout.toString().trim()
  || process.env.CONVEX_SITE_URL;
console.log(`
Add these to your Google OAuth client:
  Authorized JavaScript origin:  ${values["site-url"]}
  Authorized redirect URIs:      ${siteUrl}/api/auth/callback/google
                                 ${siteUrl}/gmail/callback`);
