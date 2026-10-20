<p align="center">
  <img src="docs/hero.svg" alt="Gmail Attachments: every attachment in your inbox, downloaded as one ZIP" width="100%">
</p>

<p align="center">
  <img src="docs/app.png" alt="Search filters, a list of found attachments with three ticked, and a Download ZIP button" width="100%">
</p>

<p align="center">
  <img src="docs/sign-in.png" alt="Sign-in page: one Google consent screen with read-only Gmail access" width="70%">
</p>

<p align="center">
  <img src="docs/how-it-works.svg" alt="How it works: sign in, search, pick, download. The Gmail key stays encrypted in Convex; file bytes go straight from Gmail to the browser." width="100%">
</p>

<p align="center">
  <img src="docs/pipeline.svg" alt="Pull request, checks, merge, staging, approve, production" width="100%">
</p>

<p align="center">
  <a href="https://gmail-attachments.vercel.app"><b>Production</b></a> ·
  <a href="https://gmail-attachments-staging.vercel.app"><b>Staging</b></a>
</p>

<details>
<summary><b>Run it locally</b></summary>

1. Google Cloud: enable the **Gmail API**, set the OAuth consent screen to **Testing**, add test users, and create a **Web** OAuth client.
2. Start the backend and set its keys:
   ```sh
   bun install
   bunx convex dev
   bun scripts/setup.ts --google-id <CLIENT_ID> --google-secret <CLIENT_SECRET>
   ```
   Add the origin and redirect URI the script prints to the Google client.
3. Run the app with `bun run dev`, then open http://localhost:3000.

Checks: `bun run typecheck` · `bun test` · `bun run build`
</details>

<details>
<summary><b>Environments and deploys</b></summary>

| Environment | Website | Convex deployment |
|---|---|---|
| dev | http://localhost:3000 | your `dev/…` deployment |
| staging | https://gmail-attachments-staging.vercel.app | `staging` (glorious-leopard-388) |
| production | https://gmail-attachments.vercel.app | default prod (flippant-jay-368) |

- **Pull requests:** checks only.
- **Pushes to `main`:** checks, then staging, then production after you approve it under **Review deployments** on the run.
- **Each GitHub environment holds:**
  - secrets: `CONVEX_DEPLOY_KEY`, `VERCEL_TOKEN`
  - variables: `CONVEX_URL`, `SITE_URL`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`
- **To set up a new environment:** run `bun scripts/setup.ts --deployment <name> --copy-google-from dev --site-url <url>`.
- **Google's Testing mode:** the Gmail permission expires every 7 days, and the app asks you to sign in again when it does.
</details>
