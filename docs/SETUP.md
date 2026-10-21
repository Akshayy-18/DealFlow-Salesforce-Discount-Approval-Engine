# DealFlow setup

## 1. Choose what to run

| Experience | Requirements | What it connects to |
| --- | --- | --- |
| Offline demo | A modern browser | Nothing; open `demo/standalone.html` |
| Local demo website | Node.js 20+ | Browser memory only |
| Local order API | Node.js 20+ | `.data/orders.json` on disk |
| Salesforce application | Developer Edition or scratch org, Salesforce CLI | Native Salesforce records and approvals |
| Salesforce → order API | Above plus a reachable HTTPS API and Named Credential | Real HTTP requests to the mock service |

The website and standalone API are separate teaching surfaces. The website simulates delivery in memory; it does not silently send your sample quotes to the API.

## 2. Run the website

From the project directory:

```bash
npm run dev
```

Open `http://127.0.0.1:4173`. Keep the terminal running. If port 4173 is occupied, stop the earlier project server or set `PORT` to another port before starting. Refreshing the page restores the seeded demo; Reset demo also restores the default policy.

For an offline copy, open `demo/standalone.html`. Rebuild it after editing the demo source:

```bash
python tools/build_standalone.py
```

## 3. Run the standalone order API

In a separate terminal:

```bash
npm run mock-api
```

It listens on `http://127.0.0.1:4180`. `GET /health` confirms readiness. By default it is local-only and unauthenticated. Set `MOCK_API_TOKEN` to require an `X-API-Key` header. Binding to a non-loopback interface requires that token. Do not commit tokens or runtime order data.

The API stores order and idempotency history in `.data/orders.json`. Keep that file if you restart the API and want replay protection to survive. A damaged store causes startup to fail rather than silently erasing history. Run a single server process against a given store directory. This is an educational persistence implementation, not a distributed database.

## 4. Connect Salesforce

Install Salesforce's official CLI and run:

```bash
sf org login web --alias DealFlow
```

For a My Domain org, supply its login domain:

```bash
sf org login web --alias DealFlow --instance-url https://YOUR-DOMAIN.my.salesforce.com --browser edge
```

Sign in and approve the CLI in your regular browser. The browser must be able to reach the local CLI callback. If an embedded browser blocks localhost, use Edge or Chrome for authorization. Do not put passwords, access tokens, or refresh tokens in this repository.

Check the connection without printing authentication secrets:

```bash
sf org list
```

## 5. Validate and deploy

Validate without saving changes:

```bash
sf project deploy start --dry-run --target-org DealFlow --source-dir force-app --test-level RunSpecifiedTests --tests DiscountEngineTest --tests DiscountSubmitActionTest --tests DealFlowQuoteControllerTest --tests DealFlowOrderTest --wait 30
```

Deploy the same source when ready:

```bash
sf project deploy start --target-org DealFlow --source-dir force-app --test-level RunSpecifiedTests --tests DiscountEngineTest --tests DiscountSubmitActionTest --tests DealFlowQuoteControllerTest --tests DealFlowOrderTest --wait 30
```

This project was validated using API version 65.0 and CLI 2.154.4. A successful dry-run compiles the metadata and executes tests but rolls back the deployment. It does not install the application or configure live integration credentials.

## 6. Assign roles

Assign each permission set to the intended user, not every set to every user:

```bash
sf org assign permset --name DealFlow_Sales_Rep --on-behalf-of SALES_USERNAME --target-org DealFlow
sf org assign permset --name DealFlow_Manager --on-behalf-of MANAGER_USERNAME --target-org DealFlow
sf org assign permset --name DealFlow_Operations --on-behalf-of OPERATIONS_USERNAME --target-org DealFlow
```

| Role | Intended access |
| --- | --- |
| Sales Rep | Create new quote versions and submit owned Drafts through the controlled Apex service; read accessible quotes and lines |
| Manager | Read explicitly shared review records; approve/reject assigned native approval work items |
| Operations | Read all quote and dispatch records; invoke controlled retries; cannot create quotes through the sales service |

The `DealFlow_User` permission set is retained for the initial discount-only learning exercise. Do **not** assign it alongside the three-role application; it grants direct header editing that the quote-builder model intentionally avoids. Salesforce permissions are additive: another profile or permission set can broaden access. Use low-privilege base profiles to review real role behavior.

Set the Sales Rep user's **Manager** to an active manager. Set that manager's **Manager** to the active director approver. A manager-tier quote needs only the first manager; a director-tier quote requires both. The engine rejects missing/inactive approvers and an approver equal to the request owner.

Developer Edition license limits may prevent having separate live users for every role. Apex tests construct their own test users without requiring a permanent demo team. For a live walkthrough, use the available licensed users or an appropriately configured scratch org.

## 7. Add the Lightning pages

1. In Setup → Lightning App Builder, create an App Page named **DealFlow Quotes**.
2. Add the **DealFlow Quote Builder** component. Save and activate it for the intended sales users.
3. Create a second App Page, **DealFlow Operations**, with **DealFlow Order Recovery**. Activate it for operations users.
4. In App Manager, edit the DealFlow app and add these pages to navigation. Grant the intended profiles access to the app if it is not visible in App Launcher.
5. For managers, add the standard **Items to Approve** component to their Home page. Native Salesforce approval work items—not a custom approval endpoint—own their decisions.
6. In the Discount Request page layout, add the **Approval History** related list through the layout editor and assign the layout to the intended profiles. The repository layout is a minimal installable starting point.

The Screen Flow is optional: add **Submit Discount Request** to a record page and pass its `recordId` input. The LWC's Submit action calls the same Apex submission service directly. Both routes evaluate rules on the server.

## 8. Configure the real callout

Salesforce runs remotely; `localhost:4180` points to the Salesforce environment, not your laptop. For a live integration demo, expose or deploy the mock API to a reachable HTTPS endpoint. Hosting is intentionally not configured by this local project.

In Setup:

1. Create an External Credential using an authentication mechanism appropriate for your demo endpoint. For an API-key endpoint, use Salesforce's custom authentication configuration and a named principal.
2. Store the mock token as a credential authentication parameter. Configure the credential to send it in the `X-API-Key` header. Do not add the secret to metadata or Apex.
3. Create a modern Named Credential whose developer name is **`DealFlow_Order_API`**, using the HTTPS API **base URL**, without `/orders`.
4. Associate the External Credential and grant its principal access to the users whose transactions enqueue order jobs. Auto-approvals run from the sales user's submission; manual approvals originate from the approver's transaction; retries originate from Operations.
5. Verify a sample approved quote produces a Succeeded dispatch and an external order ID. A missing endpoint or credential results in a Retryable dispatch with a safe error summary.

Queueable Apex calls `callout:DealFlow_Order_API/orders`. Named Credentials, external principals, tokens, and public endpoint deployment are environment-specific and are not prepopulated here.

## 9. Configure GitHub Actions later

Local CI needs no secrets. For Salesforce validation, configure repository secret **`SF_AUTH_URL_DEV`** using an SFDX authorization URL for a dedicated Developer org. That URL contains a refresh token: enter it directly in GitHub's secret settings, never in source, issue comments, or chat. Prefer a dedicated integration identity and rotate/revoke its authorization when appropriate.

The CI workflow reports explicitly when the secret is absent. A green local job alone is not evidence that Salesforce validation ran. Manual deployment uses the `salesforce-dev` GitHub Environment; configure reviewers there if desired. No secret or environment has been created by the local build.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Browser shows old Forbidden page | Refresh after restarting the corrected preview server |
| Cannot submit | Record must be Draft and owned by the current user; check sales permission and rule coverage |
| Missing manager error | Check active manager hierarchy on the request owner |
| No approval work item | Discounts at or below the auto limit bypass manual approval; above-policy discounts are blocked |
| Retryable order | Check endpoint reachability, Named Credential principal access, and mock API health |
| Needs Attention | Inspect HTTP error class or five-attempt limit; do not create a new idempotency key to hide the failure |
| Changes don't affect old quotes | Expected: approved snapshots and existing dispatch payloads do not change |
| GitHub push 403 | Authenticate an account with write access; the repository URL alone does not grant permission |
