import assert from "node:assert/strict";
import test from "node:test";
import { decidePageChange } from "./order_page_watch.js";

test("a changed fulfillment page becomes an alert decision", () => {
  const baseline = decidePageChange(undefined, "Shipment: processing");
  const changed = decidePageChange(baseline.fingerprint, "Shipment: dispatched");

  assert.equal(baseline.changed, false);
  assert.equal(changed.changed, true);
  assert.notEqual(changed.fingerprint, baseline.fingerprint);
});
