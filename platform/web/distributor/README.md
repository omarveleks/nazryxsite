# Distributor side (not deployed)

The distributor portal (search, market, competitors, portfolio, sourcing requests, expert questions, company pages and
exports) is paused: the portal runs the manufacturer side only. Its code is kept here, outside `app/`, so Next.js does
not build or serve it and it adds nothing to the live app. `tsconfig.json` excludes this folder.

The database side is untouched: tables, functions and data for distributors stay as they are.

To bring it back:

1. Move the folders back: `distributor/app/*` to `app/`, `distributor/components/*` to `components/`,
   `distributor/actions/onboarding.ts` to `app/actions/`,
   `distributor/app/admin/requests` to `app/admin/requests`, and `distributor/e2e/smoke-with-distributor.mjs` over `e2e/smoke.mjs`.
2. Remove `"distributor"` from `exclude` in `tsconfig.json`.
3. Restore the distributor choice on sign-up (`app/signup/page.tsx`, `app/actions/auth.ts`), the distributor menu and
   the Distributor | Manufacturer switch (`components/NavLinks.tsx`), the country picker and sourcing list in
   `components/Shell.tsx`, the routing in `lib/auth.ts` (`requireUser`) and `app/page.tsx`, and the Claims, Requests and
   Questions tabs in Admin. `git log` on this folder shows the commit that paused it, with every line it changed.
