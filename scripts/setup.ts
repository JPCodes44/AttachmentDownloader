// Sets every Convex env var the app needs on a deployment.
// Usage:
//   bun scripts/setup.ts --google-id ID --google-secret SECRET        # your dev deployment
//   bun scripts/setup.ts --deployment staging --copy-google-from dev  # staging, reusing dev's Google client
// Keys that are already set are left alone, so it is safe to re-run.
import { exportJWK, exportPKCS8, generateKeyPair } from "jose";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    deployment: { type: "string" },
    "google-id": { type: "string" },
    "google-secret": { type: "string" },
    "copy-google-from": { type: "string" },
    "site-url": { type: "string" },
  },
});

const target = values.deployment ? ["--deployment", values.deployment] : [];

async function getEnv(name: string, from: string[] = target): Promise<string | null> {
  const out = await Bun.$`bunx convex env get ${from} ${name}`.quiet().nothrow();
  const value = out.stdout.toString().trim();
  return out.exitCode === 0 && value ? value : null;
}

async function setEnv(name: string, value: string, { overwrite = false } = {}) {
  if (!overwrite && (await getEnv(name))) {
    console.log(`  ${name}: already set, keeping it`);
    return;
  }
  await Bun.$`bunx convex env set ${target} ${name} -- ${value}`.quiet();
  console.log(`  ${name}: set`);
}

// https://<name>.convex.site for the target deployment, read from the dashboard link.
async function deploymentSiteUrl(): Promise<string> {
  if (!values.deployment) return process.env.CONVEX_SITE_URL ?? "";
  const out = await Bun.$`bunx convex dashboard ${target} --no-open`.quiet().nothrow();
  const name = (out.stdout.toString() + out.stderr.toString()).match(/\/d\/([a-z]+-[a-z]+-\d+)/)?.[1];
  if (!name) throw new Error(`Could not find deployment "${values.deployment}". Does it exist?`);
  return `https://${name}.convex.site`;
}

const convexSiteUrl = await deploymentSiteUrl();
// Dev runs the web app locally; hosted deployments serve it from their own .convex.site.
const siteUrl = values["site-url"] ?? (values.deployment ? convexSiteUrl : "http://localhost:3000");

console.log(`Configuring Convex environment variables on ${values.deployment ?? "your dev deployment"}…`);

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
await setEnv("SITE_URL", siteUrl, { overwrite: true });

let googleId = values["google-id"];
let googleSecret = values["google-secret"];
if (values["copy-google-from"]) {
  const from = ["--deployment", values["copy-google-from"]];
  googleId ??= (await getEnv("AUTH_GOOGLE_ID", from)) ?? undefined;
  googleSecret ??= (await getEnv("AUTH_GOOGLE_SECRET", from)) ?? undefined;
}
if (googleId) await setEnv("AUTH_GOOGLE_ID", googleId, { overwrite: true });
if (googleSecret) await setEnv("AUTH_GOOGLE_SECRET", googleSecret, { overwrite: true });

for (const name of ["AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET"]) {
  if (!(await getEnv(name))) {
    console.log(`  ${name}: MISSING. Re-run with --google-id / --google-secret (or --copy-google-from dev).`);
  }
}

console.log(`
Add these to your Google OAuth client:
  Authorized JavaScript origin:  ${siteUrl}
  Authorized redirect URIs:      ${convexSiteUrl}/api/auth/callback/google
                                 ${convexSiteUrl}/gmail/callback`);
