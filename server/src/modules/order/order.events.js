import eventBus from '../../shared/events/eventBus.js';
import EVENTS from '../../shared/events/events.js';
import * as orderService from './order.service.js';

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

export { registerHandlers };
