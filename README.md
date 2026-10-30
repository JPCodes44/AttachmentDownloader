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
<summary><b>Public pages and search visibility</b></summary>

- All root HTML pages are build entrypoints. Add an accurate modified date in `scripts/prerender.tsx` when creating or substantially updating a page.
- The build prerenders the homepage, enriches public pages with metadata and structured data, and generates `public/sitemap.xml` and `dist/sitemap.xml`. `bun run seo:check` validates the built metadata, schema, internal links, assets, sitemap and Google ownership file.
- Keep `public/googlefd6628355733cf4e.html`: Google uses it to maintain Search Console ownership.
- Package the checked build with `bun scripts/package-vercel.ts production` or `staging`. Both CI and frontend-only manual publication use this script. Production redirects known Vercel aliases to the custom domain; staging sends `X-Robots-Tag: noindex`. Missing URLs return 404 instead of the homepage.
- A frontend-only publication uses existing public production `VITE_*` settings, `bun run build`, `bun run package:production`, then `vercel deploy --prebuilt --prod`. Confirm the linked Vercel project before deploying. This path does not deploy Convex.
- Search Console supplies search performance and indexing reports. The site has no added analytics trackers. Submit `https://attachmentdownloader.ca/sitemap.xml` after publishing new pages.

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
