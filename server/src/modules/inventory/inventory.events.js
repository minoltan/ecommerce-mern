const eventBus = require('../../shared/events/eventBus');
const EVENTS = require('../../shared/events/events');
const inventoryService = require('./inventory.service');

const registerHandlers = () => {
  eventBus.subscribe(EVENTS.ORDER_PLACED, async ({ orderId, userId, items, totalAmount }) => {
    try {
      await inventoryService.reserve(items);
      eventBus.publish(EVENTS.STOCK_RESERVED, { orderId, userId, items, totalAmount });
    } catch (err) {
      eventBus.publish(EVENTS.ORDER_CANCELLED, { orderId, userId, items, reason: err.message });
    }
  });

  eventBus.subscribe(EVENTS.ORDER_CANCELLED, async ({ items }) => {
    if (items?.length) await inventoryService.release(items);
  });

  eventBus.subscribe(EVENTS.PAYMENT_FAILED, async ({ items }) => {
    if (items?.length) await inventoryService.release(items);
  });

  eventBus.subscribe(EVENTS.PAYMENT_AUTHORISED, async ({ orderId }) => {
    // Commit reserved stock (deduct from quantity) when payment succeeds.
    // orderId is available here; in production, fetch order items from DB.
    console.log(`[Inventory] Committing stock for order ${orderId}`);
  });
};

module.exports = { registerHandlers };
