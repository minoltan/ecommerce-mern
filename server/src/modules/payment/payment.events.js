import eventBus from '../../shared/events/eventBus.js';
import EVENTS from '../../shared/events/events.js';
import * as paymentService from './payment.service.js';

const registerHandlers = () => {
  eventBus.subscribe(EVENTS.STOCK_RESERVED, async ({ orderId, userId, items, totalAmount }) => {
    await paymentService.initiate({
      orderId,
      userId,
      items,
      amount: totalAmount,
      idempotencyKey: `order-${orderId}`,
    });
  });
};

export { registerHandlers };
