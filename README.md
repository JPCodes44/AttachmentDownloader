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

`.github/workflows/ci.yml` (checks) calls `.github/workflows/deploy.yml` (one deploy, per environment):

| When | What runs |
|---|---|
| A PR to `main` is opened or updated | gitleaks secret scan over all history, `bun check`, `bun test`, build |
| A PR is **merged** (any push to `main`) | Checks → **staging** → waits for approval → **production** |
| Manually: Actions → CI/CD → *Run workflow* on `main` | Same as a merge |

**Approving production:** after staging deploys, the run shows *Review deployments*. Check staging, then approve
`production` and the same commit ships. Production only accepts deploys from `main`.

| Environment | Website | Convex deployment |
|---|---|---|
| dev (local) | http://localhost:3000 | your `dev/…` deployment |
| staging | https://gmail-attachments-staging.vercel.app | `staging` (glorious-leopard-388) |
| production | https://gmail-attachments.vercel.app | default prod (flippant-jay-368) |

### Setting up an environment (already done for staging and production)
1. Convex deployment: `bunx convex deployment create <name> --type prod`. Production uses the project's default prod deployment.
2. `bun scripts/setup.ts --deployment <name|prod> --copy-google-from dev --site-url https://<site>.vercel.app`, then add the origin and redirect URI it prints to the Google OAuth client.
3. Vercel: `bunx vercel project add <project>` and `bunx vercel link --project <project>` (IDs land in the git-ignored `.vercel/project.json`).
4. GitHub environment with the same name:
   - secrets: `CONVEX_DEPLOY_KEY` (`bunx convex deployment token create github-actions-<env> --deployment <name|prod>`) and `VERCEL_TOKEN` (https://vercel.com/account/tokens)
   - variables: `CONVEX_URL`, `SITE_URL`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`

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
