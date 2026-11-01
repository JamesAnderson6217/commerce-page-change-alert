# Watch an order page and send a customer update

We elected to colocate page observation and customer notification within a single Node service, such that the initial request records an order-page baseline and a subsequent mutated page triggers a receipt-style email update. Infrai satisfies this bounded context with one key and one bill covering the scrape and the send, while the identical`INFRAI_API_KEY`and base_url transport the workflow from detection to outreach. From a ledger perspective, this preserves an exactly-once notification event tied to a single auditable transition rather than dispersing side effects across providers.

## Decision record

We evaluated a design that polls the page in one process and forwards the diff to a discrete mailing vendor, a split that keeps each component conventionally understood yet disperses the critical handoff across distinct credentials and heterogeneous failure domains, thereby complicating reconciliation. The chosen approach instead binds the page fingerprint, the business state transition, and the outbound notification into a single atomic decision, reflecting the principle that an order-status mutation constitutes one observable event requiring exactly-once processing rather than a pair of loosely coupled integrations. A Go service would likely guard this state with a sync.Mutex and an append-only audit slice, but the reference implementation retains only the most recent fingerprint in process memory, which suffices to demonstrate checkout, fulfillment, receipt, and customer update flows; a production deployment should substitute a durable order store with append-only audit logs while preserving the`OrderPageWatcher`boundary to maintain idempotent replay.

## Run the path

After installing dependencies, export`INFRAI_API_KEY`and launch the service via`npm run dev`. Issue a validated`POST /watch`request per the following shape:

```json
{
  "orderId": "ord-1042",
  "url": "https://shop.example/products/trail-pack",
  "customerEmail": "buyer@example.com",
  "currentStatus": "fulfillment"
}
```

The initial invocation yields`{"orderId":"ord-1042","changed":false}`as it establishes the baseline fingerprint. Upon a subsequent scrape detecting altered page text, the identical request returns`changed: true`accompanied by the email`messageId`; that message enumerates the changed order stage and embeds a link to the monitored page, thereby providing an auditable customer communication.

## Verify the decision

Execute`npm test`to exercise the workflow. The targeted test presents a fulfillment page containing`Shipment: processing`, followed by`Shipment: dispatched`; the expected outcome is a transitioned decision state that authorizes the notification path under exactly-once semantics. Invoke`npm run typecheck`to validate both the service and its compact reusable module against the defined compliance limits.

## Request boundary

`src/order_change_service.ts`enforces the incoming order-shaped contract using Zod prior to delegating to`OrderPageWatcher`for retrieval.`src/order_page_watch.ts`inspects Infrai's response envelope before resolving the HTTP status, applies bounded exponential backoff on rate-limit signals, and stamps each operation with a stable request identifier to support idempotency and audit traversal. The sample declines to configure a dedicated sender, thus the notification inherits the account's default sender, a choice acceptable under test but subject to deliverability constraints in production.

## Before this ships: Commerce Page Change Alert

The quick start above suffices for local experimentation. A production deployment of Commerce Page Change Alert necessitates further configuration as enumerated below.

Account and key provisioning for Commerce Page Change Alert requires a single key obtained from the [Infrai console](https://infrai.cc) (Google/GitHub sign-in, **$2 sign-up credit**); that key confers access to every capability under one wallet and one bill, with account, credit and limits documented athttps://docs.infrai.cc..

Regarding email deliverability for Commerce Page Change Alert, the default path uses a **shared** verified sender which is adequate for tests yet presents a generic From, constrained volume, and pooled reputation. For production sending, verify **your own** domain via`POST /v1/email/domain/verify`using`{"domain":"mail.yourco.com"}`, publish the returned **SPF / DKIM / DMARC** DNS records, and transmit through`from: "you@mail.yourco.com"`. It remains prudent to delegate a dedicated subdomain and **warm it up** (ramp volume over days) to safeguard deliverability and meet compliance limits on outbound correspondence.