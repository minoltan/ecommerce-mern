# Session 06 — Cart Module
**Duration:** 1.5 hours  
**Files:** `src/modules/cart/`

---

## Learning Goals
- Understand the price snapshot pattern and why carts don't trust live product prices
- Use embedded sub-documents for cart items
- Implement upsert-style cart operations (find-or-create)
- Trigger the checkout saga by publishing `CartCheckedOut`

---

## Prerequisites
- Sessions 01–05 complete
- At least two active products in the database (from Session 05)
- A valid user JWT token

---

## Step 1 — Cart Model (`cart.model.js`)

```javascript
const cartItemSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    name:      { type: String, required: true },
    price:     { type: Number, required: true },   // ← snapshot at add-time
    quantity:  { type: Number, required: true, min: 1 },
  },
  { _id: false }   // items don't need their own _id
);

const cartSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    items:  [cartItemSchema],
  },
  { timestamps: true }
);

cartSchema.virtual('totalAmount').get(function () {
  return this.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
});
```

### Why `{ _id: false }` on cartItemSchema?
Items are embedded inside the cart document — they're not independent entities. Generating an `_id` for each item wastes space and provides no value. We identify items by `productId`, not by their own id.

### Why `unique: true` on `userId`?
One cart per user. This is a business rule enforced at the database index level, not just application code. If two concurrent requests tried to create a cart for the same user, MongoDB would reject the second one with a duplicate key error.

### Why a virtual for `totalAmount`?
`totalAmount` is always derivable from `items`. Storing it as a real field would require keeping it in sync on every add/update/remove — a classic source of bugs. The virtual recomputes it fresh each time. The only downside: virtuals are stripped by `.lean()` (plain JS objects), so `checkout` computes it manually with `reduce`.

### Price Snapshot Pattern
`price` in `cartItemSchema` is a **copy** of `product.price` at the moment the item is added. This is intentional:

```
User adds keyboard ($129.99) to cart       → snapshot: $129.99
Admin updates keyboard price to $149.99    → no effect on existing cart items
User pays                                  → charges $129.99 (the price when added)
```

The user sees a stable price throughout their session. After checkout, the `OrderPlaced` event carries the snapshot prices — the order record is immutable historical data.

---

## Step 2 — Zod Validation Schemas (`cart.schema.js`)

```javascript
const addItemSchema = z.object({
  productId: z.string().min(1),
  quantity:  z.number().int().positive(),    // must be ≥ 1
});

const updateQuantitySchema = z.object({
  quantity: z.number().int().min(0),         // 0 = remove; positive = new quantity
});

const checkoutSchema = z.object({
  shippingAddress: z.object({
    street:  z.string().min(1),
    city:    z.string().min(1),
    state:   z.string().min(1),
    country: z.string().min(1),
    zip:     z.string().min(1),
  }),
});
```

**Note the difference between `addItem` and `updateQuantity` schemas:**
- `addItemSchema.quantity`: `positive()` — adding 0 items makes no sense
- `updateQuantitySchema.quantity`: `min(0)` — 0 means "remove this item"

Using a single schema for both would require custom `.refine()` logic. Two schemas is cleaner.

---

## Step 3 — Cart Service (`cart.service.js`)

### Get Cart
```javascript
const getCart = async (userId) => {
  const cart = await Cart.findOne({ userId }).lean();
  return cart || { userId, items: [], totalAmount: 0 };
};
```
Returns an empty cart shape if the user has never added anything. No need to create a document just to represent an empty cart.

### Add Item (Upsert + Price Snapshot)
```javascript
const addItem = async (userId, { productId, quantity }) => {
  const product = await Product.findById(productId);
  if (!product || !product.isActive) throw new AppError('Product not found', 404);

  let cart = await Cart.findOne({ userId });
  if (!cart) cart = new Cart({ userId, items: [] });   // find-or-create

  const existing = cart.items.find((i) => i.productId.toString() === productId);
  if (existing) {
    existing.quantity += quantity;       // merge quantity
    existing.price = product.price;      // refresh price snapshot
  } else {
    cart.items.push({ productId, name: product.name, price: product.price, quantity });
  }

  await cart.save();
  return cart;
};
```

**Walk through the logic:**
```
First add (KB-001, qty 1):  cart.items = [{ productId: KB-001, price: 129.99, qty: 1 }]
Second add (KB-001, qty 2): existing found → qty becomes 3, price refreshed to current product price
Add new item (MS-001, qty 1): pushed → cart.items = [KB-001 x3, MS-001 x1]
```

Why `i.productId.toString() === productId`? Mongoose stores ObjectIds as BSON types. Comparing `ObjectId` with a plain string (`===`) always returns false. `.toString()` converts both sides to strings.

### Update Quantity (quantity 0 = remove)
```javascript
const updateQuantity = async (userId, productId, quantity) => {
  const cart = await Cart.findOne({ userId });
  if (!cart) throw new AppError('Cart not found', 404);

  const item = cart.items.find((i) => i.productId.toString() === productId);
  if (!item) throw new AppError('Item not in cart', 404);

  if (quantity === 0) {
    cart.items = cart.items.filter((i) => i.productId.toString() !== productId);
  } else {
    item.quantity = quantity;
  }

  await cart.save();
  return cart;
};
```

`quantity: 0` acts as "remove" — one endpoint instead of a dedicated remove-by-quantity endpoint. The `removeItem` endpoint (`DELETE /cart/items/:productId`) still exists for explicit removals.

### Checkout
```javascript
const checkout = async (userId, { shippingAddress }) => {
  const cart = await Cart.findOne({ userId });
  if (!cart || cart.items.length === 0) throw new AppError('Cart is empty', 400);

  const totalAmount = cart.items.reduce((sum, i) => sum + i.price * i.quantity, 0);

  eventBus.publish(EVENTS.CART_CHECKED_OUT, {
    userId,
    items: cart.items.map((i) => ({
      productId: i.productId.toString(),
      name:      i.name,
      price:     i.price,
      quantity:  i.quantity,
    })),
    totalAmount,
    shippingAddress,
  });

  cart.items = [];
  await cart.save();

  return { message: 'Checkout initiated', totalAmount };
};
```

**What happens after `eventBus.publish(CART_CHECKED_OUT)`?**
- `order.events.js` picks it up → creates an Order → publishes `OrderPlaced`
- `inventory.events.js` picks up `OrderPlaced` → reserves stock → publishes `StockReserved`
- `payment.events.js` picks up `StockReserved` → processes payment → publishes `PaymentAuthorised` or `PaymentFailed`

The cart service knows nothing about this chain. It fires and forgets. This is the core of choreography-based saga.

Why clear `cart.items = []` immediately? The cart is "consumed" at checkout. If the saga fails later (payment failure), the compensating transaction (`ORDER_CANCELLED`) reverses the inventory reservation — but the cart stays empty. This is a design choice: users must re-add items if they want to retry. An alternative would be to restore the cart on payment failure, but that adds complexity.

---

## Step 4 — Routes (`cart.routes.js`)

```javascript
router.use(authenticate);  // all cart routes require login

router.get('/',                         getCart);
router.post('/items',   validate(addItemSchema),        addItem);
router.put('/items/:productId',  validate(updateQuantitySchema), updateQuantity);
router.delete('/items/:productId',      removeItem);
router.post('/checkout', validate(checkoutSchema),      checkout);
```

**Why `router.use(authenticate)` instead of per-route?**
Every cart endpoint requires a user identity. Applying middleware at the router level means it runs for all routes defined after it — no risk of accidentally exposing a cart route without auth.

---

## Hands-On Exercise

### Step 1: Get a user JWT
```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/users/login \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@test.com","password":"password123"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['token'])")
echo $TOKEN
```

### Step 2: Get product IDs
```bash
curl -s http://localhost:3000/api/v1/products | python3 -m json.tool
# Note two product _id values: PRODUCT_ID_1 and PRODUCT_ID_2
PRODUCT_ID_1="paste-id-here"
PRODUCT_ID_2="paste-id-here"
```

### Step 3: Add items to cart
```bash
# Add product 1 (qty 2)
curl -s -X POST http://localhost:3000/api/v1/cart/items \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"productId\":\"$PRODUCT_ID_1\",\"quantity\":2}" \
  | python3 -m json.tool

# Add product 2 (qty 1)
curl -s -X POST http://localhost:3000/api/v1/cart/items \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"productId\":\"$PRODUCT_ID_2\",\"quantity\":1}" \
  | python3 -m json.tool
```

### Step 4: View cart
```bash
curl -s http://localhost:3000/api/v1/cart \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -m json.tool
# items array shows both products; note price snapshot values
```

### Step 5: Update quantity
```bash
curl -s -X PUT "http://localhost:3000/api/v1/cart/items/$PRODUCT_ID_1" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"quantity":3}' \
  | python3 -m json.tool
```

### Step 6: Set up inventory before checkout
Checkout triggers a stock reservation. If there is no inventory record for a product, it will fail with 404. Create inventory for both products:
```bash
# Admin token required for inventory management
ADMIN_TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/users/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@test.com","password":"password123"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['token'])")

curl -s -X PUT "http://localhost:3000/api/v1/inventory/$PRODUCT_ID_1" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"quantity":50}' \
  | python3 -m json.tool

curl -s -X PUT "http://localhost:3000/api/v1/inventory/$PRODUCT_ID_2" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"quantity":20}' \
  | python3 -m json.tool
```

### Step 7: Checkout
```bash
curl -s -X POST http://localhost:3000/api/v1/cart/checkout \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "shippingAddress": {
      "street":  "123 Main St",
      "city":    "New York",
      "state":   "NY",
      "country": "US",
      "zip":     "10001"
    }
  }' \
  | python3 -m json.tool
```

Watch the server console. You will see the saga chain fire:
```
[EventBus] → CartCheckedOut  { userId, items, totalAmount, shippingAddress }
[EventBus] → OrderPlaced     { orderId, userId, items, totalAmount }
[EventBus] → StockReserved   { orderId, userId, items, totalAmount }
[EventBus] → PaymentAuthorised | PaymentFailed   { paymentId, orderId, ... }
[Notification] Sending EMAIL to user ... — template: order-confirmation
[Notification] Sending EMAIL to user ... — template: payment-success | payment-failed
```

### Step 8: Verify in Mongo Express
Open http://localhost:8081 and inspect:
- `carts` collection: your cart document, items array should be empty
- `orders` collection: a new order document with status `PROCESSING` (if payment succeeded) or `PAYMENT_FAILED`
- `payments` collection: a new payment document
- `inventories` collection: `reserved` field incremented (or unchanged if payment failed and stock was released)
- `notifications` collection: order confirmation + payment notification

---

## Architecture Discussion

### Phase 1 (Spring Boot) vs Phase 3 (MERN)

**Phase 1 uses Redis for the cart:**
- Cart is stored as a Redis hash with a TTL (e.g., 24 hours)
- If the user doesn't checkout within the TTL, the cart expires automatically
- No MongoDB query for every cart operation — reads/writes are O(1)
- Trade-off: cart is lost if the user doesn't check out before expiry

**Phase 3 uses MongoDB:**
- Cart is persisted indefinitely until checkout
- Users can return days later and find their items
- No TTL — admin must manually implement expiry if needed with `expireAfterSeconds` index
- Trade-off: carts accumulate in the DB; a cleanup job is needed

Neither is universally better. For a high-traffic site, Redis is the clear winner. For a small-scale platform where "saved carts" are a feature, MongoDB is fine.

### Embedded vs Referenced Items

We use embedded `cartItemSchema` inside the cart document. The alternative:

```javascript
// Alternative: separate CartItem collection
const CartItem = mongoose.model('CartItem', { cartId, productId, price, quantity });
```

The embedded approach is correct here because:
- Items are always loaded with the cart (no case where you'd query items without the cart)
- The number of items per cart is bounded (maybe 50 items max)
- Atomicity: updating multiple items in one `.save()` is a single MongoDB write

A separate collection would require a `populate()` (JOIN) on every cart read.

---

## Common Mistakes

| Mistake | Problem | Fix |
|---|---|---|
| `i.productId === productId` (no `.toString()`) | ObjectId vs string comparison always false — existing item never found | Always `.toString()` both sides |
| Using product's current price at checkout instead of snapshot | Users pay a different price than shown at add-to-cart time | Always use `item.price` (snapshot), not `product.price` |
| Forgetting `cart.items = []; await cart.save()` at checkout | Cart not cleared — user can checkout twice | Clear items and save immediately after publishing event |
| `totalAmount` from virtual in `.lean()` | Virtuals are stripped — `totalAmount` is `undefined` | Compute manually with `reduce()` when using `.lean()` |
| Not checking `product.isActive` on addItem | Can add soft-deleted products | Always check `!product || !product.isActive` |

---

## Key Takeaways

1. Price snapshot at add-to-cart time — never use live product price at checkout
2. `{ _id: false }` on embedded sub-documents when items aren't independent entities
3. `router.use(authenticate)` applies auth to all routes in the router — preferred over per-route
4. `quantity: 0` doubles as "remove" in update endpoint — one endpoint, two behaviours
5. Virtuals are stripped by `.lean()` — recompute with `reduce()` where needed
6. `objectId.toString() === string` — always convert ObjectIds when comparing with string params
7. Cart service publishes `CartCheckedOut` and forgets — the saga chain runs in event handlers

---

## Quiz Questions

1. What is the price snapshot pattern? Why does the cart store a copy of the price instead of reading it fresh from the Product collection at checkout?
2. Why do we use `{ _id: false }` on `cartItemSchema`?
3. What happens if you compare a Mongoose ObjectId with a string using `===`? How do you fix it?
4. Why is `totalAmount` a virtual, not a stored field? What is the downside of using a virtual with `.lean()`?
5. Why does `router.use(authenticate)` appear at the top of the cart router instead of on each route individually?
6. After `checkout()` publishes `CartCheckedOut` and clears the cart, what guarantees that the order is created? What happens if the order service crashes before saving the order?
7. Compare Redis vs MongoDB for cart storage. In which scenario would you choose each?
