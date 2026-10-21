# Mock order API contract

Start with `npm run mock-api`. Default base URL: `http://127.0.0.1:4180`.

## Endpoints

| Method / path | Purpose |
| --- | --- |
| `GET /health` | Public readiness response; does not expose order data |
| `POST /orders` | Create or replay an order using an idempotency key |
| `GET /orders` | Inspect stored sample orders; requires API key if configured |

When `MOCK_API_TOKEN` is set, send `X-API-Key` for `/orders`. The health endpoint stays public. Do not expose a real customer's data through this demo service.

## Request

```http
POST /orders
Content-Type: application/json
Idempotency-Key: quote-version-1
X-API-Key: your-configured-demo-key
```

```json
{
  "quoteId": "quote-version-1",
  "version": 1,
  "customer": "Synthetic Customer",
  "currency": "INR",
  "gross": 12000,
  "net": 10800,
  "lines": [
    {"sku": "DF-START", "quantity": 1, "unitPrice": 12000, "discount": 10, "net": 10800}
  ]
}
```

The key must equal `quoteId`. Salesforce uses the approved quote version's record ID. Up to fifty lines and a 32 KB body are supported. Quantities are positive integers; unit prices are positive; discounts are 0–100; net totals must agree with calculated line totals. This sample is not an independently authoritative product-pricing service: it validates arithmetic and trusts the authenticated caller's approved prices.

## Responses

New order:

```json
{"orderId":"ORD-EXAMPLE","replayed":false}
```

HTTP **201** means a new order was persisted. HTTP **200** means the same key and identical request bytes were previously committed:

```json
{"orderId":"ORD-EXAMPLE","replayed":true}
```

| Status | Meaning | Salesforce behavior |
| --- | --- | --- |
| 400 | Invalid JSON or order contract | Needs Attention |
| 401 | Missing/incorrect configured API key | Needs Attention |
| 409 | Existing key used with different payload bytes | Needs Attention |
| 413 | Request exceeds supported body size | Needs Attention |
| 408 / 429 | Transient response classes | Retryable |
| 500 / 503 | Persistence error or simulated outage | Retryable |

The SHA-256 fingerprint uses exact request bytes. Reordering JSON properties counts as a different payload. This is why Salesforce stores and reuses the immutable JSON string rather than rebuilding it for a retry.

## Failure injection

For local tests, optionally send:

```http
X-Demo-Failure: before-commit
```

The API returns 503 before creating an order. With `after-commit`, it persists an order but returns 503 instead of its ID. A subsequent identical request without the injection header returns 200 and that same order ID. This models the business effect of a lost acknowledgement; it does not literally drop the TCP connection.

The Salesforce worker does not send this teaching-only header. For a live failure walkthrough, arrange the API outage or a controlled proxy response outside Salesforce. The local browser demo offers equivalent in-memory controls.

## Durability and concurrency

The server serializes creation inside a single process, writes a temporary JSON file, then atomically replaces the store before responding. Concurrent matching requests return one order ID. Restarting reads the same history. Do not run multiple writers against one directory: cross-process locking, distributed transactions, and backup/retention management are outside this sample.
