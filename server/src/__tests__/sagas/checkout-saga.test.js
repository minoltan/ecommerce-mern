const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { Types } = mongoose;

const eventBus = require('../../shared/events/eventBus');
const EVENTS = require('../../shared/events/events');

const Order = require('../../modules/order/order.model');
const Inventory = require('../../modules/inventory/inventory.model');

const { registerHandlers: registerOrderHandlers } = require('../../modules/order/order.events');
const { registerHandlers: registerInventoryHandlers } = require('../../modules/inventory/inventory.events');

let mongod;

// EventBus handlers are async; emit() invokes them synchronously up to their
// first await, so give the rest of the chain a tick to land DB writes.
const flush = () => new Promise((resolve) => setTimeout(resolve, 50));

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  // Wire the same choreography app.js#start() wires — only the two modules
  // under test here, since payment is simulated directly below.
  registerOrderHandlers();
  registerInventoryHandlers();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Order.deleteMany({});
  await Inventory.deleteMany({});
});

describe('checkout saga — PaymentFailed branch', () => {
  it('releases reserved stock when payment fails', async () => {
    const productId = new Types.ObjectId();
    await Inventory.create({ productId, quantity: 10, reserved: 0 });

    const order = await Order.create({
      userId: new Types.ObjectId(),
      items: [{ productId, name: 'Widget', price: 9.99, quantity: 3 }],
      totalAmount: 29.97,
      status: 'PENDING',
    });

    // Simulate the StockReserved step that already ran earlier in the saga,
    // before Payment was ever invoked.
    await Inventory.findOneAndUpdate({ productId }, { $inc: { reserved: 3 } });

    // Payment module publishes PaymentFailed — simulated directly so the
    // test is deterministic instead of depending on payment.service's
    // built-in 80% mock success rate.
    eventBus.publish(EVENTS.PAYMENT_FAILED, {
      paymentId: new Types.ObjectId().toString(),
      orderId: order._id.toString(),
      userId: order.userId.toString(),
      items: order.items,
    });

    await flush();

    const updatedOrder = await Order.findById(order._id);
    expect(updatedOrder.status).toBe('PAYMENT_FAILED');

    const inv = await Inventory.findOne({ productId });
    expect(inv.reserved).toBe(0);
  });
});

describe('checkout saga — reservation failure branch', () => {
  it('does not over-release stock when one item in a multi-item order is insufficient', async () => {
    const productA = new Types.ObjectId();
    const productB = new Types.ObjectId();

    await Inventory.create({ productId: productA, quantity: 10, reserved: 0 });
    await Inventory.create({ productId: productB, quantity: 2, reserved: 0 }); // only 2 available

    const items = [
      { productId: productA, name: 'Widget A', price: 9.99, quantity: 3 }, // reservable
      { productId: productB, name: 'Widget B', price: 4.99, quantity: 5 }, // insufficient stock
    ];

    const order = await Order.create({
      userId: new Types.ObjectId(),
      items,
      totalAmount: 3 * 9.99 + 5 * 4.99,
      status: 'PENDING',
    });

    // Order module publishes OrderPlaced — simulated directly, same as the
    // PaymentFailed test above, to isolate inventory's choreography.
    eventBus.publish(EVENTS.ORDER_PLACED, {
      orderId: order._id.toString(),
      userId: order.userId.toString(),
      items,
      totalAmount: order.totalAmount,
    });

    await flush();

    const updatedOrder = await Order.findById(order._id);
    expect(updatedOrder.status).toBe('CANCELLED');

    const invA = await Inventory.findOne({ productId: productA });
    const invB = await Inventory.findOne({ productId: productB });

    // Product A was reserved, then rolled back when product B failed — must
    // return to its pre-attempt baseline, not stay reserved.
    expect(invA.reserved).toBe(0);
    // Product B was never reserved at all — must not go negative from a
    // phantom release of stock it never held.
    expect(invB.reserved).toBe(0);
  });
});

describe('checkout saga — PaymentAuthorised branch', () => {
  it('commits reserved stock (deducts quantity) when payment succeeds', async () => {
    const productId = new Types.ObjectId();
    await Inventory.create({ productId, quantity: 10, reserved: 3 });

    const order = await Order.create({
      userId: new Types.ObjectId(),
      items: [{ productId, name: 'Widget', price: 9.99, quantity: 3 }],
      totalAmount: 29.97,
      status: 'CONFIRMED',
    });

    eventBus.publish(EVENTS.PAYMENT_AUTHORISED, {
      paymentId: new Types.ObjectId().toString(),
      orderId: order._id.toString(),
      userId: order.userId.toString(),
      amount: order.totalAmount,
      items: order.items,
    });

    await flush();

    const updatedOrder = await Order.findById(order._id);
    expect(updatedOrder.status).toBe('PROCESSING');

    const inv = await Inventory.findOne({ productId });
    expect(inv.quantity).toBe(7); // 10 - 3 deducted from stock on sale
    expect(inv.reserved).toBe(0); // reservation hold cleared
  });
});
