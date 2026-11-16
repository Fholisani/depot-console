# Accessing the Depot Console

The Console is a web app served at **https://fmash.online/depot-console/**. It runs in two slots
(blue/green). One is *active* (live) and the other is *passive* (for testing a new release before it
is promoted). Both slots share the same address; which one you get depends on a cookie or header.

## Quick reference

| I want to | Use |
|---|---|
| Use the live Console | https://fmash.online/depot-console/ |
| Test the passive (new release) Console | https://fmash.online/depot-console/?slot=passive |
| Go back to the live Console | https://fmash.online/depot-console/?slot=active, or the "Back to active" button on the passive banner |
| Reach the Depot API from a script | https://fmash.online/depot/ (add `X-Slot: Passive` for the passive slot) |

## Active Console (live)

Open https://fmash.online/depot-console/. No cookie or parameter is needed.

## Passive Console (testing)

Open https://fmash.online/depot-console/?slot=passive.

What happens:

1. Before the app starts, it reads `?slot=passive` and sets the cookie `depot_passive=always`
   (`src/app/core/slot/slot.service.ts`), then reloads.
2. nginx sees the cookie and serves the page from the passive Console (a canary Ingress on the
   cookie `depot_passive`; nginx only routes to the canary when the value is `always`).
3. From then on every Depot API call from the Console carries the header `X-Slot: Passive`
   (`src/app/core/http/depot.interceptor.ts`), so the whole session runs against the passive API.
4. A banner shows "You are on the passive (test) slot." with a "Back to active" button.

The cookie stays until you clear it, so later visits to https://fmash.online/depot-console/ keep
landing on the passive slot. Use `?slot=active` or the banner button to leave passive mode.

Links copied from the passive slot carry `?slot=passive`, so they open on the passive slot for
whoever follows them.

### Passive data

The passive slot uses its own data scope: a separate database schema, buckets, topics and database
user (see `prod/depot/values.yaml` in the deployment repo). Objects and tenants created on one slot
are not expected to appear on the other. This has not been tested end to end.

## Signing in

Sign-in goes through Keycloak (realm `depot`, client `depot-console`, authorization code with PKCE)
at https://fmash.online/auth/realms/depot.

New users: open `/depot-console/signup`, create an account, and open the verification link that is
emailed to you. Users who belong to several tenants are asked to choose one; the Console then sends
it as `X-Depot-Tenant`.

## Calling the API directly (curl, scripts)

Browsers get the slot from the cookie. Scripts cannot use the Console, so use the header on the
public host:

```bash
# active
curl https://fmash.online/depot/<path>

# passive
curl -H "X-Slot: Passive" https://fmash.online/depot/<path>
```

On the public host (nginx), the passive API route is selected by the header `X-Slot: Passive` or by
the cookie `depot_passive=always` (the same cookie the passive Console sets), so `<img>`, `<video>` and
download links on the passive Console, which cannot add a header, also reach the passive API. The
cookie `depot_passive=1` is only honoured by the Istio gateway, which is LAN-only.

## Local development

See the README: run the API on port 18080, then `npm ci && npm start` and open
http://localhost:4200/depot-console/. Sign-in still uses the real Keycloak.

## Where the routing is defined

| What | Where |
|---|---|
| Console Ingresses (active, passive canary) | deployment repo, `prod/depot-console/templates/ingress.yaml` |
| API Ingresses and Istio routing | deployment repo, `prod/depot/templates/ingress.yaml`, `istio-virtualservice.yaml` |
| Which slot is active | `blueGreen.activeSlot` in each chart's `values.yaml` (currently `blue`) |
| Passive cookie and `?slot=` handling | `src/app/core/slot/slot.service.ts`, `src/main.ts` |
| Promote passive to active | `prod/depot-console/release/promote.sh` in the deployment repo |
