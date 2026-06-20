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
  // Known gap #1 in docs/hld/checkout-saga-flow.md: inventory.events.js has
  // no PaymentFailed subscriber, so stock reserved earlier in the saga is
  // never released back when payment fails. test.failing documents the
  // desired behaviour and will flip to a failure (telling us to drop
  // `.failing`) once a PaymentFailed → release subscriber is added.
  test.failing('releases reserved stock when payment fails', async () => {
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
    });

    await flush();

    const updatedOrder = await Order.findById(order._id);
    expect(updatedOrder.status).toBe('PAYMENT_FAILED');

    const inv = await Inventory.findOne({ productId });
    expect(inv.reserved).toBe(0);
  });
});
