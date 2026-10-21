# Design and tradeoffs

## Objects and responsibilities

| Component | Responsibility |
| --- | --- |
| `Discount_Request__c` | Quote header, effective discount, immutable version identity, policy snapshot, approval state |
| `Quote_Line__c` | Product, quantity, price, discount, and rounded line total snapshot; master-detail to header |
| `Quote_Family__c` | Serializes version-number allocation without updating a locked approved quote |
| `Discount_Rule__mdt` | Active discount intervals and their route outcomes |
| `DealFlow_Product__mdt` | Small deployable product catalog used for server pricing |
| `Order_Dispatch__c` | Unique quote key, immutable JSON delivery snapshot, attempts, error, and external order ID |

The header retains its original discount-engine API name to keep the learning progression readable. It is a custom quote object rather than Salesforce's standard Quote object or a CPQ package.

## Pricing and routing

The browser's totals are previews. Apex accepts product codes, quantities, and requested discounts; it queries active catalog metadata and ignores any client-supplied price. Each line net is rounded to two decimals, then summed. The exact savings are stored as `Discount_Value__c`, so header net matches line totals.

The weighted quote discount is `(gross - net) / gross × 100`, rounded **up** to two decimal places for policy evaluation. This is a conservative business choice, documented in the UI and README. The policy is quote-wide; it does not independently cap each line's discount.

Intervals use an exclusive lower bound and inclusive upper bound, with a special case for zero. Exactly one active rule must match. Multiple matches or no match cause a controlled error. The engine does not pick an arbitrary first rule. Changes to metadata affect subsequent submissions, while existing approved snapshots remain unchanged. The stored rule developer name is an audit hint, not a complete historical copy of the metadata configuration.

## Approval ownership

`DiscountSubmitAction` locks requested headers, reads them with user-mode access checks, and verifies ownership and Draft status. It resolves an active approver from the owner's manager hierarchy and shares the record for reading with that user. A Savepoint makes routing-field updates, shares, approval submission, and resulting outbox work atomic on a submission failure.

Native Salesforce approvals control work items, record locking, approval history, and final status updates. Director routing is a **single approval assigned to the manager's manager**, not sequential manager-then-director approval. The optional Screen Flow provides confirmation and failure screens; it does not reimplement the approval engine.

## Versioning

Approved records and their line snapshots are not edited. A revision is a new record in the same family with a predecessor link and Draft status. A lock on the separate family row serializes the next version number. A unique `Version_Key__c` is a second guard against duplicate version allocation.

Revision prices come from the current catalog. The LWC asks the rep to choose the replacement version's lines explicitly; it does not assume old catalog prices remain valid. Repeated revisions from one source receive increasing family-wide version numbers. Pending/rejected records cannot be used as the approved source for a revision.

An approved revision creates its own external order. Order amendments, replacement orders, and cancellation of the previous order would require a separate business contract and are outside this project.

## Durable delivery and duplicates

Approval transitions synchronously stage one dispatch, protected by a unique quote-record key. The payload snapshots the approved version's customer, currency, and line values. A Queueable sends the snapshot after the Salesforce transaction commits.

The receiver must atomically associate `Idempotency-Key` with an order and its payload fingerprint. If an order commits but its response is lost, the next request has the same key and bytes and gets the existing order ID. A changed payload under the old key returns HTTP 409. A new quote version has a new record ID and therefore a new delivery key.

This is **at-least-once delivery**, not a claim that a network request can run exactly once. Duplicate workers may send the same request concurrently; the external system is the final duplicate boundary. Salesforce re-reads dispatch rows after callouts before updating them, so a late failure does not overwrite an already committed success. Locks are not held as a duplicate guarantee across a callout.

The job processes at most twenty callouts before its DML and chains a remaining batch. Operations retries are manual, limited to Retryable records with fewer than five recorded attempts and still-approved quotes. HTTP 408, 429, 5xx, transport errors, and malformed success responses are retryable. Other HTTP errors and exhausted retries need investigation. Error logs omit response bodies to reduce accidental disclosure.

Hard worker failures or platform limits can leave a Queued dispatch without a completed attempt record. The current recovery UI targets recorded Retryable failures; a production design should add stale-job reconciliation, monitoring, backoff, and operator replay controls. High-volume approval bursts also need a scheduled/central outbox drainer rather than relying on per-transaction Queueable capacity. These are intentional scale limits, not claims of production readiness.

## Access boundary

The sales service deliberately performs a small amount of system-mode DML after checking a custom permission, ownership, and valid inputs. This allows permission sets to grant read access while denying general direct quote mutation. User-mode queries enforce field/object permissions on returned data. Operations mutations require their own custom permission. Native approval authorization controls review decisions.

System administrators and unrelated privileged automation remain trusted administrators. Permission sets cannot remove privileges granted by other profiles or sets. The legacy `DealFlow_User` permission set exists for the early discount-only exercise and is not part of the three-role quote application. Assess role behavior using low-privilege base profiles, not administrator users.

## Why a small catalog and mock API?

Custom Metadata makes this sample self-contained and repeatable. A larger catalog would use Product2, price books, currencies, and a governed pricing model. The HTTP mock uses serialized writes and atomic file replacement within one server process. A production receiver should use a transactional database with a unique idempotency constraint, durable backups, retention rules, and reconciliation.
