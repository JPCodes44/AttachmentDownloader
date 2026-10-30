# Search visibility implementation plan

> Execute inline using superpowers:executing-plans; request one independent code review before publication.

**Goal:** Make useful public content easy to crawl, understand, and navigate for conventional and AI search.

**Architecture:** Retain Bun HTML imports, React, prerendered homepage, static guides, and Vercel Build Output API. Generate sitemap/metadata from actual pages and use one packaging script for CI and local publication.

**Spec:** docs/superpowers/specs/2026-10-30-search-visibility-design.md

## Global constraints

- Preserve existing user changes in server.ts and public/googlefd6628355733cf4e.html.
- Preserve Google verification, security headers, public frontend settings and staging noindex.
- No Convex code changes/deployment; no trackers, paid services, fake endorsements or invented metrics.
- Use Bun and current styles; source all new Gmail search examples to Google documentation.

## Review focus

- OAuth query strings must survive redirect normalization.
- Verification/static files must never redirect to the homepage or 404.
- Unknown routes must return a real 404 in local and production routing.
- Structured data and canonical URLs must match actual visible content.
- Public content must remain readable without JavaScript or account access.

### Task 1: Routing and packaging

Files: tests/site.test.ts, server.ts, public/404.html, scripts/package-vercel.ts, .github/workflows/deploy.yml.

Interfaces: use existing root HTML page files as build inputs; package dist into .vercel/output with version 3 routing.

- [x] Write and run HTTP regression tests for unknown paths, canonical redirects with query strings, public files, and existing pages. Expected: missing-route/canonical tests fail before changes.
- [x] Implement proper 404s and canonical redirects. Centralize production/staging packaging with existing security/cache headers and production alias redirects.
- [x] Run bun test tests/site.test.ts. Expected: all pass.

### Task 2: Content and machine-readable metadata

Files: guides.html, download-pdf-attachments-gmail.html, download-gmail-attachments-by-date.html, about.html, existing HTML guides, src/components/Landing.tsx, src/styles.css, scripts/prerender.tsx, scripts/check-site.ts, package.json, public/sitemap.xml, public/llms.txt, public/robots.txt.

Interfaces: all root HTML pages are bundled by bun run build; prerender augments their compiled HTML; package script from Task 1 discovers the compiled pages.

- [x] Add two distinct detailed guides, directory, and About page; improve internal links and visible product explanations. Human prose does not need unit tests.
- [x] Add consistent social metadata, WebSite/WebApplication/WebPage/Article entities, breadcrumbs, semantic navigation, and a generated sitemap reflecting real page updates.
- [x] Add build-artifact validation for broken internal links, duplicate titles/canonicals, missing descriptions, schema, one H1 and sitemap coverage. Expected: catch actual output defects rather than assert source text.
- [x] Build with public production frontend settings; run check script, bun check and bun test. Expected: all pass.

### Task 3: Independent review, publish and indexing

Files: review notes and README deployment instructions if needed.

- [x] Request a fresh code review and fix important findings with regression tests.
- [x] Package frontend production output and deploy to the already confirmed Vercel project. No backend deployment.
- [ ] Verify live pages, missing URL status, redirects, verification file and final screenshot evidence. Local mobile PDF guide passed at 390px without overflow; browser disconnected before final production checks.
- [ ] Submit sitemap in Search Console and request homepage indexing; blocked while browser connection is unavailable.
- [x] Report concrete changes, validation and external indexing limits.
