# Depot Console

The web app for Depot tenants: sign up, sign in, onboarding, namespaces, the object browser and API
keys. Angular 22 (standalone, signals, zoneless) with Ionic 9, signing in through Keycloak (realm
`depot`, client `depot-console`, authorization code with PKCE).

It runs on its own at `https://fmash.online/depot-console/`, like stokvel-admin. The Jenkins job
`depot-console` tests and builds it, publishes the nginx image `fholisani/depot-console:<tag>`
(`Dockerfile`, `nginx.conf`), and sets that tag in the deployment repo (`prod/depot-console`). The
Argo CD app `depot-console` then rolls it out.

## Requirements

Node 24 (Angular 22 needs `^22.22.3` or `^24.15`). With nvm: `nvm use 24`.

## Run locally

1. Start the Depot API on port 18080 (`depot/scripts/run-dev.sh`).
2. `npm ci && npm start`
3. Open `http://localhost:4200/depot-console/`. Calls to `/depot/...` are proxied to the local API
   (`proxy.conf.json`); sign-in uses the real Keycloak at `https://fmash.online/auth`.

## Runtime configuration

`public/config.json` is read before the app starts, so one build serves every slot and environment:

| key | meaning |
|---|---|
| `apiBase` | Base of the Depot API, `/depot` on the same origin |
| `auth.authority` | OIDC issuer, `https://fmash.online/auth/realms/depot` |
| `auth.clientId` | `depot-console` |

## Staying aligned with the backend

The API types in `src/app/core/api/schema.d.ts` are generated from Depot's OpenAPI contract, copied
to `contracts/depot.yaml`. Use them through `src/app/core/api/models.ts`; never hand-write a request
or response shape.

- `npm run contract:sync` copies the contract from `../depot` and regenerates the types.
- `npm run api:check` (run in CI) fails if the committed types do not match the contract.

Every JSON response uses the envelope `{data, errors, message}`. `DepotApi` returns `data`; failures
become an `ApiError` whose `reason` is the contract's stable error name (for example
`EMAIL_NOT_VERIFIED`, `INSUFFICIENT_ROLE`). Branch on `reason`, not on messages.

## Layout

```
src/app/core/config   runtime config (config.json)
src/app/core/api      contract types, typed client, error mapping
src/app/core/http     interceptor: Bearer token, X-Depot-Tenant, X-Slot (Depot API only)
src/app/core/slot     Active/Passive tester toggle (cookie depot_passive, header X-Slot)
src/app/core/tenant   selected tenant for users in several tenants
src/app/pages         one folder per page
```
