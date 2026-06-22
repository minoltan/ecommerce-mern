import eventBus from '../../shared/events/eventBus.js';
import EVENTS from '../../shared/events/events.js';
import * as inventoryService from './inventory.service.js';

const registerHandlers = () => {
  eventBus.subscribe(EVENTS.ORDER_PLACED, async ({ orderId, userId, items, totalAmount }) => {
    try {
      await inventoryService.reserve(items);
      eventBus.publish(EVENTS.STOCK_RESERVED, { orderId, userId, items, totalAmount });
    } catch (err) {
      // reserve() already rolled back anything it managed to reserve, so
      // this OrderCancelled carries no items — there is nothing left to
      // release. Only the post-StockReserved cancel path (order.service.js
      // `cancel`) needs items released here.
      eventBus.publish(EVENTS.ORDER_CANCELLED, { orderId, userId, reason: err.message });
    }
  });

  eventBus.subscribe(EVENTS.ORDER_CANCELLED, async ({ items }) => {
    if (items?.length) await inventoryService.release(items);
  });

  eventBus.subscribe(EVENTS.PAYMENT_FAILED, async ({ items }) => {
    if (items?.length) await inventoryService.release(items);
  });

  eventBus.subscribe(EVENTS.PAYMENT_AUTHORISED, async ({ items }) => {
    if (items?.length) await inventoryService.commit(items);
  });
};

export { registerHandlers };
