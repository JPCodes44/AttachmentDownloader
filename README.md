# GmailAttachments
📎 Bulk-download every attachment from your Gmail inbox in one go.

Sign in with Google, connect Gmail (read-only), search with Gmail syntax or quick filters, tick the files you want (or **Select all**) and download them as one ZIP.

**Stack:** [Convex](https://convex.dev) backend · React + TypeScript frontend served by `Bun.serve` · type-checked by `bun check` (TypeScript 7, the native Go compiler) · tests with `bun test` + `convex-test`.

## How it works

```
Browser ──sign in──► Convex Auth (Google)
Browser ──Connect Gmail──► Convex makes a one-time state ticket ──► Google consent (gmail.readonly)
Google ──code──► Convex /gmail/callback ──► refresh token stored AES-GCM encrypted
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

## Scripts
| Command | What it does |
|---|---|
| `bun run dev` | Convex dev and web server with hot reload |
| `bun run typecheck` | `bun check` over app and backend |
| `bun test` | Unit tests and Convex integration tests |
| `bun run build` | Production bundle check (`dist/`) |
| `bun run start` | Serve the app in production mode |

## Good to know
- **Free:** the Gmail API costs nothing, and the Convex free tier is plenty, since only metadata is stored.
- **7-day reconnect:** while the Google app is in Testing mode, Google expires the Gmail permission after 7 days. The app notices and shows a **Reconnect Gmail** button. Publishing the app for the public would need Google's restricted-scope verification.
- **Inline images** (signature logos and the like) are hidden by default. Use the "Include inline images" toggle to show them.
- Each user keeps only their most recent scan. Starting a new one cleans up the old one.
