# GmailAttachments
📎 Bulk-download every attachment from your Gmail inbox in one go.

Sign in with Google (one consent screen, including read-only Gmail access), search with Gmail syntax or quick filters, tick the files you want (or **Select all**) and download them as one ZIP.

**Stack:** [Convex](https://convex.dev) backend · React + TypeScript frontend served by `Bun.serve` · type-checked by `bun check` (TypeScript 7, the native Go compiler) · tests with `bun test` + `convex-test`.

## How it works

```
Browser ──Sign in with Google──► Google consent (name, email, gmail.readonly)
Google ──tokens──► Convex Auth profile() encrypts the refresh token (AES-GCM) ──► gmailAccounts
Browser ──Find attachments──► scans.start ──► scanPage action, 100 emails per run, loops until done
                                              └─► attachment *metadata* rows (live in the UI)
Browser ──Download──► getAccessToken (1-hour token) ──► fetch bytes straight from Gmail ──► client-zip ──► .zip
```

File bytes never pass through or get stored in Convex. Gmail attachments can reach 25 MB, which is more than Convex can return in one response.

## Setup

### 1. Google Cloud (once)
1. Create a project at <https://console.cloud.google.com>. Billing is **not** needed.
2. **APIs & Services → Library**: enable the **Gmail API**.
3. **OAuth consent screen**: choose External, keep it in **Testing**, and add yourself and your testers as **test users**.
4. **Credentials → Create OAuth client ID → Web application**. Add the origin and redirect URIs that step 3 below prints.

### 2. Install and start Convex
```sh
bun install
bunx convex dev          # log in / create a project the first time, then leave it running
```

### 3. Set the backend environment variables
```sh
bun scripts/setup.ts --google-id <CLIENT_ID> --google-secret <CLIENT_SECRET>
```
This generates the auth signing keys and the token encryption key, sets `SITE_URL=http://localhost:3000`, and prints the exact redirect URIs to paste into the Google OAuth client. It's safe to re-run.

### 4. Run
```sh
bun run dev              # Convex + web app at http://localhost:3000
```

## CI/CD

`.github/workflows/ci.yml` runs on GitHub Actions:

| When | What runs |
|---|---|
| A PR to `main` is opened or updated | gitleaks secret scan over all history, `bun check`, `bun test`, build |
| A PR is **merged** into `main` | The same checks, then **deploy to staging** (Convex backend + website) |
| Manually: Actions → CI/CD → *Run workflow* | Checks, then deploy `main` to staging |

Staging is the `staging` deployment in the Convex project (backend) plus the
`gmail-attachments-staging` Vercel project (website, static files):
**https://gmail-attachments-staging.vercel.app**

### One-time staging setup (already done for this repo)
1. `bunx convex deployment create staging --type prod`
2. `bun scripts/setup.ts --deployment staging --copy-google-from dev --site-url https://gmail-attachments-staging.vercel.app` sets staging's own auth and encryption keys and reuses dev's Google client.
3. Add the origin and redirect URI it prints to the Google OAuth client.
4. `bunx vercel login`, then `bunx vercel project add gmail-attachments-staging` and `bunx vercel link --project gmail-attachments-staging` (the IDs land in the git-ignored `.vercel/project.json`).
5. GitHub `staging` environment:
   - secrets: `CONVEX_DEPLOY_KEY` (from `bunx convex deployment token create github-actions-staging --deployment staging`) and `VERCEL_TOKEN` (from https://vercel.com/account/tokens)
   - variables: `STAGING_URL`, `STAGING_CONVEX_URL`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`

## Scripts
| Command | What it does |
|---|---|
| `bun run dev` | Convex dev and web server with hot reload |
| `bun run typecheck` | `bun check` over app and backend |
| `bun test` | Unit tests and Convex integration tests |
| `bun run build` | Production bundle in `dist/` (needs `VITE_CONVEX_URL`) |
| `bun run start` | Serve the app locally in production mode |

## Good to know
- **Free:** the Gmail API costs nothing, and the Convex free tier is plenty, since only metadata is stored.
- **7-day expiry:** while the Google app is in Testing mode, Google expires the Gmail permission after 7 days. You stay signed in; the app shows **Sign in with Google again** to renew Gmail access. Switching the Google app to "In production" without verification removes the limit (users see an "unverified app" warning, up to 100 users).
- **Inline images** (signature logos and the like) are hidden by default. Use the "Include inline images" toggle to show them.
- Each user keeps only their most recent scan. Starting a new one cleans up the old one.
