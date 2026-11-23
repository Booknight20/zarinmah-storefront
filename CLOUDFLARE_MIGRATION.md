# ZarinMah Cloudflare Preview Migration

Status: preparation only. This branch is isolated from the active Vercel branch and Production.

## Source baseline
- Frontend repository: `Booknight20/zarinmah-storefront`
- Baseline branch: `fix/phone-password-username-mobile-banner-2026-11-21`
- Baseline commit: `ff149732de477920da2578ba84bab7bb62d09b7e`
- Preview target: Cloudflare Pages `*.pages.dev` only.
- Supabase target: Staging project `qijahxokldkaqmjinfvy` only.

## Current frontend shape
- Static storefront: root `index.html` and `logo-zarinmah.webp`.
- No frontend build command or framework build is defined in `package.json`.
- Existing Vercel API routes referenced by the page:
  - `/api/public-config.js`
  - `/api/listings-gateway`
  - `/api/market`
  - `/api/news`
- `/api/listings-gateway` forwards to the Python listings backend and currently depends on Vercel environment variables and Vercel protection bypass behavior.
- `/api/market` is a Node-style Vercel handler and reads optional market-history configuration.
- The current HTML explicitly detects the Supabase Staging URL for the test login flow.

## Required Cloudflare adaptation before deployment
1. Add a Pages Functions or Worker implementation for every API route above. Do not deploy the static page as a working storefront until these routes exist.
2. Port the Python listings API to a Cloudflare-compatible TypeScript Worker/Pages Function. Preserve all action names, validation, authorization checks, admin checks, storage behavior, and response formats.
3. Port the market endpoint and news endpoint, removing Vercel-specific runtime APIs and replacing history persistence with the existing Staging Supabase `market_history_state` design or another explicitly approved staging-only store.
4. Implement public config from Cloudflare environment bindings using only the Supabase Staging URL and publishable key. Never put service-role keys or bot tokens in browser code.
5. Keep private secrets as Cloudflare Worker/Pages encrypted secrets, never as committed files.
6. Add explicit route and integration tests before publishing a Preview.

## Safety boundaries
- Do not modify the Production Supabase project, Production domain DNS, or Vercel Production.
- Do not point `zarinmahgold.ir` at Cloudflare during this preview.
- Do not use Production credentials or copy Production data into Staging.
- Do not delete or overwrite the current Vercel deployment or the active Git branches.
- Deploy only to a Cloudflare `pages.dev` preview after all required API routes are implemented and verified.


## Preview implementation progress (2026-11-23)
- Added Pages Functions routes:
  - `functions/api/market.js`: adapted live price scraping and daily history persistence to the Staging-only `market_history_state` table.
  - `functions/api/news.js`: adapted the existing news feed handler to the Pages runtime.
  - `functions/api/public-config.js`: emits only the Staging Supabase URL and publishable key; rejects non-Staging URLs.
  - `functions/api/listings-gateway.js`: transitional gateway to the existing HTTPS Vercel listings API, with strict host/path validation and optional Vercel protection bypass secret.
- Verified the Staging project contains `public.market_history_state` with one existing history record. The table is RLS-enabled and documented as service-role-only.
- No Supabase schema or data was changed during this implementation.
- These functions require Cloudflare Pages runtime variables/secrets before they can work:
  - Plain text: `SUPABASE_URL` (must equal `https://qijahxokldkaqmjinfvy.supabase.co`), `SUPABASE_PUBLISHABLE_KEY`, `ZARINMAH_BACKEND_API_URL` (HTTPS Vercel `/api/listings` endpoint).
  - Encrypted secret: `SUPABASE_SERVICE_ROLE_KEY` (Staging project only), optional `ZARINMAH_BACKEND_PROTECTION_BYPASS`.
- Do not set these variables to Production Supabase values. Do not place secret values in GitHub files, commits, browser config, or chat.
- Next: inspect the new Pages deployment/build logs, configure the Staging-only runtime variables in Cloudflare, then test `/api/market`, `/api/news`, `/api/public-config.js`, and `/api/listings-gateway` before any broader rollout.
- Listings currently use a temporary gateway to the existing Vercel backend; this is not yet a full backend migration to Cloudflare.
