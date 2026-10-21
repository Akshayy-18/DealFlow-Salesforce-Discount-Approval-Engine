# Validation status

Updated: **21 October 2026**.

| Check | Result |
| --- | --- |
| Local policy, workflow, and real mock HTTP API tests | **28 passed, 0 failed** |
| Salesforce metadata source conversion | **Passed** |
| Salesforce deployment dry-run with specified project tests | **Succeeded** |
| Apex tests executed during dry-run | **16 passed, 0 failed** |
| Actual Salesforce deployment | **Not performed**; validation was check-only |
| Live callout from Salesforce to a hosted mock API | **Not performed**; reachable endpoint and Named Credential still need configuration |
| Public demo hosting | **Not performed**; local website and standalone HTML provided |
| GitHub push | **Paused at user's request**; local checkpoint exists |
| GitHub Actions execution | **Not run**; workflows are supplied locally |

The successful Salesforce check-only deployment ID is `0AfdL00000hYrHFSA0`. Tests included `DiscountEngineTest`, `DiscountSubmitActionTest`, `DealFlowQuoteControllerTest`, and `DealFlowOrderTest`. The dry-run succeeded with the required selected-component coverage checks. No numeric coverage percentage is claimed here without its detailed per-component report.

Local HTTP tests verify concurrent requests produce one order, a lost acknowledgement replays the same order, changed payloads conflict, new quote versions get new orders, transient outages recover, authentication/arithmetic are checked, and idempotency history survives restart.

The local web server was checked to return HTTP 200, and the app browser loaded the quote builder, rule preview, review workspace, and order-recovery controls. The standalone HTML build contains the same source inline for file-based use. Browser role switching is a simulation, not authentication.

## Reproduce

```bash
npm test
python tools/check_metadata.py
python tools/build_standalone.py
sf project deploy start --dry-run --target-org DealFlow --source-dir force-app --test-level RunSpecifiedTests --tests DiscountEngineTest --tests DiscountSubmitActionTest --tests DealFlowQuoteControllerTest --tests DealFlowOrderTest --wait 30
```

Later changes require fresh checks appropriate to the changed code. Environment setup and org deployment are documented in [SETUP.md](SETUP.md).
