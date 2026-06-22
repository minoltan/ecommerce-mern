# Session 09 — Notification Module & End-to-End Wiring
**Duration:** 1 hour  
**Files:** `src/modules/notification/`, `src/app.js`, `src/server.js`

---

## Learning Goals
- Understand the pure-consumer pattern — a module that only reacts to events, never drives them
- Trace the complete event chain from checkout to notification
- See how `app.js` wires all event handlers at startup
- Add a new event subscriber without touching any existing module

---

## Prerequisites
- Sessions 01–08 complete
- Full checkout flow working end-to-end

---

## Step 1 — Notification Model (`notification.model.js`)

```javascript
const notificationSchema = new mongoose.Schema(
  {
    userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type:     { type: String, enum: ['EMAIL', 'SMS', 'PUSH'], required: true },
    template: { type: String, required: true },
    payload:  { type: mongoose.Schema.Types.Mixed },
    status:   { type: String, enum: ['PENDING', 'SENT', 'FAILED'], default: 'PENDING' },
    sentAt:   { type: Date },
  },
  { timestamps: true }
);

notificationSchema.index({ userId: 1, createdAt: -1 });
```

### `Mixed` type for `payload`
The `payload` field holds template-specific data. For a `welcome` notification it's `{ email, name }`. For `order-confirmation` it's `{ orderId, totalAmount }`. Using `Mixed` avoids defining a fixed schema for what is intentionally variable data.

Trade-off: `Mixed` fields lose Mongoose's automatic change detection. If you mutate a Mixed field directly (e.g., `notification.payload.name = 'new'`), Mongoose won't track it as a change. Fix: call `notification.markModified('payload')` before saving, or reassign the whole object (`notification.payload = { ... }`).

### Template field
The `template` string names the Handlebars/Mustache template to use when rendering the email. In production, this value would be used to look up a template file:
```javascript
const html = await renderTemplate(notification.template, notification.payload);
await sendGridClient.send({ to: user.email, html });
```
For now, the service logs to the console.

---

## Step 2 — Notification Service (`notification.service.js`)

```javascript
const create = async ({ userId, type, template, payload }) => {
  const notification = await Notification.create({ userId, type, template, payload });

  // Replace with real email/SMS provider (e.g., SendGrid, Twilio)
  console.log(`[Notification] Sending ${type} to user ${userId} — template: ${template}`, payload);

  notification.status = 'SENT';
  notification.sentAt = new Date();
  await notification.save();

  return notification;
};

const getByUser = async (userId) => {
  return Notification.find({ userId }).sort({ createdAt: -1 }).lean();
};
```

Simple by design. Two responsibilities: persist the notification record, simulate delivery. In a real system, `create` would:
1. Save to DB (status: PENDING)
2. Enqueue to a delivery worker (SendGrid, Twilio)
3. Worker calls the API provider
4. On success: update status to SENT, set sentAt
5. On failure: retry N times, then mark FAILED

---

## Step 3 — Notification Event Handlers (`notification.events.js`)

```javascript
const registerHandlers = () => {
  eventBus.subscribe(EVENTS.USER_REGISTERED, async ({ userId, email, name }) => {
    await notificationService.create({ userId, type: 'EMAIL', template: 'welcome', payload: { email, name } });
  });

  eventBus.subscribe(EVENTS.ORDER_PLACED, async ({ userId, orderId, totalAmount }) => {
    await notificationService.create({
      userId, type: 'EMAIL', template: 'order-confirmation', payload: { orderId, totalAmount },
    });
  });

  eventBus.subscribe(EVENTS.PAYMENT_AUTHORISED, async ({ userId, orderId, amount }) => {
    await notificationService.create({
      userId, type: 'EMAIL', template: 'payment-success', payload: { orderId, amount },
    });
  });

  eventBus.subscribe(EVENTS.PAYMENT_FAILED, async ({ userId, orderId }) => {
    await notificationService.create({
      userId, type: 'EMAIL', template: 'payment-failed', payload: { orderId },
    });
  });

  eventBus.subscribe(EVENTS.LOW_STOCK_ALERT, async ({ productId, available }) => {
    console.log(`[Notification] Low stock alert — product ${productId}, ${available} units remaining`);
  });
};
```

### The Pure-Consumer Pattern

The notification module:
- Subscribes to events from other modules (User, Order, Payment, Inventory)
- Never publishes any event of its own
- Has no synchronous calls made to it by other modules
- Has only one outward-facing operation: `GET /notifications` (read-only)

This is the **pure consumer** pattern. The notification module can be:
- **Replaced** without touching any other module
- **Disabled** without breaking any business flow (no module depends on it)
- **Extended** by adding new `eventBus.subscribe()` calls in its own events file

No other module needs to change when a new notification type is added.

### Open/Closed Principle in action
To add a notification for `ORDER_CANCELLED`, you add one `eventBus.subscribe` call inside `notification.events.js`:
```javascript
eventBus.subscribe(EVENTS.ORDER_CANCELLED, async ({ userId, orderId }) => {
  await notificationService.create({
    userId, type: 'EMAIL', template: 'order-cancelled', payload: { orderId },
  });
});
```
Zero changes to `order.events.js`, `order.service.js`, or any other file. The module is open for extension, closed for modification.

---

## Step 4 — Application Wiring (`app.js` + `server.js`)

`app.js` builds the Express app — middleware, routes, error handler — and exports it. Nothing
else:

```javascript
// 1. Import route modules
import userRoutes from './modules/user/user.routes.js';
import productRoutes from './modules/product/product.routes.js';
import cartRoutes from './modules/cart/cart.routes.js';
import orderRoutes from './modules/order/order.routes.js';
import paymentRoutes from './modules/payment/payment.routes.js';
import inventoryRoutes from './modules/inventory/inventory.routes.js';
import notificationRoutes from './modules/notification/notification.routes.js';

// 2. Register middleware
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

// 3. Mount routes
app.use('/api/v1/users',         userRoutes);
app.use('/api/v1/products',      productRoutes);
app.use('/api/v1/cart',          cartRoutes);
app.use('/api/v1/orders',        orderRoutes);
app.use('/api/v1/payments',      paymentRoutes);
app.use('/api/v1/inventory',     inventoryRoutes);
app.use('/api/v1/notifications', notificationRoutes);

app.use(errorMiddleware);

export default app;   // no side effects — safe to import from anywhere, including tests
```

Everything that has a *side effect* — subscribing event handlers, connecting to MongoDB,
binding a port — lives in a separate file, `server.js`:

```javascript
import app from './app.js';
import env from './shared/config/env.js';
import { connect } from './shared/config/db.js';
import { registerHandlers as registerOrderHandlers } from './modules/order/order.events.js';
import { registerHandlers as registerInventoryHandlers } from './modules/inventory/inventory.events.js';
import { registerHandlers as registerPaymentHandlers } from './modules/payment/payment.events.js';
import { registerHandlers as registerNotificationHandlers } from './modules/notification/notification.events.js';

registerOrderHandlers();         // subscribe all order event handlers
registerInventoryHandlers();     // subscribe all inventory event handlers
registerPaymentHandlers();       // subscribe all payment event handlers
registerNotificationHandlers();  // subscribe all notification event handlers

await connect();                 // connect to MongoDB
app.listen(env.PORT, () => console.log(`Server running on port ${env.PORT}`));
```

`package.json`'s `start`/`dev` scripts and the `Dockerfile` both point at `src/server.js`.

### Why two files instead of one guarded file?
CommonJS projects commonly keep this all in one file behind `if (require.main === module) {
start(); }` — "only run this if I'm the entry point, not if something imported me." ES modules
have no `require.main`; the closest equivalent compares `import.meta.url` to `process.argv[1]`.
That works for `node server.js` directly, but breaks the moment a *test* imports the file: Jest
runs test files through Babel, and Babel's CommonJS transform has no way to translate
`import.meta` (there's no CJS concept for it), so it throws `SyntaxError: Cannot use
'import.meta' outside a module` for any file containing it that a test ever imports. Splitting
"build the app" from "run the app" into two files removes the need for the guard entirely —
`app.js` simply never has a reason to know whether it's the entry point.

This is what makes the Express app testable with Supertest:
```javascript
// In a test file:
import app from '../app.js';   // app is an Express instance, not listening
import request from 'supertest';
request(app).get('/health').expect(200);
```

### Handler Registration Order
```
registerOrderHandlers()
registerInventoryHandlers()
registerPaymentHandlers()
registerNotificationHandlers()
```
Order matters when one handler's action triggers an event that another handler must receive. In our case, all handlers register on the same singleton `eventBus` instance, so as long as all are registered before the first event fires, the order is fine. Registering before `connect()` ensures handlers are ready when the first HTTP request arrives.

### The Singleton EventBus
`src/shared/events/eventBus.js` exports `new EventBus()` — a single instance shared across all modules:
```javascript
export default new EventBus();
```
Every `import eventBus from '../../shared/events/eventBus.js'` resolves to the same object — both
CommonJS and ES modules cache a module by its resolved path and only evaluate it once. This is
what allows handlers registered in `order.events.js` to receive events published from
`cart.service.js` without any explicit wiring between those two files.

---

## Complete Event Chain Trace

A full checkout produces this event sequence. Each line in the console maps to one of these:

```
POST /api/v1/cart/checkout
│
├─ [cartService.checkout()]
│      cart.items cleared, totalAmount computed
│
├─ [EventBus] → CartCheckedOut  { userId, items, totalAmount, shippingAddress }
│   │
│   └─ [order.events] CART_CHECKED_OUT handler
│          orderService.createFromCart() → Order(PENDING) saved
│          │
│          └─ [EventBus] → OrderPlaced  { orderId, userId, items, totalAmount }
│              │
│              ├─ [notification.events] ORDER_PLACED handler
│              │      notification saved (order-confirmation)
│              │
│              └─ [inventory.events] ORDER_PLACED handler
│                     inventoryService.reserve() → reserved += qty
│                     │
│                     └─ [EventBus] → StockReserved  { orderId, userId, items, totalAmount }
│                         │
│                         ├─ [order.events] STOCK_RESERVED handler
│                         │      orderService.transition(orderId, 'CONFIRMED')
│                         │
│                         └─ [payment.events] STOCK_RESERVED handler
│                                paymentService.initiate() → Payment(PENDING) saved
│                                mock gateway → 80% success
│                                │
│                                ├─ success path:
│                                │    Payment(AUTHORISED) saved
│                                │    [EventBus] → PaymentAuthorised  { paymentId, orderId, userId, amount }
│                                │        ├─ [order.events] → transition(orderId, 'PROCESSING')
│                                │        ├─ [inventory.events] → commit stock (placeholder)
│                                │        └─ [notification.events] → notification (payment-success)
│                                │
│                                └─ failure path:
│                                     Payment(FAILED) saved
│                                     [EventBus] → PaymentFailed  { paymentId, orderId, userId }
│                                         ├─ [order.events] → transition(orderId, 'PAYMENT_FAILED')
│                                         └─ [notification.events] → notification (payment-failed)
│                                     (inventory releases reserved stock via ORDER_CANCELLED — see below)
│
HTTP 200 { message: 'Checkout initiated', totalAmount: X }
```

Notice the HTTP response returns **before** the saga completes. `eventBus.publish()` is synchronous in Node.js (EventEmitter fires all listeners before returning), so actually the full saga runs before the response is sent. With Kafka, `publish` would enqueue the message and the saga would complete asynchronously — the HTTP response would return immediately.

---

## Hands-On Exercise

### Step 1: Trace a checkout in the console
Start the server and run a full checkout. Match each console line to the event chain above.

```
[EventBus] → CartCheckedOut {...}
[EventBus] → OrderPlaced {...}
[Notification] Sending EMAIL to user ... — template: order-confirmation {...}
[EventBus] → StockReserved {...}
[EventBus] → PaymentAuthorised {...}
[Notification] Sending EMAIL to user ... — template: payment-success {...}
```

### Step 2: List notifications
```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/users/login \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@test.com","password":"password123"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['token'])")

curl -s http://localhost:3000/api/v1/notifications \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -m json.tool
```

You should see `order-confirmation` and `payment-success` (or `payment-failed`) notifications, each with the correct `payload`.

### Step 3: Add a new event subscriber (no other files change)

Open `src/modules/notification/notification.events.js` and add:
```javascript
eventBus.subscribe(EVENTS.ORDER_CANCELLED, async ({ userId, orderId }) => {
  await notificationService.create({
    userId,
    type:     'EMAIL',
    template: 'order-cancelled',
    payload:  { orderId },
  });
});
```

Restart the server. Cancel an order (`DELETE /api/v1/orders/:id`). Check notifications — an `order-cancelled` notification should appear. No other file was modified.

### Step 4: Verify the `app.js` / `server.js` split
Import `app.js` directly — nothing happens except the module loading; no MongoDB connection, no
console output:
```bash
node -e "import('./src/app.js').then(m => console.log(typeof m.default))"
# Output: object   (just the Express app — no server started, no MongoDB connection)
```

vs running the real entry point:
```bash
node src/server.js
# Output: MongoDB connected: mongodb://localhost:27017/ecommerce
#         Server running on port 3000 [development]
```

---

## Architecture Discussion

### Notification Reliability Problem

Current implementation: if `notificationService.create()` throws (e.g., DB write fails), the EventBus catches the error:
```javascript
// In EventBus.subscribe():
try {
  await handler(payload);
} catch (err) {
  console.error(`[EventBus] Handler error for ${event}:`, err.message);
}
```
The error is logged and silently swallowed. The order saga continues — a failing notification doesn't break checkout. This is intentional: notifications are a non-critical side effect.

**Problem:** if the notification DB write fails, no retry occurs. The user simply doesn't get their email.

**Production fix:** Use a dedicated notification queue (SQS, Redis Streams):
1. On `ORDER_PLACED`, enqueue a job to the notification queue
2. Worker picks up the job, renders template, calls SendGrid
3. On failure: worker retries with exponential backoff
4. Dead letter queue after N retries for human review

### Phase 2 (EventBridge)

In Phase 2, this architecture maps to:
- `eventBus.publish(...)` → `EventBridge.putEvents([...])`
- `eventBus.subscribe(...)` → Lambda function triggered by an EventBridge rule
- Notification Lambda: triggered by `ORDER_PLACED`, calls SES/SNS

The bounded context boundary stays the same. Only the transport changes.

---

## Common Mistakes

| Mistake | Problem | Fix |
|---|---|---|
| Importing notification service directly in order module | Tight coupling — violates module boundary | Order module only publishes events; notification subscribes |
| Calling `registerHandlers()` after `connect()` | If a Kafka message arrives during startup before handlers register, it's missed | Always register handlers before connecting |
| Putting startup logic (`connect()`, `app.listen()`) in `app.js` itself | Importing `app.js` in a test starts a real server and connects to MongoDB | Keep startup logic in `server.js`; `app.js` only builds and exports the app |
| Mutating `payload` (Mixed) without `markModified` | Mongoose won't persist the change | Reassign the whole object or call `notification.markModified('payload')` |

---

## Key Takeaways

1. Pure consumer pattern: notification module only subscribes, never publishes — no module depends on it
2. Open/Closed: adding a new notification requires only adding one `eventBus.subscribe()` in `notification.events.js`
3. Splitting `app.js` (build) from `server.js` (run) separates "run as server" from "import as module" — enables Supertest testing
4. All `registerHandlers()` calls happen before `connect()` — handlers must be ready before the first event fires
5. `export default new EventBus()` — module caching makes this a process-wide singleton
6. The saga is synchronous in this implementation (EventEmitter fires inline); with Kafka it becomes truly async

---

## Quiz Questions

1. What makes the notification module a "pure consumer"? Name two properties it has that distinguish it from the other modules.
2. How does the Open/Closed Principle apply to adding a new notification type?
3. Why does `server.js` exist as a separate file from `app.js`? What would break if `app.listen()` and `connect()` moved into `app.js` itself?
4. Why are `registerHandlers()` calls placed before `await connect()` in the startup sequence?
5. How is the singleton EventBus instance shared across all modules without any explicit dependency injection?
6. The HTTP response from `POST /cart/checkout` returns before the saga completes in theory, but in practice returns after. Why? How would Kafka change this?
7. What happens to the saga if a notification DB write throws an error? Is this the right behaviour? What would you do differently in production?
