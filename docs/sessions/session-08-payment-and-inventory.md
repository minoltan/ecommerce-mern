# Session 08 — Payment & Inventory Modules
**Duration:** 1.5 hours  
**Files:** `src/modules/payment/`, `src/modules/inventory/`

---

## Learning Goals
- Implement the idempotency key pattern to prevent double-charging
- Understand stock reservation vs stock commit (two-phase deduction)
- Wire the payment and inventory modules into the saga chain
- Recognise the `available = quantity - reserved` invariant

---

## Prerequisites
- Sessions 01–07 complete
- A working end-to-end checkout flow (cart → order → event chain observable in console)

---

## Part A — Payment Module

## Step 1 — Payment Model (`payment.model.js`)

```javascript
const paymentSchema = new mongoose.Schema(
  {
    orderId:        { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },
    userId:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    amount:         { type: Number, required: true },
    currency:       { type: String, default: 'USD' },
    status: {
      type: String,
      enum: ['PENDING', 'AUTHORISED', 'FAILED', 'REFUNDED'],
      default: 'PENDING',
    },
    idempotencyKey: { type: String, required: true, unique: true },
    provider:       { type: String, default: 'MOCK' },
    providerRef:    { type: String },
  },
  { timestamps: true }
);
```

### `idempotencyKey` — the most important field in this schema
`unique: true` on `idempotencyKey` creates a unique index in MongoDB. If two payment requests arrive with the same key, the second `Payment.create()` throws a duplicate key error, preventing a double charge.

### `providerRef`
In production, the payment gateway (Stripe, PayPal) returns a transaction ID. We store it as `providerRef` to support:
- Reconciliation with the gateway's records
- Refund requests (you need the gateway's transaction ID to issue a refund)
- Dispute resolution

Our mock sets `providerRef: 'mock-<uuid>'`.

---

## Step 2 — Payment Service (`payment.service.js`)

### Initiate — With Idempotency Check
```javascript
const initiate = async ({ orderId, userId, amount, idempotencyKey }) => {
  // 1. Check for duplicate before creating anything
  const existing = await Payment.findOne({ idempotencyKey });
  if (existing) return existing;   // safe to return — same result as first call

  // 2. Create PENDING payment record first
  const payment = await Payment.create({
    orderId,
    userId,
    amount,
    idempotencyKey: idempotencyKey || randomUUID(),
    status: 'PENDING',
  });

  // 3. Mock payment gateway — 80% success rate
  const success = Math.random() > 0.2;

  if (success) {
    payment.status = 'AUTHORISED';
    payment.providerRef = `mock-${randomUUID()}`;
    await payment.save();
    eventBus.publish(EVENTS.PAYMENT_AUTHORISED, { paymentId: payment._id.toString(), orderId, userId, amount });
  } else {
    payment.status = 'FAILED';
    await payment.save();
    eventBus.publish(EVENTS.PAYMENT_FAILED, { paymentId: payment._id.toString(), orderId, userId });
  }

  return payment;
};
```

### Why `idempotencyKey: \`order-${orderId}\`` ?
The key format is `order-{orderId}`. The `orderId` is stable and unique — re-sending payment for the same order always produces the same key. The check-before-create pattern means:

```
Request 1: idempotencyKey = 'order-abc123'  → Payment.findOne() → null → create → AUTHORISED
Request 2: idempotencyKey = 'order-abc123'  → Payment.findOne() → finds doc → return existing
```

Request 2 returns the same authorised payment without charging again. This protects against:
- Network timeout on the client → client retries → would double-charge without idempotency
- Message broker retry (Kafka) → `STOCK_RESERVED` delivered twice → only one payment created

**The idempotency key is provided by the caller, not generated inside `initiate()`.** This is important — if `initiate()` generated its own UUID each time, retries would get different keys and bypass the check.

### Why create the PENDING record before calling the gateway?
```
Without pre-creation:
  1. Call gateway → success
  2. Save AUTHORISED to DB → crash!
  → DB has no payment record. User was charged. Order stuck in CONFIRMED forever.

With pre-creation:
  1. Save PENDING to DB
  2. Call gateway → success
  3. Update to AUTHORISED
  → If crash between steps 2 and 3: reconciliation job finds PENDING records and checks gateway
```

Pre-creating the record gives you a recovery point.

### Refund
```javascript
const refund = async (paymentId, userId) => {
  const payment = await Payment.findOne({ _id: paymentId, userId });
  if (!payment) throw new AppError('Payment not found', 404);
  if (payment.status !== 'AUTHORISED') throw new AppError('Payment is not refundable', 400);

  payment.status = 'REFUNDED';
  await payment.save();

  eventBus.publish(EVENTS.REFUND_ISSUED, {
    paymentId: payment._id.toString(),
    orderId:   payment.orderId.toString(),
    userId,
    amount:    payment.amount,
  });

  return payment;
};
```

Only `AUTHORISED` payments can be refunded. `FAILED` and `REFUNDED` are terminal. `PENDING` payments can't be refunded because we don't know yet if money was taken.

---

## Step 3 — Payment Event Handler (`payment.events.js`)

```javascript
const registerHandlers = () => {
  eventBus.subscribe(EVENTS.STOCK_RESERVED, async ({ orderId, userId, totalAmount }) => {
    await paymentService.initiate({
      orderId,
      userId,
      amount:         totalAmount,
      idempotencyKey: `order-${orderId}`,
    });
  });
};
```

Payment initiates only after stock is confirmed reserved. This sequence matters:
- Reserve stock → then charge payment
- If payment fails, release the reserved stock (handled by inventory's `PAYMENT_FAILED` subscriber)

If we charged first then reserved stock, we'd have a window where money was taken but stock ran out — much harder to resolve.

---

## Part B — Inventory Module

## Step 4 — Inventory Model (`inventory.model.js`)

```javascript
const inventorySchema = new mongoose.Schema(
  {
    productId:         { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, unique: true },
    quantity:          { type: Number, required: true, min: 0, default: 0 },
    reserved:          { type: Number, default: 0, min: 0 },
    lowStockThreshold: { type: Number, default: 10 },
  },
  { timestamps: true }
);

inventorySchema.virtual('available').get(function () {
  return this.quantity - this.reserved;
});
```

### The `available` invariant
```
quantity  = total units in warehouse
reserved  = units held for pending orders (payment not yet confirmed)
available = quantity - reserved  (what customers can actually order)
```

Example walkthrough:
```
Initial state:        quantity=50, reserved=0,  available=50
Order 1 (qty 3):      quantity=50, reserved=3,  available=47
Order 2 (qty 10):     quantity=50, reserved=13, available=37
Order 1 payment OK:   quantity=47, reserved=10, available=37  ← commit: qty-3, reserved-3
Order 2 payment fail: quantity=47, reserved=0,  available=47  ← release: reserved-10
```

`quantity` only decreases on payment confirmation (`commit`). `reserved` acts as a temporary hold.

---

## Step 5 — Inventory Service (`inventory.service.js`)

### Reserve — Holds Units for Pending Payment
```javascript
const reserve = async (items) => {
  for (const item of items) {
    const inv = await Inventory.findOne({ productId: item.productId });
    if (!inv) throw new AppError(`No inventory for product ${item.productId}`, 404);

    const available = inv.quantity - inv.reserved;
    if (available < item.quantity) {
      throw new AppError(`Insufficient stock for product ${item.productId}`, 400);
    }

    inv.reserved += item.quantity;
    await inv.save();

    if (inv.quantity - inv.reserved <= inv.lowStockThreshold) {
      eventBus.publish(EVENTS.LOW_STOCK_ALERT, {
        productId: item.productId,
        available: inv.quantity - inv.reserved,
      });
    }
  }
};
```

**Why loop instead of a bulk update?**
Each item needs individual availability checking. A bulk `$inc` update (e.g., `updateMany`) can't enforce per-product availability constraints. The loop is correct but not atomic — if reservation of item 3 fails after items 1 and 2 succeeded, we have partial reservations. A production system would use a MongoDB transaction (`session.startTransaction()`) to wrap the loop.

### Release — Returns Reserved Units to Available Pool
```javascript
const release = async (items) => {
  for (const item of items) {
    await Inventory.findOneAndUpdate(
      { productId: item.productId },
      { $inc: { reserved: -item.quantity } }
    );
  }
  eventBus.publish(EVENTS.STOCK_RELEASED, { items });
};
```

Uses `$inc` atomic operator — no read-modify-write cycle needed for a simple decrement.

### Commit — Final Deduction on Payment Success
```javascript
const commit = async (items) => {
  for (const item of items) {
    await Inventory.findOneAndUpdate(
      { productId: item.productId },
      { $inc: { quantity: -item.quantity, reserved: -item.quantity } }
    );
  }
};
```

Both `quantity` and `reserved` decrease by the same amount. Net effect on `available`: none (already excluded by reservation). Net effect on `quantity`: permanently reduced.

**Note:** In `inventory.events.js`, the `PAYMENT_AUTHORISED` handler logs a placeholder but doesn't call `commit()`. This is noted as a known gap — the `commit` call requires the order's items, which would need to be fetched from the Order collection. Adding it is a good exercise.

### Upsert — Create or Update Inventory Record
```javascript
const upsert = async (productId, { quantity, lowStockThreshold }) => {
  return Inventory.findOneAndUpdate(
    { productId },
    { $set: { ...(quantity !== undefined && { quantity }),
              ...(lowStockThreshold !== undefined && { lowStockThreshold }) } },
    { upsert: true, new: true }
  );
};
```

`upsert: true` creates the document if it doesn't exist. The spread conditional `...(quantity !== undefined && { quantity })` only sets fields that were provided — partial updates work correctly.

---

## Step 6 — Inventory Event Handler (`inventory.events.js`)

```javascript
const registerHandlers = () => {
  eventBus.subscribe(EVENTS.ORDER_PLACED, async ({ orderId, userId, items, totalAmount }) => {
    try {
      await inventoryService.reserve(items);
      eventBus.publish(EVENTS.STOCK_RESERVED, { orderId, userId, items, totalAmount });
    } catch (err) {
      // Insufficient stock — cancel the order
      eventBus.publish(EVENTS.ORDER_CANCELLED, { orderId, userId, items, reason: err.message });
    }
  });

  eventBus.subscribe(EVENTS.ORDER_CANCELLED, async ({ items }) => {
    if (items?.length) await inventoryService.release(items);
  });

  eventBus.subscribe(EVENTS.PAYMENT_AUTHORISED, async ({ orderId }) => {
    console.log(`[Inventory] Committing stock for order ${orderId}`);
    // commit() call is left as an exercise — needs order items from DB
  });
};
```

**The reserve-or-cancel pattern:**
```javascript
try {
  await inventoryService.reserve(items);   // throws if stock insufficient
  eventBus.publish(EVENTS.STOCK_RESERVED, ...);
} catch (err) {
  eventBus.publish(EVENTS.ORDER_CANCELLED, ...);  // saga compensation
}
```

If `reserve()` throws (no stock), the catch block publishes `ORDER_CANCELLED` instead of `STOCK_RESERVED`. This triggers:
- `order.events.js` → order transitions to CANCELLED
- `inventory.events.js` (own `ORDER_CANCELLED` handler) → releases any partially reserved items

---

## Hands-On Exercise

### Step 1: Set initial inventory
```bash
ADMIN_TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/users/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@test.com","password":"password123"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['token'])")

PRODUCT_ID="paste-product-id-here"

curl -s -X PUT "http://localhost:3000/api/v1/inventory/$PRODUCT_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"quantity":5,"lowStockThreshold":3}' \
  | python3 -m json.tool
# quantity: 5, reserved: 0, available virtual: 5
```

### Step 2: Check inventory
```bash
curl -s "http://localhost:3000/api/v1/inventory/$PRODUCT_ID" | python3 -m json.tool
```

### Step 3: Place an order for 4 units
Add the product (qty 4) to cart and checkout. Watch the console:
```
[EventBus] → StockReserved ...
[EventBus] → PaymentAuthorised ...
```
Now check inventory: `quantity: 5, reserved: 4`. Available = 1.

### Step 4: Try to order 2 more units
Add 2 of the same product to cart and checkout. This should fail:
```
[EventBus] → OrderPlaced ...
[EventBus] → OrderCancelled { reason: "Insufficient stock for product ..." }
```
Check the new order: status = `CANCELLED`.
Check inventory: `reserved` back to 0 (stock released from failed order... wait — the first order's reserved is still 4, but the second order never reserved anything because it failed). Available is still 1.

### Step 5: Test idempotency
In MongoDB, find a `STOCK_RESERVED` payment's `idempotencyKey` (format: `order-<orderId>`).

Open the Node.js REPL or write a quick test to call `paymentService.initiate()` twice with the same key — observe that only one payment document exists.

### Step 6: Test refund
```bash
PAYMENT_ID=$(curl -s http://localhost:3000/api/v1/orders/$ORDER_ID \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['data'].get('paymentId',''))")

curl -s -X POST "http://localhost:3000/api/v1/payments/$PAYMENT_ID/refund" \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -m json.tool
```
Payment status should change to `REFUNDED`. A `RefundIssued` event fires in the console.

---

## Architecture Discussion

### Idempotency in Production

In a real Stripe integration, the idempotency key is passed as a header:
```
POST /v1/charges
Idempotency-Key: order-abc123
```
Stripe stores the key and returns the same response for duplicate requests within 24 hours. Our implementation mirrors this concept at the application layer.

**What if two payment requests arrive simultaneously for the same key?**
- Without a unique index: both `Payment.findOne()` calls return null simultaneously → two documents created → double charge
- With `unique: true`: one succeeds, the other gets a duplicate key error (E11000) from MongoDB → our code should catch this and return the existing payment

This is a known race condition in the "check-then-create" pattern. The unique index is the safety net.

### Phase 1 (Spring Boot) Inventory

Phase 1 uses MySQL with a `SELECT ... FOR UPDATE` (pessimistic lock) on the inventory row during reservation:
```sql
SELECT * FROM inventory WHERE product_id = ? FOR UPDATE;
UPDATE inventory SET reserved = reserved + ? WHERE product_id = ?;
```
This prevents two concurrent reservations from both reading `available=5` and both succeeding when only 5 units exist.

Phase 3 (Mongoose) uses a read-modify-write cycle without a lock:
```javascript
const inv = await Inventory.findOne({ productId });
inv.reserved += item.quantity;   // race condition possible here
await inv.save();
```
Under concurrent load, two requests could both read `available=5`, both decide "enough stock", both increment `reserved`, and result in `reserved=10` when only 5 are available. Fix: use `$inc` with a filter condition:
```javascript
const result = await Inventory.findOneAndUpdate(
  { productId, $expr: { $gte: [{ $subtract: ['$quantity', '$reserved'] }, item.quantity] } },
  { $inc: { reserved: item.quantity } },
  { new: true }
);
if (!result) throw new AppError('Insufficient stock', 400);
```
This is an atomic check-and-update. The current implementation works for a single-instance server with low concurrency; the `findOneAndUpdate` approach is required for production.

---

## Common Mistakes

| Mistake | Problem | Fix |
|---|---|---|
| Generating idempotency key inside `initiate()` | Every retry gets a new key — no deduplication | Caller provides the key; derive it from a stable ID like `orderId` |
| Checking availability with a read then updating separately | Race condition — two orders can both "see" enough stock | Use atomic `findOneAndUpdate` with filter condition |
| No `reserved` field — just decrement `quantity` on order | Can't release stock on payment failure | Always use reservation pattern: reserve → commit or release |
| Refunding a FAILED payment | No money was taken — nothing to refund | Guard: `status !== 'AUTHORISED'` → 400 |
| Not publishing `STOCK_RESERVED` on successful reserve | Payment event handler never fires — order stuck in PENDING | Must publish after reserve succeeds |

---

## Key Takeaways

1. Idempotency key = deterministic key derived from a stable ID (`order-{orderId}`); check-before-create prevents double charge
2. The `unique: true` index on `idempotencyKey` is the database-level safety net for concurrent duplicate requests
3. `available = quantity - reserved` — customers can only buy available stock; `quantity` only decreases on payment confirmation
4. Pre-create the PENDING payment record before calling the gateway — gives you a recovery point if the server crashes
5. `$inc` is atomic — use it for counters (reserved, quantity) instead of read-modify-write
6. Reserve stock before charging payment — cheaper to release a reservation than to issue a refund

---

## Quiz Questions

1. What is an idempotency key? Why must it be provided by the caller rather than generated inside the function?
2. Describe the `available = quantity - reserved` invariant. Walk through what happens to these fields when: (a) an order is placed, (b) payment succeeds, (c) payment fails.
3. What race condition exists in the current `reserve()` implementation? How would you fix it with `findOneAndUpdate`?
4. Why do we create a PENDING payment record before calling the mock gateway? What recovery scenario does this enable?
5. Why does the saga charge payment only after stock is reserved (not before)?
6. What does `$inc: { reserved: -item.quantity }` do? Why is this safer than a read-modify-write cycle for decrementing?
7. What is the difference between `release()` and `commit()` in the inventory service?
