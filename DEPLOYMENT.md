# Deployment handoff

## Completed

- Private repository created and pushed: https://github.com/Ninou09/luminol-academy-crm
- Branch: `main`.
- Vercel target: team `luminol` (`team_aI1mjk4mAzJS5FWTApMZNBJR`), new project `luminol-academy-crm`.
- Vite build, Node.js API entry point, SPA/API routing, HTTPS cookies, persistent login-rate limits, private Blob snapshot adapter, and separated preview/production data paths are included.
- TypeScript/build verification passes. All 17 automated tests pass, including cross-instance snapshot conflicts and storage-failure behavior.
- Local databases, runtime files, installed dependencies, build output, and secret environment files are excluded from Git.

## Current deployment blocker

The Vercel connector returned HTTP 403 when creating the Git-linked project. A subsequent project lookup confirmed that the CRM project does not exist yet.

The signed-in Vercel dashboard can currently see the older `Ninou09/luminol-academy` repository, but importing `Ninou09/luminol-academy-crm` reports: “Could not access the repository. Please ensure you have access to it.”

The GitHub permissions popup could not be controlled because the browser security policy rejected its invalid/blank URL. No access grant was submitted. The Vercel CLI is installed in the npm execution cache but is logged out.

The owner must either grant the existing Vercel GitHub app access to **only the new CRM repository**, or deliberately complete Vercel CLI login for deployment from local source.

## Remaining steps after access is available

1. Import `Ninou09/luminol-academy-crm` into team `luminol`, using project name `luminol-academy-crm` and the repository root.
2. Use Node.js 24, the Vite framework preset, `npm run build`, and output directory `dist`. Routing is supplied by `vercel.json`.
3. Create and link a **private** Vercel Blob store in the same project. The adapter uses `BLOB_STORE_ID` and short-lived Vercel OIDC credentials.
4. Configure a unique `DEMO_PASSWORD` of at least 16 characters as a sensitive production/preview environment variable. Never put it in Git or browser code.
5. Deploy the reviewed `main` commit. Preview and production snapshots are separate.
6. Verify HTTPS page load, authenticated API access, creation of a fictional inquiry, persistence after reload, and a separate request/session. Confirm failed writes return an error rather than a success.
7. Record the verified deployment URL and commit here. At this point no live CRM URL has been issued.

The hosted administrator is `admin@luminol.demo`; the hosted UI does not prefill its password. The sample dataset remains labeled as fictional. Real staff onboarding and external service integrations are separate follow-up work.
