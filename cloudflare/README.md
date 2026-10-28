# DealFlow hosted mock order API

Cloudflare Worker with one SQLite-backed Durable Object. This is independent of the static demo and the local Node API. Use a **Workers Free** account only; never upgrade it for this demo.

Deployed base URL: https://dealflow-order-api.dealflow-salesforce-discount-approval-engine.workers.dev

Health: https://dealflow-order-api.dealflow-salesforce-discount-approval-engine.workers.dev/health

Verified 28 October 2026: health 200, missing key 401, one synthetic order 201, identical replay 200 with the same order ID, changed payload 409. Three authenticated requests were used for this deployment check. The API key is stored as a Cloudflare Worker secret and in the ignored local `.tools/cloudflare-demo-key.txt` file for Salesforce credential setup.

## Caps and cost boundary

- Maximum **250 authenticated requests per UTC day**, including retries, inspection and invalid authenticated payloads. Returns HTTP 429 afterwards. The counter persists across restarts and deployments.
- Maximum **1,000 orders** over the life of this store. Returns HTTP 507 for new orders afterwards. Existing orders and their idempotency keys are retained; no automatic deletion that could permit duplicates.
- Maximum 32 KiB per POST, 50 lines per order. Inspection returns only the latest 25 orders. No timers, cron jobs, polling, logs, analytics bindings or paid services.
- `/health`, failed authentication, and rejected requests still consume Cloudflare Worker requests. Application caps **cannot guarantee a 50% cutoff for account-wide provider quotas**. Other apps share quotas. On the Free plan, exhausted free operations fail; do not switch to the paid plan.
- Free-plan documentation: https://developers.cloudflare.com/durable-objects/platform/pricing/

## Deployment

```powershell
npm ci
npm run test:worker
npx wrangler login --scopes account:read user:read workers:write workers_scripts:write
# Confirm Workers Free in the Cloudflare dashboard before deployment.
npx wrangler deploy --config cloudflare/wrangler.jsonc
npx wrangler secret put MOCK_API_TOKEN --config cloudflare/wrangler.jsonc
```

Enter a demo-only API key in the secret prompt. Never commit it, save it as a plain Worker variable, or include it in the public website. The API fails closed until configured. Use the resulting `https://dealflow-order-api.<subdomain>.workers.dev` base URL in the Salesforce Named Credential **without `/orders`**. Set the credential's `X-API-Key` header through its External Credential secret.

An initial deployment may require choosing a free `workers.dev` subdomain. No custom domain or payment is required. Real customer data is outside this mock's scope.

## Contract and persistence

`GET /health` is public. `GET /orders` and `POST /orders` require `X-API-Key`. POST requires `Idempotency-Key` equal to `quoteId`, with the same JSON contract as the local Node API. First creation returns 201; an identical replay returns 200 and the original ID; changed bytes for an existing key return 409. SHA-256 fingerprints use original request bytes. SQLite transactions commit the unique key and order together, avoiding a check-then-create race.

The hosted variant intentionally omits public failure-injection headers. Local tests still demonstrate lost acknowledgements. Retry a hosted POST with the same bytes and key after any uncertain response.

## GitHub deployment

The manual `Deploy DealFlow Worker` workflow uses GitHub Environment `cloudflare-free`. Configure `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` there, with a token restricted to this account and Workers deployment. Store `MOCK_API_TOKEN` directly in Cloudflare first; this workflow does not rotate it. Add an environment reviewer if desired. The workflow never buys or upgrades a plan. Confirm the account is still Free before each deployment.

## Local verification

`npm run test:worker` runs the actual local Worker runtime, without consuming hosted quotas, checking authentication, concurrent duplicate prevention, conflicts, persistence after restart, and the daily cutoff.
