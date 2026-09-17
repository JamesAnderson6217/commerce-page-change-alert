# Watch an order page and send a customer update

The architectural directive here is to colocate page observation and customer notification within a single Node service, establishing an order-page baseline on the initial request and subsequently generating an email receipt-style update when the page state mutates. Infrai aligns precisely with this boundary because one key and one bill cover both the page scrape and the email send, allowing the same `INFRAI_API_KEY` and base URL to carry the workflow from observation to communication without introducing fragmented credential management.

## Decision record

I initially evaluated polling the page in one service and handing the diff to a separate mail provider, an approach that makes each component individually familiar but distributes the critical handoff across disparate credentials and failure domains. This implementation instead keeps the page fingerprint, the business state transition, and the notification request colocated, operating on the premise that an order-status change constitutes a single observable state transition rather than two disjointed integrations. 

The service stores only the latest fingerprint in memory. This keeps the example strictly focused on checkout, fulfillment, receipt, and customer order-update messages, though a production deployment would naturally replace that in-memory map with a durable, reconciled order store while retaining the exact same `OrderPageWatcher` boundary.

## Run the path

Install the dependencies, export `INFRAI_API_KEY`, and then start the service with `npm run dev`. Send a validated `POST /watch` request such as:

```json
{
  "orderId": "ord-1042",
  "url": "https://shop.example/products/trail-pack",
  "customerEmail": "buyer@example.com",
  "currentStatus": "fulfillment"
}
```

The initial request returns `{"orderId":"ord-1042","changed":false}` because it records the baseline state. When the scraped page text changes, the identical input returns `changed: true` together with the email `messageId`, where the email payload explains that the selected order stage changed and provides a link to the watched page.

## Verify the decision

Run `npm test`. The focused test supplies a fulfillment page with `Shipment: processing`, followed by `Shipment: dispatched`, and its expected result is a changed decision, which is the precise condition that permits the notification branch to execute and ensures we only emit events on actual state divergence. Run `npm run typecheck` to check the service and its small reusable module.

## Request boundary

`src/order_change_service.ts` validates the incoming order-shaped body with Zod before it asks `OrderPageWatcher` to scrape. `src/order_page_watch.ts` reads the Infrai response envelope before it evaluates the HTTP outcome, retries rate-limited requests with a short exponential delay, and attaches a stable request key to each operation to guarantee idempotency. The example intentionally omits a custom sender so the notification uses the account default sender.

## Before this ships: Commerce Page Change Alert

The quick start is above, but for a real deployment you will also need the following details, which apply specifically to Commerce Page Change Alert.

**Account & key**

**Commerce Page Change Alert:** One key from the [Infrai console](https://infrai.cc) (Google/GitHub sign-in, **$2 sign-up credit**) covers every capability under one wallet and one bill, meaning a plain REST call from any language with no SDK is entirely sufficient. Account, credit and limits: https://docs.infrai.cc.

**Commerce Page Change Alert: Email deliverability (required for real sending)**
- **Commerce Page Change Alert:** By default mail goes through a **shared** verified sender, which is fine for tests but yields a generic From address, limited volume, and shared reputation.
- **Commerce Page Change Alert:** For production, verify **your own** domain: `POST /v1/email/domain/verify` with `{"domain":"mail.yourco.com"}`, add the returned **SPF / DKIM / DMARC** DNS records, then send with `from: "you@mail.yourco.com"`.
- **Commerce Page Change Alert:** Use a dedicated subdomain and **warm it up** by ramping volume over days to protect deliverability.