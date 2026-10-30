AttachmentDownloader requests Gmail access directly from Google in the browser. Gmail searches, attachment details and downloaded bytes stay in browser memory; Convex is used for profile-based account sign-in only.

<p align="center">
  <img src="docs/environments.svg" alt="Three copies of the app: dev, staging and production" width="100%">
</p>

<p align="center">
  <img src="docs/pipeline.svg" alt="Shipping a change: pull request, checks, merge, staging, approve, production" width="100%">
</p>

<p align="center">
  <a href="https://attachmentdownloader.ca"><b>Production</b></a> ·
  <a href="https://gmail-attachments-staging.vercel.app"><b>Staging</b></a>
</p>

<details>
<summary><b>Run it locally</b></summary>

1. Google Cloud: enable the **Gmail API**, set the OAuth consent screen to **Testing**, add test users, and create a **Web** OAuth client. Add the app origins (including `http://localhost:3000` and `https://attachmentdownloader.ca`) as authorized JavaScript origins. Gmail permission is granted to the browser separately from profile-only account sign-in.
2. Set `VITE_GOOGLE_CLIENT_ID` to the same public OAuth client ID as `AUTH_GOOGLE_ID`. In GitHub, add `GOOGLE_CLIENT_ID` as a variable in each deploy environment. Start the backend and set its keys:
   ```sh
   bun install
   bunx convex dev
   bun scripts/setup.ts --google-id <CLIENT_ID> --google-secret <CLIENT_SECRET>
   ```
   Add the origin and redirect URI the script prints to the Google client.
3. Run the app with `VITE_GOOGLE_CLIENT_ID=<CLIENT_ID> bun run dev`, then open http://localhost:3000.

Checks: `bun run typecheck` · `bun test` · `bun run build`
</details>

<details>
<summary><b>Environments and deploys</b></summary>

| Environment | Website | Convex deployment |
|---|---|---|
| dev | http://localhost:3000 | your `dev/…` deployment |
| staging | https://gmail-attachments-staging.vercel.app | `staging` (glorious-leopard-388) |
| production | https://attachmentdownloader.ca | default prod (flippant-jay-368) |

- **Pull requests:** checks only.
- **Pushes to `main`:** checks, then staging, then production after you approve it under **Review deployments** on the run.
- **Each GitHub environment holds:**
  - secrets: `CONVEX_DEPLOY_KEY`, `VERCEL_TOKEN`
  - variables: `CONVEX_URL`, `SITE_URL`, `GOOGLE_CLIENT_ID`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`
- **To set up a new environment:** run `bun scripts/setup.ts --deployment <name> --copy-google-from dev --site-url <url>`.
- **Google's Testing mode:** Google expires the Gmail permission after 7 days; reconnect Gmail in the browser when asked.
</details>
