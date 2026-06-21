# Session 10 — Hands-On: Testing the Modules

This is a companion to the Session 10 lecture plan in `CURRICULUM.md`. Like every session
before it, you're writing real code from a blank slate — this time, tests. By the end, six
modules that currently have zero test coverage (`product`, `cart`, `order`, `payment`,
`inventory`, `notification`) will have real ones, written by you.

## Before You Start

- Sessions 1–9 done: all seven modules scaffolded.
- Confirm the baseline: `cd server && npm test` → 1 suite, 7 tests, all in the `user` module.
- Open `server/src/modules/user/__tests__/user.service.test.js` side by side with this guide —
  every pattern below builds directly on it.

## Step 1 — Worked example: test the Product service from scratch

We're starting with `product` because it's the simplest CRUD module with no event-bus
fan-out to other modules to worry about yet — one repetition of the `user` pattern before
the harder cases.

Create `server/src/modules/product/__tests__/product.service.test.js`.

**1a. Boilerplate.** Copy the exact `beforeAll`/`afterAll`/`beforeEach` shape from
`user.service.test.js` — `MongoMemoryServer`, connect, disconnect+stop, clear the collection.
Swap `User` for `Product`:

```js
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const eventBus = require('../../../shared/events/eventBus');
const EVENTS = require('../../../shared/events/events');
const productService = require('../product.service');
const Product = require('../product.model');

let mongod;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Product.deleteMany({});
});
```

**Why import `eventBus` and `EVENTS` here, when `user.service.test.js` doesn't?** Because we're
about to test something `user.service.test.js` never covers: that a service actually published
the event it claims to. Keep reading.

**1b. `create` — happy path, then the event it should publish.**

```js
describe('create', () => {
  it('creates a product and returns it', async () => {
    const product = await productService.create({
      name: 'Mechanical Keyboard',
      price: 129.99,
      sku: 'KB-001',
      category: 'Electronics',
    });
    expect(product.name).toBe('Mechanical Keyboard');
    expect(product.isActive).toBe(true);
  });

  it('publishes ProductCreated with the new product id', async () => {
    const publishSpy = jest.spyOn(eventBus, 'publish');

    const product = await productService.create({
      name: 'Mechanical Keyboard',
      price: 129.99,
      sku: 'KB-001',
      category: 'Electronics',
    });

    expect(publishSpy).toHaveBeenCalledWith(EVENTS.PRODUCT_CREATED, {
      productId: product._id.toString(),
      name: 'Mechanical Keyboard',
      price: 129.99,
    });

    publishSpy.mockRestore();
  });
});
```

**Why `jest.spyOn` instead of, say, subscribing a fake listener:** `eventBus` is a real
`EventEmitter` singleton. Spying on its `publish` method lets you assert *exactly* what was
published without actually triggering every other module's subscribers (which would pull
`order`, `inventory`, etc. into what's supposed to be a Product-only test). Always
`mockRestore()` afterward — an un-restored spy on a shared singleton leaks into the next test
file that imports the same `eventBus` module instance.

**1c. `findAll` — filters and pagination math.**

```js
describe('findAll', () => {
  beforeEach(async () => {
    await Product.create([
      { name: 'Keyboard', price: 100, sku: 'A1', category: 'Electronics' },
      { name: 'Mouse', price: 50, sku: 'A2', category: 'Electronics' },
      { name: 'Desk', price: 300, sku: 'A3', category: 'Furniture' },
    ]);
  });

  it('filters by category', async () => {
    const result = await productService.findAll({ category: 'Furniture' });
    expect(result.products).toHaveLength(1);
    expect(result.products[0].name).toBe('Desk');
  });

  it('filters by price range', async () => {
    const result = await productService.findAll({ minPrice: 80, maxPrice: 200 });
    expect(result.products).toHaveLength(1);
    expect(result.products[0].name).toBe('Keyboard');
  });

  it('paginates and reports totalPages', async () => {
    const result = await productService.findAll({ page: 1, limit: 2 });
    expect(result.products).toHaveLength(2);
    expect(result.total).toBe(3);
    expect(result.totalPages).toBe(2);
  });
});
```

**Why test pagination math (`total`, `totalPages`) and not just the returned array:** the array
length only proves `limit` works. `total` and `totalPages` are computed from a *separate*
`countDocuments` query in `product.service.js` — it's easy to get that query's filter out of
sync with the main query's filter (e.g. someone adds a new filter field to one and forgets the
other). Asserting on the computed numbers, not just the page contents, is what would catch that.

**1d. `findById` — the 404 path.**

```js
describe('findById', () => {
  it('throws 404 for a well-formed id that does not exist', async () => {
    const missingId = new mongoose.Types.ObjectId();
    await expect(productService.findById(missingId)).rejects.toMatchObject({ status: 404 });
  });
});
```

**1e. `update` — a gotcha about IDs you should see for yourself.**

Write this first attempt exactly as shown, run it, and read the failure before reading further:

```js
describe('update', () => {
  it('publishes PriceUpdated only when price actually changes', async () => {
    const product = await productService.create({
      name: 'Keyboard', price: 100, sku: 'A1', category: 'Electronics',
    });
    const publishSpy = jest.spyOn(eventBus, 'publish');

    await productService.update(product._id, { name: 'Mechanical Keyboard' });
    expect(publishSpy).not.toHaveBeenCalledWith(EVENTS.PRICE_UPDATED, expect.anything());

    await productService.update(product._id, { price: 120 });
    expect(publishSpy).toHaveBeenCalledWith(EVENTS.PRICE_UPDATED, {
      productId: product._id.toString(),
      newPrice: 120,
    });

    publishSpy.mockRestore();
  });
});
```

This fails. Look at `product.service.js`'s `update` function:
`eventBus.publish(EVENTS.PRICE_UPDATED, { productId: id, newPrice: data.price })` — it publishes
whatever `id` it was *given*, with no `.toString()`. Compare with `create()`, which does
`productId: product._id.toString()`. In real usage this never matters, because the controller
always calls `update(req.params.id, ...)` — and Express route params are always strings. We
broke the implicit contract by calling `update()` directly with a raw Mongoose `ObjectId`
instead of a string, the way the controller would.

**The fix is in the test, not the code** — make the test call `update()` the same way its real
caller does:

```js
    const id = product._id.toString(); // update() trusts its caller already has a string id —
                                        // pass a raw ObjectId and PRICE_UPDATED won't match,
                                        // since update() doesn't re-stringify it.

    await productService.update(id, { name: 'Mechanical Keyboard' });
    expect(publishSpy).not.toHaveBeenCalledWith(EVENTS.PRICE_UPDATED, expect.anything());

    await productService.update(id, { price: 120 });
    expect(publishSpy).toHaveBeenCalledWith(EVENTS.PRICE_UPDATED, { productId: id, newPrice: 120 });
```

**Why this is worth the detour:** unit-testing a service directly, bypassing its controller, is
normal and good — but it means *you* are now responsible for upholding whatever contract the
controller used to uphold for free. Skipping this would have shipped a test that passes for the
wrong reason (or, with the original ObjectId call, a test that fails and tempts you to "fix" the
working production code instead of your unrealistic test call).

**1f. `remove` — confirm it's a soft delete.**

```js
describe('remove', () => {
  it('soft-deletes — isActive becomes false, document still exists', async () => {
    const product = await productService.create({
      name: 'Keyboard', price: 100, sku: 'A1', category: 'Electronics',
    });

    await productService.remove(product._id);

    const stillThere = await Product.findById(product._id);
    expect(stillThere).not.toBeNull();
    expect(stillThere.isActive).toBe(false);
  });
});
```

Asserting `stillThere).not.toBeNull()` is the point of this test — a naive implementation
mistake (calling `findByIdAndDelete` instead of setting `isActive: false`) would still make
`isActive` checks meaningless because there'd be nothing left to check.

Run `npx jest src/modules/product` now. You should see 7 passing tests.

## Step 2 — Worked example: integration-test the Product API with Supertest

Unit tests call the service directly. Integration tests go through HTTP, exercising the
middleware chain (`authenticate` → `authorize('admin')` → `validate(schema)` → controller) —
which is where most real bugs in a REST API actually live.

Create `server/src/modules/product/__tests__/product.api.test.js`:

```js
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../../../app');
const env = require('../../../shared/config/env');
const Product = require('../product.model');

let mongod;

const signToken = (role) =>
  jwt.sign({ sub: new mongoose.Types.ObjectId().toString(), role }, env.JWT_SECRET, {
    expiresIn: '15m',
  });

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Product.deleteMany({});
});

describe('GET /api/v1/products', () => {
  it('returns the paginated list shape', async () => {
    await Product.create({ name: 'Keyboard', price: 100, sku: 'A1', category: 'Electronics' });

    const res = await request(app).get('/api/v1/products');

    expect(res.status).toBe(200);
    expect(res.body.data.products).toHaveLength(1);
  });
});

describe('POST /api/v1/products', () => {
  const payload = { name: 'Keyboard', price: 100, sku: 'A1', category: 'Electronics' };

  it('rejects with 401 when no token is sent', async () => {
    const res = await request(app).post('/api/v1/products').send(payload);
    expect(res.status).toBe(401);
  });

  it('rejects with 403 for a non-admin token', async () => {
    const res = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${signToken('customer')}`)
      .send(payload);
    expect(res.status).toBe(403);
  });

  it('creates the product for an admin token', async () => {
    const res = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${signToken('admin')}`)
      .send(payload);

    expect(res.status).toBe(201);
    expect(res.body.data.sku).toBe('A1');

    const stored = await Product.findOne({ sku: 'A1' });
    expect(stored).not.toBeNull();
  });
});
```

**Why `require('../../../app')` works without calling `.listen()`:** `app.js` ends with
`if (require.main === module) { start(); }` — `start()` (which connects Mongo and binds the
port) only runs when you run `node src/app.js` directly. When a test file `require`s `app.js`,
`require.main` is the *test runner*, not `app.js`, so the guard is false — you get the
configured Express `app` object with zero network ports involved. Supertest drives it entirely
in-process.

**Why sign a JWT by hand instead of calling `POST /users/login` first:** it's faster (no
password hashing round-trip) and it isolates this test from the User module — if `user.service`
breaks, you don't want every other module's auth tests breaking with it. **The trade-off:** this
test will keep passing even if `authenticate`'s actual `jwt.verify` call or the token shape
`user.service.js` really signs ever drifts out of sync with what you're hand-crafting here. A
real test suite would want at least one end-to-end test elsewhere that does go through real
login, to catch that drift. Knowing what a test *doesn't* prove is as important as knowing what
it does.

Run `npx jest src/modules/product` again — you should now see 2 suites, 10 tests total.

## Step 3 — Your turn: the same pattern, five more modules

Don't copy Step 1–2 verbatim — re-derive the boilerplate from `user.service.test.js` each time
until it's automatic. For each module below, write the service-layer tests; treat the bullet
list as your assertions to design, not code to transcribe.

**`cart` (`cart.service.js`):**
- `addItem` on a product already in the cart increments `quantity` instead of adding a second
  line item.
- `updateQuantity(userId, productId, 0)` removes the item from `cart.items` entirely.
- `checkout` on an empty cart throws `{ status: 400 }`.
- `checkout` publishes `CartCheckedOut` with the correct computed `totalAmount`, and empties
  `cart.items` afterward — spy on `eventBus.publish` like Step 1b, then re-fetch the cart from
  the DB to check it's empty (don't trust the in-memory object after `.save()`).

**`order` (`order.service.js`):**
- `createFromCart` creates the order with `status: 'PENDING'` and publishes `OrderPlaced`.
- `cancel` throws `{ status: 400 }` when the order's status isn't `PENDING` or `CONFIRMED`
  (create one directly with `Order.create({ ..., status: 'SHIPPED' })` to set up this case).
- `cancel` publishes `OrderCancelled` with the order's `items`.

**`payment` (`payment.service.js`):**
- `initiate` is idempotent: call it twice with the same `idempotencyKey` and assert only one
  `Payment` document exists in the DB afterward.
- The mock gateway's `Math.random() > 0.2` branch is genuinely random — a test that runs it
  unmocked will flake. Force each branch deterministically:
  `jest.spyOn(Math, 'random').mockReturnValue(0.9)` forces success (`0.9 > 0.2`);
  `mockReturnValue(0.1)` forces failure (`0.1` is not `> 0.2`). Remember to `mockRestore()`.
- `refund` throws `{ status: 400 }` on a payment that isn't `AUTHORISED`.

**`inventory` (`inventory.service.js`):**
- `reserve` throws `{ status: 400 }` when requested quantity exceeds `quantity - reserved`.
- `commit` decrements both `quantity` and `reserved` by the committed amount.
- `release` decrements `reserved` (but not `quantity`) by the released amount.
- Bonus, if you want a preview of Session 15: try a multi-item `reserve()` call where the
  *second* item has insufficient stock, and check whether the *first* item's `reserved` value
  goes back to what it was before the call. Whatever you find, you'll want to remember it.

**`notification` (`notification.service.js`):**
- `create` persists a `Notification` with `status: 'SENT'` and a `sentAt` timestamp set.

## Step 4 — Run coverage, and read it like a map

```bash
npm run test:coverage
```

Find the file with the lowest `% Funcs` or `% Branches` — not the lowest `% Lines`. A function
that's called once with one happy-path input can show 100% line coverage while testing almost
nothing about its actual behavior (error branches, edge cases). Coverage percentage is a map of
*where you haven't looked yet*, not a score to maximize — a file at 60% with the right 60%
tested can be more trustworthy than one at 95% that never exercises its error paths.

## Recap

| Module | What you wrote |
|---|---|
| `product` | Full worked example: unit tests (CRUD + event spies) + Supertest integration tests |
| `cart`, `order`, `payment`, `inventory`, `notification` | Unit tests you designed from the bullet lists in Step 3 |

Run `npm test` from `server/` — you should now have 7 test files instead of 1, and every module
in the system has real coverage for the first time.

## What's Next

Session 11 (Docker) is next in the core curriculum. Once you've finished Sessions 1–14, there's
an optional advanced capstone, Session 15, that flips this session's approach around: instead of
writing new tests for code you just wrote, you audit *existing* code, prove a bug with a failing
test before fixing it, and hardening a saga that already has a subtle compensation bug hiding in
it. The "bonus" bullet under `inventory` above is a preview of exactly that bug.
