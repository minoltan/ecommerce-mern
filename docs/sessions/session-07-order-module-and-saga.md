# Session 07 — Order Module & Saga Pattern
**Duration:** 2 hours  
**Files:** `src/modules/order/`

---

## Learning Goals
- Implement an order state machine with valid transitions
- Understand choreography-based saga vs orchestration-based saga
- Write compensating transactions that undo previous saga steps
- See how `order.events.js` wires the saga without coupling modules

---

## Prerequisites
- Sessions 01–06 complete
- At least one completed checkout (cart cleared, order visible in DB)

---

## Step 1 — Order State Machine (`order.model.js`)

```javascript
const ORDER_STATES = [
  'PENDING',
  'CONFIRMED',
  'PAYMENT_PENDING',
  'PAYMENT_FAILED',
  'PROCESSING',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
];
```

**State transition diagram:**

```
                 ┌─────────────────────────────────────────┐
                 │                                         │
  checkout ───► PENDING ──► CONFIRMED ──► PROCESSING ──► SHIPPED ──► DELIVERED
                  │              │
           (no stock)     (payment fails)
                  │              │
                  ▼              ▼
              CANCELLED    PAYMENT_FAILED
```

**Transitions triggered by events:**

| Event received         | Transition                      |
|------------------------|---------------------------------|
| `CART_CHECKED_OUT`     | (creates order in PENDING)      |
| `STOCK_RESERVED`       | PENDING → CONFIRMED             |
| `PAYMENT_AUTHORISED`   | CONFIRMED → PROCESSING          |
| `PAYMENT_FAILED`       | CONFIRMED → PAYMENT_FAILED      |
| `ORDER_CANCELLED`      | PENDING/CONFIRMED → CANCELLED   |

### Order Schema
```javascript
const orderItemSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, required: true },
    name:      { type: String, required: true },
    price:     { type: Number, required: true },    // snapshot from cart
    quantity:  { type: Number, required: true },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    userId:          { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    items:           [orderItemSchema],
    totalAmount:     { type: Number, required: true },
    status:          { type: String, enum: ORDER_STATES, default: 'PENDING' },
    shippingAddress: { street: String, city: String, state: String, country: String, zip: String },
    paymentId:       { type: mongoose.Schema.Types.ObjectId },
  },
  { timestamps: true }
);

orderSchema.index({ userId: 1, createdAt: -1 });
```

### Why compound index on `{ userId, createdAt: -1 }`?
The most common query: "list orders for a user, newest first." A compound index on `(userId, createdAt DESC)` serves this query entirely from the index — no document reads needed for filtering and sorting. Without it: full collection scan filtered in memory.

### Why store `items` embedded in the order?
Orders are immutable historical records. The items, names, and prices must never change after the order is placed — even if the product is later updated or deleted. Embedding captures the state at order creation time. This is the same price snapshot pattern used in the cart.

---

## Step 2 — Order Service (`order.service.js`)

### Create From Cart
```javascript
const createFromCart = async ({ userId, items, totalAmount, shippingAddress }) => {
  const order = await Order.create({ userId, items, totalAmount, shippingAddress, status: 'PENDING' });

  eventBus.publish(EVENTS.ORDER_PLACED, {
    orderId: order._id.toString(),
    userId,
    items,
    totalAmount,
  });

  return order;
};
```

This is called by `order.events.js` when `CART_CHECKED_OUT` fires. It saves the order and immediately publishes `ORDER_PLACED` — the next link in the saga chain.

### Transition (Generic State Update)
```javascript
const transition = async (orderId, newStatus) => {
  const order = await Order.findByIdAndUpdate(orderId, { status: newStatus }, { new: true });
  if (!order) throw new AppError('Order not found', 404);
  return order;
};
```

A single reusable function for all state transitions. The event handlers in `order.events.js` call this with the appropriate target state. No validation of "is this transition allowed?" — valid event sequences guarantee valid transitions.

**Why no transition guard here?**  
Guards belong in `cancel()`, which is a user-initiated action that can arrive at any time. Saga-driven transitions are only triggered by specific events in a known sequence, so invalid transitions won't occur in the normal flow.

### Cancel (User-Initiated)
```javascript
const cancel = async (orderId, userId) => {
  const order = await Order.findOne({ _id: orderId, userId });
  if (!order) throw new AppError('Order not found', 404);
  if (!['PENDING', 'CONFIRMED'].includes(order.status)) {
    throw new AppError(`Order cannot be cancelled in status: ${order.status}`, 400);
  }

  order.status = 'CANCELLED';
  await order.save();

  eventBus.publish(EVENTS.ORDER_CANCELLED, {
    orderId,
    userId,
    items: order.items,
  });

  return order;
};
```

Only `PENDING` and `CONFIRMED` orders can be cancelled. Once the order is `PROCESSING` (payment taken), cancellation requires a refund flow, not a simple cancel. Publishing `ORDER_CANCELLED` triggers the compensating transaction in `inventory.events.js` to release reserved stock.

---

## Step 3 — Choreography-Based Saga (`order.events.js`)

```javascript
const registerHandlers = () => {
  eventBus.subscribe(EVENTS.CART_CHECKED_OUT, async (payload) => {
    await orderService.createFromCart(payload);
  });

  eventBus.subscribe(EVENTS.STOCK_RESERVED, async ({ orderId }) => {
    await orderService.transition(orderId, 'CONFIRMED');
  });

  eventBus.subscribe(EVENTS.PAYMENT_AUTHORISED, async ({ orderId }) => {
    await orderService.transition(orderId, 'PROCESSING');
  });

  eventBus.subscribe(EVENTS.PAYMENT_FAILED, async ({ orderId }) => {
    await orderService.transition(orderId, 'PAYMENT_FAILED');
  });

  eventBus.subscribe(EVENTS.ORDER_CANCELLED, async ({ orderId }) => {
    await orderService.transition(orderId, 'CANCELLED').catch(() => {});
  });
};
```

### Choreography vs Orchestration

**Choreography (our approach) — each service reacts to events:**
```
Cart       ──[CartCheckedOut]──►  Order  ──[OrderPlaced]──►  Inventory
                                                              ──[StockReserved]──►  Payment
                                                                                    ──[PaymentAuthorised]──►  Order
```
No central coordinator. Each service knows what events it reacts to and what events it emits. Decoupled — adding a new participant (e.g., a fraud-check service) requires no changes to existing services.

**Orchestration (alternative) — a saga orchestrator calls each step:**
```
SagaOrchestrator
  ├─► calls Order.create()
  ├─► calls Inventory.reserve()
  ├─► calls Payment.charge()
  └─► on failure: calls each compensating step
```
Easier to reason about the full flow (all logic in one place). Harder to scale — the orchestrator becomes a bottleneck. Used in Phase 2 with AWS Step Functions when compensation logic is complex.

**Rule of thumb:** Choreography for simple sagas with few steps. Orchestration when you have many steps, complex compensating logic, or need visibility into saga state (Step Functions gives you a visual execution history).

### Compensating Transactions

The saga's "undo" operations when something fails:

| Failure event      | Compensating action                         |
|--------------------|---------------------------------------------|
| `PAYMENT_FAILED`   | Order → PAYMENT_FAILED; Inventory releases reserved stock |
| `ORDER_CANCELLED`  | Inventory releases reserved stock           |
| `ORDER_PLACED` fails (no stock) | Inventory publishes `ORDER_CANCELLED`; Order → CANCELLED |

These compensating transactions don't undo what already happened — they issue forward-moving corrections. This is "eventual consistency" rather than ACID atomicity.

### `.catch(() => {})` on ORDER_CANCELLED transition
```javascript
eventBus.subscribe(EVENTS.ORDER_CANCELLED, async ({ orderId }) => {
  await orderService.transition(orderId, 'CANCELLED').catch(() => {});
});
```
The `ORDER_CANCELLED` event is published by both `cancel()` (user action, order exists and is PENDING/CONFIRMED) and `inventory.events.js` (when stock reservation fails, order may be in PENDING). In edge cases, the order transition might fail (e.g., order already CANCELLED from a different path). The `.catch(() => {})` prevents the event handler from throwing and suppresses the error — the order is already in the desired state.

---

## Step 4 — Routes and Controller

```javascript
// order.routes.js
router.get('/',    authenticate, list);
router.get('/:id', authenticate, getOne);
router.delete('/:id', authenticate, cancelOrder);
```

All order endpoints require authentication. There are no admin-only order routes — users manage their own orders, filtered by `userId` in the service.

```javascript
// order.controller.js — getOne example
const getOne = async (req, res, next) => {
  try {
    const order = await orderService.getById(req.params.id, req.user.sub);
    res.json({ success: true, data: order });
  } catch (err) {
    next(err);
  }
};
```

The service enforces ownership: `Order.findOne({ _id: orderId, userId })`. A user cannot access another user's order — returns 404 (not 403, to avoid leaking order existence).

---

## Hands-On Exercise

### Step 1: Complete a checkout (if not already done)
Use the cart from Session 06 or add items again and checkout.

### Step 2: List orders
```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/users/login \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@test.com","password":"password123"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['token'])")

curl -s http://localhost:3000/api/v1/orders \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -m json.tool
```

Note the `_id` and `status` of the order.

### Step 3: Get order detail
```bash
ORDER_ID="paste-order-id-here"
curl -s "http://localhost:3000/api/v1/orders/$ORDER_ID" \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -m json.tool
```

### Step 4: Force a payment failure
Open `src/modules/payment/payment.service.js` and change line:
```javascript
const success = Math.random() > 0.2;   // 80% success
// to:
const success = false;                  // always fail
```
Restart the server. Add items to cart, create inventory, and checkout again.

Watch the console:
```
[EventBus] → CartCheckedOut  ...
[EventBus] → OrderPlaced     ...
[EventBus] → StockReserved   ...
[EventBus] → PaymentFailed   ...
[EventBus] → StockReleased   ...    ← compensating transaction
```

Check the new order in Mongo Express — status should be `PAYMENT_FAILED`.
Check inventory — `reserved` should be back to 0.

**Restore the original payment logic after this test.**

### Step 5: Cancel an order in PENDING status
Place a new order, then immediately cancel it before the saga completes (you need to be fast — the saga fires synchronously in the same process, so add a `setTimeout` delay to the payment handler to get a window):

Or simply cancel the `PAYMENT_FAILED` order:
```bash
# Cannot cancel PAYMENT_FAILED — try with a PENDING order
# Instead: place a new order and immediately cancel (saga fires sync, so cancel after the fact)
curl -s -X DELETE "http://localhost:3000/api/v1/orders/$ORDER_ID" \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -m json.tool
```
You'll get `400 Order cannot be cancelled in status: PAYMENT_FAILED`. 

Create a new order and cancel immediately to see `CANCELLED` status and inventory release.

---

## Architecture Discussion

### Saga Failure Modes

In our in-process implementation, the full saga runs synchronously within the same Node.js event loop tick cycle. There is no actual failure isolation between steps — if the server crashes mid-saga, we lose the event chain.

**Phase 1 (Kafka):** Each event is a Kafka message. If the payment service crashes after consuming `StockReserved` but before publishing `PaymentAuthorised`, Kafka retains the message. On restart, the consumer picks it up and retries. This is the "at-least-once delivery" guarantee.

**Phase 3 (EventEmitter):** If the server crashes between `OrderPlaced` and `StockReserved`, the order is stuck in `PENDING` forever. A periodic reconciliation job would be needed to detect and resolve stuck orders.

This is the key scalability gap between the in-process EventEmitter and a real message broker. The bus interface (`publish`/`subscribe`) is identical — the transport is what changes.

### Idempotency of Transitions

`transition(orderId, 'CONFIRMED')` uses `findByIdAndUpdate`. If `STOCK_RESERVED` fires twice (e.g., due to a retry), the order gets set to `CONFIRMED` twice. This is safe — setting the same status twice is a no-op. The transition function is naturally idempotent for same-status updates.

`createFromCart` is NOT idempotent — two `CART_CHECKED_OUT` events for the same cart would create two orders. In production with Kafka, exactly-once semantics or a deduplication key would prevent this.

---

## Common Mistakes

| Mistake | Problem | Fix |
|---|---|---|
| Comparing ObjectId with `===` | Always false — order not found | `.toString()` both sides or use Mongoose `.equals()` |
| No compound index on `userId + createdAt` | Full collection scan on list query | `orderSchema.index({ userId: 1, createdAt: -1 })` |
| Allowing `cancel` in any status | Users can cancel a shipped order | Guard: only `PENDING` or `CONFIRMED` |
| Not publishing `ORDER_CANCELLED` from `cancel()` | Inventory never releases reserved stock | Always publish event for saga to pick up |
| Missing `.catch(() => {})` on order transition in cancelled handler | Throws if order already in terminal state | Add catch to suppress no-op errors |

---

## Key Takeaways

1. The order state machine enforces valid status transitions — the `enum` on the schema is the first guard, business logic in `cancel()` is the second
2. `createFromCart` receives the full cart payload via the event — no cross-module DB query
3. Choreography saga: each module reacts to events independently — no central coordinator
4. Compensating transactions move forward to undo side effects (release stock, mark PAYMENT_FAILED) rather than rolling back
5. The compound index `{ userId: 1, createdAt: -1 }` is purpose-built for the "list my orders, newest first" query
6. Saga durability gap: EventEmitter loses in-flight events on crash; Kafka retains them

---

## Quiz Questions

1. Draw the order state machine. Which states are terminal (no further transitions)?
2. What is the difference between a choreography-based saga and an orchestration-based saga? Which is used here, and why?
3. What is a compensating transaction? Give two examples from this implementation.
4. Why is `transition()` safe to call multiple times with the same target status? What property does this describe?
5. Why is `cancel()` guarded (`PENDING` or `CONFIRMED` only) but `transition()` is not?
6. What happens if the server crashes after `ORDER_PLACED` fires but before `STOCK_RESERVED` fires? How would Kafka change this behaviour?
7. Why does the order embed item details (name, price) instead of just storing a reference to the Product?
