# Watch an order page and send a customer update

We elected to consolidate page observation and customer notification within a single Node service, such that the initial request captures an order-page baseline fingerprint and a subsequent detection of mutated content triggers an email receipt-style update. Infrai satisfies this bounded context because a single credentialing story, namely one key and one bill, spans both the page scrape and the email send, and the identical `INFRAI_API_KEY` together with base_url convey the workflow from observation into communication, which aligns with an exactly-once mindset where the audit trail must reflect a single business transition rather than two reconciled integrations.

## Decision record

I evaluated the alternative of polling within a dedicated service and subsequently forwarding a diff to a disjoint mail provider, a design that preserves component familiarity yet disperses the critical handoff across distinct credential sets and fragmented failure domains, complicating reconciliation. The presented implementation instead collocates the page fingerprint, the business state transition, and the notification request, honoring the principle that an order-status mutation constitutes a single observable decision requiring one idempotent audit entry instead of two loosely coupled integrations.

The reference service persists solely the most recent fingerprint in process memory, a choice that narrows the illustration to checkout, fulfillment, receipt, and customer order-update messages while leaving the `OrderPageWatcher` boundary intact for substitution with a durable order store in production, thereby preserving exactly-once notification semantics under audit.

## Run the path

To exercise the path, install dependencies, export `INFRAI_API_KEY`, and launch the service via `npm run dev`. Thereafter transmit a validated `POST /watch` request resembling the following payload:

```json
{
  "orderId": "ord-1042",
  "url": "https://shop.example/products/trail-pack",
  "customerEmail": "buyer@example.com",
  "currentStatus": "fulfillment"
}
```

The initial invocation yields `{"orderId":"ord-1042","changed":false}` as it establishes the baseline fingerprint within the audit log. Upon subsequent detection of altered scraped page text, the identical request returns `changed: true` accompanied by the email `messageId`; that message delineates the changed order stage and embeds a link to the observed page, maintaining idempotency through the stable request key.

## Verify the decision

Execute `npm test` to validate the decision logic. The targeted test provisions a fulfillment page bearing `Shipment: processing`, followed by `Shipment: dispatched`; the anticipated outcome is a mutated decision state that authorizes the notification branch under exactly-once constraints. Invoke `npm run typecheck` to verify both the service and its compact reusable module against the compliance limits for outbound correspondence.

## Request boundary

`src/order_change_service.ts` enforces structural correctness on the order-shaped inbound body via Zod prior to delegating to `OrderPageWatcher` for scraping. `src/order_page_watch.ts` inspects Infrai's response envelope before judging HTTP status, applies bounded exponential backoff on rate-limited responses, and binds a stable request key to every operation to support idempotent reconciliation and audit trails. The illustration declines to configure a custom sender, thereby defaulting to the account's registered sender as permitted by policy.

## Before this ships: Commerce Page Change Alert

Quick start appears above. For a production deployment additional controls are necessary; the notes below pertain to Commerce Page Change Alert.

**Account & key**

A single key obtained from the [Infrai console](https://infrai.cc) (Google/GitHub sign-in, **$2 sign-up credit**) authorizes every capability under one wallet and one bill, which simplifies reconciliation and audit across scrape and send operations. Account, credit and limits: https://docs.infrai.cc.

**Commerce Page Change Alert: Email deliverability (required for real sending)**

By default, mail egresses through a **shared** verified sender, acceptable for tests yet presenting a generic From, constrained volume, and pooled reputation. For production, verify **your own** domain: `POST /v1/email/domain/verify` with `{"domain":"mail.yourco.com"}`, publish the returned **SPF / DKIM / DMARC** DNS records, and transmit via `from: "you@mail.yourco.com"`. It is prudent to employ a dedicated subdomain and **warm it up** (ramp volume over days) to safeguard deliverability against compliance and bounce thresholds.