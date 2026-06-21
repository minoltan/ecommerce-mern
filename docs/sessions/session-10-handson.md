# Session 10 — Hands-On: Auditing & Hardening the Checkout Saga

This is a companion to the Session 10 lecture plan in `CURRICULUM.md`. Instead of writing
tests for code you just wrote, this lab walks through something closer to real production
work: **auditing code someone else (or past-you) wrote**, proving what's actually wrong with
a failing test, fixing it, and keeping the docs honest. Every step below is a real commit in
this repo's history — you can `git show <hash>` any of them to see the literal diff.

## Before You Start

- Sessions 1–9 done: all seven modules scaffolded, `npm test` passing for the `user` module.
- `docs/hld/`, `docs/lld/`, `docs/adr/` exist as empty folders (check: `ls docs/hld docs/lld
  docs/adr` — nothing there yet at the start of this session).
- Run `npm test` from `server/` once now so you have a baseline.

## Step 1 — Don't trust the README, trace the actual handlers

**What we did:** Before drawing anything, we read every `*.events.js` file
(`order/order.events.js`, `inventory/inventory.events.js`, `payment/payment.events.js`,
`notification/notification.events.js`) and `payment.service.js`, `order.service.js`,
`inventory.service.js` line by line, instead of copying the simplified event-flow diagram out
of `README.md`.

**Why:** A README is aspirational — it describes intent. The handlers are what actually runs.
On a real team, the gap between the two is exactly where production incidents hide. Architecture
docs that are wrong are worse than no docs, because people trust them.

**Try it yourself:** Open `server/src/modules/inventory/inventory.events.js` right now and
list every event it subscribes to. Compare that list against the "Event Flow (checkout saga)"
diagram in `README.md`. You'll find the README is missing `PaymentFailed` and `PaymentAuthorised`
as inventory triggers entirely — that's the discrepancy this session starts from.

## Step 2 — Draw what the code actually does

**What we did:** Wrote `docs/hld/checkout-saga-flow.md` — a Mermaid `sequenceDiagram` of the
real choreography, including an Event Catalog table (`event → publisher → subscribers`),
built directly from Step 1's notes, not the README.

**Why:** Diagram-first communication means the diagram is a tool for *finding* problems, not
just explaining a finished design. Drawing the real fan-out (`par` blocks for events with
multiple subscribers, `alt` blocks for the success/failure branches) is what surfaced every gap
fixed in this session — we found them by trying to draw the failure branches accurately and
realizing the arrows didn't add up.

**Reproduce it:** `git show 612c72a -- docs/hld/checkout-saga-flow.md`

**Try it yourself:** Pick any Mermaid live editor (or VS Code's Mermaid preview) and paste in
the diagram. Trace the `PaymentFailed` branch with your finger. Before this session, the
`Inventory` participant had no arrow on that branch at all — ask yourself: *if payment fails,
what happens to the stock we reserved?* That question is gap #1.

## Step 3 — Write the ADR for the decision already made

**What we did:** Wrote `docs/adr/ADR-0001-modular-monolith-over-microservices.md`, contrasting
this repo's modular-monolith choice against Phase 1's `ADR-0006-microservices-vs-monolith.md`
in `ecommerce-platform`.

**Why:** The decision (modular monolith) was already made back in Session 1 — this ADR doesn't
change anything, it makes the *reasoning* durable. Six months from now, "why didn't we just use
microservices like Phase 1?" should have a written answer instead of relying on someone's memory.
Context → Decision → Consequences (positive AND negative) → Alternatives Rejected is the same
four-part format used across every ADR in `ecommerce-platform/docs/adr/`.

**Reproduce it:** `git show 612c72a -- docs/adr/ADR-0001-modular-monolith-over-microservices.md`

## Step 4 — Prove a gap exists with a test *before* fixing it

This is the step most students skip, and it's the most important one.

**What we did:** Wrote `server/src/__tests__/sagas/checkout-saga.test.js` asserting the
*desired* behavior — "reserved stock returns to 0 when payment fails" — and ran it against the
unfixed code. It failed, exactly as expected, because no code existed yet to release stock on
`PaymentFailed`. We wrapped it in Jest's `test.failing(...)` instead of a plain `it(...)`:

```js
test.failing('releases reserved stock when payment fails', async () => {
  // ...arrange a reserved order...
  eventBus.publish(EVENTS.PAYMENT_FAILED, { /* ... */ });
  await flush();
  expect(inv.reserved).toBe(0); // fails today — that's the point
});
```

**Why `test.failing` instead of just leaving a normal test red:** A normal failing test left in
the suite either blocks CI for everyone or gets skipped and forgotten. `test.failing` flips the
report: Jest shows it as **passing** as long as the test body fails internally — which means
"yes, this documented gap still exists." If someone fixes the bug without reading this file,
the test will start failing for real, which is Jest telling them: *something changed, go check
if `test.failing` should be removed.* The test is the executable version of "Known Gaps" in the
HLD doc — it can't go stale silently the way a markdown bullet point can.

**Reproduce it:** `git show 612c72a -- server/src/__tests__/sagas/checkout-saga.test.js`, then
`cd server && npx jest src/__tests__/sagas` — read the output closely, it says `PASS` for a test
whose assertion is failing. That's not a contradiction once you understand `test.failing`.

**Try it yourself:** Comment out the `.failing` and change it to a plain `it(...)`. Run the test
again — now it fails for real (red), because the underlying bug is still there. Put `.failing`
back before continuing.

## Step 5 — Fix the gap, then delete the safety net

**What we did, in `payment.service.js` and `inventory.events.js`:**

1. `payment.events.js`'s `StockReserved` subscriber now also destructures `items` and passes
   them into `paymentService.initiate(...)`.
2. `payment.service.js`'s `initiate()` accepts `items` and includes them in the
   `PaymentFailed` event payload (it previously published `{ paymentId, orderId, userId }` —
   no `items`, so nothing downstream could know what to release).
3. `inventory.events.js` gained one new subscriber:
   ```js
   eventBus.subscribe(EVENTS.PAYMENT_FAILED, async ({ items }) => {
     if (items?.length) await inventoryService.release(items);
   });
   ```
4. Removed `.failing` from the Step 4 test — it now passes for real.

**Why thread `items` through three files instead of querying the Order from Inventory:**
We could have made the `PaymentFailed` handler do `Order.findById(orderId)` to fetch the items
itself. We didn't, because `ADR-0001` explicitly forbids cross-module model imports — Inventory
is not allowed to know about Order's Mongoose schema. The event payload has to carry everything
a subscriber needs. This is the real cost of the modular-monolith rule: it pushes you toward
fatter events instead of convenient queries, on purpose, because in Phase 2 those subscribers
become separate Lambda functions that *can't* reach across into another service's table.

**Reproduce it:** `git show f3e3ff9`

## Step 6 — Update the diagram to match the fix

**What we did:** Edited `docs/hld/checkout-saga-flow.md` — added the `Inventory` arrow to the
`PaymentFailed` `par` block, updated the Event Catalog table's subscriber list, and moved the
gap from "Known Gaps" to a "Fixed" section with a one-line explanation of *how* it was fixed
(not just "done").

**Why:** A diagram that isn't updated in the same change as the code is already lying. Treat
`docs/hld/*.md` like a file that ships in the same commit as the code it describes — not a
separate documentation task for later.

## Step 7 — Repeat the pattern for two more gaps

Tracing the diagram in Step 2 surfaced two more real bugs while writing it:

- **Gap #2:** `inventoryService.reserve(items)` reserves a multi-item order one item at a time.
  If item 3 of 5 fails (insufficient stock), items 1–2 are already reserved in the database —
  but the failure handler published the *original full 5-item list* on `OrderCancelled`, and
  Inventory's own `OrderCancelled` subscriber released all 5, including the 3 that were never
  actually reserved. That's a phantom stock credit — `reserved` could go negative.
- **Gap #3:** The `PaymentAuthorised` handler was a stub: `console.log('Committing stock...')`
  and nothing else. `inventoryService.commit(items)` already existed (it deducts `quantity` and
  clears `reserved`) — it was just never called.

**The fixes (`git show 5f769ca`):**

- `inventoryService.reserve()` now tracks `reservedSoFar` and releases exactly that subset if a
  later item throws, *before* re-throwing — it's now self-compensating, so by the time the
  caller's `catch` block runs, nothing is left reserved for this attempt.
- The reservation-failure path's `OrderCancelled` publish no longer includes `items` at all.
  Combined with the self-compensation above, this means: `items` present on `OrderCancelled` now
  *only* ever means "this is a real, fully-reserved order being cancelled by the user" — the
  ambiguity that caused gap #2 is gone because the two cases are now distinguishable by the
  event payload itself, with no new flag needed.
- `payment.service.js` includes `items` in `PaymentAuthorised` too (mirroring Step 5's fix for
  `PaymentFailed`), and the stub handler became one real line:
  `if (items?.length) await inventoryService.commit(items);`

**Why this is the same pattern as Step 4–5, twice:** Notice the shape repeats — find the gap by
drawing the diagram honestly, write a test asserting the correct end state, watch it fail, fix
the minimum code to make it pass, update the doc. That loop is the actual skill this session is
teaching, more than any specific bug.

**Try it yourself:** Read the two new `describe` blocks added to `checkout-saga.test.js` in this
commit. For the reservation-failure test, try changing product B's stock from 2 to 10 (so both
items *can* be reserved) and predict what the order status and both `reserved` values should be
before running the test — then run it and check your prediction.

## Recap

| Step | Artifact | Commit |
|---|---|---|
| Diagram + ADR + gap-proving test | `docs/hld/checkout-saga-flow.md`, `docs/adr/ADR-0001-*.md`, `checkout-saga.test.js` | `612c72a` |
| Fix gap #1 (PaymentFailed → release) | `payment.service.js`, `payment.events.js`, `inventory.events.js` | `f3e3ff9` |
| Fix gaps #2 & #3 (self-compensating reserve, real commit) | `inventory.service.js`, `inventory.events.js`, `payment.service.js` | `5f769ca` |

Run `npm test` from `server/` now — all suites should be green, including the saga tests, with
no `test.failing` markers left anywhere in the codebase (`grep -r "test.failing" server/src`
should return nothing).

## What's Next

One gap remains, deliberately not fixed in this session: **no durability.** Every event in this
saga lives only in the Node.js `EventEmitter`'s memory — if the server process crashes between
`OrderPlaced` and `StockReserved`, that event is gone forever, with no retry and no replay.
Phase 1's Java services solve this with a *transactional outbox* (write the event to the same
database, in the same transaction, as the state change; a relay process polls and publishes it
later). Doing the same thing correctly in MongoDB needs a real decision first — this repo's local
MongoDB currently runs as a single standalone node, and Mongo's multi-document transactions
require a replica set. That decision (and its trade-offs) is the next session's topic, not this
one.
