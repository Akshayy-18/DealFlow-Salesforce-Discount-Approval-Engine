# Learn DealFlow: from a sales rule to a reliable order

## What you should be able to explain

After working through this guide, explain how a quote is priced on the server, how a configurable rule chooses an approver, how Salesforce owns the approval decision, why revisions need new approval, and how a retry avoids a duplicate external order.

Do not memorize class names as a substitute for understanding the business scenario. Run a happy path, break it deliberately, and explain the resulting records.

## 1. Start with the business story

A sales rep wants to offer a customer a discount. Small discounts are pre-authorized. Larger discounts need a manager or director. Once the quote is approved, Operations expects an order in another system. If the price changes later, the approved commitment must remain auditable.

Open the browser demo. Try 3%, 12%, 20%, and 30%. Note who can decide each request and whether an order is created. Switch roles using the teaching control; real Salesforce roles are enforced by permissions and approval work items, not a dropdown.

**Checkpoint:** Why does rejecting a quote never create an order? Why does a 30% quote stay unsubmitted?

## 2. Read the data model

Read [DESIGN.md](DESIGN.md), then inspect the object metadata under `force-app/main/default/objects`.

The quote header is `Discount_Request__c`. Its lines are `Quote_Line__c`. A family links versions. Dispatch records track delivery attempts separately from quote approval status. This separation matters: a quote can be **Approved** while its order delivery is **Retryable**.

Draw these relationships yourself:

```text
Quote Family → Quote v1 → Product lines
             → Quote v2 → Product lines
                    ↓
              Order Dispatch → External order
```

**Exercise:** Identify which ID is stable for a family, which identifies one approved version, and which should be sent as the external idempotency key.

## 3. Understand server-side pricing

Read `DealFlowQuoteController.createQuote`. The inputs contain customer, SKU, quantity, and requested discount. Apex re-reads active catalog records and obtains prices from the server. A manipulated JavaScript payload cannot choose a cheaper unit price.

For each line:

```text
gross = catalog price × quantity
net = round(gross × (1 - discount / 100), 2)
```

The quote adds line gross and net amounts. The weighted discount describes the total quote savings, rather than an average of the percentages.

**Worked example:** Two Sales Starter units cost ₹24,000 gross at a 5% discount, giving ₹22,800 net. One Support Plus unit costs ₹6,000 at 20%, giving ₹4,800 net. Quote gross is ₹30,000, net is ₹27,600, and weighted discount is **8%**. That requires manager review under the default policy.

The routing percentage rounds upward to two decimals. The exact net remains the sum of rounded line nets. Explain why the project stores exact savings separately instead of recalculating invoice net from the rounded routing percentage.

**Exercise:** Try unequal line values with different discounts. Compare a simple average of discount percentages to the actual weighted result.

## 4. Understand Custom Metadata

Read the `Discount_Rule__mdt` fields and the four sample records under `customMetadata`.

Custom Metadata is deployable configuration. It lets administrators change business thresholds without editing an Apex `if` statement for every boundary. The engine still validates the configuration: moving business rules into data does not make invalid data safe.

Read `DiscountEngine.evaluate`. Its interval convention is `(minimum, maximum]`, except zero is included in the zero-start rule. Thus 5% is Auto, while 5.01% is Manager.

**Exercise:** In a non-production org, change the auto upper limit to 8 and the manager lower limit to 8. Submit a new 7% quote. Then create an overlap deliberately and confirm submission fails. Restore the configuration afterward.

**Checkpoint:** Why is “pick the first matching record” a bad policy for pricing approvals?

## 5. Trace submission and native approvals

Read `DiscountSubmitAction.submit` and `DealFlow_Discount_Approval.approvalProcess-meta.xml`.

Follow this order:

1. Lock and read all requested headers with user-mode access checks.
2. Confirm the current user owns a Draft request.
3. Evaluate metadata and resolve an active approver from the owner's hierarchy.
4. Store the rule/route snapshot and share the record for reading.
5. Submit to Salesforce's native approval process or auto-approve under policy.
6. Roll back routing and submission changes if a submission operation fails.

Native approvals create the work item and control who can approve/reject it. The final workflow field update changes the status. The lifecycle trigger reacts to a transition into Approved.

The director band goes directly to the manager's manager. It is not a two-step approval chain. Be precise about this in interviews.

**Exercise:** Remove the request owner's manager, submit a manager-band quote, and inspect the error. Restore the hierarchy. Explain why routing to the submitting user as a fallback would be unsafe.

## 6. Understand versioning and concurrency

Read the revision branch in `createQuote`, the `Quote_Family__c` metadata, and both guard triggers.

An approved quote is a promise at a particular price. Updating its lines would erase what the manager actually approved. A revision therefore creates a new header and lines, references its predecessor, and starts in Draft.

The family row is locked while allocating a version number. Why not store the next number directly on the original approved header? Native approval can lock that header. The separate family avoids changing the approved record to manage bookkeeping.

**Exercise:** Create two revisions from the same approved version. Confirm their numbers are unique and increasing, while the source quote remains unchanged. Submit a new version at a higher discount and confirm that approval is required again.

## 7. Understand the outbox and the callout

Read `DealFlowOrderService.stage` and `DealFlowOrderJob.execute`.

The approval transaction creates a durable **Order Dispatch** with its exact payload. The Queueable runs after commit. This avoids calling the remote API while the quote's approval transaction is incomplete.

The worker performs its HTTP requests before DML. It calls a Named Credential rather than hardcoding endpoint authentication. It stores only safe error summaries. Operations can retry transient failures, while bad requests and exhausted attempts need investigation.

**Checkpoint:** Why does having separate approval and delivery statuses make recovery easier? What happens if the Named Credential is missing?

## 8. Learn the duplicate problem properly

Use the browser demo's **create order, lose acknowledgement** option. The mock order exists, but Salesforce's simulated delivery does not know its ID. Retry as Operations with Success selected. The order count must not increase.

The guarantee requires both sides:

- Salesforce keeps a stable key and immutable request bytes for one quote version.
- The receiver atomically stores that key and returns the original result on replay.

Read the HTTP mock's transaction queue and fingerprint checks. A unique Salesforce dispatch alone cannot stop a remote system from creating duplicates after a timeout. “At least once with an idempotent receiver” is the accurate description.

**Exercise:** Run `npm test` and locate the concurrent-request, lost-acknowledgement, changed-payload, and restart tests. Explain how each test attacks a different failure mode.

## 9. Understand role boundaries

Read the three application permission sets, the custom permissions, and the authorization checks in both controllers.

Sales users can invoke quote creation/submission. Managers decide native work items assigned to them. Operations can inspect dispatches and request retries. The quote service performs narrowly scoped system-mode mutations after explicit checks; it does not rely on the UI to enforce ownership.

Permissions are additive. Assigning a broad administrator profile does not test a restrictive sales role. The Apex tests use controlled permission assignments to exercise service behavior, but a real org should also verify field visibility and record sharing using low-privilege profiles. System administrators remain trusted administrators.

**Exercise:** Try calling the sales method as a user without the sales custom permission, then the retry method without operations permission. Record the expected errors. Do not remove production permissions to run an exercise.

## 10. Read tests and delivery checks

Run the local tests and metadata integrity checker. Read the four Apex test classes, then run the documented Salesforce dry-run against a Developer org. Local JavaScript tests are not substitutes for Apex compilation or native approval tests.

The Actions workflow always runs local checks. Salesforce validation runs only when its org secret is configured. Deployment is a separate manual workflow. Never describe a green local job as proof of an org deployment.

## Interview questions to practice

1. Why did you choose Custom Metadata instead of hardcoded discount thresholds?
2. What happens when two rules overlap or no rule matches?
3. How do you prevent the browser from choosing its own price or approver?
4. What owns the approval decision, and how is the approver chosen?
5. Why do you create a new quote version instead of editing the approved one?
6. How do concurrent revisions get unique version numbers?
7. Why use a durable outbox and Queueable Apex?
8. What if the external order was created but the response timed out?
9. Where is the final duplicate boundary, and what must the external API guarantee?
10. Which failures are retryable? Why do retries have a limit?
11. What changes would you make for hundreds of approvals in a short burst?
12. What is deliberately outside scope, and what would you add before production?

## A truthful two-minute project explanation

“I built a custom Salesforce quote-to-order application. The LWC collects product lines, while Apex prices them from a deployable catalog and evaluates the weighted discount against Custom Metadata. Small discounts auto-approve; higher discounts enter native Salesforce approvals assigned through the owner's manager hierarchy. Approved quotes are immutable, so changes create a new Draft version that needs fresh approval. Approval stages a durable order snapshot, then Queueable Apex sends it to a mock API through a Named Credential. The API enforces an idempotency key so a retry after a lost response returns the same order. Separate permission sets cover sales, approvers, and operations. I tested policy boundaries, native approvals, versioning, and recovery, and documented the remaining production-scale limits.”

Use this explanation only after you can demonstrate and explain the code yourself. Cite the actual validation results in `VALIDATION.md`; do not invent employer usage, revenue impact, or performance improvements.
